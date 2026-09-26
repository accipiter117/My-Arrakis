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

  if (hasOrnithopters) return 3; // capped at 3 even for Fremen; desert knowledge doesn't make the 'thopter fly faster, confirmed ruling
  if (isFremen) return 2;
  return 1;
}

function allyOf(state, factionId) {
  return (state.alliances ?? []).find(a => a.factions.includes(factionId))?.factions.find(f => f !== factionId) ?? null;
}

// Allies may never share a territory, except the Polar Sink.
function allyOccupies(state, factionId, territoryId) {
  if (territoryId === 'polarSink') return false;
  const ally = allyOf(state, factionId);
  return Boolean(ally && (state.factions[ally]?.forces.onBoard[territoryId] ?? 0) > 0);
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

  // The Guild ships at half price, and so does the Guild's ally (alliance advantage).
  if (factionId === 'guild' || allyOf(state, factionId) === 'guild') {
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
  if (allyOccupies(state, factionId, destinationTerritoryId)) {
    return { ok: false, reason: 'Your ally already has forces there; allies may only share the Polar Sink.' };
  }
  // TODO: return { ok: false, reason: 'Destination sector is in storm.' }
  // once isSectorInStormCheck(destinationTerritoryId) is real.

  const costPerForce = shipmentCostPerForce(state, factionId, destinationTerritoryId);
  // Guild ships at half price, rounded up (rulebook), which is the only
  // way a fractional per-force rate appears. Rounding the TOTAL keeps
  // spice a whole number; without it the Guild accumulated half-spice.
  const totalCost = Math.ceil(costPerForce * amount);
  if (totalCost > state.factions[factionId].spice) {
    return { ok: false, reason: 'Not enough spice for this shipment.' };
  }
  return { ok: true, totalCost };
}

// Starred forces (Sardaukar, Fedaykin) ship first unless the caller asks
// for fewer: they are the strongest units, and an earlier version never
// shipped them at all, leaving them stranded in reserve all game.
function executeShipment(state, factionId, destinationTerritoryId, amount, starredRequested) {
  const check = canShip(state, factionId, destinationTerritoryId, amount);
  if (!check.ok) throw new Error(check.reason);

  const forces = state.factions[factionId].forces;
  const starred = Math.min(amount, forces.starredReserve ?? 0, starredRequested ?? amount);
  state.factions[factionId].spice -= check.totalCost;
  forces.reserve -= amount;
  forces.onBoard[destinationTerritoryId] = (forces.onBoard[destinationTerritoryId] ?? 0) + amount;
  if (starred > 0) {
    forces.starredReserve -= starred;
    forces.starredOnBoard[destinationTerritoryId] = (forces.starredOnBoard[destinationTerritoryId] ?? 0) + starred;
  }

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

  // Allies may not enter any territory (except the Polar Sink) in which
  // their ally already has a force, per the rulebook's alliance constraint.
  if (toTerritoryId !== 'polarSink') {
    const alliance = (state.alliances ?? []).find(a => a.factions.includes(factionId));
    if (alliance) {
      const allyId = alliance.factions.find(id => id !== factionId);
      if ((state.factions[allyId]?.forces.onBoard[toTerritoryId] ?? 0) > 0) {
        return { ok: false, reason: `Cannot move into ${toTerritoryId}, ally ${allyId} already has forces there.` };
      }
    }
  }

  return { ok: true };
}

function executeMove(state, factionId, fromTerritoryId, toTerritoryId, amount, starredRequested) {
  const check = canMove(state, factionId, fromTerritoryId, toTerritoryId, amount);
  if (!check.ok) throw new Error(check.reason);

  // Starred forces travel with the group (starred first by default), and
  // never more starred can stay behind than the forces that remain.
  const forces = state.factions[factionId].forces;
  const starredHere = forces.starredOnBoard?.[fromTerritoryId] ?? 0;
  const remaining = forces.onBoard[fromTerritoryId] - amount;
  const starred = Math.max(starredHere - remaining, Math.min(amount, starredHere, starredRequested ?? amount));
  if (starred > 0) {
    forces.starredOnBoard[fromTerritoryId] -= starred;
    if (forces.starredOnBoard[fromTerritoryId] <= 0) delete forces.starredOnBoard[fromTerritoryId];
    forces.starredOnBoard[toTerritoryId] = (forces.starredOnBoard[toTerritoryId] ?? 0) + starred;
  }

  state.factions[factionId].forces.onBoard[fromTerritoryId] -= amount;
  if (state.factions[factionId].forces.onBoard[fromTerritoryId] === 0) {
    delete state.factions[factionId].forces.onBoard[fromTerritoryId];
  }
  state.factions[factionId].forces.onBoard[toTerritoryId] =
    (state.factions[factionId].forces.onBoard[toTerritoryId] ?? 0) + amount;
  state.factions[factionId].hasMovedThisTurn = true;

  return state;
}

// --- Fremen worm riding ------------------------------------------------------
// After a Nexus, Fremen forces where a worm appeared may ride it to any one
// territory, subject to storm and occupancy. It happens in the Spice Blow
// phase and does not count as the Fremen's movement for the turn.

function canRideWorm(state, fromTerritoryId, toTerritoryId) {
  const fremen = state.factions.fremen;
  if (!fremen || !(fremen.forces.onBoard[fromTerritoryId] > 0)) return { ok: false, reason: 'No Fremen forces there to ride.' };
  if (!state.board.territories[toTerritoryId]) return { ok: false, reason: 'Unknown territory.' };
  if (toTerritoryId === fromTerritoryId) return { ok: false, reason: 'Already there.' };
  if (isStrongholdBlocked(state, toTerritoryId, 'fremen')) return { ok: false, reason: 'That stronghold already holds two other factions.' };
  if (allyOccupies(state, 'fremen', toTerritoryId)) return { ok: false, reason: 'Your ally already has forces there.' };
  // TODO: riders may not leave or enter a sector in storm, once sector data exists.
  return { ok: true };
}

function rideWorm(state, fromTerritoryId, toTerritoryId) {
  const check = canRideWorm(state, fromTerritoryId, toTerritoryId);
  if (!check.ok) throw new Error(check.reason);
  const forces = state.factions.fremen.forces;
  const amount = forces.onBoard[fromTerritoryId];
  const starred = forces.starredOnBoard?.[fromTerritoryId] ?? 0;
  delete forces.onBoard[fromTerritoryId];
  forces.onBoard[toTerritoryId] = (forces.onBoard[toTerritoryId] ?? 0) + amount;
  if (starred) {
    delete forces.starredOnBoard[fromTerritoryId];
    forces.starredOnBoard[toTerritoryId] = (forces.starredOnBoard[toTerritoryId] ?? 0) + starred;
  }
  return { from: fromTerritoryId, to: toTerritoryId, amount };
}

function resetTurnMovementFlags(state) {
  for (const factionId of Object.keys(state.factions)) {
    state.factions[factionId].hasMovedThisTurn = false;
  }
  return state;
}

export {
  canRideWorm,
  rideWorm,
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
