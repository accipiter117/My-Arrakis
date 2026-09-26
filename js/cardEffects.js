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
// Weather Control and Family Atomics (need the storm's sector data). Until they work, their holder
// may discard them so they don't sit dead in a hand. A temporary
// implementation decision (data/rulesConfig.json: unbuiltCardDiscard).
export const UNBUILT_CARDS = ['weatherControl', 'familyAtomics'];

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

// --- Truthtrance --------------------------------------------------------------
// Ask one other player a yes/no question; they must answer publicly and
// truthfully. Digitally, only factual questions the game can answer:
//   { kind: 'holdsCategory', category }  do you hold this kind of card?
//   { kind: 'isTraitor', leaderId }      is this leader of mine your traitor?
//   { kind: 'spiceAtLeast', amount }     do you have at least N spice?
// The engine answers from the real state, so the answer is always true.
const TRUTH_CARDS = ['truthtrance1', 'truthtrance2'];

export function answerTruthtrance(state, targetId, question, cardLookup) {
  const t = state.factions[targetId];
  if (question.kind === 'holdsCategory') return t.treacheryHand.some(id => cardLookup[id]?.category === question.category);
  if (question.kind === 'isTraitor') return (t.traitorHand ?? []).includes(question.leaderId);
  if (question.kind === 'spiceAtLeast') return t.spice >= question.amount;
  throw new Error('Unknown Truthtrance question.');
}

export function canPlayTruthtrance(state, askerId, targetId) {
  if (!TRUTH_CARDS.some(id => holds(state, askerId, id))) return { ok: false, reason: 'You do not hold a Truthtrance.' };
  if (!state.factions[targetId] || targetId === askerId) return { ok: false, reason: 'Ask another player.' };
  return { ok: true };
}

export function playTruthtrance(state, askerId, targetId, question, cardLookup) {
  const check = canPlayTruthtrance(state, askerId, targetId);
  if (!check.ok) throw new Error(check.reason);
  discard(state, askerId, TRUTH_CARDS.find(id => holds(state, askerId, id)));
  const record = { turn: state.meta.turn, asker: askerId, target: targetId, question, answer: answerTruthtrance(state, targetId, question, cardLookup) };
  state.meta.truths = [...(state.meta.truths ?? []), record]; // public: everyone heard it
  return record;
}

// --- Karama --------------------------------------------------------------------
// Built: its core use, cancelling a faction advantage at the moment it is
// used against you (the Voice, Prescience, a Harkonnen capture). Not yet:
// each faction's once-per-game advanced Karama power.
const KARAMA_CARDS = ['karama1', 'karama2'];

export function holdsKarama(state, factionId) {
  return KARAMA_CARDS.some(id => holds(state, factionId, id));
}

export function playKarama(state, factionId, purpose) {
  if (!holdsKarama(state, factionId)) throw new Error('You do not hold a Karama.');
  discard(state, factionId, KARAMA_CARDS.find(id => holds(state, factionId, id)));
  const record = { turn: state.meta.turn, factionId, purpose };
  state.meta.karamas = [...(state.meta.karamas ?? []), record];
  return record;
}
