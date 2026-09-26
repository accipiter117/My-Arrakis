// tournament.sim.js — does an AI actually play better? (docs/AI_PLAN.md s6)
// Same seeds played with and without the candidate AI in one seat, rotated
// through every faction, so the only difference is the decision-maker.
// Run with: node tests/tournament.sim.js [seedsPerFaction]

import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import * as phaseEngine from '../js/phaseEngine.js';
import { createBasicAI } from '../js/ai/basicAI.js';
import { createStrategicAI } from '../js/ai/strategicAI.js';

const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] =
  ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cardLookup = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const ALL = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];
const SEEDS = Number(process.argv[2] ?? 40);

function mulberry32(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const shuffleWith = rng => arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Routes each decision to the provider controlling that faction's seat.
function seats(bySeat, fallback) {
  const pick = f => bySeat[f] ?? fallback;
  const route = name => (state, f, ...rest) => pick(f)[name](state, f, ...rest);
  const methods = ['chooseStormDial', 'chooseTraitor', 'choosePrediction', 'chooseBid', 'chooseRevival',
    'chooseShipmentAndMovement', 'chooseBattlePlan', 'choosePrescienceElement', 'chooseVoice', 'chooseCardsToDiscard',
    'chooseCaptureAction', 'chooseWormRide', 'chooseRevealTraitor', 'chooseBreakAlliance', 'chooseAllianceProposal', 'chooseAllianceResponse', 'chooseTruthtrance', 'chooseKaramaCancel', 'chooseAllyPledge', 'chooseEmperorAllyRevival', 'chooseDiscards'];
  return Object.fromEntries(methods.map(m => [m, route(m)]));
}

async function play(seed, makeProvider) {
  // The engine's single seeded random source makes both runs of a seed
  // identical except for the decision-maker being compared.
  const state = initializeGame({ activeFactionIds: ALL, playerCircleOrder: ALL, rulesConfig, seed,
    spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
  const provider = makeProvider();
  await turnEngine.runSetupDecisions(state, provider);
  phaseEngine.nextPhase(state);
  let guard = 0;
  while (!state.victory.achieved && guard++ < 40) await turnEngine.runFullTurn(state, provider, territories, cardLookup);
  return state.victory;
}

const opts = () => ({ leadersData: leaders, cardLookup });

// 1. Head to head, seat by seat.
console.log(`Head to head: ${SEEDS} seeds per faction, Strategic vs Basic in one seat, Basic elsewhere\n`);
let candTotal = 0, baseTotal = 0;
for (const seat of ALL) {
  let cand = 0, base = 0;
  for (let s = 0; s < SEEDS; s++) {
    const seed = 5000 + s;
    const a = await play(seed, rng => seats({ [seat]: createStrategicAI(opts(rng)) }, createBasicAI(opts(rng))));
    const b = await play(seed, rng => createBasicAI(opts(rng)));
    if (a.winningFactions.includes(seat)) cand++;
    if (b.winningFactions.includes(seat)) base++;
  }
  candTotal += cand; baseTotal += base;
  console.log(`  ${seat.padEnd(10)} Strategic ${String(cand).padStart(3)} wins  vs  Basic ${String(base).padStart(3)} wins`);
}
console.log(`  ${'TOTAL'.padEnd(10)} Strategic ${String(candTotal).padStart(3)} wins  vs  Basic ${String(baseTotal).padStart(3)} wins`);

// 2. Table health with everyone on the candidate AI.
async function health(label, make) {
  const wins = {}, methods = {}, turns = [];
  for (let s = 0; s < SEEDS * 2; s++) {
    const v = await play(9000 + s, make);
    for (const f of v.winningFactions) wins[f] = (wins[f] ?? 0) + 1;
    methods[v.method] = (methods[v.method] ?? 0) + 1;
  }
  console.log(`\n${label} (${SEEDS * 2} games): wins`, wins, '\n  methods', methods);
}
await health('All Basic', rng => createBasicAI(opts(rng)));
await health('All Strategic', rng => createStrategicAI(opts(rng)));
