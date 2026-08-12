-- Customer identity for OAuth-only login (Google/Apple/Discord). Deliberately
-- separate from accounts/users (006) - those are internal staff/test
-- fixtures built around passwords, which don't fit an OAuth-only model.

CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    email EMAILTYPE UNIQUE NOT NULL,
    email_verified BOOLEAN NOT NULL DEFAULT false,
    fname VARCHAR(100),
    lname VARCHAR(100),
    avatar_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
    CREATE TYPE OAUTH_PROVIDER AS ENUM ('google', 'apple', 'discord');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- One row per (provider, provider_user_id). A customer can link more than
-- one provider to the same email-verified account over time.
CREATE TABLE IF NOT EXISTS customer_oauth_identities (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    provider OAUTH_PROVIDER NOT NULL,
    provider_user_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_oauth_customer_id ON customer_oauth_identities(customer_id);

-- Opaque server-side sessions (httpOnly cookie carries only this id) rather
-- than a self-contained JWT - keeps revocation trivial (just delete/mark the
-- row) and nothing meaningful is exposed if the cookie value leaks alone.
CREATE TABLE IF NOT EXISTS customer_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    user_agent TEXT,
    revoked_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer_id ON customer_sessions(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_expires_at ON customer_sessions(expires_at);

CREATE TRIGGER update_customers_updated_at BEFORE UPDATE
ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
