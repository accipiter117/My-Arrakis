// js/ai/negotiator.js
//
// AI side of negotiation (js/negotiation.js). Deals are binding, so the AI
// never has to decide whether to break a promise; it only has to price them.
//
// Everything is measured in "spice-equivalent" points:
// - Spice is worth more to a poor faction than a rich one.
// - A secret is worth more when it bears on a fight about to happen.
// - A promise costs the promiser what it gives up (a stronghold it could take,
//   a traitor it could call, a card it would bid on) and is worth to the
//   receiver the threat it removes.
// The AI accepts when what it gets beats what it gives by a small margin,
// counters once when a deal is close, and pitches rarely (the engine also
// caps offers at one per receiver per window and two per turn).

import * as neg from '../negotiation.js';
import { random } from '../random.js';

const MARGIN = 1;          // must come out at least this far ahead
const COUNTER_RANGE = 4;   // counter when within this of acceptable
const PITCH_CHANCE = 0.35; // chance to look for a deal at each window

export function createNegotiator({ leadersData = {}, rng = random, diplomacy = null } = {}) {
  const leaderFaction = {};
  for (const [f, list] of Object.entries(leadersData)) if (Array.isArray(list)) for (const l of list) leaderFaction[l.id] = f;

  const strongholds = state => Object.keys(state.board.territories).filter(t => state.board.territories[t].type === 'stronghold');
  const forcesAt = (state, f, t) => state.factions[f]?.forces.onBoard[t] ?? 0;
  const held = (state, f) => strongholds(state).filter(t => forcesAt(state, f, t) > 0);
  const onBoard = (state, f) => Object.values(state.factions[f]?.forces.onBoard ?? {}).reduce((a, b) => a + b, 0);
  const strength = (state, f) => onBoard(state, f) + (state.factions[f]?.forces.reserve ?? 0) / 2;
  const spiceOf = (state, f) => state.factions[f]?.spice ?? 0;
  const allyOf = (state, f) => (state.alliances ?? []).find(a => a.factions.includes(f))?.factions.find(x => x !== f) ?? null;

  // What one spice is worth to me.
  const spiceWorth = (state, me) => { const s = spiceOf(state, me); return s < 5 ? 1.5 : s > 15 ? 0.7 : 1; };

  // Threat `f` poses to me: their size relative to mine, 0.3 to 2.
  const threat = (state, me, f) => Math.max(0.3, Math.min(2, strength(state, f) / Math.max(1, strength(state, me))));

  const inBattleWith = (ctx, me, other) => ctx?.kind === 'battle' && ctx.fighters?.includes(me) && ctx.fighters?.includes(other);
  const iHoldTraitorOn = (state, me, f) => (state.factions[me]?.traitorHand ?? []).some(l => leaderFaction[l] === f);

  // --- Secrets ------------------------------------------------------------------

  const BASE_SECRET = { cardPeek: 2, traitor: 3, noFieldValue: 2, spiceTotal: 0.5, bgPrediction: 2, stormCard: 1.5, faceDancers: 3, nextSpiceCard: 1.5 };

  function secretValueToBuyer(state, buyer, seller, s, ctx) {
    let kind = s.kind, about = seller, mult = 1;
    if (kind === 'resale') {
      // The buyer is told only who the knowledge is about (it's in the offer's
      // label), not what it is: price it as a card peek, discounted.
      about = neg.sellableSecrets(state, seller, buyer).find(x => x.entryId === s.entryId)?.about ?? null;
      kind = 'cardPeek'; mult = 0.7;
    }
    let v = BASE_SECRET[kind] ?? 1;
    if (about && inBattleWith(ctx, buyer, about) && ['cardPeek', 'traitor', 'noFieldValue', 'faceDancers'].includes(kind)) v += 3;
    if (kind === 'stormCard' && onBoard(state, buyer) > 0) v += 1;
    if (kind === 'bgPrediction' && held(state, buyer).length >= 2) v += 2;
    return v * mult;
  }

  function secretCostToSeller(state, seller, buyer, s, ctx) {
    if (s.kind === 'resale') return 0.5; // someone else's secret
    if (inBattleWith(ctx, seller, buyer) && ['cardPeek', 'traitor', 'noFieldValue', 'faceDancers'].includes(s.kind)) return 99; // never arm my opponent mid-fight
    const base = { cardPeek: 2, traitor: 4, noFieldValue: 3, spiceTotal: 0.5, bgPrediction: 5, stormCard: 1.5, faceDancers: 5, nextSpiceCard: 1 }[s.kind] ?? 2;
    return base * Math.min(1.5, threat(state, seller, buyer));
  }

  // --- Promises -----------------------------------------------------------------

  // guess = true when another faction is pricing my promise: they can't see my traitors.
  function promiseCostToPromiser(state, me, to, p, guess = false) {
    const turns = p.turns ?? 1;
    switch (p.type) {
      case 'noEnter': {
        const t = state.board.territories[p.territoryId];
        if (!t) return 0;
        if (t.type === 'stronghold') return (held(state, me).length >= 2 ? 8 : 3) * turns;
        return (t.spice ? 1.5 : 0.5) * turns;
      }
      case 'noAttack': return (2 + 2 * held(state, p.factionId).length) * turns;
      case 'noTraitorOn': return (guess ? 2 : iHoldTraitorOn(state, me, p.factionId) ? 4 : 0.5) * turns;
      case 'bidPass': return spiceOf(state, me) > 4 ? 1.5 : 0.3;
      case 'noBid': return spiceOf(state, me) > 4 ? 3 : 0.5;
      case 'allianceAt': {
        if (!diplomacy) return 6;
        const score = diplomacy.partnerScore(state, me, p.factionId);
        return score >= 3 ? -1 : 6 - score; // a partner I'd want anyway is a bonus
      }
    }
    return 2;
  }

  function promiseValueToReceiver(state, me, by, p) {
    const turns = p.turns ?? 1, th = threat(state, me, by);
    switch (p.type) {
      case 'noEnter': return forcesAt(state, me, p.territoryId) > 0 ? (state.board.territories[p.territoryId]?.type === 'stronghold' ? 3 : 1) * th * turns : 0.2;
      case 'noAttack': return p.factionId === me ? 2.5 * th * turns : 0.3;
      case 'noTraitorOn': return p.factionId === me ? 1.5 * turns : 0.2;
      case 'bidPass': return spiceOf(state, me) > 4 ? 1 : 0.2;
      case 'noBid': return spiceOf(state, me) > 4 ? 1.5 * Math.min(1.5, spiceOf(state, by) / 10) : 0.3;
      case 'allianceAt': {
        if (p.factionId !== me) return 0.2;
        if (!diplomacy) return 1;
        return Math.max(-6, diplomacy.partnerScore(state, me, by) - 2);
      }
    }
    return 0.5;
  }

  // --- Weighing an offer --------------------------------------------------------

  // Net value of `offer` to `me` (the receiver), in spice-equivalent points.
  function netValue(state, me, offer, ctx, guess = false) {
    const other = offer.from, w = spiceWorth(state, me);
    let gain = (offer.give.spice ?? 0) * w, cost = (offer.ask.spice ?? 0) * w;
    for (const s of offer.give.secrets ?? []) gain += secretValueToBuyer(state, me, other, s, ctx);
    for (const p of offer.give.promises ?? []) gain += promiseValueToReceiver(state, me, other, p);
    for (const s of offer.ask.secrets ?? []) cost += secretCostToSeller(state, me, other, s, ctx);
    for (const p of offer.ask.promises ?? []) cost += promiseCostToPromiser(state, me, other, p, guess);
    // Late in the game, wary of feeding whoever is closest to winning.
    if (held(state, other).length >= 2 && (offer.give.spice ?? 0) === 0) cost += 1;
    return gain - cost;
  }

  function chooseOfferResponse(state, me, offer) {
    const ctx = neg.currentWindow(state);
    if ((offer.ask.spice ?? 0) > spiceOf(state, me)) return { action: 'refuse', reason: 'cannot pay' };
    const net = netValue(state, me, offer, ctx);
    if (net >= MARGIN) return { action: 'accept', reason: `worth ${net.toFixed(1)}` };
    // Counter once, by asking for the spice that closes the gap, if they have it.
    if (!offer.counterOf && net > -COUNTER_RANGE) {
      const extra = Math.ceil((MARGIN - net) / spiceWorth(state, me));
      const have = spiceOf(state, offer.from) - (offer.give.spice ?? 0);
      if (extra > 0 && extra <= have) {
        // Mirror the offer from my side: I give what they asked, they give what they offered plus spice.
        return { action: 'counter', reason: `short by ${(MARGIN - net).toFixed(1)}`,
          counter: { give: plain(offer.ask), ask: { ...plain(offer.give), spice: (offer.give.spice ?? 0) + extra } } };
      }
    }
    return { action: 'refuse', reason: `worth ${net.toFixed(1)}` };
  }
  const plain = side => ({ spice: side.spice ?? 0, secrets: (side.secrets ?? []).map(s => ({ ...s })), promises: (side.promises ?? []).map(p => ({ ...p })) });

  // --- Pitching -----------------------------------------------------------------

  function chooseNegotiationOffers(state, me, ctx) {
    if (rng() > PITCH_CHANCE) return [];
    const others = Object.keys(state.factions).filter(f => f !== me && f !== allyOf(state, me) && !neg.dealBlockedReason(state, me, f) && neg.canReceiveOffer(state, f));
    if (!others.length) return [];
    const ideas = [];
    const mySpice = spiceOf(state, me);
    const budget = Math.min(4, Math.floor(mySpice / 3));

    // 1. Buy safety for a stronghold I hold from the biggest threat that can reach it.
    if (budget >= 1 && ['shipment', 'nexus', 'bidding'].includes(ctx.kind)) {
      const mine = held(state, me);
      const rival = others.slice().sort((a, b) => strength(state, b) - strength(state, a))[0];
      if (mine.length && rival && threat(state, me, rival) >= 1) {
        const t = mine.slice().sort((a, b) => forcesAt(state, me, a) - forcesAt(state, me, b))[0]; // the weakest-held
        ideas.push({ to: rival, give: { spice: Math.min(budget, 3) }, ask: { promises: [{ type: 'noEnter', territoryId: t, turns: 1 }] } });
      }
    }
    // 2. Before my battle: pay my opponent not to call a traitor on me.
    if (ctx.kind === 'battle' && ctx.fighters?.includes(me) && budget >= 2) {
      const opp = ctx.fighters.find(f => f !== me);
      if (others.includes(opp)) ideas.push({ to: opp, give: { spice: 2 }, ask: { promises: [{ type: 'noTraitorOn', factionId: me, turns: 1 }] } });
    }
    // 3. Short of spice: sell something to a rich faction I'm not fighting.
    if (mySpice < 4) {
      const buyers = others.filter(f => spiceOf(state, f) >= 6 && !inBattleWith(ctx, me, f));
      const buyer = buyers.sort((a, b) => spiceOf(state, b) - spiceOf(state, a))[0];
      if (buyer) {
        const wares = neg.sellableSecrets(state, me, buyer).filter(s => secretCostToSeller(state, me, buyer, s, ctx) < 3);
        const pick = wares.sort((a, b) => secretValueToBuyer(state, buyer, me, b, ctx) - secretValueToBuyer(state, buyer, me, a, ctx))[0];
        if (pick) ideas.push({ to: buyer, give: { secrets: [{ kind: pick.kind, ...(pick.entryId ? { entryId: pick.entryId } : {}) }] }, ask: { spice: 3 } });
      }
    }
    // 4. Rich at the start of Bidding: pay the next-richest rival to sit this round out.
    if (ctx.kind === 'bidding' && mySpice >= 12) {
      const rival = others.filter(f => spiceOf(state, f) >= 8).sort((a, b) => spiceOf(state, b) - spiceOf(state, a))[0];
      if (rival) ideas.push({ to: rival, give: { spice: 3 }, ask: { promises: [{ type: 'noBid' }] } });
    }
    // Price each idea so the receiver should take it (by my best guess) and I
    // still come out ahead; drop it otherwise. One idea per window at most.
    const worthIt = ideas.map(o => priceIdea(state, me, o, ctx)).filter(Boolean);
    return worthIt.length ? [worthIt[Math.floor(rng() * worthIt.length)]] : [];
  }

  function priceIdea(state, me, idea, ctx) {
    const o = { to: idea.to, give: plain(idea.give), ask: plain(idea.ask) };
    const asOffer = () => ({ from: me, to: o.to, give: o.give, ask: o.ask });
    const theirNet = netValue(state, o.to, asOffer(), ctx, true);
    if (theirNet < MARGIN) {
      const need = Math.ceil((MARGIN - theirNet) / spiceWorth(state, o.to));
      if (o.give.spice) o.give.spice += need;
      else if (o.ask.spice && o.ask.spice - need >= 1) o.ask.spice -= need;
      else return null;
    }
    if (o.give.spice > spiceOf(state, me)) return null;
    // My side: the same deal seen as if they had offered it to me.
    const mine = netValue(state, me, { from: o.to, to: me, give: o.ask, ask: o.give }, ctx);
    return mine >= 0 ? o : null;
  }

  return { chooseNegotiationOffers, chooseOfferResponse, netValue };
}
