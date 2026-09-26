// js/ai/biddingBrain.js
//
// Step 4 of docs/AI_PLAN.md: bidding. A card's worth is what it adds to MY
// hand (a first weapon matters far more than a third), averaged over every
// card it could be when face down (only Atreides sees it), adjusted for
// faction economics, plus denial value when the leader is bidding for it.
// Honest knowledge only: own hand, discard pile, publicly known cards, the
// public board, and the current high bidder.

import { random } from '../random.js';

const WEAPONS = ['poisonWeapon', 'projectileWeapon', 'specialWeapon'];
const DEFENSES = ['poisonDefense', 'projectileDefense'];

export function createBiddingBrain({ cardLookup, rng = random }) {
  const cat = id => cardLookup[id]?.category;

  // Value of adding one card to this hand, in rough "spice" units.
  function cardValue(state, me, id) {
    const faction = state.factions[me];
    const held = faction.treacheryHand.map(cat);
    const c = cat(id);
    const count = x => held.filter(h => h === x).length;
    if (c === 'worthless') return -0.5;
    if (WEAPONS.includes(c)) {
      const base = c === 'specialWeapon' ? 6 : 4.5;
      return base / (1 + held.filter(h => WEAPONS.includes(h)).length) + (count(c) ? -0.5 : 0);
    }
    if (DEFENSES.includes(c)) {
      return 4 / (1 + held.filter(h => DEFENSES.includes(h)).length) + (count(c) ? -0.5 : 0);
    }
    if (c === 'specialLeaderSubstitute') return faction.leaders.available.length <= 2 ? 4 : 2;
    if (id === 'ghola') return faction.leaders.killed.length ? 4 : 2.5;
    if (id === 'hajr') return 2;
    if (id.startsWith('karama')) return 2;
    if (id.startsWith('truthtrance')) return 1;
    return 0.8; // storm cards whose effects aren't in the game yet
  }

  // Everything the face-down card could be.
  function unknownPool(state, me) {
    const known = new Set([...state.factions[me].treacheryHand, ...state.decks.treacheryDiscard, ...Object.keys(state.meta.knownCards ?? {})]);
    return Object.keys(cardLookup).filter(id => !known.has(id));
  }

  const strongholdsHeld = (state, f) => Object.keys(state.board.territories)
    .filter(t => state.board.territories[t].type === 'stronghold' && (state.factions[f]?.forces.onBoard[t] ?? 0) > 0).length;

  return {
    chooseBid(state, me, cardId, currentBid) {
      const faction = state.factions[me];
      const limit = me === 'harkonnen' ? 8 : 4;
      if (faction.treacheryHand.length >= limit) return null;

      let value;
      if (me === 'atreides' && cardId) {
        value = cardValue(state, me, cardId); // Prescience: Atreides sees the card
      } else {
        const pool = unknownPool(state, me);
        value = pool.length ? pool.reduce((sum, id) => sum + cardValue(state, me, id), 0) / pool.length : 1;
      }

      // Harkonnen draw a free card with every purchase; it's a random draw,
      // usually worth less than the card bid on, so a modest bonus.
      if (me === 'harkonnen') value *= 1.2;
      // A nearly full hand makes each card worth less.
      if (faction.treacheryHand.length >= limit - 1) value *= 0.6;

      // Denial: the leading faction is the high bidder, so outbidding them matters.
      const bidder = state.bidding?.currentBidder;
      const ally = (state.alliances ?? []).find(a => a.factions.includes(me))?.factions.find(f => f !== me);
      if (bidder && bidder !== me && bidder !== ally) {
        const lead = strongholdsHeld(state, bidder);
        if (lead >= 2) value += 1.5 * (lead - 1);
      }

      // Paying feeds the Emperor (unless we are the Emperor or allied to them).
      const feedsEmperor = state.factions.emperor && me !== 'emperor' && ally !== 'emperor';
      const spiceWorth = feedsEmperor ? 0.8 : 1;

      // Keep spice to ship troops still off the board and to back forces in
      // battle (each spice makes a dialed force count fully).
      const onBoard = Object.values(faction.forces.onBoard).reduce((a, b) => a + b, 0);
      const keep = Math.min(faction.spice, 3 + (faction.forces.reserve > 4 ? 4 : 0) + Math.min(4, Math.floor(onBoard / 4)));
      // Card value in spice terms, tempered: spice has many other uses.
      const maxBid = Math.floor(value * 0.8 * spiceWorth + rng() * 1.2);
      const next = currentBid + 1;
      if (next > maxBid || next > faction.spice - keep) return null;
      return next;
    }
  };
}
