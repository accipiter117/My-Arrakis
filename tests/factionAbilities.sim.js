// factionAbilities.sim.js — Voice, captured leaders, worm riding, worthless
// bluffs, leaders fighting once per turn, and plans checked against hands.
// Run with: node tests/factionAbilities.sim.js

import fs from 'fs';
import * as battle from '../js/battleEngine.js';
import { canRideWorm, rideWorm } from '../js/movementEngine.js';

const territoriesData = JSON.parse(fs.readFileSync('./data/territories.json', 'utf8'));
const deck = JSON.parse(fs.readFileSync('./data/treacheryDeck.json', 'utf8'));
const cards = Object.fromEntries(deck.cards.map(c => [c.id, c]));

function assert(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('  ok - ' + message);
}

function makeState() {
  const faction = (leaders, onBoard, hand = []) => ({
    spice: 20, revivalTanks: 0, starredRevivalTanks: 0, treacheryHand: hand, traitorHand: [],
    forces: { reserve: 5, starredReserve: 0, onBoard, starredOnBoard: {} },
    leaders: { available: leaders, killed: [] }, specialFactionState: {}
  });
  return {
    board: { territories: territoriesData.territories, spiceBlowMarkers: [] },
    decks: { treacheryDiscard: [] }, spiceBank: { totalInCirculation: 500 }, alliances: [],
    factions: {
      harkonnen: faction(['feydRautha', 'beastRabban'], { carthag: 6 }, ['chaumas', 'shield1']),
      atreides: faction(['thufirHawat', 'duncanIdaho'], { arrakeen: 6 }, ['snooper1', 'baliset']),
      fremen: faction(['stilgar'], { theGreatFlat: 5 })
    }
  };
}
const plan = extra => ({ forcesCommitted: 2, starredForcesCommitted: 0, spiceCommitted: 0,
  supportedStarredCount: 0, supportedOrdinaryCount: 0, leaderFightingValue: 0,
  weaponCardId: null, defenseCardId: null, cheapHeroCardId: null, ...extra });

console.log('Test 1: a worthless card in the weapon slot kills nobody');
const wd = battle.resolveWeaponDefense({ weaponCardId: 'baliset' }, { weaponCardId: null }, cards);
assert(wd.defenderLeaderKilled === false, 'Baliset played as a weapon is only a bluff');

console.log('\nTest 2: plans must use cards actually held, in legal slots');
let s = makeState();
assert(!battle.canDeclareBattlePlan(s, 'arrakeen', 'atreides', plan({ leaderId: 'thufirHawat', weaponCardId: 'lasgun' }), cards).ok, 'a card not in hand is refused');
assert(!battle.canDeclareBattlePlan(s, 'arrakeen', 'atreides', plan({ leaderId: 'thufirHawat', weaponCardId: 'snooper1' }), cards).ok, 'a defence card in the weapon slot is refused');
assert(battle.canDeclareBattlePlan(s, 'arrakeen', 'atreides', plan({ leaderId: 'thufirHawat', weaponCardId: 'baliset', defenseCardId: 'snooper1' }), cards).ok, 'a worthless bluff plus a real defence is fine');

console.log('\nTest 3: a leader fights in only one territory per Battle phase');
s = makeState();
s.battle = { leaderTerritory: { thufirHawat: 'carthag' } };
s.factions.atreides.forces.onBoard.carthag = 3; // Atreides troops really are in Carthag
assert(!battle.canDeclareBattlePlan(s, 'arrakeen', 'atreides', plan({ leaderId: 'thufirHawat' }), cards).ok, 'refused in a second territory');
assert(battle.canDeclareBattlePlan(s, 'carthag', 'atreides', plan({ leaderId: 'thufirHawat' }), cards).ok, 'allowed again in the same territory');

console.log('\nTest 4: the Voice');
s = makeState();
let p = battle.enforceVoice(s, 'harkonnen', plan({ leaderId: 'feydRautha', weaponCardId: 'chaumas' }), { command: 'notPlay', category: 'poisonWeapon' }, cards);
assert(p.weaponCardId === null, '"must not play a poison weapon" removes Chaumas');
p = battle.enforceVoice(s, 'harkonnen', plan({ leaderId: 'feydRautha' }), { command: 'play', category: 'projectileDefense' }, cards);
assert(p.defenseCardId === 'shield1', '"must play a projectile defence" adds the Shield');
p = battle.enforceVoice(s, 'harkonnen', plan({ leaderId: 'feydRautha' }), { command: 'play', category: 'specialWeapon' }, cards);
assert(p.weaponCardId === null, 'cannot comply (no Lasgun), so the plan is unchanged');

console.log('\nTest 5: Harkonnen captures a leader and kills it for 2 spice');
s = makeState();
battle.applyCapture(s, 'atreides', 'duncanIdaho', 'kill');
assert(s.factions.atreides.leaders.killed.includes('duncanIdaho'), 'Duncan goes to the Atreides tanks');
assert(s.factions.harkonnen.spice === 22, 'Harkonnen gains 2 spice');

console.log('\nTest 6: a kept captured leader fights for Harkonnen but stays loyal to its owner');
s = makeState();
battle.applyCapture(s, 'atreides', 'duncanIdaho', 'keep');
assert(s.factions.harkonnen.leaders.available.includes('duncanIdaho'), 'Duncan joins the Harkonnen leaders');
assert(battle.isTraitorAgainst(s, 'atreides', 'duncanIdaho'), 'Atreides can reveal Duncan as a traitor against Harkonnen');
assert(!battle.isTraitorAgainst(s, 'fremen', 'duncanIdaho'), 'but nobody else can');
battle.returnCapturedLeader(s, 'duncanIdaho');
assert(s.factions.atreides.leaders.available.includes('duncanIdaho') && !s.factions.harkonnen.leaders.available.includes('duncanIdaho'), 'after one battle Duncan goes home');

console.log('\nTest 7: a captured leader killed in battle goes to its original owner\'s tanks');
s = makeState();
battle.applyCapture(s, 'atreides', 'duncanIdaho', 'keep');
s.factions.atreides.forces.onBoard.carthag = 3;
battle.resolveBattle(s, 'carthag', 'atreides', 'harkonnen',
  plan({ leaderId: 'thufirHawat', leaderFightingValue: 5, weaponCardId: 'baliset' }),
  plan({ leaderId: 'duncanIdaho', leaderFightingValue: 2 }), cards);
assert(s.factions.atreides.leaders.killed.includes('duncanIdaho') || s.factions.atreides.leaders.available.includes('duncanIdaho'),
  'Duncan ends up back with Atreides (as a revealed traitor, dead or alive), never lost');
assert(!s.factions.harkonnen.leaders.killed.includes('duncanIdaho'), 'never in the Harkonnen tanks');

console.log('\nTest 8: when all their own leaders are dead, Harkonnen return captured leaders');
s = makeState();
battle.applyCapture(s, 'atreides', 'duncanIdaho', 'keep');
s.factions.harkonnen.leaders.available = ['duncanIdaho'];
s.factions.harkonnen.leaders.killed = ['feydRautha', 'beastRabban'];
battle.returnAllCapturedIfNeeded(s);
assert(s.factions.atreides.leaders.available.includes('duncanIdaho'), 'Duncan returned');

console.log('\nTest 9: Fremen ride a worm, starred forces included, never into a full stronghold');
s = makeState();
s.factions.fremen.forces.starredOnBoard.theGreatFlat = 2;
assert(canRideWorm(s, 'theGreatFlat', 'habbanyaErg').ok, 'can ride to any other territory');
rideWorm(s, 'theGreatFlat', 'habbanyaErg');
assert(s.factions.fremen.forces.onBoard.habbanyaErg === 5 && !s.factions.fremen.forces.onBoard.theGreatFlat, 'all 5 forces moved');
assert(s.factions.fremen.forces.starredOnBoard.habbanyaErg === 2, 'the 2 Fedaykin moved with them');
s.factions.harkonnen.forces.onBoard.arrakeen = 2;
assert(!canRideWorm(s, 'habbanyaErg', 'arrakeen').ok, 'Arrakeen, held by Atreides and Harkonnen, is closed to riders');

console.log('\nAll faction ability checks passed.');
