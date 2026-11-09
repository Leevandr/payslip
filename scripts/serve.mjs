// npm run web : builds dist/ and serves it on http://127.0.0.1:5173 (plain node:http, nothing to install).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const build = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-web.mjs')], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT ?? 5173);
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(`${DIST}${path.sep}`)) { res.writeHead(403).end('forbidden'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Payslip Proof is at http://127.0.0.1:${port}/  (Ctrl-C to stop)`));
