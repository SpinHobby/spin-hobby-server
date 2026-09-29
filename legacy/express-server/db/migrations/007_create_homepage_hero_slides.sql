-- Migration: Create homepage_hero_slides table
-- Admin-managed hero carousel content for the homepage

CREATE TABLE IF NOT EXISTS homepage_hero_slides (
  id SERIAL PRIMARY KEY,
  headline VARCHAR(255) NOT NULL,
  subheading VARCHAR(500),
  image_url TEXT, -- nullable; frontend falls back to a product photo when empty
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_homepage_hero_slides_order ON homepage_hero_slides(is_visible, sort_order);

CREATE TRIGGER update_homepage_hero_slides_updated_at BEFORE UPDATE
ON homepage_hero_slides FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
