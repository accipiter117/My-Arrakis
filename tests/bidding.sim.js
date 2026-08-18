// bidding.sim.js — headless sanity check, not a full test suite yet.
// Run with: node bidding.sim.js

const {
  startBiddingPhase, determineOpeningBidder, canBid, placeBid,
  passBid, isAuctionResolved, resolveCurrentCard, isAtHandLimit
} = require('./js/biddingEngine.js');

function makeMinimalState() {
  return {
    meta: { firstPlayer: 'atreides', turnOrder: ['atreides', 'harkonnen', 'emperor'] },
    decks: {
      treacheryDeck: ['lasgun', 'shield1', 'karama1', 'baliset', 'crysknife'],
      treacheryDiscard: []
    },
    spiceBank: { totalInCirculation: 1000 },
    factions: {
      atreides: { spice: 10, treacheryHand: [] },
      harkonnen: { spice: 10, treacheryHand: [] },
      emperor: { spice: 10, treacheryHand: [] }
    }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('  ok - ' + message);
}

// Test 1: basic auction, Harkonnen wins, gets bonus card, Emperor collects payment
console.log('Test 1: Harkonnen wins an auction, Emperor collects payment');
let state = makeMinimalState();
startBiddingPhase(state);
assert(state.bidding.active, 'bidding phase is active after start');
assert(state.bidding.cardsUpForBid.length === 3, 'one card dealt per eligible faction (3 factions)');

let opener = determineOpeningBidder(state);
assert(opener === 'atreides', 'atreides (first player) opens bidding');

placeBid(state, 'atreides', 2);
placeBid(state, 'harkonnen', 3);
passBid(state, 'atreides');
placeBid(state, 'emperor', 4);
passBid(state, 'harkonnen');
// Wait: harkonnen passed after bidding 3, but then emperor outbid, harkonnen should be able to re-bid.
// Correcting the scenario to be realistic:
state = makeMinimalState();
startBiddingPhase(state);
placeBid(state, 'atreides', 2);
placeBid(state, 'harkonnen', 3);
passBid(state, 'emperor');
passBid(state, 'atreides');
assert(isAuctionResolved(state), 'auction resolves once only the high bidder remains');

const harkonnenHandBefore = state.factions.harkonnen.treacheryHand.length;
const emperorSpiceBefore = state.factions.emperor.spice;
const harkonnenSpiceBefore = state.factions.harkonnen.spice;
const deckSizeBefore = state.decks.treacheryDeck.length;

resolveCurrentCard(state);

assert(state.factions.harkonnen.spice === harkonnenSpiceBefore - 3, 'harkonnen paid 3 spice');
assert(state.factions.emperor.spice === emperorSpiceBefore + 3, 'emperor (not harkonnen) received the payment');
assert(state.factions.harkonnen.treacheryHand.length === harkonnenHandBefore + 2, 'harkonnen got the won card PLUS a free bonus card');
assert(state.decks.treacheryDeck.length === deckSizeBefore - 1, 'exactly one card drawn from the deck for the bonus');

// Test 2: hand limit enforcement
console.log('Test 2: hand limit blocks further bidding');
state = makeMinimalState();
state.factions.atreides.treacheryHand = ['a', 'b', 'c', 'd']; // at default limit of 4
startBiddingPhase(state);
assert(isAtHandLimit(state, 'atreides'), 'atreides correctly flagged at hand limit');
assert(state.bidding.cardsUpForBid.length === 2, 'only 2 cards dealt, atreides excluded from the count');
const bidCheck = canBid(state, 'atreides', 5);
assert(bidCheck.ok === false, 'atreides cannot bid while at hand limit');

// Test 3: no bids at all ends the phase early and returns cards to deck
console.log('Test 3: unsold card returns to deck top, ends phase');
state = makeMinimalState();
startBiddingPhase(state);
const cardsUp = state.bidding.cardsUpForBid.length;
const deckBefore = state.decks.treacheryDeck.length;
resolveCurrentCard(state); // nobody bid, currentBidder is null
assert(state.bidding.active === false, 'bidding phase ends when a card draws no bids at all');
assert(state.decks.treacheryDeck.length === deckBefore + cardsUp, 'all remaining cards returned to deck top');

console.log('\nAll bidding engine sanity checks passed.');
