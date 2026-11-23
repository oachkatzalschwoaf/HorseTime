// GPX-Export (Fahrt) und -Import (Strecke). Regex-basiert, damit auch unter Node testbar.

import { fmtClock, fmtDelta } from './calc.js';

const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const unesc = s => String(s ?? '').replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) => {
  const map = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
  if (map[e.toLowerCase()]) return map[e.toLowerCase()];
  return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
});
const iso = ms => new Date(ms).toISOString();

/**
 * run: { phase: {name}, startAt, endAt, points: [[ts, lat, lon, acc, ele]], markers: [{t, d, lat, lon, delta}] }
 */
export function runToGpx(run) {
  const name = `${run.phase?.name || 'Fahrt'} ${new Date(run.startAt).toLocaleString('de-DE')}`;
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="HorseTime" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${esc(name)}</name><time>${iso(run.startAt)}</time></metadata>`,
  ];
  for (const m of run.markers || []) {
    if (m.lat == null || m.lon == null) continue;
    const desc = `${fmtClock(m.t / 1000)}${m.delta != null ? ` (${fmtDelta(m.delta)})` : ''}`;
    out.push(`  <wpt lat="${m.lat}" lon="${m.lon}"><time>${iso(run.startAt + m.t)}</time><name>km ${esc(m.d / 1000)}</name><desc>${esc(desc)}</desc></wpt>`);
  }
  out.push(`  <trk><name>${esc(name)}</name><trkseg>`);
  for (const p of run.points || []) {
    const ele = p[4] != null ? `<ele>${p[4]}</ele>` : '';
    out.push(`    <trkpt lat="${p[1]}" lon="${p[2]}">${ele}<time>${iso(p[0])}</time></trkpt>`);
  }
  out.push('  </trkseg></trk>', '</gpx>', '');
  return out.join('\n');
}

const attr = (s, k) => {
  const m = s.match(new RegExp(`\\b${k}\\s*=\\s*["']([^"']+)["']`));
  return m ? parseFloat(m[1]) : NaN;
};

/** Liest Track- oder Routenpunkte. Ergebnis: { name, points: [[lat, lon], ...] } */
export function parseGpx(text) {
  const points = [];
  for (const tag of ['trkpt', 'rtept']) {
    const re = new RegExp(`<${tag}\\b([^>]*)>`, 'g');
    let m;
    while ((m = re.exec(text))) {
      const lat = attr(m[1], 'lat'), lon = attr(m[1], 'lon');
      if (Number.isFinite(lat) && Number.isFinite(lon)) points.push([lat, lon]);
    }
    if (points.length) break;
  }
  const nm = text.match(/<name>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/name>/);
  return { name: nm ? unesc(nm[1].trim()) : '', points };
}
