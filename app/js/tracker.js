// Fahrt-Aufzeichnung: Stoppuhr, GPS-Track, Distanz, Kilometer-Schilder.
// Der Zustand steckt komplett im serialisierbaren `run`-Objekt (wird nach Reload wiederhergestellt).

import { haversine } from './geo.js';
import { phaseWindow, planTimeAt } from './calc.js';
import { uid } from './state.js';

const MAX_MPS = 15;          // > 54 km/h zwischen zwei Punkten = GPS-Sprung, verwerfen
const SPEED_STALE_MS = 8000; // ohne neue Bewegung gilt Tempo 0

export function createRun(phase) {
  const { route, ...rest } = phase; // Strecke nicht in jede Fahrt kopieren
  return {
    id: uid(),
    phase: structuredClone(rest),
    win: phaseWindow(phase),
    state: 'ready',          // ready | armed | running | finished
    armedAt: null,           // geplanter Start (epoch ms)
    startAt: null,
    endAt: null,
    points: [],              // [ts, lat, lon, acc, ele]
    gpsDist: 0,              // rohe GPS-Distanz (m)
    offset: 0,               // Korrektur durch Kilometer-Schilder
    markers: [],             // { t (ms seit Start), d, delta, lat, lon, gps, prevOffset }
    anchor: null,
    rejected: 0,
    announcedMax: 0,         // höchster bereits angesagter Kilometer
    alerts: {},
  };
}

export class Tracker extends EventTarget {
  constructor(getSettings) {
    super();
    this.getSettings = getSettings;
    this.run = null;
    this.fix = null;
    this.watchId = null;
    this.gpsState = 'off'; // off | wait | ok | weak | denied | error | unsupported
    this.vEma = null;
    this.vTs = 0;
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  // ---------- GPS ----------
  get gpsOn() { return this.watchId != null; }

  startGps() {
    if (this.watchId != null) return;
    if (!('geolocation' in navigator)) { this.gpsState = 'unsupported'; this.emit('gps'); return; }
    this.gpsState = 'wait';
    this.watchId = navigator.geolocation.watchPosition(
      p => this.onPosition(p),
      e => this.onGpsError(e),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 },
    );
    this.emit('gps');
  }

  stopGps(state = 'off') {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.gpsState = state;
    this.vEma = null;
    this.emit('gps');
  }

  onGpsError(e) {
    if (e.code === 1) return this.stopGps('denied');
    this.gpsState = e.code === 3 ? 'wait' : 'error';
    this.emit('gps');
  }

  /** Auch direkt aufrufbar (Tests/Simulation): { coords: {...}, timestamp? } */
  onPosition(p, ts = Date.now()) {
    const c = p.coords;
    const fix = { ts, lat: c.latitude, lon: c.longitude, acc: c.accuracy ?? 999, ele: c.altitude ?? null, spd: c.speed ?? null, hdg: c.heading ?? null };
    const s = this.getSettings();
    this.fix = fix;
    this.gpsState = fix.acc <= s.maxAcc ? 'ok' : 'weak';
    if (Number.isFinite(fix.spd) && fix.spd >= 0) this.updateSpeed(fix.spd, ts);
    if (this.run?.state === 'running') this.record(fix, s);
    this.emit('gps');
  }

  updateSpeed(mps, ts) {
    this.vEma = this.vEma == null || ts - this.vTs > SPEED_STALE_MS ? mps : this.vEma + 0.4 * (mps - this.vEma);
    this.vTs = ts;
  }

  /** Aktuelles Tempo in km/h; null ohne GPS. */
  speedKmh(now = Date.now()) {
    if (!this.fix) return null;
    if (this.vEma == null || now - this.vTs > SPEED_STALE_MS) return this.gpsOn ? 0 : null;
    return this.vEma * 3.6;
  }

  record(fix, s) {
    const r = this.run;
    if (fix.acc > s.maxAcc || fix.ts < r.startAt) { r.rejected++; return; }
    const pt = [fix.ts, +fix.lat.toFixed(6), +fix.lon.toFixed(6), Math.round(fix.acc), fix.ele == null ? null : Math.round(fix.ele * 10) / 10];
    const a = r.anchor;
    if (!a) {
      r.anchor = pt;
      r.points.push(pt);
      return;
    }
    const dt = (pt[0] - a[0]) / 1000;
    if (dt <= 0) return;
    const dd = haversine(a[1], a[2], pt[1], pt[2]);
    if (dd < Math.max(3, Math.min(fix.acc, 20) * 0.4)) return; // Zittern im Stand
    if (dd / dt > MAX_MPS) { r.rejected++; return; }
    r.gpsDist += dd;
    r.anchor = pt;
    r.points.push(pt);
    if (!(Number.isFinite(fix.spd) && fix.spd >= 0)) this.updateSpeed(dd / dt, fix.ts);
    this.checkAutoSplit(fix.ts);
  }

  checkAutoSplit(now) {
    const r = this.run;
    const step = this.getSettings().markerStepM || 1000;
    const d = this.distance();
    const k = Math.floor((d + 1e-6) / step);
    if (k > r.announcedMax && k * step < r.win.distM) {
      r.announcedMax = k;
      const t = (now - r.startAt) / 1000;
      const split = { d: k * step, t: now - r.startAt, delta: t - planTimeAt(r.win, k * step) };
      (r.autoSplits ??= []).push(split);
      this.emit('split', split);
    }
  }

  // ---------- Fahrt ----------
  setRun(run) {
    this.run = run;
    this.emit('run', { type: 'load' });
  }

  arm(at) {
    Object.assign(this.run, { state: 'armed', armedAt: at });
    this.emit('run', { type: 'arm' });
  }

  disarm() {
    Object.assign(this.run, { state: 'ready', armedAt: null });
    this.emit('run', { type: 'disarm' });
  }

  start(at = Date.now()) {
    Object.assign(this.run, {
      state: 'running', startAt: at, armedAt: null, endAt: null,
      points: [], gpsDist: 0, offset: 0, markers: [], autoSplits: [], anchor: null, rejected: 0, announcedMax: 0, alerts: {},
    });
    this.emit('run', { type: 'start' });
  }

  finish(at = Date.now()) {
    const r = this.run;
    r.finalGpsDist = r.gpsDist;
    Object.assign(r, { state: 'finished', endAt: at });
    this.emit('run', { type: 'finish' });
  }

  /** Startzeit verschieben (ms > 0: Start war später → weniger verstrichene Zeit). */
  adjustStart(ms) {
    if (this.run.state !== 'running') return;
    this.run.startAt += ms;
    this.emit('run', { type: 'adjust' });
  }

  elapsed(now = Date.now()) {
    const r = this.run;
    if (!r) return 0;
    if (r.state === 'running') return (now - r.startAt) / 1000;
    if (r.state === 'finished') return (r.endAt - r.startAt) / 1000;
    if (r.state === 'armed') return (now - r.armedAt) / 1000;
    return 0;
  }

  hasGps() { return this.run.points.length > 0; }

  /** Beste bekannte Distanz (m): GPS + Schild-Korrektur, sonst letztes Schild, sonst null. */
  distance() {
    const r = this.run;
    if (this.hasGps()) return Math.max(0, r.gpsDist + r.offset);
    const last = r.markers.at(-1);
    return last ? last.d : null;
  }

  /** Zeit/Distanz-Paar für Live-Werte. Ohne GPS zählt der Stand am letzten Schild. */
  statInput(now = Date.now()) {
    const r = this.run;
    const t = this.elapsed(now);
    if (this.hasGps()) return { t, d: this.distance(), src: 'gps' };
    const last = r.markers.at(-1);
    if (last) return { t: last.t / 1000, d: last.d, src: 'marker' };
    return { t, d: null, src: null };
  }

  /** Distanz, auf die das nächste getippte Schild einrastet (null = Ziel schon erreicht). */
  nextMarkerDist() {
    const r = this.run;
    const step = this.getSettings().markerStepM || 1000;
    const D = r.win.distM;
    const lastD = r.markers.at(-1)?.d ?? 0;
    if (lastD >= D) return null;
    let d = lastD + step;
    if (this.hasGps()) {
      const g = Math.round(this.distance() / step) * step;
      if (g > lastD) d = g;
    }
    return Math.min(d, D);
  }

  /** Kilometer-Schild passiert: Distanz auf das Schild einrasten. */
  addMarker(now = Date.now()) {
    const r = this.run;
    if (r.state !== 'running') return null;
    const step = this.getSettings().markerStepM || 1000;
    const d = this.nextMarkerDist();
    if (d == null) return null;
    const t = now - r.startAt;
    const fresh = this.fix && now - this.fix.ts < 15000;
    const m = {
      t, d,
      delta: t / 1000 - planTimeAt(r.win, d),
      lat: fresh ? +this.fix.lat.toFixed(6) : null,
      lon: fresh ? +this.fix.lon.toFixed(6) : null,
      gps: r.gpsDist,
      prevOffset: r.offset,
    };
    r.markers.push(m);
    if (this.hasGps()) r.offset = d - r.gpsDist;
    r.announcedMax = Math.max(r.announcedMax, Math.round(d / step));
    this.emit('marker', m);
    return m;
  }

  undoMarker() {
    const r = this.run;
    const m = r.markers.pop();
    if (!m) return null;
    r.offset = m.prevOffset;
    this.emit('marker', null);
    return m;
  }
}
