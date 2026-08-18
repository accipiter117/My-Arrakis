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
      spiceDiscard: [],
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

    revivalTanks: {
      // per faction: { forces: number, leaders: [leaderId, ...] }
    },

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
      forces: { reserve: null, onBoard: {} }, // onBoard keyed by territoryId
      leaders: { available: [], killed: [] },
      treacheryHand: [],
      traitorHand: [],
      alliance: null,
      specialFactionState: {},   // faction-specific flags, e.g. gesserit.predictedFaction
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
