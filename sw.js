// sw.js — the service worker: keeps the game's files on the device after the first visit,
// so later visits load almost at once (and play on with a poor connection).
//
// One cache per version (the version string arrives as ?v= on this script's address, from
// ui/main.js). A new version gets a fresh cache and the old one is deleted, so old files
// never linger.
//
//   Code (the page, .js, .css, .json): network first, asking the server whether it has
//     changed, so a new version is never hidden behind old code. The stored copy is only
//     used when the network fails (offline).
//   Art and sound (assets/): stored copy first; fetched and stored the first time.
//   Music: stored as it plays (whole files fetched in the background), then served from
//     the store, in the pieces the audio player asks for.

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `my-arrakis-${VERSION}`;
const PREFIX = 'my-arrakis-';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// The page sends the files it loaded before this worker took over, so they are stored too.
self.addEventListener('message', event => {
  if (event.data?.type !== 'store' || !Array.isArray(event.data.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of event.data.urls) {
      if (!sameOrigin(url) || isMusic(url)) continue;
      if (await cache.match(url)) continue;
      try { const res = await fetch(url, { cache: 'no-cache' }); if (res.ok && res.status === 200) await cache.put(url, res); } catch {}
    }
  })());
});

const sameOrigin = url => new URL(url, self.location.href).origin === self.location.origin;
const isMusic = url => new URL(url, self.location.href).pathname.includes('/assets/music/');
const isAsset = url => new URL(url, self.location.href).pathname.includes('/assets/');

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !sameOrigin(req.url)) return; // fonts and the like: the browser's own way
  if (isMusic(req.url)) { event.respondWith(music(req)); return; }
  if (isAsset(req.url)) { event.respondWith(cacheFirst(req)); return; }
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    // no-cache: revalidate with the server (a quick "not changed" if it hasn't), never a stale copy.
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req, { cache: 'no-cache' });
  if (res.ok && res.status === 200) cache.put(req, res.clone());
  return res;
}

// Music: the audio player asks for byte ranges. Once a track is stored whole, answer
// ranges from the store; until then, pass the request on and fetch the whole file once
// in the background to store it.
const fetchingMusic = new Set();
async function music(req) {
  const cache = await caches.open(CACHE);
  const key = req.url;
  const hit = await cache.match(key);
  if (hit) return rangeOf(hit, req.headers.get('range'));
  if (!fetchingMusic.has(key)) {
    fetchingMusic.add(key);
    fetch(key).then(res => (res.ok && res.status === 200 ? cache.put(key, res) : null)).catch(() => {}).finally(() => fetchingMusic.delete(key));
  }
  return fetch(req);
}

async function rangeOf(response, range) {
  if (!range) return response;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  if (!m) return response;
  const blob = await response.blob();
  const size = blob.size;
  let start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : size - 1;
  end = Math.min(end, size - 1);
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'audio/mp4',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes'
    }
  });
}
