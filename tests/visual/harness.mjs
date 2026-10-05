// tests/visual/harness.mjs
//
// Shared plumbing for the screenshot tests: a local server, a browser with the
// game's settings fixed and Math.random seeded, the scripted game that visits
// each key screen, and a pixel comparison that needs no dependencies.

import { createRequire } from 'node:module';
import { execSync, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '../..');
const SEED = 4242;
const PORT = 8123;
// A pixel counts as different if any channel moves by more than this, and a
// screen fails if more than this share of its pixels differ (anti-aliasing noise).
const CHANNEL_TOLERANCE = 24;
const MAX_DIFF_SHARE = 0.0002;

const req = createRequire(import.meta.url);
export let chromium;
try { ({ chromium } = req('playwright')); } catch { ({ chromium } = req(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }

export const launch = () => chromium.launch();

// Web fonts: fetched with curl (which goes through the sandbox's proxy) and cached
// in tests/visual/out/fonts/, then handed to the browser, so every shot uses the
// real fonts rather than a fallback.
const FONT_CACHE = path.join(here, 'out', 'fonts');
const CHROME_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
function fetchFont(url) {
  mkdirSync(FONT_CACHE, { recursive: true });
  const file = path.join(FONT_CACHE, createHash('sha1').update(url).digest('hex'));
  if (!existsSync(file)) execFileSync('curl', ['-sSfL', '-A', CHROME_UA, '-o', file, url]);
  return readFileSync(file);
}
async function serveFonts(context) {
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => {
    const url = route.request().url();
    try {
      route.fulfill({ body: fetchFont(url), contentType: url.includes('googleapis') ? 'text/css' : 'font/woff2', headers: { 'Access-Control-Allow-Origin': '*' } });
    } catch { route.abort(); }
  });
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function startServer() {
  return spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
}

// The game's own settings, so every run starts the same way.
const STORAGE = {
  'my-arrakis-speed': '0', 'my-arrakis-music': '{"enabled":false}', 'my-arrakis-sfx': '{"enabled":false}',
  'my-arrakis-lineup': '["atreides","harkonnen","emperor","fremen","guild","gesserit"]',
  'my-arrakis-camera': 'on', 'my-arrakis-tech': 'on', 'my-arrakis-tech-reset-1': '1', 'my-arrakis-ixtl': 'on',
  'my-arrakis-buttons': 'brass', 'my-arrakis-phases': 'brass'
};

// Opens the game in a fresh browser context. `mobile` gives a touch phone.
export async function openGame(browser, { width, height, mobile = false, query = '' }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile, reducedMotion: 'reduce' });
  await context.addInitScript(storage => {
    // A seeded Math.random, so even cosmetic randomness repeats.
    let a = 99;
    Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    if (!sessionStorage.getItem('seeded')) { localStorage.clear(); for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); }
  }, STORAGE);
  await serveFonts(context);
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  for (let i = 0; i < 40; i++) { try { await page.goto(`http://127.0.0.1:${PORT}/?debug=1&seed=${SEED}${query}`); break; } catch { await sleep(250); } }
  return page;
}

// Plays the scripted game, calling `shot(name)` at each key screen:
// menu, map, tech-info, bid, auction, battle-plan, battle-reveal, victory.
export async function playScenario(page, shot) {
  // 1. Menu.
  await page.waitForSelector('#sheet-menu:not([hidden])');
  // Load every font weight up front, so no screen is shot in a fallback font.
  await page.evaluate(() => Promise.all(['600 1em Cinzel', '700 1em Cinzel', '400 1em Inter', '500 1em Inter', '600 1em Inter', '700 1em Inter',
    '400 1em "JetBrains Mono"', '600 1em "JetBrains Mono"', '700 1em "JetBrains Mono"'].map(f => document.fonts.load(f))));
  await sleep(800);
  await shot('menu');

  // 2. New game: keep the offered traitor, then the map at the start of turn 1.
  await page.click('#btn-new-game');
  await waitFor(page, () => !document.getElementById('decision-panel').hidden);
  await page.click('#decision-panel [data-default-action]');
  await waitFor(page, () => !document.getElementById('btn-run-turn').disabled && document.getElementById('decision-panel').hidden);
  await shot('map');

  // 3. The Tech Token card.
  await page.click('#tech-tray .tech-slot');
  await page.waitForSelector('.tech-info');
  await shot('tech-info');
  await page.click('.tech-info__x');

  // 4. The auction and the bid panel (played at Normal speed so the auction card shows).
  await setSpeed(page, '1');
  await play(page, s => s.panelTitle?.startsWith('Treachery card'));
  await shot('bid');
  await page.click('#decision-panel .decision__toggle');
  await shot('auction');
  await page.click('#decision-panel .decision__toggle');

  // 5. A battle of your own (ship into Carthag): planning, then the reveal.
  await setSpeed(page, '0');
  const found = await play(page, s => s.planning, 3, 'carthag');
  if (found) {
    await shot('battle-plan');
    await setSpeed(page, '1');
    await page.click('.bs__commit');
    await waitFor(page, () => document.querySelector('.bs__tap'), 30000);
    await sleep(1200); // the cards finish turning over
    await shot('battle-reveal');
  } else {
    console.log('  (no battle of your own within 3 turns: battle shots skipped)');
  }

  // 6. Victory.
  // No fade-in for the photo: it can leave the text on its own layer, which renders slightly differently.
  await page.addStyleTag({ content: '.victory { animation: none !important; }' });
  await page.evaluate(() => {
    const s = window.__arrakis.state;
    s.victory = { ...s.victory, achieved: true, method: 'stronghold-solo', winningFactions: ['atreides'] };
    window.__arrakis.showVictory();
  });
  await page.waitForSelector('#victory');
  await sleep(1500); // let the fade-in finish on its own, so the text renders the same every time
  await shot('victory');

}

// Plays on, taking every default, until `stop(state)` is true. Gives up after `maxTurns`.
// With `attackAt`, every shipment goes to that territory.
export async function play(page, stop, maxTurns = 3, attackAt = null) {
  const start = await page.evaluate(() => window.__arrakis.state.meta.turn);
  for (let i = 0; i < 20000; i++) {
    const s = await page.evaluate(() => {
      const panel = document.getElementById('decision-panel');
      return {
        panelTitle: panel.hidden ? null : panel.querySelector('.decision__title')?.textContent,
        planning: Boolean(document.querySelector('.bs__commit')),
        choices: Boolean(document.querySelector('.bs__choices')),
        canRun: !document.getElementById('btn-run-turn').disabled,
        turn: window.__arrakis.state.meta.turn,
        over: window.__arrakis.state.victory.achieved
      };
    });
    if (stop(s)) return true;
    if (s.over || s.turn - start >= maxTurns) { console.log(`  (stopped at turn ${s.turn}${s.over ? ", game over" : ""})`); return false; }
    if (s.planning) {
      const ok = await page.evaluate(() => { const b = document.querySelector('.bs__commit'); if (b.disabled) return false; b.click(); return true; });
      if (!ok) throw new Error('Default battle plan was not legal');
    } else if (s.choices) {
      await page.evaluate(() => document.querySelector('.bs__choices button:last-child').click());
    } else if (s.panelTitle !== null) {
      await page.evaluate(attackAt => {
        const p = document.getElementById('decision-panel');
        // Ship into an enemy stronghold, so a battle of your own follows.
        const shipTo = p.querySelector('[name="shipTo"]');
        if (attackAt && shipTo?.querySelector(`option[value="${attackAt}"]`)) { shipTo.value = attackAt; shipTo.dispatchEvent(new Event('change', { bubbles: true })); }
        const b = p.querySelector('[data-default-action]') ?? p.querySelector('.decision__actions .btn--primary') ?? p.querySelector('.decision__body button');
        b?.click();
      }, attackAt);
    } else if (s.canRun) {
      await page.click('#btn-run-turn');
    }
    await sleep(120);
  }
  return false;
}

export async function setSpeed(page, value) {
  await page.evaluate(v => { const el = document.getElementById('select-speed'); el.value = v; el.dispatchEvent(new Event('change')); }, value);
}

export async function waitFor(page, fn, timeout = 20000) {
  await page.waitForFunction(fn, null, { timeout, polling: 100 });
}

// Waits until finite animations have finished and images have loaded.
export async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every(i => i.complete)
    && document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), null, { timeout: 15000, polling: 100 }).catch(() => {});
  await sleep(300);
}

// Compares each new shot with its reference in a browser canvas (no dependencies).
export async function compare(names, refDir, outDir) {
  const browser = await launch();
  const page = await browser.newPage();
  let failed = 0;
  for (const name of names) {
    const refFile = path.join(refDir, `${name}.png`);
    if (!existsSync(refFile)) { console.log(`MISSING  ${name} (no reference; run with --update)`); failed++; continue; }
    const a = readFileSync(refFile).toString('base64'), b = readFileSync(path.join(outDir, `${name}.png`)).toString('base64');
    const r = await page.evaluate(async ({ a, b, tol }) => {
      const load = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = `data:image/png;base64,${src}`; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { share: 1, size: true };
      const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height;
      const g = c.getContext('2d');
      g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, c.width, c.height).data;
      g.drawImage(ib, 0, 0); const db = g.getImageData(0, 0, c.width, c.height);
      let n = 0;
      for (let i = 0; i < da.length; i += 4) {
        const diff = Math.max(Math.abs(da[i] - db.data[i]), Math.abs(da[i + 1] - db.data[i + 1]), Math.abs(da[i + 2] - db.data[i + 2]));
        if (diff > tol) { n++; db.data[i] = 255; db.data[i + 1] = 0; db.data[i + 2] = 255; }
      }
      g.putImageData(db, 0, 0);
      return { share: n / (c.width * c.height), diff: c.toDataURL('image/png').split(',')[1] };
    }, { a, b, tol: CHANNEL_TOLERANCE });
    const ok = r.share <= MAX_DIFF_SHARE;
    if (!ok && r.diff) writeFileSync(path.join(outDir, `${name}.diff.png`), Buffer.from(r.diff, 'base64'));
    console.log(`${ok ? 'OK      ' : 'CHANGED '} ${name} (${(r.share * 100).toFixed(3)}% of pixels${r.size ? ', different size' : ''})`);
    if (!ok) failed++;
  }
  await browser.close();
  console.log(failed ? `${failed} screen(s) changed. See ${path.relative(root, outDir)}/.` : 'Screens unchanged.');
  return failed ? 1 : 0;
}
