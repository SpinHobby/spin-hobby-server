-- Migration: Create square_sync_status table
-- This tracks Square sync operations and their status

CREATE TYPE sync_type AS ENUM ('products', 'categories', 'inventory', 'full');
CREATE TYPE sync_status AS ENUM ('pending', 'in_progress', 'completed', 'failed');

CREATE TABLE IF NOT EXISTS square_sync_status (
  id SERIAL PRIMARY KEY,
  sync_type sync_type NOT NULL,
  status sync_status DEFAULT 'pending',
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  items_processed INTEGER DEFAULT 0,
  items_total INTEGER,
  error_message TEXT,
  metadata JSONB, -- JSON for additional sync info
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_square_sync_status_type_started ON square_sync_status(sync_type, started_at);
CREATE INDEX IF NOT EXISTS idx_square_sync_status_status ON square_sync_status(status);
CREATE INDEX IF NOT EXISTS idx_square_sync_status_started_at ON square_sync_status(started_at);

-- Create GIN index for metadata JSONB column
CREATE INDEX IF NOT EXISTS idx_square_sync_status_metadata ON square_sync_status USING GIN (metadata);

-- Create trigger to update updated_at timestamp
CREATE TRIGGER update_square_sync_status_updated_at BEFORE UPDATE
ON square_sync_status FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();