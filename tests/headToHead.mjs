// headToHead.mjs — does each faction's strategy win more? For each seed and line-up:
// one game with every faction on the baseline AI, then one game per seated faction
// with only that faction using its strategy. Paired seeds cancel out luck.
// Usage: node tests/headToHead.mjs <seeds> [first seed] [factions to test, comma list]
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import * as phaseEngine from '../js/phaseEngine.js';
import { createAI } from '../js/ai/difficulty.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cards = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const ALL = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit', 'ixians', 'tleilaxu', 'choam', 'richese'];
const N = Number(process.argv[2] || 20), SEED0 = Number(process.argv[3] || 20000);
const only = process.argv[4] ? process.argv[4].split(',') : null;
let seed = SEED0; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

function router(on, off, testFaction) {
  const out = {};
  for (const k of new Set([...Object.keys(on), ...Object.keys(off)])) {
    const a = on[k], b = off[k];
    if (typeof a !== 'function') { out[k] = a ?? b; continue; }
    out[k] = (...args) => (args[1] === testFaction ? on : off)[k](...args);
  }
  return out;
}
async function play(ids, gameSeed, testFaction) {
  const st = initializeGame({ activeFactionIds: ids, playerCircleOrder: ids, rulesConfig, seed: gameSeed, spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
  const on = createAI('hard', { leadersData: leaders, cardLookup: cards });
  const off = createAI('hard', { leadersData: leaders, cardLookup: cards, factionStrategy: false });
  const dp = testFaction ? router(on, off, testFaction) : off;
  await turnEngine.runSetupDecisions(st, dp); phaseEngine.nextPhase(st);
  let guard = 0;
  while (!st.victory.achieved && guard++ < 500) await turnEngine.stepOnePhase(st, dp, territories, cards);
  return st.victory.winningFactions ?? [];
}
const res = {};
for (let g = 0; g < N; g++) {
  const ids = ALL.slice().sort(() => rnd() - 0.5).slice(0, 6);
  const gs = SEED0 + g;
  const base = await play(ids, gs, null);
  for (const f of ids) {
    if (only && !only.includes(f)) continue;
    const w = await play(ids, gs, f);
    const r = res[f] ??= { games: 0, base: 0, strat: 0 };
    r.games++; r.base += base.includes(f) ? 1 / base.length : 0; r.strat += w.includes(f) ? 1 / w.length : 0;
  }
  fs.writeFileSync('/tmp/h2h.json', JSON.stringify({ done: g + 1, res }));
}
for (const [f, r] of Object.entries(res).sort((a, b) => (b[1].strat - b[1].base) / b[1].games - (a[1].strat - a[1].base) / a[1].games))
  console.log(f.padEnd(10), 'games', r.games, 'baseline', Math.round(r.base / r.games * 100) + '%', 'with strategy', Math.round(r.strat / r.games * 100) + '%');
