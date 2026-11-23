// Erzeugt die App-Icons (PNG + SVG) ohne externe Bibliotheken: `npm run icons`.
// Motiv: Hufeisen mit Uhrzeigern. Geometrie in 512er-Einheiten.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'icons');
const RAD = Math.PI / 180;

const C = { x: 256, y: 240 };
const R = 130;            // Mittelradius Hufeisen
const HALF = 33;          // halbe Stärke
const GAP = 38 * RAD;     // Öffnung unten (je Seite)
const NAIL_R = 9;
const NAILS = [145, 35, 185, 355, 230, 310].map(d => d * RAD);
const HANDS = [[256, 163, 7], [304.5, 212, 7]]; // Endpunkt x, y, halbe Breite
const HUB = 18;
const TOP = [0, 137, 123], BOTTOM = [0, 87, 75], WHITE = [255, 255, 255];
const CORNER = 112;

const norm = a => Math.atan2(Math.sin(a), Math.cos(a));
const capPos = s => [C.x + R * Math.cos(90 * RAD + s * GAP), C.y + R * Math.sin(90 * RAD + s * GAP)];

function inHorseshoe(x, y) {
  const dx = x - C.x, dy = y - C.y;
  const r = Math.hypot(dx, dy);
  if (Math.abs(norm(Math.atan2(dy, dx) - 90 * RAD)) >= GAP && Math.abs(r - R) <= HALF) return true;
  return [-1, 1].some(s => { const [ex, ey] = capPos(s); return Math.hypot(x - ex, y - ey) <= HALF; });
}
const inNail = (x, y) => NAILS.some(t => Math.hypot(x - (C.x + R * Math.cos(t)), y - (C.y + R * Math.sin(t))) <= NAIL_R);
function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - ax - t * vx, py - ay - t * vy);
}
const inHands = (x, y) => Math.hypot(x - C.x, y - C.y) <= HUB || HANDS.some(([ex, ey, hw]) => segDist(x, y, C.x, C.y, ex, ey) <= hw);
function inRoundRect(x, y, rad) {
  const qx = Math.max(Math.abs(x - 256) - (256 - rad), 0), qy = Math.max(Math.abs(y - 256) - (256 - rad), 0);
  return Math.hypot(qx, qy) <= rad;
}

function render(size, { rounded, scale }) {
  const SS = 4;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let i = 0; i < SS; i++) {
        for (let j = 0; j < SS; j++) {
          const u = (px + (i + 0.5) / SS) / size * 512, v = (py + (j + 0.5) / SS) / size * 512;
          if (rounded && !inRoundRect(u, v, CORNER)) continue;
          const sx = (u - 256) / scale + 256, sy = (v - 256) / scale + 256;
          const k = v / 512;
          let col = TOP.map((c, n) => c + (BOTTOM[n] - c) * k);
          if ((inHorseshoe(sx, sy) && !inNail(sx, sy)) || inHands(sx, sy)) col = WHITE;
          r += col[0]; g += col[1]; b += col[2]; a += 1;
        }
      }
      const o = (py * size + px) * 4;
      if (a) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = Math.round(a / (SS * SS) * 255);
    }
  }
  return png(size, size, out);
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function svg() {
  const f = n => Math.round(n * 10) / 10;
  const [lx, ly] = capPos(1), [rx, ry] = capPos(-1);
  const nails = NAILS.map(t => `<circle cx="${f(C.x + R * Math.cos(t))}" cy="${f(C.y + R * Math.sin(t))}" r="${NAIL_R}" fill="#006d61"/>`).join('');
  const hands = HANDS.map(([x, y, hw]) => `<path d="M${C.x} ${C.y}L${x} ${y}" stroke="#fff" stroke-width="${hw * 2}" stroke-linecap="round"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${TOP})"/><stop offset="1" stop-color="rgb(${BOTTOM})"/></linearGradient></defs>
<rect width="512" height="512" rx="${CORNER}" fill="url(#g)"/>
<path d="M${f(lx)} ${f(ly)}A${R} ${R} 0 1 1 ${f(rx)} ${f(ry)}" fill="none" stroke="#fff" stroke-width="${HALF * 2}" stroke-linecap="round"/>
${nails}${hands}<circle cx="${C.x}" cy="${C.y}" r="${HUB}" fill="#fff"/>
</svg>
`;
}

mkdirSync(OUT, { recursive: true });
const files = {
  'icon-192.png': render(192, { rounded: true, scale: 1 }),
  'icon-512.png': render(512, { rounded: true, scale: 1 }),
  'icon-maskable-512.png': render(512, { rounded: false, scale: 0.78 }),
  'apple-touch-icon.png': render(180, { rounded: false, scale: 0.88 }),
  'icon.svg': svg(),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT, name), data);
  console.log('geschrieben:', join('app', 'icons', name));
}
