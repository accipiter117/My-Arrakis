// js/choam.js
//
// CHOAM (CHOAM & Richese rulebook, expansion plan M5). Advanced rules are
// always on, so Inflation, Forces and the Auditor are always in play.
//
//   Charity: before anyone collects, CHOAM takes 2 spice per faction in the
//   game from the Bank. Other factions' charity is paid from CHOAM's spice.
//   Treachery: hand limit 5. At the end of any phase CHOAM may discard
//   duplicates of the same card for 3 spice each, and worthless cards for 2
//   each or for a special effect (Baliset, Jubba Cloak, Kull Wahad, Kulon,
//   La La La, Trip to Gamont).
//   Revival: no free revival, no limit, 1 spice a force (js/revivalEngine.js).
//   Inflation: at the Mentat Pause, place the token Double or Cancel for next
//   turn's Charity; flip it the Mentat Pause after; then it leaves the game.
//   Forces: half (rounded down) of the spice others pay for forces in battle
//   goes to CHOAM, none if a traitor is revealed.
//   Auditor: after a battle it led, CHOAM sees 2 random cards of the opponent
//   (1 if the Auditor died), unless the opponent pays 1 spice per card.
//   Alliance: one two-way card trade with the ally per turn, at the end of
//   any phase; CHOAM may pay for some or all of the ally's forces in battle.

import { random } from './random.js';

export const WORTHLESS_EFFECT_CARDS = ['baliset', 'jubbaCloak', 'kullWahad', 'kulon', 'laLaLa', 'tripToGamont'];
export const EFFECT_TEXT = {
  baliset: 'Baliset: a player may not move into a territory CHOAM occupies this turn (shipping in is allowed)',
  jubbaCloak: 'Jubba Cloak: CHOAM forces in one territory survive this storm',
  kullWahad: 'Kull Wahad: a player may not play Karama this phase',
  kulon: 'Kulon: CHOAM forces move one extra territory this turn',
  laLaLa: 'La La La: a player may not take free revival this turn',
  tripToGamont: 'Trip to Gamont: one force of another player goes back to their reserves'
};
// The moment each worthless card's effect can be used.
export const EFFECT_WINDOW = { baliset: 'shipment', jubbaCloak: 'storm', kullWahad: 'karama', kulon: 'shipment', laLaLa: 'revival', tripToGamont: 'mentatPause' };

export const choamSeated = state => Boolean(state.factions.choam);

export function initChoamEffects(state) {
  if (!state.choamEffects) state.choamEffects = { baliset: [], jubbaCloak: null, kullWahad: [], kulon: false, laLaLa: [] };
  return state.choamEffects;
}

// --- Charity -----------------------------------------------------------------

export function inflationStatus(state) {
  return state.factions.choam?.specialFactionState?.inflation?.status ?? 'unused';
}

// CHOAM's own collection, before anyone else collects. Returns the amount.
export function collectChoamCharity(state) {
  if (!choamSeated(state)) return 0;
  const status = inflationStatus(state);
  if (status === 'cancel') return 0;
  const amount = 2 * Object.keys(state.factions).length * (status === 'double' ? 2 : 1);
  state.factions.choam.spice += amount;
  state.spiceBank.totalInCirculation -= amount;
  return amount;
}

// --- Inflation (Mentat Pause) ---------------------------------------------------

// Already placed: flip it, or remove it if it has been flipped. Returns what happened.
export function advanceInflation(state) {
  const inf = state.factions.choam?.specialFactionState?.inflation;
  if (!inf || (inf.status !== 'double' && inf.status !== 'cancel')) return null;
  if (inf.flipped) { inf.status = 'removed'; return 'removed'; }
  inf.status = inf.status === 'double' ? 'cancel' : 'double';
  inf.flipped = true;
  return inf.status;
}

export function placeInflation(state, side) {
  if (!['double', 'cancel'].includes(side) || inflationStatus(state) !== 'unused') return false;
  const sfs = state.factions.choam.specialFactionState ??= {};
  sfs.inflation = { status: side, flipped: false };
  return true;
}

// --- Treachery: duplicates and worthless cards ------------------------------------

const nameOf = (cardLookup, id) => cardLookup[id]?.name ?? id;

// Cards CHOAM may discard as duplicates (every copy after the first of an identical card).
export function duplicateSurplus(state, cardLookup) {
  const seen = new Set(), surplus = [];
  for (const id of state.factions.choam?.treacheryHand ?? []) {
    const n = nameOf(cardLookup, id);
    if (seen.has(n)) surplus.push(id); else seen.add(n);
  }
  return surplus;
}

export function worthlessInHand(state, cardLookup) {
  return (state.factions.choam?.treacheryHand ?? []).filter(id => cardLookup[id]?.category === 'worthless');
}

function discardFromChoam(state, cardId) {
  const hand = state.factions.choam.treacheryHand;
  if (!hand.includes(cardId)) return false;
  state.factions.choam.treacheryHand = hand.filter(c => c !== cardId);
  state.decks.treacheryDiscard.push(cardId);
  return true;
}

// Discard for spice: 3 for a duplicate, 2 for a worthless card.
export function discardForSpice(state, cardId, cardLookup) {
  const dup = duplicateSurplus(state, cardLookup).includes(cardId);
  const worthless = cardLookup[cardId]?.category === 'worthless';
  if (!dup && !worthless) return 0;
  if (!discardFromChoam(state, cardId)) return 0;
  const amount = dup ? 3 : 2;
  state.factions.choam.spice += amount;
  state.spiceBank.totalInCirculation -= amount;
  return amount;
}

// Play a worthless card for its effect (the caller checks the moment is right).
export function playWorthlessEffect(state, cardId, args = {}) {
  if (!WORTHLESS_EFFECT_CARDS.includes(cardId) || !discardFromChoam(state, cardId)) return null;
  const fx = initChoamEffects(state);
  if (cardId === 'baliset') fx.baliset.push({ factionId: args.factionId, territoryId: args.territoryId });
  if (cardId === 'jubbaCloak') fx.jubbaCloak = args.territoryId;
  if (cardId === 'kullWahad') fx.kullWahad.push(args.factionId);
  if (cardId === 'kulon') fx.kulon = true;
  if (cardId === 'laLaLa') fx.laLaLa.push(args.factionId);
  if (cardId === 'tripToGamont') {
    const f = state.factions[args.factionId];
    if ((f?.forces.onBoard[args.territoryId] ?? 0) > 0) {
      const starredHere = f.forces.starredOnBoard?.[args.territoryId] ?? 0;
      const ordinaryHere = f.forces.onBoard[args.territoryId] - starredHere;
      f.forces.onBoard[args.territoryId] -= 1;
      if (!f.forces.onBoard[args.territoryId]) delete f.forces.onBoard[args.territoryId];
      if (ordinaryHere > 0 || !starredHere) f.forces.reserve += 1;
      else { // only elite forces there: an elite force goes home
        f.forces.starredOnBoard[args.territoryId] -= 1;
        if (!f.forces.starredOnBoard[args.territoryId]) delete f.forces.starredOnBoard[args.territoryId];
        f.forces.reserve += 1; f.forces.starredReserve = (f.forces.starredReserve ?? 0) + 1;
      }
    }
  }
  return { cardId, ...args };
}

// Effects that last for a phase or a turn.
export function clearPhaseEffects(state, phase) {
  const fx = state.choamEffects;
  if (!fx) return;
  fx.kullWahad = [];
  if (phase === 'storm') fx.jubbaCloak = null;
  if (phase === 'shipment') { fx.baliset = []; fx.kulon = false; }
  if (phase === 'revival') fx.laLaLa = [];
}

export function balisetBlocks(state, factionId, territoryId) {
  return (state.choamEffects?.baliset ?? []).some(b => b.factionId === factionId && b.territoryId === territoryId);
}

// --- Forces in battle ------------------------------------------------------------

// Half (rounded down) of what another faction paid for its forces goes to CHOAM
// instead of the Bank. Call after the payment reached the Bank.
export function takeForcesShare(state, payerId, amount) {
  if (!choamSeated(state) || payerId === 'choam' || amount <= 0) return 0;
  const share = Math.floor(amount / 2);
  state.spiceBank.totalInCirculation -= share;
  state.factions.choam.spice += share;
  return share;
}

// --- Auditor ---------------------------------------------------------------------

// Cards the Auditor would see: 2 if it survived, 1 if killed, never more than
// the opponent holds (cards used in that battle are already gone from the hand).
export function auditSize(state, opponentId, auditorSurvived) {
  return Math.min(auditorSurvived ? 2 : 1, state.factions[opponentId].treacheryHand.length);
}

export function performAudit(state, opponentId, count, rng = random) {
  const hand = state.factions[opponentId].treacheryHand.slice();
  const seen = [];
  while (seen.length < count && hand.length) seen.push(hand.splice(Math.floor(rng() * hand.length), 1)[0]);
  // Private to CHOAM: what it saw, and when.
  const sfs = state.factions.choam.specialFactionState ??= {};
  sfs.audits = [...(sfs.audits ?? []), { turn: state.meta.turn, factionId: opponentId, cards: seen }];
  return seen;
}

export function payToCancelAudit(state, opponentId, count) {
  const f = state.factions[opponentId];
  if (f.spice < count) return false;
  f.spice -= count;
  state.factions.choam.spice += count;
  return true;
}

// --- Alliance --------------------------------------------------------------------

export function swapCards(state, a, cardA, b, cardB) {
  const fa = state.factions[a], fb = state.factions[b];
  if (!fa.treacheryHand.includes(cardA) || !fb.treacheryHand.includes(cardB)) return false;
  fa.treacheryHand = [...fa.treacheryHand.filter(c => c !== cardA), cardB];
  fb.treacheryHand = [...fb.treacheryHand.filter(c => c !== cardB), cardA];
  return true;
}
