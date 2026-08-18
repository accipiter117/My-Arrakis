// battle.sim.js — headless sanity check for battle resolution.
// Run with: node battle.sim.js

const {
  calculateStrength, resolveWeaponDefense, resolveBattle
} = require('./js/battleEngine.js');

const cardLookup = {
  maulaPistol: { id: 'maulaPistol', category: 'projectileWeapon' },
  shield1: { id: 'shield1', category: 'projectileDefense' },
  chaumas: { id: 'chaumas', category: 'poisonWeapon' },
  snooper1: { id: 'snooper1', category: 'poisonDefense' },
  lasgun: { id: 'lasgun', category: 'specialWeapon' }
};

function makeState() {
  return {
    board: { spiceBlowMarkers: [] },
    decks: { treacheryDiscard: [] },
    spiceBank: { totalInCirculation: 1000 },
    factions: {
      atreides: {
        spice: 20, forces: { onBoard: { arrakeen: 6 } }, revivalTanks: 0,
        leaders: { available: ['thufirHawat'], killed: [] },
        traitorHand: [], treacheryHand: []
      },
      harkonnen: {
        spice: 20, forces: { onBoard: { arrakeen: 4 } }, revivalTanks: 0,
        leaders: { available: ['piterDeVries'], killed: [] },
        traitorHand: [], treacheryHand: []
      }
    }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('  ok - ' + message);
}

console.log('Test 1: strength calculation with spice support (advanced rule)');
const fullySupported = calculateStrength({ forcesCommitted: 4, spiceCommitted: 4, leaderFightingValue: 5, leaderWasKilled: false });
assert(fullySupported === 9, `4 fully-supported forces + leader 5 = 9, got ${fullySupported}`);
const halfSupported = calculateStrength({ forcesCommitted: 4, spiceCommitted: 2, leaderFightingValue: 5, leaderWasKilled: false });
assert(halfSupported === 8, `2 supported (2) + 2 unsupported (1) + leader 5 = 8, got ${halfSupported}`);
const noSpice = calculateStrength({ forcesCommitted: 4, spiceCommitted: 0, leaderFightingValue: 5, leaderWasKilled: false });
assert(noSpice === 7, `all 4 unsupported (2) + leader 5 = 7, got ${noSpice}`);

console.log('\nTest 2: weapon kills leader unless matching defense played');
let wd = resolveWeaponDefense(
  { weaponCardId: 'maulaPistol', defenseCardId: null },
  { weaponCardId: null, defenseCardId: null },
  cardLookup
);
assert(wd.defenderLeaderKilled === true, 'projectile weapon with no defense kills the defender leader');
assert(wd.aggressorLeaderKilled === false, 'aggressor unaffected, they played the weapon');

wd = resolveWeaponDefense(
  { weaponCardId: 'chaumas', defenseCardId: null },
  { weaponCardId: null, defenseCardId: 'snooper1' },
  cardLookup
);
assert(wd.defenderLeaderKilled === false, 'matching poison defense cancels the poison weapon kill');

wd = resolveWeaponDefense(
  { weaponCardId: 'chaumas', defenseCardId: null },
  { weaponCardId: null, defenseCardId: 'shield1' }, // wrong defense type for a poison weapon
  cardLookup
);
assert(wd.defenderLeaderKilled === true, 'a mismatched defense type does NOT stop the kill (shield does not stop poison)');

console.log('\nTest 3: lasgun + shield anywhere in the battle triggers an explosion');
wd = resolveWeaponDefense(
  { weaponCardId: 'lasgun', defenseCardId: null },
  { weaponCardId: null, defenseCardId: 'shield1' },
  cardLookup
);
assert(wd.explosion === true, 'lasgun from one side + shield from the other triggers explosion');

console.log('\nTest 4: tie goes to the aggressor');
let state = makeState();
const aggressorPlan = { forcesCommitted: 3, spiceCommitted: 3, leaderId: 'thufirHawat', leaderFightingValue: 5 };
const defenderPlan = { forcesCommitted: 3, spiceCommitted: 3, leaderId: 'piterDeVries', leaderFightingValue: 5 };
// Both sides identical strength (3 + 5 = 8 each) -> should be a tie -> aggressor wins.
const result = resolveBattle(state, 'arrakeen', 'atreides', 'harkonnen',
  { ...aggressorPlan, weaponCardId: null, defenseCardId: null },
  { ...defenderPlan, weaponCardId: null, defenseCardId: null },
  cardLookup
);
assert(result.winnerFactionId === 'atreides', 'exact tie in strength resolves to the aggressor per the rulebook');

console.log('\nTest 5: winner loses only dialed forces, loser loses ALL forces in the territory');
state = makeState(); // atreides has 6 in arrakeen, harkonnen has 4
resolveBattle(state, 'arrakeen', 'atreides', 'harkonnen',
  { forcesCommitted: 2, spiceCommitted: 2, leaderId: 'thufirHawat', leaderFightingValue: 5, weaponCardId: null, defenseCardId: null },
  { forcesCommitted: 1, spiceCommitted: 1, leaderId: 'piterDeVries', leaderFightingValue: 3, weaponCardId: null, defenseCardId: null },
  cardLookup
);
assert(state.factions.atreides.forces.onBoard.arrakeen === 4, 'winner (atreides) only lost the 2 forces they dialed, 6-2=4 remain');
assert(state.factions.harkonnen.forces.onBoard.arrakeen === undefined, 'loser (harkonnen) lost ALL forces in the territory, not just the 1 dialed');
assert(state.factions.harkonnen.revivalTanks === 4, 'all 4 harkonnen forces went to the tanks, confirming the full-loss rule');

console.log('\nTest 6: traitor reveal wins regardless of numbers, revealer loses nothing');
state = makeState();
state.factions.harkonnen.traitorHand = ['thufirHawat']; // harkonnen holds atreides' leader as a traitor
const traitorResult = resolveBattle(state, 'arrakeen', 'atreides', 'harkonnen',
  { forcesCommitted: 6, spiceCommitted: 6, leaderId: 'thufirHawat', leaderFightingValue: 5, weaponCardId: 'lasgun', defenseCardId: null },
  { forcesCommitted: 0, spiceCommitted: 0, leaderId: 'piterDeVries', leaderFightingValue: 3, weaponCardId: null, defenseCardId: 'shield1' },
  cardLookup
);
assert(traitorResult.winnerFactionId === 'harkonnen', 'harkonnen wins via traitor reveal despite atreides dialing everything plus a lasgun');
assert(state.factions.harkonnen.forces.onBoard.arrakeen === 4, 'revealer (harkonnen) loses nothing, even their forces remain untouched');
assert(state.factions.atreides.forces.onBoard.arrakeen === undefined, 'revealed faction (atreides) loses all forces in the territory');

console.log('\nAll battle engine sanity checks passed.');
