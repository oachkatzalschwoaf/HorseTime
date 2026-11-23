// Zeitleiste als SVG: Zeitfenster (Mindest- bis erlaubte Zeit), Zielzeit, geplante
// Kilometer-Zeiten, tatsächliche Schild-Zeiten, aktuelle Zeit und Hochrechnung.

import { fmtDur } from './calc.js';

const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/**
 * opts: { win, t?, projected?, status?, stepM?, actual?: [{t (s), delta}] }
 */
export function renderTimeline(el, { win, t = null, projected = null, status = null, stepM = 1000, actual = [] }) {
  if (!win) { el.innerHTML = ''; return; }
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const W = Math.max(200, el.clientWidth || 320);
  const H = Math.round(rem * 4.6);
  const pad = Math.round(rem * 0.6);
  const T = Math.max(win.tMax * 1.06, (t ?? 0) * 1.03, (projected ?? 0) * 1.03, 60);
  const X = s => pad + (W - 2 * pad) * Math.max(0, Math.min(s, T)) / T;
  const yb = Math.round(rem * 1.55), bh = Math.round(rem * 1.2), ym = yb + bh / 2;
  const parts = [];

  // Grundbalken, Fenster, Verspätungszone
  parts.push(`<rect class="tl-bg" x="${pad}" y="${yb}" width="${W - 2 * pad}" height="${bh}" rx="${bh / 2}"/>`);
  parts.push(`<rect class="tl-ok" x="${X(win.tMin)}" y="${yb}" width="${Math.max(2, X(win.tMax) - X(win.tMin))}" height="${bh}"/>`);
  parts.push(`<rect class="tl-late" x="${X(win.tMax)}" y="${yb}" width="${Math.max(0, W - pad - X(win.tMax))}" height="${bh}" rx="0"/>`);
  if (t != null && t > 0) parts.push(`<rect class="tl-elapsed" x="${pad}" y="${yb}" width="${X(t) - pad}" height="${bh}" rx="${bh / 2}"/>`);

  // Geplante Zwischenzeiten (Zielzeit-Plan) als Striche mit km-Nummer
  const xt = X(win.tTarget);
  if (stepM > 0) {
    const n = Math.floor((win.distM - 1e-6) / stepM);
    const pxPer = (W - 2 * pad) * (win.tTarget * stepM / win.distM) / T;
    const every = Math.max(1, Math.ceil((rem * 1.6) / Math.max(pxPer, 1)));
    for (let i = 1; i <= n; i++) {
      const x = X(win.tTarget * i * stepM / win.distM);
      parts.push(`<line class="tl-tick" x1="${x}" x2="${x}" y1="${yb - rem * 0.25}" y2="${yb + bh * 0.45}"/>`);
      if (i % every === 0 && xt - x > rem * 1.8) parts.push(`<text class="tl-km" x="${x}" y="${yb - rem * 0.45}" text-anchor="middle">${(i * stepM / 1000).toLocaleString('de-DE')}</text>`);
    }
  }

  // Zielzeit
  parts.push(`<line class="tl-target" x1="${xt}" x2="${xt}" y1="${yb - rem * 0.3}" y2="${yb + bh + rem * 0.3}"/>`);
  parts.push(`<text class="tl-km tl-target-label" x="${xt}" y="${yb - rem * 0.45}" text-anchor="middle">Ziel</text>`);

  // Beschriftung unter dem Balken
  const yl = yb + bh + rem * 1.05;
  if (win.tMin > 0) parts.push(`<text class="tl-label" x="${X(win.tMin) - 3}" y="${yl}" text-anchor="end">${fmtDur(win.tMin)}</text>`);
  parts.push(`<text class="tl-label tl-strong" x="${X(win.tMax) + 3}" y="${yl}" text-anchor="start">${fmtDur(win.tMax)}</text>`);
  if (win.tMin <= 0) parts.push(`<text class="tl-label" x="${pad}" y="${yl}" text-anchor="start">0</text>`);

  // Tatsächliche Schild-Zeiten
  for (const a of actual) {
    const cls = a.delta > 1 ? 'tl-behind' : a.delta < -1 ? 'tl-ahead' : 'tl-onplan';
    parts.push(`<circle class="${cls}" cx="${X(a.t)}" cy="${ym}" r="${bh * 0.28}"/>`);
  }

  // Hochrechnung
  if (projected != null) {
    const xp = X(projected), r = bh * 0.55;
    parts.push(`<path class="tl-proj tl-${status || 'ok'}" d="M${xp} ${ym - r}L${xp + r} ${ym}L${xp} ${ym + r}L${xp - r} ${ym}Z"/>`);
  }

  // Jetzt
  if (t != null) {
    const xn = X(t);
    parts.push(`<line class="tl-now" x1="${xn}" x2="${xn}" y1="${yb - rem * 0.2}" y2="${yb + bh + rem * 0.2}"/>`);
    parts.push(`<path class="tl-now-head" d="M${xn - rem * 0.35} ${yb - rem * 0.45}L${xn + rem * 0.35} ${yb - rem * 0.45}L${xn} ${yb - rem * 0.05}Z"/>`);
  }

  const label = `Zeitfenster ${fmtDur(win.tMin)} bis ${fmtDur(win.tMax)}, Ziel ${fmtDur(win.tTarget)}` +
    (t != null ? `, jetzt ${fmtDur(t)}` : '') + (projected != null ? `, Hochrechnung ${fmtDur(projected)}` : '');
  el.innerHTML = `<svg class="tl" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${parts.join('')}</svg>`;
}
