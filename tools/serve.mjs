// Statischer Entwicklungs-Server für app/ (ohne Abhängigkeiten).
//   npm run dev                → http://localhost:8080
//   node tools/serve.mjs 9000  → anderer Port
//   node tools/serve.mjs --lan → auch im WLAN erreichbar (Achtung: GPS/Service Worker brauchen HTTPS oder localhost)

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'app');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.gpx': 'application/gpx+xml',
};

export function startServer({ port = 8080, host = '127.0.0.1', quiet = false } = {}) {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = normalize(join(ROOT, path));
      if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
      if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(body);
      if (!quiet) console.log(200, path);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
      if (!quiet) console.log(404, req.url);
    }
  });
  return new Promise(ok => server.listen(port, host, () => ok(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const port = Number(args.find(a => /^\d+$/.test(a))) || 8080;
  const host = args.includes('--lan') ? '0.0.0.0' : '127.0.0.1';
  const server = await startServer({ port, host });
  console.log(`HorseTime läuft auf http://${host === '0.0.0.0' ? '<IP-dieses-Rechners>' : 'localhost'}:${server.address().port}  (Strg+C beendet)`);
}
