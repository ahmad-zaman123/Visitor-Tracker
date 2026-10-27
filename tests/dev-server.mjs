// Serves frontend/ and runs the /api entry points in one process, against the in-memory database.
import './setup.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const handlers = {};
for (const f of fs.readdirSync(path.join(root, 'api'))) handlers[f.replace('.js', '')] = (await import(`../api/${f}`)).default;

export function startServer() {
  const server = http.createServer(async (rq, rs) => {
    const u = new URL(rq.url, 'http://localhost');
    if (u.pathname.startsWith('/api/')) {
      const h = handlers[u.pathname.slice(5)];
      if (!h) { rs.writeHead(404); return rs.end(); }
      let raw = '';
      for await (const c of rq) raw += c;
      const body = raw && /json/.test(rq.headers['content-type'] || '') ? JSON.parse(raw) : raw;
      const res = {
        setHeader: (k, v) => rs.setHeader(k, v),
        status(c) { rs.statusCode = c; return res; },
        json(o) { rs.setHeader('Content-Type', 'application/json'); rs.end(JSON.stringify(o)); return res; },
        write: c => rs.write(c),
        end: c => { rs.end(c); return res; },
      };
      try { await h({ method: rq.method, headers: rq.headers, query: Object.fromEntries(u.searchParams), body }, res); }
      catch (e) { console.error(e); rs.statusCode = 500; rs.end(); }
      return;
    }
    const file = path.join(root, 'frontend', u.pathname === '/' ? 'index.html' : u.pathname);
    if (!file.startsWith(path.join(root, 'frontend')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { rs.writeHead(404); return rs.end(); }
    rs.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    rs.end(fs.readFileSync(file));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://localhost:${server.address().port}` })));
}
