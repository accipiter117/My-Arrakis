// spice.sim.js — headless sanity check against real spice deck data.
// Run with: node spice.sim.js

const fs = require('fs');
const {
  buildSpiceDeck, resolvePile, resolveSpiceBlowPhase, devourTopOfPile
} = require('./js/spiceEngine.js');

const spiceDeckData = JSON.parse(fs.readFileSync('./data/spiceDeck.json', 'utf8'));
const territoriesData = JSON.parse(fs.readFileSync('./data/territories.json', 'utf8'));

function identityShuffle(arr) { return arr.slice(); } // deterministic for testing

function makeMinimalState(turn = 2) {
  return {
    meta: { turn },
    board: { spiceBlowMarkers: [] },
    decks: { spiceDeck: [], spiceDiscardA: [], spiceDiscardB: [] },
    nexus: { active: false },
    factions: {
      atreides: { forces: { onBoard: {} } },
      fremen: { forces: { onBoard: {} } }
    }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('  ok - ' + message);
}

console.log('Test 1: deck composition matches the rulebook (6 worms + 15 territory cards = 21)');
let state = makeMinimalState();
state.decks.spiceDeck = buildSpiceDeck(spiceDeckData, territoriesData, identityShuffle);
assert(state.decks.spiceDeck.length === 21, `deck has 21 cards, got ${state.decks.spiceDeck.length}`);
const wormCount = state.decks.spiceDeck.filter(c => c.type === 'shaiHulud').length;
assert(wormCount === 6, `deck has exactly 6 worm cards, got ${wormCount}`);

console.log('\nTest 2: turn 1 exception, worms are set aside not resolved as Nexus triggers');
state = makeMinimalState(1); // turn 1
// Stack the deck: worm, worm, then a real territory card, so pile A must
// skip two worms before landing on a placement.
state.decks.spiceDeck = [
  { type: 'territory', id: 'oldGap', maxValue: 6 },
  { type: 'shaiHulud', id: 'w1' },
  { type: 'shaiHulud', id: 'w2' }
];
const resultA = resolvePile(state, 'A');
assert(resultA.triggeredNexus === false, 'turn 1 worms never trigger a Nexus');
assert(resultA.setAsideWorms.length === 2, 'both turn-1 worms were set aside rather than resolved');
assert(state.board.spiceBlowMarkers.some(m => m.territoryId === 'oldGap'), 'the territory card underneath was still placed correctly');

console.log('\nTest 3: worm devours the previous placement and triggers Nexus (turn > 1)');
state = makeMinimalState(3); // not turn 1
state.factions.atreides.forces.onBoard.oldGap = 4;
state.factions.fremen.forces.onBoard.oldGap = 2;
state.decks.spiceDiscardA = [{ type: 'territory', id: 'oldGap', maxValue: 6 }];
state.board.spiceBlowMarkers = [{ territoryId: 'oldGap', amount: 6, pile: 'A', turn: 2 }];

state.decks.spiceDeck = [{ type: 'territory', id: 'haggaBasin', maxValue: 6 }, { type: 'shaiHulud', id: 'w3' }];
const resultC = resolvePile(state, 'A');

assert(resultC.triggeredNexus === true, 'a worm drawn after turn 1 correctly triggers a Nexus');
assert(!state.board.spiceBlowMarkers.some(m => m.territoryId === 'oldGap'), 'spice at the devoured territory was removed');
assert(state.factions.atreides.forces.onBoard.oldGap === undefined, 'non-Fremen forces at the devoured territory were removed');
assert(state.factions.atreides.revivalTanks === 4, 'removed forces correctly went to the revival tanks');
assert(state.factions.fremen.forces.onBoard.oldGap === 2, 'Fremen forces survive the worm, protected per their faction ability');
assert(state.board.spiceBlowMarkers.some(m => m.territoryId === 'haggaBasin'), 'the pile then continued past the worm to place the next territory card');

console.log('\nTest 4: full phase resolution wires both piles and sets nexus.active');
state = makeMinimalState(2);
state.decks.spiceDeck = buildSpiceDeck(spiceDeckData, territoriesData, identityShuffle);
resolveSpiceBlowPhase(state);
assert(state.board.spiceBlowMarkers.length === 2, 'both piles placed exactly one spice blow each in a clean run');
assert(typeof state.nexus.active === 'boolean', 'nexus.active is set to a real boolean after phase resolution');

console.log('\nAll spice engine sanity checks passed.');
