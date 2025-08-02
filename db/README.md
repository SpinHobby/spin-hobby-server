# Database Migrations

This directory contains database migrations for the Spin Hobby Square integration.

## Quick Start

### 1. Set up your database connection

Make sure your `.env` file has the database configuration:

```bash
DB_HOST=localhost
DB_PORT=5432
DB_NAME=spin_hobby
DB_USER=your_db_user
DB_PASSWORD=your_db_password
```

### 2. Run migrations

```bash
# Run all pending migrations
npm run migrate

# OR reset database and run all migrations fresh
npm run migrate:reset

# Check migration status
npm run migrate:status
```

## Available Commands

| Command                  | Description                                             |
| ------------------------ | ------------------------------------------------------- |
| `npm run migrate`        | Run all pending migrations                              |
| `npm run migrate:reset`  | **⚠️ DANGER:** Drop all tables and run fresh migrations |
| `npm run migrate:status` | Show which migrations have been executed                |
| `npm run db:setup`       | Alias for `migrate:reset` - complete fresh setup        |

## Migration Files

Migrations are executed in alphabetical order:

1. **000_create_migrations_table.sql** - Creates migration tracking table
2. **001_create_square_merchants.sql** - Square merchant authentication data
3. **002_create_square_categories.sql** - Square categories with admin controls
4. **003_create_square_products.sql** - Square products with admin controls
5. **004_create_square_sync_status.sql** - Sync operation tracking

## Database Schema Overview

### Core Tables

- **`square_merchants`** - Stores Square merchant OAuth tokens and settings
- **`square_categories`** - Square categories with admin visibility controls
- **`square_products`** - Square products with featured/visibility controls
- **`square_sync_status`** - Tracks sync operations between Square and local DB

### Admin Control Features

Both products and categories have admin control fields:

- `is_featured` - Whether to show on homepage
- `featured_order` - Display order for featured items
- `is_visible` - Whether item is visible to customers
- `custom_name` / `custom_description` - Override Square data
- `admin_notes` - Internal notes for admins

## Migration Safety

### ⚠️ Important Notes

- **NEVER run `migrate:reset` in production** - it drops all data!
- Migrations are atomic - if one fails, all changes are rolled back
- Always backup your database before running migrations in production
- The migration tracker prevents running the same migration twice

### Safe Production Workflow

```bash
# 1. Check current status
npm run migrate:status

# 2. Run only new migrations (safe)
npm run migrate

# 3. Verify everything is working
npm run migrate:status
```

## Development Workflow

### For Fresh Development Setup

```bash
# 1. Set up database and run all migrations fresh
npm run db:setup

# 2. Start your development server
npm run dev
```

### For Adding New Migrations

1. Create a new migration file: `005_your_migration_name.sql`
2. Write your SQL migration
3. Run `npm run migrate` to execute it
4. Test thoroughly before committing

### Example Migration File

```sql
-- Migration: Add new field to square_products
-- Description of what this migration does

ALTER TABLE square_products
ADD COLUMN new_field VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_square_products_new_field
ON square_products(new_field);
```

## Troubleshooting

### Common Issues

1. **Connection refused**

   - Check your PostgreSQL server is running
   - Verify DB_HOST, DB_PORT in .env file

2. **Database does not exist**

   - Create the database: `createdb spin_hobby`
   - Or update DB_NAME in .env to existing database

3. **Permission denied**

   - Check DB_USER has permissions on the database
   - Verify DB_PASSWORD is correct

4. **Migration failed**
   - Check the error message in the console
   - Failed migrations are automatically rolled back
   - Fix the SQL and run `npm run migrate` again

### Debug Mode

For more detailed output, set environment variable:

```bash
NODE_ENV=development npm run migrate
```

## Backup & Recovery

### Create Backup

```bash
pg_dump -h localhost -U your_user spin_hobby > backup.sql
```

### Restore Backup

```bash
psql -h localhost -U your_user spin_hobby < backup.sql
```

## File Structure

```
db/
├── README.md                       # This file
├── migrate.cjs                     # Migration runner script (CommonJS)
├── test-connection.cjs             # Database connection tester (CommonJS)
├── schema.sql                      # Legacy schema (mostly comments)
├── ENV_SETUP.md                    # Environment setup guide
└── migrations/
    ├── 000_create_migrations_table.sql
    ├── 001_create_square_merchants.sql
    ├── 002_create_square_categories.sql
    ├── 003_create_square_products.sql
    └── 004_create_square_sync_status.sql
```
