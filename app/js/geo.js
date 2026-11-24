// Geo-Hilfen: Haversine-Distanz und Web-Mercator (normiert 0..1).

const R = 6371008.8; // mittlerer Erdradius in m
const RAD = Math.PI / 180;
const MAX_LAT = 85.05112878;

export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const lonToX = lon => (lon + 180) / 360;
export function latToY(lat) {
  const s = Math.sin(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * RAD);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
export function yToLat(y) {
  const n = Math.PI - 2 * Math.PI * y;
  return Math.atan(Math.sinh(n)) / RAD;
}

/** Meter pro (CSS-)Pixel bei Zoomstufe z (256-px-Kacheln). */
export const metersPerPixel = (lat, z) => Math.cos(lat * RAD) * 2 * Math.PI * R / (256 * 2 ** z);

/** Länge einer Punktliste [[lat, lon], ...] in Metern. */
export function pathLength(pts) {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  return sum;
}

/** Punkte ausdünnen: nur behalten, wenn mindestens minM vom zuletzt behaltenen entfernt (Endpunkt bleibt). */
export function thin(pts, minM = 5) {
  if (pts.length < 3) return pts.slice();
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    if (haversine(a[0], a[1], pts[i][0], pts[i][1]) >= minM) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
