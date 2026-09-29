# 🗄️ Database Management Scripts

## 📋 Available Commands

### 🔄 **Full Database Reset & Setup**

```bash
npm run db:full-reset    # Reset DB + Force run all seeds (recommended)
npm run db:setup         # Reset DB + Run seeds normally
npm run db:reset         # Same as db:setup
```

### 🏗️ **Migrations Only**

```bash
npm run migrate:reset    # Drop all tables and re-run all migrations
npm run migrate          # Run pending migrations only
npm run migrate:status   # Check which migrations have been run
```

### 🌱 **Seeds Only**

```bash
npm run seed            # Run pending seeds
npm run seed:force      # Force run all seeds (overwrites data)
npm run seed:status     # Check which seeds have been run
npm run seed:clear      # Clear all seed data
```

### 🧪 **Testing & Development**

```bash
npm run db:test         # Test database connection
npm run dev             # Start development server
npm start               # Start production server
```

## 🚀 **Quick Start Workflow**

1. **Fresh setup**:

   ```bash
   npm run db:full-reset   # Resets everything + adds anime data + admin users
   npm run dev             # Start server
   ```

2. **Check status**:

   ```bash
   npm run migrate:status  # See migration status
   npm run seed:status     # See seed status
   ```

3. **Access admin panel**:
   - Server: `http://localhost:8001`
   - Frontend: `http://localhost:3000/admin`
   - **Admin Login**: `admin` / `admin123`

## 🔑 **Admin Credentials**

- **admin** / **admin123** - Full admin access
- **beta** / **admin123** - Beta tester access
- **manager** / **admin123** - Store manager access

## 📊 **Database Contents After Full Reset**

- ✅ **18 Anime Categories** (Figures, Manga, Trading Cards, etc.)
- ✅ **15 Anime Products** (with realistic Square catalog data)
- ✅ **43 Product-Category Relationships** (many-to-many)
- ✅ **3 Admin User Accounts** (for login testing)

## 🆘 **Troubleshooting**

- **Connection timeout**: Check your `DATABASE_URL` in `.env`
- **Permission denied**: Make sure database user has proper permissions
- **Foreign key errors**: Run `npm run migrate:reset` to rebuild tables
- **Seed conflicts**: Use `npm run seed:force` to overwrite existing data
