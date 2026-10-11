// ui/preload.js
//
// Loads the game's art and sound effects before play, so no animation ever starts
// before its picture or sound has arrived (the "Preparing Arrakis" screen in main.js).
//
//   preloadAll({ images, sfx, onProgress })  load and decode every picture (img.decode())
//                                            and every sound effect; failures are skipped
//   imageReady(url, maxMs)                   resolves when a picture is ready to draw, or
//                                            after maxMs regardless (the animations' safety net)
//
// Decoded pictures are kept here, so the browser keeps them ready to draw.

const decoded = new Map(); // url -> Promise<boolean> (true once decoded)
const keep = [];           // the decoded Image objects, held so they stay decoded
const FILE_TIMEOUT_MS = 20000; // a file still not here after this counts as done (it keeps loading)
const PARALLEL = 8;

const timeout = ms => new Promise(resolve => setTimeout(() => resolve(false), ms));

function decodeImage(url) {
  if (!decoded.has(url)) {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    keep.push(img);
    const p = (img.decode ? img.decode() : new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; }))
      .then(() => true, err => { console.warn(`Could not load picture ${url}`, err); decoded.delete(url); return false; });
    decoded.set(url, p);
  }
  return decoded.get(url);
}

export async function preloadAll({ images = [], sfx = null, onProgress = () => {} }) {
  const total = images.length + (sfx?.count ?? 0);
  let done = 0;
  const tick = () => { done++; onProgress(done, total); };
  onProgress(0, total);

  const sounds = sfx
    ? Promise.race([sfx.preload(() => tick()), timeout(FILE_TIMEOUT_MS * 2)])
    : Promise.resolve();

  // Pictures, a few at a time, so progress moves steadily on a slow connection.
  const queue = [...images];
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      await Promise.race([decodeImage(url), timeout(FILE_TIMEOUT_MS)]);
      tick();
    }
  };
  await Promise.all([...Array(PARALLEL)].map(worker));
  await sounds;
  onProgress(total, total);
}

// The safety net: wait for a picture to be ready to draw, but never more than maxMs.
export function imageReady(url, maxMs = 1000) {
  if (!url) return Promise.resolve(true);
  return Promise.race([decodeImage(url), timeout(maxMs)]);
}

// Several pictures at once (each capped at maxMs, all waited on together, so at most maxMs).
export function artReady(urls, maxMs = 1000) {
  return Promise.all([...new Set(urls.filter(Boolean))].map(u => imageReady(u, maxMs)));
}

// Every picture inside an element (<img> and SVG <image>), before it is shown or animated.
export function imagesReadyIn(el, maxMs = 1000) {
  if (!el) return Promise.resolve([]);
  const urls = [...el.querySelectorAll('img')].map(i => i.currentSrc || i.src)
    .concat([...el.querySelectorAll('image')].map(i => i.getAttribute('href')));
  return artReady(urls, maxMs);
}
