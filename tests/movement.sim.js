// movement.sim.js — headless sanity check against real territory data.
// Run with: node movement.sim.js

import fs from 'fs';
import {
  hasOrnithopterAccess, moveRangeFor, reachableTerritories,
  shipmentCostPerForce, canShip, executeShipment, canMove, executeMove
} from '../js/movementEngine.js';

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

console.log('\nTest 8: cannot move into a territory where an ally already has forces');
state = makeMinimalState();
state.alliances = [{ factions: ['atreides', 'fremen'], formedTurn: 1 }];
state.factions.fremen.forces.onBoard.oldGap = 2;
const allyBlockCheck = canMove(state, 'atreides', 'arrakeen', 'oldGap', 2);
assert(allyBlockCheck.ok === false, 'cannot move into a territory already occupied by an ally');

console.log('\nTest 9: Polar Sink is exempt, allies can share it freely');
state = makeMinimalState();
state.alliances = [{ factions: ['atreides', 'fremen'], formedTurn: 1 }];
state.factions.fremen.forces.onBoard.polarSink = 2;
state.factions.atreides.forces.onBoard.windPass = 2;
const polarSinkCheck = canMove(state, 'atreides', 'windPass', 'polarSink', 2);
assert(polarSinkCheck.ok === true, 'moving into the polar sink alongside an ally is always fine');

console.log('\nTest 10: Guild half-price shipping rounds the total up, spice stays whole');
state = makeMinimalState();
const guildShip = canShip(state, 'guild', 'arrakeen', 3); // stronghold rate 1, half = 0.5 x 3 = 1.5
assert(guildShip.ok && guildShip.totalCost === 2, `3 forces to a stronghold should cost the Guild 2 (1.5 rounded up), got ${guildShip.totalCost}`);

console.log('\nAll movement engine sanity checks passed.');

// No Hidden Mobile Stronghold without the Ixians: worms cannot carry the Fremen there, and it never counts.
{
  const { canRideWorm } = await import('../js/movementEngine.js');
  const { resolveMentatPause } = await import('../js/victoryEngine.js');
  const fs2 = (await import('fs')).default;
  const L2 = p => JSON.parse(fs2.readFileSync('./data/' + p, 'utf8'));
  const { initializeGame: init2 } = await import('../js/setupEngine.js');
  const ids = ['atreides', 'harkonnen', 'fremen'];
  const s = init2({ activeFactionIds: ids, playerCircleOrder: ids, rulesConfig: L2('rulesConfig.json'), seed: 3, spiceDeckData: L2('spiceDeck.json'),
    territoriesData: L2('territories.json'), treacheryDeckData: L2('treacheryDeck.json'), leadersData: L2('leaders.json') });
  s.factions.fremen.forces.onBoard.theGreatFlat = 3;
  if (canRideWorm(s, 'theGreatFlat', 'hms').ok) throw new Error('FAILED: rode a worm into an HMS that is not in the game');
  s.factions.fremen.forces.onBoard = { hms: 2, sietchTabr: 5, tueksSietch: 3 };
  for (const f of ['atreides', 'harkonnen']) s.factions[f].forces.onBoard = {};
  s.meta.turn = 3;
  const r = resolveMentatPause(s, L2('territories.json'));
  if (r.gameOver && r.winners?.includes('fremen') && r.method !== 'fremen-special') throw new Error('FAILED: an unplaced HMS counted as a stronghold');
  console.log('  ok - no HMS without the Ixians: no worm ride there, and it never counts toward victory');
}

// The storm blocks shipping and movement into, out of and through its sector.
{
  const { canShip, canMove, reachableTerritories, canRideWorm } = await import('../js/movementEngine.js');
  const fs3 = (await import('fs')).default;
  const L3 = p => JSON.parse(fs3.readFileSync('./data/' + p, 'utf8'));
  const { initializeGame: init3 } = await import('../js/setupEngine.js');
  const ids = ['atreides', 'harkonnen', 'fremen'];
  const s = init3({ activeFactionIds: ids, playerCircleOrder: ids, rulesConfig: L3('rulesConfig.json'), seed: 4, spiceDeckData: L3('spiceDeck.json'),
    territoriesData: L3('territories.json'), treacheryDeckData: L3('treacheryDeck.json'), leadersData: L3('leaders.json') });
  const sectorOf = t => s.board.territories[t].stormSector;
  s.board.stormPosition = sectorOf('theGreatFlat'); s.factions.harkonnen.spice = 20;
  if (canShip(s, 'harkonnen', 'theGreatFlat', 2).ok) throw new Error('FAILED: shipped into the storm');
  s.factions.harkonnen.forces.onBoard.theGreatFlat = 3;
  if (canMove(s, 'harkonnen', 'theGreatFlat', 'funeralPlain', 1).ok) throw new Error('FAILED: moved out of the storm');
  s.factions.harkonnen.forces.onBoard.funeralPlain = 3;
  if (reachableTerritories(s, 'harkonnen', 'funeralPlain', 3).includes('theGreatFlat')) throw new Error('FAILED: moved into or through the storm');
  s.factions.fremen.forces.onBoard.funeralPlain = 3;
  if (canRideWorm(s, 'funeralPlain', 'theGreatFlat').ok) throw new Error('FAILED: rode a worm into the storm');
  s.board.stormPosition = (sectorOf('theGreatFlat') + 9) % 18;
  if (!canShip(s, 'harkonnen', 'theGreatFlat', 2).ok) throw new Error('FAILED: storm gone but still blocked');
  console.log('  ok - the storm blocks shipping, moving and worm rides into, out of and through its sector (the Polar Sink excepted)');
}
