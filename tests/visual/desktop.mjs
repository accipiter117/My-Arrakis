// tests/visual/desktop.mjs
//
// Desktop screenshots for review: the same scripted game as the phone test, with
// ?layout=desktop, at 1280 x 720, 1440 x 900 and 1920 x 1080. Shots go to
// tests/visual/out/desktop/<size>/ (ignored by git); nothing is compared yet.
//
//   node tests/visual/desktop.mjs            all three sizes
//   node tests/visual/desktop.mjs 1440x900   one size

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { here, launch, startServer, openGame, playScenario, settle } from './harness.mjs';

const SIZES = ['1280x720', '1440x900', '1920x1080'];
const chosen = process.argv.slice(2).filter(a => /^\d+x\d+$/.test(a));

async function main() {
  const browser = await launch();
  for (const size of chosen.length ? chosen : SIZES) {
    const [width, height] = size.split('x').map(Number);
    const out = path.join(here, 'out', 'desktop', size);
    mkdirSync(out, { recursive: true });
    console.log(size);
    const page = await openGame(browser, { width, height, query: '&layout=desktop' });
    await playScenario(page, async name => {
      await settle(page);
      await page.screenshot({ path: path.join(out, `${name}.png`), animations: 'disabled', caret: 'hide' });
      console.log(`  ${name}`);
    });
    if (page.errors.length) console.log(`  Page errors:\n    ${page.errors.join('\n    ')}`);
    await page.context().close();
  }
  await browser.close();
  return 0;
}

const server = startServer();
main().then(code => { server.kill(); process.exit(code); }, err => { console.error(err); server.kill(); process.exit(1); });
