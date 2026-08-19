// turnEngine.sim.js — integration test: runs actual turns end to end.
// Run with: node turnEngine.sim.js

const fs = require('fs');
const { initializeGame } = require('./js/setupEngine.js');
const turnEngine = require('./js/turnEngine.js');
const phaseEngine = require('./js/phaseEngine.js');

function loadJSON(path) { return JSON.parse(fs.readFileSync(path, 'utf8')); }

const territoriesData = loadJSON('./data/territories.json');
const spiceDeckData = loadJSON('./data/spiceDeck.json');
const treacheryDeckData = loadJSON('./data/treacheryDeck.json');
const leadersData = loadJSON('./data/leaders.json');
const rulesConfig = loadJSON('./data/rulesConfig.json');

function identityShuffle(arr) { return arr.slice(); }

function assert(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('  ok - ' + message);
}

const allSix = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];

function freshGame() {
  return initializeGame({
    activeFactionIds: allSix,
    playerCircleOrder: allSix,
    rulesConfig, spiceDeckData, territoriesData, treacheryDeckData, leadersData,
    rngShuffle: identityShuffle
  });
}

console.log('Test 1: a single full turn runs end to end with no throw, using the passive provider');
let state = freshGame();
assert(phaseEngine.currentPhase(state) === 'setup', 'starts in the setup phase');
phaseEngine.nextPhase(state); // move off 'setup' into 'storm', mirroring what a real setup flow would do once
assert(phaseEngine.currentPhase(state) === 'storm', 'now sitting in storm, ready for the first real turn');

const log1 = turnEngine.runFullTurn(state, turnEngine.passiveDecisionProvider, territoriesData, {});
assert(state.meta.turn === 2, `turn counter should advance to 2 after one full turn, got ${state.meta.turn}`);
assert(phaseEngine.currentPhase(state) === 'storm', 'lands back on storm, ready for the next turn');
assert(log1.some(entry => entry.phase === 'charity'), 'charity phase actually ran and was logged');
assert(log1.some(entry => entry.phase === 'bidding'), 'bidding phase actually ran and was logged');

console.log('\nTest 2: CHOAM Charity correctly pays only Bene Gesserit on turn 1 (everyone else starts well-funded)');
const charityEntry = log1.find(entry => entry.phase === 'charity');
const gesseritPaid = charityEntry.result.find(r => r.factionId === 'gesserit');
assert(gesseritPaid && gesseritPaid.amountReceived === 2, 'bene gesserit (always eligible) received their flat 2 charity on turn 1');
assert(charityEntry.result.every(r => r.factionId === 'gesserit' || r.factionId === undefined), 'no other faction claimed charity, they all started with more than 1 spice');

console.log('\nTest 3: Bidding phase with a fully passive provider ends immediately, cards return to the deck');
const deckSizeBeforeBidding = 26; // from setup.sim.js: 33 total - 7 dealt at start
assert(state.decks.treacheryDeck.length === deckSizeBeforeBidding, `no cards were actually won, deck should be back to ${deckSizeBeforeBidding}, got ${state.decks.treacheryDeck.length}`);

console.log('\nTest 4: Storm position stays put on turn 1 (passive dial is 0-0 for the first storm, which is legal)');
assert(state.board.stormPosition === 0, `storm should not have moved on turn 1 with passive 0-0 dials, got position ${state.board.stormPosition}`);

console.log('\nTest 5: a second full turn advances the storm using the subsequent-turn dial range (1-3)');
const log2 = turnEngine.runFullTurn(state, turnEngine.passiveDecisionProvider, territoriesData, {});
assert(state.meta.turn === 3, `turn counter should now be 3, got ${state.meta.turn}`);
assert(state.board.stormPosition === 2, `passive dials of 1+1=2 sectors should move the storm from 0 to 2, got ${state.board.stormPosition}`);

console.log('\nTest 6: five full turns run with no throw and no spice bank corruption (basic stability check)');
state = freshGame();
phaseEngine.nextPhase(state);
for (let i = 0; i < 5; i++) {
  turnEngine.runFullTurn(state, turnEngine.passiveDecisionProvider, territoriesData, {});
}
assert(state.meta.turn === 6, `expected turn 6 after 5 full turns, got ${state.meta.turn}`);
assert(Number.isFinite(state.spiceBank.totalInCirculation), 'spice bank total is still a real finite number, not NaN or undefined, after 5 turns');
assert(!state.victory.achieved, 'no faction has legitimately won yet with everyone playing passively (no one is taking strongholds)');

console.log('\nTest 7: PROOF the battle-phase wiring actually works, not just battleEngine directly');
state = freshGame();
// Force a real conflict: put harkonnen forces in atreides' own starting
// stronghold before running the battle phase, exactly the kind of setup
// findBattleTerritories() needs to detect on its own.
state.factions.harkonnen.forces.onBoard.arrakeen = 4;
const battleLog = turnEngine.runBattlePhase(state, turnEngine.passiveDecisionProvider, {});
assert(battleLog.length === 1, 'exactly one battle was detected and resolved at arrakeen');
assert(battleLog[0].territoryId === 'arrakeen', 'the detected battle site is correct');
// Atreides has more forces (10 vs 4) and a leader with fighting value 0
// in the passive plan (leaderFightingValue defaults to 0 in the stub),
// so this comes down to raw dialed forces, both dial 0, a real tie ->
// aggressor wins per the rulebook. Whichever faction findBattleTerritories
// lists first becomes the aggressor here.
assert(battleLog[0].winnerFactionId === 'atreides' || battleLog[0].winnerFactionId === 'harkonnen', 'a real winner was determined, not stuck or thrown');
assert(state.meta.lastBattleParticipants.includes('atreides') && state.meta.lastBattleParticipants.includes('harkonnen'), 'battle participants correctly tracked for next turn\'s storm dialer selection');

console.log('\nAll turn engine integration checks passed.');
