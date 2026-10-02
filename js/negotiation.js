// js/negotiation.js
//
// Deals and bribes between factions (GF9 Dune 2019, "Bribery"):
// - Only between factions NOT in the same alliance.
// - Deals are BINDING: once made they must be honoured (project owner's
//   decision: rulebook, no reneging). Promises are enforced by the engine
//   asking the helpers below and removing forbidden options.
// - Nothing that transfers treachery cards, leaders, forces or faction
//   advantages. That leaves spice, secret information and future actions.
// - Bribe spice goes in front of the receiver's shield and joins their
//   normal spice only at the start of the Mentat Pause (collectHeldSpice).
// - CHOAM Inflation on Double: no deals at all (project owner's decision:
//   all deals blocked, not only spice ones).
// - Sold information is always true (binding deals), and goes only to the
//   buyer. Terms of a deal are public (deals are stated aloud); the secret
//   itself is not.
//
// Windows (project owner's decision): start of Bidding, Nexus, start of
// Shipment and Movement, before battle plans.
//
// state.negotiation = {
//   offers:    [{ id, from, to, turn, phase, give, ask, status, counterOf }],
//   promises:  [{ id, by, to, type, ...params, turn, untilTurn, dealId, status }],
//   held:      { factionId: spice in front of shield },
//   knowledge: { factionId: [{ id, kind, about, value, turn, dealId }] },  // private
//   pitches:   { 'turn:factionId': count }   // AI pitch cap bookkeeping
// }

import { inflationStatus } from './choam.js';
import { random } from './random.js';

export const WINDOWS = ['bidding', 'nexus', 'shipment', 'battle'];
export const MAX_PROMISE_TURNS = 3;

export const SECRET_KINDS = ['cardPeek', 'traitor', 'noFieldValue', 'spiceTotal',
  'bgPrediction', 'stormCard', 'faceDancers', 'nextSpiceCard', 'resale'];

export const PROMISE_TYPES = ['noEnter', 'noAttack', 'noTraitorOn', 'bidPass', 'noBid', 'allianceAt'];

// --- State ----------------------------------------------------------------------

export function initNegotiation(state) {
  state.negotiation ??= { offers: [], promises: [], held: {}, knowledge: {}, pitches: {}, nextId: 1 };
  return state.negotiation;
}
const N = state => initNegotiation(state);
const newId = (state, prefix) => `${prefix}${N(state).nextId++}`;

export const heldSpice = (state, f) => N(state).held[f] ?? 0;
const allyOf = (state, f) => (state.alliances ?? []).find(a => a.factions.includes(f))?.factions.find(x => x !== f) ?? null;
const seated = (state, f) => Boolean(state.factions[f]);

// --- Who may deal ----------------------------------------------------------------

// Returns null when allowed, else a plain-language reason.
export function dealBlockedReason(state, a, b) {
  if (!seated(state, a) || !seated(state, b)) return 'That faction is not in this game.';
  if (a === b) return 'You cannot deal with yourself.';
  if (allyOf(state, a) === b) return 'Allies cannot make deals or bribes with each other.';
  if (inflationStatus(state) === 'double') return 'CHOAM Inflation is on Double: no deals this turn.';
  if (state.victory?.achieved) return 'The game is over.';
  return null;
}

// The engine opens a window, asks every faction, then closes it.
// ctx: { kind: 'bidding'|'nexus'|'shipment'|'battle', territoryId?, fighters? }
export function openWindow(state, ctx) {
  const n = N(state);
  n.windowSeq = (n.windowSeq ?? 0) + 1;
  n.activeWindow = { ...ctx, id: n.windowSeq, turn: state.meta.turn };
  return n.activeWindow;
}
export function closeWindow(state) {
  const n = N(state);
  lapseOpenOffers(state);
  n.activeWindow = null;
}
export const currentWindow = state => state.negotiation?.activeWindow ?? null;

// Each faction receives at most one new offer per window and two per turn
// (counters don't count). Keeps the AI from nagging.
export const RECEIVE_CAP = { perWindow: 1, perTurn: 2 };
export function canReceiveOffer(state, to) {
  const w = currentWindow(state);
  if (!w) return false;
  const mine = N(state).offers.filter(o => o.to === to && !o.counterOf && o.turn === state.meta.turn);
  return mine.filter(o => o.windowId === w.id).length < RECEIVE_CAP.perWindow && mine.length < RECEIVE_CAP.perTurn;
}

// --- Secrets ---------------------------------------------------------------------

// The secrets `seller` could sell to `buyer` right now: [{ kind, about?, entryId?, label }].
export function sellableSecrets(state, seller, buyer) {
  const f = state.factions[seller], out = [];
  if (!f) return out;
  if (f.treacheryHand?.length) out.push({ kind: 'cardPeek', label: 'A random card from my hand' });
  if (f.traitorHand?.length) out.push({ kind: 'traitor', label: f.traitorHand.length > 1 ? 'My traitors' : 'My traitor' });
  if (seller === 'richese' && f.noField?.onPlanet) out.push({ kind: 'noFieldValue', label: 'My No-Field token\'s value' });
  out.push({ kind: 'spiceTotal', label: 'How much spice I hold' });
  if (seller === 'gesserit' && f.specialFactionState?.prediction) out.push({ kind: 'bgPrediction', label: 'My prediction' });
  if (seller === 'fremen' && state.board?.nextStormCard != null) out.push({ kind: 'stormCard', label: 'Next storm movement' });
  if (seller === 'tleilaxu' && (f.specialFactionState?.faceDancers ?? f.faceDancers ?? []).some(fd => !fd.revealed))
    out.push({ kind: 'faceDancers', label: 'My Face Dancers' });
  // Atreides see the top spice card at the start of Movement; sellable from then until the turn ends.
  if (seller === 'atreides' && ['shipment', 'movement', 'battle', 'spiceCollection'].includes(state.meta.phase) && state.decks?.spiceDeck?.length)
    out.push({ kind: 'nextSpiceCard', label: 'The next spice card' });
  // Resale: anything I learned privately about a third faction.
  for (const k of N(state).knowledge[seller] ?? [])
    if (k.about !== buyer && k.about !== seller) out.push({ kind: 'resale', entryId: k.id, about: k.about, label: `What I learned about ${k.about} (turn ${k.turn})` });
  return out;
}

const faceDancersOf = state => {
  const t = state.factions.tleilaxu;
  return (t?.specialFactionState?.faceDancers ?? t?.faceDancers ?? []).filter(fd => !fd.revealed).map(fd => fd.leaderId);
};

// Work out the true value of a secret at settlement. Returns { kind, about, value } or null.
function readSecret(state, seller, secret, rng) {
  const f = state.factions[seller];
  switch (secret.kind) {
    case 'cardPeek': {
      const hand = f.treacheryHand ?? [];
      if (!hand.length) return null;
      return { kind: 'cardPeek', about: seller, value: hand[Math.floor(rng() * hand.length)] };
    }
    case 'traitor': return f.traitorHand?.length ? { kind: 'traitor', about: seller, value: [...f.traitorHand] } : null;
    case 'noFieldValue': {
      const nf = f.noField?.onPlanet;
      return nf ? { kind: 'noFieldValue', about: seller, value: { territoryId: nf.territoryId, value: nf.value } } : null;
    }
    case 'spiceTotal': return { kind: 'spiceTotal', about: seller, value: f.spice };
    case 'bgPrediction': {
      const p = f.specialFactionState?.prediction;
      return p ? { kind: 'bgPrediction', about: seller, value: { ...p } } : null;
    }
    case 'stormCard': return state.board?.nextStormCard != null ? { kind: 'stormCard', about: seller, value: state.board.nextStormCard } : null;
    case 'faceDancers': { const fds = faceDancersOf(state); return fds.length ? { kind: 'faceDancers', about: seller, value: fds } : null; }
    case 'nextSpiceCard': {
      const top = state.decks?.spiceDeck?.[0];
      return top ? { kind: 'nextSpiceCard', about: seller, value: top.id ?? top } : null;
    }
    case 'resale': {
      const e = (N(state).knowledge[seller] ?? []).find(k => k.id === secret.entryId);
      return e ? { kind: e.kind, about: e.about, value: structuredClone(e.value), resoldBy: seller, learnedTurn: e.turn } : null;
    }
    default: return null;
  }
}

// Private knowledge a viewer may see. Spectators (viewer null) see everything.
export function knowledgeFor(state, viewer) {
  const k = N(state).knowledge;
  return viewer == null ? Object.entries(k).flatMap(([owner, list]) => list.map(e => ({ ...e, owner }))) : (k[viewer] ?? []);
}

// Card ids a faction privately knows are in another faction's hand (for the AI
// brains, alongside the public state.meta.knownCards). Drops cards no longer held.
export function privatelyKnownCards(state, viewer) {
  const out = {};
  for (const e of state.negotiation?.knowledge?.[viewer] ?? [])
    if (e.kind === 'cardPeek' && state.factions[e.about]?.treacheryHand?.includes(e.value)) out[e.value] = e.about;
  return out;
}

// --- Promises ---------------------------------------------------------------------

// Normalises and checks a promise spec. Returns { ok, promise | reason }.
export function checkPromise(state, by, spec) {
  if (!spec || !PROMISE_TYPES.includes(spec.type)) return { ok: false, reason: 'Unknown promise.' };
  const turns = Math.max(1, Math.min(MAX_PROMISE_TURNS, Math.floor(spec.turns ?? 1)));
  const p = { type: spec.type };
  switch (spec.type) {
    case 'noEnter':
      if (!state.board.territories[spec.territoryId]) return { ok: false, reason: 'Unknown territory.' };
      Object.assign(p, { territoryId: spec.territoryId, turns }); break;
    case 'noAttack': case 'noTraitorOn':
      if (!seated(state, spec.factionId) || spec.factionId === by) return { ok: false, reason: 'Pick another faction.' };
      Object.assign(p, { factionId: spec.factionId, turns }); break;
    case 'bidPass':
      if (currentWindow(state)?.kind !== 'bidding') return { ok: false, reason: 'Bid promises are made at the start of Bidding.' };
      if (!Number.isInteger(spec.cardIndex) || spec.cardIndex < 0 || spec.cardIndex >= (state.bidding?.cardsUpForBid?.length ?? 0)) return { ok: false, reason: 'Pick a card in the row.' };
      Object.assign(p, { cardIndex: spec.cardIndex, turns: 1 }); break;
    case 'noBid':
      if (currentWindow(state)?.kind !== 'bidding') return { ok: false, reason: 'Bid promises are made at the start of Bidding.' };
      Object.assign(p, { turns: 1 }); break;
    case 'allianceAt':
      if (!seated(state, spec.factionId) || spec.factionId === by) return { ok: false, reason: 'Pick another faction.' };
      Object.assign(p, { factionId: spec.factionId, turns: MAX_PROMISE_TURNS }); break; // lapses if no Nexus within 3 turns
  }
  return { ok: true, promise: p };
}

const activePromises = (state, by, type) => (state.negotiation?.promises ?? []).filter(p => p.status === 'active' && p.by === by && (!type || p.type === type));

// Engine queries. Each returns the promise that forbids the action, or null.
export function entryForbiddenBy(state, by, territoryId) {
  if (state.board.territories[territoryId]?.type === 'polarSink' || territoryId === 'polarSink') return null; // no battles there
  return activePromises(state, by).find(p =>
    (p.type === 'noEnter' && p.territoryId === territoryId) ||
    (p.type === 'noAttack' && (state.factions[p.factionId]?.forces.onBoard[territoryId] ?? 0) > 0)) ?? null;
}
// For movementEngine: a plain-language reason when a binding promise forbids
// `by` from shipping or moving into territoryId (destination only), else null.
export function promiseBlocksEntry(state, by, territoryId) {
  if (!state.negotiation) return null;
  const p = entryForbiddenBy(state, by, territoryId);
  if (!p) return null;
  return p.type === 'noEnter' ? `You promised ${p.to} to stay out of here.` : `You promised ${p.to} not to move in on ${p.factionId}.`;
}

export const traitorCallForbiddenBy = (state, by, opponent) =>
  activePromises(state, by, 'noTraitorOn').find(p => p.factionId === opponent) ?? null;
export function bidForbiddenBy(state, by, cardIndex) {
  return activePromises(state, by).find(p => p.type === 'noBid' || (p.type === 'bidPass' && p.cardIndex === cardIndex)) ?? null;
}
// The faction `by` must propose to (or accept from) at this Nexus, or null.
export const allianceOwed = (state, by) => activePromises(state, by, 'allianceAt')[0]?.factionId ?? null;

// Call when an alliance promise has been honoured (alliance formed) or can't be (target allied elsewhere / refused).
export function closeAlliancePromises(state, by, outcome = 'kept') {
  for (const p of activePromises(state, by, 'allianceAt')) p.status = outcome;
}

// End of turn: promises past their last turn are kept.
export function expirePromises(state) {
  for (const p of N(state).promises) if (p.status === 'active' && state.meta.turn >= p.untilTurn) p.status = 'kept';
}

// --- Offers ---------------------------------------------------------------------

// side = { spice?: n, secrets?: [{kind, entryId?}], promises?: [spec] }
// checkSpice is false for the side being ASKED for: spice behind a shield is
// secret, so an offer can't be refused for it (that would let the asker probe);
// it is checked when the deal is accepted.
function checkSide(state, giver, receiver, side, checkSpice = true) {
  side ??= {};
  const spice = Math.max(0, Math.floor(side.spice ?? 0));
  if (checkSpice && spice > state.factions[giver].spice) return { ok: false, reason: `Not enough spice behind the shield for ${spice}.` };
  const available = sellableSecrets(state, giver, receiver);
  for (const s of side.secrets ?? [])
    if (!available.some(a => a.kind === s.kind && (s.kind !== 'resale' || a.entryId === s.entryId))) return { ok: false, reason: `${giver} cannot offer that secret now.` };
  const promises = [];
  for (const spec of side.promises ?? []) {
    const r = checkPromise(state, giver, spec);
    if (!r.ok) return r;
    promises.push(r.promise);
  }
  const secrets = (side.secrets ?? []).map(s => (s.kind === 'resale' ? { ...s, about: available.find(a => a.entryId === s.entryId)?.about } : { kind: s.kind }));
  return { ok: true, side: { spice, secrets, promises } };
}

const isEmpty = s => !s.spice && !s.secrets.length && !s.promises.length;

// Validates and records an open offer. Returns { ok, offer | reason }.
export function makeOffer(state, { from, to, give, ask, counterOf = null }) {
  const blocked = dealBlockedReason(state, from, to);
  if (blocked) return { ok: false, reason: blocked };
  const w = currentWindow(state);
  if (!w) return { ok: false, reason: 'Deals can be made at the start of Bidding, the Nexus, the start of Shipment and Movement, or before battle plans.' };
  if (!counterOf && !canReceiveOffer(state, to)) return { ok: false, reason: `${to} has had enough offers for now.` };
  const g = checkSide(state, from, to, give); if (!g.ok) return g;
  const a = checkSide(state, to, from, ask, false); if (!a.ok) return a;
  if (isEmpty(g.side) && isEmpty(a.side)) return { ok: false, reason: 'An offer needs something in it.' };
  if (counterOf) {
    const orig = N(state).offers.find(o => o.id === counterOf);
    if (!orig || orig.status !== 'open' || orig.to !== from) return { ok: false, reason: 'Nothing to counter.' };
    if (orig.counterOf) return { ok: false, reason: 'A counter-offer can only be accepted or refused.' };
    orig.status = 'countered';
  }
  const offer = { id: newId(state, 'o'), from, to, turn: state.meta.turn, phase: state.meta.phase, window: w.kind, windowId: w.id, give: g.side, ask: a.side, status: 'open', counterOf };
  N(state).offers.push(offer);
  return { ok: true, offer };
}

export const canCounter = (state, offerId) => {
  const o = N(state).offers.find(x => x.id === offerId);
  return Boolean(o && o.status === 'open' && !o.counterOf);
};

export function refuseOffer(state, offerId) {
  const o = N(state).offers.find(x => x.id === offerId);
  if (o?.status === 'open') o.status = 'refused';
  return o;
}

// Open offers left at the end of a window lapse.
export function lapseOpenOffers(state) {
  for (const o of N(state).offers) if (o.status === 'open') o.status = 'lapsed';
}

// Accept and settle. Re-validates (things may have changed). Returns
// { ok, deal: { offer, promises, revealed: { [factionId]: [knowledge] } } } or { ok:false, reason }.
export function acceptOffer(state, offerId, rng = random) {
  const n = N(state), o = n.offers.find(x => x.id === offerId);
  if (!o || o.status !== 'open') return { ok: false, reason: 'That offer is no longer open.' };
  const blocked = dealBlockedReason(state, o.from, o.to);
  if (blocked) { o.status = 'refused'; return { ok: false, reason: blocked }; }
  const g = checkSide(state, o.from, o.to, o.give), a = checkSide(state, o.to, o.from, o.ask);
  if (!g.ok || !a.ok) { o.status = 'refused'; return { ok: false, reason: (g.ok ? a : g).reason }; }

  // Read secrets before moving anything (spiceTotal should be the pre-deal figure).
  const revealed = { [o.from]: [], [o.to]: [] };
  for (const [giver, receiver, side] of [[o.from, o.to, o.give], [o.to, o.from, o.ask]])
    for (const s of side.secrets) {
      const v = readSecret(state, giver, s, rng);
      if (!v) { o.status = 'refused'; return { ok: false, reason: 'A secret in the deal is no longer available.' }; }
      revealed[receiver].push({ id: newId(state, 'k'), ...v, turn: state.meta.turn, dealId: o.id, from: giver });
    }

  // Spice: in front of the receiver's shield until the Mentat Pause.
  for (const [giver, receiver, side] of [[o.from, o.to, o.give], [o.to, o.from, o.ask]])
    if (side.spice) { state.factions[giver].spice -= side.spice; n.held[receiver] = (n.held[receiver] ?? 0) + side.spice; }

  for (const [f, list] of Object.entries(revealed)) if (list.length) (n.knowledge[f] ??= []).push(...list);

  const promises = [];
  for (const [by, to, side] of [[o.from, o.to, o.give], [o.to, o.from, o.ask]])
    for (const p of side.promises) {
      const rec = { id: newId(state, 'p'), by, to, ...p, turn: state.meta.turn, untilTurn: state.meta.turn + p.turns - 1, dealId: o.id, status: 'active' };
      n.promises.push(rec); promises.push(rec);
    }
  o.status = 'accepted';
  return { ok: true, deal: { offer: o, promises, revealed } };
}

// Start of the Mentat Pause: bribe spice joins the receiver's normal spice.
export function collectHeldSpice(state) {
  const n = N(state), moved = {};
  for (const [f, amt] of Object.entries(n.held)) if (amt > 0 && state.factions[f]) { state.factions[f].spice += amt; moved[f] = amt; }
  n.held = {};
  return moved;
}

// --- Public description (no secret values) -----------------------------------------

const SECRET_LABEL = { cardPeek: 'a look at a random card in hand', traitor: 'their traitor', noFieldValue: 'the No-Field value', spiceTotal: 'their spice total',
  bgPrediction: 'the prediction', stormCard: 'the next storm', faceDancers: 'their Face Dancers', nextSpiceCard: 'the next spice card', resale: 'something they know' };

// names (optional): { faction: id => name, territory: id => name }
const plainNames = { faction: x => x, territory: x => x };

export function describePromise(p, names = plainNames) {
  const t = p.turns > 1 ? ` for ${p.turns} turns` : '';
  switch (p.type) {
    case 'noEnter': return `to stay out of ${names.territory(p.territoryId)}${t}`;
    case 'noAttack': return `not to move in on ${names.faction(p.factionId)}${t}`;
    case 'noTraitorOn': return `not to call a traitor on ${names.faction(p.factionId)}${t}`;
    case 'bidPass': return `to pass on card ${p.cardIndex + 1}`;
    case 'noBid': return 'not to bid this round';
    case 'allianceAt': return `to ally with ${names.faction(p.factionId)} at the next Nexus`;
  }
  return p.type;
}

export function describeSecret(sec, names = plainNames) {
  return sec.kind === 'resale' && sec.about ? `what they know about ${names.faction(sec.about)}` : (SECRET_LABEL[sec.kind] ?? sec.kind);
}

export function describeSide(side, names = plainNames) {
  const parts = [];
  if (side.spice) parts.push(`${side.spice} spice`);
  for (const s of side.secrets ?? []) parts.push(describeSecret(s, names));
  for (const p of side.promises ?? []) parts.push(`a promise ${describePromise(p, names)}`);
  return parts.join(', ') || 'nothing';
}

// Public summary of an offer: safe for every viewer.
export const describeOffer = (o, names = plainNames) => `${names.faction(o.from)} offers ${describeSide(o.give, names)} for ${describeSide(o.ask, names)}`;

// The true content of a secret, in words, for the one faction allowed to see it.
export function describeKnowledge(k, names = plainNames, extra = {}) {
  const who = names.faction(k.about);
  const card = extra.card ?? (x => x), leader = extra.leader ?? (x => x);
  switch (k.kind) {
    case 'cardPeek': return `${who} hold ${card(k.value)}`;
    case 'traitor': return `${who}'s traitor${k.value.length > 1 ? 's' : ''}: ${k.value.map(leader).join(', ')}`;
    case 'noFieldValue': return `${who}'s No-Field token in ${names.territory(k.value.territoryId)} is ${k.value.value}`;
    case 'spiceTotal': return `${who} had ${k.value} spice`;
    case 'bgPrediction': return `the Bene Gesserit predicted ${names.faction(k.value.factionId)} on turn ${k.value.turn}`;
    case 'stormCard': return `the next storm moves ${k.value} sectors`;
    case 'faceDancers': return `${who}'s Face Dancers: ${k.value.map(leader).join(', ')}`;
    case 'nextSpiceCard': return `the next spice card is ${extra.spiceCard ? extra.spiceCard(k.value) : k.value}`;
  }
  return k.kind;
}
