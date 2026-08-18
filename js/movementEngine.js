// movementEngine.js
//
// Phase 6: Shipment and Movement. Same discipline as biddingEngine.js:
// every action goes through a canX() validator before an executeX() mutator,
// and the AI calls the identical functions a human action would.
//
// Storm-sector blocking (no ship/move into, out of, or through a storm
// sector) is deliberately stubbed via an injected callback rather than
// hardcoded, since sector data isn't finalized yet. Once it is, wiring in
// a real isSectorInStorm(territoryId, sector) implementation is a one-line
// change at each of the two TODO markers below, not a redesign.

const ORNITHOPTER_STRONGHOLDS = ['arrakeen', 'carthag'];

// --- Shared helpers --------------------------------------------------------

function hasOrnithopterAccess(state, factionId) {
  return ORNITHOPTER_STRONGHOLDS.some(strongholdId =>
    (state.factions[factionId].forces.onBoard[strongholdId] ?? 0) > 0
  );
}

function moveRangeFor(state, factionId) {
  const hasOrnithopters = hasOrnithopterAccess(state, factionId);
  const isFremen = factionId === 'fremen';

  if (hasOrnithopters) return 3; // rulebook doesn't specify Fremen+ornithopter stacking beyond this, see notes.md
  if (isFremen) return 2;
  return 1;
}

function isStrongholdBlocked(state, territoryId, movingFactionId) {
  const territoryType = state.board.territories[territoryId]?.type;
  if (territoryType !== 'stronghold') return false;

  const occupants = Object.keys(state.factions).filter(fid =>
    fid !== movingFactionId && (state.factions[fid].forces.onBoard[territoryId] ?? 0) > 0
  );
  return occupants.length >= 2;
}

// Returns every territory reachable within `maxHops` adjacency steps,
// respecting the stronghold-block rule at each step. Sector/storm blocking
// is NOT yet applied here, see isSectorInStormCheck TODO below.
function reachableTerritories(state, factionId, fromTerritoryId, maxHops) {
  const territories = state.board.territories;
  const visited = new Set([fromTerritoryId]);
  let frontier = [fromTerritoryId];

  for (let hop = 0; hop < maxHops; hop++) {
    const nextFrontier = [];
    for (const current of frontier) {
      const neighbors = territories[current]?.adjacentDraft ?? [];
      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;
        if (isStrongholdBlocked(state, neighbor, factionId)) continue;
        // TODO: skip `neighbor` here if isSectorInStormCheck(neighbor) once
        // sector data and a real storm position exist on state.board.
        visited.add(neighbor);
        nextFrontier.push(neighbor);
      }
    }
    frontier = nextFrontier;
  }

  visited.delete(fromTerritoryId);
  return Array.from(visited);
}

// --- Shipment ---------------------------------------------------------

function shipmentCostPerForce(state, factionId, destinationTerritoryId) {
  const isStronghold = state.board.territories[destinationTerritoryId]?.type === 'stronghold';
  const baseCost = isStronghold
    ? state.rulesConfig.official.shippingCostPerForce.toStronghold
    : state.rulesConfig.official.shippingCostPerForce.toOtherTerritory;

  if (factionId === 'guild') {
    return baseCost * state.rulesConfig.official.guildShippingDiscount;
  }

  // Fremen ship free onto the Great Flat or within two territories of it,
  // per their faction ability. Exact-range check needs the territory graph
  // distance from 'theGreatFlat', using the same reachableTerritories() BFS
  // at radius 2 rather than a hardcoded list.
  if (factionId === 'fremen') {
    const freeZone = new Set([
      'theGreatFlat',
      ...reachableTerritories(state, factionId, 'theGreatFlat', 2)
    ]);
    if (freeZone.has(destinationTerritoryId)) return 0;
  }

  return baseCost;
}

function canShip(state, factionId, destinationTerritoryId, amount) {
  if (amount <= 0) return { ok: false, reason: 'Shipment amount must be positive.' };
  if ((state.factions[factionId].forces.reserve ?? 0) < amount) {
    return { ok: false, reason: 'Not enough forces in reserve.' };
  }
  if (isStrongholdBlocked(state, destinationTerritoryId, factionId)) {
    return { ok: false, reason: 'Stronghold already occupied by two other factions.' };
  }
  // TODO: return { ok: false, reason: 'Destination sector is in storm.' }
  // once isSectorInStormCheck(destinationTerritoryId) is real.

  const costPerForce = shipmentCostPerForce(state, factionId, destinationTerritoryId);
  const totalCost = costPerForce * amount;
  if (totalCost > state.factions[factionId].spice) {
    return { ok: false, reason: 'Not enough spice for this shipment.' };
  }
  return { ok: true, totalCost };
}

function executeShipment(state, factionId, destinationTerritoryId, amount) {
  const check = canShip(state, factionId, destinationTerritoryId, amount);
  if (!check.ok) throw new Error(check.reason);

  state.factions[factionId].spice -= check.totalCost;
  state.factions[factionId].forces.reserve -= amount;
  state.factions[factionId].forces.onBoard[destinationTerritoryId] =
    (state.factions[factionId].forces.onBoard[destinationTerritoryId] ?? 0) + amount;

  // Guild collects payment directly rather than the bank, per their ability.
  if (factionId !== 'guild' && state.factions.guild && check.totalCost > 0) {
    // Only applies if Guild is actually the one shipping the player in,
    // i.e. always true for any off-planet shipment while Guild is in the game.
    state.factions.guild.spice += check.totalCost;
  } else {
    state.spiceBank.totalInCirculation -= check.totalCost;
  }

  // Bene Gesserit: free 1-force shipment into the Polar Sink whenever any
  // OTHER faction ships from off-planet. Reactive trigger, not yet auto-fired
  // here since it needs a "does BG want to use it" decision point for the
  // AI/human layer, flagged rather than silently applied.
  // TODO: expose this as a triggered opportunity after executeShipment
  // resolves, when state.factions.gesserit exists and factionId !== 'gesserit'.

  return state;
}

// --- Movement -----------------------------------------------------------

function canMove(state, factionId, fromTerritoryId, toTerritoryId, amount) {
  if (amount <= 0) return { ok: false, reason: 'Move amount must be positive.' };
  if ((state.factions[factionId].forces.onBoard[fromTerritoryId] ?? 0) < amount) {
    return { ok: false, reason: 'Not enough forces in the origin territory.' };
  }
  if (state.factions[factionId].hasMovedThisTurn) {
    return { ok: false, reason: 'Only one force move is allowed per faction per turn.' };
  }

  const range = moveRangeFor(state, factionId);
  const reachable = reachableTerritories(state, factionId, fromTerritoryId, range);
  if (!reachable.includes(toTerritoryId)) {
    return { ok: false, reason: `${toTerritoryId} is not reachable within this faction's movement range.` };
  }

  // TODO: block if toTerritoryId is occupied by an allied faction's forces
  // and toTerritoryId isn't the Polar Sink, once alliance state is wired.

  return { ok: true };
}

function executeMove(state, factionId, fromTerritoryId, toTerritoryId, amount) {
  const check = canMove(state, factionId, fromTerritoryId, toTerritoryId, amount);
  if (!check.ok) throw new Error(check.reason);

  state.factions[factionId].forces.onBoard[fromTerritoryId] -= amount;
  if (state.factions[factionId].forces.onBoard[fromTerritoryId] === 0) {
    delete state.factions[factionId].forces.onBoard[fromTerritoryId];
  }
  state.factions[factionId].forces.onBoard[toTerritoryId] =
    (state.factions[factionId].forces.onBoard[toTerritoryId] ?? 0) + amount;
  state.factions[factionId].hasMovedThisTurn = true;

  return state;
}

function resetTurnMovementFlags(state) {
  for (const factionId of Object.keys(state.factions)) {
    state.factions[factionId].hasMovedThisTurn = false;
  }
  return state;
}

module.exports = {
  hasOrnithopterAccess,
  moveRangeFor,
  isStrongholdBlocked,
  reachableTerritories,
  shipmentCostPerForce,
  canShip,
  executeShipment,
  canMove,
  executeMove,
  resetTurnMovementFlags
};
