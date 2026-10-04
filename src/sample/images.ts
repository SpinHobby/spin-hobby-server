/**
 * Pictures for the sample catalog, drawn as SVG so nothing has to be stored: a pastel backdrop
 * coloured by series, a simple illustration of what the product is, the series and product
 * name, and a SAMPLE tag. Served by SampleImagesController at /sample-images/<slug>.svg.
 */
import { sampleProductBySlug, type SampleProduct } from './catalog.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function hue(seed: string) {
  let h = 7;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
const hsl = (h: number, s: number, l: number) => `hsl(${((h % 360) + 360) % 360} ${s}% ${l}%)`;

/** Up to two lines of about `max` characters, breaking at spaces. */
function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > max) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length > 2) { lines.length = 2; lines[1] = lines[1].slice(0, max - 1) + '…'; }
  return lines;
}

interface Palette { acc: string; acc2: string; dark: string; light: string; skin: string }

const FONT = "font-family=\"'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif\"";

// ---- illustrations: each is centred around (400, 400) in an 800x800 picture

function person(c: Palette, head: number, body: number, opts: { joints?: boolean; ribbon?: string } = {}) {
  const cx = 400;
  const hy = 150 + head;
  const bodyTop = hy + head - 12;
  const torso = 150 * body;
  const skirt = 100 * body;
  const bottom = bodyTop + torso + skirt;
  const w = 60 * body;
  const joint = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="9" fill="${c.dark}" opacity=".5"/>`;
  return `
    <ellipse cx="${cx}" cy="${bottom + 38}" rx="190" ry="26" fill="${c.dark}" opacity=".15"/>
    <rect x="${cx - 150}" y="${bottom + 12}" width="300" height="26" rx="13" fill="${c.acc2}"/>
    <circle cx="${cx}" cy="${hy + 8}" r="${head + 16}" fill="${c.acc2}"/>
    <ellipse cx="${cx - head - 12}" cy="${hy + head + 50}" rx="30" ry="${head + 30}" fill="${c.acc2}"/>
    <ellipse cx="${cx + head + 12}" cy="${hy + head + 50}" rx="30" ry="${head + 30}" fill="${c.acc2}"/>
    <path d="M${cx - w} ${bodyTop} h${2 * w} l${w * 0.4} ${torso} h-${2.8 * w} z" fill="${c.acc}"/>
    <path d="M${cx - w * 1.4} ${bodyTop + torso} h${2.8 * w} l${w * 0.7} ${skirt} h-${4.2 * w} z" fill="${c.light}"/>
    <rect x="${cx - w * 1.9}" y="${bodyTop + 10}" width="${w * 0.6}" height="${torso * 0.8}" rx="${w * 0.3}" fill="${c.skin}"/>
    <rect x="${cx + w * 1.3}" y="${bodyTop + 10}" width="${w * 0.6}" height="${torso * 0.8}" rx="${w * 0.3}" fill="${c.skin}"/>
    ${opts.joints ? joint(cx - w * 1.6, bodyTop + 20) + joint(cx + w * 1.6, bodyTop + 20) + joint(cx - w * 1.6, bodyTop + torso * 0.5) + joint(cx + w * 1.6, bodyTop + torso * 0.5) : ''}
    <circle cx="${cx}" cy="${hy}" r="${head}" fill="${c.skin}"/>
    <path d="M${cx - head} ${hy - head * 0.1} q${head * 0.3} -${head * 1.25} ${head} -${head * 1.1} q${head * 0.7} -${head * 0.15} ${head} ${head * 1.1} q-${head * 0.35} -${head * 0.35} -${head * 0.7} -${head * 0.3} q-${head * 0.3} ${head * 0.1} -${head * 0.6} -${head * 0.1} q-${head * 0.3} ${head * 0.3} -${head * 0.7} ${head * 0.4} z" fill="${c.acc2}"/>
    <ellipse cx="${cx - head * 0.38}" cy="${hy + head * 0.18}" rx="${head * 0.14}" ry="${head * 0.2}" fill="${c.dark}"/>
    <ellipse cx="${cx + head * 0.38}" cy="${hy + head * 0.18}" rx="${head * 0.14}" ry="${head * 0.2}" fill="${c.dark}"/>
    <circle cx="${cx - head * 0.33}" cy="${hy + head * 0.1}" r="${head * 0.05}" fill="#fff"/>
    <circle cx="${cx + head * 0.43}" cy="${hy + head * 0.1}" r="${head * 0.05}" fill="#fff"/>
    <ellipse cx="${cx - head * 0.62}" cy="${hy + head * 0.42}" rx="${head * 0.16}" ry="${head * 0.08}" fill="#ff9aa2" opacity=".6"/>
    <ellipse cx="${cx + head * 0.62}" cy="${hy + head * 0.42}" rx="${head * 0.16}" ry="${head * 0.08}" fill="#ff9aa2" opacity=".6"/>
    <path d="M${cx - head * 0.14} ${hy + head * 0.52} q${head * 0.14} ${head * 0.14} ${head * 0.28} 0" stroke="${c.dark}" stroke-width="4" fill="none" stroke-linecap="round"/>
    ${sparkle(cx + head + 60, hy - head, 18, c.acc)}${sparkle(cx - head - 70, hy + 20, 12, c.acc)}
    ${opts.ribbon ? `<g transform="translate(${cx + 150} ${bottom - 30}) rotate(-12)"><rect x="-70" y="-22" width="140" height="44" rx="8" fill="${c.acc}"/><text x="0" y="8" text-anchor="middle" font-size="24" font-weight="700" fill="#fff" ${FONT}>${opts.ribbon}</text></g>` : ''}`;
}

const sparkle = (x: number, y: number, r: number, fill: string) =>
  `<path d="M${x} ${y - r} q${r * 0.15} ${r * 0.85} ${r} ${r} q-${r * 0.85} ${r * 0.15} -${r} ${r} q-${r * 0.15} -${r * 0.85} -${r} -${r} q${r * 0.85} -${r * 0.15} ${r} -${r} z" fill="${fill}"/>`;

function mecha(c: Palette, armour: string, fin: boolean, label: string) {
  const s = (x: number, y: number, w: number, h: number, r = 12, fill = armour) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${c.dark}" stroke-width="4"/>`;
  return `
    <ellipse cx="400" cy="630" rx="190" ry="24" fill="${c.dark}" opacity=".15"/>
    ${fin ? `<path d="M400 212 l-70 -62 l34 64 z M400 212 l70 -62 l-34 64 z" fill="${c.acc}"/>` : `<rect x="384" y="150" width="32" height="40" rx="6" fill="${c.acc}"/>`}
    ${s(358, 198, 84, 68, 14)}
    <rect x="372" y="232" width="56" height="16" rx="4" fill="${c.acc2}"/>
    ${s(248, 272, 92, 72, 14)}${s(460, 272, 92, 72, 14)}
    ${s(322, 272, 156, 112, 10)}
    <rect x="378" y="286" width="44" height="44" rx="6" fill="${c.acc}"/>
    <path d="M322 300 l-30 40 l30 10 z M478 300 l30 40 l-30 10 z" fill="${c.acc2}"/>
    ${s(262, 342, 62, 128, 16)}${s(476, 342, 62, 128, 16)}
    ${s(338, 384, 124, 42, 8, c.acc2)}
    ${s(326, 424, 64, 150, 14)}${s(410, 424, 64, 150, 14)}
    ${s(312, 566, 84, 36, 10, c.acc2)}${s(404, 566, 84, 36, 10, c.acc2)}
    <g transform="translate(590 180)"><rect x="-70" y="-24" width="140" height="48" rx="10" fill="${c.dark}"/><text x="0" y="8" text-anchor="middle" font-size="24" font-weight="700" fill="#fff" ${FONT}>${esc(label)}</text></g>`;
}

function car(c: Palette) {
  return `
    <ellipse cx="400" cy="560" rx="230" ry="22" fill="${c.dark}" opacity=".15"/>
    <path d="M180 500 l10 -70 q10 -20 40 -24 l60 -70 q20 -22 60 -22 h120 q40 0 60 22 l60 70 q30 4 40 24 l10 70 q0 16 -16 16 h-428 q-16 0 -16 -16 z" fill="${c.acc}" stroke="${c.dark}" stroke-width="4"/>
    <path d="M300 404 l54 -62 q12 -14 34 -14 h100 q22 0 34 14 l54 62 z" fill="${c.light}" stroke="${c.dark}" stroke-width="4"/>
    <rect x="200" y="440" width="400" height="12" rx="6" fill="${c.acc2}"/>
    <circle cx="275" cy="520" r="46" fill="${c.dark}"/><circle cx="275" cy="520" r="22" fill="${c.light}"/>
    <circle cx="525" cy="520" r="46" fill="${c.dark}"/><circle cx="525" cy="520" r="22" fill="${c.light}"/>
    <rect x="186" y="462" width="30" height="16" rx="6" fill="#ffe08a"/><rect x="584" y="462" width="30" height="16" rx="6" fill="#ff6b6b"/>`;
}

function nipper(c: Palette) {
  return `
    <g transform="translate(400 400) rotate(-40)">
      <rect x="-24" y="-20" width="48" height="190" rx="18" fill="${c.acc}" stroke="${c.dark}" stroke-width="4"/>
      <rect x="-24" y="-20" width="48" height="190" rx="18" fill="${c.acc}" stroke="${c.dark}" stroke-width="4" transform="rotate(26)"/>
      <path d="M-22 -30 l10 -150 q12 -14 24 0 l10 150 z" fill="#d9dde6" stroke="${c.dark}" stroke-width="4"/>
      <path d="M-22 -30 l10 -150 q12 -14 24 0 l10 150 z" fill="#eef0f5" stroke="${c.dark}" stroke-width="4" transform="rotate(26)"/>
      <circle cx="0" cy="-10" r="14" fill="${c.dark}"/>
    </g>`;
}

function marker(c: Palette) {
  const pen = (x: number, fill: string) => `<g transform="translate(${x} 0) rotate(-18 400 400)"><rect x="372" y="250" width="56" height="300" rx="14" fill="${fill}" stroke="${c.dark}" stroke-width="4"/><rect x="372" y="250" width="56" height="60" rx="14" fill="${c.dark}"/><path d="M386 550 l14 40 l14 -40 z" fill="${c.dark}"/></g>`;
  return pen(-120, c.acc) + pen(0, c.acc2) + pen(120, c.light);
}

function bottle(c: Palette) {
  return `
    <ellipse cx="400" cy="610" rx="120" ry="18" fill="${c.dark}" opacity=".15"/>
    <rect x="360" y="190" width="80" height="60" rx="10" fill="${c.dark}"/>
    <path d="M330 250 h140 q30 0 30 30 v290 q0 30 -30 30 h-140 q-30 0 -30 -30 v-290 q0 -30 30 -30 z" fill="${c.acc}" stroke="${c.dark}" stroke-width="4"/>
    <rect x="320" y="330" width="160" height="150" rx="10" fill="${c.light}"/>
    <text x="400" y="420" text-anchor="middle" font-size="34" font-weight="700" fill="${c.dark}" ${FONT}>TOP COAT</text>`;
}

function plush(c: Palette) {
  return `
    <ellipse cx="400" cy="620" rx="200" ry="24" fill="${c.dark}" opacity=".15"/>
    <circle cx="282" cy="262" r="64" fill="${c.acc}" stroke="${c.dark}" stroke-width="4"/><circle cx="518" cy="262" r="64" fill="${c.acc}" stroke="${c.dark}" stroke-width="4"/>
    <circle cx="282" cy="262" r="32" fill="${c.light}"/><circle cx="518" cy="262" r="32" fill="${c.light}"/>
    <ellipse cx="400" cy="420" rx="200" ry="190" fill="${c.acc}" stroke="${c.dark}" stroke-width="4"/>
    <ellipse cx="400" cy="470" rx="110" ry="80" fill="${c.light}"/>
    <ellipse cx="400" cy="420" rx="200" ry="190" fill="none" stroke="${c.dark}" stroke-width="3" stroke-dasharray="10 12" opacity=".35" transform="scale(.93) translate(30 32)"/>
    <ellipse cx="330" cy="380" rx="16" ry="22" fill="${c.dark}"/><ellipse cx="470" cy="380" rx="16" ry="22" fill="${c.dark}"/>
    <circle cx="336" cy="372" r="6" fill="#fff"/><circle cx="476" cy="372" r="6" fill="#fff"/>
    <ellipse cx="290" cy="430" rx="26" ry="14" fill="#ff9aa2" opacity=".7"/><ellipse cx="510" cy="430" rx="26" ry="14" fill="#ff9aa2" opacity=".7"/>
    <ellipse cx="400" cy="440" rx="18" ry="12" fill="${c.dark}"/>
    <path d="M370 462 q30 24 60 0" stroke="${c.dark}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
}

function booster(c: Palette, label: string) {
  return `
    <defs><linearGradient id="holo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd6e7"/><stop offset=".3" stop-color="#d6f0ff"/><stop offset=".6" stop-color="#e3ffd6"/><stop offset="1" stop-color="#fff2c7"/></linearGradient></defs>
    <g transform="translate(400 400) rotate(-6)">
      <path d="M-120 -170 h240 l10 10 v320 l-10 10 h-240 l-10 -10 v-320 z" fill="${c.acc}" stroke="${c.dark}" stroke-width="4"/>
      <path d="M-130 -160 l12 -12 h236 l12 12 z M-130 160 l12 12 h236 l12 -12 z" fill="${c.acc2}"/>
      <rect x="-100" y="-120" width="200" height="200" rx="18" fill="url(#holo)"/>
      ${sparkle(0, -20, 46, c.acc2)}
      <rect x="-100" y="96" width="200" height="40" rx="8" fill="${c.dark}"/>
      <text x="0" y="124" text-anchor="middle" font-size="24" font-weight="700" fill="#fff" ${FONT}>${esc(label)}</text>
    </g>`;
}

function deck(c: Palette, label: string) {
  return `
    <ellipse cx="400" cy="610" rx="220" ry="22" fill="${c.dark}" opacity=".15"/>
    <path d="M200 300 l200 -70 l200 70 v220 l-200 70 l-200 -70 z" fill="${c.acc}" stroke="${c.dark}" stroke-width="4"/>
    <path d="M200 300 l200 70 l200 -70" fill="none" stroke="${c.dark}" stroke-width="4"/>
    <path d="M400 370 v220" stroke="${c.dark}" stroke-width="4"/>
    <path d="M200 300 l200 70 v220 l-200 -70 z" fill="${c.acc2}" opacity=".6"/>
    <rect x="240" y="236" width="140" height="190" rx="14" fill="#fff" stroke="${c.dark}" stroke-width="4" transform="rotate(-8 310 330)"/>
    <rect x="420" y="236" width="140" height="190" rx="14" fill="${c.light}" stroke="${c.dark}" stroke-width="4" transform="rotate(8 490 330)"/>
    <g transform="translate(400 460)"><rect x="-90" y="-22" width="180" height="44" rx="8" fill="${c.dark}"/><text x="0" y="8" text-anchor="middle" font-size="22" font-weight="700" fill="#fff" ${FONT}>${esc(label)}</text></g>`;
}

function acrylic(c: Palette) {
  return `
    <rect x="250" y="560" width="300" height="34" rx="8" fill="#fff" opacity=".5" stroke="${c.dark}" stroke-width="3"/>
    <rect x="270" y="150" width="260" height="420" rx="30" fill="#fff" opacity=".35" stroke="#fff" stroke-width="6"/>
    <g transform="translate(0 20) scale(.72) translate(155 100)">${person(c, 70, 1, {})}</g>
    <path d="M290 170 l60 -10" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity=".9"/>`;
}

function badge(c: Palette, pin: boolean) {
  const r = pin ? 120 : 160;
  return `
    <ellipse cx="400" cy="600" rx="${r + 30}" ry="20" fill="${c.dark}" opacity=".15"/>
    <circle cx="400" cy="400" r="${r}" fill="${c.acc}" stroke="${c.dark}" stroke-width="5"/>
    <circle cx="400" cy="400" r="${r - 20}" fill="none" stroke="#fff" stroke-width="6" opacity=".7"/>
    ${sparkle(400, 400, r * 0.55, c.light)}
    <path d="M${400 - r * 0.75} ${400 - r * 0.45} q${r * 0.6} -${r * 0.7} ${r * 1.3} -${r * 0.25}" stroke="#fff" stroke-width="10" fill="none" stroke-linecap="round" opacity=".55"/>
    ${pin ? `<rect x="392" y="${400 + r}" width="16" height="70" rx="6" fill="${c.dark}"/>` : ''}`;
}

function keychain(c: Palette) {
  return `
    <circle cx="400" cy="200" r="48" fill="none" stroke="${c.dark}" stroke-width="12"/>
    <circle cx="400" cy="270" r="12" fill="none" stroke="${c.dark}" stroke-width="8"/><circle cx="400" cy="298" r="12" fill="none" stroke="${c.dark}" stroke-width="8"/>
    <rect x="300" y="320" width="200" height="240" rx="36" fill="#fff" opacity=".4" stroke="#fff" stroke-width="6"/>
    <circle cx="400" cy="440" r="72" fill="${c.acc}" stroke="${c.dark}" stroke-width="4"/>
    ${sparkle(400, 440, 40, c.light)}
    <circle cx="400" cy="330" r="10" fill="${c.dark}"/>`;
}

function blindbox(c: Palette) {
  return `
    <ellipse cx="400" cy="620" rx="220" ry="22" fill="${c.dark}" opacity=".15"/>
    <path d="M220 320 l180 -80 l180 80 v220 l-180 80 l-180 -80 z" fill="${c.acc}" stroke="${c.dark}" stroke-width="4"/>
    <path d="M220 320 l180 80 l180 -80 M400 400 v220" fill="none" stroke="${c.dark}" stroke-width="4"/>
    <path d="M220 320 l180 80 v220 l-180 -80 z" fill="${c.acc2}" opacity=".55"/>
    <text x="490" y="500" text-anchor="middle" font-size="150" font-weight="800" fill="#fff" ${FONT} transform="skewY(-24)">?</text>
    ${sparkle(250, 230, 20, c.acc2)}${sparkle(560, 220, 26, c.acc2)}`;
}

function apparel(c: Palette, kind: 'shirt' | 'hoodie' | 'cap') {
  if (kind === 'cap') {
    return `
      <path d="M220 420 q0 -180 180 -180 q180 0 180 180 z" fill="${c.acc}" stroke="${c.dark}" stroke-width="4"/>
      <path d="M200 420 h400 q100 20 60 70 q-160 -30 -460 -40 z" fill="${c.acc2}" stroke="${c.dark}" stroke-width="4"/>
      ${sparkle(400, 350, 40, c.light)}
      <path d="M400 240 v180" stroke="${c.dark}" stroke-width="3" opacity=".4"/>`;
  }
  const hood = kind === 'hoodie';
  return `
    <path d="M300 230 l-120 60 l30 90 l60 -20 v240 h260 v-240 l60 20 l30 -90 l-120 -60 q-50 40 -100 0 z" fill="${c.acc}" stroke="${c.dark}" stroke-width="4"/>
    ${hood ? `<path d="M300 230 q100 -90 200 0 q-100 60 -200 0 z" fill="${c.acc2}" stroke="${c.dark}" stroke-width="4"/><rect x="330" y="470" width="140" height="70" rx="12" fill="${c.acc2}"/>` : `<path d="M300 230 q50 40 100 0 q-50 60 -100 0 z" fill="${c.acc2}"/>`}
    ${sparkle(400, 380, 56, c.light)}`;
}

function hanging(c: Palette, poster: boolean) {
  return `
    ${poster ? '' : `<rect x="250" y="150" width="300" height="18" rx="9" fill="${c.dark}"/><rect x="250" y="600" width="300" height="18" rx="9" fill="${c.dark}"/>`}
    <rect x="270" y="${poster ? 170 : 168}" width="260" height="${poster ? 420 : 432}" fill="${c.light}" stroke="${c.dark}" stroke-width="4"/>
    <circle cx="470" cy="300" r="50" fill="${c.acc}"/>
    <path d="M270 520 q80 -120 150 -40 q60 -90 110 -20 v130 h-260 z" fill="${c.acc2}"/>
    ${sparkle(330, 260, 16, c.acc)}${sparkle(380, 220, 10, c.acc)}
    ${poster ? `<rect x="300" y="200" width="260" height="420" fill="${c.acc}" opacity=".35" stroke="${c.dark}" stroke-width="3"/>` : ''}`;
}

function book(c: Palette, label: string, wide: boolean) {
  const w = wide ? 340 : 280;
  const x = 400 - w / 2;
  return `
    <ellipse cx="400" cy="620" rx="${w / 2 + 30}" ry="20" fill="${c.dark}" opacity=".15"/>
    <rect x="${x + 14}" y="194" width="${w}" height="400" rx="6" fill="${c.dark}" opacity=".35"/>
    <rect x="${x}" y="180" width="${w}" height="400" rx="6" fill="${c.acc}" stroke="${c.dark}" stroke-width="4"/>
    <rect x="${x}" y="180" width="34" height="400" rx="6" fill="${c.acc2}"/>
    <rect x="${x + 60}" y="220" width="${w - 90}" height="${wide ? 240 : 200}" rx="10" fill="${c.light}"/>
    ${sparkle(400, wide ? 340 : 320, 50, c.acc)}
    <rect x="${x + 60}" y="${wide ? 490 : 460}" width="${w - 90}" height="54" rx="8" fill="${c.dark}"/>
    <text x="${x + 30 + w / 2}" y="${wide ? 526 : 496}" text-anchor="middle" font-size="26" font-weight="700" fill="#fff" ${FONT}>${esc(label)}</text>`;
}

function disc(c: Palette) {
  return `
    <defs><radialGradient id="sheen" cx=".5" cy=".5" r=".5"><stop offset=".25" stop-color="#fff"/><stop offset=".45" stop-color="#ffd6e7"/><stop offset=".65" stop-color="#d6f0ff"/><stop offset=".85" stop-color="#e3ffd6"/><stop offset="1" stop-color="#fff"/></radialGradient></defs>
    <rect x="200" y="200" width="400" height="400" rx="12" fill="${c.acc}" stroke="${c.dark}" stroke-width="4" opacity=".9"/>
    <circle cx="430" cy="400" r="170" fill="url(#sheen)" stroke="${c.dark}" stroke-width="4"/>
    <circle cx="430" cy="400" r="30" fill="${c.light}" stroke="${c.dark}" stroke-width="4"/>
    <rect x="200" y="200" width="60" height="400" rx="12" fill="${c.acc2}"/>`;
}

function bluray(c: Palette) {
  return `
    <ellipse cx="400" cy="620" rx="190" ry="20" fill="${c.dark}" opacity=".15"/>
    <rect x="260" y="180" width="280" height="420" rx="10" fill="${c.acc}" stroke="${c.dark}" stroke-width="4"/>
    <rect x="260" y="180" width="280" height="54" rx="10" fill="#1f5fd1"/>
    <text x="400" y="217" text-anchor="middle" font-size="24" font-weight="700" fill="#fff" ${FONT}>Blu-ray</text>
    <rect x="290" y="260" width="220" height="250" rx="10" fill="${c.light}"/>
    ${sparkle(400, 385, 60, c.acc2)}
    <rect x="260" y="180" width="24" height="420" rx="6" fill="${c.acc2}"/>`;
}

function illustration(p: SampleProduct, c: Palette): string {
  switch (p.kind) {
    case 'figure': return person(c, 72, 1, {});
    case 'prize': return person(c, 76, 0.9, { ribbon: 'PRIZE' });
    case 'nendoroid': return person(c, 104, 0.6, {});
    case 'figma': return person(c, 56, 1.1, { joints: true });
    case 'gunpla': return mecha(c, '#f4f6fb', true, p.name.match(/^(HG|RG|MG|PG|Entry Grade)[^ ]*/)?.[0] ?? 'Gunpla');
    case 'mecha': return mecha(c, c.light, /Evangelion/.test(p.series), p.series.slice(0, 12));
    case 'car': return car(c);
    case 'nipper': return nipper(c);
    case 'marker': return marker(c);
    case 'bottle': return bottle(c);
    case 'plush': return plush(c);
    case 'booster': return booster(c, 'BOOSTER');
    case 'deck': return deck(c, 'SEALED');
    case 'acrylic': return acrylic(c);
    case 'badge': return badge(c, false);
    case 'pin': return badge(c, true);
    case 'keychain': return keychain(c);
    case 'blindbox': return blindbox(c);
    case 'shirt': case 'hoodie': case 'cap': return apparel(c, p.kind);
    case 'tapestry': return hanging(c, false);
    case 'poster': return hanging(c, true);
    case 'manga': return book(c, p.name.match(/Vol\. \d+/)?.[0] ?? 'MANGA', false);
    case 'artbook': return book(c, 'ART BOOK', true);
    case 'cd': return disc(c);
    case 'bluray': return bluray(c);
  }
}

function palette(seed: string): Palette {
  const h = hue(seed);
  return { acc: hsl(h, 62, 58), acc2: hsl(h + 36, 58, 44), dark: '#2b2d42', light: hsl(h + 180, 70, 90), skin: '#ffe6d3' };
}

/** The 800x800 picture of one sample product. */
export function sampleProductImage(p: SampleProduct): string {
  const h = hue(p.series);
  const c = palette(p.series);
  const lines = wrap(p.name, 34);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800" role="img" aria-label="${esc(p.name)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hsl(h, 80, 95)}"/><stop offset="1" stop-color="${hsl(h + 40, 70, 86)}"/></linearGradient>
    <pattern id="dots" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="20" cy="20" r="3" fill="${hsl(h, 60, 70)}" opacity=".35"/></pattern>
  </defs>
  <rect width="800" height="800" fill="url(#bg)"/>
  <rect width="800" height="800" fill="url(#dots)"/>
  <circle cx="400" cy="400" r="250" fill="#fff" opacity=".35"/>
  ${illustration(p, c)}
  <g transform="translate(40 40)"><rect width="${Math.min(720, p.series.length * 15 + 40)}" height="52" rx="26" fill="${c.dark}" opacity=".85"/><text x="22" y="34" font-size="24" font-weight="600" fill="#fff" ${FONT}>${esc(p.series)}</text></g>
  <text x="400" y="${lines.length > 1 ? 700 : 724}" text-anchor="middle" font-size="36" font-weight="700" fill="${c.dark}" ${FONT}>${lines.map((l, i) => `<tspan x="400" dy="${i ? 46 : 0}">${esc(l)}</tspan>`).join('')}</text>
  <g transform="translate(760 760) rotate(-8)"><rect x="-74" y="-20" width="148" height="40" rx="8" fill="#fff" opacity=".8" stroke="${c.dark}" stroke-width="2"/><text x="0" y="8" text-anchor="middle" font-size="22" font-weight="800" letter-spacing="3" fill="${c.dark}" ${FONT}>SAMPLE</text></g>
</svg>
`;
}

/** A wide homepage banner (the hero shows it on the right, fading into the copy). */
export function sampleBanner(n: number): string {
  const h = n * 97 + 200;
  const c = palette(`banner-${n}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600" width="1200" height="600" role="img" aria-label="Sample banner ${n}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hsl(h, 75, 60)}"/><stop offset="1" stop-color="${hsl(h + 60, 70, 45)}"/></linearGradient></defs>
  <rect width="1200" height="600" fill="url(#bg)"/>
  <circle cx="900" cy="300" r="230" fill="#fff" opacity=".18"/><circle cx="1050" cy="120" r="120" fill="#fff" opacity=".12"/><circle cx="760" cy="500" r="90" fill="#fff" opacity=".12"/>
  ${sparkle(980, 160, 40, '#fff')}${sparkle(1100, 420, 26, '#fff')}${sparkle(820, 110, 18, '#fff')}${sparkle(700, 420, 22, '#fff')}
  <g transform="translate(560 -40) scale(.95)">${n % 2 ? person(c, 72, 1, {}) : mecha(c, '#f4f6fb', true, 'RESTOCK')}</g>
  <g transform="translate(1100 540) rotate(-8)"><rect x="-74" y="-20" width="148" height="40" rx="8" fill="#fff" opacity=".8"/><text x="0" y="8" text-anchor="middle" font-size="22" font-weight="800" letter-spacing="3" fill="${c.dark}" ${FONT}>SAMPLE</text></g>
</svg>
`;
}

/** The SVG for a request path like `frieren-1-7-scale-figure.svg` or `banner-1.svg`, or undefined. */
export function sampleImageFor(file: string): string | undefined {
  const m = /^([a-z0-9-]+)\.svg$/.exec(file);
  if (!m) return undefined;
  const banner = /^banner-(\d)$/.exec(m[1]);
  if (banner) return sampleBanner(Number(banner[1]));
  const p = sampleProductBySlug(m[1]);
  return p && sampleProductImage(p);
}
