// biddingEngine.js
//
// Implements Phase 4: Bidding, per the base rulebook, with advanced rules
// always active (per project rule) and hooks for faction-specific abilities.
//
// Design principle carried over from phaseEngine.js: nothing here is UI.
// Every function takes and returns plain state. The AI and the human player
// call the exact same canBid()/placeBid()/passBid() functions, so there is
// no separate "AI cheats a little" code path.

const DEFAULT_HAND_LIMIT = 4;

const HAND_LIMIT_OVERRIDES = {
  harkonnen: 8,
  choam: 5
};

function handLimitFor(factionId) {
  return HAND_LIMIT_OVERRIDES[factionId] ?? DEFAULT_HAND_LIMIT;
}

function isAtHandLimit(state, factionId) {
  const faction = state.factions[factionId];
  return faction.treacheryHand.length >= handLimitFor(factionId);
}

// --- Phase entry: deal cards, apply pre-bid faction abilities -------------

function startBiddingPhase(state) {
  const biddingFactionIds = Object.keys(state.factions).filter(
    id => !isAtHandLimit(state, id)
  );

  // Richese: if present, must offer exactly one card from their own cache
  // before or after the normal round (their choice, announced up front).
  // This reduces the normal auction by one card. Not yet wired here; the
  // hook point is noted so it isn't silently forgotten when Richese is added.
  let normalCardCount = biddingFactionIds.length;
  if (state.factions.richese && !isAtHandLimit(state, 'richese')) {
    // TODO: prompt Richese for Once Around vs Silent Auction and
    // first-or-last placement once the Richese cache exists in state.
    // normalCardCount -= 1;
  }

  // Ixian: draws one extra card than the number up for bid, looks at all,
  // buries one top or bottom of the deck, before the row is dealt.
  if (state.factions.ixians && !isAtHandLimit(state, 'ixians')) {
    // TODO: implement once treacheryDeck draw/peek/bury helpers exist.
    // This must happen before dealCardsForBidding() draws the row.
  }

  const dealtCards = dealCardsForBidding(state, normalCardCount);

  state.bidding = {
    cardsUpForBid: dealtCards,       // array of card ids, front of array = current auction
    currentCardIndex: 0,
    currentBid: 0,
    currentBidder: null,
    openedBy: null,                  // who opened bidding for the current card
    passedThisCard: [],              // faction ids who have passed on the current card
    lastCardOpener: null,            // tracks rotation for "next starting bidder" rule
    atreidesHasPeeked: false,
    active: dealtCards.length > 0
  };

  // Atreides: sees every card before anyone bids on it. This is a private
  // information reveal, not a state mutation, so it's flagged here for the
  // UI/AI layer to action rather than resolved as part of engine state.
  if (state.factions.atreides && !isAtHandLimit(state, 'atreides')) {
    state.bidding.atreidesMayPeek = true;
  }

  return state;
}

function dealCardsForBidding(state, count) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    const card = drawTreacheryCard(state);
    if (card) drawn.push(card);
  }
  return drawn;
}

function drawTreacheryCard(state) {
  if (state.decks.treacheryDeck.length === 0) {
    reshuffleDiscardIntoDeck(state);
  }
  return state.decks.treacheryDeck.pop() ?? null;
}

function reshuffleDiscardIntoDeck(state) {
  state.decks.treacheryDeck = shuffle(state.decks.treacheryDiscard);
  state.decks.treacheryDiscard = [];
}

function shuffle(array) {
  // Deterministic-friendly shuffle: caller controls the RNG seed via
  // whatever wraps this engine, this just does a standard Fisher-Yates.
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// --- Auction turn order -----------------------------------------------

function determineOpeningBidder(state) {
  const { lastCardOpener } = state.bidding;
  const order = biddingEligibleOrder(state);

  if (lastCardOpener === null) {
    // First card of the phase: First Player opens, or the next eligible
    // player to their right if First Player is at hand limit.
    return firstEligibleFrom(order, state.meta.firstPlayer, state);
  }

  // Subsequent cards: opens with the next eligible player to the right of
  // whoever opened the previous card, so everyone gets a turn to open.
  const lastOpenerIdx = order.indexOf(lastCardOpener);
  return firstEligibleFrom(order, order[(lastOpenerIdx + 1) % order.length], state);
}

function firstEligibleFrom(order, startId, state) {
  // Defensive: if startId isn't actually in order (missing/invalid
  // firstPlayer, or a between-alliances edge case), indexOf returns -1,
  // and JS's negative modulo on array access returns undefined rather
  // than wrapping around, which crashed downstream instead of degrading.
  // Falling back to position 0 is an explicit, safe default here, not
  // just here for the caller to have already sorted out a valid start.
  const rawIdx = order.indexOf(startId);
  const startIdx = rawIdx === -1 ? 0 : rawIdx;
  for (let i = 0; i < order.length; i++) {
    const candidate = order[(startIdx + i) % order.length];
    if (!isAtHandLimit(state, candidate)) return candidate;
  }
  return null; // nobody can bid
}

function biddingEligibleOrder(state) {
  // Storm/turn order (counterclockwise from First Player) is assumed to
  // already be resolved into meta.turnOrder by the phase engine before
  // bidding starts. This function just filters to who can act.
  return state.meta.turnOrder ?? Object.keys(state.factions);
}

// --- Core bid actions, these are the validation-layer functions ---------

function canBid(state, factionId, amount) {
  if (!state.bidding?.active) return { ok: false, reason: 'No auction in progress.' };
  if (isAtHandLimit(state, factionId)) return { ok: false, reason: `${factionId} is at their hand limit and must pass.` };
  if (state.bidding.passedThisCard.includes(factionId)) return { ok: false, reason: `${factionId} has already passed on this card.` };
  if (amount > state.factions[factionId].spice) return { ok: false, reason: 'Cannot bid more spice than currently held.' };
  if (amount <= state.bidding.currentBid) return { ok: false, reason: 'Bid must exceed the current high bid.' };
  if (state.bidding.currentBid === 0 && amount < 1) return { ok: false, reason: 'Opening bid must be at least 1 spice.' };
  return { ok: true };
}

function placeBid(state, factionId, amount) {
  const check = canBid(state, factionId, amount);
  if (!check.ok) throw new Error(check.reason);

  state.bidding.currentBid = amount;
  state.bidding.currentBidder = factionId;
  if (state.bidding.openedBy === null) {
    state.bidding.openedBy = factionId;
  }
  return state;
}

function canPass(state, factionId) {
  if (!state.bidding?.active) return { ok: false, reason: 'No auction in progress.' };
  if (state.bidding.passedThisCard.includes(factionId)) return { ok: false, reason: 'Already passed.' };
  return { ok: true };
}

function passBid(state, factionId) {
  const check = canPass(state, factionId);
  if (!check.ok) throw new Error(check.reason);

  state.bidding.passedThisCard.push(factionId);
  return state;
}

// Returns true when only the current high bidder (or nobody, if the card
// hasn't drawn any bids) remains, meaning the auction for this card is over.
function isAuctionResolved(state) {
  const eligible = biddingEligibleOrder(state).filter(
    id => !isAtHandLimit(state, id)
  );
  const stillIn = eligible.filter(id => !state.bidding.passedThisCard.includes(id));
  return stillIn.length <= 1;
}

// --- Resolving a card once bidding on it has closed ----------------------

function resolveCurrentCard(state) {
  const cardId = state.bidding.cardsUpForBid[state.bidding.currentCardIndex];
  const winner = state.bidding.currentBidder;

  if (winner === null) {
    // Nobody bid at all: per the rulebook, this ends the ENTIRE bidding
    // phase early, remaining cards return to the top of the deck.
    returnRemainingCardsToDeck(state);
    state.bidding.active = false;
    return state;
  }

  const price = state.bidding.currentBid;
  payForCard(state, winner, price);
  state.factions[winner].treacheryHand.push(cardId);

  // Harkonnen: free extra card every time they buy one, unless that would
  // push them past their own 8-card limit.
  if (winner === 'harkonnen' && state.factions.harkonnen.treacheryHand.length < handLimitFor('harkonnen')) {
    const bonusCard = drawTreacheryCard(state);
    if (bonusCard) state.factions.harkonnen.treacheryHand.push(bonusCard);
  }

  advanceToNextCard(state);
  return state;
}

function payForCard(state, buyerFactionId, amount) {
  state.factions[buyerFactionId].spice -= amount;

  // Payment routing: Emperor redirect only applies when someone OTHER than
  // Emperor buys a normal-deck card. Richese's own cache cards are excluded
  // entirely (handled in the not-yet-wired Richese auction path above).
  const emperorPresent = Boolean(state.factions.emperor);
  if (emperorPresent && buyerFactionId !== 'emperor') {
    state.factions.emperor.spice += amount;
  } else {
    state.spiceBank.totalInCirculation -= amount; // returned to the bank
  }
}

function advanceToNextCard(state) {
  state.bidding.currentCardIndex += 1;
  state.bidding.currentBid = 0;
  state.bidding.currentBidder = null;
  state.bidding.passedThisCard = [];
  state.bidding.lastCardOpener = state.bidding.openedBy;
  state.bidding.openedBy = null;

  if (state.bidding.currentCardIndex >= state.bidding.cardsUpForBid.length) {
    state.bidding.active = false;
  }
}

function returnRemainingCardsToDeck(state) {
  const remaining = state.bidding.cardsUpForBid.slice(state.bidding.currentCardIndex);
  state.decks.treacheryDeck = remaining.concat(state.decks.treacheryDeck);
}

module.exports = {
  handLimitFor,
  isAtHandLimit,
  startBiddingPhase,
  determineOpeningBidder,
  canBid,
  placeBid,
  canPass,
  passBid,
  isAuctionResolved,
  resolveCurrentCard
};
