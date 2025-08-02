-- Migration: Create square_merchants table
-- This stores Square merchant authentication and configuration data

CREATE TABLE IF NOT EXISTS square_merchants (
  id SERIAL PRIMARY KEY,
  merchant_id VARCHAR(255) NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMP,
  merchant_name VARCHAR(255),
  business_name VARCHAR(255),
  country VARCHAR(10),
  currency VARCHAR(3) DEFAULT 'USD',
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'revoked')),
  last_sync_at TIMESTAMP,
  
  -- Merchant settings
  auto_sync BOOLEAN DEFAULT true,
  sync_frequency INTEGER DEFAULT 60, -- minutes
  webhooks_enabled BOOLEAN DEFAULT true,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_square_merchants_merchant_id ON square_merchants(merchant_id);
CREATE INDEX IF NOT EXISTS idx_square_merchants_status ON square_merchants(status);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_square_merchants_updated_at BEFORE UPDATE
ON square_merchants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();