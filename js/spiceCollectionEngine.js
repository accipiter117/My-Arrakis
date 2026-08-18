// spiceCollectionEngine.js
//
// Phase 8: Spice Collection. Two genuinely separate mechanics that are
// easy to conflate, kept as distinct functions here:
//
//   1. Collecting spice FROM a spice-blow territory: rate is 2 spice per
//      force, or 3 if the collecting faction occupies Carthag OR Arrakeen
//      (anywhere, not specifically at the blow site itself).
//   2. Advanced "Increased Spice Flow": passive income just for occupying
//      Carthag, Arrakeen, or Tuek's Sietch at collection time, 2/2/1
//      respectively, entirely independent of any spice blow existing.
//      Always active, part of the advanced rules that are always on.

const RATE_BOOST_STRONGHOLDS = ['carthag', 'arrakeen'];
const INCREASED_FLOW_INCOME = { carthag: 2, arrakeen: 2, tueksSietch: 1 };

function occupantsOf(state, territoryId) {
  return Object.keys(state.factions).filter(
    factionId => (state.factions[factionId].forces.onBoard[territoryId] ?? 0) > 0
  );
}

function collectionRateFor(state, factionId) {
  const occupiesRateBoostStronghold = RATE_BOOST_STRONGHOLDS.some(
    strongholdId => (state.factions[factionId].forces.onBoard[strongholdId] ?? 0) > 0
  );
  return occupiesRateBoostStronghold ? 3 : 2;
}

// Collects from a single spice blow marker, in turn order, splitting the
// available spice among however many factions are actually present
// (normally just one, since Battles resolves down to one faction per
// territory first, but the Polar Sink / storm-separated edge cases can
// leave more than one present at collection time).
function collectFromSpiceBlow(state, marker, turnOrder) {
  const occupants = occupantsOf(state, marker.territoryId);
  if (occupants.length === 0) {
    return { territoryId: marker.territoryId, collections: [], remaining: marker.amount };
  }

  const orderedOccupants = turnOrder.filter(id => occupants.includes(id));
  let remaining = marker.amount;
  const collections = [];

  for (const factionId of orderedOccupants) {
    if (remaining <= 0) break;
    const forcesPresent = state.factions[factionId].forces.onBoard[marker.territoryId] ?? 0;
    const rate = collectionRateFor(state, factionId);
    const entitled = forcesPresent * rate;
    const collected = Math.min(entitled, remaining);

    state.factions[factionId].spice += collected;
    remaining -= collected;
    collections.push({ factionId, collected });
  }

  return { territoryId: marker.territoryId, collections, remaining };
}

function collectAllSpiceBlows(state, turnOrder) {
  const results = [];
  const stillRemaining = [];

  for (const marker of state.board.spiceBlowMarkers) {
    const result = collectFromSpiceBlow(state, marker, turnOrder);
    results.push(result);
    if (result.remaining > 0) {
      // Uncollected spice remains on the board for future turns, per the
      // rulebook, rather than disappearing.
      stillRemaining.push({ ...marker, amount: result.remaining });
    }
  }

  state.board.spiceBlowMarkers = stillRemaining;
  return results;
}

// Advanced rule, always active: passive stronghold income independent of
// any spice blow. Each distinct occupying faction collects separately,
// per the rulebook's explicit "if a player occupies two of these
// strongholds, they collect spice for each that they occupy."
function collectIncreasedSpiceFlow(state) {
  const results = [];
  for (const [strongholdId, amount] of Object.entries(INCREASED_FLOW_INCOME)) {
    for (const factionId of occupantsOf(state, strongholdId)) {
      state.factions[factionId].spice += amount;
      results.push({ factionId, strongholdId, collected: amount });
    }
  }
  return results;
}

function resolveSpiceCollectionPhase(state, turnOrder) {
  const blowCollections = collectAllSpiceBlows(state, turnOrder);
  const strongholdCollections = collectIncreasedSpiceFlow(state);
  return { blowCollections, strongholdCollections };
}

module.exports = {
  collectionRateFor,
  collectFromSpiceBlow,
  collectAllSpiceBlows,
  collectIncreasedSpiceFlow,
  resolveSpiceCollectionPhase
};
