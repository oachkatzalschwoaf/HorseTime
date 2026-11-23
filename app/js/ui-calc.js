// Ansicht „Rechner“: 3-Wege-Rechner (Distanz/Zeit/Tempo) und Tempo-Umrechner.

import { $, $$, setSeg, onSeg, renderChips } from './dom.js';
import { state, bus, activePhase } from './state.js';
import {
  timeFromSpeed, speedFromTime, distFromSpeed, kmhToMpm, mpmToKmh, paceToKmh,
  fmtDur, fmtDist, fmtNum, fmtPace, parseTime, parseNum, parseDist,
} from './calc.js';

let what = 'time';
const numStr = (v, max = 2) => (v == null || !Number.isFinite(v) ? '' : v.toLocaleString('de-DE', { maximumFractionDigits: max, useGrouping: false }));

export function initCalc() {
  const dist = $('#cDist'), time = $('#cTime'), speed = $('#cSpeed');
  const p = activePhase();
  dist.value = p.distM || '';
  speed.value = numStr(p.speedKmh, 1);

  onSeg($('#cWhat'), v => { what = v; update(); });
  [dist, time, speed].forEach(i => i.addEventListener('input', update));
  time.addEventListener('change', () => { const v = parseTime(time.value); if (v != null && what !== 'time') time.value = fmtDur(v); });

  const chips = () => renderChips($('#cSpeedChips'), state.settings.speedPresets.map(v => ({ v, label: `${numStr(v)} km/h` })), parseNum(speed.value), v => {
    if (what === 'speed') what = 'time';
    speed.value = numStr(v);
    update();
  });
  bus.addEventListener('settings', chips);
  speed.addEventListener('input', chips);
  chips();

  // Umrechner
  const conv = { kmh: $('#uKmh'), mpm: $('#uMpm'), pace: $('#uPace'), mps: $('#uMps') };
  const toKmh = {
    kmh: v => parseNum(v),
    mpm: v => { const n = parseNum(v); return n > 0 ? mpmToKmh(n) : null; },
    pace: v => { const n = parseTime(v); return n > 0 ? paceToKmh(n) : null; },
    mps: v => { const n = parseNum(v); return n > 0 ? n * 3.6 : null; },
  };
  for (const [key, input] of Object.entries(conv)) {
    input.addEventListener('input', () => {
      const kmh = toKmh[key](input.value);
      const ok = kmh > 0 && Number.isFinite(kmh);
      input.classList.toggle('bad', !ok && input.value.trim() !== '');
      const out = {
        kmh: ok ? numStr(kmh, 2) : '',
        mpm: ok ? numStr(kmhToMpm(kmh), 1) : '',
        pace: ok ? fmtPace(kmh) : '',
        mps: ok ? numStr(kmh / 3.6, 2) : '',
      };
      for (const [k, other] of Object.entries(conv)) if (k !== key) other.value = out[k];
      $('#uKm').textContent = ok ? fmtDist(kmh * 1000 / 6) : '–';
    });
  }
  update();
}

function update() {
  const dist = $('#cDist'), time = $('#cTime'), speed = $('#cSpeed');
  setSeg($('#cWhat'), what);
  $$('[data-calc]').forEach(f => {
    const inp = $('input', f);
    const computed = f.dataset.calc === what;
    inp.readOnly = computed;
    inp.classList.toggle('computed', computed);
    if (computed) inp.classList.remove('bad');
  });

  let D = parseDist(dist.value);
  let T = parseTime(time.value);
  let V = parseNum(speed.value);
  if (what !== 'dist') dist.classList.toggle('bad', dist.value.trim() !== '' && !(D > 0));
  if (what !== 'time') time.classList.toggle('bad', time.value.trim() !== '' && !(T > 0));
  if (what !== 'speed') speed.classList.toggle('bad', speed.value.trim() !== '' && !(V > 0));

  if (what === 'time') {
    T = D > 0 && V > 0 ? timeFromSpeed(D, V) : null;
    time.value = T ? fmtDur(T) : '';
  } else if (what === 'speed') {
    V = D > 0 && T > 0 ? speedFromTime(D, T) : null;
    speed.value = V ? numStr(V, 2) : '';
  } else {
    D = V > 0 && T > 0 ? Math.round(distFromSpeed(V, T)) : null;
    dist.value = D ? String(D) : '';
  }

  $('#cDistHint').textContent = D > 0 ? `= ${fmtDist(D)}` : '';
  $('#cTimeHint').textContent = T > 0 && what !== 'time' ? `= ${fmtDur(T)}` : T > 0 ? `genau ${fmtNum(T, 1)} s` : '';

  const more = [];
  if (V > 0) {
    more.push(['Meter pro Minute', `${fmtNum(kmhToMpm(V), 0)} <small>m/min</small>`]);
    more.push(['Pace', `${fmtPace(V)} <small>min/km</small>`]);
  }
  if (T > 0 && D > 0) {
    more.push(['Mindestzeit (Regel)', fmtDur(Math.max(0, Math.floor(T) - (D > 3000 ? 120 : 60)))]);
  }
  $('#cMore').innerHTML = more.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}
