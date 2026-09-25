// cardEffects.sim.js — Hajr and Ghola.
// Run with: node tests/cardEffects.sim.js

import fs from 'fs';
import { canPlayHajr, playHajr, canPlayGhola, playGhola } from '../js/cardEffects.js';
import { executeMove } from '../js/movementEngine.js';

const territoriesData = JSON.parse(fs.readFileSync('./data/territories.json', 'utf8'));
const rulesConfig = JSON.parse(fs.readFileSync('./data/rulesConfig.json', 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('  ok - ' + message);
}

function makeState() {
  return {
    board: { territories: territoriesData.territories },
    rulesConfig, alliances: [],
    decks: { treacheryDiscard: [] },
    factions: {
      fremen: {
        spice: 5, revivalTanks: 6, starredRevivalTanks: 1, hasMovedThisTurn: false,
        forces: { reserve: 2, starredReserve: 0, onBoard: { sietchTabr: 6, funeralPlain: 3 }, starredOnBoard: {} },
        leaders: { available: ['chani'], killed: ['stilgar'] },
        treacheryHand: ['hajr', 'ghola', 'baliset']
      }
    }
  };
}

console.log('Test 1: Hajr only after the normal move, then allows a second one');
let state = makeState();
assert(canPlayHajr(state, 'fremen', { from: 'funeralPlain', to: 'theGreatFlat', amount: 3 }).ok === false, 'refused before the normal move');
executeMove(state, 'fremen', 'sietchTabr', 'funeralPlain', 2);
const hajr = { from: 'funeralPlain', to: 'theGreatFlat', amount: 3 };
assert(canPlayHajr(state, 'fremen', hajr).ok === true, 'allowed after the normal move');
playHajr(state, 'fremen', hajr);
assert(state.factions.fremen.forces.onBoard.theGreatFlat === 3, 'the extra move happened');
assert(!state.factions.fremen.treacheryHand.includes('hajr') && state.decks.treacheryDiscard.includes('hajr'), 'Hajr discarded after use');
assert(state.factions.fremen.hasMovedThisTurn === true, 'still counts as moved afterwards');

console.log('\nTest 2: Ghola revives a leader for free');
state = makeState();
playGhola(state, 'fremen', { leaderId: 'stilgar' });
assert(state.factions.fremen.leaders.available.includes('stilgar'), 'stilgar back in play');
assert(state.factions.fremen.spice === 5, 'no spice spent');
assert(state.decks.treacheryDiscard.includes('ghola'), 'Ghola discarded');

console.log('\nTest 3: Ghola revives up to 5 forces, ordinary first, keeping starred counts right');
state = makeState(); // 6 in tanks, 1 of them starred
playGhola(state, 'fremen', { forces: 5 });
assert(state.factions.fremen.revivalTanks === 1, '1 left in the tanks');
assert(state.factions.fremen.forces.reserve === 7, 'reserve 2 + 5');
assert(state.factions.fremen.starredRevivalTanks === 1, 'the starred force stays in the tanks (5 ordinary were available)');

console.log('\nTest 4: Ghola refuses more than 5, or more than are in the tanks');
state = makeState();
assert(canPlayGhola(state, 'fremen', { forces: 6 }).ok === false, 'more than 5 refused');
state.factions.fremen.revivalTanks = 2; state.factions.fremen.starredRevivalTanks = 0;
assert(canPlayGhola(state, 'fremen', { forces: 3 }).ok === false, 'more than the tanks hold refused');

console.log('\nAll card effect checks passed.');
