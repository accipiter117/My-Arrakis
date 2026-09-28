// js/richeseCards.js
//
// The Richese cache cards (card texts from treachery.online, project owner's
// decision). Battle cards (Mirror Weapon, Portable Snooper, Stone Burner,
// Residual Poison) are resolved in the battle runner and js/battleEngine.js;
// this module holds the rest and the shared helpers.
//
//   Distrans: give another player a card from your hand (their hand permitting).
//   Juice of Sapho: be the aggressor in a battle, or go first or last in a
//     phase that uses turn order (here: Shipment and Movement).
//   Ornithopter: as your movement, move one group up to 3 territories, or two
//     groups at your normal range.
//   Nullentropy Box: pay 2 spice, take any card from the discard pile, shuffle
//     the pile, and this card goes on top (never another Nullentropy Box).
//   Semuta Drug: take a card into your hand just after another player discards it.
//   Residual Poison: before plans, kill one of the opponent's available leaders
//     at random; no spice for it.
// All are discarded after use.

import { handLimitFor } from './biddingEngine.js';
import { random } from './random.js';
import { killLeader } from './battleEngine.js';

const hand = (state, f) => state.factions[f].treacheryHand;
export const holds = (state, f, id) => hand(state, f).includes(id);
const roomFor = (state, f) => hand(state, f).length < handLimitFor(f);

function discard(state, f, id) {
  state.factions[f].treacheryHand = hand(state, f).filter(c => c !== id);
  state.decks.treacheryDiscard.push(id);
}

export function canDistrans(state, f, targetId, cardId) {
  if (!holds(state, f, 'distrans')) return { ok: false, reason: 'You do not hold Distrans.' };
  if (targetId === f || !state.factions[targetId]) return { ok: false, reason: 'Choose another player.' };
  if (cardId === 'distrans' || !holds(state, f, cardId)) return { ok: false, reason: 'Choose another card from your hand.' };
  if (!roomFor(state, targetId)) return { ok: false, reason: 'Their hand is full.' };
  return { ok: true };
}
export function playDistrans(state, f, targetId, cardId) {
  if (!canDistrans(state, f, targetId, cardId).ok) return null;
  discard(state, f, 'distrans');
  state.factions[f].treacheryHand = hand(state, f).filter(c => c !== cardId);
  hand(state, targetId).push(cardId);
  return { factionId: f, targetId, cardId };
}

export function nullentropyChoices(state) {
  return [...new Set(state.decks.treacheryDiscard.filter(c => c !== 'nullentropyBox'))];
}
export function playNullentropy(state, f, cardId, rng = random) {
  if (!holds(state, f, 'nullentropyBox') || state.factions[f].spice < 2) return null;
  const pile = state.decks.treacheryDiscard;
  const i = pile.indexOf(cardId);
  if (i < 0 || cardId === 'nullentropyBox') return null;
  state.factions[f].spice -= 2;
  state.spiceBank.totalInCirculation += 2;
  pile.splice(i, 1);
  state.factions[f].treacheryHand = hand(state, f).filter(c => c !== 'nullentropyBox');
  hand(state, f).push(cardId);
  for (let k = pile.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [pile[k], pile[j]] = [pile[j], pile[k]]; }
  pile.push('nullentropyBox'); // on top of the shuffled pile
  return { factionId: f };
}

// Semuta Drug: cards other players discarded since the holder was last offered.
export function semutaChoices(state, f) {
  const mark = state.meta.semutaMark ?? { length: 0, mine: [] };
  const pile = state.decks.treacheryDiscard;
  const fresh = pile.length >= mark.length ? pile.slice(mark.length) : pile.slice();
  return fresh.filter(c => !mark.mine.includes(c) && c !== 'semutaDrug');
}
export function markSemuta(state, f) {
  state.meta.semutaMark = { length: state.decks.treacheryDiscard.length, mine: f ? hand(state, f).slice() : [] };
}
export function playSemuta(state, f, cardId) {
  if (!holds(state, f, 'semutaDrug') || !semutaChoices(state, f).includes(cardId)) return null;
  const pile = state.decks.treacheryDiscard;
  pile.splice(pile.lastIndexOf(cardId), 1);
  discard(state, f, 'semutaDrug');
  hand(state, f).push(cardId);
  return { factionId: f, cardId };
}

export function playResidualPoison(state, f, opponentId, rng = random) {
  if (!holds(state, f, 'residualPoison')) return null;
  const pool = state.factions[opponentId].leaders.available.filter(id => !state.battle?.leaderTerritory?.[id]);
  discard(state, f, 'residualPoison');
  if (!pool.length) return { factionId: f, opponentId, leaderId: null };
  const leaderId = pool[Math.floor(rng() * pool.length)];
  killLeader(state, opponentId, leaderId, 0); // no spice is collected for it
  return { factionId: f, opponentId, leaderId };
}

export function useCard(state, f, id) { if (holds(state, f, id)) { discard(state, f, id); return true; } return false; }
