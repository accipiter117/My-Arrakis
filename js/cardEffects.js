// js/cardEffects.js
//
// Treachery cards with effects outside the battle wheel. Same pattern as
// every other engine: canPlayX() validates, playX() applies and discards.
//
// Built: Hajr, Ghola.
// Not yet: Weather Control and Family Atomics (need storm/sector data),
// Karama (faction-specific powers), Truthtrance (a yes/no question that
// needs a way for the answering faction to reply truthfully).

import * as movementEngine from './movementEngine.js';

function holds(state, factionId, cardId) {
  return (state.factions[factionId]?.treacheryHand ?? []).includes(cardId);
}

function discard(state, factionId, cardId) {
  const faction = state.factions[factionId];
  faction.treacheryHand = faction.treacheryHand.filter(id => id !== cardId);
  state.decks.treacheryDiscard.push(cardId);
}

// --- Hajr: one extra force move this Movement phase ---------------------

export function canPlayHajr(state, factionId, move) {
  if (!holds(state, factionId, 'hajr')) return { ok: false, reason: 'You do not hold Hajr.' };
  if (!state.factions[factionId].hasMovedThisTurn) {
    return { ok: false, reason: 'Hajr is an extra move, make your normal move first.' };
  }
  // Check the move as if it were a fresh one, then restore the flag.
  state.factions[factionId].hasMovedThisTurn = false;
  const check = movementEngine.canMove(state, factionId, move.from, move.to, move.amount);
  state.factions[factionId].hasMovedThisTurn = true;
  return check;
}

export function playHajr(state, factionId, move) {
  const check = canPlayHajr(state, factionId, move);
  if (!check.ok) throw new Error(check.reason);
  state.factions[factionId].hasMovedThisTurn = false;
  movementEngine.executeMove(state, factionId, move.from, move.to, move.amount);
  discard(state, factionId, 'hajr');
  return { factionId, card: 'hajr', ...move };
}

// --- Ghola: free revival of one leader, or up to 5 forces -----------------

export function canPlayGhola(state, factionId, choice) {
  const faction = state.factions[factionId];
  if (!holds(state, factionId, 'ghola')) return { ok: false, reason: 'You do not hold Ghola.' };
  if (choice.leaderId) {
    if (!faction.leaders.killed.includes(choice.leaderId)) return { ok: false, reason: 'That leader is not in the tanks.' };
    return { ok: true };
  }
  const forces = choice.forces ?? 0;
  if (forces < 1 || forces > 5) return { ok: false, reason: 'Ghola revives 1 to 5 forces.' };
  if (forces > (faction.revivalTanks ?? 0)) return { ok: false, reason: 'Not that many forces in the tanks.' };
  return { ok: true };
}

export function playGhola(state, factionId, choice) {
  const check = canPlayGhola(state, factionId, choice);
  if (!check.ok) throw new Error(check.reason);
  const faction = state.factions[factionId];
  if (choice.leaderId) {
    faction.leaders.killed = faction.leaders.killed.filter(id => id !== choice.leaderId);
    faction.leaders.available.push(choice.leaderId);
  } else {
    // Ordinary forces first; any beyond the ordinary count come from starred.
    const ordinaryInTanks = (faction.revivalTanks ?? 0) - (faction.starredRevivalTanks ?? 0);
    const starred = Math.max(0, choice.forces - ordinaryInTanks);
    faction.revivalTanks -= choice.forces;
    faction.forces.reserve += choice.forces;
    if (starred > 0) {
      faction.starredRevivalTanks -= starred;
      faction.forces.starredReserve = (faction.forces.starredReserve ?? 0) + starred;
    }
  }
  discard(state, factionId, 'ghola');
  return { factionId, card: 'ghola', ...choice };
}

// --- Cards whose effects aren't built yet ------------------------------------
// Karama and Truthtrance (effects not yet implemented), Weather Control and
// Family Atomics (need the storm's sector data). Until they work, their holder
// may discard them so they don't sit dead in a hand. A temporary
// implementation decision (data/rulesConfig.json: unbuiltCardDiscard).
export const UNBUILT_CARDS = ['karama1', 'karama2', 'truthtrance1', 'truthtrance2', 'weatherControl', 'familyAtomics'];

export function canDiscardUnbuilt(state, factionId, cardId) {
  if (!UNBUILT_CARDS.includes(cardId)) return { ok: false, reason: 'Only cards whose effects are not in the game yet can be discarded freely.' };
  if (!holds(state, factionId, cardId)) return { ok: false, reason: 'You do not hold that card.' };
  return { ok: true };
}

export function discardUnbuilt(state, factionId, cardId) {
  const check = canDiscardUnbuilt(state, factionId, cardId);
  if (!check.ok) throw new Error(check.reason);
  discard(state, factionId, cardId);
  return { factionId, cardId };
}
