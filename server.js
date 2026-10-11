// Tiny static file server: `npm start`, then open http://localhost:8000
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractUgSong, isUgUrl } from './src/ug.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT) || 8000;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

// GET /api/ug?url=<Ultimate Guitar tab URL> -> { title, artist, bpm, text }
// Browsers cannot read UG pages directly (cross-origin), so the server does it.
async function importFromUg(res, target) {
  if (!isUgUrl(target)) return json(res, 400, { error: 'Please use an https://…ultimate-guitar.com tab link.' });
  let page;
  try {
    page = await fetch(target, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html',
        'Accept-Language': 'en',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return json(res, 502, { error: `Could not reach Ultimate Guitar (${err.message}).` });
  }
  if (!isUgUrl(page.url)) return json(res, 400, { error: 'The link redirected away from Ultimate Guitar.' });
  if (!page.ok) return json(res, 502, { error: `Ultimate Guitar answered with status ${page.status}. Try copy and paste instead.` });
  try {
    json(res, 200, extractUgSong(await page.text()));
  } catch (err) {
    json(res, 422, { error: err.message });
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/ug') return importFromUg(res, url.searchParams.get('url') || '');
  const path = decodeURIComponent(url.pathname);
  const file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`Tab Trainer running at http://localhost:${port}`));
