-- Migration: Create many-to-many relationship between products and categories
-- Allows products to belong to multiple categories

-- First, create the update function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TABLE IF NOT EXISTS product_categories (
  id SERIAL PRIMARY KEY,
  product_square_id VARCHAR(255) NOT NULL,
  category_square_id VARCHAR(255) NOT NULL,
  is_primary BOOLEAN DEFAULT false, -- Mark primary category for product
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Ensure unique combinations
  UNIQUE(product_square_id, category_square_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_product_categories_product ON product_categories(product_square_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_category ON product_categories(category_square_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_primary ON product_categories(is_primary);

-- Note: Foreign key constraints will be added via Sequelize associations
-- This allows for more flexible data management during development

-- Create trigger to update updated_at timestamp
CREATE TRIGGER update_product_categories_updated_at BEFORE UPDATE
ON product_categories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();