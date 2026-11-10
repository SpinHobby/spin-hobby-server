import { escapeHtml as escape } from '../../common/html.js';

/**
 * The shop's light-theme colours for email. Email apps ignore CSS variables and most of <style>, so every colour is written
 * inline; these are the only literal colours in the server and they mirror src/components/styles/tokens.scss in spin-hobby.
 */
export const EMAIL_COLORS = {
  bg: '#f4f5f8', // --bg
  surface: '#ffffff', // --surface
  text: '#171a2b', // --text
  muted: '#6b6f80', // --muted
  border: '#e3e5ec', // --border
  primary: '#1d2a53', // --primary
  gold: '#f3b72f', // --gold
} as const;

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const C = EMAIL_COLORS;

/** A big button that works in every email app (a link styled as a block, not a <button>). */
export const emailButton = (href: string, label: string) =>
  `<p style="margin:20px 0"><a href="${escape(href)}" style="display:inline-block;background:${C.primary};color:${C.surface};text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">${escape(label)}</a></p>`;

/**
 * Every shopper email in one frame: the logo, a white card with the message, and a footer saying who sent it and how to reach
 * us. `preheader` is the grey line inboxes show after the subject (hidden in the email itself).
 */
export function emailLayout({
  body,
  preheader,
  site,
  supportEmail,
}: {
  body: string;
  preheader: string;
  site: string;
  supportEmail: string;
}) {
  const logo = `${site}/logo/logo%20cropped.png`;
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"><title>Spin Hobby</title></head>` +
    `<body style="margin:0;padding:0;background:${C.bg};font-family:${FONT};color:${C.text}">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">` +
    `<tr><td style="padding:0 4px 16px"><a href="${escape(site)}"><img src="${escape(logo)}" alt="Spin Hobby" height="44" style="height:44px;width:auto;border:0;display:block"></a></td></tr>` +
    `<tr><td style="background:${C.surface};border:1px solid ${C.border};border-top:4px solid ${C.gold};border-radius:14px;padding:24px;font-size:15px;line-height:1.55">${body}</td></tr>` +
    `<tr><td style="padding:16px 4px;font-size:12px;line-height:1.5;color:${C.muted}">` +
    `Spin Hobby · Authentic anime merch, shipped from Canada<br>` +
    `<a href="mailto:${escape(supportEmail)}" style="color:${C.muted}">${escape(supportEmail)}</a> · <a href="${escape(site)}" style="color:${C.muted}">${escape(site.replace(/^https?:\/\//, ''))}</a>` +
    `</td></tr></table></td></tr></table></body></html>`
  );
}

/** The carrier's own tracking page for a number, or null when we don't know the carrier. Mirrors OrderStatus.tsx on the website. */
export function trackingUrl(carrier: string | null, tracking: string): string | null {
  const c = (carrier ?? '').toLowerCase();
  const n = encodeURIComponent(tracking.trim());
  if (c.includes('canada post'))
    return `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${n}`;
  if (c.includes('ups')) return `https://www.ups.com/track?tracknum=${n}`;
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
  if (c.includes('purolator')) return `https://www.purolator.com/en/shipping/tracker?pin=${n}`;
  if (c.includes('usps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
  return null;
}
