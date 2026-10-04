/**
 * SQL fragments that attach an order's line items and history as JSON arrays. Both expect the orders
 * table to be aliased `o`. Shared by the customer order history and the admin orders screen.
 */
export const ITEMS_AS_JSON = `coalesce((select json_agg(i order by i.id) from public.order_items i where i.order_id = o.id), '[]') as order_items`;
export const EVENTS_AS_JSON = `coalesce((select json_agg(e order by e.created_at) from public.order_events e where e.order_id = o.id), '[]') as order_events`;
