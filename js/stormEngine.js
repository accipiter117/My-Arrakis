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
import { noFieldAt, revealNoField } from './noField.js';

const TOTAL_SECTORS = 18;

// The 6 Storm cards of the GF9 2019 edition, one of each value (advanced
// rules: the Fremen control the storm with them). If a physical deck turns
// out to differ, this list is the only thing to change.
const STORM_DECK = [1, 2, 3, 4, 5, 6];

// All cards are shuffled back before each preview, so every draw is from
// the full deck.
function drawStormCard(randomFn) {
  return STORM_DECK[Math.floor(randomFn() * STORM_DECK.length)];
}

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

// --- Storm damage --------------------------------------------------------------
// House rule (project owner), standing in for the board's printed sectors:
// each territory lies "mostly" in one storm sector, computed from our map
// geometry with the storm wedge's own angles (tools/computeSectors.py writes
// stormSector into data/territories.json). As the storm moves, every SAND
// territory whose sector it passes over or stops in loses all forces and
// spice there. Stone territories and strongholds are immune; Imperial Basin
// is sheltered by the Shield Wall; the Polar Sink is never in the storm.
// Fremen (advanced) lose only half their forces, rounded up.
const SHELTERED = ['imperialBasin'];

// Once Family Atomics destroy the Shield Wall, Imperial Basin, Arrakeen and
// Carthag lose its protection for the rest of the game.
const SHIELD_WALL_PROTECTED = ['imperialBasin', 'arrakeen', 'carthag'];
function stormExposed(state, id, t) {
  if (state.board.shieldWallDestroyed && SHIELD_WALL_PROTECTED.includes(id)) return true;
  return t.type === 'sand' && !SHELTERED.includes(id);
}

// Territories the storm would sweep moving `sectors` from `from` (AI previews).
function territoriesInPath(state, from, sectors) {
  const swept = new Set(sectorsSwept(from, sectors));
  return Object.entries(state.board.territories).filter(([id, t]) => stormExposed(state, id, t) && swept.has(t.stormSector)).map(([id]) => id);
}

// Family Atomics (base card): playable after the storm's movement is known and
// before it moves, by a faction with fighters on the Shield Wall or in a territory
// next to it. Every force on the Shield Wall is destroyed, and the Shield Wall no
// longer protects Imperial Basin, Arrakeen and Carthag from the storm.
// ...and the storm must not stand between those forces and the Shield Wall: neither
// territory's sector in storm, nor the storm in a sector between the two (the short way round).
function stormBetween(state, a, b) {
  const pos = state.board.stormPosition;
  if (pos == null) return false;
  const sa = state.board.territories[a]?.stormSector, sb = state.board.territories[b]?.stormSector;
  if (sa == null || sb == null) return false;
  if (sa === pos || sb === pos) return true;
  const fwd = (sb - sa + TOTAL_SECTORS) % TOTAL_SECTORS;
  const steps = fwd <= TOTAL_SECTORS / 2 ? fwd : fwd - TOTAL_SECTORS; // shorter direction
  for (let k = 1; k < Math.abs(steps); k++) if ((sa + Math.sign(steps) * k + TOTAL_SECTORS) % TOTAL_SECTORS === pos) return true;
  return false;
}
const canUseFamilyAtomics = (state, factionId) => {
  if (state.board.shieldWallDestroyed || !state.factions[factionId]?.treacheryHand.includes('familyAtomics')) return false;
  const near = ['shieldWall', ...(state.board.territories.shieldWall?.adjacentBoard ?? [])];
  const fx = state.factions[factionId].forces;
  const advisorHere = t => factionId === 'gesserit' && (fx.advisorTerritories ?? []).includes(t);
  return near.some(t => (fx.onBoard[t] ?? 0) > 0 && !advisorHere(t) && !stormBetween(state, t, 'shieldWall'));
};
function useFamilyAtomics(state, factionId) {
  if (!canUseFamilyAtomics(state, factionId)) return null;
  const f = state.factions[factionId];
  f.treacheryHand = f.treacheryHand.filter(c => c !== 'familyAtomics');
  state.decks.treacheryDiscard.push('familyAtomics');
  const losses = [];
  for (const [id, x] of Object.entries(state.factions)) {
    const here = x.forces.onBoard.shieldWall ?? 0;
    if (!here) continue;
    const starred = x.forces.starredOnBoard?.shieldWall ?? 0;
    delete x.forces.onBoard.shieldWall;
    if (x.forces.starredOnBoard) delete x.forces.starredOnBoard.shieldWall;
    if (x.forces.advisorsOnBoard) delete x.forces.advisorsOnBoard.shieldWall;
    x.revivalTanks = (x.revivalTanks ?? 0) + here;
    x.starredRevivalTanks = (x.starredRevivalTanks ?? 0) + starred;
    losses.push({ factionId: id, lost: here });
  }
  state.board.shieldWallDestroyed = true;
  return { factionId, losses };
}

function applyStormDamage(state, from, sectors) {
  const swept = new Set(sectorsSwept(from, sectors));
  const hit = territoriesInPath(state, from, sectors);
  const losses = [];
  let spiceLost = [];
  const revealed = [];
  for (const territoryId of hit) {
    // A No-Field token caught by the storm is revealed first; its forces are then lost.
    if (noFieldAt(state, territoryId)) revealed.push(revealNoField(state));
    for (const [factionId, faction] of Object.entries(state.factions)) {
      const here = faction.forces.onBoard[territoryId] ?? 0;
      if (!here) continue;
      // CHOAM's Jubba Cloak shelters its forces in one territory from this storm.
      if (factionId === 'choam' && state.choamEffects?.jubbaCloak === territoryId) continue;
      const starredHere = faction.forces.starredOnBoard?.[territoryId] ?? 0;
      const lost = factionId === 'fremen' ? Math.ceil(here / 2) : here;
      // Ordinary forces are lost first, so elite forces survive where they can.
      const starredLost = Math.max(0, lost - (here - starredHere));
      faction.forces.onBoard[territoryId] = here - lost;
      if (!faction.forces.onBoard[territoryId]) delete faction.forces.onBoard[territoryId];
      if (starredLost) {
        faction.forces.starredOnBoard[territoryId] = starredHere - starredLost;
        if (!faction.forces.starredOnBoard[territoryId]) delete faction.forces.starredOnBoard[territoryId];
      }
      faction.revivalTanks = (faction.revivalTanks ?? 0) + lost;
      faction.starredRevivalTanks = (faction.starredRevivalTanks ?? 0) + starredLost;
      losses.push({ factionId, territoryId, lost });
    }
    const spiceHere = state.board.spiceBlowMarkers.filter(m => m.territoryId === territoryId);
    if (spiceHere.length) {
      spiceLost.push({ territoryId, amount: spiceHere.reduce((a, m) => a + m.amount, 0) });
      state.board.spiceBlowMarkers = state.board.spiceBlowMarkers.filter(m => m.territoryId !== territoryId);
    }
  }
  return { swept: [...swept], territories: hit, losses, spiceLost, noFieldRevealed: revealed };
}

export {
  territoriesInPath,
  canUseFamilyAtomics,
  useFamilyAtomics,
  STORM_DECK,
  drawStormCard,
  TOTAL_SECTORS,
  rollFirstStormMovement,
  rollSubsequentStormMovement,
  drawFremenStormCard,
  advanceStormPosition,
  sectorsSwept,
  applyStormDamage,
  stormExposed,
  isTerritoryPartiallyInStorm,
  determineFirstPlayer
};
