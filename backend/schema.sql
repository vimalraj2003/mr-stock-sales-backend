-- Major Rangas: Sales Report & Stock schema

CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  sale_date DATE,
  sku TEXT,
  product_name TEXT,
  quantity NUMERIC DEFAULT 0,
  amount NUMERIC DEFAULT 0,
  upload_batch TEXT,
  uploaded_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock (
  id SERIAL PRIMARY KEY,
  sku TEXT UNIQUE,
  product_name TEXT,
  quantity NUMERIC DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS uploads_log (
  id SERIAL PRIMARY KEY,
  upload_type TEXT, -- 'sales' or 'stock'
  file_name TEXT,
  row_count INTEGER,
  uploaded_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_sku ON sales(sku);
