-- Create accounts and users tables for authentication

-- Create EMAILTYPE domain if it doesn't exist
DO $$ BEGIN
    CREATE DOMAIN EMAILTYPE AS TEXT CHECK (VALUE ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create USERTYPE enum if it doesn't exist  
DO $$ BEGIN
    CREATE TYPE USERTYPE AS ENUM ('basic', 'premium', 'business', 'beta');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create accounts table
CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    fname VARCHAR(100) NOT NULL,
    lname VARCHAR(100) NOT NULL,
    email EMAILTYPE UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    plan USERTYPE DEFAULT 'basic',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create users table (for compatibility with existing code)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    fname VARCHAR(100) NOT NULL,
    lname VARCHAR(100) NOT NULL,
    email EMAILTYPE UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    plan USERTYPE DEFAULT 'basic',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);
CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Add triggers for updated_at (function should already exist from previous migration)
CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE
ON accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE  
ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();