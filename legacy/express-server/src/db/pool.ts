import { Pool } from "pg";

// Same connection pattern as db/migrate.cjs (the one proven-working path
// against the live NeonDB) - DATABASE_URL only, no PORT-branching, no
// Sequelize. Used by the homepage admin routes; nothing else in this
// backend touches Postgres.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
