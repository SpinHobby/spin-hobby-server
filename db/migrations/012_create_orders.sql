-- Orders + order_items. No orders schema existed anywhere before this -
-- checkout previously charged via Square and persisted nothing locally.
--
-- order_items snapshots name/price/image at purchase time (unlike the
-- featured_products/wishlist_items pattern of always re-fetching live Square
-- data) - order history must reflect what was actually bought even if the
-- catalog item is later renamed, re-priced, or deleted from Square.

DO $$ BEGIN
    CREATE TYPE ORDER_STATUS AS ENUM ('paid', 'fulfilled', 'cancelled', 'refunded');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    guest_email EMAILTYPE,
    square_payment_id VARCHAR(255) UNIQUE NOT NULL,
    status ORDER_STATUS NOT NULL DEFAULT 'paid',
    subtotal_cents INTEGER NOT NULL,
    shipping_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'CAD',
    billing_address_id INTEGER REFERENCES addresses(id),
    shipping_address_id INTEGER REFERENCES addresses(id),
    billing_email EMAILTYPE NOT NULL,
    billing_phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT orders_customer_or_guest CHECK (customer_id IS NOT NULL OR guest_email IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_square_payment_id ON orders(square_payment_id);

CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    square_item_id VARCHAR(255) NOT NULL,
    square_variation_id VARCHAR(255) NOT NULL,
    name_snapshot VARCHAR(255) NOT NULL,
    image_url_snapshot TEXT,
    unit_price_cents INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
