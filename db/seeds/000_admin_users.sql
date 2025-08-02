-- Admin User Accounts for Spin Hobby
-- Password: "admin123" (hashed with bcrypt)

INSERT INTO accounts (
  username, 
  fname, 
  lname, 
  email, 
  password, 
  phone, 
  plan
) VALUES 
  (
    'admin',
    'Admin',
    'User', 
    'admin@spinhobby.com',
    '$2b$10$rOzJJHzl4O8VKWvFCeFpKO5A9JvQxzGCJ5RkKp1cRlRlkY8s5KzLO', -- admin123
    '555-ADMIN',
    'business'
  ),
  (
    'beta',
    'Beta',
    'Tester',
    'beta@spinhobby.com', 
    '$2b$10$rOzJJHzl4O8VKWvFCeFpKO5A9JvQxzGCJ5RkKp1cRlRlkY8s5KzLO', -- admin123
    '555-BETA',
    'beta'
  ),
  (
    'manager',
    'Store',
    'Manager',
    'manager@spinhobby.com',
    '$2b$10$rOzJJHzl4O8VKWvFCeFpKO5A9JvQxzGCJ5RkKp1cRlRlkY8s5KzLO', -- admin123
    '555-STORE',
    'business'
  )
ON CONFLICT (username) DO NOTHING;

-- Also insert into users table if it exists (compatibility)
INSERT INTO users (
  username, 
  fname, 
  lname, 
  email, 
  password, 
  phone, 
  plan
) VALUES 
  (
    'admin',
    'Admin',
    'User', 
    'admin@spinhobby.com',
    '$2b$10$rOzJJHzl4O8VKWvFCeFpKO5A9JvQxzGCJ5RkKp1cRlRlkY8s5KzLO', -- admin123
    '555-ADMIN',
    'business'
  ),
  (
    'beta',
    'Beta',
    'Tester',
    'beta@spinhobby.com', 
    '$2b$10$rOzJJHzl4O8VKWvFCeFpKO5A9JvQxzGCJ5RkKp1cRlRlkY8s5KzLO', -- admin123
    '555-BETA',
    'beta'
  ),
  (
    'manager',
    'Store',
    'Manager',
    'manager@spinhobby.com',
    '$2b$10$rOzJJHzl4O8VKWvFCeFpKO5A9JvQxzGCJ5RkKp1cRlRlkY8s5KzLO', -- admin123
    '555-STORE',
    'business'
  )
ON CONFLICT (username) DO NOTHING;