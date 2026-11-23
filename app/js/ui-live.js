// Ansicht „Fahrt“: Stoppuhr, Live-Werte, Zeitleiste, Karte, Kilometer-Schilder.

import { $, $$, esc, toast, confirmDialog, download, holdButton, keepAwake, fileStamp, safeName } from './dom.js';
import { state, bus, activePhase, setActive, setSettings } from './state.js';
import {
  liveStats, nextSplit, verdict, verdictText, speedFromTime,
  fmtClock, fmtDur, fmtDelta, fmtKmh, fmtKm, fmtDist, fmtNum, sayDelta, sayDuration, pad2,
} from './calc.js';
import { Tracker, createRun } from './tracker.js';
import { TileMap, applySource, bindMapControls } from './map.js';
import { renderTimeline } from './timeline.js';
import { runToGpx } from './gpx.js';
import { load, save, runs, requestPersist } from './store.js';
import { signal, unlockAudio } from './announce.js';

const SCALES = [1, 1.25, 1.5, 1.75, 2];

let tracker;
let map = null;
let visible = false;
let lastSave = 0;
let lastTimeline = 0;
let lastCount = null;
let firstFix = true;
const el = {};

export const getTracker = () => tracker;

export function initLive() {
  for (const id of ['live', 'livePhase', 'gpsBadge', 'clockCard', 'liveClock', 'liveDelta', 'liveWin', 'liveTimeline', 'liveTiles',
    'tSpeed', 'tAvg', 'tAvgK', 'tAvgU', 'tCorr', 'tCorrU', 'tCorrK', 'tCorrTile', 'tDist', 'tDistU', 'tDistBar', 'tEta', 'tEtaU', 'tEtaTile',
    'tNext', 'tNextU', 'tNextK', 'liveResult', 'splitLog', 'liveMap', 'btnMarkerTxt', 'tabLiveDot']) el[id] = $('#' + id);

  tracker = new Tracker(() => state.settings);
  const saved = load('run', null);
  if (saved?.win && ['armed', 'running', 'finished'].includes(saved.state)) {
    tracker.setRun(saved);
    if (saved.state !== 'finished' && state.settings.useGps) tracker.startGps();
    if (saved.state === 'running') keepAwake(state.settings.wakeLock);
  } else {
    tracker.setRun(createRun(activePhase()));
  }

  tracker.addEventListener('gps', onGps);
  tracker.addEventListener('run', e => { persist(true); renderAll(); if (e.detail?.type === 'start') map?.setTrack([], tracker.run.id); });
  tracker.addEventListener('marker', () => { persist(true); renderAll(); });
  tracker.addEventListener('split', e => onAutoSplit(e.detail));
  bus.addEventListener('phases', onPhases);
  bus.addEventListener('settings', onSettings);

  bindControls();
  setInterval(tick, 250);
  window.addEventListener('resize', () => { lastTimeline = 0; });
  renderAll();
}

export function showLive(on) {
  visible = on;
  if (on) {
    ensureMap();
    renderAll();
    map?.resize();
  }
}

// ---------- Ereignisse ----------
function onPhases() {
  const r = tracker.run;
  if (r.state === 'ready') {
    const p = activePhase();
    tracker.setRun(createRun(p));
  }
  updateRoute();
  renderAll();
}

function onSettings(e) {
  const k = Object.keys(e.detail || {});
  if (map && k.some(x => ['tiles', 'tileUrl', 'bigLabels'].includes(x))) applySource(map, el.liveMap, state.settings);
  if (k.includes('liveMap')) { ensureMap(); }
  if (k.includes('scale') || k.includes('theme')) { lastTimeline = 0; map?.invalidate(); }
  renderAll();
}

function onGps() {
  renderGps();
  if (map) {
    const fix = tracker.fix;
    if (fix && firstFix && map.follow) { map.z = Math.max(map.z, 16); firstFix = false; }
    map.setPosition(fix);
    map.setTrack(tracker.run.points, tracker.run.id);
  }
  if (tracker.run.state === 'running' && Date.now() - lastSave > 10000) persist(true);
}

function onAutoSplit(s) {
  if (!state.settings.autoSplits) return;
  signal(state.settings, 'split', `Kilometer ${kmWord(s.d)}. ${sayDelta(s.delta)}.`);
}

// ---------- Steuerung ----------
function bindControls() {
  $('#btnStart').addEventListener('click', () => { unlockAudio(); startRun(Date.now()); });
  $('#btnStartNow').addEventListener('click', () => { unlockAudio(); startRun(Date.now()); });
  $('#btnDisarm').addEventListener('click', () => tracker.disarm());
  $('#btnArm').addEventListener('click', openArm);
  $('#btnMarker').addEventListener('click', tapMarker);
  holdButton($('#btnStop'), 700, finishRun, 'Fahrt beenden – Ziel erreicht?');
  $('#btnNew').addEventListener('click', newRun);
  $('#btnGpx').addEventListener('click', () => downloadGpx(tracker.run));

  el.livePhase.addEventListener('change', () => setActive(el.livePhase.value));

  el.gpsBadge.addEventListener('click', () => {
    if (!state.settings.useGps) { toast('GPS ist unter Optionen ausgeschaltet'); return; }
    if (tracker.gpsOn && tracker.run.state !== 'running') tracker.stopGps();
    else if (!tracker.gpsOn) { tracker.startGps(); toast('GPS wird gesucht …'); }
  });

  $('#liveScale').addEventListener('click', () => {
    const i = SCALES.findIndex(s => s >= state.settings.scale - 0.01);
    const next = SCALES[(i + 1) % SCALES.length];
    setSettings({ scale: next });
    toast(`Schrift ${Math.round(next * 100)} %`);
  });

  const full = $('#liveFull');
  full.hidden = !document.fullscreenEnabled || matchMedia('(display-mode: standalone)').matches;
  full.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => toast('Vollbild nicht möglich'));
  });

  const menu = $('#liveMenu');
  $('#liveMenuBtn').addEventListener('click', () => {
    const st = tracker.run.state;
    $$('[data-only]', menu).forEach(x => { x.hidden = !x.dataset.only.split(' ').includes(st); });
    $('#mUndo').disabled = !tracker.run.markers.length;
    menu.showModal();
  });
  $('#mClose').addEventListener('click', () => menu.close());
  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-adj]');
    if (!b) return;
    const ms = Number(b.dataset.adj);
    tracker.adjustStart(ms);
    toast(`Startzeit ${ms > 0 ? '+' : '−'}${Math.abs(ms) / 1000} s korrigiert`);
  });
  $('#mUndo').addEventListener('click', () => { menu.close(); undoMarker(); });
  $('#mMap').addEventListener('click', () => { menu.close(); setSettings({ liveMap: !state.settings.liveMap }); });
  $('#mDiscard').addEventListener('click', async () => {
    menu.close();
    if (await confirmDialog('Diese Fahrt verwerfen? Sie wird nicht gespeichert.', { ok: 'Verwerfen', danger: true })) {
      tracker.stopGps();
      keepAwake(false);
      tracker.setRun(createRun(activePhase()));
      save('run', null);
    }
  });

  // Start-um-Dialog
  const dlg = $('#armDlg');
  const input = $('#armTime');
  const setIn = ms => {
    const d = new Date(ms);
    input.value = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  };
  const chips = $('#armChips');
  chips.innerHTML = ['+1 min', '+2 min', '+5 min', '+10 min'].map((l, i) => `<button type="button" class="chip" data-min="${[1, 2, 5, 10][i]}">${l}</button>`).join('');
  chips.addEventListener('click', e => {
    const b = e.target.closest('[data-min]');
    if (b) setIn(Math.ceil((Date.now() + Number(b.dataset.min) * 60000) / 60000) * 60000);
  });
  dlg.openWith = () => { setIn(Math.ceil((Date.now() + 120000) / 60000) * 60000); dlg.showModal(); };
  $('#armCancel').addEventListener('click', () => dlg.close());
  $('#armOk').addEventListener('click', () => {
    const [h, m, s = 0] = input.value.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) { toast('Uhrzeit eingeben'); return; }
    const d = new Date();
    d.setHours(h, m, s, 0);
    if (d.getTime() <= Date.now()) { toast('Uhrzeit liegt in der Vergangenheit'); return; }
    if (d.getTime() - Date.now() > 12 * 3600e3) { toast('Mehr als 12 Stunden entfernt'); return; }
    dlg.close();
    unlockAudio();
    if (state.settings.useGps) tracker.startGps();
    tracker.arm(d.getTime());
    lastCount = null;
    toast(`Start um ${input.value}`);
  });
}

function openArm() {
  if (!tracker.run.win) { toast('Phase unvollständig – siehe Plan'); return; }
  $('#armDlg').openWith();
}

function startRun(at) {
  if (!tracker.run.win) { toast('Phase unvollständig – siehe Plan'); return; }
  if (state.settings.useGps) tracker.startGps();
  tracker.start(at);
  keepAwake(state.settings.wakeLock);
  signal(state.settings, 'go', 'Los');
  requestPersist();
}

function tapMarker() {
  const m = tracker.addMarker();
  if (!m) { toast('Ziel-Distanz bereits erreicht – zum Beenden „Ziel“ halten'); return; }
  const label = m.d >= tracker.run.win.distM ? 'Ziel' : `km ${kmWord(m.d)}`;
  signal(state.settings, 'split', `${label === 'Ziel' ? 'Ziel' : 'Kilometer ' + kmWord(m.d)}. ${sayDelta(m.delta)}.`);
  toast(`${label}: ${fmtDelta(m.delta)}`, { action: 'Rückgängig', onAction: undoMarker, ms: 6000 });
}

function undoMarker() {
  const m = tracker.undoMarker();
  if (m) toast(`Schild km ${kmWord(m.d)} zurückgenommen`);
}

async function finishRun() {
  tracker.finish();
  tracker.stopGps();
  keepAwake(false);
  const r = tracker.run;
  const v = verdict(r.win, (r.endAt - r.startAt) / 1000, state.settings.penaltyPerSec);
  signal(state.settings, v.kind === 'ok' ? 'ok' : 'warn', v.kind === 'ok' ? 'Im Zeitfenster' : `${sayDuration(v.sec)} zu ${v.kind === 'early' ? 'früh' : 'spät'}`);
  try {
    const { anchor, ...keep } = r;
    await runs.put(keep);
  } catch (e) {
    toast('Fahrt konnte nicht im Verlauf gespeichert werden');
    console.error(e);
  }
  bus.dispatchEvent(new CustomEvent('runs'));
}

function newRun() {
  tracker.setRun(createRun(activePhase()));
  save('run', null);
  firstFix = true;
}

export function downloadGpx(run) {
  if (!run.points?.length && !run.markers?.some(m => m.lat != null)) { toast('Keine GPS-Daten in dieser Fahrt'); return; }
  download(`${safeName(run.phase?.name)}_${fileStamp(run.startAt)}.gpx`, runToGpx(run), 'application/gpx+xml');
}

function persist(force) {
  const r = tracker.run;
  if (r.state === 'ready') return;
  if (force || Date.now() - lastSave > 10000) {
    save('run', r);
    lastSave = Date.now();
  }
}

// ---------- Takt ----------
function tick() {
  const r = tracker.run;
  const now = Date.now();
  if (r.state === 'armed') {
    const left = (r.armedAt - now) / 1000;
    if (left <= 0) startRun(r.armedAt);
    else {
      const s = Math.ceil(left);
      if (s !== lastCount && (s <= 5 || s === 10 || s === 30 || s === 60)) {
        lastCount = s;
        const say = s === 60 ? 'Start in einer Minute' : s === 30 ? 'Start in 30 Sekunden' : s === 10 ? 'Start in 10 Sekunden' : null;
        signal(state.settings, 'tick', say);
      }
    }
  }
  if (r.state === 'running') {
    timeAlerts(now);
    persist(false);
  }
  el.tabLiveDot.hidden = !(r.state === 'running' || r.state === 'armed') || visible;
  if (visible) renderDynamic(now);
}

function timeAlerts(now) {
  const s = state.settings;
  const r = tracker.run, w = r.win, a = r.alerts;
  const t = tracker.elapsed(now);
  const fire = (key, at, kind, text) => {
    if (a[key] || t < at) return;
    a[key] = 1;
    if (s.timeAlerts && t - at < 30) signal(s, kind, text); // nach Reload keine alten Alarme nachholen
  };
  if (w.tMin > 0) fire('min', w.tMin, 'ok', 'Mindestzeit erreicht');
  if (w.tMax - 60 > (w.tMin || 0)) fire('pre', w.tMax - 60, 'warn', 'Noch eine Minute bis zur erlaubten Zeit');
  fire('max', w.tMax, 'alarm', 'Erlaubte Zeit überschritten');
}

// ---------- Darstellung ----------
function ensureMap() {
  const on = state.settings.liveMap;
  el.live.classList.toggle('nomap', !on);
  if (!on || map || !visible) return;
  map = new TileMap(el.liveMap);
  bindMapControls(el.liveMap, map);
  applySource(map, el.liveMap, state.settings);
  updateRoute();
  map.setTrack(tracker.run.points, tracker.run.id);
  map.setPosition(tracker.fix);
  updateMapMarkers();
  if (tracker.fix) { map.z = 16; firstFix = false; }
  else if (map.route.length || map.track.length) map.fit();
}

function updateRoute() {
  if (!map) return;
  const p = state.phases.find(x => x.id === tracker.run.phase.id) || activePhase();
  map.setRoute(p.route || []);
}

function updateMapMarkers() {
  if (!map) return;
  map.setMarkers(tracker.run.markers.map(m => ({ lat: m.lat, lon: m.lon, label: m.d >= tracker.run.win.distM ? 'Z' : kmWord(m.d) })));
}

const kmWord = d => (d / 1000).toLocaleString('de-DE', { maximumFractionDigits: 2 });

function renderGps() {
  const st = state.settings.useGps ? tracker.gpsState : 'off';
  el.gpsBadge.dataset.gps = st;
  const acc = tracker.fix ? Math.round(tracker.fix.acc) : null;
  el.gpsBadge.textContent = {
    off: 'GPS aus', wait: 'GPS …', ok: `GPS ±${acc} m`, weak: `GPS ±${acc} m`,
    denied: 'GPS gesperrt', error: 'GPS Fehler', unsupported: 'kein GPS',
  }[st] || 'GPS';
  el.gpsBadge.title = st === 'weak' ? 'Ungenau – Punkte werden ignoriert' : st === 'denied' ? 'Standortfreigabe im Browser erlauben' : '';
}

function renderAll() {
  const r = tracker.run;
  el.live.dataset.state = r.state;
  $$('[data-only]', $('#liveCtl')).forEach(b => { b.hidden = !b.dataset.only.split(' ').includes(r.state); });

  el.livePhase.innerHTML = state.phases.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  if (!state.phases.some(p => p.id === r.phase.id)) el.livePhase.insertAdjacentHTML('afterbegin', `<option value="${r.phase.id}">${esc(r.phase.name)}</option>`);
  el.livePhase.value = r.phase.id;
  el.livePhase.hidden = r.state !== 'ready';

  const w = r.win;
  el.liveWin.textContent = w
    ? `${r.state === 'ready' ? '' : r.phase.name + ' · '}${fmtDist(w.distM)} · Fenster ${w.tMin ? fmtDur(w.tMin) : '0'}–${fmtDur(w.tMax)} · Ziel ${fmtDur(w.tTarget)}`
    : 'Phase unvollständig – bitte unter „Plan“ ergänzen';

  // Schild-Liste
  const ms = [...r.markers].reverse();
  const shown = r.state === 'finished' ? ms : ms.slice(0, 4);
  el.splitLog.innerHTML = shown.map(m => `
    <li><span>${m.d >= (w?.distM ?? Infinity) ? 'Ziel' : 'km ' + kmWord(m.d)} · ${fmtClock(m.t / 1000)}</span>
    <span class="dl ${dlClass(m.delta)}">${fmtDelta(m.delta)}</span></li>`).join('');

  // Ergebnis
  const fin = r.state === 'finished' && w;
  el.liveTiles.hidden = !!fin;
  el.liveResult.hidden = !fin;
  if (fin) renderResult(r);

  renderGps();
  updateMapMarkers();
  lastTimeline = 0;
  renderDynamic(Date.now());
}

const dlClass = d => (d > 1.5 ? 'behind' : d < -1.5 ? 'ahead' : 'onplan');

function renderResult(r) {
  const w = r.win;
  const T = (r.endAt - r.startAt) / 1000;
  const v = verdict(w, T, state.settings.penaltyPerSec);
  el.liveResult.dataset.kind = v.kind;
  el.liveResult.innerHTML = `
    <dl class="kv">
      <div><dt>Zeit</dt><dd>${fmtClock(T)}</dd></div>
      <div><dt>gegen Zielzeit</dt><dd>${fmtDelta(T - w.tTarget)}</dd></div>
      <div><dt>Strafpunkte</dt><dd>${fmtNum(v.points, 2)}</dd></div>
      <div><dt>Ø Tempo (Strecke)</dt><dd>${fmtKmh(speedFromTime(w.distM, T))} <small>km/h</small></dd></div>
      ${r.gpsDist ? `<div><dt>GPS-Distanz</dt><dd>${fmtDist(r.gpsDist)}</dd></div>` : ''}
    </dl>
    <p class="hint">Gespeichert im Verlauf.</p>`;
}

function renderDynamic(now) {
  const r = tracker.run;
  const w = r.win;
  const s = state.settings;
  if (!w) {
    el.liveClock.textContent = '–';
    el.liveDelta.textContent = 'Phase unvollständig';
    el.clockCard.dataset.status = '';
    el.liveTimeline.innerHTML = '';
    return;
  }
  const t = tracker.elapsed(now);
  el.liveClock.textContent = fmtClock(r.state === 'ready' ? 0 : t);

  const inp = r.state === 'running' ? tracker.statInput(now) : { t: 0, d: 0, src: null };
  const st = liveStats(w, inp.t, inp.d);
  let status = '';
  let deltaText;

  if (r.state === 'ready') deltaText = 'bereit';
  else if (r.state === 'armed') {
    const d = new Date(r.armedAt);
    deltaText = `Start um ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  } else if (r.state === 'finished') {
    const v = verdict(w, t, s.penaltyPerSec);
    status = v.kind;
    deltaText = (v.kind === 'ok' ? '✓ ' : '') + verdictText(v);
  } else if (st.delta != null) {
    status = st.status || '';
    const a = Math.abs(st.delta);
    deltaText = a < 1.5 ? '±0:00 im Plan' : `${fmtDelta(st.delta)} ${st.delta > 0 ? 'hinter Plan' : 'vor Plan'}`;
    if (inp.src === 'marker') deltaText += ` (bei km ${kmWord(inp.d)})`;
  } else {
    deltaText = s.useGps && tracker.gpsState !== 'denied' ? 'läuft · warte auf GPS oder Km-Schild' : 'läuft · beim Km-Schild tippen';
  }
  el.clockCard.dataset.status = status;
  el.liveDelta.textContent = deltaText;

  if (r.state !== 'finished') renderTiles(r, w, st, inp, t, now);

  // nächstes Schild (Knopfbeschriftung)
  if (r.state === 'running') {
    const nd = tracker.nextMarkerDist();
    el.btnMarkerTxt.textContent = nd == null ? 'Km-Schild' : nd >= w.distM ? 'Ziel-Schild' : `Schild ${kmWord(nd)}`;
  }

  if (now - lastTimeline > 1000) {
    lastTimeline = now;
    const running = r.state === 'running' || r.state === 'finished';
    renderTimeline(el.liveTimeline, {
      win: w,
      t: running ? t : null,
      projected: r.state === 'running' ? st.projected : null,
      status: st.status,
      stepM: s.markerStepM,
      actual: r.markers.map(m => ({ t: m.t / 1000, delta: m.delta })),
    });
  }
}

function renderTiles(r, w, st, inp, t, now) {
  const running = r.state === 'running';
  const v = tracker.speedKmh(now);
  el.tSpeed.textContent = fmtKmh(v);

  // Ø-Tempo bzw. vor dem Start: Ziel-Tempo
  if (running && st.vAvg != null) {
    el.tAvgK.textContent = 'Ø Tempo';
    el.tAvg.textContent = fmtKmh(st.vAvg);
    el.tAvgU.textContent = `km/h · Ziel ${fmtKmh(w.vTarget)}`;
  } else {
    el.tAvgK.textContent = 'Ziel-Tempo';
    el.tAvg.textContent = fmtKmh(w.vTarget);
    el.tAvgU.textContent = `km/h · ${fmtNum(w.vTarget * 1000 / 60, 0)} m/min`;
  }

  // Tempo-Korridor für den Rest
  let corrStatus = '';
  if (st.vSlow == null) {
    el.tCorr.textContent = '–';
    el.tCorrU.textContent = 'km/h · braucht GPS oder Km-Schild';
  } else if (st.vSlow === Infinity) {
    el.tCorr.textContent = 'zu spät';
    el.tCorrU.textContent = 'erlaubte Zeit nicht mehr erreichbar';
    corrStatus = 'late';
  } else {
    el.tCorr.textContent = `${fmtKmh(st.vSlow)} – ${fmtKmh(st.vFast)}`;
    el.tCorrU.textContent = `km/h · für Zielzeit ${fmtKmh(st.vReq)}`;
    if (running && v != null && inp.src === 'gps' && v > 1) corrStatus = v < st.vSlow ? 'late' : v > st.vFast ? 'early' : 'ok';
  }
  el.tCorrK.textContent = running ? 'Tempo-Fenster für den Rest' : 'Erlaubtes Ø-Tempo';
  el.tCorrTile.dataset.status = corrStatus;

  // Distanz
  const d = running ? inp.d : 0;
  el.tDist.textContent = d == null ? '–' : fmtKm(d);
  el.tDistU.textContent = d == null ? 'km' : `km${inp.src === 'marker' ? ' (Schild)' : ''} · Rest ${fmtDist(Math.max(0, w.distM - d))}`;
  el.tDistBar.style.width = `${Math.min(100, Math.max(0, (d || 0) / w.distM * 100))}%`;

  // Hochrechnung
  if (running && st.projected != null) {
    el.tEta.textContent = fmtDur(st.projected);
    el.tEtaU.textContent = st.status === 'ok' ? 'im Fenster' : st.status === 'early' ? `${fmtDur(w.tMin - st.projected)} zu früh` : `${fmtDur(st.projected - w.tMax)} zu spät`;
    el.tEtaTile.dataset.status = st.status;
  } else {
    el.tEta.textContent = '–';
    el.tEtaU.textContent = running ? 'ab ca. 150 m' : `Fenster ${w.tMin ? fmtDur(w.tMin) : '0'}–${fmtDur(w.tMax)}`;
    el.tEtaTile.dataset.status = '';
  }

  // Nächster Zwischenpunkt (nach Schild-Abstand)
  const ns = nextSplit(w, running ? (inp.d ?? 0) : 0, state.settings.markerStepM);
  if (ns) {
    const name = ns.d >= w.distM ? 'Ziel' : `km ${kmWord(ns.d)}`;
    el.tNextK.textContent = `Soll-Zeit ${name}`;
    el.tNext.textContent = fmtDur(ns.tTarget);
    const tt = running ? t : 0;
    const left = ns.tTarget - tt;
    el.tNextU.textContent = `${running ? (left >= 0 ? `in ${fmtDur(left)}` : `${fmtDur(-left)} überfällig`) + ' · ' : ''}Fenster ${ns.tMin ? fmtDur(ns.tMin) : '0'}–${fmtDur(ns.tMax)}`;
  } else {
    el.tNextK.textContent = 'Soll-Zeit';
    el.tNext.textContent = '–';
    el.tNextU.textContent = 'Ziel erreicht';
  }
}

// Für Tests/Simulation im Browser (tools/smoke.mjs)
export const _debug = { get tracker() { return tracker; }, finishRun: () => finishRun(), tapMarker: () => tapMarker() };
