// movement.sim.js — headless sanity check against real territory data.
// Run with: node movement.sim.js

const fs = require('fs');
const {
  hasOrnithopterAccess, moveRangeFor, reachableTerritories,
  shipmentCostPerForce, canShip, executeShipment, canMove, executeMove
} = require('./js/movementEngine.js');

const territoriesData = JSON.parse(fs.readFileSync('./data/territories.json', 'utf8'));
const rulesConfig = JSON.parse(fs.readFileSync('./data/rulesConfig.json', 'utf8'));

function makeMinimalState() {
  return {
    board: { territories: territoriesData.territories },
    rulesConfig,
    spiceBank: { totalInCirculation: 1000 },
    factions: {
      atreides: { spice: 20, forces: { reserve: 10, onBoard: { arrakeen: 5 } }, hasMovedThisTurn: false },
      fremen: { spice: 20, forces: { reserve: 10, onBoard: { sietchTabr: 5 } }, hasMovedThisTurn: false },
      guild: { spice: 20, forces: { reserve: 10, onBoard: {} }, hasMovedThisTurn: false },
      harkonnen: { spice: 20, forces: { reserve: 10, onBoard: { carthag: 2, imperialBasin: 2 } }, hasMovedThisTurn: false }
    }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('  ok - ' + message);
}

console.log('Test 1: ornithopter range vs normal range');
let state = makeMinimalState();
assert(hasOrnithopterAccess(state, 'atreides') === true, 'atreides has ornithopters (forces in Arrakeen)');
assert(hasOrnithopterAccess(state, 'fremen') === false, 'fremen has no ornithopters (no forces in Arrakeen/Carthag)');
assert(moveRangeFor(state, 'atreides') === 3, 'ornithopter access gives 3-territory range');
assert(moveRangeFor(state, 'fremen') === 2, 'fremen without ornithopters still gets their innate 2-territory range');
assert(moveRangeFor(state, 'guild') === 1, 'no special ability defaults to 1-territory range');

console.log('\nTest 2: three-hop ornithopter move (mirrors the rulebook\'s own worked example)');
// Rulebook example: with ornithopter access, a group starting in Tuek's Sietch
// can move through Pasty Mesa and Shield Wall to reach Imperial Basin.
state = makeMinimalState();
state.factions.atreides.forces.onBoard.tueksSietch = 4;
const reachableFromTueks = reachableTerritories(state, 'atreides', 'tueksSietch', moveRangeFor(state, 'atreides'));
assert(reachableFromTueks.includes('imperialBasin'), 'Imperial Basin is reachable from Tuek\'s Sietch within ornithopter range, matches rulebook example');

console.log('\nTest 3: stronghold blocking');
state = makeMinimalState();
state.factions.fremen.forces.onBoard.arrakeen = 3;
state.factions.harkonnen.forces.onBoard.arrakeen = 3;
// Arrakeen now has atreides + fremen + harkonnen = 3 factions present.
// A 4th faction (guild) trying to move in should be blocked.
state.factions.guild.forces.onBoard.oldGap = 5;
const moveCheck = canMove(state, 'guild', 'oldGap', 'arrakeen', 2);
assert(moveCheck.ok === false, 'cannot move into a stronghold already occupied by two other factions');

console.log('\nTest 4: shipment cost and Guild discount');
state = makeMinimalState();
const atreidesCost = shipmentCostPerForce(state, 'atreides', 'oldGap'); // non-stronghold
const guildCost = shipmentCostPerForce(state, 'guild', 'oldGap');
assert(atreidesCost === 2, 'standard non-stronghold shipment costs 2 spice per force');
assert(guildCost === 1, 'guild ships at half price (1 spice per force to non-stronghold)');

console.log('\nTest 5: Fremen free shipment near the Great Flat');
state = makeMinimalState();
const fremenCostAtGreatFlat = shipmentCostPerForce(state, 'fremen', 'theGreatFlat');
assert(fremenCostAtGreatFlat === 0, 'fremen ship free directly onto the Great Flat');

console.log('\nTest 6: full shipment execution moves spice and forces correctly, Guild collects payment');
state = makeMinimalState();
const atreidesSpiceBefore = state.factions.atreides.spice;
const guildSpiceBefore = state.factions.guild.spice;
executeShipment(state, 'atreides', 'oldGap', 3); // non-stronghold, cost 2/force = 6 total
assert(state.factions.atreides.spice === atreidesSpiceBefore - 6, 'atreides paid the correct total shipment cost');
assert(state.factions.atreides.forces.reserve === 7, 'atreides reserve reduced by shipped amount');
assert(state.factions.atreides.forces.onBoard.oldGap === 3, 'shipped forces landed in the destination territory');
assert(state.factions.guild.spice === guildSpiceBefore + 6, 'guild collected the shipment payment, not the bank');

console.log('\nTest 7: one move per turn enforced');
state = makeMinimalState();
executeMove(state, 'atreides', 'arrakeen', 'oldGap', 2);
const secondMove = canMove(state, 'atreides', 'oldGap', 'basin', 1);
assert(secondMove.ok === false, 'a second move in the same turn is correctly rejected');

console.log('\nAll movement engine sanity checks passed.');
