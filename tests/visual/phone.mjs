// tests/visual/phone.mjs
//
// Phone regression screenshots (desktop layout plan, section 0). Plays a seeded
// game as Atreides on a 390 x 844 screen and photographs the key screens:
// menu, map at the start of a turn, Tech Token card, bid panel, auction,
// battle planning, battle reveal and victory.
//
//   node tests/visual/phone.mjs            compare against tests/visual/phone/*.png
//   node tests/visual/phone.mjs --update   save new reference images
//
// Needs Playwright (preinstalled in Claude Code sessions). Not part of `npm test`.
// Differences are written to tests/visual/out/ (ignored by git).

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { here, launch, startServer, openGame, playScenario, settle, compare } from './harness.mjs';

const REF = path.join(here, 'phone');
const OUT = path.join(here, 'out');
const UPDATE = process.argv.includes('--update');

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(REF, { recursive: true });
  const browser = await launch();
  const page = await openGame(browser, { width: 390, height: 844, mobile: true });
  const results = [];
  await playScenario(page, async name => {
    await settle(page);
    await page.screenshot({ path: path.join(UPDATE ? REF : OUT, `${name}.png`), animations: 'disabled', caret: 'hide' });
    results.push(name);
    console.log(`  ${name}`);
  });
  await browser.close();
  if (page.errors.length) console.log(`Page errors:\n  ${page.errors.join('\n  ')}`);
  return UPDATE ? 0 : compare(results, REF, OUT);
}

const server = startServer();
main().then(code => { server.kill(); process.exit(code); }, err => { console.error(err); server.kill(); process.exit(1); });
