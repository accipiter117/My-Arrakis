// js/richese.js
//
// Richese (CHOAM & Richese rulebook, expansion plan M6), part 1: the cache
// auction. Every Bidding Round while cache cards remain, one fewer normal
// card is dealt and Richese must reveal and auction one cache card, first or
// last in the round (announced up front), by a Once Around or Silent auction.
//
//   Once Around: Richese picks a direction; starting beside Richese, each
//   faction able to bid has one chance to pass or bid higher. Back at
//   Richese: outbid the high bid and take the card, or the high bidder buys.
//   Silent: every faction able to bid names an amount in secret (0 allowed);
//   the highest wins, ties broken by storm order.
//   Nobody bids: Richese takes the card free or removes it from the game.
//   Payment: others pay Richese; Richese buying its own pays the Emperor or
//   the Bank as normal. Harkonnen still draw their bonus card.
//   Karama cannot buy these cards (the auction panels never offer it).

import { isAtHandLimit, payForCard, drawTreacheryCard, handLimitFor } from './biddingEngine.js';
import { spendingPower, paySpice } from './allySupport.js';

export const richeseSeated = state => Boolean(state.factions.richese);
export const cacheOf = state => state.factions.richese?.cache ?? [];

// Turn order starting from the First Player (ties in Silent auctions).
function stormOrder(state) {
  const order = state.meta.turnOrder ?? Object.keys(state.factions);
  const i = Math.max(0, order.indexOf(state.meta.firstPlayer));
  return [...order.slice(i), ...order.slice(0, i)];
}

// Seats going one way round the table from Richese, Richese excluded.
export function onceAroundOrder(state, direction = 'cw') {
  const seats = state.meta.turnOrder ?? Object.keys(state.factions);
  const i = seats.indexOf('richese');
  const out = [];
  for (let k = 1; k < seats.length; k++) out.push(seats[(i + (direction === 'ccw' ? -k : k) + seats.length * 2) % seats.length]);
  return out;
}

const canBidHere = (state, f) => !isAtHandLimit(state, f);

async function runOnceAround(state, dp, cardId) {
  const direction = (await dp.chooseOnceAroundDirection?.(state, 'richese', { cardId })) === 'ccw' ? 'ccw' : 'cw';
  let high = { factionId: null, amount: 0 };
  const bids = [];
  for (const f of onceAroundOrder(state, direction).filter(x => canBidHere(state, x))) {
    const bid = await dp.chooseOnceAroundBid?.(state, f, { cardId, highBid: high.amount });
    if (Number.isInteger(bid) && bid > high.amount && bid <= spendingPower(state, f)) { high = { factionId: f, amount: bid }; bids.push({ factionId: f, amount: bid }); }
    else bids.push({ factionId: f, amount: null });
  }
  if (high.factionId && canBidHere(state, 'richese')) {
    const final = await dp.chooseOnceAroundFinal?.(state, 'richese', { cardId, highBid: high.amount });
    if (Number.isInteger(final) && final > high.amount && final <= spendingPower(state, 'richese')) return { winnerId: 'richese', amount: final, direction, bids };
  }
  return { winnerId: high.factionId, amount: high.amount, direction, bids };
}

async function runSilent(state, dp, cardId) {
  const bidders = stormOrder(state).filter(f => canBidHere(state, f));
  const bids = {};
  for (const f of bidders) {
    const b = Math.floor((await dp.chooseSilentBid?.(state, f, { cardId })) ?? 0);
    bids[f] = Math.max(0, Math.min(b, spendingPower(state, f)));
  }
  const max = Math.max(0, ...Object.values(bids));
  return { winnerId: max > 0 ? bidders.find(f => bids[f] === max) : null, amount: max, bids };
}

// Runs the round's cache auction. Returns what happened (for the log).
export async function runCacheAuction(state, dp, choice, observe) {
  const cache = cacheOf(state);
  const cardId = cache.includes(choice.cardId) ? choice.cardId : cache[0];
  const method = choice.method === 'silent' ? 'silent' : 'onceAround';
  state.factions.richese.cache = cache.filter(c => c !== cardId);
  await observe({ type: 'cacheAuctionStart', cardId, method, position: choice.position });
  const result = method === 'silent' ? await runSilent(state, dp, cardId) : await runOnceAround(state, dp, cardId);
  let outcome;
  if (!result.winnerId) {
    // Nobody bid: Richese take it free (hand permitting) or remove it from the game.
    const take = canBidHere(state, 'richese') && (await dp.chooseFreeOrRemove?.(state, 'richese', { cardId })) === 'take';
    if (take) state.factions.richese.treacheryHand.push(cardId);
    else (state.decks.removedFromGame ??= []).push(cardId);
    outcome = { cardId, method, winnerId: take ? 'richese' : null, amount: 0, removed: !take, bids: result.bids };
  } else {
    if (result.winnerId === 'richese') payForCard(state, 'richese', result.amount); // to the Emperor or the Bank
    else { paySpice(state, result.winnerId, result.amount); state.factions.richese.spice += result.amount; }
    state.factions[result.winnerId].treacheryHand.push(cardId);
    let bonus = false;
    if (result.winnerId === 'harkonnen' && state.factions.harkonnen.treacheryHand.length < handLimitFor('harkonnen')) {
      const extra = drawTreacheryCard(state);
      if (extra) { state.factions.harkonnen.treacheryHand.push(extra); bonus = true; }
    }
    outcome = { cardId, method, winnerId: result.winnerId, amount: result.amount, bonus, bids: result.bids, direction: result.direction };
  }
  await observe({ type: 'cacheAuctionEnd', ...outcome });
  return outcome;
}

// AI card values for the cache (effects not yet built are worth little).
export function cacheCardValue(cardId, unbuilt = []) {
  if (unbuilt.includes(cardId)) return 1;
  return { karamaRichese: 8, stoneBurner: 6, mirrorWeapon: 5, residualPoison: 4, portableSnooper: 3 }[cardId] ?? 2;
}

// --- Black Market (advanced) -------------------------------------------------------
// At the start of the Bidding Round Richese may offer one card from its hand,
// announcing a name (true or not). Sold normally, Once Around (Richese does not
// bid) or Silent. No spice bid: Richese keeps it. Sold: one fewer normal card,
// and all payment goes to Richese.
// A normal auction for the Black Market card: rounds in storm order until nobody raises.
// Atreides are told the real card (Prescience still works on the Black Market).
async function runNormalFor(state, dp, cardLabelId, bidders, actualId) {
  let high = { factionId: null, amount: 0 };
  const out = new Set();
  for (let guard = 0; guard < 300; guard++) {
    const live = bidders.filter(f => !out.has(f) && f !== high.factionId);
    if (!live.length || (high.factionId && live.length === 0)) break;
    let anyone = false;
    for (const f of live) {
      if (out.has(f) || f === high.factionId) continue;
      const bid = await dp.chooseOnceAroundBid?.(state, f, { cardId: cardLabelId, highBid: high.amount, blackMarket: 'normal', actualId: f === 'atreides' ? actualId : undefined });
      if (Number.isInteger(bid) && bid > high.amount && bid <= spendingPower(state, f)) { high = { factionId: f, amount: bid }; anyone = true; }
      else out.add(f);
    }
    if (!anyone) break;
  }
  return { winnerId: high.factionId, amount: high.amount };
}

export async function runBlackMarket(state, dp, offer, observe) {
  const r = state.factions.richese;
  if (!offer || !r.treacheryHand.includes(offer.cardId)) return { sold: false };
  const method = ['onceAround', 'silent'].includes(offer.method) ? offer.method : 'normal';
  const claimId = offer.claimId ?? offer.cardId;
  await observe({ type: 'blackMarketStart', cardId: offer.cardId, claimId, method });
  const bidders = stormOrder(state).filter(f => f !== 'richese' && canBidHere(state, f));
  let result;
  if (method === 'silent') {
    const bids = {};
    for (const f of bidders) bids[f] = Math.max(0, Math.min(Math.floor((await dp.chooseSilentBid?.(state, f, { cardId: claimId, blackMarket: true, actualId: f === 'atreides' ? offer.cardId : undefined })) ?? 0), spendingPower(state, f)));
    const max = Math.max(0, ...Object.values(bids));
    result = { winnerId: max > 0 ? bidders.find(f => bids[f] === max) : null, amount: max, bids };
  } else if (method === 'onceAround') {
    let high = { factionId: null, amount: 0 };
    for (const f of onceAroundOrder(state, 'cw').filter(x => bidders.includes(x))) {
      const bid = await dp.chooseOnceAroundBid?.(state, f, { cardId: claimId, highBid: high.amount, blackMarket: true, actualId: f === 'atreides' ? offer.cardId : undefined });
      if (Number.isInteger(bid) && bid > high.amount && bid <= spendingPower(state, f)) high = { factionId: f, amount: bid };
    }
    result = { winnerId: high.factionId, amount: high.amount };
  } else result = await runNormalFor(state, dp, claimId, bidders, offer.cardId);
  if (!result.winnerId || result.amount <= 0) {
    await observe({ type: 'blackMarketEnd', sold: false, claimId, method });
    return { sold: false };
  }
  paySpice(state, result.winnerId, result.amount);
  r.spice += result.amount;
  r.treacheryHand = r.treacheryHand.filter(c => c !== offer.cardId);
  state.factions[result.winnerId].treacheryHand.push(offer.cardId);
  if (result.winnerId === 'harkonnen' && state.factions.harkonnen.treacheryHand.length < handLimitFor('harkonnen')) {
    const extra = drawTreacheryCard(state);
    if (extra) state.factions.harkonnen.treacheryHand.push(extra);
  }
  await observe({ type: 'blackMarketEnd', sold: true, claimId, cardId: offer.cardId, winnerId: result.winnerId, amount: result.amount, method, bids: result.bids });
  return { sold: true, winnerId: result.winnerId, amount: result.amount, cardId: offer.cardId };
}

// Richese alliance: ship the ally's forces with a No-Field token, revealed at once.
export function useNoFieldForAlly(state, nfState) {
  // nfState: the token value; rotation as for Richese's own use, but nothing stays on the planet.
  const nf = state.factions.richese.noField;
  nf.available = nf.available.filter(v => v !== nfState);
  if (nf.lastUsed !== null) nf.available.push(nf.lastUsed);
  nf.lastUsed = nfState;
}
