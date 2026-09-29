-- Migration: Create featured_products table
-- Admin-curated homepage product selection. Only stores the Square item id +
-- curation metadata - product data (name/price/image) is always fetched live
-- from Square, never duplicated here.

CREATE TABLE IF NOT EXISTS featured_products (
  id SERIAL PRIMARY KEY,
  square_item_id VARCHAR(255) NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_featured_products_order ON featured_products(is_visible, sort_order);

CREATE TRIGGER update_featured_products_updated_at BEFORE UPDATE
ON featured_products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
