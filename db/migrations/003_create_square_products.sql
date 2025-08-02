-- Migration: Create square_products table
-- This stores Square product data with admin controls for featured products

CREATE TABLE IF NOT EXISTS square_products (
  id SERIAL PRIMARY KEY,
  square_id VARCHAR(255) NOT NULL UNIQUE,
  square_version BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category_id VARCHAR(255),
  square_category_id VARCHAR(255),
  images JSONB DEFAULT '[]'::jsonb, -- JSON array of image data
  variations JSONB DEFAULT '[]'::jsonb, -- JSON array of variation data
  is_deleted BOOLEAN DEFAULT false,
  square_updated_at TIMESTAMP NOT NULL,
  last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Admin control fields
  is_featured BOOLEAN DEFAULT false,
  featured_order INTEGER,
  is_visible BOOLEAN DEFAULT true,
  admin_notes TEXT,
  custom_price DECIMAL(10, 2), -- Override Square price if needed
  custom_description TEXT, -- Override Square description if needed
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE UNIQUE INDEX IF NOT EXISTS idx_square_products_square_id ON square_products(square_id);
CREATE INDEX IF NOT EXISTS idx_square_products_featured ON square_products(is_featured, featured_order);
CREATE INDEX IF NOT EXISTS idx_square_products_visibility ON square_products(is_visible, is_deleted);
CREATE INDEX IF NOT EXISTS idx_square_products_category ON square_products(square_category_id);
CREATE INDEX IF NOT EXISTS idx_square_products_name ON square_products(name);

-- Create GIN indexes for JSONB columns for fast searches
CREATE INDEX IF NOT EXISTS idx_square_products_images ON square_products USING GIN (images);
CREATE INDEX IF NOT EXISTS idx_square_products_variations ON square_products USING GIN (variations);

-- Create trigger to update updated_at timestamp
CREATE TRIGGER update_square_products_updated_at BEFORE UPDATE
ON square_products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add foreign key constraint to categories
ALTER TABLE square_products 
ADD CONSTRAINT fk_square_products_category 
FOREIGN KEY (square_category_id) 
REFERENCES square_categories(square_id) ON DELETE SET NULL;