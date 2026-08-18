// battle.sim.js — headless sanity check for battle resolution, including
// starred units (Sardaukar/Fedaykin) and Kwisatz Haderach.
// Run with: node battle.sim.js

const {
  starredUnitValueFor, calculateStrength, resolveBattle,
  kwisatzHaderachBonusFor, recordForceLossForKwisatzHaderach
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
        spice: 20, revivalTanks: 0,
        forces: { onBoard: { arrakeen: 6 }, starredOnBoard: {} },
        leaders: { available: ['thufirHawat'], killed: [] },
        traitorHand: [], treacheryHand: [],
        specialFactionState: { cumulativeForcesLostInBattle: 0, kwisatzHaderachActive: false, kwisatzHaderachUsedInTerritoryThisPhase: null }
      },
      harkonnen: {
        spice: 20, revivalTanks: 0,
        forces: { onBoard: { arrakeen: 4 }, starredOnBoard: {} },
        leaders: { available: ['piterDeVries'], killed: [] },
        traitorHand: [], treacheryHand: []
      },
      emperor: {
        spice: 20, revivalTanks: 0,
        forces: { onBoard: { imperialBasin: 6 }, starredOnBoard: { imperialBasin: 1 } },
        leaders: { available: ['countFenring'], killed: [] },
        traitorHand: [], treacheryHand: []
      },
      fremen: {
        spice: 20, revivalTanks: 0,
        forces: { onBoard: { cielagoNorth: 5 }, starredOnBoard: { cielagoNorth: 2 } },
        leaders: { available: ['stilgar'], killed: [] },
        traitorHand: [], treacheryHand: []
      }
    }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('  ok - ' + message);
}

console.log('Test 1: strength calculation, ordinary forces only (no starred units)');
let strength = calculateStrength({
  forcesCommitted: 4, starredForcesCommitted: 0,
  supportedOrdinaryCount: 4, supportedStarredCount: 0,
  starredUnitValue: 0, leaderFightingValue: 5, leaderWasKilled: false
});
assert(strength === 9, `4 fully-supported ordinary forces (4) + leader 5 = 9, got ${strength}`);

strength = calculateStrength({
  forcesCommitted: 4, starredForcesCommitted: 0,
  supportedOrdinaryCount: 2, supportedStarredCount: 0,
  starredUnitValue: 0, leaderFightingValue: 5, leaderWasKilled: false
});
assert(strength === 8, `2 supported (2) + 2 unsupported (1) + leader 5 = 8, got ${strength}`);

console.log('\nTest 2: starred unit value, Sardaukar worth double except against Fremen');
assert(starredUnitValueFor('emperor', 'harkonnen') === 2, 'sardaukar worth 2 against a non-fremen opponent');
assert(starredUnitValueFor('emperor', 'fremen') === 1, 'sardaukar worth only 1 specifically against fremen');
assert(starredUnitValueFor('fremen', 'emperor') === 2, 'fedaykin worth 2 with no stated exception');
assert(starredUnitValueFor('atreides', 'harkonnen') === 0, 'factions without starred units get value 0');

console.log('\nTest 3: strength calculation with a supported Sardaukar mixed with ordinary forces');
strength = calculateStrength({
  forcesCommitted: 5, starredForcesCommitted: 1,
  supportedStarredCount: 1, supportedOrdinaryCount: 4,
  starredUnitValue: 2, leaderFightingValue: 6, leaderWasKilled: false
});
assert(strength === 12, `1 supported sardaukar (2) + 4 supported ordinary (4) + leader 6 = 12, got ${strength}`);

strength = calculateStrength({
  forcesCommitted: 5, starredForcesCommitted: 1,
  supportedStarredCount: 1, supportedOrdinaryCount: 1,
  starredUnitValue: 2, leaderFightingValue: 6, leaderWasKilled: false
});
assert(strength === 10.5, `supported sardaukar (2) + 1 supported ordinary (1) + 3 unsupported ordinary (1.5) + leader 6 = 10.5, got ${strength}`);

console.log('\nTest 4: Sardaukar vs Fremen specifically drops to half value (1, not 2)');
strength = calculateStrength({
  forcesCommitted: 1, starredForcesCommitted: 1,
  supportedStarredCount: 1, supportedOrdinaryCount: 0,
  starredUnitValue: starredUnitValueFor('emperor', 'fremen'),
  leaderFightingValue: 0, leaderWasKilled: false
});
assert(strength === 1, `a single supported sardaukar fighting fremen contributes only 1, got ${strength}`);

console.log('\nTest 5: Kwisatz Haderach bonus, inactive until 7+ cumulative forces lost');
let state = makeState();
let khBonus = kwisatzHaderachBonusFor(state, 'atreides', 'arrakeen', { useKwisatzHaderach: true });
assert(khBonus === 0, 'no bonus while inactive, regardless of the flag being requested');

recordForceLossForKwisatzHaderach(state, 'atreides', 6);
assert(state.factions.atreides.specialFactionState.kwisatzHaderachActive === false, 'still inactive at 6 losses');
recordForceLossForKwisatzHaderach(state, 'atreides', 1);
assert(state.factions.atreides.specialFactionState.kwisatzHaderachActive === true, 'activates once cumulative losses reach 7');

khBonus = kwisatzHaderachBonusFor(state, 'atreides', 'arrakeen', { useKwisatzHaderach: true });
assert(khBonus === 2, 'now active, requesting it in a battle plan grants +2');

khBonus = kwisatzHaderachBonusFor(state, 'atreides', 'arrakeen', { useKwisatzHaderach: false });
assert(khBonus === 0, 'no bonus if the plan does not actually request it, even while active');

console.log('\nTest 6: Kwisatz Haderach has no effect if the accompanying leader is killed');
strength = calculateStrength({
  forcesCommitted: 2, starredForcesCommitted: 0,
  supportedOrdinaryCount: 2, supportedStarredCount: 0,
  starredUnitValue: 0, leaderFightingValue: 5, leaderWasKilled: true, kwisatzHaderachBonus: 2
});
assert(strength === 2, `leader killed means both leader value AND the KH bonus are voided, only the 2 supported forces count, got ${strength}`);

console.log('\nTest 7: full battle resolution with Sardaukar actually fighting, correct strength split');
state = makeState();
const battleResult = resolveBattle(state, 'imperialBasin', 'emperor', 'harkonnen',
  {
    forcesCommitted: 3, starredForcesCommitted: 1, spiceCommitted: 2,
    supportedStarredCount: 1, supportedOrdinaryCount: 1,
    leaderId: 'countFenring', leaderFightingValue: 6, weaponCardId: null, defenseCardId: null
  },
  {
    forcesCommitted: 3, starredForcesCommitted: 0, spiceCommitted: 3,
    supportedStarredCount: 0, supportedOrdinaryCount: 3,
    leaderId: 'piterDeVries', leaderFightingValue: 3, weaponCardId: null, defenseCardId: null
  },
  cardLookup
);
// Emperor: 1 supported sardaukar (2) + 1 supported ordinary (1) + 1 unsupported ordinary (0.5) + leader 6 = 9.5
// Harkonnen: 3 supported ordinary (3) + leader 3 = 6
assert(battleResult.winnerFactionId === 'emperor', `emperor should win (9.5 vs 6), got winner ${battleResult.winnerFactionId}`);
assert(state.factions.emperor.forces.onBoard.imperialBasin === 3, 'emperor (winner) lost only their 3 dialed forces (6-3=3 remain)');
assert(state.factions.emperor.forces.starredOnBoard.imperialBasin === undefined, 'the single sardaukar committed and lost is correctly removed from starredOnBoard');

console.log('\nAll battle engine sanity checks passed.');
