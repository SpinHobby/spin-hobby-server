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

class SeedRunner {
  constructor() {
    this.client = new Client(dbConfig);
    this.seedsDir = path.join(__dirname, "seeds");
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

  async ensureSeedsTable() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS seeds (
        id SERIAL PRIMARY KEY,
        seed_name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await this.client.query(createTableSQL);
  }

  async getExecutedSeeds() {
    try {
      const result = await this.client.query(
        "SELECT seed_name FROM seeds ORDER BY executed_at"
      );
      return result.rows.map((row) => row.seed_name);
    } catch (error) {
      // If seeds table doesn't exist, return empty array
      return [];
    }
  }

  async getSeedFiles() {
    if (!fs.existsSync(this.seedsDir)) {
      console.log("📁 Creating seeds directory...");
      fs.mkdirSync(this.seedsDir, { recursive: true });
      return [];
    }

    const files = fs
      .readdirSync(this.seedsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    return files;
  }

  async executeSeed(filename) {
    const filepath = path.join(this.seedsDir, filename);
    const sql = fs.readFileSync(filepath, "utf8");

    console.log(`🌱 Executing seed: ${filename}`);

    try {
      // Begin transaction
      await this.client.query("BEGIN");

      // Execute the seed file
      await this.client.query(sql);

      // Record seed execution
      await this.client.query(
        "INSERT INTO seeds (seed_name) VALUES ($1) ON CONFLICT (seed_name) DO NOTHING",
        [filename]
      );

      // Commit transaction
      await this.client.query("COMMIT");

      console.log(`✅ Seed completed: ${filename}`);
    } catch (error) {
      // Rollback on error
      await this.client.query("ROLLBACK");
      console.error(`❌ Seed failed: ${filename}`);
      console.error("Error details:", error.message);
      throw error;
    }
  }

  async runSeeds(force = false) {
    console.log("🌱 Starting database seeding...");

    await this.ensureSeedsTable();

    const seedFiles = await this.getSeedFiles();
    const executedSeeds = force ? [] : await this.getExecutedSeeds();

    const pendingSeeds = seedFiles.filter(
      (file) => !executedSeeds.includes(file)
    );

    if (pendingSeeds.length === 0) {
      if (force) {
        console.log("🔄 Force mode: Re-running all seeds...");
        for (const seedFile of seedFiles) {
          await this.executeSeed(seedFile);
        }
      } else {
        console.log("✨ No pending seeds found. Database is up to date!");
        return;
      }
    } else {
      console.log(`📋 Found ${pendingSeeds.length} pending seed(s):`);
      pendingSeeds.forEach((seed) => console.log(`   - ${seed}`));

      for (const seedFile of pendingSeeds) {
        await this.executeSeed(seedFile);
      }
    }

    console.log("🎉 All seeds completed successfully!");
  }

  async clearSeeds() {
    console.log("🗑️ Clearing all seed data...");

    try {
      // Clear in reverse dependency order
      await this.client.query(
        "DELETE FROM product_categories WHERE product_square_id LIKE 'PROD_%'"
      );
      await this.client.query(
        "DELETE FROM square_products WHERE square_id LIKE 'PROD_%'"
      );
      await this.client.query(
        "DELETE FROM square_categories WHERE square_id LIKE 'CAT_%'"
      );
      await this.client.query("DELETE FROM seeds");

      console.log("✅ All seed data cleared");
    } catch (error) {
      console.error("❌ Failed to clear seed data:", error.message);
      throw error;
    }
  }

  async getSeedStatus() {
    const seedFiles = await this.getSeedFiles();
    const executedSeeds = await this.getExecutedSeeds();

    console.log("\n📊 Seed Status:");
    console.log("═".repeat(50));

    if (seedFiles.length === 0) {
      console.log("📁 No seed files found");
      return;
    }

    seedFiles.forEach((file) => {
      const status = executedSeeds.includes(file)
        ? "✅ Executed"
        : "⏳ Pending";
      console.log(`${status} ${file}`);
    });

    console.log("═".repeat(50));
    console.log(
      `📋 Total: ${seedFiles.length} seeds, ${executedSeeds.length} executed`
    );

    // Show data counts
    try {
      const categoryCount = await this.client.query(
        "SELECT COUNT(*) FROM square_categories WHERE square_id LIKE 'CAT_%'"
      );
      const productCount = await this.client.query(
        "SELECT COUNT(*) FROM square_products WHERE square_id LIKE 'PROD_%'"
      );
      const relationshipCount = await this.client.query(
        "SELECT COUNT(*) FROM product_categories WHERE product_square_id LIKE 'PROD_%'"
      );

      console.log(`\n📊 Database Contents:`);
      console.log(`   Categories: ${categoryCount.rows[0].count}`);
      console.log(`   Products: ${productCount.rows[0].count}`);
      console.log(`   Relationships: ${relationshipCount.rows[0].count}`);
    } catch (error) {
      console.log("   (Unable to get data counts)");
    }
  }
}

// CLI Interface
async function main() {
  const command = process.argv[2];
  const seedRunner = new SeedRunner();

  try {
    await seedRunner.connect();

    switch (command) {
      case "status":
        await seedRunner.getSeedStatus();
        break;

      case "clear":
        if (process.env.NODE_ENV === "production") {
          console.log("❌ Cannot clear seeds in production environment");
          process.exit(1);
        }
        await seedRunner.clearSeeds();
        break;

      case "force":
        console.log("🔄 Force mode: Re-running all seeds...");
        await seedRunner.runSeeds(true);
        break;

      default:
        await seedRunner.runSeeds();
        break;
    }
  } catch (error) {
    console.error("💥 Seeding process failed:", error.message);
    process.exit(1);
  } finally {
    await seedRunner.disconnect();
  }
}

// Help text
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
🌱 Database Seeder

Usage:
  node db/seed.cjs         - Run pending seeds
  node db/seed.cjs status  - Show seed status
  node db/seed.cjs force   - Re-run all seeds (overwrite existing)
  node db/seed.cjs clear   - Clear all seed data (dev only)

Options:
  --help, -h              - Show this help

Examples:
  node db/seed.cjs                    # Run all pending seeds
  node db/seed.cjs status             # Check what's been seeded
  node db/seed.cjs force              # Re-seed everything
  NODE_ENV=development node db/seed.cjs clear  # Clear seed data

Environment:
  Requires same .env variables as migrations:
  - DATABASE_URL (for hosted DB) OR
  - DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD (for local)
`);
  process.exit(0);
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { SeedRunner };
