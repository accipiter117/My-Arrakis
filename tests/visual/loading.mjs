// tests/visual/loading.mjs
//
// The loading check (preload task): a phone (390 x 844) on a slow 4G connection with an
// empty cache. Checks that
//   1. the "Preparing Arrakis" screen shows progress, and every sound is decoded;
//   2. no picture is missing when an animation shows it, through the first auction
//      card flip, a battle reveal and ship flights (a watcher in the page flags any
//      <img> or SVG <image> put on screen before it has arrived);
//   3. a second visit loads from the service worker's store;
//   4. a new version string makes the page pick up the new code.
//
//   node tests/visual/loading.mjs
//
// Needs Playwright. Temporarily edits index.html and ui/main.js for step 4, and puts
// them back afterwards. Not part of `npm test`.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, launch, sleep, play, setSpeed, waitFor } from './harness.mjs';
import { startSlowServer } from './slowServer.mjs';

const PORT = 8124;
const BASE = `http://127.0.0.1:${PORT}/`;
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };

// In the page: flag any picture an animation shows before it has arrived.
function watchPictures() {
  window.__missing = []; window.__shown = 0; window.__ships = 0;
  const animated = el => el.closest?.('#event-layer, .board__fx, .harvest-float, .tech-flyer, #turn-banner');
  const ready = el => {
    if (el.tagName === 'IMG') return el.complete && el.naturalWidth > 0;
    const probe = new Image(); probe.src = el.getAttribute('href'); return probe.complete && probe.naturalWidth > 0;
  };
  const look = el => {
    if (!(el instanceof Element)) return;
    if (el.matches('.fx-ship')) window.__ships++;
    const pics = [...(el.matches('img, image') ? [el] : []), ...el.querySelectorAll('img, image')];
    for (const p of pics) {
      if (!animated(p)) continue;
      window.__shown++;
      if (!ready(p)) window.__missing.push(`${p.getAttribute('src') ?? p.getAttribute('href')} in ${animated(p).id || animated(p).className}`);
    }
  };
  new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(look))).observe(document, { childList: true, subtree: true });
}

const STORAGE = { 'my-arrakis-speed': '1', 'my-arrakis-music': '{"enabled":false}', 'my-arrakis-sfx': '{"enabled":true}',
  'my-arrakis-lineup': '["atreides","harkonnen","emperor","fremen","guild","gesserit"]', 'my-arrakis-camera': 'on' };

async function main() {
  const slow = startSlowServer({ root, port: PORT });
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await context.addInitScript(watchPictures);
  await context.addInitScript(s => { if (!localStorage.getItem('my-arrakis-lineup')) for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, STORAGE);
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));

  // --- 1. First visit, empty cache ---------------------------------------------------
  let t = Date.now();
  await page.goto(`${BASE}?debug=1&seed=4242`, { timeout: 180000 });
  await page.waitForSelector('#sheet-menu:not([hidden])', { timeout: 180000 });
  const menuFirst = (Date.now() - t) / 1000;
  t = Date.now();
  await page.click('#btn-new-game');
  const seen = new Set();
  await page.waitForSelector('.loading', { timeout: 20000 });
  while (await page.$('.loading')) { const p = await page.$eval('.loading__count', el => el.textContent).catch(() => null); if (p) seen.add(p.trim()); await sleep(250); }
  const loadFirst = (Date.now() - t) / 1000;
  console.log(`First visit: menu after ${menuFirst.toFixed(1)} s, then "Preparing Arrakis" for ${loadFirst.toFixed(1)} s (${(slow.stats.bytes / 1e6).toFixed(1)} MB sent so far).`);
  check(seen.size >= 5, `the loading screen showed progress (${[...seen].slice(0, 6).join(', ')}${seen.size > 6 ? ', ...' : ''})`);
  const sounds = await page.evaluate(() => window.__arrakis.sfx.loaded.length);
  const total = await page.evaluate(() => window.__arrakis.sfx.count);
  check(sounds === total, `every sound effect decoded before play (${sounds} of ${total})`);

  // --- 2. Pictures during animations: an auction card flip, ship flights, a battle reveal ---
  await waitFor(page, () => !document.getElementById('decision-panel').hidden, 60000);
  await page.click('#decision-panel [data-default-action]'); // keep the offered traitor
  await waitFor(page, () => !document.getElementById('btn-run-turn').disabled, 60000);
  // Win the first auction card (bid high, keeping 3 spice to ship into Carthag) so its card flips face up.
  await play(page, s => s.panelTitle?.startsWith('Treachery card'), 2);
  await page.evaluate(() => { const p = document.getElementById('decision-panel'); const sel = p.querySelector('[name="bid"]'); if (sel) { sel.value = sel.options[Math.max(0, sel.options.length - 4)].value; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); } p.querySelector('[data-action="bid"]')?.click(); });
  const flipped = await page.waitForSelector('.auction-flip', { timeout: 60000 }).then(() => true, () => false);
  check(flipped, 'the first auction card flipped face up (won)');
  // Play on to a battle of your own, with ship flights on the way (Normal speed), then its reveal.
  // Reports where it is every 30 s, so a long wait can be told from a stuck one.
  const watchdog = setInterval(async () => {
    const at = await page.evaluate(() => ({ turn: window.__arrakis.state.meta.turn, phase: document.getElementById('status-phase').textContent,
      panel: document.getElementById('decision-panel').hidden ? null : document.querySelector('#decision-panel .decision__title')?.textContent,
      layer: document.getElementById('event-layer').hidden ? null : document.getElementById('event-layer').innerText.slice(0, 80).replace(/\s+/g, ' '),
      ships: window.__ships })).catch(() => null);
    console.log('  ...', JSON.stringify(at));
  }, 30000);
  const planning = await play(page, s => s.planning, 3, 'carthag');
  clearInterval(watchdog);
  if (planning) {
    await page.click('.bs__commit');
    check(await page.waitForSelector('.bs--reveal', { timeout: 60000 }).then(() => true, () => false), 'a battle reveal played');
  } else check(false, 'reached a battle of your own');
  const pics = await page.evaluate(() => ({ shown: window.__shown, missing: window.__missing, ships: window.__ships }));
  check(pics.ships > 0, `ships flew (${pics.ships} flights)`);
  check(pics.shown > 20 && pics.missing.length === 0, `no picture missing during animations (${pics.shown} shown${pics.missing.length ? `; missing: ${pics.missing.slice(0, 5).join('; ')}` : ''})`);

  // --- 3. Second visit: from the service worker's store ---------------------------------
  const before = slow.stats.bytes;
  t = Date.now();
  await page.goto(`${BASE}?debug=1&seed=4243`, { timeout: 180000 });
  await page.waitForSelector('#sheet-menu:not([hidden])', { timeout: 180000 });
  const menuSecond = (Date.now() - t) / 1000;
  t = Date.now();
  await page.click('#btn-new-game');
  await waitFor(page, () => !document.querySelector('.loading'), 180000);
  const loadSecond = (Date.now() - t) / 1000;
  const sent = slow.stats.bytes - before;
  console.log(`Second visit: menu after ${menuSecond.toFixed(1)} s, then "Preparing Arrakis" for ${loadSecond.toFixed(1)} s; ${(sent / 1e3).toFixed(0)} KB sent.`);
  const fromStore = await page.evaluate(() => performance.getEntriesByType('resource').filter(e => e.name.includes('/assets/') && !e.name.includes('/music/')).every(e => e.transferSize === 0));
  check(fromStore && loadSecond < 5, 'the second visit loads the art and sound from the store (no downloads)');

  // --- 4. A new version: the page picks up the new code ----------------------------------
  const indexPath = path.join(root, 'index.html'), mainPath = path.join(root, 'ui/main.js');
  const index = readFileSync(indexPath, 'utf8'), main = readFileSync(mainPath, 'utf8');
  const version = index.match(/Version (\S+)</)[1];
  try {
    writeFileSync(indexPath, index.replaceAll(version, `${version}-test`));
    writeFileSync(mainPath, `${main}\nwindow.__newCode = '${version}-test';\n`);
    await page.goto(`${BASE}?debug=1`, { timeout: 180000 });
    await page.waitForSelector('#sheet-menu:not([hidden])', { timeout: 180000 });
    const first = await page.evaluate(() => window.__newCode ?? null);
    // The new worker deletes the old store as it takes over; its own store starts with the next file it serves.
    await page.evaluate(() => navigator.serviceWorker.ready); await sleep(1500);
    await page.reload({ timeout: 180000 }); await page.waitForSelector('#sheet-menu:not([hidden])', { timeout: 180000 });
    const caches = await page.evaluate(() => caches.keys());
    check(first === `${version}-test`, `a new version string brings in the new code on the first load (${first ?? 'old code'})`);
    check(caches.length === 1 && caches[0].endsWith(`${version}-test`), `the old store is replaced by the new version's (${caches.join(', ')})`);
  } finally {
    writeFileSync(indexPath, index); writeFileSync(mainPath, main);
  }

  check(page.errors.length === 0, `no page errors${page.errors.length ? `: ${page.errors.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
  await slow.close();
  console.log(failures ? `${failures} check(s) failed.` : 'All loading checks passed.');
  return failures ? 1 : 0;
}

main().then(code => process.exit(code), err => { console.error(err); process.exit(1); });
