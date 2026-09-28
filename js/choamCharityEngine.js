// choamCharityEngine.js
//
// Phase 3: CHOAM Charity. The simplest phase in the game, deliberately a
// small file rather than folded into another engine, matching the
// one-phase-per-file convention used for bidding/movement/spice/battle.

import { recordTrigger } from './techTokens.js';

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

// multiplier: CHOAM's Inflation (2 when Double is up). With CHOAM seated,
// other factions' charity is paid from CHOAM's spice (decision D5: CHOAM has
// just collected 2 per faction, so it can always pay; any shortfall would come
// from the Bank). CHOAM's own normal charity comes from the Bank.
function claimCharity(state, factionId, { multiplier = 1, fromChoam = Boolean(state.factions.choam) } = {}) {
  const check = canClaimCharity(state, factionId);
  if (!check.ok) throw new Error(check.reason);

  const faction = state.factions[factionId];
  // Tops up to 2 spice for everyone except Bene Gesserit, who receive a
  // flat 2 regardless of current holdings (per their always-eligible ability).
  const amount = (factionId === 'gesserit' ? 2 : Math.max(0, 2 - faction.spice)) * multiplier;

  faction.spice += amount;
  faction.claimedCharityThisTurn = true;
  const payer = fromChoam && factionId !== 'choam' ? state.factions.choam : null;
  const fromCh = payer ? Math.min(amount, payer.spice) : 0;
  if (fromCh) payer.spice -= fromCh;
  state.spiceBank.totalInCirculation -= amount - fromCh;
  recordTrigger(state, 'spiceProd', factionId); // Tech Tokens: Spice Production

  return { factionId, amountReceived: amount, paidByChoam: fromCh };
}

function resetCharityFlags(state) {
  for (const factionId of Object.keys(state.factions)) {
    state.factions[factionId].claimedCharityThisTurn = false;
  }
  return state;
}

export {
  isEligibleForCharity,
  canClaimCharity,
  claimCharity,
  resetCharityFlags
};
