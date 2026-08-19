// setupEngine.js
//
// Setup, per the rulebook's own six-step sequence (Positions, Traitors,
// Spice, Forces, Treachery, Turn Marker). Ties together every deck-
// building and dealing function already built in the other engines
// rather than reimplementing any of it, this file's job is orchestration
// and the starting-resource numbers themselves, which is the one thing
// that didn't exist anywhere yet.
//
// Deliberately left for the caller to resolve, not guessed here:
//   - First Player / turn order: genuinely needs the Storm procedure,
//     which needs sector data (see docs/STORM_TODO.md). initializeGame()
//     sets meta.firstPlayer = null and meta.turnOrder to the raw seating
//     order given, the real rotation-by-storm-position logic slots in
//     once stormEngine.determineFirstPlayer() is unblocked.
//   - Bene Gesserit Prediction and Traitor selection are both genuine
//     player decisions (Prediction is explicitly "secret", traitor
//     selection needs to see what was actually dealt), so those are
//     exposed as separate functions rather than automated inside
//     initializeGame() itself.

const { createInitialGameState } = require('./gameState.js');
const { buildSpiceDeck } = require('./spiceEngine.js');
const { buildTraitorDeck, shuffle: shuffleTraitors, dealTraitorHands } = require('./traitorDeckEngine.js');

// Starting resources, transcribed directly from each faction's player
// sheet in the base rulebook (the "AT START" / "FREE REVIVAL" boxes).
const STARTING_CONDITIONS = {
  atreides: {
    spice: 10,
    reserve: 10,
    starredReserve: 0,
    onBoard: { arrakeen: 10 }
  },
  harkonnen: {
    spice: 10,
    reserve: 10,
    starredReserve: 0,
    onBoard: { carthag: 10 }
  },
  emperor: {
    spice: 10,
    reserve: 20,
    starredReserve: 5, // all 5 Sardaukar start off-planet, per the player sheet (no on-board start at all)
    onBoard: {}
  },
  fremen: {
    spice: 3,
    reserve: 10,
    starredReserve: 3, // 3 Fedaykin, not specified which are on-board vs reserve, defaulted to reserve, see note below
    // Player's choice across Sietch Tabr, False Wall South, False Wall West per the rulebook.
    // Defaulting all 10 to Sietch Tabr here rather than guessing a split; callers who want a
    // different starting distribution should pass a fremenPlacement override to initializeGame().
    onBoard: { sietchTabr: 10 }
  },
  guild: {
    spice: 5,
    reserve: 15,
    starredReserve: 0,
    onBoard: { tueksSietch: 5 }
  },
  gesserit: {
    spice: 5,
    reserve: 19,
    starredReserve: 0,
    // Player's choice of any territory for their 1 starting advisor, per
    // the rulebook's advanced-game start-of-game note. Defaulting to the
    // Polar Sink (also what the basic player sheet itself states) rather
    // than guessing elsewhere. Note: this is placed as a plain force,
    // the advisor/fighter flip state isn't modeled yet, see docs/ALLIANCE_TODO.md
    // and the wider faction-ability gap list for that.
    onBoard: { polarSink: 1 }
  }
};

// Harkonnen alone is dealt 2 starting Treachery Cards instead of 1, per
// their player sheet, everyone else gets the standard 1.
const STARTING_TREACHERY_COUNT = { harkonnen: 2 };

function initializeFactionResources(state, factionId, overrides = {}) {
  const conditions = { ...STARTING_CONDITIONS[factionId], ...overrides };
  const faction = state.factions[factionId];

  faction.spice = conditions.spice;
  faction.forces.reserve = conditions.reserve;
  faction.forces.starredReserve = conditions.starredReserve;
  faction.forces.onBoard = { ...conditions.onBoard };
  faction.forces.starredOnBoard = {}; // starred units all start in reserve by default, see STARTING_CONDITIONS notes

  return state;
}

// --- Deck setup ------------------------------------------------------

function setupSpiceDeck(state, spiceDeckData, territoriesData, rngShuffle) {
  state.decks.spiceDeck = buildSpiceDeck(spiceDeckData, territoriesData, rngShuffle);
  state.decks.spiceDiscardA = [];
  state.decks.spiceDiscardB = [];
  return state;
}

function setupTreacheryDeck(state, treacheryDeckData, rngShuffle) {
  state.decks.treacheryDeck = rngShuffle(treacheryDeckData.cards.map(c => c.id));
  state.decks.treacheryDiscard = [];
  return state;
}

function dealStartingTreachery(state, activeFactionIds) {
  for (const factionId of activeFactionIds) {
    const count = STARTING_TREACHERY_COUNT[factionId] ?? 1;
    const dealt = [];
    for (let i = 0; i < count; i++) {
      const card = state.decks.treacheryDeck.pop();
      if (!card) throw new Error(`Treachery deck ran out dealing starting hands to ${factionId}.`);
      dealt.push(card);
    }
    state.factions[factionId].treacheryHand = dealt;
  }
  return state;
}

function setupTraitorDeck(state, leadersData, activeFactionIds, factionOrder, rngShuffle) {
  const rawDeck = buildTraitorDeck(leadersData, activeFactionIds);
  const shuffled = shuffleTraitors(rawDeck, rngShuffle);
  const remaining = dealTraitorHands(state, shuffled, factionOrder);
  state.decks.traitorDeck = remaining;
  return state;
}

// --- Bene Gesserit Prediction (a genuine secret player decision) ---------

function canSetPrediction(state, predictedFactionId, predictedTurn) {
  if (!state.factions.gesserit) {
    return { ok: false, reason: 'Bene Gesserit is not in this game.' };
  }
  if (predictedFactionId === 'gesserit') {
    return { ok: false, reason: 'Bene Gesserit predicts a faction other than themselves, they win via correct prediction instead.' };
  }
  if (!state.factions[predictedFactionId]) {
    return { ok: false, reason: 'Predicted faction is not actually in this game.' };
  }
  if (predictedTurn < 1 || predictedTurn > state.rulesConfig.victoryVariants.maxTurns) {
    return { ok: false, reason: `Predicted turn must be between 1 and ${state.rulesConfig.victoryVariants.maxTurns}.` };
  }
  return {
    ok: true,
    // Not enforced as a hard block, deliberately: this model doesn't
    // distinguish "won via special victory condition" from "won via
    // ordinary strongholds on the same turn," and the rulebook only
    // excludes the former. Flagging rather than either over- or
    // under-blocking a legitimate prediction.
    note: (predictedFactionId === 'guild' || predictedFactionId === 'fremen')
      ? 'Note: cannot count if that faction wins specifically via their special victory condition, ordinary stronghold wins are fine to predict. Not distinguished automatically, see setupEngine.js comments.'
      : null
  };
}

function setPrediction(state, predictedFactionId, predictedTurn) {
  const check = canSetPrediction(state, predictedFactionId, predictedTurn);
  if (!check.ok) throw new Error(check.reason);

  state.factions.gesserit.specialFactionState.prediction = { factionId: predictedFactionId, turn: predictedTurn };
  return check;
}

// --- Full setup orchestration ---------------------------------------------

function initializeGame(config) {
  const {
    activeFactionIds,       // e.g. ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit']
    playerCircleOrder,      // seating order, counterclockwise, same faction ids
    rulesConfig,
    spiceDeckData, territoriesData, treacheryDeckData, leadersData,
    rngShuffle = arr => arr.slice().sort(() => Math.random() - 0.5),
    resourceOverrides = {}  // optional per-faction overrides, e.g. custom Fremen starting split
  } = config;

  if (activeFactionIds.length < 2 || activeFactionIds.length > 6) {
    throw new Error('Dune supports 2 to 6 factions.');
  }
  if (playerCircleOrder.length !== activeFactionIds.length) {
    throw new Error('playerCircleOrder must contain exactly the same factions as activeFactionIds.');
  }

  const state = createInitialGameState({ factionIds: activeFactionIds, rulesConfig });
  state.rulesConfig = rulesConfig;

  // createInitialGameState() leaves board.territories as an empty
  // placeholder by its own design (its comment says "from data/map.json
  // at load time"), this is that load.
  state.board.territories = territoriesData.territories;

  for (const factionId of activeFactionIds) {
    initializeFactionResources(state, factionId, resourceOverrides[factionId] ?? {});
    // buildFactionStates() in gameState.js leaves leaders.available empty
    // by design too, same reasoning, this is where it actually gets filled.
    state.factions[factionId].leaders.available = (leadersData[factionId] ?? []).map(l => l.id);
  }

  setupSpiceDeck(state, spiceDeckData, territoriesData, rngShuffle);
  setupTraitorDeck(state, leadersData, activeFactionIds, playerCircleOrder, rngShuffle);
  setupTreacheryDeck(state, treacheryDeckData, rngShuffle);
  dealStartingTreachery(state, activeFactionIds);

  // First Player / turn order: genuinely blocked on sector data, see the
  // file header comment. Seating order stands in as the base rotation
  // until stormEngine.determineFirstPlayer() is unblocked.
  state.meta.turnOrder = playerCircleOrder;
  state.meta.firstPlayer = null;
  state.meta.phase = 'setup';
  state.meta.turn = 1;

  return state;
}

module.exports = {
  STARTING_CONDITIONS,
  STARTING_TREACHERY_COUNT,
  initializeFactionResources,
  setupSpiceDeck,
  setupTreacheryDeck,
  dealStartingTreachery,
  setupTraitorDeck,
  canSetPrediction,
  setPrediction,
  initializeGame
};
