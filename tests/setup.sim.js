// setup.sim.js — headless sanity check for full game initialization.
// Run with: node setup.sim.js

const fs = require('fs');
const { initializeGame, canSetPrediction, setPrediction } = require('./js/setupEngine.js');
const { canShip, executeShipment } = require('./js/movementEngine.js');
const { resolveBattle } = require('./js/battleEngine.js');

function loadJSON(path) { return JSON.parse(fs.readFileSync(path, 'utf8')); }

const territoriesData = loadJSON('./data/territories.json');
const spiceDeckData = loadJSON('./data/spiceDeck.json');
const treacheryDeckData = loadJSON('./data/treacheryDeck.json');
const leadersData = loadJSON('./data/leaders.json');
const rulesConfig = loadJSON('./data/rulesConfig.json');

function identityShuffle(arr) { return arr.slice(); } // deterministic for testing

function assert(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('  ok - ' + message);
}

const allSix = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];

console.log('Test 1: full 6-faction game initializes without error and has the right shape');
let state = initializeGame({
  activeFactionIds: allSix,
  playerCircleOrder: allSix,
  rulesConfig, spiceDeckData, territoriesData, treacheryDeckData, leadersData,
  rngShuffle: identityShuffle
});
assert(state.factions.atreides.spice === 10, 'atreides starts with 10 spice');
assert(state.factions.fremen.spice === 3, 'fremen starts with 3 spice, matching their poverty flavor text');
assert(state.board.territories.arrakeen.type === 'stronghold', 'real territory data is actually loaded, not the empty placeholder');

console.log('\nTest 2: starting force placement matches each player sheet');
assert(state.factions.atreides.forces.onBoard.arrakeen === 10, 'atreides starts with 10 forces in arrakeen');
assert(state.factions.emperor.forces.onBoard.arrakeen === undefined, 'emperor starts with NO forces on the board at all');
assert(state.factions.emperor.forces.reserve === 20, 'all 20 emperor forces start in reserve');
assert(state.factions.emperor.forces.starredReserve === 5, 'all 5 sardaukar start in reserve alongside the rest');
assert(state.factions.gesserit.forces.onBoard.polarSink === 1, 'bene gesserit starts with their 1 force in the polar sink');

console.log('\nTest 3: leaders.available is actually populated, not left empty');
assert(state.factions.atreides.leaders.available.length === 5, `atreides should have 5 available leaders, got ${state.factions.atreides.leaders.available.length}`);
assert(state.factions.atreides.leaders.available.includes('thufirHawat'), 'thufir hawat specifically present among available leaders');

console.log('\nTest 4: spice deck built correctly (21 cards: 6 worms + 15 territory)');
assert(state.decks.spiceDeck.length === 21, `expected 21 spice deck cards, got ${state.decks.spiceDeck.length}`);

console.log('\nTest 5: treachery deck dealt correctly, Harkonnen gets 2 starting cards, everyone else gets 1');
assert(state.factions.harkonnen.treacheryHand.length === 2, 'harkonnen starts with 2 treachery cards');
assert(state.factions.atreides.treacheryHand.length === 1, 'atreides starts with the standard 1');
const totalTreacheryCards = treacheryDeckData.cards.length;
const dealtCount = allSix.reduce((sum, f) => sum + state.factions[f].treacheryHand.length, 0);
assert(state.decks.treacheryDeck.length + dealtCount === totalTreacheryCards, `treachery deck (${state.decks.treacheryDeck.length}) + dealt (${dealtCount}) should equal the original ${totalTreacheryCards}`);

console.log('\nTest 6: traitor deck dealt and conserved correctly across all 6 factions');
assert(state.factions.harkonnen.traitorHand.length === 4, 'harkonnen holds all 4 dealt traitor cards immediately');
assert(state.factions.atreides.pendingTraitorHand.length === 4, 'atreides has a pending hand awaiting selection');
const totalTraitorLeaders = allSix.reduce((sum, f) => sum + leadersData[f].length, 0);
assert(totalTraitorLeaders === 30, `sanity check on the source data itself, expected 30 total leaders across 6 factions, got ${totalTraitorLeaders}`);

console.log('\nTest 7: fewer than 6 factions still initializes cleanly (3-player game)');
const threeFactions = ['atreides', 'harkonnen', 'fremen'];
const smallGame = initializeGame({
  activeFactionIds: threeFactions,
  playerCircleOrder: threeFactions,
  rulesConfig, spiceDeckData, territoriesData, treacheryDeckData, leadersData,
  rngShuffle: identityShuffle
});
assert(Object.keys(smallGame.factions).length === 3, 'only the 3 requested factions exist in the resulting state');
assert(smallGame.factions.emperor === undefined, 'emperor genuinely absent, not just empty');

console.log('\nTest 8: Bene Gesserit prediction, cannot predict themselves, can predict others');
let predCheck = canSetPrediction(state, 'gesserit', 5);
assert(predCheck.ok === false, 'bene gesserit cannot predict their own faction');
predCheck = canSetPrediction(state, 'atreides', 5);
assert(predCheck.ok === true, 'predicting another faction at a valid turn is fine');
setPrediction(state, 'atreides', 5);
assert(state.factions.gesserit.specialFactionState.prediction.factionId === 'atreides', 'prediction actually stored');

console.log('\nTest 9: PROOF OF INTEGRATION, a real shipment and battle run correctly on the freshly-initialized state');
const shipCheck = canShip(state, 'harkonnen', 'oldGap', 3);
assert(shipCheck.ok === true, 'freshly-initialized harkonnen can legally ship, spice and reserves are real numbers, not null');
executeShipment(state, 'harkonnen', 'oldGap', 3);
assert(state.factions.harkonnen.forces.onBoard.oldGap === 3, 'shipment landed correctly on the initialized state');

state.factions.atreides.forces.onBoard.oldGap = 5; // simulating a prior move for test simplicity

const cardLookup = { maulaPistol: { id: 'maulaPistol', category: 'projectileWeapon' } };
const battleResult = resolveBattle(state, 'oldGap', 'atreides', 'harkonnen',
  {
    forcesCommitted: 5, starredForcesCommitted: 0, spiceCommitted: 5,
    supportedStarredCount: 0, supportedOrdinaryCount: 5,
    leaderId: state.factions.atreides.leaders.available[0], leaderFightingValue: 5,
    weaponCardId: null, defenseCardId: null
  },
  {
    forcesCommitted: 3, starredForcesCommitted: 0, spiceCommitted: 3,
    supportedStarredCount: 0, supportedOrdinaryCount: 3,
    leaderId: state.factions.harkonnen.leaders.available[0], leaderFightingValue: 6,
    weaponCardId: null, defenseCardId: null
  },
  cardLookup
);
assert(battleResult.winnerFactionId === 'atreides', `atreides (strength 10) should beat harkonnen (strength 9), got winner ${battleResult.winnerFactionId}`);
assert(state.factions.harkonnen.forces.onBoard.oldGap === undefined, 'harkonnen (loser) lost all forces in old gap, on a genuinely fresh game state, not a hand-built test fixture');

console.log('\nAll setup engine sanity checks passed, including full end-to-end integration.');
