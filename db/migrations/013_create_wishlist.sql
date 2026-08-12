-- Wishlist stores only the Square item id and re-fetches live data at read
-- time (mirrors featured_products' pattern) - unlike orders, a wishlist
-- should always show current price/stock, not a snapshot.

CREATE TABLE IF NOT EXISTS wishlist_items (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    square_item_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (customer_id, square_item_id)
);
CREATE INDEX IF NOT EXISTS idx_wishlist_customer_id ON wishlist_items(customer_id);
