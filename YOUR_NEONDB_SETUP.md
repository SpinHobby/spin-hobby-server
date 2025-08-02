# 🎯 Your NeonDB Setup - Two Options

I see you have a NeonDB connection string! Here are two ways to set it up:

## 🔧 **Option 1: Use Individual Credentials (Recommended)**

**Create your `.env` file with individual credentials:**

```bash
# NeonDB Configuration (extracted from your connection string)
DB_HOST=ep-wild-rice-afvbqvkc-pooler.c-2.us-west-2.aws.neon.tech
DB_PORT=5432
DB_NAME=neondb
DB_USER=neondb_owner
DB_PASSWORD=npg_FDrZ6fijTJP1

# Express Server Configuration
EXPRESS_PORT=8001
NODE_ENV=development

# JWT Configuration (GENERATE THIS!)
JWT_SECRET=your_secure_jwt_secret_here

# Square API Configuration (add later)
SQUARE_APPLICATION_ID=your_square_application_id
SQUARE_APPLICATION_SECRET=your_square_application_secret
SQUARE_ACCESS_TOKEN=your_square_access_token
SQUARE_ENVIRONMENT=sandbox
```

## 🌟 **Option 2: Use Full Connection String**

**Alternatively, use the full connection string:**

```bash
# NeonDB Connection String (full URL)
DATABASE_URL=postgresql://neondb_owner:npg_FDrZ6fijTJP1@ep-wild-rice-afvbqvkc-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require

# Express Server Configuration
EXPRESS_PORT=8001
NODE_ENV=development

# JWT Configuration (GENERATE THIS!)
JWT_SECRET=your_secure_jwt_secret_here

# Square API Configuration (add later)
SQUARE_APPLICATION_ID=your_square_application_id
SQUARE_APPLICATION_SECRET=your_square_application_secret
SQUARE_ACCESS_TOKEN=your_square_access_token
SQUARE_ENVIRONMENT=sandbox
```

## 🔐 **Generate Your JWT Secret**

Run this command to generate a secure JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Copy the output and replace `your_secure_jwt_secret_here` with it.

## ✅ **Test Your Setup**

After creating your `.env` file (choose either option above):

```bash
# Test database connection
npm run db:test

# Should show something like:
# 🔌 Testing database connection...
# 🌟 Using DATABASE_URL connection string  (if using Option 2)
# 📍 Host: ep-wild-rice-afvbqvkc-pooler.c-2.us-west-2.aws.neon.tech
# ✅ Database connection successful!
```

## 🚀 **Run Migrations**

Once the connection test works:

```bash
# Create all Square integration tables
npm run migrate:reset

# Check status
npm run migrate:status

# Start your anime store server
npm run dev
```

## 🎌 **Ready for Square Integration!**

Your NeonDB database will have these tables ready for your anime merchandise store:

- ✅ **`square_merchants`** - Store Square OAuth tokens
- ✅ **`square_categories`** - Anime categories with admin controls
- ✅ **`square_products`** - Anime figures/merchandise with featured controls
- ✅ **`square_sync_status`** - Track Square sync operations

Choose whichever option feels easier for you! Both will work perfectly. 🎯✨
