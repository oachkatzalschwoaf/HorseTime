import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  phaseWindow, splitTable, liveStats, nextSplit, verdict, planTimeAt,
  timeFromSpeed, speedFromTime, distFromSpeed, kmhToMpm, mpmToKmh, kmhToPace,
  fmtDur, fmtClock, fmtDelta, fmtDist, fmtKmh, fmtPace, parseTime, parseNum, parseDist, sayDelta,
} from '../app/js/calc.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const phase = (o = {}) => ({ distM: 7000, mode: 'speed', speedKmh: 15, minRule: 'auto', bufferSec: 20, ...o });

test('Grundformeln (Konzept, Abschnitt 2)', () => {
  near(timeFromSpeed(7000, 15), 1680);
  near(speedFromTime(7000, 1680), 15);
  near(distFromSpeed(15, 1680), 7000);
  near(kmhToMpm(15), 250);
  near(mpmToKmh(250), 15);
  near(kmhToPace(15), 240);
});

test('Zeitfenster: Strecke > 3000 m → Mindestzeit 2 min unter erlaubter Zeit', () => {
  const w = phaseWindow(phase());
  assert.equal(w.tMax, 1680);
  assert.equal(w.tMin, 1560);
  assert.equal(w.tTarget, 1660);
  near(w.vSlow, 15);
});

test('Zeitfenster: Strecke ≤ 3000 m → 1 min', () => {
  const w = phaseWindow(phase({ distM: 3000, speedKmh: 12 }));
  assert.equal(w.tMax, 900);
  assert.equal(w.tMin, 840);
});

test('Zeitfenster: erlaubte Zeit wird abgerundet', () => {
  const w = phaseWindow(phase({ distM: 6830, speedKmh: 14 })); // 1756,29 s
  assert.equal(w.tMax, 1756);
});

test('Zeitfenster: direkte Zeit, manuelle und keine Mindestzeit, Puffer begrenzt', () => {
  assert.equal(phaseWindow(phase({ mode: 'time', tMaxSec: 1800 })).tMax, 1800);
  assert.equal(phaseWindow(phase({ minRule: 'manual', tMinSec: 1500 })).tMin, 1500);
  assert.equal(phaseWindow(phase({ minRule: 'manual', tMinSec: 9999 })).tMin, 1680);
  assert.equal(phaseWindow(phase({ minRule: 'none' })).tMin, 0);
  assert.equal(phaseWindow(phase({ minRule: 'none' })).vFast, Infinity);
  assert.equal(phaseWindow(phase({ bufferSec: 500 })).tTarget, 1560);
  assert.equal(phaseWindow(phase({ distM: 0 })), null);
  assert.equal(phaseWindow(phase({ speedKmh: 0 })), null);
});

test('Zwischenzeiten: anteilig, sichere Rundung, Ziel als letzte Zeile', () => {
  const w = phaseWindow(phase({ distM: 7250 })); // tMax = floor(1740) = 1740
  const { rows, capped } = splitTable(w, 1000);
  assert.equal(capped, false);
  assert.equal(rows.length, 8);
  assert.deepEqual(rows.map(r => r.d), [1000, 2000, 3000, 4000, 5000, 6000, 7000, 7250]);
  assert.equal(rows[0].tMax, Math.floor(1740 / 7.25));
  assert.equal(rows[0].tMin, Math.ceil(1620 / 7.25));
  assert.equal(rows.at(-1).finish, true);
  assert.equal(rows.at(-1).tMax, 1740);
  assert.equal(splitTable(w, 7250).rows.length, 1);
  assert.equal(splitTable(phaseWindow(phase()), 1000).rows.length, 7);
  assert.equal(splitTable(w, 10, 50).capped, true);
});

test('Live-Werte: Abweichung, Hochrechnung, Tempo-Korridor', () => {
  const w = phaseWindow(phase()); // Ziel 1660 s für 7000 m
  const half = planTimeAt(w, 3500);
  assert.equal(half, 830);
  const s = liveStats(w, 850, 3500);
  assert.equal(s.delta, 20);
  assert.equal(s.projected, 1700);
  assert.equal(s.status, 'late');
  assert.equal(s.remaining, 3500);
  assert.ok(Math.abs(s.vReq - 3500 / (1660 - 850) * 3.6) < 1e-9);
  assert.ok(s.vSlow < s.vReq && s.vReq < s.vFast);
  assert.equal(liveStats(w, 800, 3500).status, 'ok');
  assert.equal(liveStats(w, 700, 3500).status, 'early');
  assert.equal(liveStats(w, 100, null).delta, null);
  assert.equal(liveStats(w, 30, 100).projected, null); // zu früh für Hochrechnung
  assert.equal(liveStats(w, 1700, 6900).vSlow, Infinity);
});

test('Nächster Zwischenpunkt', () => {
  const w = phaseWindow(phase({ distM: 7250 }));
  assert.equal(nextSplit(w, 0, 1000).d, 1000);
  assert.equal(nextSplit(w, 2000, 1000).d, 3000);
  assert.equal(nextSplit(w, 7100, 1000).d, 7250);
  assert.equal(nextSplit(w, 7250, 1000), null);
});

test('Ergebnis: Strafpunkte je angefangene Sekunde', () => {
  const w = phaseWindow(phase());
  assert.deepEqual(verdict(w, 1600), { kind: 'ok', sec: 0, points: 0 });
  assert.deepEqual(verdict(w, 1680.2), { kind: 'late', sec: 1, points: 0.25 });
  assert.deepEqual(verdict(w, 1550), { kind: 'early', sec: 10, points: 2.5 });
  assert.equal(verdict(w, 1690, 0.2).points, 2);
});

test('Formatierung', () => {
  assert.equal(fmtDur(1680), '28:00');
  assert.equal(fmtDur(3725), '1:02:05');
  assert.equal(fmtDur(-12), '−00:12');
  assert.equal(fmtClock(59.99), '00:59');
  assert.equal(fmtClock(-4.2), '−00:05');
  assert.equal(fmtDelta(12.4), '+0:12');
  assert.equal(fmtDelta(-65), '−1:05');
  assert.equal(fmtDelta(0.3), '±0:00');
  assert.equal(fmtDist(850), '850 m');
  assert.equal(fmtDist(7250), '7,25 km');
  assert.equal(fmtDist(7000), '7 km');
  assert.equal(fmtKmh(14.25), '14,3');
  assert.equal(fmtKmh(Infinity), '∞');
  assert.equal(fmtPace(15), '4:00');
});

test('Eingaben parsen', () => {
  assert.equal(parseTime('28:00'), 1680);
  assert.equal(parseTime('2800'), 1680);
  assert.equal(parseTime('1:02:05'), 3725);
  assert.equal(parseTime('10205'), 3725);
  assert.equal(parseTime('28.30'), 1710);
  assert.equal(parseTime('45'), 45);
  assert.equal(parseTime(''), null);
  assert.equal(parseTime('abc'), null);
  assert.equal(parseTime('1:2:3:4'), null);
  assert.equal(parseNum('14,5'), 14.5);
  assert.equal(parseNum('x'), null);
  assert.equal(parseDist('7250'), 7250);
  assert.equal(parseDist('7.250'), 7250);
  assert.equal(parseDist('7,25 km'), 7250);
  assert.equal(parseDist('7250 m'), 7250);
  assert.equal(parseDist('abc'), null);
});

test('Sprachausgabe', () => {
  assert.equal(sayDelta(12), '12 Sekunden Rückstand');
  assert.equal(sayDelta(-65), 'eine Minute 5 Sekunden Vorsprung');
  assert.equal(sayDelta(-60), 'eine Minute Vorsprung');
  assert.equal(sayDelta(0.5), 'genau im Plan');
});
