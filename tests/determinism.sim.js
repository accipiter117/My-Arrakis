// determinism.sim.js — the same seed must replay the same game exactly.
// Run with: node tests/determinism.sim.js

import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import * as phaseEngine from '../js/phaseEngine.js';
import { createStrategicAI } from '../js/ai/strategicAI.js';

const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] =
  ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cardLookup = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const ALL = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];

function assert(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('  ok - ' + message);
}

async function playToEnd(seed) {
  const state = initializeGame({ activeFactionIds: ALL, playerCircleOrder: ALL, rulesConfig, seed,
    spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
  const ai = createStrategicAI({ leadersData: leaders, cardLookup });
  await turnEngine.runSetupDecisions(state, ai);
  phaseEngine.nextPhase(state);
  const log = [];
  while (!state.victory.achieved) log.push(...await turnEngine.runFullTurn(state, ai, territories, cardLookup));
  return JSON.stringify({ state, log });
}

console.log('Test 1: the same seed replays an identical game, three times over');
for (const seed of [11, 2026, 987654]) {
  const a = await playToEnd(seed);
  const b = await playToEnd(seed);
  assert(a === b, `seed ${seed} replays identically (${(a.length / 1024).toFixed(0)} KB of state and log)`);
}

console.log('\nTest 2: different seeds produce different games');
assert(await playToEnd(1) !== await playToEnd(2), 'seeds 1 and 2 differ');

console.log('\nTest 3: save mid-game, restore, and the rest of the game is identical');
{
  const { getRandomState, setRandomState } = await import('../js/random.js');
  const seed = 4242;
  const reference = await playToEnd(seed);
  // Play to turn 4, snapshot state + random position, then finish.
  const state = initializeGame({ activeFactionIds: ALL, playerCircleOrder: ALL, rulesConfig, seed,
    spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
  const ai = createStrategicAI({ leadersData: leaders, cardLookup });
  await turnEngine.runSetupDecisions(state, ai);
  phaseEngine.nextPhase(state);
  const log = [];
  // Save on turn 3, or earlier if the game is already won (a finished game must not be played on).
  while (state.meta.turn < 3 && !state.victory.achieved) log.push(...await turnEngine.runFullTurn(state, ai, territories, cardLookup));
  const saved = JSON.stringify({ state, rng: getRandomState(), log });
  setRandomState(12345); // scramble, as a page reload would
  const loaded = JSON.parse(saved);
  setRandomState(loaded.rng);
  const resumed = loaded.state;
  const ai2 = createStrategicAI({ leadersData: leaders, cardLookup });
  while (!resumed.victory.achieved) loaded.log.push(...await turnEngine.runFullTurn(resumed, ai2, territories, cardLookup));
  assert(JSON.stringify({ state: resumed, log: loaded.log }) === reference, 'a game saved mid-game and resumed finishes exactly like the uninterrupted game');
}

console.log('\nAll determinism checks passed.');
