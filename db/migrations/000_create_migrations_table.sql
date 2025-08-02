-- Migration: Create migrations tracking table
-- This table tracks which migrations have been run

CREATE TABLE IF NOT EXISTS migrations (
  id SERIAL PRIMARY KEY,
  migration_name VARCHAR(255) NOT NULL UNIQUE,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_migrations_name ON migrations(migration_name);
CREATE INDEX IF NOT EXISTS idx_migrations_executed_at ON migrations(executed_at);