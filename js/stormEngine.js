// stormEngine.js
//
// Phase 1: Storm. Split cleanly into two halves by what's actually
// blocked on sector data:
//
//   IMPLEMENTED NOW: the dial-and-sum arithmetic that determines HOW FAR
//   the storm moves. This is sector-count math (mod 18), not sector
//   IDENTITY, so it doesn't need to know which territories sit in which
//   sectors.
//
//   STUBBED, SEE docs/STORM_TODO.md: everything that needs to know WHICH
//   territories/player-circles a given sector number actually touches.
//   Calling any of the stubbed functions throws a clear NOT_IMPLEMENTED
//   error rather than silently doing nothing or guessing, so a future
//   caller can't accidentally ship on a stub without noticing.

const TOTAL_SECTORS = 18;

// --- Storm movement distance (fully implementable now) -------------------

function rollFirstStormMovement(dialA, dialB) {
  if (dialA < 0 || dialA > 20 || dialB < 0 || dialB > 20) {
    throw new Error('First storm dial values must each be between 0 and 20.');
  }
  return dialA + dialB;
}

function rollSubsequentStormMovement(dialA, dialB) {
  if (dialA < 1 || dialA > 3 || dialB < 1 || dialB > 3) {
    throw new Error('Subsequent storm dial values must each be between 1 and 3.');
  }
  return dialA + dialB;
}

// Fremen advanced ability replaces the two-player dial with a private
// Storm Card draw (1-10) the Fremen player holds and reveals next turn.
// The draw/shuffle mechanic itself doesn't need sector data, so it's
// implemented here; only WHERE the resulting movement lands does.
function drawFremenStormCard(stormDeck, rngShuffle) {
  if (stormDeck.length === 0) throw new Error('Storm deck is empty, should never happen, it is reshuffled after each draw.');
  const deck = rngShuffle(stormDeck);
  const drawn = deck.pop();
  return { drawnCard: drawn, remainingDeck: deck };
}

// --- Sector position arithmetic (implementable: pure modular math) -------

function advanceStormPosition(currentSector, sectorsToMove) {
  // Counterclockwise per the rulebook. Direction convention (which way
  // increasing sector numbers run) depends on how sectors end up numbered
  // once finalized, see docs/STORM_TODO.md item 1. This function assumes
  // "counterclockwise" = increasing sector index, mod 18; if the final
  // numbering runs the other way, this becomes a one-line sign flip, not
  // a redesign.
  return ((currentSector + sectorsToMove) % TOTAL_SECTORS + TOTAL_SECTORS) % TOTAL_SECTORS;
}

// Returns the list of sector indices the storm sweeps through, inclusive
// of start and end, for damage purposes ("passes over or stops in").
function sectorsSwept(startSector, sectorsToMove) {
  const swept = [];
  for (let i = 1; i <= sectorsToMove; i++) {
    swept.push(advanceStormPosition(startSector, i));
  }
  return swept;
}

// --- STUBBED: needs sector <-> territory data, see docs/STORM_TODO.md ----

function applyStormDamage(state, sweptSectors, territorySectorMap) {
  throw new Error(
    'NOT_IMPLEMENTED: applyStormDamage needs a territorySectorMap (which sectors each ' +
    'territory occupies) that does not exist yet. See docs/STORM_TODO.md item 2. ' +
    'Once that map exists, this removes forces (except in Imperial Basin, which is ' +
    'explicitly storm-immune per the rulebook) and spice from every territory whose ' +
    'sectors overlap sweptSectors, sending forces to the Tleilaxu Tanks and spice to ' +
    'the Spice Bank.'
  );
}

function isTerritoryPartiallyInStorm(territoryId, currentStormSector, territorySectorMap) {
  throw new Error(
    'NOT_IMPLEMENTED: needs territorySectorMap. See docs/STORM_TODO.md item 2. ' +
    'This matters because several territories span multiple sectors, so a group can ' +
    'be legally in a territory while only part of it is stormbound, movementEngine.js ' +
    'has two TODO markers waiting on exactly this function.'
  );
}

function determineFirstPlayer(state, currentStormSector, playerCircleSectorMap) {
  throw new Error(
    'NOT_IMPLEMENTED: needs playerCircleSectorMap (which sector each faction\'s player ' +
    'circle sits at around the board rim) that does not exist yet. See ' +
    'docs/STORM_TODO.md item 3. This determines First Player each turn: whoever\'s ' +
    'circle the storm "next approaches."'
  );
}

module.exports = {
  TOTAL_SECTORS,
  rollFirstStormMovement,
  rollSubsequentStormMovement,
  drawFremenStormCard,
  advanceStormPosition,
  sectorsSwept,
  applyStormDamage,
  isTerritoryPartiallyInStorm,
  determineFirstPlayer
};
