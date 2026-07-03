require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const XLSX = require('xlsx');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false
});

// ---------- Init DB (runs schema.sql on boot) ----------
async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('DB schema ready');
}

// ---------- Helpers ----------
function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase();
}

function findKey(row, candidates) {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const match = keys.find(k => normalizeHeader(k) === cand);
    if (match) return match;
  }
  // fallback: partial match
  for (const cand of candidates) {
    const match = keys.find(k => normalizeHeader(k).includes(cand));
    if (match) return match;
  }
  return null;
}

function parseExcelBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

function toDateString(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function toNumber(val) {
  if (typeof val === 'number') return val;
  const n = parseFloat(String(val).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ---------- Upload: Sales Report ----------
app.post('/api/upload/sales', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const rows = parseExcelBuffer(req.file.buffer);
    if (!rows.length) return res.status(400).json({ error: 'File has no data rows' });

    const dateKey = findKey(rows[0], ['date', 'sale date', 'saledate', 'order date']);
    const skuKey = findKey(rows[0], ['sku', 'sku code', 'product code', 'item code']);
    const nameKey = findKey(rows[0], ['product name', 'product', 'item name', 'name']);
    const qtyKey = findKey(rows[0], ['quantity', 'qty', 'quantity sold', 'units sold', 'units']);
    const amtKey = findKey(rows[0], ['amount', 'sales amount', 'total amount', 'revenue', 'value', 'total']);

    const batch = `sales_${Date.now()}`;
    const client = await pool.connect();
    let inserted = 0;
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const sale_date = dateKey ? toDateString(row[dateKey]) : null;
        const sku = skuKey ? String(row[skuKey]).trim() : null;
        const product_name = nameKey ? String(row[nameKey]).trim() : null;
        const quantity = qtyKey ? toNumber(row[qtyKey]) : 0;
        const amount = amtKey ? toNumber(row[amtKey]) : 0;
        if (!sku && !product_name) continue; // skip empty rows
        await client.query(
          `INSERT INTO sales (sale_date, sku, product_name, quantity, amount, upload_batch)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [sale_date, sku, product_name, quantity, amount, batch]
        );
        inserted++;
      }
      await client.query(
        `INSERT INTO uploads_log (upload_type, file_name, row_count) VALUES ('sales', $1, $2)`,
        [req.file.originalname, inserted]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({
      success: true,
      inserted,
      detectedColumns: { dateKey, skuKey, nameKey, qtyKey, amtKey }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Upload: Stock ----------
app.post('/api/upload/stock', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const rows = parseExcelBuffer(req.file.buffer);
    if (!rows.length) return res.status(400).json({ error: 'File has no data rows' });

    const skuKey = findKey(rows[0], ['sku', 'sku code', 'product code', 'item code']);
    const nameKey = findKey(rows[0], ['product name', 'product', 'item name', 'name']);
    const qtyKey = findKey(rows[0], ['quantity', 'qty', 'stock qty', 'stock quantity', 'current stock', 'stock', 'available qty']);

    if (!skuKey) return res.status(400).json({ error: 'Could not find an SKU column in the file' });

    const client = await pool.connect();
    let upserted = 0;
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const sku = String(row[skuKey]).trim();
        if (!sku) continue;
        const product_name = nameKey ? String(row[nameKey]).trim() : null;
        const quantity = qtyKey ? toNumber(row[qtyKey]) : 0;
        await client.query(
          `INSERT INTO stock (sku, product_name, quantity, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (sku) DO UPDATE SET
             product_name = COALESCE(EXCLUDED.product_name, stock.product_name),
             quantity = EXCLUDED.quantity,
             updated_at = NOW()`,
          [sku, product_name, quantity]
        );
        upserted++;
      }
      await client.query(
        `INSERT INTO uploads_log (upload_type, file_name, row_count) VALUES ('stock', $1, $2)`,
        [req.file.originalname, upserted]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({ success: true, upserted, detectedColumns: { skuKey, nameKey, qtyKey } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Dashboard summary ----------
app.get('/api/dashboard', async (req, res) => {
  try {
    const days = parseInt(req.query.days || '30', 10);

    const totals = await pool.query(
      `SELECT COALESCE(SUM(quantity),0) AS total_qty, COALESCE(SUM(amount),0) AS total_amount, COUNT(*) AS total_rows
       FROM sales WHERE sale_date >= (CURRENT_DATE - $1::int)`,
      [days]
    );

    const byDay = await pool.query(
      `SELECT sale_date, SUM(quantity) AS qty, SUM(amount) AS amount
       FROM sales
       WHERE sale_date >= (CURRENT_DATE - $1::int) AND sale_date IS NOT NULL
       GROUP BY sale_date ORDER BY sale_date ASC`,
      [days]
    );

    const topProducts = await pool.query(
      `SELECT COALESCE(product_name, sku) AS name, SUM(quantity) AS qty, SUM(amount) AS amount
       FROM sales
       WHERE sale_date >= (CURRENT_DATE - $1::int)
       GROUP BY COALESCE(product_name, sku)
       ORDER BY amount DESC LIMIT 10`,
      [days]
    );

    const stockSummary = await pool.query(
      `SELECT COUNT(*) AS sku_count, COALESCE(SUM(quantity),0) AS total_stock
       FROM stock`
    );

    const lowStock = await pool.query(
      `SELECT sku, product_name, quantity FROM stock
       WHERE quantity <= 10 ORDER BY quantity ASC LIMIT 20`
    );

    const lastUploads = await pool.query(
      `SELECT upload_type, file_name, row_count, uploaded_at FROM uploads_log
       ORDER BY uploaded_at DESC LIMIT 5`
    );

    res.json({
      totals: totals.rows[0],
      byDay: byDay.rows,
      topProducts: topProducts.rows,
      stockSummary: stockSummary.rows[0],
      lowStock: lowStock.rows,
      lastUploads: lastUploads.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Raw listing (optional, for drill-down) ----------
app.get('/api/sales', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
    const result = await pool.query(
      `SELECT * FROM sales ORDER BY sale_date DESC NULLS LAST, id DESC LIMIT $1`, [limit]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stock', async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM stock ORDER BY quantity ASC`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('Failed to init DB', err);
    process.exit(1);
  });
