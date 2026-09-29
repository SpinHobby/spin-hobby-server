-- Seed: Comprehensive Anime Categories
-- This file seeds the square_categories table with realistic anime store categories

-- Clear existing seed data (optional - remove if you want to preserve data)
-- DELETE FROM square_categories WHERE square_id LIKE 'CAT_%';

-- Main Categories
INSERT INTO square_categories (
  square_id, square_version, name, parent_category_id, square_parent_category_id, 
  is_deleted, square_updated_at, is_featured, featured_order, is_visible, 
  custom_name, custom_description, created_at, updated_at
) VALUES 

-- Main Categories
('CAT_FIGURES_MAIN', 1, 'Figures & Collectibles', NULL, NULL, false, NOW(), true, 1, true, 
 NULL, 'Discover our premium collection of anime figures and collectibles from your favorite series!', NOW(), NOW()),

('CAT_APPAREL_MAIN', 1, 'Anime Apparel', NULL, NULL, false, NOW(), true, 2, true, 
 NULL, 'Show your anime love with our exclusive apparel collection!', NOW(), NOW()),

('CAT_ACCESSORIES_MAIN', 1, 'Accessories & Lifestyle', NULL, NULL, false, NOW(), true, 3, true, 
 NULL, 'Add anime magic to your everyday life!', NOW(), NOW()),

('CAT_PLUSHIES_MAIN', 1, 'Plushies & Soft Goods', NULL, NULL, false, NOW(), true, 4, true, 
 NULL, 'Cute and cuddly anime plushies for every fan!', NOW(), NOW()),

('CAT_GAMING_MAIN', 1, 'Gaming & Tech', NULL, NULL, false, NOW(), false, NULL, true, 
 NULL, 'Anime-themed gaming accessories and tech gear', NOW(), NOW()),

-- Sub-categories for Figures
('CAT_SCALE_FIGURES', 1, 'Scale Figures', 'CAT_FIGURES_MAIN', 'CAT_FIGURES_MAIN', false, NOW(), false, NULL, true, 
 NULL, 'High-quality scale figures with incredible detail', NOW(), NOW()),

('CAT_NENDOROIDS', 1, 'Nendoroids', 'CAT_FIGURES_MAIN', 'CAT_FIGURES_MAIN', false, NOW(), false, NULL, true, 
 NULL, 'Adorable chibi-style figures with swappable parts', NOW(), NOW()),

('CAT_FIGMAS', 1, 'Figma Action Figures', 'CAT_FIGURES_MAIN', 'CAT_FIGURES_MAIN', false, NOW(), false, NULL, true, 
 NULL, 'Highly articulated action figures for posing', NOW(), NOW()),

('CAT_PRIZE_FIGURES', 1, 'Prize Figures', 'CAT_FIGURES_MAIN', 'CAT_FIGURES_MAIN', false, NOW(), false, NULL, true, 
 NULL, 'Affordable high-quality figures from crane games', NOW(), NOW()),

-- Sub-categories for Apparel
('CAT_TSHIRTS', 1, 'T-Shirts', 'CAT_APPAREL_MAIN', 'CAT_APPAREL_MAIN', false, NOW(), false, NULL, true, 
 NULL, 'Anime graphic tees and casual wear', NOW(), NOW()),

('CAT_HOODIES', 1, 'Hoodies & Sweatshirts', 'CAT_APPAREL_MAIN', 'CAT_APPAREL_MAIN', false, NOW(), false, NULL, true, 
 NULL, 'Cozy anime hoodies for every season', NOW(), NOW()),

('CAT_COSPLAY', 1, 'Cosplay & Costumes', 'CAT_APPAREL_MAIN', 'CAT_APPAREL_MAIN', false, NOW(), false, NULL, true, 
 NULL, 'Authentic cosplay outfits and accessories', NOW(), NOW()),

-- Series-specific categories (Featured)
('CAT_DEMON_SLAYER', 1, 'Demon Slayer', NULL, NULL, false, NOW(), true, 5, true, 
 'Demon Slayer Collection', 'Kimetsu no Yaiba merchandise - swords, figures, and more!', NOW(), NOW()),

('CAT_ONE_PIECE', 1, 'One Piece', NULL, NULL, false, NOW(), true, 6, true, 
 NULL, 'Pirate adventure merchandise from the Grand Line', NOW(), NOW()),

('CAT_NARUTO', 1, 'Naruto', NULL, NULL, false, NOW(), true, 7, true, 
 NULL, 'Hidden Leaf Village merchandise for all ninja fans', NOW(), NOW()),

('CAT_ATTACK_ON_TITAN', 1, 'Attack on Titan', NULL, NULL, false, NOW(), true, 8, true, 
 NULL, 'Survey Corps gear and titan-themed collectibles', NOW(), NOW()),

('CAT_MY_HERO_ACADEMIA', 1, 'My Hero Academia', NULL, NULL, false, NOW(), true, 9, true, 
 NULL, 'Hero academia merchandise for aspiring heroes', NOW(), NOW()),

('CAT_JUJUTSU_KAISEN', 1, 'Jujutsu Kaisen', NULL, NULL, false, NOW(), true, 10, true, 
 NULL, 'Cursed technique merchandise and collectibles', NOW(), NOW())

ON CONFLICT (square_id) DO UPDATE SET
  name = EXCLUDED.name,
  custom_name = EXCLUDED.custom_name,
  custom_description = EXCLUDED.custom_description,
  is_featured = EXCLUDED.is_featured,
  featured_order = EXCLUDED.featured_order,
  is_visible = EXCLUDED.is_visible,
  updated_at = NOW();

-- Update last_synced_at for all categories
UPDATE square_categories SET last_synced_at = NOW() WHERE square_id LIKE 'CAT_%';