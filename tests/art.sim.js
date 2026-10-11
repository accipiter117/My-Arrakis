// art.sim.js — every picture the game can show is in the art catalogue (ui/art.js), so the
// loading screen loads all of it before play. Fails if:
//   - a listed picture has no file in assets/;
//   - a picture file in assets/ is missing from the list (new art not added to ui/art.js);
//   - the code names an image file anywhere but ui/art.js;
//   - a stylesheet draws an image the list doesn't have (same file and ?v= tag).
// Run with: node tests/art.sim.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { allArt } from '../ui/art.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');
const leaders = JSON.parse(fs.readFileSync(path.join(root, 'data/leaders.json'), 'utf8'));
const factions = Object.keys(leaders).filter(k => !k.startsWith('_'));
const leaderIds = factions.flatMap(f => leaders[f].map(l => l.id));

let failures = 0;
const fail = msg => { failures++; console.error('FAILED: ' + msg); };

const list = allArt({ factions, leaderIds });
const rel = u => decodeURIComponent(new URL(u).pathname).split('/assets/')[1];
const listed = new Set(list.map(rel));
const listedWithTag = new Set(list.map(u => { const x = new URL(u); return rel(u) + x.search; }));

// 1. Every listed picture exists.
for (const f of listed) if (!fs.existsSync(path.join(assets, f))) fail(`listed but missing: assets/${f}`);

// 2. Every picture file is listed.
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const IMAGE = /\.(webp|png|jpe?g|gif|svg|avif)$/i;
for (const file of walk(assets)) {
  const r = path.relative(assets, file).split(path.sep).join('/');
  if (IMAGE.test(r) && !listed.has(r)) fail(`assets/${r} is not in ui/art.js (it would not be preloaded)`);
}

// 3. No image paths in the code outside ui/art.js (comments aside).
const IMG_PATH = /assets\/[^'"`)\s]*\.(webp|png|jpe?g|gif|svg|avif)/i;
for (const name of fs.readdirSync(path.join(root, 'ui')).filter(n => n.endsWith('.js') && n !== 'art.js')) {
  fs.readFileSync(path.join(root, 'ui', name), 'utf8').split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    if (IMG_PATH.test(code)) fail(`ui/${name}:${i + 1} names an image directly; take it from ui/art.js`);
  });
}
for (const name of ['index.html']) if (IMG_PATH.test(fs.readFileSync(path.join(root, name), 'utf8'))) fail(`${name} names an image directly`);

// 4. Stylesheet images are in the list, with the same ?v= tag (otherwise the loaded copy isn't the one drawn).
for (const name of fs.readdirSync(path.join(root, 'ui')).filter(n => n.endsWith('.css'))) {
  const css = fs.readFileSync(path.join(root, 'ui', name), 'utf8');
  for (const m of css.matchAll(/url\(\s*['"]?\.\.\/assets\/([^'")]+)['"]?\s*\)/g)) {
    if (!listedWithTag.has(m[1])) fail(`ui/${name} draws assets/${m[1]}, which ui/art.js doesn't list with that tag`);
  }
}

console.log(`${list.length} pictures in the art list.`);
if (failures) { console.error(`${failures} problem(s).`); process.exit(1); }
console.log('Art catalogue check passed.');
