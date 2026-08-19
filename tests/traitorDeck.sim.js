// traitorDeck.sim.js — headless sanity check against real leader data.
// Run with: node traitorDeck.sim.js

const fs = require('fs');
const {
  buildTraitorDeck, shuffle, dealTraitorHands, canSelectTraitor, selectTraitor
} = require('./js/traitorDeckEngine.js');

const leadersData = JSON.parse(fs.readFileSync('./data/leaders.json', 'utf8'));

function makeState(factionIds) {
  const factions = {};
  for (const id of factionIds) factions[id] = { traitorHand: [] };
  return { factions };
}

function assert(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('  ok - ' + message);
}

console.log('Test 1: full 6-faction deck matches the rulebook\'s stated 30-card Traitor Deck');
const allFactions = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];
let deck = buildTraitorDeck(leadersData, allFactions);
assert(deck.length === 30, `expected 30 cards (6 factions x 5 leaders), got ${deck.length}`);

console.log('\nTest 2: deck shrinks correctly when factions are removed for a smaller game');
const threeFactionDeck = buildTraitorDeck(leadersData, ['atreides', 'harkonnen', 'fremen']);
assert(threeFactionDeck.length === 15, `3 factions x 5 leaders = 15, got ${threeFactionDeck.length}`);
assert(!threeFactionDeck.some(c => c.factionId === 'emperor'), 'no emperor cards present when emperor is not in the game');

console.log('\nTest 3: Harkonnen keeps all 4 dealt cards automatically, no selection');
let state = makeState(allFactions);
let remaining = dealTraitorHands(state, deck, ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit']);
assert(state.factions.harkonnen.traitorHand.length === 4, 'harkonnen has all 4 cards immediately, no pending selection');
assert(state.factions.harkonnen.pendingTraitorHand === undefined, 'harkonnen never gets a pendingTraitorHand at all');

console.log('\nTest 4: every other faction gets a pending hand of exactly 4 awaiting selection');
assert(state.factions.atreides.pendingTraitorHand.length === 4, 'atreides has 4 pending options');
assert(state.factions.atreides.traitorHand.length === 0, 'atreides has not yet finalized a selection');

console.log('\nTest 5: deck conservation, dealt (24) + remaining after deal (6) = original 30');
assert(remaining.length === 30 - (4 * 6), `expected 6 cards left after dealing to 6 factions, got ${remaining.length}`);

console.log('\nTest 6: selecting a traitor moves exactly 1 to traitorHand and returns the other 3');
const chosenCard = state.factions.atreides.pendingTraitorHand[0];
const selectResult = selectTraitor(state, 'atreides', chosenCard.leaderId);
assert(state.factions.atreides.traitorHand.length === 1 && state.factions.atreides.traitorHand[0] === chosenCard.leaderId, 'exactly the chosen leader ends up in traitorHand');
assert(selectResult.returnedToDeck.length === 3, 'exactly 3 unselected cards are returned for the caller to put back in the deck');
assert(state.factions.atreides.pendingTraitorHand === undefined, 'pending hand cleared after selection');

console.log('\nTest 7: cannot select a card that was not actually dealt to that faction');
let badSelectResult;
try {
  selectTraitor(state, 'emperor', 'someLeaderNeverDealtToEmperor');
  badSelectResult = 'allowed';
} catch (e) { badSelectResult = 'blocked'; }
assert(badSelectResult === 'blocked', 'cannot select a leader that was not among the 4 actually dealt');

console.log('\nTest 8: full deck conservation across the whole setup flow (nothing lost, nothing duplicated)');
state = makeState(allFactions);
deck = buildTraitorDeck(leadersData, allFactions);
remaining = dealTraitorHands(state, deck, allFactions);
let allReturned = [];
for (const factionId of allFactions) {
  if (factionId === 'harkonnen') continue;
  const hand = state.factions[factionId].pendingTraitorHand;
  const keep = hand[0].leaderId;
  const result = selectTraitor(state, factionId, keep);
  allReturned = allReturned.concat(result.returnedToDeck);
}
const finalDeckSize = remaining.length + allReturned.length;
const totalHeld = allFactions.reduce((sum, f) => sum + state.factions[f].traitorHand.length, 0);
assert(finalDeckSize + totalHeld === 30, `deck (${finalDeckSize}) + held cards (${totalHeld}) should equal the original 30, got ${finalDeckSize + totalHeld}`);
assert(totalHeld === 4 + 5, `harkonnen holds 4, the other 5 factions hold 1 each = 9 total, got ${totalHeld}`);

console.log('\nAll traitor deck sanity checks passed.');
