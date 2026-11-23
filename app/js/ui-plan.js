// Ansicht „Plan“: Phasen verwalten, Zeitfenster und Zwischenzeiten (statische Version).

import { $, $$, esc, icon, toast, confirmDialog, readFile, setSeg, onSeg, renderChips } from './dom.js';
import { state, bus, activePhase, setActive, updatePhase, addPhase, removePhase } from './state.js';
import {
  phaseWindow, splitTable, fmtDur, fmtDist, fmtKmh, fmtPace, fmtNum, kmhToMpm, speedFromTime,
  parseTime, parseNum, parseDist, minTimeOffset, MIN_TIME_LIMIT_M,
} from './calc.js';
import { parseGpx } from './gpx.js';
import { pathLength, thin } from './geo.js';
import { renderTimeline } from './timeline.js';

const BUFFERS = [0, 10, 15, 20, 30, 45, 60];
const STEPS = [250, 500, 1000];

let f = {};
let formFor = null;

const numStr = v => (v == null ? '' : String(v).replace('.', ','));
const mark = (el, bad) => el.classList.toggle('bad', !!bad);

export function initPlan() {
  f = {
    name: $('#pName'), dist: $('#pDist'), speed: $('#pSpeed'), tmax: $('#pTmax'), tmin: $('#pTmin'), step: $('#pStep'),
    mode: $('#pMode'), minRule: $('#pMinRule'),
  };
  const cur = () => activePhase();
  const patch = p => updatePhase(cur().id, p);

  $('#phaseForm').addEventListener('submit', e => e.preventDefault());
  f.name.addEventListener('input', () => patch({ name: f.name.value.trim() || 'Phase' }));

  f.dist.addEventListener('input', () => {
    const v = parseDist(f.dist.value);
    mark(f.dist, !(v > 0));
    if (v > 0) patch({ distM: v });
  });
  f.dist.addEventListener('change', () => { f.dist.value = cur().distM; mark(f.dist, false); });

  f.speed.addEventListener('input', () => {
    const v = parseNum(f.speed.value);
    const ok = v > 0 && v < 100;
    mark(f.speed, !ok);
    if (ok) patch({ speedKmh: v });
  });
  f.speed.addEventListener('change', () => { f.speed.value = numStr(cur().speedKmh); mark(f.speed, false); });

  f.tmax.addEventListener('input', () => {
    const v = parseTime(f.tmax.value);
    mark(f.tmax, !(v > 0));
    if (v > 0) patch({ tMaxSec: v });
  });
  f.tmax.addEventListener('change', () => { f.tmax.value = fmtDur(cur().tMaxSec); mark(f.tmax, false); });

  f.tmin.addEventListener('input', () => {
    const v = parseTime(f.tmin.value);
    mark(f.tmin, v == null);
    if (v != null) patch({ tMinSec: v });
  });
  f.tmin.addEventListener('change', () => { f.tmin.value = fmtDur(cur().tMinSec); mark(f.tmin, false); });

  f.step.addEventListener('input', () => {
    const v = parseDist(f.step.value);
    mark(f.step, !(v > 0));
    if (v > 0) patch({ stepM: v });
  });
  f.step.addEventListener('change', () => { f.step.value = cur().stepM; mark(f.step, false); });

  onSeg(f.mode, v => {
    const p = cur();
    if (v === p.mode) return;
    const win = phaseWindow(p);
    // Wert mitnehmen: Tempo → Zeit bzw. Zeit → Tempo
    if (v === 'time' && win) { patch({ mode: v, tMaxSec: win.tMax }); f.tmax.value = fmtDur(win.tMax); }
    else if (v === 'speed' && win) {
      const kmh = Math.round(speedFromTime(p.distM, win.tMax) * 10) / 10;
      patch({ mode: v, speedKmh: kmh });
      f.speed.value = numStr(kmh);
    } else patch({ mode: v });
  });

  onSeg(f.minRule, v => {
    const p = cur();
    const win = phaseWindow(p);
    if (v === 'manual' && win && p.minRule !== 'manual') {
      const tMin = win.tMin || Math.max(0, win.tMax - minTimeOffset(p.distM));
      patch({ minRule: v, tMinSec: tMin });
      f.tmin.value = fmtDur(tMin);
    } else patch({ minRule: v });
  });

  $('#phaseBar').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.add != null) { addPhase(); toast('Neue Phase angelegt'); }
    else if (b.dataset.id) setActive(b.dataset.id);
  });

  $('#pCopy').addEventListener('click', () => { addPhase(cur()); toast('Phase dupliziert'); });
  $('#pDelete').addEventListener('click', async () => {
    const p = cur();
    if (await confirmDialog(`Phase „${p.name}“ löschen?`, { ok: 'Löschen', danger: true })) removePhase(p.id);
  });

  $('#pRouteLoad').addEventListener('click', loadRoute);
  $('#pRouteClear').addEventListener('click', () => patch({ route: null }));
  $('#planPrint').addEventListener('click', () => window.print());

  bus.addEventListener('phases', render);
  bus.addEventListener('settings', render);
  let raf = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); });
  render();
}

async function loadRoute() {
  const text = await readFile('.gpx,application/gpx+xml,application/xml,text/xml');
  if (!text) return;
  const g = parseGpx(text);
  if (g.points.length < 2) { toast('Keine Track- oder Routenpunkte in der Datei'); return; }
  const route = thin(g.points, 5).map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)]);
  const p = activePhase();
  updatePhase(p.id, { route });
  const len = Math.round(pathLength(route));
  toast(`Strecke geladen: ${fmtDist(len)}`, {
    action: 'Als Distanz',
    ms: 6000,
    onAction: () => { updatePhase(p.id, { distM: len }); f.dist.value = len; },
  });
}

/** Neu zeichnen (z. B. nach Sichtbarwerden, damit die Zeitleiste die richtige Breite hat). */
export function refreshPlan() { render(); }

function fillForm(p) {
  formFor = p.id;
  f.name.value = p.name;
  f.dist.value = p.distM || '';
  f.speed.value = numStr(p.speedKmh);
  f.tmax.value = p.tMaxSec ? fmtDur(p.tMaxSec) : '';
  f.tmin.value = p.tMinSec ? fmtDur(p.tMinSec) : '';
  f.step.value = p.stepM || '';
  $$('input', $('#phaseForm')).forEach(i => i.classList.remove('bad'));
}

function render() {
  const p = activePhase();
  if (formFor !== p.id) fillForm(p);
  const win = phaseWindow(p);

  // Phasen-Leiste
  $('#phaseBar').innerHTML = state.phases.map(x =>
    `<button type="button" class="chip" role="tab" data-id="${x.id}" aria-selected="${x.id === p.id}" aria-pressed="${x.id === p.id}">${esc(x.name)}</button>`,
  ).join('') + `<button type="button" class="chip add" data-add aria-label="Phase hinzufügen">${icon('plus')}Phase</button>`;

  // Sichtbarkeit / Schalter
  setSeg(f.mode, p.mode);
  setSeg(f.minRule, p.minRule);
  $$('[data-mode]').forEach(el => { el.hidden = el.dataset.mode !== p.mode; });
  $$('[data-min]').forEach(el => { el.hidden = el.dataset.min !== p.minRule; });

  // Hinweise
  $('#pDistHint').textContent = p.distM > 0 ? `= ${fmtDist(p.distM)}` : '';
  $('#pTmaxHint').textContent = p.mode === 'time' && win ? `= ${fmtDur(win.tMax)} · entspricht ${fmtKmh(win.vSlow)} km/h` : '';
  const over = p.distM > MIN_TIME_LIMIT_M;
  $('#pMinHint').textContent = {
    auto: `${over ? '2 Minuten' : '1 Minute'} unter der erlaubten Zeit (Strecke ${over ? 'über' : 'bis'} 3000 m)`,
    manual: '',
    none: 'Ohne Mindestzeit – nur die erlaubte Zeit zählt.',
  }[p.minRule] || '';
  const tminHint = $('#pTminHint');
  const tooBig = p.minRule === 'manual' && win && p.tMinSec > win.tMax;
  tminHint.textContent = tooBig ? 'Größer als die erlaubte Zeit – wird begrenzt.' : '';
  tminHint.classList.toggle('bad', !!tooBig);
  const routeLen = p.route?.length > 1 ? pathLength(p.route) : 0;
  $('#pRouteHint').textContent = routeLen ? `Strecke: ${fmtDist(routeLen)} (${p.route.length} Punkte) – wird auf der Karte angezeigt.` : 'GPX-Datei des Parcours oder einer früheren Fahrt.';
  $('#pRouteClear').hidden = !routeLen;

  // Chips
  renderChips($('#pSpeedChips'), state.settings.speedPresets.map(v => ({ v, label: `${numStr(v)} km/h` })), p.speedKmh, v => {
    updatePhase(p.id, { speedKmh: v });
    f.speed.value = numStr(v);
  });
  renderChips($('#pBuffer'), BUFFERS.map(v => ({ v, label: `${v} s` })), p.bufferSec, v => updatePhase(p.id, { bufferSec: v }));
  renderChips($('#pStepChips'), STEPS.map(v => ({ v, label: fmtDist(v) })), p.stepM, v => {
    updatePhase(p.id, { stepM: v });
    f.step.value = v;
  });

  renderResult(p, win);
}

function renderResult(p, win) {
  const res = $('#planResult');
  const sp = $('#planSplits');
  if (!win) {
    res.innerHTML = '<p class="empty">Distanz und Höchsttempo bzw. erlaubte Zeit eingeben.</p>';
    sp.innerHTML = '';
    return;
  }
  res.innerHTML = `
    <h2>${esc(p.name)} · ${fmtDist(win.distM)}</h2>
    <dl class="kv">
      <div><dt>Mindestzeit</dt><dd>${win.tMin ? fmtDur(win.tMin) : '–'}</dd></div>
      <div class="em"><dt>Zielzeit</dt><dd>${fmtDur(win.tTarget)}</dd></div>
      <div><dt>Erlaubte Zeit</dt><dd>${fmtDur(win.tMax)}</dd></div>
    </dl>
    <dl class="kv">
      <div class="em"><dt>Ziel-Tempo</dt><dd>${fmtKmh(win.vTarget)} <small>km/h</small></dd></div>
      <div><dt>Erlaubtes Ø-Tempo</dt><dd>${fmtKmh(win.vSlow)}–${fmtKmh(win.vFast)} <small>km/h</small></dd></div>
      <div><dt>Ziel-Tempo</dt><dd>${fmtNum(kmhToMpm(win.vTarget), 0)} <small>m/min</small></dd></div>
      <div><dt>Ziel-Pace</dt><dd>${fmtPace(win.vTarget)} <small>min/km</small></dd></div>
    </dl>
    <div class="timeline" id="planTimeline"></div>`;
  renderTimeline($('#planTimeline'), { win, stepM: p.stepM });

  const { rows, capped } = splitTable(win, p.stepM);
  sp.innerHTML = `
    <div class="table-head"><h2>Zwischenzeiten</h2><span class="hint">Spalte „Ziel“ = Plan mit Puffer</span></div>
    <table class="splits">
      <thead><tr><th>Distanz</th><th>Mindest</th><th>Ziel</th><th>Erlaubt</th></tr></thead>
      <tbody>${rows.map(r => `
        <tr class="${r.finish ? 'fin' : ''}">
          <td>${r.finish ? 'Ziel · ' : ''}${fmtDist(r.d)}</td>
          <td>${win.tMin ? fmtDur(r.tMin) : '–'}</td>
          <td class="tgt">${fmtDur(r.tTarget)}</td>
          <td>${fmtDur(r.tMax)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${capped ? '<p class="hint">Nur die ersten 200 Zeilen – größere Schrittweite wählen.</p>' : ''}`;
}
