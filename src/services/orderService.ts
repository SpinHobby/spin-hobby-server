import { pool } from "../db/pool";
import { squareService } from "./square";

export interface CheckoutAddress {
  name: { first: string; last: string };
  address: { primary: string; secondary?: string };
  city: string;
  province: string;
  postalCode: string;
  country: string;
  phone?: string;
}

export interface CheckoutItem {
  itemId: string; // Square catalog ITEM id
  variationId: string; // Square catalog ITEM_VARIATION id
  quantity: number;
}

export interface CreateOrderParams {
  customerId: number | null;
  paymentId: string;
  amountCents: number;
  shippingCents: number;
  currency: string;
  items: CheckoutItem[];
  billing: CheckoutAddress & { email: string };
  shipping: CheckoutAddress;
}

async function insertAddress(
  client: any,
  customerId: number | null,
  kind: "billing" | "shipping",
  address: CheckoutAddress
): Promise<number> {
  const result = await client.query(
    `INSERT INTO addresses
       (customer_id, kind, fname, lname, address1, address2, city, province, postal_code, country, phone)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      customerId,
      kind,
      address.name.first,
      address.name.last,
      address.address.primary,
      address.address.secondary || null,
      address.city,
      address.province,
      address.postalCode,
      address.country,
      address.phone || null,
    ]
  );
  return result.rows[0].id;
}

// Snapshots name/price/image from Square at purchase time (server-verified,
// not trusting client-supplied values) so order history stays accurate even
// if the catalog item is later renamed, re-priced, or deleted.
async function resolveItemSnapshot(itemId: string, variationId: string) {
  const { item, relatedObjects } = await squareService.getItem(itemId);
  if (!item || item.type !== "ITEM") {
    throw new Error(`Catalog item ${itemId} not found`);
  }
  const variation = item.itemData?.variations?.find(
    (v: any) => v.id === variationId && v.type === "ITEM_VARIATION"
  ) as any;
  if (!variation) {
    throw new Error(`Variation ${variationId} not found on item ${itemId}`);
  }
  const imageId = item.itemData?.imageIds?.[0];
  const imageObject = imageId
    ? (relatedObjects as any[]).find((o) => o.type === "IMAGE" && o.id === imageId)
    : undefined;
  return {
    name: item.itemData?.name || "Unknown item",
    unitPriceCents: Number(variation.itemVariationData?.priceMoney?.amount ?? 0),
    imageUrl: imageObject?.imageData?.url as string | undefined,
  };
}

export async function createOrder(params: CreateOrderParams): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const billingAddressId = await insertAddress(
      client,
      params.customerId,
      "billing",
      params.billing
    );
    const shippingAddressId = await insertAddress(
      client,
      params.customerId,
      "shipping",
      params.shipping
    );

    const subtotalCents = params.amountCents - params.shippingCents;
    const orderResult = await client.query(
      `INSERT INTO orders
         (customer_id, guest_email, square_payment_id, subtotal_cents, shipping_cents, total_cents,
          currency, billing_address_id, shipping_address_id, billing_email, billing_phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        params.customerId,
        params.customerId ? null : params.billing.email,
        params.paymentId,
        subtotalCents,
        params.shippingCents,
        params.amountCents,
        params.currency,
        billingAddressId,
        shippingAddressId,
        params.billing.email,
        params.billing.phone || null,
      ]
    );
    const orderId = orderResult.rows[0].id;

    for (const item of params.items) {
      // A single unresolvable item (deleted from the catalog, or an
      // environment mismatch between where it was added to cart and where
      // the order is being written) must not roll back the whole order -
      // the card is already charged, so losing the entire payment record
      // over one bad line item is worse than one line item with a
      // placeholder snapshot. Fall back and keep going.
      let snapshot: { name: string; unitPriceCents: number; imageUrl?: string };
      try {
        snapshot = await resolveItemSnapshot(item.itemId, item.variationId);
      } catch (error) {
        console.error(
          `Error resolving snapshot for item ${item.itemId}/${item.variationId}, using placeholder:`,
          error
        );
        snapshot = { name: `Item unavailable (${item.itemId})`, unitPriceCents: 0 };
      }
      await client.query(
        `INSERT INTO order_items
           (order_id, square_item_id, square_variation_id, name_snapshot, image_url_snapshot, unit_price_cents, quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          orderId,
          item.itemId,
          item.variationId,
          snapshot.name,
          snapshot.imageUrl || null,
          snapshot.unitPriceCents,
          item.quantity,
        ]
      );
    }

    await client.query("COMMIT");
    return orderId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function fetchOrdersWithItems(whereClause: string, params: any[]) {
  const ordersResult = await pool.query(
    `SELECT o.*, ba.fname AS b_fname, ba.lname AS b_lname, ba.address1 AS b_address1,
            ba.address2 AS b_address2, ba.city AS b_city, ba.province AS b_province,
            ba.postal_code AS b_postal_code, ba.country AS b_country,
            sa.fname AS s_fname, sa.lname AS s_lname, sa.address1 AS s_address1,
            sa.address2 AS s_address2, sa.city AS s_city, sa.province AS s_province,
            sa.postal_code AS s_postal_code, sa.country AS s_country
     FROM orders o
     LEFT JOIN addresses ba ON ba.id = o.billing_address_id
     LEFT JOIN addresses sa ON sa.id = o.shipping_address_id
     WHERE ${whereClause}
     ORDER BY o.created_at DESC`,
    params
  );
  if (ordersResult.rows.length === 0) return [];

  const orderIds = ordersResult.rows.map((row) => row.id);
  const itemsResult = await pool.query(
    `SELECT * FROM order_items WHERE order_id = ANY($1::int[])`,
    [orderIds]
  );
  const itemsByOrderId = new Map<number, any[]>();
  for (const item of itemsResult.rows) {
    const list = itemsByOrderId.get(item.order_id) || [];
    list.push({
      squareItemId: item.square_item_id,
      squareVariationId: item.square_variation_id,
      name: item.name_snapshot,
      imageUrl: item.image_url_snapshot,
      unitPriceCents: item.unit_price_cents,
      quantity: item.quantity,
    });
    itemsByOrderId.set(item.order_id, list);
  }

  return ordersResult.rows.map((row) => ({
    id: row.id,
    status: row.status,
    subtotalCents: row.subtotal_cents,
    shippingCents: row.shipping_cents,
    totalCents: row.total_cents,
    currency: row.currency,
    createdAt: row.created_at,
    billingEmail: row.billing_email,
    billingAddress: {
      fname: row.b_fname,
      lname: row.b_lname,
      address1: row.b_address1,
      address2: row.b_address2,
      city: row.b_city,
      province: row.b_province,
      postalCode: row.b_postal_code,
      country: row.b_country,
    },
    shippingAddress: {
      fname: row.s_fname,
      lname: row.s_lname,
      address1: row.s_address1,
      address2: row.s_address2,
      city: row.s_city,
      province: row.s_province,
      postalCode: row.s_postal_code,
      country: row.s_country,
    },
    items: itemsByOrderId.get(row.id) || [],
  }));
}

export async function getOrdersForCustomer(customerId: number) {
  return fetchOrdersWithItems("o.customer_id = $1", [customerId]);
}

export async function getOrderById(orderId: number, customerId: number) {
  const orders = await fetchOrdersWithItems("o.id = $1 AND o.customer_id = $2", [
    orderId,
    customerId,
  ]);
  return orders[0] || null;
}

export async function lookupGuestOrder(paymentId: string, email: string) {
  const orders = await fetchOrdersWithItems(
    "o.square_payment_id = $1 AND lower(o.billing_email) = lower($2)",
    [paymentId, email]
  );
  return orders[0] || null;
}
