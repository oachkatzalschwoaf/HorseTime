import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { runToGpx, parseGpx } from '../app/js/gpx.js';
import { pathLength, thin } from '../app/js/geo.js';

test('GPX: Export und wieder einlesen', () => {
  const run = {
    phase: { name: 'Phase <A> & B' },
    startAt: Date.UTC(2026, 5, 1, 10, 0, 0),
    points: [[Date.UTC(2026, 5, 1, 10, 0, 0), 48.2, 16.4, 5, 160], [Date.UTC(2026, 5, 1, 10, 0, 10), 48.2, 16.401, 5, null]],
    markers: [{ t: 240000, d: 1000, delta: 12, lat: 48.2, lon: 16.401 }],
  };
  const xml = runToGpx(run);
  assert.match(xml, /Phase &lt;A&gt; &amp; B/);
  assert.match(xml, /<wpt lat="48.2" lon="16.401">/);
  const g = parseGpx(xml);
  assert.equal(g.points.length, 2);
  assert.deepEqual(g.points[1], [48.2, 16.401]);
  assert.match(g.name, /^Phase <A> & B/);
});

test('GPX: Routenpunkte und Attribut-Reihenfolge', () => {
  const g = parseGpx(`<gpx><rte><name>R</name><rtept lon='16.5' lat='48.1'/><rtept lat="48.2" lon="16.6"></rtept></rte></gpx>`);
  assert.deepEqual(g.points, [[48.1, 16.5], [48.2, 16.6]]);
  assert.equal(g.name, 'R');
});

test('Geo: Länge und Ausdünnen', () => {
  const pts = Array.from({ length: 101 }, (_, i) => [48.2, 16.4 + i * 0.00001]); // ~0,74 m Abstand
  const len = pathLength(pts);
  assert.ok(len > 70 && len < 80, String(len));
  const t = thin(pts, 5);
  assert.ok(t.length < 20);
  assert.deepEqual(t.at(-1), pts.at(-1));
});

test('Service Worker: alle App-Dateien sind im Offline-Cache gelistet', () => {
  const root = new URL('../app/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const listed = new Set([...sw.matchAll(/'\.\/([^']*)'/g)].map(m => m[1]).filter(Boolean));
  const walk = dir => readdirSync(dir).flatMap(f => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
  const files = walk(root).map(f => relative(root, f).split(sep).join('/')).filter(f => f !== 'sw.js' && !f.split('/').some(s => s.startsWith('.')));
  const missing = files.filter(f => !listed.has(f));
  assert.deepEqual(missing, [], 'in sw.js ASSETS ergänzen');
  const extra = [...listed].filter(f => !files.includes(f));
  assert.deepEqual(extra, [], 'in sw.js gelistet, aber nicht vorhanden');
});

test('VERSION in sw.js und app.js stimmt überein', () => {
  const v = f => readFileSync(new URL(f, import.meta.url), 'utf8').match(/VERSION = '([^']+)'/)?.[1];
  assert.ok(v('../app/sw.js'), 'VERSION in sw.js fehlt');
  assert.equal(v('../app/js/app.js'), v('../app/sw.js'));
});

test('Keine Ordnernamen, die Apache per Standard-Alias überdeckt', () => {
  const root = new URL('../app/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const reserved = ['icons', 'manual', 'cgi-bin', 'error'];
  const clash = readdirSync(root).filter(f => reserved.includes(f.toLowerCase()) && statSync(join(root, f)).isDirectory());
  assert.deepEqual(clash, [], '/icons/ usw. liefert auf Apache die Server-eigenen Dateien');
});
