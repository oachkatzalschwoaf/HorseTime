// Reine Rechenlogik ohne DOM – getestet mit `npm test` (tests/calc.test.mjs).
// Einheiten intern: Meter, Sekunden, km/h. Formeln siehe konzept_formelsammlung_*.md.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- Grundformeln (3-Wege) ----------
export const timeFromSpeed = (distM, kmh) => distM / kmh * 3.6;
export const speedFromTime = (distM, sec) => distM / sec * 3.6;
export const distFromSpeed = (kmh, sec) => kmh * sec / 3.6;
export const kmhToMpm = kmh => kmh * 1000 / 60;
export const mpmToKmh = mpm => mpm * 60 / 1000;
export const kmhToPace = kmh => 3600 / kmh;          // Sekunden pro km
export const paceToKmh = secPerKm => 3600 / secPerKm;

// ---------- Fahrsport: Zeitfenster ----------
export const MIN_TIME_LIMIT_M = 3000;
/** Abstand Mindestzeit zur erlaubten Zeit: > 3000 m → 120 s, sonst 60 s. */
export const minTimeOffset = distM => distM > MIN_TIME_LIMIT_M ? 120 : 60;

/**
 * Zeitfenster einer Phase.
 * phase: { distM, mode: 'speed'|'time', speedKmh, tMaxSec, minRule: 'auto'|'manual'|'none', tMinSec, bufferSec }
 * Erlaubte Zeit aus Tempo wird auf volle Sekunden abgerundet (sichere Seite).
 */
export function phaseWindow(p) {
  const D = Number(p?.distM);
  if (!(D > 0)) return null;
  let tMax = 0;
  if (p.mode === 'time') tMax = Math.round(Number(p.tMaxSec) || 0);
  else if (p.speedKmh > 0) tMax = Math.floor(timeFromSpeed(D, p.speedKmh) + 1e-6);
  if (!(tMax > 0)) return null;
  let tMin;
  if (p.minRule === 'manual') tMin = clamp(Math.round(Number(p.tMinSec) || 0), 0, tMax);
  else if (p.minRule === 'none') tMin = 0;
  else tMin = Math.max(0, tMax - minTimeOffset(D));
  const buffer = Math.max(0, Number(p.bufferSec) || 0);
  const tTarget = clamp(tMax - buffer, tMin, tMax);
  return {
    distM: D, tMax, tMin, tTarget,
    vTarget: speedFromTime(D, tTarget),
    vSlow: speedFromTime(D, tMax),                          // langsamstes erlaubtes Ø-Tempo
    vFast: tMin > 0 ? speedFromTime(D, tMin) : Infinity,    // schnellstes erlaubtes Ø-Tempo
  };
}

/**
 * Zwischenzeiten-Tabelle (anteilig zur Distanz). Rundung zur sicheren Seite:
 * Mindestzeit aufrunden, erlaubte Zeit abrunden, Zielzeit kaufmännisch.
 * Letzte Zeile ist immer das Ziel (volle Distanz), auch wenn Distanz kein Vielfaches der Schrittweite ist.
 */
export function splitTable(win, stepM, maxRows = 200) {
  const D = win.distM;
  const step = stepM > 0 ? stepM : D;
  const at = d => ({
    d,
    tMin: Math.ceil(win.tMin * d / D - 1e-6),
    tTarget: Math.round(win.tTarget * d / D),
    tMax: Math.floor(win.tMax * d / D + 1e-6),
  });
  const rows = [];
  let capped = false;
  for (let i = 1; i * step < D - 1e-6; i++) {
    if (rows.length >= maxRows) { capped = true; break; }
    rows.push(at(i * step));
  }
  const last = at(D);
  last.finish = true;
  rows.push(last);
  rows.forEach((r, i) => { r.n = i + 1; });
  return { rows, capped };
}

/** Soll-Zeit (Zielzeit-Plan) an Distanz d. */
export const planTimeAt = (win, d) => win.tTarget * clamp(d, 0, win.distM) / win.distM;

export const statusOf = (win, t) => (t < win.tMin ? 'early' : t > win.tMax ? 'late' : 'ok');

function speedFor(remM, sec) {
  if (remM <= 0) return 0;
  if (sec <= 0) return Infinity;
  return speedFromTime(remM, sec);
}

/**
 * Live-Werte für Zeit t (s) und Distanz d (m, oder null wenn unbekannt).
 * delta > 0: hinter dem Plan (zu langsam), < 0: vor dem Plan.
 * vSlow/vFast: Tempo-Korridor für den Rest, um im Zeitfenster anzukommen.
 */
export function liveStats(win, t, d, minProjectM = 150) {
  const out = {
    remaining: null, planAt: null, delta: null, vAvg: null,
    projected: null, status: null, vReq: null, vSlow: null, vFast: null,
  };
  if (d == null || !Number.isFinite(d)) return out;
  const D = win.distM;
  const dd = clamp(d, 0, D);
  out.remaining = D - dd;
  out.vReq = speedFor(out.remaining, win.tTarget - t);
  out.vSlow = speedFor(out.remaining, win.tMax - t);
  out.vFast = win.tMin > 0 ? speedFor(out.remaining, win.tMin - t) : Infinity;
  if (dd > 0 && t > 0) {
    out.planAt = planTimeAt(win, dd);
    out.delta = t - out.planAt;
    out.vAvg = speedFromTime(dd, t);
    if (dd >= Math.min(minProjectM, D)) {
      out.projected = t * D / dd;
      out.status = statusOf(win, out.projected);
    }
  }
  return out;
}

/** Nächster Zwischenpunkt nach Distanz d (Vielfaches von stepM, höchstens Ziel). */
export function nextSplit(win, d, stepM) {
  const D = win.distM;
  if (!(stepM > 0) || d >= D) return null;
  let nd = (Math.floor((Math.max(0, d) + 1e-6) / stepM) + 1) * stepM;
  if (nd > D) nd = D;
  return { d: nd, tTarget: win.tTarget * nd / D, tMin: win.tMin * nd / D, tMax: win.tMax * nd / D };
}

/** Ergebnis im Ziel. Strafpunkte je angefangene Sekunde außerhalb des Fensters. */
export function verdict(win, t, perSec = 0.25) {
  if (t < win.tMin) { const sec = Math.ceil(win.tMin - t - 1e-9); return { kind: 'early', sec, points: sec * perSec }; }
  if (t > win.tMax) { const sec = Math.ceil(t - win.tMax - 1e-9); return { kind: 'late', sec, points: sec * perSec }; }
  return { kind: 'ok', sec: 0, points: 0 };
}

// ---------- Formatierung ----------
export const pad2 = n => String(n).padStart(2, '0');
const hms = s => [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60];
const nfCache = new Map();
function nf(min, max) {
  const k = min + ':' + max;
  if (!nfCache.has(k)) nfCache.set(k, new Intl.NumberFormat('de-DE', { minimumFractionDigits: min, maximumFractionDigits: max }));
  return nfCache.get(k);
}
const bad = v => v == null || !Number.isFinite(v);

/** Dauer gerundet: "mm:ss" bzw. "h:mm:ss". */
export function fmtDur(sec) {
  if (bad(sec)) return '–';
  const neg = sec < 0;
  const [h, m, s] = hms(Math.round(Math.abs(sec)));
  return (neg ? '−' : '') + (h ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`);
}

/** Stoppuhr: abgeschnitten; negativ = Countdown (aufgerundet). */
export function fmtClock(sec) {
  if (bad(sec)) return '–';
  if (sec < 0) return '−' + fmtDur(Math.ceil(-sec - 1e-9));
  return fmtDur(Math.floor(sec + 1e-9));
}

/** Sekundenanzahl lesbar: "45 s" bzw. "15:55 min". */
export const fmtSec = sec => (sec < 60 ? `${sec} s` : `${fmtDur(sec)} min`);

/** Ergebnis-Text: "im Zeitfenster", "12 s zu früh", "1:05 min zu spät". */
export const verdictText = v => (v.kind === 'ok' ? 'im Zeitfenster' : `${fmtSec(v.sec)} zu ${v.kind === 'early' ? 'früh' : 'spät'}`);

/** Abweichung mit Vorzeichen: "+0:12", "−1:05", "±0:00". */
export function fmtDelta(sec) {
  if (bad(sec)) return '–';
  const s = Math.round(sec);
  if (s === 0) return '±0:00';
  const [h, m, r] = hms(Math.abs(s));
  return (s > 0 ? '+' : '−') + (h ? `${h}:${pad2(m)}:${pad2(r)}` : `${m}:${pad2(r)}`);
}

export function fmtNum(v, digits = 1) {
  if (bad(v)) return '–';
  return nf(digits, digits).format(v);
}
export const fmtKmh = v => (v === Infinity ? '∞' : fmtNum(v, 1));
export const fmtKm = m => (bad(m) ? '–' : nf(2, 2).format(m / 1000));

/** Distanz: "850 m" bzw. "7,25 km". */
export function fmtDist(m) {
  if (bad(m)) return '–';
  if (Math.abs(m) < 1000) return `${Math.round(m)} m`;
  return `${nf(0, 2).format(m / 1000)} km`;
}

/** Pace aus km/h als "m:ss" (min/km). */
export function fmtPace(kmh) {
  if (!(kmh > 0) || !Number.isFinite(kmh)) return '–';
  const s = Math.round(3600 / kmh);
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

// ---------- Eingabe ----------
/**
 * Zeit-Eingabe: "28:00", "1:02:05", "28.00", "28,5" oder nur Ziffern
 * ("2800" → 28:00, "10205" → 1:02:05; letzte zwei Ziffern = Sekunden).
 */
export function parseTime(str) {
  if (str == null) return null;
  const t = String(str).trim();
  if (!t || /[^\d:.,\s]/.test(t)) return null;
  let parts;
  if (/[:.,\s]/.test(t)) {
    parts = t.split(/[:.,\s]+/).filter(Boolean).map(Number);
  } else {
    parts = [+(t.slice(0, -4) || 0), +(t.slice(-4, -2) || 0), +t.slice(-2)];
  }
  if (!parts.length || parts.length > 3 || parts.some(n => !Number.isFinite(n))) return null;
  while (parts.length < 3) parts.unshift(0);
  const [h, m, s] = parts;
  return h * 3600 + m * 60 + s;
}

/** Zahl mit Dezimalkomma oder -punkt. */
export function parseNum(str) {
  if (str == null) return null;
  const t = String(str).trim().replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** Distanz in Metern: "7250", "7.250", "7,25 km", "7250 m". */
export function parseDist(str) {
  if (str == null) return null;
  const t = String(str).trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  const km = t.match(/^(\d+(?:[.,]\d+)?)km$/);
  if (km) return Math.round(parseFloat(km[1].replace(',', '.')) * 1000);
  const m = t.replace(/m$/, '').replace(/[.']/g, '');
  return /^\d+$/.test(m) ? Number(m) : null;
}

// ---------- Sprachausgabe ----------
export function sayDuration(sec) {
  const s = Math.round(Math.abs(sec));
  const m = Math.floor(s / 60), r = s % 60;
  const parts = [];
  if (m) parts.push(m === 1 ? 'eine Minute' : `${m} Minuten`);
  if (r || !m) parts.push(r === 1 ? 'eine Sekunde' : `${r} Sekunden`);
  return parts.join(' ');
}
export function sayDelta(sec) {
  if (bad(sec)) return '';
  if (Math.abs(sec) < 1.5) return 'genau im Plan';
  return `${sayDuration(sec)} ${sec > 0 ? 'Rückstand' : 'Vorsprung'}`;
}
