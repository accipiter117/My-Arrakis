// gameState.js
// Central authoritative game state. No faction-specific logic lives here,
// only the shape of the data. Faction abilities operate ON this state via
// the engine, they don't get their own parallel state objects.

function createInitialGameState(config) {
  // config: { factionIds: [...], playerCount, rulesConfig }

  return {
    meta: {
      turn: 1,
      phase: "setup",
      firstPlayer: null,
      rulesConfig: config.rulesConfig,
      rngSeed: config.rngSeed || generateSeed()
    },

    board: {
      stormPosition: null,
      territories: createTerritoryMap(), // from data/map.json at load time
      spiceBlowMarkers: []
    },

    decks: {
      spiceDeck: [],
      // Two discard piles, not one: advanced rules (Double Spice Blow) are
      // always active per project instruction, so this was never actually
      // optional and the single-pile shape here was already stale.
      spiceDiscardA: [],
      spiceDiscardB: [],
      treacheryDeck: [],
      treacheryDiscard: [],
      traitorDeck: []
    },

    spiceBank: {
      // Bank total isn't usually tracked in physical Dune, but tracking it
      // digitally lets us sanity-check that spice is conserved across the
      // whole game (useful for automated tests, section 38).
      totalInCirculation: 0
    },

    // NOTE: an earlier draft of this file had a top-level revivalTanks
    // object here. Every engine actually built since (battle, spice,
    // revival) uses faction.revivalTanks as a plain number instead, that's
    // the real shape in use, this comment replaces the stale unused one
    // rather than leaving two conflicting ideas of where tanked forces live.

    battles: {
      pending: [],
      resolved: []
    },

    alliances: [
      // { factions: [id, id], formedTurn: n }
    ],

    nexus: {
      active: false,
      pendingAllianceOffers: []
    },

    victory: {
      achieved: false,
      winningFactions: [],
      method: null // 'stronghold', 'fremen', 'guild', 'gesserit_prediction', etc.
    },

    factions: buildFactionStates(config.factionIds)
  };
}

function buildFactionStates(factionIds) {
  const factions = {};
  for (const id of factionIds) {
    factions[id] = {
      id,
      spice: null,               // set from factions.json at game start
      revivalTanks: 0,             // tanked ordinary forces, plain number, used by battle/spice/revival engines
      starredRevivalTanks: 0,      // tanked starred forces (Sardaukar/Fedaykin), 0 for other factions
      forces: {
        reserve: null,
        starredReserve: 0,          // Sardaukar (emperor) / Fedaykin (fremen) only, 0 for other factions
        onBoard: {},                 // total forces per territory, unchanged shape, existing consumers keep working
        starredOnBoard: {}           // subset of onBoard that are starred, per territory. Only ever non-zero for emperor/fremen
      },
      leaders: { available: [], killed: [] },
      treacheryHand: [],
      traitorHand: [],
      alliance: null,
      specialFactionState: {
        // Atreides only: Kwisatz Haderach tracking. Losses are meant to be
        // tracked "secretly" per the rulebook, that's a UI-visibility
        // concern, not a data-modeling one, so it's just a plain field here.
        cumulativeForcesLostInBattle: 0,
        kwisatzHaderachActive: false,
        kwisatzHaderachUsedInTerritoryThisPhase: null // territoryId or null, resets each Battle phase
      },
      aiState: {
        personality: id,          // maps to weighting profile in factions.json
        threatAssessment: {},
        knownInformation: {       // this is the faction's PRIVATE knowledge model
          publicState: null,        // reference/snapshot, safe to read freely
          inferredEnemyHands: {},   // probabilistic, never exact
          ownPrivateState: {}       // this faction's own hidden info, fully known to itself only
        }
      },
      victoryInfo: {
        strongholdsControlled: [],
        eligibleForSpecialVictory: false
      }
    };
  }
  return factions;
}

function generateSeed() {
  return "DUNE-" + Math.floor(Math.random() * 1e6);
}

function createTerritoryMap() {
  // Placeholder: real implementation loads from data/map.json.
  return {};
}

module.exports = { createInitialGameState };
