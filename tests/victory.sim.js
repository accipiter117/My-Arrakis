// victory.sim.js — headless sanity check against real territory data.
// Run with: node victory.sim.js

const fs = require('fs');
const { resolveMentatPause, checkFremenSpecialVictory } = require('./js/victoryEngine.js');

const territoriesData = JSON.parse(fs.readFileSync('./data/territories.json', 'utf8'));
const rulesConfig = JSON.parse(fs.readFileSync('./data/rulesConfig.json', 'utf8'));

function makeState(turn = 3) {
  return {
    meta: { turn },
    rulesConfig,
    alliances: [],
    factions: {
      atreides: { forces: { onBoard: {} } },
      harkonnen: { forces: { onBoard: {} } },
      fremen: { forces: { onBoard: {} } },
      guild: { forces: { onBoard: {} } }
    }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('  ok - ' + message);
}

console.log('Test 1: solo victory at 3 strongholds');
let state = makeState();
state.factions.atreides.forces.onBoard = { arrakeen: 5, carthag: 3, tueksSietch: 2 };
let result = resolveMentatPause(state, territoriesData);
assert(result.gameOver === true, 'game correctly ends when a faction holds 3 strongholds');
assert(result.winners.includes('atreides'), 'atreides correctly identified as the winner');
assert(result.method === 'stronghold-solo', 'method correctly tagged as solo stronghold victory');

console.log('\nTest 2: no victory below the threshold');
state = makeState();
state.factions.atreides.forces.onBoard = { arrakeen: 5, carthag: 3 }; // only 2
result = resolveMentatPause(state, territoriesData);
assert(result.gameOver === false, 'holding only 2 of 3 required strongholds does not end the game');

console.log('\nTest 3: alliance victory combines separately-held strongholds');
state = makeState();
state.alliances = [{ factions: ['atreides', 'fremen'], formedTurn: 2 }];
state.factions.atreides.forces.onBoard = { arrakeen: 5, carthag: 3 };
state.factions.fremen.forces.onBoard = { sietchTabr: 4, tueksSietch: 2 };
result = resolveMentatPause(state, territoriesData);
assert(result.gameOver === true, 'alliance holding 4 combined strongholds wins');
assert(result.method === 'stronghold-alliance', 'method correctly tagged as alliance victory');
assert(result.winners.includes('atreides') && result.winners.includes('fremen'), 'both allied factions listed as winners');

console.log('\nTest 4: solo threshold does NOT apply to allied factions individually');
state = makeState();
state.alliances = [{ factions: ['atreides', 'fremen'], formedTurn: 2 }];
state.factions.atreides.forces.onBoard = { arrakeen: 5, carthag: 3, tueksSietch: 2 }; // 3 on its own
result = resolveMentatPause(state, territoriesData);
// Atreides holds 3 strongholds alone but is allied, so needs the alliance
// threshold (4 combined) rather than winning solo at 3.
assert(result.gameOver === false, 'allied faction holding 3 strongholds alone does not trigger a solo win');

console.log('\nTest 5: Fremen special victory condition');
state = makeState(10); // final turn
state.factions.fremen.forces.onBoard = { sietchTabr: 3, habbanyaSietch: 2 };
// Tuek's Sietch held by Guild, not one of the three blocking factions.
state.factions.guild.forces.onBoard = { tueksSietch: 2 };
const fremenCheck = checkFremenSpecialVictory(state);
assert(fremenCheck !== null && fremenCheck.includes('fremen'), 'fremen special victory triggers when conditions are met on the final turn');

console.log('\nTest 6: Fremen special victory blocked by Harkonnen holding Tuek\'s Sietch');
state = makeState(10);
state.factions.fremen.forces.onBoard = { sietchTabr: 3, habbanyaSietch: 2 };
state.factions.harkonnen.forces.onBoard = { tueksSietch: 2 };
const blockedCheck = checkFremenSpecialVictory(state);
assert(blockedCheck === null, 'fremen special victory correctly blocked when harkonnen holds tuek\'s sietch');

console.log('\nTest 7: special victories only checked on the final turn, not every turn');
state = makeState(5); // not the final turn
state.factions.fremen.forces.onBoard = { sietchTabr: 3, habbanyaSietch: 2 };
result = resolveMentatPause(state, territoriesData);
assert(result.gameOver === false, 'fremen special victory conditions being met on turn 5 does not end the game early');

console.log('\nTest 8: Guild automatic win as fallback on the final turn');
state = makeState(10);
// Someone non-Fremen holding Sietch Tabr blocks the Fremen condition
// outright (fremen special victory needs Fremen-or-no-one there).
state.factions.harkonnen.forces.onBoard = { sietchTabr: 2 };
state.factions.fremen.forces.onBoard = { arrakeen: 1 };
result = resolveMentatPause(state, territoriesData);
assert(result.gameOver === true, 'final turn with no other winner triggers a fallback victory');
assert(result.method === 'guild-special', 'guild wins automatically as the fallback when fremen conditions are not met and guild is present');

console.log('\nAll victory engine sanity checks passed.');
