// spiceCollection.sim.js — headless sanity check.
// Run with: node spiceCollection.sim.js

const {
  collectionRateFor, collectFromSpiceBlow, collectAllSpiceBlows, collectIncreasedSpiceFlow, resolveSpiceCollectionPhase
} = require('./js/spiceCollectionEngine.js');

function makeState() {
  return {
    board: { spiceBlowMarkers: [] },
    factions: {
      atreides: { spice: 0, forces: { onBoard: {} } },
      harkonnen: { spice: 0, forces: { onBoard: {} } },
      fremen: { spice: 0, forces: { onBoard: {} } }
    }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('  ok - ' + message);
}

console.log('Test 1: base collection rate is 2, boosted to 3 by occupying Carthag or Arrakeen');
let state = makeState();
assert(collectionRateFor(state, 'atreides') === 2, 'no city occupied, base rate of 2');
state.factions.atreides.forces.onBoard.arrakeen = 3;
assert(collectionRateFor(state, 'atreides') === 3, 'occupying arrakeen boosts the rate to 3, even collecting spice elsewhere');

console.log('\nTest 2: single faction collects up to their entitled amount, leftover remains');
state = makeState();
state.factions.harkonnen.forces.onBoard.oldGap = 2; // no city bonus, rate 2, entitled = 4
const marker = { territoryId: 'oldGap', amount: 6, pile: 'A', turn: 3 };
const result = collectFromSpiceBlow(state, marker, ['harkonnen', 'atreides', 'fremen']);
assert(result.collections.length === 1 && result.collections[0].collected === 4, 'harkonnen collects exactly their entitled 4 (2 forces x rate 2)');
assert(result.remaining === 2, '2 spice left uncollected (6 - 4)');
assert(state.factions.harkonnen.spice === 4, 'spice actually credited to harkonnen');

console.log('\nTest 3: multiple factions present split in turn order, later faction capped by what remains');
state = makeState();
state.factions.atreides.forces.onBoard.cielagoNorth = 5; // rate 2, entitled 10
state.factions.fremen.forces.onBoard.cielagoNorth = 3;   // rate 2, entitled 6
const marker2 = { territoryId: 'cielagoNorth', amount: 8, pile: 'A', turn: 3 };
const result2 = collectFromSpiceBlow(state, marker2, ['atreides', 'fremen', 'harkonnen']);
assert(state.factions.atreides.spice === 8, 'atreides (first in turn order) takes their full entitled 8 (capped by available, not their own 10 max)');
assert(state.factions.fremen.spice === 0, 'fremen gets nothing, all 8 spice was already claimed by atreides ahead of them in turn order');
assert(result2.remaining === 0, 'nothing left uncollected');

console.log('\nTest 4: leftover spice blow markers persist across the phase, fully-collected ones are removed');
state = makeState();
state.factions.harkonnen.forces.onBoard.oldGap = 1; // rate 2, entitled 2, blow has 6, leaves 4
state.factions.atreides.forces.onBoard.cielagoSouth = 10; // rate 2, entitled 20, blow has 12, fully collected
state.board.spiceBlowMarkers = [
  { territoryId: 'oldGap', amount: 6, pile: 'A', turn: 3 },
  { territoryId: 'cielagoSouth', amount: 12, pile: 'B', turn: 3 }
];
collectAllSpiceBlows(state, ['harkonnen', 'atreides']);
assert(state.board.spiceBlowMarkers.length === 1, 'fully-collected marker removed, partially-collected one remains');
assert(state.board.spiceBlowMarkers[0].territoryId === 'oldGap' && state.board.spiceBlowMarkers[0].amount === 4, 'remaining marker correctly shows leftover amount (6-2=4)');

console.log('\nTest 5: advanced Increased Spice Flow, passive income independent of any spice blow');
state = makeState();
state.factions.atreides.forces.onBoard.carthag = 2;
state.factions.harkonnen.forces.onBoard.arrakeen = 1;
state.factions.fremen.forces.onBoard.tueksSietch = 3;
const flowResults = collectIncreasedSpiceFlow(state);
assert(state.factions.atreides.spice === 2, 'atreides collects 2 for occupying carthag');
assert(state.factions.harkonnen.spice === 2, 'harkonnen collects 2 for occupying arrakeen');
assert(state.factions.fremen.spice === 1, 'fremen collects 1 for occupying tuek\'s sietch');
assert(flowResults.length === 3, 'three separate passive income entries recorded');

console.log('\nTest 6: occupying two qualifying strongholds stacks the passive income');
state = makeState();
state.factions.atreides.forces.onBoard.carthag = 1;
state.factions.atreides.forces.onBoard.arrakeen = 1;
collectIncreasedSpiceFlow(state);
assert(state.factions.atreides.spice === 4, 'atreides collects 2+2=4 for occupying both carthag and arrakeen simultaneously');

console.log('\nTest 7: full phase resolution runs both mechanisms together');
state = makeState();
state.factions.atreides.forces.onBoard.arrakeen = 2; // triggers rate boost AND passive income
state.factions.atreides.forces.onBoard.oldGap = 1;
state.board.spiceBlowMarkers = [{ territoryId: 'oldGap', amount: 10, pile: 'A', turn: 3 }];
resolveSpiceCollectionPhase(state, ['atreides']);
// Passive: 2 (arrakeen). Blow: 1 force x rate 3 (boosted by arrakeen occupation) = 3.
assert(state.factions.atreides.spice === 5, `expected 5 total (2 passive + 3 boosted blow collection), got ${state.factions.atreides.spice}`);

console.log('\nAll spice collection sanity checks passed.');
