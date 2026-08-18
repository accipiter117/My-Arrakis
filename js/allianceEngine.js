// allianceEngine.js
//
// Alliances form and break only during an active Nexus (state.nexus.active,
// set by spiceEngine.js after a post-turn-1 Shai-Hulud draw). Victory
// checking for alliances is already handled in victoryEngine.js, this
// module covers forming/breaking and the mechanical constraints alliances
// impose elsewhere (movement, the post-formation overlap rule).
//
// Deliberately NOT covered here, flagged rather than silently skipped:
// the long list of faction-specific "Shared Advantages" alliances grant
// (Bene Gesserit protecting an ally from worms, Emperor paying for an
// ally's revival, Guild shipping allies at half price, Atreides forcing
// an ally's opponent to reveal a Battle Plan element, Harkonnen's traitor
// cards usable against an ally's opponent, allies covering each other's
// bidding/shipment costs). Each of those lives inside a different phase
// engine and needs its own hook, this file only builds the alliance
// relationship itself and the constraints that apply regardless of which
// factions are involved. See docs/ALLIANCE_TODO.md for the full list.

function getAllianceFor(state, factionId) {
  return (state.alliances ?? []).find(a => a.factions.includes(factionId)) ?? null;
}

function isFactionAllied(state, factionId) {
  return getAllianceFor(state, factionId) !== null;
}

// --- Forming ---------------------------------------------------------

function canFormAlliance(state, factionAId, factionBId) {
  if (!state.nexus.active) {
    return { ok: false, reason: 'Alliances can only be formed during an active Nexus.' };
  }
  if (factionAId === factionBId) {
    return { ok: false, reason: 'A faction cannot ally with itself.' };
  }
  if (!state.factions[factionAId] || !state.factions[factionBId]) {
    return { ok: false, reason: 'Both factions must actually be in the game.' };
  }
  if (isFactionAllied(state, factionAId)) {
    return { ok: false, reason: `${factionAId} is already in an alliance, no player can be a member of more than one.` };
  }
  if (isFactionAllied(state, factionBId)) {
    return { ok: false, reason: `${factionBId} is already in an alliance, no player can be a member of more than one.` };
  }
  return { ok: true };
}

function formAlliance(state, factionAId, factionBId) {
  const check = canFormAlliance(state, factionAId, factionBId);
  if (!check.ok) throw new Error(check.reason);

  state.alliances.push({ factions: [factionAId, factionBId], formedTurn: state.meta.turn });
  return { factions: [factionAId, factionBId] };
}

// --- Breaking ----------------------------------------------------------

function canBreakAlliance(state, factionId) {
  if (!state.nexus.active) {
    return { ok: false, reason: 'Alliances can only be broken during an active Nexus.' };
  }
  if (!isFactionAllied(state, factionId)) {
    return { ok: false, reason: `${factionId} is not currently in an alliance.` };
  }
  return { ok: true };
}

function breakAlliance(state, factionId) {
  const check = canBreakAlliance(state, factionId);
  if (!check.ok) throw new Error(check.reason);

  const alliance = getAllianceFor(state, factionId);
  state.alliances = state.alliances.filter(a => a !== alliance);
  // Per the rulebook, a faction that just broke off may immediately form
  // or join a new alliance in the same Nexus, canFormAlliance() already
  // permits this since the faction is no longer flagged as allied.
  return { brokenAlliance: alliance.factions };
}

// --- Post-formation same-territory conflict (rulebook Q&A) ---------------

// If two factions became allies last turn and both occupy the same
// non-Polar-Sink territory at the start of Shipment & Movement, one of
// them must move out during that phase. Call this at the START of the
// phase to detect violations, and again at the END to enforce the penalty
// on whichever faction (in turn order) failed to move out.
function findAllyOverlapViolations(state) {
  const violations = [];
  for (const alliance of state.alliances) {
    const [factionAId, factionBId] = alliance.factions;
    const territoriesA = Object.keys(state.factions[factionAId].forces.onBoard);
    const territoriesB = Object.keys(state.factions[factionBId].forces.onBoard);
    const shared = territoriesA.filter(t => territoriesB.includes(t) && t !== 'polarSink');
    for (const territoryId of shared) {
      violations.push({ factionAId, factionBId, territoryId });
    }
  }
  return violations;
}

// Called at the END of the Shipment & Movement phase. Any violation still
// present means neither ally moved out voluntarily; per the rulebook, the
// SECOND faction in turn order loses those forces to the Tleilaxu Tanks.
function enforceAllyOverlapPenalty(state, turnOrder, violation) {
  const { factionAId, factionBId, territoryId } = violation;
  const stillOverlapping =
    (state.factions[factionAId].forces.onBoard[territoryId] ?? 0) > 0 &&
    (state.factions[factionBId].forces.onBoard[territoryId] ?? 0) > 0;

  if (!stillOverlapping) return null; // one of them already moved out, resolved naturally

  const orderedPair = turnOrder.filter(id => id === factionAId || id === factionBId);
  const secondToAct = orderedPair[1];
  const faction = state.factions[secondToAct];
  const lost = faction.forces.onBoard[territoryId] ?? 0;

  faction.revivalTanks = (faction.revivalTanks ?? 0) + lost;
  delete faction.forces.onBoard[territoryId];
  if (faction.forces.starredOnBoard) delete faction.forces.starredOnBoard[territoryId];

  return { penalizedFactionId: secondToAct, territoryId, forcesLost: lost };
}

module.exports = {
  getAllianceFor,
  isFactionAllied,
  canFormAlliance,
  formAlliance,
  canBreakAlliance,
  breakAlliance,
  findAllyOverlapViolations,
  enforceAllyOverlapPenalty
};
