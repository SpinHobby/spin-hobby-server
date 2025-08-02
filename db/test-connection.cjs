#!/usr/bin/env node

const { Client } = require("pg");
require("dotenv").config();

async function testConnection() {
  const clientConfig = process.env.DATABASE_URL
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

  const client = new Client(clientConfig);

  try {
    console.log("🔌 Testing database connection...");

    if (process.env.DATABASE_URL) {
      console.log("🌟 Using DATABASE_URL connection string");
      // Extract host from connection string for display
      const urlMatch = process.env.DATABASE_URL.match(/@([^/]+)/);
      if (urlMatch) {
        console.log(`📍 Host: ${urlMatch[1]}`);
      }
    } else {
      console.log(
        `📍 Host: ${process.env.DB_HOST || "localhost"}:${
          process.env.DB_PORT || 5432
        }`
      );
      console.log(`🗄️  Database: ${process.env.DB_NAME || "spin_hobby"}`);
      console.log(`👤 User: ${process.env.DB_USER}`);

      if (process.env.DB_HOST?.includes(".neon.tech")) {
        console.log("🌟 Using NeonDB (SSL enabled)");
      }
    }

    await client.connect();
    console.log("✅ Database connection successful!");

    const result = await client.query("SELECT version()");
    console.log("🎯 PostgreSQL version:", result.rows[0].version);
  } catch (error) {
    console.error("❌ Database connection failed!");
    console.error("💡 Error details:", error.message);
    console.log("\n🔧 Troubleshooting tips:");

    if (process.env.DATABASE_URL) {
      console.log("   1. Check your DATABASE_URL connection string");
      console.log("   2. Make sure the connection string is complete");
      console.log("   3. Verify your NeonDB project is active");
      console.log("   4. Check if password contains special characters");
    } else if (process.env.DB_HOST?.includes(".neon.tech")) {
      console.log("   1. Check your NeonDB credentials in .env file");
      console.log("   2. Verify DB_HOST ends with .neon.tech");
      console.log("   3. Make sure DB_USER and DB_PASSWORD are correct");
      console.log("   4. Check your NeonDB project is active");
    } else {
      console.log("   1. Make sure PostgreSQL is running");
      console.log("   2. Check your .env file has correct DB credentials");
      console.log("   3. Verify the database exists: createdb spin_hobby");
      console.log("   4. Check user permissions");
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

testConnection();
