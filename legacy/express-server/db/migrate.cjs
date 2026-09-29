#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
require("dotenv").config();

// Database connection configuration
const dbConfig = process.env.DATABASE_URL
  ? // Use full connection string if provided
    {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    }
  : // Use individual credentials
    {
      host: process.env.DB_HOST || "localhost",
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || "spin_hobby",
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_HOST?.includes(".neon.tech")
        ? { rejectUnauthorized: false }
        : false,
    };

class MigrationRunner {
  constructor() {
    this.client = new Client(dbConfig);
    this.migrationsDir = path.join(__dirname, "migrations");
  }

  async connect() {
    try {
      if (process.env.DATABASE_URL) {
        console.log("🌟 Connecting using DATABASE_URL...");
      } else if (dbConfig.host?.includes(".neon.tech")) {
        console.log("🌟 Connecting to NeonDB...");
      }
      await this.client.connect();
      console.log("✅ Connected to database");
    } catch (error) {
      console.error("❌ Database connection failed:", error.message);
      if (process.env.DATABASE_URL) {
        console.error("💡 Check your DATABASE_URL connection string");
      } else {
        console.error(
          "💡 Make sure your NeonDB credentials are correct in .env file"
        );
      }
      process.exit(1);
    }
  }

  async disconnect() {
    await this.client.end();
    console.log("🔌 Disconnected from database");
  }

  async ensureMigrationsTable() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        migration_name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await this.client.query(createTableSQL);
  }

  async getExecutedMigrations() {
    try {
      const result = await this.client.query(
        "SELECT migration_name FROM migrations ORDER BY executed_at"
      );
      return result.rows.map((row) => row.migration_name);
    } catch (error) {
      // If migrations table doesn't exist, return empty array
      return [];
    }
  }

  async getMigrationFiles() {
    const files = fs
      .readdirSync(this.migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    return files;
  }

  async executeMigration(filename) {
    const filepath = path.join(this.migrationsDir, filename);
    const sql = fs.readFileSync(filepath, "utf8");

    console.log(`📝 Executing migration: ${filename}`);

    try {
      // Begin transaction
      await this.client.query("BEGIN");

      // Execute migration SQL
      await this.client.query(sql);

      // Record migration as executed
      await this.client.query(
        "INSERT INTO migrations (migration_name) VALUES ($1)",
        [filename]
      );

      // Commit transaction
      await this.client.query("COMMIT");

      console.log(`✅ Migration completed: ${filename}`);
    } catch (error) {
      // Rollback transaction on error
      await this.client.query("ROLLBACK");
      console.error(`❌ Migration failed: ${filename}`);
      console.error("Error:", error.message);
      throw error;
    }
  }

  async runMigrations() {
    console.log("🚀 Starting database migrations...\n");

    await this.ensureMigrationsTable();

    const executedMigrations = await this.getExecutedMigrations();
    const allMigrations = await this.getMigrationFiles();

    const pendingMigrations = allMigrations.filter(
      (migration) => !executedMigrations.includes(migration)
    );

    if (pendingMigrations.length === 0) {
      console.log("✨ No pending migrations found. Database is up to date!");
      return;
    }

    console.log(`📋 Found ${pendingMigrations.length} pending migration(s):`);
    pendingMigrations.forEach((migration) => console.log(`   - ${migration}`));
    console.log("");

    for (const migration of pendingMigrations) {
      await this.executeMigration(migration);
    }

    console.log("\n🎉 All migrations completed successfully!");
  }

  async resetDatabase() {
    console.log("⚠️  RESETTING DATABASE - This will DROP ALL TABLES!");
    console.log("💀 This action is IRREVERSIBLE!\n");

    try {
      // Drop all Square-related tables and types
      const dropSQL = `
        -- Drop tables in reverse dependency order
        DROP TABLE IF EXISTS square_sync_status CASCADE;
        DROP TABLE IF EXISTS square_products CASCADE;
        DROP TABLE IF EXISTS square_categories CASCADE;
        DROP TABLE IF EXISTS square_merchants CASCADE;
        DROP TABLE IF EXISTS migrations CASCADE;
        
        -- Drop custom types
        DROP TYPE IF EXISTS sync_type CASCADE;
        DROP TYPE IF EXISTS sync_status CASCADE;
        
        -- Drop functions
        DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
        
        -- Drop any remaining sequences
        DROP SEQUENCE IF EXISTS square_merchants_id_seq CASCADE;
        DROP SEQUENCE IF EXISTS square_categories_id_seq CASCADE;
        DROP SEQUENCE IF EXISTS square_products_id_seq CASCADE;
        DROP SEQUENCE IF EXISTS square_sync_status_id_seq CASCADE;
        DROP SEQUENCE IF EXISTS migrations_id_seq CASCADE;
      `;

      await this.client.query(dropSQL);
      console.log("🗑️  Dropped all existing tables and types");

      // Run all migrations fresh
      await this.runMigrations();
    } catch (error) {
      console.error("❌ Reset failed:", error.message);
      throw error;
    }
  }

  async showStatus() {
    await this.ensureMigrationsTable();

    const executedMigrations = await this.getExecutedMigrations();
    const allMigrations = await this.getMigrationFiles();

    console.log("📊 Migration Status:\n");

    allMigrations.forEach((migration) => {
      const isExecuted = executedMigrations.includes(migration);
      const status = isExecuted ? "✅ EXECUTED" : "⏳ PENDING";
      console.log(`${status} - ${migration}`);
    });

    const pendingCount = allMigrations.length - executedMigrations.length;

    console.log(`\n📈 Summary:`);
    console.log(`   Total migrations: ${allMigrations.length}`);
    console.log(`   Executed: ${executedMigrations.length}`);
    console.log(`   Pending: ${pendingCount}`);
  }
}

async function main() {
  const command = process.argv[2] || "migrate";
  const runner = new MigrationRunner();

  try {
    await runner.connect();

    switch (command) {
      case "migrate":
      case "up":
        await runner.runMigrations();
        break;

      case "reset":
        await runner.resetDatabase();
        break;

      case "status":
        await runner.showStatus();
        break;

      default:
        console.log("Usage:");
        console.log("  node db/migrate.cjs migrate  - Run pending migrations");
        console.log(
          "  node db/migrate.cjs reset    - Reset database and run all migrations"
        );
        console.log("  node db/migrate.cjs status   - Show migration status");
        process.exit(1);
    }
  } catch (error) {
    console.error("💥 Migration runner failed:", error.message);
    process.exit(1);
  } finally {
    await runner.disconnect();
  }
}

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Run the migration runner
if (require.main === module) {
  main();
}

module.exports = { MigrationRunner };
