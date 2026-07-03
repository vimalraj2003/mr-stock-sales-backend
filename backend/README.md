# Major Rangas — Sales Report & Stock Upload + Dashboard

Simple 2-part tool:
- **Backend** (Node/Express + PostgreSQL) — deploy on Railway
- **Frontend** (single `index.html`) — deploy on GitHub Pages

## What it does
- Upload your sales report `.xlsx` → rows get stored in a `sales` table
- Upload your stock `.xlsx` → rows get upserted into a `stock` table (matched by SKU)
- Dashboard shows: total qty/amount sold, daily sales chart, top products, low stock alerts, upload history

## Expected Excel columns (flexible — it matches common header names automatically)

**Sales file** — needs at least SKU or Product Name, plus:
- Date (`Date`, `Sale Date`, `Order Date`)
- SKU (`SKU`, `SKU Code`, `Product Code`, `Item Code`)
- Product Name (`Product Name`, `Product`, `Item Name`, `Name`)
- Quantity (`Quantity`, `Qty`, `Quantity Sold`, `Units Sold`)
- Amount (`Amount`, `Sales Amount`, `Total Amount`, `Revenue`, `Total`)

**Stock file** — needs SKU column, plus:
- SKU (same as above) — required
- Product Name (optional)
- Quantity (`Quantity`, `Qty`, `Stock Qty`, `Current Stock`, `Available Qty`)

Column names don't need to match exactly — matching is case-insensitive and flexible.

---

## Step 1 — Deploy backend on Railway

1. Go to [railway.app](https://railway.app) → New Project → **Deploy from GitHub repo** (or upload the `backend/` folder as a new repo via GitHub's web editor, like your other projects).
2. In the same Railway project, click **+ New** → **Database** → **PostgreSQL**. Railway auto-creates a `DATABASE_URL` variable.
3. In your backend service → **Variables**, make sure `DATABASE_URL` is linked (Railway usually does this automatically when DB is in the same project — check under "Variables" that it references `${{Postgres.DATABASE_URL}}`).
4. Deploy. The server runs `schema.sql` automatically on boot — tables get created the first time it starts.
5. Once deployed, copy your Railway backend URL, e.g. `https://mr-stock-sales-backend-production.up.railway.app`.

## Step 2 — Deploy frontend on GitHub Pages

1. Open `frontend/index.html`, find this line near the bottom:
   ```js
   const BACKEND_URL = "https://YOUR-RAILWAY-BACKEND-URL.up.railway.app";
   ```
   Replace it with your actual Railway URL from Step 1.
2. Upload `index.html` to a GitHub repo (via GitHub's web editor, same as your other projects) and enable **GitHub Pages** (Settings → Pages → deploy from branch, root).
3. Visit your GitHub Pages URL — the dashboard should load (it'll show zeros until you upload files).

## Step 3 — Use it

1. Open the dashboard.
2. Upload your sales report `.xlsx` under "Upload Sales Report".
3. Upload your stock `.xlsx` under "Upload Stock".
4. Dashboard updates automatically — use the 7d/30d/90d/1y toggle to change the sales chart window.

## Notes
- Re-uploading a sales file **adds** more rows (doesn't overwrite) — each upload is tagged with a batch ID. If you re-upload the same period twice you'll get duplicates — safest is to upload each day's/period's report once.
- Re-uploading a stock file **replaces** quantities for matching SKUs (upsert) — so you can just re-upload your latest stock file anytime to refresh it.
- Low stock threshold is currently ≤10 units — change the number in `server.js` (`WHERE quantity <= 10`) if you want a different cutoff.
