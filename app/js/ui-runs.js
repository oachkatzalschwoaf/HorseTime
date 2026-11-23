// Ansicht „Verlauf“: gespeicherte Fahrten, Detail mit Karte, Zwischenzeiten, GPX.

import { $, esc, toast, confirmDialog } from './dom.js';
import { runs } from './store.js';
import { bus, state, activePhase, updatePhase } from './state.js';
import { verdict, verdictText, fmtClock, fmtDur, fmtDelta, fmtDist, fmtKmh, fmtNum, speedFromTime, planTimeAt } from './calc.js';
import { TileMap, applySource, bindMapControls } from './map.js';
import { thin, pathLength } from './geo.js';
import { downloadGpx } from './ui-live.js';

let list = [];
let current = null;
let dmap = null;

const runTime = r => (r.endAt - r.startAt) / 1000;
const kmWord = d => (d / 1000).toLocaleString('de-DE', { maximumFractionDigits: 2 });
const pillText = v => (v.kind === 'ok' ? 'im Fenster' : verdictText(v));
const dateStr = ms => new Date(ms).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

export function initRuns() {
  bus.addEventListener('runs', refreshRuns);
  bus.addEventListener('settings', () => { if (dmap) applySource(dmap, $('#rdMap'), state.settings); if (list.length) render(); });
  $('#runList').addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) openRun(b.dataset.id); });

  const dlg = $('#runDlg');
  $('#rdClose').addEventListener('click', () => dlg.close());
  $('#rdGpx').addEventListener('click', () => current && downloadGpx(current));
  $('#rdRoute').addEventListener('click', () => {
    if (!current?.points?.length) return;
    const target = state.phases.find(p => p.id === current.phase.id) || activePhase();
    const route = thin(current.points.map(p => [p[1], p[2]]), 5);
    updatePhase(target.id, { route });
    toast(`Strecke (${fmtDist(pathLength(route))}) für „${target.name}“ übernommen`);
  });
  $('#rdDelete').addEventListener('click', async () => {
    if (!current) return;
    if (!(await confirmDialog('Diese Fahrt endgültig löschen?', { ok: 'Löschen', danger: true }))) return;
    await runs.del(current.id);
    dlg.close();
    refreshRuns();
  });
}

export async function refreshRuns() {
  try { list = await runs.all(); } catch (e) { console.error(e); list = []; }
  render();
}

function render() {
  $('#runEmpty').hidden = list.length > 0;
  $('#runList').innerHTML = list.map(r => {
    const T = runTime(r);
    const v = verdict(r.win, T, state.settings.penaltyPerSec);
    return `<button type="button" class="run-item" data-id="${esc(r.id)}">
      <span class="meta">${esc(r.phase?.name)} · ${fmtDist(r.win.distM)} · ${dateStr(r.startAt)}</span>
      <span class="pill ${v.kind}">${pillText(v)}</span>
      <span class="t">${fmtClock(T)}</span>
      <span class="meta">${fmtDelta(T - r.win.tTarget)} zur Zielzeit${r.gpsDist ? ` · GPS ${fmtDist(r.gpsDist)}` : ''}</span>
    </button>`;
  }).join('');
}

function openRun(id) {
  current = list.find(r => r.id === id);
  if (!current) return;
  const r = current;
  const w = r.win;
  const T = runTime(r);
  const v = verdict(w, T, state.settings.penaltyPerSec);
  $('#rdTitle').textContent = `${r.phase?.name || 'Fahrt'} · ${dateStr(r.startAt)}`;
  $('#rdSummary').innerHTML = `
    <div class="result-card" data-kind="${v.kind}">
      <p class="verdict">${v.kind === 'ok' ? '✓ Im Zeitfenster' : verdictText(v)}</p>
      <dl class="kv">
        <div><dt>Zeit</dt><dd>${fmtClock(T)}</dd></div>
        <div><dt>gegen Zielzeit</dt><dd>${fmtDelta(T - w.tTarget)}</dd></div>
        <div><dt>Fenster</dt><dd>${w.tMin ? fmtDur(w.tMin) : '0'}–${fmtDur(w.tMax)}</dd></div>
        <div><dt>Strafpunkte</dt><dd>${fmtNum(v.points, 2)}</dd></div>
        <div><dt>Ø Tempo (Strecke)</dt><dd>${fmtKmh(speedFromTime(w.distM, T))} <small>km/h</small></dd></div>
        ${r.gpsDist ? `<div><dt>GPS-Distanz</dt><dd>${fmtDist(r.gpsDist)}</dd></div>` : ''}
      </dl>
    </div>`;

  // Zwischenzeiten: getippte Schilder, dazu GPS-Kilometer nur dort, wo kein Schild getippt wurde
  const tapped = new Set((r.markers || []).map(m => m.d));
  const rows = [
    ...(r.markers || []).map(m => ({ ...m, src: 'Schild' })),
    ...(r.autoSplits || []).filter(m => !tapped.has(m.d)).map(m => ({ ...m, src: 'GPS' })),
  ].sort((a, b) => a.t - b.t);
  $('#rdSplits').innerHTML = rows.length ? `
    <table class="splits">
      <thead><tr><th>Punkt</th><th>Ist</th><th>Soll</th><th>Δ</th></tr></thead>
      <tbody>${rows.map(m => `<tr>
        <td>${m.d >= w.distM ? 'Ziel' : 'km ' + kmWord(m.d)} <small class="hint">${m.src}</small></td>
        <td>${fmtClock(m.t / 1000)}</td>
        <td>${fmtDur(planTimeAt(w, m.d))}</td>
        <td class="dl ${m.delta > 1.5 ? 'behind' : m.delta < -1.5 ? 'ahead' : 'onplan'}">${fmtDelta(m.delta)}</td>
      </tr>`).join('')}</tbody>
    </table>` : '<p class="hint">Keine Zwischenzeiten aufgezeichnet.</p>';

  const hasGeo = r.points?.length > 1 || (r.markers || []).some(m => m.lat != null);
  const mapEl = $('#rdMap');
  mapEl.hidden = !hasGeo;
  $('#rdGpx').disabled = !hasGeo;
  $('#rdRoute').hidden = !(r.points?.length > 1);

  const dlg = $('#runDlg');
  dlg.showModal();
  if (hasGeo) {
    if (!dmap) {
      dmap = new TileMap(mapEl);
      bindMapControls(mapEl, dmap);
      applySource(dmap, mapEl, state.settings);
    }
    dmap.setFollow(false);
    dmap.setPosition(null);
    dmap.setRoute([]);
    dmap.setTrack(r.points || [], r.id);
    dmap.setMarkers((r.markers || []).map(m => ({ lat: m.lat, lon: m.lon, label: m.d >= w.distM ? 'Z' : kmWord(m.d) })));
    requestAnimationFrame(() => { dmap.resize(); dmap.fit(); });
  }
}
