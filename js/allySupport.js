// js/allySupport.js
//
// Alliance advantage: allies may help pay for each other's treachery cards
// and shipments. At the start of each Bidding phase, a faction may pledge
// spice to its ally for that turn; the ally's spending power is its own
// spice plus what remains of the pledge. Own spice is spent first.

export function allyOf(state, factionId) {
  return (state.alliances ?? []).find(a => a.factions.includes(factionId))?.factions.find(f => f !== factionId) ?? null;
}

// Spice pledged TO this faction by its ally and still usable this turn.
export function pledgeFor(state, factionId) {
  const ally = allyOf(state, factionId);
  if (!ally) return 0;
  const pledged = state.meta.allyPledges?.[factionId] ?? 0;
  return Math.max(0, Math.min(pledged, state.factions[ally].spice));
}

export function spendingPower(state, factionId) {
  return state.factions[factionId].spice + pledgeFor(state, factionId);
}

// Deducts a payment: own spice first, then the ally's pledge.
export function paySpice(state, factionId, amount) {
  const faction = state.factions[factionId];
  const own = Math.min(faction.spice, amount);
  const fromAlly = amount - own;
  if (fromAlly > pledgeFor(state, factionId)) throw new Error('Not enough spice, even with the ally pledge.');
  faction.spice -= own;
  if (fromAlly) {
    state.factions[allyOf(state, factionId)].spice -= fromAlly;
    state.meta.allyPledges[factionId] -= fromAlly;
  }
  return { own, fromAlly };
}

export function setPledge(state, giverId, amount) {
  const ally = allyOf(state, giverId);
  if (!ally) return 0;
  const pledge = Math.max(0, Math.min(Math.floor(amount), state.factions[giverId].spice));
  state.meta.allyPledges = { ...(state.meta.allyPledges ?? {}), [ally]: pledge };
  return pledge;
}

export function clearPledges(state) {
  state.meta.allyPledges = {};
}
