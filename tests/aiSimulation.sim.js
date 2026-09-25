// aiSimulation.sim.js — many full AI-vs-AI games (brief section 37).
// Checks rule invariants after EVERY phase, then reports outcomes.
// Run with: node tests/aiSimulation.sim.js [games]

import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import * as phaseEngine from '../js/phaseEngine.js';
import { createBasicAI } from '../js/ai/basicAI.js';

const loadJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const territoriesData = loadJSON('./data/territories.json');
const spiceDeckData = loadJSON('./data/spiceDeck.json');
const treacheryDeckData = loadJSON('./data/treacheryDeck.json');
const leadersData = loadJSON('./data/leaders.json');
const rulesConfig = loadJSON('./data/rulesConfig.json');

const cardLookup = Object.fromEntries(treacheryDeckData.cards.map(c => [c.id, c]));
const ALL = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];
const GAMES = Number(process.argv[2] ?? 50);

// Small seeded RNG so any failing game can be replayed exactly.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const shuffleWith = rng => arr => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

const TOTAL_TREACHERY = treacheryDeckData.cards.length;

// Forces are never created or destroyed, only moved between reserve,
// board and tanks. Totals are recorded at setup and checked every phase.
const sum = obj => Object.values(obj ?? {}).reduce((a, b) => a + b, 0);
function forceTotals(f) {
  return {
    all: f.forces.reserve + (f.revivalTanks ?? 0) + sum(f.forces.onBoard),
    starred: (f.forces.starredReserve ?? 0) + (f.starredRevivalTanks ?? 0) + sum(f.forces.starredOnBoard)
  };
}
let initialTotals = {};

function checkInvariants(state, where) {
  const problems = [];
  for (const [id, f] of Object.entries(state.factions)) {
    const now = forceTotals(f);
    if (now.all !== initialTotals[id].all) problems.push(`${id} total forces ${now.all}, expected ${initialTotals[id].all}`);
    if (now.starred !== initialTotals[id].starred) problems.push(`${id} starred forces ${now.starred}, expected ${initialTotals[id].starred}`);
    if ((f.forces.starredReserve ?? 0) > f.forces.reserve) problems.push(`${id} has more starred than total in reserve`);
    if ((f.starredRevivalTanks ?? 0) > (f.revivalTanks ?? 0)) problems.push(`${id} has more starred than total in the tanks`);
    for (const [t, n] of Object.entries(f.forces.starredOnBoard ?? {})) {
      if (n > (f.forces.onBoard[t] ?? 0)) problems.push(`${id} has ${n} starred but ${f.forces.onBoard[t] ?? 0} total in ${t}`);
    }
  }
  for (const [id, f] of Object.entries(state.factions)) {
    if (!Number.isInteger(f.spice) || f.spice < 0) problems.push(`${id} spice is ${f.spice}`);
    if (!Number.isFinite(f.forces.reserve) || f.forces.reserve < 0) problems.push(`${id} reserve is ${f.forces.reserve}`);
    if (f.revivalTanks < 0) problems.push(`${id} tanks is ${f.revivalTanks}`);
    for (const [t, n] of Object.entries(f.forces.onBoard)) {
      if (!Number.isFinite(n) || n <= 0) problems.push(`${id} has ${n} forces recorded in ${t}`);
    }
    if (f.treacheryHand.length > (id === 'harkonnen' ? 8 : 4)) problems.push(`${id} over hand limit (${f.treacheryHand.length})`);
  }
  // Treachery card conservation: every card is in the deck, a discard pile or a hand.
  const held = Object.values(state.factions).reduce((n, f) => n + f.treacheryHand.length, 0);
  const cards = state.decks.treacheryDeck.length + state.decks.treacheryDiscard.length + held;
  if (cards !== TOTAL_TREACHERY) problems.push(`treachery cards total ${cards}, expected ${TOTAL_TREACHERY}`);
  if (problems.length) throw new Error(`Invariant broken after ${where}: ${problems.join('; ')}`);
}

const stats = { starredInBattle: 0, wins: {}, methods: {}, endTurns: [], battles: 0, cardsBought: 0, shipments: 0, moves: 0 };
let failures = 0;

for (let g = 0; g < GAMES; g++) {
  const seed = 1000 + g;
  const rng = mulberry32(seed);
  try {
    const state = initializeGame({
      activeFactionIds: ALL, playerCircleOrder: ALL, rulesConfig,
      spiceDeckData, territoriesData, treacheryDeckData, leadersData,
      rngShuffle: shuffleWith(rng)
    });
    initialTotals = Object.fromEntries(Object.entries(state.factions).map(([id, f]) => [id, forceTotals(f)]));
    const ai = createBasicAI({ leadersData, cardLookup, rng });
    await turnEngine.runSetupDecisions(state, ai);
    phaseEngine.nextPhase(state);
    checkInvariants(state, 'setup');

    let guard = 0;
    while (!state.victory.achieved && guard++ < 400) {
      const entry = await turnEngine.stepOnePhase(state, ai, territoriesData, cardLookup);
      checkInvariants(state, `turn ${entry.turn} ${entry.phase}`);
      if (entry.phase === 'battle') {
        stats.battles += entry.result.length;
        stats.starredInBattle += entry.result.filter(r => r.aggressorId && (state.factions.emperor || state.factions.fremen)).length && 0;
      }
      if (entry.phase === 'bidding') stats.cardsBought += entry.result.filter(r => r.winner).length;
      if (entry.phase === 'shipment') {
        stats.shipments += entry.result.filter(r => r.type === 'shipment').length;
        stats.moves += entry.result.filter(r => r.type === 'movement').length;
      }
    }
    if (!state.victory.achieved) throw new Error('game never ended');

    const key = state.victory.winningFactions.join('+');
    stats.wins[key] = (stats.wins[key] ?? 0) + 1;
    stats.methods[state.victory.method] = (stats.methods[state.victory.method] ?? 0) + 1;
    stats.endTurns.push(state.meta.turn);
  } catch (err) {
    failures++;
    console.log(`Game ${g} (seed ${seed}) FAILED: ${err.message}`);
    if (failures >= 5) break;
  }
}

const avg = a => (a.reduce((x, y) => x + y, 0) / (a.length || 1)).toFixed(1);
console.log(`\nGames: ${GAMES}, failed: ${failures}`);
console.log(`Average ending turn: ${avg(stats.endTurns)}`);
console.log(`Per game: ${(stats.battles / GAMES).toFixed(1)} battles, ${(stats.cardsBought / GAMES).toFixed(1)} cards bought, ${(stats.shipments / GAMES).toFixed(1)} shipments, ${(stats.moves / GAMES).toFixed(1)} moves`);
console.log('Winners:', stats.wins);
console.log('Victory methods:', stats.methods);

if (failures > 0) process.exit(1);
console.log('\nAll simulated games completed with every invariant intact.');
