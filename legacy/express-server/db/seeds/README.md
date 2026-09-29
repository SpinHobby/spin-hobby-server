# 🌱 Database Seeds

This directory contains SQL seed files that populate the database with realistic anime store inventory.

## 📋 Seed Files

### `001_anime_categories.sql`

- **15+ Categories** with hierarchical structure
- **Featured categories** (Demon Slayer, One Piece, Naruto, etc.)
- **Sub-categories** (Scale Figures, Nendoroids, T-Shirts, etc.)
- **Admin controls** for visibility and featured status

### `002_anime_products.sql`

- **15+ Realistic products** with Square catalog structure
- **Multiple variations** (sizes, editions, colors)
- **Real pricing** ($24.99 - $399.99 range)
- **Series metadata** (character, tags, admin notes)
- **Featured/preorder/new arrival** flags

### `003_product_category_relationships.sql`

- **Many-to-many relationships** between products and categories
- **Primary category** designation
- **Multiple category** assignments per product

## 🚀 Usage

### Run All Seeds

```bash
node db/seed.cjs
```

### Check Status

```bash
node db/seed.cjs status
```

### Force Re-seed (Development)

```bash
node db/seed.cjs force
```

### Clear All Seed Data (Development Only)

```bash
NODE_ENV=development node db/seed.cjs clear
```

## 📊 What Gets Seeded

### Categories (15+)

- **Main Categories**: Figures & Collectibles, Anime Apparel, Accessories & Lifestyle, Plushies & Soft Goods, Gaming & Tech
- **Figure Types**: Scale Figures, Nendoroids, Figmas, Prize Figures
- **Apparel Types**: T-Shirts, Hoodies, Cosplay & Costumes
- **Series Collections**: Demon Slayer, One Piece, Naruto, Attack on Titan, My Hero Academia, Jujutsu Kaisen

### Products (15+)

| Product                         | Series           | Price   | Type         |
| ------------------------------- | ---------------- | ------- | ------------ |
| Tanjiro Kamado Scale Figure 1/8 | Demon Slayer     | $189.99 | Scale Figure |
| Nezuko Kamado Nendoroid         | Demon Slayer     | $54.99  | Nendoroid    |
| Luffy Gear 5 Figure             | One Piece        | $299.99 | Scale Figure |
| Itachi Susanoo Figure           | Naruto           | $399.99 | Scale Figure |
| Deku Figma Action Figure        | My Hero Academia | $74.99  | Figma        |
| Gojo Nendoroid                  | Jujutsu Kaisen   | $59.99  | Nendoroid    |
| Survey Corps Cloak              | Attack on Titan  | $79.99  | Cosplay      |
| Demon Slayer Corps T-Shirt      | Demon Slayer     | $24.99  | Apparel      |
| Straw Hat Pirates Hoodie        | One Piece        | $49.99  | Apparel      |
| _...and more!_                  |                  |         |              |

### Features

- ✅ **15+ Featured products** for homepage
- ✅ **10+ Featured categories** for navigation
- ✅ **Multiple variations** per product (sizes, editions)
- ✅ **Realistic pricing** based on actual anime merchandise
- ✅ **Series/character metadata** for filtering
- ✅ **Admin-ready** with custom descriptions and notes
- ✅ **Product images** from actual figure manufacturers
- ✅ **Preorder items** and new arrivals
- ✅ **Many-to-many relationships** (products in multiple categories)

## 🔄 How It Works

1. **Categories First**: Creates the category hierarchy
2. **Products Second**: Adds all products with Square-compatible JSON
3. **Relationships Last**: Links products to multiple categories

## 🎯 Integration

After seeding, your APIs will return real data:

```bash
# Test the seeded data
curl http://localhost:8001/api/v1/categories        # 15+ categories
curl http://localhost:8001/api/v1/products/featured # 9 featured products
curl http://localhost:8001/api/v1/products/new-arrivals # New items
curl http://localhost:8001/api/v1/admin/categories  # Admin management
```

## 🎨 Admin Panel Ready

All seeded data includes admin controls:

- **Featured status** and ordering
- **Visibility** controls
- **Custom names** and descriptions
- **Admin notes** with metadata
- **Product-category** assignment tools

## 📝 Notes

- **Idempotent**: Safe to run multiple times (uses `ON CONFLICT`)
- **Production Safe**: Won't run `clear` command in production
- **Real Data**: Based on actual anime merchandise and Square catalog structure
- **TypeScript Compatible**: JSON fields work with your TypeScript models
