-- Migration: Create square_categories table
-- This stores Square category data with admin controls for featured categories

CREATE TABLE IF NOT EXISTS square_categories (
  id SERIAL PRIMARY KEY,
  square_id VARCHAR(255) NOT NULL UNIQUE,
  square_version BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  parent_category_id VARCHAR(255),
  square_parent_category_id VARCHAR(255),
  is_deleted BOOLEAN DEFAULT false,
  square_updated_at TIMESTAMP NOT NULL,
  last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Admin control fields
  is_featured BOOLEAN DEFAULT false,
  featured_order INTEGER,
  is_visible BOOLEAN DEFAULT true,
  admin_notes TEXT,
  custom_name VARCHAR(255), -- Override Square name if needed
  custom_description TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE UNIQUE INDEX IF NOT EXISTS idx_square_categories_square_id ON square_categories(square_id);
CREATE INDEX IF NOT EXISTS idx_square_categories_featured ON square_categories(is_featured, featured_order);
CREATE INDEX IF NOT EXISTS idx_square_categories_visibility ON square_categories(is_visible, is_deleted);
CREATE INDEX IF NOT EXISTS idx_square_categories_parent ON square_categories(square_parent_category_id);

-- Create trigger to update updated_at timestamp
CREATE TRIGGER update_square_categories_updated_at BEFORE UPDATE
ON square_categories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add foreign key constraint for self-referencing parent categories
ALTER TABLE square_categories 
ADD CONSTRAINT fk_square_categories_parent 
FOREIGN KEY (square_parent_category_id) 
REFERENCES square_categories(square_id) ON DELETE SET NULL;