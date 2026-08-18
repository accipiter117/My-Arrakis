// choamCharityEngine.js
//
// Phase 3: CHOAM Charity. The simplest phase in the game, deliberately a
// small file rather than folded into another engine, matching the
// one-phase-per-file convention used for bidding/movement/spice/battle.

function isEligibleForCharity(state, factionId) {
  // Bene Gesserit's advanced ability: always eligible regardless of
  // current spice, everyone else needs 0 or 1 spice.
  if (factionId === 'gesserit') return true;
  return state.factions[factionId].spice <= 1;
}

function canClaimCharity(state, factionId) {
  if (!isEligibleForCharity(state, factionId)) {
    return { ok: false, reason: 'Faction holds more than 1 spice and has no ability overriding the threshold.' };
  }
  if (state.factions[factionId].claimedCharityThisTurn) {
    return { ok: false, reason: 'Charity can only be claimed once per turn.' };
  }
  return { ok: true };
}

function claimCharity(state, factionId) {
  const check = canClaimCharity(state, factionId);
  if (!check.ok) throw new Error(check.reason);

  const faction = state.factions[factionId];
  // Tops up to 2 spice for everyone except Bene Gesserit, who receive a
  // flat 2 regardless of current holdings (per their always-eligible ability).
  const amount = factionId === 'gesserit' ? 2 : Math.max(0, 2 - faction.spice);

  faction.spice += amount;
  faction.claimedCharityThisTurn = true;
  state.spiceBank.totalInCirculation -= amount;

  return { factionId, amountReceived: amount };
}

function resetCharityFlags(state) {
  for (const factionId of Object.keys(state.factions)) {
    state.factions[factionId].claimedCharityThisTurn = false;
  }
  return state;
}

module.exports = {
  isEligibleForCharity,
  canClaimCharity,
  claimCharity,
  resetCharityFlags
};
