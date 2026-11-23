// Schlanke Kachel-Karte auf Canvas (ohne Bibliothek): Verschieben, Pinch-/Mausrad-Zoom,
// Track, Strecke, Schilder, Position. Fehlende Kacheln (offline) → gröbere Stufe oder Raster.

import { lonToX, latToY, metersPerPixel, yToLat } from './geo.js';

export const TILE_SOURCES = {
  osm: {
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende',
  },
  topo: {
    name: 'OpenTopoMap',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxZoom: 17,
    attribution: 'Karte: © <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA), Daten: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende',
  },
};

export function tileSource(settings) {
  if (settings.tiles === 'none') return null;
  if (settings.tiles === 'custom') {
    return /\{z\}/.test(settings.tileUrl) ? { name: 'Eigene', url: settings.tileUrl.trim(), subdomains: 'abc', maxZoom: 19, attribution: 'Eigene Kartenquelle' } : null;
  }
  return TILE_SOURCES[settings.tiles] || TILE_SOURCES.osm;
}

/** Quelle + Namensnachweis setzen; Knöpfe (data-map=in|out|follow|fit) verdrahten. */
export function applySource(map, root, settings) {
  const src = tileSource(settings);
  map.setSource(src, settings.bigLabels ? -1 : 0);
  const attr = root.querySelector('.map-attr');
  if (attr) attr.innerHTML = src ? src.attribution : 'Keine Kartenkacheln';
}

export function bindMapControls(root, map) {
  root.querySelector('.map-ctl')?.addEventListener('click', e => {
    const b = e.target.closest('button[data-map]');
    if (!b) return;
    const a = b.dataset.map;
    if (a === 'in') map.zoomBy(1);
    else if (a === 'out') map.zoomBy(-1);
    else if (a === 'fit') map.fit();
    else if (a === 'follow') { map.setFollow(!map.follow); if (map.follow && map.pos && map.z < 14) map.z = 16; }
  });
  const followBtn = root.querySelector('[data-map="follow"]');
  map.onFollowChange = on => followBtn?.setAttribute('aria-pressed', String(on));
  followBtn?.setAttribute('aria-pressed', String(map.follow));
}

// ---------- gemeinsamer Kachel-Speicher (im RAM; offline übernimmt der Service Worker) ----------
const tiles = new Map();
const MAX_TILES = 600;
const redrawers = new Set();
const notify = () => redrawers.forEach(f => f());

function peekTile(url) { return tiles.get(url); }

function getTile(url) {
  let t = tiles.get(url);
  if (t) {
    if (t.err && Date.now() - t.errAt > 20000) { tiles.delete(url); t = null; } // später erneut versuchen
    else { tiles.delete(url); tiles.set(url, t); return t; } // LRU auffrischen
  }
  const img = new Image();
  t = { img, ok: false, err: false, cors: true, errAt: 0 };
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.onload = () => { t.ok = true; notify(); };
  img.onerror = () => {
    if (t.cors) { t.cors = false; img.removeAttribute('crossorigin'); img.src = url; return; } // Quelle ohne CORS
    t.err = true; t.errAt = Date.now(); notify();
  };
  img.src = url;
  tiles.set(url, t);
  while (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value);
  return t;
}

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export class TileMap {
  constructor(el, { onFollowChange } = {}) {
    this.el = el;
    this.onFollowChange = onFollowChange;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tmap-canvas';
    this.canvas.setAttribute('aria-label', 'Karte');
    el.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.w = 0; this.h = 0; this.dpr = 1;
    this.cx = lonToX(13.3); this.cy = latToY(47.6); this.z = 6; // Startansicht Mitteleuropa
    this.source = null;
    this.zoomOffset = 0;
    this.track = []; this.trackKey = null; this.trackLen = 0;
    this.route = [];
    this.markers = [];
    this.pos = null;
    this.follow = true;
    this.pointers = new Map();
    this.raf = 0;
    this.redraw = () => this.invalidate();
    redrawers.add(this.redraw);
    this.bind();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.resize();
  }

  destroy() {
    redrawers.delete(this.redraw);
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
  }

  // ---------- Daten ----------
  setSource(src, zoomOffset = 0) { this.source = src; this.zoomOffset = zoomOffset; this.invalidate(); }

  /** points: [[ts, lat, lon, ...]] (Fahrt) – inkrementell, solange key gleich bleibt. */
  setTrack(points, key) {
    if (key !== this.trackKey || points.length < this.trackLen) { this.track = []; this.trackLen = 0; this.trackKey = key; }
    for (let i = this.trackLen; i < points.length; i++) this.track.push([lonToX(points[i][2]), latToY(points[i][1])]);
    this.trackLen = points.length;
    this.invalidate();
  }

  /** points: [[lat, lon]] */
  setRoute(points) {
    this.route = (points || []).map(p => [lonToX(p[1]), latToY(p[0])]);
    this.invalidate();
  }

  /** [{lat, lon, label}] */
  setMarkers(list) {
    this.markers = list.filter(m => m.lat != null).map(m => ({ x: lonToX(m.lon), y: latToY(m.lat), label: m.label }));
    this.invalidate();
  }

  setPosition(fix) {
    this.pos = fix ? { x: lonToX(fix.lon), y: latToY(fix.lat), lat: fix.lat, acc: fix.acc, hdg: fix.hdg, spd: fix.spd } : null;
    this.invalidate();
  }

  setFollow(on) {
    if (this.follow === on) return;
    this.follow = on;
    this.onFollowChange?.(on);
    this.invalidate();
  }

  /** Ausschnitt auf Track + Strecke (+ Position) setzen. */
  fit() {
    const pts = [...this.track, ...this.route];
    if (this.pos) pts.push([this.pos.x, this.pos.y]);
    if (!pts.length) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    this.setFollow(false);
    this.cx = (x0 + x1) / 2; this.cy = (y0 + y1) / 2;
    const pad = 40;
    const zx = Math.log2(Math.max(1, this.w - pad * 2) / 256 / Math.max(x1 - x0, 1e-9));
    const zy = Math.log2(Math.max(1, this.h - pad * 2) / 256 / Math.max(y1 - y0, 1e-9));
    this.z = Math.max(3, Math.min(17, zx, zy));
    this.invalidate();
  }

  center(lat, lon, z) {
    this.cx = lonToX(lon); this.cy = latToY(lat);
    if (z != null) this.z = z;
    this.invalidate();
  }

  // ---------- Interaktion ----------
  bind() {
    const c = this.canvas;
    const local = e => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, local(e));
      this.gesture = null;
    });
    c.addEventListener('pointermove', e => {
      if (!this.pointers.has(e.pointerId)) return;
      const prev = [...this.pointers.values()];
      this.pointers.set(e.pointerId, local(e));
      const cur = [...this.pointers.values()];
      const ws = 256 * 2 ** this.z;
      if (cur.length === 1) {
        const dx = cur[0].x - prev[0].x, dy = cur[0].y - prev[0].y;
        if (!dx && !dy) return;
        this.setFollow(false);
        this.cx -= dx / ws; this.cy -= dy / ws;
        this.clamp();
        this.invalidate();
      } else if (cur.length === 2) {
        const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        const d0 = dist(prev[0], prev[1]), d1 = dist(cur[0], cur[1]);
        const m0 = mid(prev[0], prev[1]), m1 = mid(cur[0], cur[1]);
        if (!this.follow) { this.cx -= (m1.x - m0.x) / ws; this.cy -= (m1.y - m0.y) / ws; }
        if (d0 > 0 && d1 > 0) this.zoomAround(Math.log2(d1 / d0), m1.x, m1.y);
        this.invalidate();
      }
    });
    const up = e => { this.pointers.delete(e.pointerId); };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const p = local(e);
      this.zoomAround(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025), p.x, p.y);
    }, { passive: false });
    c.addEventListener('dblclick', e => { const p = local(e); this.zoomAround(1, p.x, p.y); });
  }

  zoomBy(dz) { this.zoomAround(dz, this.w / 2, this.h / 2); }

  zoomAround(dz, sx, sy) {
    if (this.follow) { sx = this.w / 2; sy = this.h / 2; }
    const ws = 256 * 2 ** this.z;
    const wx = this.cx + (sx - this.w / 2) / ws, wy = this.cy + (sy - this.h / 2) / ws;
    this.z = Math.max(2, Math.min(20, this.z + dz));
    const ws2 = 256 * 2 ** this.z;
    this.cx = wx - (sx - this.w / 2) / ws2;
    this.cy = wy - (sy - this.h / 2) / ws2;
    this.clamp();
    this.invalidate();
  }

  clamp() {
    this.cx = ((this.cx % 1) + 1) % 1;
    this.cy = Math.max(0, Math.min(1, this.cy));
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.round(r.width); this.h = Math.round(r.height);
    this.canvas.width = Math.max(1, Math.round(this.w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * this.dpr));
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.draw();
  }

  invalidate() {
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  // ---------- Zeichnen ----------
  tileUrl(z, x, y) {
    const s = this.source;
    const sub = s.subdomains ? s.subdomains[(x + y) % s.subdomains.length] : '';
    return s.url.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{s}', sub);
  }

  draw() {
    const { ctx, w, h } = this;
    if (!w || !h || !this.el.isConnected) return;
    if (this.follow && this.pos) { this.cx = this.pos.x; this.cy = this.pos.y; }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const col = {
      bg: css('--map-bg') || '#e9ecea', grid: css('--map-grid') || '#d4dad7',
      track: css('--track') || '#e8590c', route: css('--route') || '#1565c0',
      pos: css('--pos') || '#1a73e8', ink: css('--text') || '#111', paper: css('--surface') || '#fff',
    };
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, w, h);
    const ws = 256 * 2 ** this.z;
    const x0 = this.cx * ws - w / 2, y0 = this.cy * ws - h / 2;
    if (this.source) this.drawTiles(ws, x0, y0, col);
    else this.drawGrid(ws, x0, y0, col);

    const px = p => [p[0] * ws - x0, p[1] * ws - y0];
    if (this.route.length > 1) {
      this.line(this.route.map(px), col.paper, 7);
      ctx.setLineDash([10, 8]);
      this.line(this.route.map(px), col.route, 4);
      ctx.setLineDash([]);
    }
    if (this.track.length > 1) {
      const pts = this.track.map(px);
      this.line(pts, col.paper, 8);
      this.line(pts, col.track, 4.5);
    }
    if (this.track.length) this.dot(px(this.track[0]), 6, '#2e7d32', col.paper);
    ctx.font = `700 ${Math.round(11 * this.fontScale())}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const m of this.markers) {
      const [x, y] = px([m.x, m.y]);
      const r = 10 * this.fontScale();
      this.dot([x, y], r, col.paper, col.ink, 2);
      ctx.fillStyle = col.ink;
      ctx.fillText(m.label, x, y + 0.5);
    }
    if (this.pos) {
      const [x, y] = px([this.pos.x, this.pos.y]);
      const accPx = this.pos.acc / metersPerPixel(this.pos.lat, this.z);
      if (accPx > 8) {
        ctx.beginPath(); ctx.arc(x, y, accPx, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(26,115,232,.13)'; ctx.fill();
        ctx.strokeStyle = 'rgba(26,115,232,.45)'; ctx.lineWidth = 1; ctx.stroke();
      }
      if (this.pos.hdg != null && Number.isFinite(this.pos.hdg) && this.pos.spd > 0.5) {
        const a = (this.pos.hdg - 90) * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * 22, y + Math.sin(a) * 22);
        ctx.lineTo(x + Math.cos(a + 2.5) * 10, y + Math.sin(a + 2.5) * 10);
        ctx.lineTo(x + Math.cos(a - 2.5) * 10, y + Math.sin(a - 2.5) * 10);
        ctx.closePath(); ctx.fillStyle = col.pos; ctx.fill();
      }
      this.dot([x, y], 8, col.pos, '#fff', 3);
    }
    this.drawScale(col);
  }

  fontScale() { return parseFloat(css('--scale')) || 1; }

  line(pts, color, width) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();
  }

  dot([x, y], r, fill, stroke, sw = 2) {
    const { ctx } = this;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = sw; ctx.stroke(); }
  }

  drawTiles(ws, x0, y0, col) {
    const { ctx, w, h } = this;
    const L = Math.max(0, Math.min(this.source.maxZoom, Math.round(this.z + this.zoomOffset)));
    const n = 2 ** L, ts = ws / n;
    const tx0 = Math.floor(x0 / ts), tx1 = Math.floor((x0 + w) / ts);
    const ty0 = Math.max(0, Math.floor(y0 / ts)), ty1 = Math.min(n - 1, Math.floor((y0 + h) / ts));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const x = ((tx % n) + n) % n;
        const dx = Math.round(tx * ts - x0), dy = Math.round(ty * ts - y0);
        const dw = Math.round((tx + 1) * ts - x0) - dx, dh = Math.round((ty + 1) * ts - y0) - dy;
        const t = getTile(this.tileUrl(L, x, ty));
        if (t.ok) { ctx.drawImage(t.img, dx, dy, dw, dh); continue; }
        let drawn = false;
        for (let k = 1; k <= 5 && L - k >= 0 && !drawn; k++) {
          const p = peekTile(this.tileUrl(L - k, x >> k, ty >> k));
          if (!p?.ok) continue;
          const sub = p.img.naturalWidth / 2 ** k;
          ctx.drawImage(p.img, (x - ((x >> k) << k)) * sub, (ty - ((ty >> k) << k)) * sub, sub, sub, dx, dy, dw, dh);
          drawn = true;
        }
        if (!drawn) {
          ctx.strokeStyle = col.grid; ctx.lineWidth = 1;
          ctx.strokeRect(dx + 0.5, dy + 0.5, dw, dh);
        }
      }
    }
  }

  drawGrid(ws, x0, y0, col) {
    // Ohne Kartenkacheln: Raster im 100/500/1000-m-Abstand je nach Zoom
    const { ctx, w, h } = this;
    const lat = yToLat(this.cy);
    const mpp = metersPerPixel(lat, this.z);
    const step = [50, 100, 250, 500, 1000, 2500, 5000, 10000].find(s => s / mpp >= 60) || 20000;
    const stepWorld = step / mpp / ws; // in normierten Einheiten
    ctx.strokeStyle = col.grid; ctx.lineWidth = 1;
    ctx.beginPath();
    const startX = Math.floor(x0 / ws / stepWorld) * stepWorld, startY = Math.floor(y0 / ws / stepWorld) * stepWorld;
    for (let x = startX; x * ws - x0 < w; x += stepWorld) { const sx = Math.round(x * ws - x0) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, h); }
    for (let y = startY; y * ws - y0 < h; y += stepWorld) { const sy = Math.round(y * ws - y0) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(w, sy); }
    ctx.stroke();
  }

  drawScale(col) {
    const { ctx, h } = this;
    const mpp = metersPerPixel(yToLat(this.cy), this.z);
    const target = 90 * mpp;
    const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].find(v => v >= target * 0.6) || 100000;
    const len = nice / mpp;
    const x = 10, y = h - 12;
    ctx.strokeStyle = col.paper; ctx.lineWidth = 5; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x, y); ctx.lineTo(x + len, y); ctx.lineTo(x + len, y - 6); ctx.stroke();
    ctx.strokeStyle = col.ink; ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = `600 ${Math.round(11 * this.fontScale())}px system-ui, sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    const label = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;
    ctx.lineWidth = 3; ctx.strokeStyle = col.paper; ctx.strokeText(label, x + 4, y - 4);
    ctx.fillStyle = col.ink; ctx.fillText(label, x + 4, y - 4);
  }
}
