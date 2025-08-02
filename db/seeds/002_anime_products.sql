-- Seed: Comprehensive Anime Products
-- This file seeds the square_products table with realistic anime store inventory

-- Clear existing seed data (optional - remove if you want to preserve data)
-- DELETE FROM square_products WHERE square_id LIKE 'PROD_%';

-- Insert comprehensive anime product inventory
INSERT INTO square_products (
  square_id, square_version, name, description, category_id, square_category_id,
  images, variations, is_deleted, square_updated_at, is_featured, featured_order,
  is_visible, admin_notes, custom_description, created_at, updated_at
) VALUES 

-- DEMON SLAYER PRODUCTS
('PROD_DS_TANJIRO_SCALE', 1, 'Tanjiro Kamado Scale Figure 1/8',
 'Premium 1/8 scale figure of Tanjiro Kamado in his iconic demon slayer uniform. Highly detailed with authentic coloring and dynamic pose.',
 'CAT_SCALE_FIGURES', 'CAT_SCALE_FIGURES',
 '[{"url": "https://images.goodsmile.info/cgm/images/product/20200730/9943/78032/large/4562ee8e3d6c24e8c7d7a8b64c8e9a6f.jpg"}, {"url": "https://images.goodsmile.info/cgm/images/product/20200730/9943/78033/large/c8f7d6a5b4e3e2d1c0b9a8c7b6a5d4e3.jpg"}]',
 '[{"id": "VAR_DS_TANJIRO_STANDARD", "name": "Standard Edition", "priceMoney": {"amount": 18999, "currency": "USD"}, "sku": "DS-TNJ-001"}, {"id": "VAR_DS_TANJIRO_DX", "name": "Deluxe Edition with Effects", "priceMoney": {"amount": 24999, "currency": "USD"}, "sku": "DS-TNJ-001-DX"}]',
 false, NOW(), true, 1, true,
 'Series: Demon Slayer | Character: Tanjiro Kamado | Tags: premium, scale-figure, male-character, protagonist',
 'Premium 1/8 scale figure of Tanjiro Kamado in his iconic demon slayer uniform. Highly detailed with authentic coloring and dynamic pose.\n\nSeries: Demon Slayer\nCharacter: Tanjiro Kamado\nTags: premium, scale-figure, male-character, protagonist',
 NOW(), NOW()),

('PROD_DS_NEZUKO_NENDOROID', 1, 'Nezuko Kamado Nendoroid',
 'Adorable Nendoroid of Nezuko Kamado with multiple face plates and accessories including bamboo muzzle and demon form parts.',
 'CAT_NENDOROIDS', 'CAT_NENDOROIDS',
 '[{"url": "https://images.goodsmile.info/cgm/images/product/20210225/10855/85521/large/nendoroid-nezuko-kamado.jpg"}]',
 '[{"id": "VAR_DS_NEZUKO_NENDO", "name": "Standard Nendoroid", "priceMoney": {"amount": 5499, "currency": "USD"}, "sku": "DS-NEZ-NENDO-001"}]',
 false, NOW(), true, 2, true,
 'Series: Demon Slayer | Character: Nezuko Kamado | Tags: nendoroid, cute, female-character, demon',
 'Adorable Nendoroid of Nezuko Kamado with multiple face plates and accessories including bamboo muzzle and demon form parts.\n\nSeries: Demon Slayer\nCharacter: Nezuko Kamado\nTags: nendoroid, cute, female-character, demon',
 NOW(), NOW()),

('PROD_DS_CORPS_TSHIRT', 1, 'Demon Slayer Corps T-Shirt',
 'Official Demon Slayer Corps uniform-inspired t-shirt with authentic emblem design. Premium cotton blend.',
 'CAT_TSHIRTS', 'CAT_TSHIRTS',
 '[{"url": "https://m.media-amazon.com/images/I/71jK8qF2KNL._AC_UX679_.jpg"}]',
 '[{"id": "VAR_DS_SHIRT_S", "name": "Size S", "priceMoney": {"amount": 2499, "currency": "USD"}, "sku": "DS-SHIRT-S"}, {"id": "VAR_DS_SHIRT_M", "name": "Size M", "priceMoney": {"amount": 2499, "currency": "USD"}, "sku": "DS-SHIRT-M"}, {"id": "VAR_DS_SHIRT_L", "name": "Size L", "priceMoney": {"amount": 2499, "currency": "USD"}, "sku": "DS-SHIRT-L"}, {"id": "VAR_DS_SHIRT_XL", "name": "Size XL", "priceMoney": {"amount": 2699, "currency": "USD"}, "sku": "DS-SHIRT-XL"}]',
 false, NOW(), false, NULL, true,
 'Series: Demon Slayer | Tags: apparel, official, unisex, cotton',
 'Official Demon Slayer Corps uniform-inspired t-shirt with authentic emblem design. Premium cotton blend.\n\nSeries: Demon Slayer\nTags: apparel, official, unisex, cotton',
 NOW(), NOW()),

-- ONE PIECE PRODUCTS
('PROD_OP_LUFFY_GEAR5_FIGURE', 1, 'Monkey D. Luffy Gear 5 Figure',
 'Epic Gear 5 Luffy figure capturing his awakened Devil Fruit powers. Dynamic sculpting with special translucent effects.',
 'CAT_SCALE_FIGURES', 'CAT_SCALE_FIGURES',
 '[{"url": "https://cdn.animenewsnetwork.com/thumbnails/max1000x1500/cms/news.6/192589/luffy-gear-5-figure.jpg"}]',
 '[{"id": "VAR_OP_LUFFY_G5", "name": "Gear 5 Edition", "priceMoney": {"amount": 29999, "currency": "USD"}, "sku": "OP-LUF-G5-001"}]',
 false, NOW(), true, 3, true,
 'Series: One Piece | Character: Monkey D. Luffy | Tags: premium, gear-5, special-edition, protagonist | NEW ARRIVAL',
 'Epic Gear 5 Luffy figure capturing his awakened Devil Fruit powers. Dynamic sculpting with special translucent effects.\n\nSeries: One Piece\nCharacter: Monkey D. Luffy\nTags: premium, gear-5, special-edition, protagonist',
 NOW(), NOW()),

('PROD_OP_ZORO_SWORDS_SET', 1, 'Roronoa Zoro Three Sword Style Set',
 'Replica set of Zoro''s three swords: Wado Ichimonji, Sandai Kitetsu, and Shusui. Display-ready with wooden stand.',
 'CAT_ACCESSORIES_MAIN', 'CAT_ACCESSORIES_MAIN',
 '[{"url": "https://m.media-amazon.com/images/I/71sK9QZdX8L._AC_SX679_.jpg"}]',
 '[{"id": "VAR_OP_ZORO_SWORDS", "name": "Three Sword Set", "priceMoney": {"amount": 14999, "currency": "USD"}, "sku": "OP-ZOR-SWD-001"}]',
 false, NOW(), false, NULL, true,
 'Series: One Piece | Character: Roronoa Zoro | Tags: replica, weapons, display, collector',
 'Replica set of Zoro''s three swords: Wado Ichimonji, Sandai Kitetsu, and Shusui. Display-ready with wooden stand.\n\nSeries: One Piece\nCharacter: Roronoa Zoro\nTags: replica, weapons, display, collector',
 NOW(), NOW()),

('PROD_OP_STRAWHAT_HOODIE', 1, 'Straw Hat Pirates Hoodie',
 'Official Straw Hat Pirates crew hoodie with Jolly Roger emblem. Premium fleece interior for ultimate comfort.',
 'CAT_HOODIES', 'CAT_HOODIES',
 '[{"url": "https://m.media-amazon.com/images/I/71BQFDyBQdL._AC_UX679_.jpg"}]',
 '[{"id": "VAR_OP_HOODIE_S", "name": "Size S", "priceMoney": {"amount": 4999, "currency": "USD"}, "sku": "OP-HOOD-S"}, {"id": "VAR_OP_HOODIE_M", "name": "Size M", "priceMoney": {"amount": 4999, "currency": "USD"}, "sku": "OP-HOOD-M"}, {"id": "VAR_OP_HOODIE_L", "name": "Size L", "priceMoney": {"amount": 4999, "currency": "USD"}, "sku": "OP-HOOD-L"}, {"id": "VAR_OP_HOODIE_XL", "name": "Size XL", "priceMoney": {"amount": 5499, "currency": "USD"}, "sku": "OP-HOOD-XL"}]',
 false, NOW(), true, 4, true,
 'Series: One Piece | Tags: hoodie, crew, official, fleece',
 'Official Straw Hat Pirates crew hoodie with Jolly Roger emblem. Premium fleece interior for ultimate comfort.\n\nSeries: One Piece\nTags: hoodie, crew, official, fleece',
 NOW(), NOW()),

-- NARUTO PRODUCTS
('PROD_NARUTO_ITACHI_FIGURE', 1, 'Itachi Uchiha Susanoo Figure',
 'Magnificent figure of Itachi in his Susanoo form. Translucent orange Susanoo with incredible detail and LED base lighting.',
 'CAT_SCALE_FIGURES', 'CAT_SCALE_FIGURES',
 '[{"url": "https://cdn.shopify.com/s/files/1/0552/1401/9299/products/HTB1_1024x1024.jpg"}]',
 '[{"id": "VAR_NAR_ITACHI_SUSANOO", "name": "Susanoo Edition with LED", "priceMoney": {"amount": 39999, "currency": "USD"}, "sku": "NAR-ITA-SUS-001"}]',
 false, NOW(), true, 5, true,
 'Series: Naruto | Character: Itachi Uchiha | Tags: premium, led-effects, susanoo, villain',
 'Magnificent figure of Itachi in his Susanoo form. Translucent orange Susanoo with incredible detail and LED base lighting.\n\nSeries: Naruto\nCharacter: Itachi Uchiha\nTags: premium, led-effects, susanoo, villain',
 NOW(), NOW()),

('PROD_NARUTO_HEADBAND_SET', 1, 'Hidden Village Headband Collection',
 'Complete set of ninja headbands from all major hidden villages. Authentic metal plates with adjustable cloth bands.',
 'CAT_ACCESSORIES_MAIN', 'CAT_ACCESSORIES_MAIN',
 '[{"url": "https://m.media-amazon.com/images/I/91jKqZvvzBL._AC_SX679_.jpg"}]',
 '[{"id": "VAR_NAR_HEADBAND_SET", "name": "5-Piece Village Set", "priceMoney": {"amount": 8999, "currency": "USD"}, "sku": "NAR-HEAD-SET-001"}]',
 false, NOW(), false, NULL, true,
 'Series: Naruto | Tags: cosplay, authentic, metal, complete-set',
 'Complete set of ninja headbands from all major hidden villages. Authentic metal plates with adjustable cloth bands.\n\nSeries: Naruto\nTags: cosplay, authentic, metal, complete-set',
 NOW(), NOW()),

-- ATTACK ON TITAN PRODUCTS
('PROD_AOT_EREN_TITAN_FIGURE', 1, 'Attack Titan Eren Jaeger Figure',
 'Massive Attack Titan form figure with articulated jaw and detailed musculature. Premium sculpting captures the terror and power.',
 'CAT_SCALE_FIGURES', 'CAT_SCALE_FIGURES',
 '[{"url": "https://images.goodsmile.info/cgm/images/product/20210623/11232/89654/large/attack-titan-eren.jpg"}]',
 '[{"id": "VAR_AOT_EREN_TITAN", "name": "Attack Titan Form", "priceMoney": {"amount": 27999, "currency": "USD"}, "sku": "AOT-ERE-TIT-001"}]',
 false, NOW(), true, 6, true,
 'Series: Attack on Titan | Character: Eren Jaeger | Tags: titan-form, large-scale, detailed, protagonist',
 'Massive Attack Titan form figure with articulated jaw and detailed musculature. Premium sculpting captures the terror and power.\n\nSeries: Attack on Titan\nCharacter: Eren Jaeger\nTags: titan-form, large-scale, detailed, protagonist',
 NOW(), NOW()),

('PROD_AOT_SURVEY_CORPS_CAPE', 1, 'Survey Corps Cloak',
 'Official Survey Corps green cloak with Wings of Freedom emblem. High-quality fabric perfect for cosplay or display.',
 'CAT_COSPLAY', 'CAT_COSPLAY',
 '[{"url": "https://m.media-amazon.com/images/I/71FpZKoaKUL._AC_UX679_.jpg"}]',
 '[{"id": "VAR_AOT_CAPE_ADULT", "name": "Adult Size", "priceMoney": {"amount": 7999, "currency": "USD"}, "sku": "AOT-CAPE-A-001"}]',
 false, NOW(), false, NULL, true,
 'Series: Attack on Titan | Tags: cosplay, cloak, wings-of-freedom, official',
 'Official Survey Corps green cloak with Wings of Freedom emblem. High-quality fabric perfect for cosplay or display.\n\nSeries: Attack on Titan\nTags: cosplay, cloak, wings-of-freedom, official',
 NOW(), NOW()),

-- MY HERO ACADEMIA PRODUCTS
('PROD_MHA_DEKU_FIGMA', 1, 'Izuku Midoriya Figma Action Figure',
 'Highly articulated Figma of Deku with multiple face plates, hero costume, and One For All effect parts.',
 'CAT_FIGMAS', 'CAT_FIGMAS',
 '[{"url": "https://images.goodsmile.info/cgm/images/product/20190228/8365/62154/large/figma-izuku-midoriya.jpg"}]',
 '[{"id": "VAR_MHA_DEKU_FIGMA", "name": "Hero Costume Version", "priceMoney": {"amount": 7499, "currency": "USD"}, "sku": "MHA-DEK-FIG-001"}]',
 false, NOW(), true, 7, true,
 'Series: My Hero Academia | Character: Izuku Midoriya | Tags: figma, articulated, hero-costume, effects',
 'Highly articulated Figma of Deku with multiple face plates, hero costume, and One For All effect parts.\n\nSeries: My Hero Academia\nCharacter: Izuku Midoriya\nTags: figma, articulated, hero-costume, effects',
 NOW(), NOW()),

('PROD_MHA_ALLMIGHT_PLUSH', 1, 'All Might Plushie',
 'Adorable All Might plushie in his classic hero pose. Super soft and cuddly, perfect for fans of the Symbol of Peace.',
 'CAT_PLUSHIES_MAIN', 'CAT_PLUSHIES_MAIN',
 '[{"url": "https://cdn.shopify.com/s/files/1/2348/0623/products/all-might-plush.jpg"}]',
 '[{"id": "VAR_MHA_ALLMIGHT_PLUSH", "name": "Standard Plushie", "priceMoney": {"amount": 2999, "currency": "USD"}, "sku": "MHA-ALL-PLU-001"}]',
 false, NOW(), false, NULL, true,
 'Series: My Hero Academia | Character: All Might | Tags: plushie, soft, symbol-of-peace, hero',
 'Adorable All Might plushie in his classic hero pose. Super soft and cuddly, perfect for fans of the Symbol of Peace.\n\nSeries: My Hero Academia\nCharacter: All Might\nTags: plushie, soft, symbol-of-peace, hero',
 NOW(), NOW()),

-- JUJUTSU KAISEN PRODUCTS
('PROD_JJK_GOJO_NENDOROID', 1, 'Satoru Gojo Nendoroid',
 'Stylish Nendoroid of the strongest sorcerer Gojo with blindfold, sunglasses, and Limitless technique effect parts.',
 'CAT_NENDOROIDS', 'CAT_NENDOROIDS',
 '[{"url": "https://images.goodsmile.info/cgm/images/product/20220127/12458/95431/large/nendoroid-satoru-gojo.jpg"}]',
 '[{"id": "VAR_JJK_GOJO_NENDO", "name": "Teacher Version", "priceMoney": {"amount": 5999, "currency": "USD"}, "sku": "JJK-GOJ-NEN-001"}]',
 false, NOW(), true, 8, true,
 'Series: Jujutsu Kaisen | Character: Satoru Gojo | Tags: nendoroid, teacher, strongest, limitless | NEW ARRIVAL',
 'Stylish Nendoroid of the strongest sorcerer Gojo with blindfold, sunglasses, and Limitless technique effect parts.\n\nSeries: Jujutsu Kaisen\nCharacter: Satoru Gojo\nTags: nendoroid, teacher, strongest, limitless',
 NOW(), NOW()),

('PROD_JJK_SUKUNA_FINGER_REPLICA', 1, 'Ryomen Sukuna Finger Replica Set',
 'Authentic-looking replica of Sukuna''s cursed fingers. Set of 4 detailed resin fingers with display box.',
 'CAT_ACCESSORIES_MAIN', 'CAT_ACCESSORIES_MAIN',
 '[{"url": "https://cdn.shopify.com/s/files/1/0552/1401/9299/products/sukuna-finger-replica.jpg"}]',
 '[{"id": "VAR_JJK_SUKUNA_FINGERS", "name": "4-Piece Finger Set", "priceMoney": {"amount": 6499, "currency": "USD"}, "sku": "JJK-SUK-FIN-001"}]',
 false, NOW(), false, NULL, true,
 'Series: Jujutsu Kaisen | Character: Ryomen Sukuna | Tags: replica, cursed-object, resin, display',
 'Authentic-looking replica of Sukuna''s cursed fingers. Set of 4 detailed resin fingers with display box.\n\nSeries: Jujutsu Kaisen\nCharacter: Ryomen Sukuna\nTags: replica, cursed-object, resin, display',
 NOW(), NOW()),

-- GAMING & TECH PRODUCTS
('PROD_GAMING_ANIME_MOUSEPAD', 1, 'Anime Gaming Mousepad Collection',
 'Premium RGB gaming mousepad featuring popular anime artwork. Large size with smooth tracking surface.',
 'CAT_GAMING_MAIN', 'CAT_GAMING_MAIN',
 '[{"url": "https://m.media-amazon.com/images/I/81kKzGbqVyL._AC_SX679_.jpg"}]',
 '[{"id": "VAR_GAME_PAD_NARUTO", "name": "Naruto Design", "priceMoney": {"amount": 3999, "currency": "USD"}, "sku": "GAME-PAD-NAR-001"}, {"id": "VAR_GAME_PAD_DEMON", "name": "Demon Slayer Design", "priceMoney": {"amount": 3999, "currency": "USD"}, "sku": "GAME-PAD-DS-001"}, {"id": "VAR_GAME_PAD_ONE_PIECE", "name": "One Piece Design", "priceMoney": {"amount": 3999, "currency": "USD"}, "sku": "GAME-PAD-OP-001"}]',
 false, NOW(), false, NULL, true,
 'Series: Multi-Series | Tags: gaming, rgb, mousepad, tech',
 'Premium RGB gaming mousepad featuring popular anime artwork. Large size with smooth tracking surface.\n\nSeries: Multi-Series\nTags: gaming, rgb, mousepad, tech',
 NOW(), NOW()),

-- PREORDER ITEMS
('PROD_UPCOMING_CHAINSAW_FIGURE', 1, 'Chainsaw Man Denji Figure - Preorder',
 'Upcoming premium figure of Denji in his Chainsaw Devil form. Expected release in Q3 2024. Limited edition with special base.',
 'CAT_SCALE_FIGURES', 'CAT_SCALE_FIGURES',
 '[{"url": "https://images.goodsmile.info/cgm/images/product/20230815/13890/102547/large/chainsaw-man-denji-figure.jpg"}]',
 '[{"id": "VAR_CSM_DENJI_PREORDER", "name": "Limited Edition Preorder", "priceMoney": {"amount": 21999, "currency": "USD"}, "sku": "CSM-DEN-PRE-001"}]',
 false, NOW(), true, 9, true,
 'Series: Chainsaw Man | Character: Denji | Tags: preorder, limited-edition, chainsaw-devil, 2024 | PREORDER ITEM',
 'Upcoming premium figure of Denji in his Chainsaw Devil form. Expected release in Q3 2024. Limited edition with special base.\n\nSeries: Chainsaw Man\nCharacter: Denji\nTags: preorder, limited-edition, chainsaw-devil, 2024',
 NOW(), NOW())

ON CONFLICT (square_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  images = EXCLUDED.images,
  variations = EXCLUDED.variations,
  is_featured = EXCLUDED.is_featured,
  featured_order = EXCLUDED.featured_order,
  is_visible = EXCLUDED.is_visible,
  admin_notes = EXCLUDED.admin_notes,
  custom_description = EXCLUDED.custom_description,
  updated_at = NOW();

-- Update last_synced_at for all products
UPDATE square_products SET last_synced_at = NOW() WHERE square_id LIKE 'PROD_%';