import { escapeHtml as escape } from '../../../common/html.js';
import type { Row } from '../../../database/db.service.js';

/** The printable packing slip for an order (with `order_items` attached): who to ship to and what goes in the box. */
export function packingSlipHtml(order: Row) {
  const s = (order.shipping_address ?? {}) as Row;
  const items = (order.order_items ?? [])
    .map((i: Row) => `<tr><td>${escape(i.name)}</td><td>${i.quantity}</td></tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Packing slip #${order.id}</title><style>body{font:14px system-ui;margin:32px;color:#171a2b}h1{margin:0 0 24px}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}</style></head><body><h1>Spin Hobby · Packing slip #${order.id}</h1><p><strong>Ship to</strong><br>${escape(s.firstName ?? s.name?.first)} ${escape(s.lastName ?? s.name?.last)}<br>${escape(s.address1 ?? s.address?.primary)}<br>${escape(s.address2 ?? s.address?.secondary)}<br>${escape(s.city)}, ${escape(s.province)} ${escape(s.postalCode)}</p><table><thead><tr><th>Item</th><th>Qty</th></tr></thead><tbody>${items}</tbody></table></body></html>`;
}
