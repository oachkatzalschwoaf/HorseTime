import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tracker, createRun } from '../app/js/tracker.js';
import { DEFAULT_SETTINGS } from '../app/js/state.js';

// state.js liest localStorage – unter Node fehlt das; load() fängt den Fehler ab.
const settings = { ...DEFAULT_SETTINGS };
const phase = { id: 'p1', name: 'A', distM: 7000, mode: 'speed', speedKmh: 15, minRule: 'auto', bufferSec: 20, stepM: 1000 };
const LAT0 = 48.2, LON0 = 16.4;
const mPerDegLon = 111320 * Math.cos(LAT0 * Math.PI / 180);

function setup() {
  const tr = new Tracker(() => settings);
  tr.setRun(createRun(phase));
  const t0 = 1_000_000;
  tr.start(t0);
  // Position x Meter östlich vom Start
  const at = (m, sec, acc = 5, speed = null) =>
    tr.onPosition({ coords: { latitude: LAT0, longitude: LON0 + m / mPerDegLon, accuracy: acc, speed } }, t0 + sec * 1000);
  return { tr, t0, at };
}

test('GPS-Distanz wird aufsummiert, Zittern im Stand ignoriert', () => {
  const { tr, at } = setup();
  for (let s = 0; s <= 240; s += 5) at(s * 4.1667, s); // 15 km/h
  assert.ok(Math.abs(tr.distance() - 1000) < 5, `Distanz ${tr.distance()}`);
  const d = tr.distance();
  for (let i = 1; i <= 20; i++) at(1000 + (i % 2 ? 1.5 : -1.5), 240 + i); // Zittern ±1,5 m
  assert.ok(Math.abs(tr.distance() - d) < 1, 'Zittern darf nicht zählen');
});

test('Ungenaue Punkte und Sprünge werden verworfen', () => {
  const { tr, at } = setup();
  at(0, 0);
  at(50, 10);
  at(60, 12, 80);            // zu ungenau
  at(900, 13);               // 850 m in 3 s = Sprung
  assert.ok(Math.abs(tr.distance() - 50) < 1);
  assert.equal(tr.run.rejected, 2);
});

test('Km-Schild rastet mit GPS auf den nächsten Kilometer ein und korrigiert', () => {
  const { tr, t0, at } = setup();
  for (let s = 0; s <= 260; s += 5) at(s * 4.0, s); // GPS meint ~1040 m
  const m = tr.addMarker(t0 + 262_000);
  assert.equal(m.d, 1000);
  assert.ok(Math.abs(tr.distance() - 1000) < 1e-6);
  assert.ok(Math.abs(m.delta - (262 - 1660 / 7)) < 1e-6);
  tr.undoMarker();
  assert.ok(Math.abs(tr.distance() - 1040) < 5);
});

test('Km-Schild ohne GPS: zählt Schild für Schild, Ziel ist Obergrenze', () => {
  const tr = new Tracker(() => settings);
  tr.setRun(createRun({ ...phase, distM: 2500 }));
  tr.start(0);
  assert.equal(tr.statInput(1000).d, null);
  assert.equal(tr.addMarker(250_000).d, 1000);
  assert.equal(tr.addMarker(500_000).d, 2000);
  assert.equal(tr.addMarker(620_000).d, 2500);
  assert.equal(tr.addMarker(630_000), null);
  const inp = tr.statInput(700_000);
  assert.deepEqual([inp.t, inp.d, inp.src], [620, 2500, 'marker']);
});

test('Automatische GPS-Kilometer werden einmal gemeldet', () => {
  const { tr, at } = setup();
  const seen = [];
  tr.addEventListener('split', e => seen.push(e.detail.d));
  for (let s = 0; s <= 500; s += 5) at(s * 4.1667, s);
  assert.deepEqual(seen, [1000, 2000]);
  assert.equal(tr.run.autoSplits.length, 2);
});

test('Stoppuhr, Startkorrektur, Ziel', () => {
  const tr = new Tracker(() => settings);
  tr.setRun(createRun(phase));
  tr.start(10_000);
  assert.equal(tr.elapsed(70_000), 60);
  tr.adjustStart(2000);
  assert.equal(tr.elapsed(70_000), 58);
  tr.finish(100_000);
  assert.equal(tr.elapsed(999_999), 88);
  assert.equal(tr.run.state, 'finished');
});
