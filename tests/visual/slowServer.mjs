// tests/visual/slowServer.mjs
//
// A static file server for the game that behaves like a "slow 4G" phone connection:
// 1.6 Mbit/s shared by every download, and 150 ms before each response starts.
// Throttling here (rather than in the browser) also slows the service worker's own
// downloads, which browser throttling does not. Answers "has it changed?" with
// 304 Not Modified, as GitHub Pages does (ETag). Counts the bytes it sends.

import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.ico': 'image/x-icon' };

export function startSlowServer({ root, port, bytesPerSecond = 1.6e6 / 8, latencyMs = 150 }) {
  const stats = { bytes: 0, requests: 0, files: [] };
  // One shared pipe: each chunk waits its turn at the line rate.
  let lineFreeAt = 0;
  const sendSlowly = async (res, stream) => {
    for await (const chunk of stream) {
      const now = Date.now();
      lineFreeAt = Math.max(lineFreeAt, now) + (chunk.length / bytesPerSecond) * 1000;
      const wait = lineFreeAt - now;
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      if (!res.write(chunk)) await new Promise(r => res.once('drain', r));
      stats.bytes += chunk.length;
    }
    res.end();
  };
  const server = http.createServer(async (req, res) => {
    stats.requests++;
    await new Promise(r => setTimeout(r, latencyMs));
    const url = new URL(req.url, 'http://x');
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    let size, etag;
    try { const st = statSync(file); size = st.size; etag = `"${size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`; } catch { res.writeHead(404); res.end(); return; }
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'max-age=600' }); res.end(); return; }
    stats.files.push(url.pathname);
    const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    if (range) {
      const start = range[1] === '' ? size - Number(range[2]) : Number(range[1]);
      const end = range[1] !== '' && range[2] !== '' ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'max-age=600', ETag: etag });
      await sendSlowly(res, createReadStream(file, { start, end, highWaterMark: 16384 }));
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'max-age=600', ETag: etag });
    if (req.method === 'HEAD') { res.end(); return; }
    await sendSlowly(res, createReadStream(file, { highWaterMark: 16384 }));
  });
  server.listen(port, '127.0.0.1');
  return { server, stats, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}
