// revivalEngine.js
//
// Phase 5: Revival. Sourced directly from the rulebook's Revival section
// and the Q&A clarification on leader revival's actual trigger condition.
//
// Known, flagged gap: leader "Dead Again" face-down rotation (a leader
// killed a second time can't be revived again until every OTHER
// revivable leader has cycled through revive-kill-tanks first) is not
// implemented. faction.leaders.killed is currently a flat array of ids
// with no face-up/face-down distinction, so this engine treats every
// killed leader as equally revivable. Restructuring that shape is a
// defined follow-up, not a silent omission, see DEAD_AGAIN_TODO.

const DEAD_AGAIN_TODO = 'leaders.killed does not yet distinguish face-up (revivable) from face-down (must wait for rotation) status';

const FREE_FORCE_REVIVAL = {
  atreides: 2,
  harkonnen: 2,
  emperor: 1,
  fremen: 3,
  guild: 1,
  gesserit: 1,
  tleilaxu: 2,
  ixians: 1
};

// Revival terms (Tleilaxu advanced rules). With the Tleilaxu in the game:
// other factions pay THEM for revival, and the Tleilaxu may raise a faction's
// limit to 5 for the turn; the Tleilaxu revive with no limit at half price
// (rounded up) paid to the Bank; the Tleilaxu's ally revives at half price.
function revivalTerms(state, factionId) {
  const terms = { cap: FORCE_REVIVAL_CAP_PER_TURN, halfPrice: false, payee: null };
  if (!state.factions.tleilaxu) return terms;
  if (factionId === 'tleilaxu') return { ...terms, cap: Infinity, halfPrice: true };
  const allyOfF = (state.alliances ?? []).find(a => a.factions.includes(factionId))?.factions.find(f => f !== factionId);
  return { cap: Math.max(terms.cap, state.meta.revivalLimitOverride?.[factionId] ?? 0), halfPrice: allyOfF === 'tleilaxu', payee: 'tleilaxu' };
}

const FORCE_REVIVAL_CAP_PER_TURN = 3;
const FORCE_REVIVAL_SPICE_COST = 2;
const STARRED_REVIVAL_CAP_PER_TURN = 1; // "Only one Sardaukar/Fedaykin force can be revived per turn"

// --- Force revival ---------------------------------------------------

// With state, includes the Fremen alliance advantage: the Fremen's ally
// revives up to 3 forces free each turn.
function freeRevivalAllowance(factionId, state) {
  const allyOfF = state ? (state.alliances ?? []).find(a => a.factions.includes(factionId))?.factions.find(f => f !== factionId) : null;
  if (allyOfF === 'fremen') return Math.max(FREE_FORCE_REVIVAL[factionId] ?? 0, 3);
  return FREE_FORCE_REVIVAL[factionId] ?? 0;
}

function canReviveForces(state, factionId, amount, starredAmount = 0) {
  const faction = state.factions[factionId];
  const tankedForces = faction.revivalTanks ?? 0;
  const tankedStarred = faction.starredRevivalTanks ?? 0;

  if (amount <= 0) return { ok: false, reason: 'Revival amount must be positive.' };
  if (starredAmount > amount) return { ok: false, reason: 'Starred forces revived cannot exceed total forces revived.' };
  if (amount > tankedForces) return { ok: false, reason: 'Not enough forces in the Tleilaxu Tanks.' };
  if (starredAmount > tankedStarred) return { ok: false, reason: 'Not enough starred forces in the Tleilaxu Tanks.' };
  if (amount - starredAmount > tankedForces - tankedStarred) {
    return { ok: false, reason: 'Not enough ordinary forces in the Tleilaxu Tanks; the rest there are starred, and only one starred force can be revived per turn.' };
  }
  const terms = revivalTerms(state, factionId);
  if (amount > terms.cap) {
    return { ok: false, reason: `Cannot revive more than ${terms.cap} forces per turn, regardless of spice.` };
  }
  if ((faction.forcesRevivedThisTurn ?? 0) + amount > terms.cap) {
    return { ok: false, reason: 'Would exceed the per-turn revival cap when combined with forces already revived this turn.' };
  }
  if (starredAmount > STARRED_REVIVAL_CAP_PER_TURN && factionId !== 'ixians') {
    return { ok: false, reason: `Cannot revive more than ${STARRED_REVIVAL_CAP_PER_TURN} starred force per turn, regardless of the overall cap.` };
  }
  if (factionId !== 'ixians' && (faction.starredForcesRevivedThisTurn ?? 0) + starredAmount > STARRED_REVIVAL_CAP_PER_TURN) {
    return { ok: false, reason: 'Would exceed the per-turn starred-force revival cap.' };
  }

  const freeAllowance = freeRevivalAllowance(factionId, state);
  const alreadyUsedFree = Math.min(faction.forcesRevivedThisTurn ?? 0, freeAllowance);
  const remainingFree = Math.max(0, freeAllowance - alreadyUsedFree);
  const paidPortion = Math.max(0, amount - remainingFree);
  let cost = paidPortion * FORCE_REVIVAL_SPICE_COST;
  if (factionId === 'ixians') cost += Math.min(starredAmount, paidPortion); // Cyborgs cost 3 each
  if (terms.halfPrice) cost = Math.ceil(cost / 2);

  if (cost > faction.spice) {
    return { ok: false, reason: `Not enough spice, this revival needs ${cost} spice beyond the free allowance.` };
  }

  return { ok: true, cost, freeUsed: amount - paidPortion, paidUsed: paidPortion, payee: terms.payee };
}

function reviveForces(state, factionId, amount, starredAmount = 0) {
  const check = canReviveForces(state, factionId, amount, starredAmount);
  if (!check.ok) throw new Error(check.reason);

  const faction = state.factions[factionId];
  faction.revivalTanks -= amount;
  faction.forces.reserve = (faction.forces.reserve ?? 0) + amount;
  faction.forcesRevivedThisTurn = (faction.forcesRevivedThisTurn ?? 0) + amount;
  faction.spice -= check.cost;
  if (check.payee === 'tleilaxu') state.factions.tleilaxu.spice += check.cost;   // revival pays the Tleilaxu
  else state.spiceBank.totalInCirculation += check.cost;
  // The Tleilaxu take 1 spice from the Bank for each faction using free revival.
  if (state.factions.tleilaxu && factionId !== 'tleilaxu' && check.freeUsed > 0 && !faction.freeRevivalTithed) {
    faction.freeRevivalTithed = true;
    state.factions.tleilaxu.spice += 1;
    state.spiceBank.totalInCirculation -= 1;
  }

  if (starredAmount > 0) {
    faction.starredRevivalTanks -= starredAmount;
    faction.forces.starredReserve = (faction.forces.starredReserve ?? 0) + starredAmount;
    faction.starredForcesRevivedThisTurn = (faction.starredForcesRevivedThisTurn ?? 0) + starredAmount;
  }

  return { factionId, amount, starredAmount, cost: check.cost };
}

// --- Leader revival --------------------------------------------------

// Per the rulebook's own Q&A (not just the literal player-sheet wording):
// the trigger is having NO leaders currently available to play in battle,
// which includes leaders that are dead OR currently held captured by
// another faction (e.g. Harkonnen's Captured Leaders ability), not
// strictly "all 5 physically in the Tanks."
// Rulebook: "If all 5 of a player's leaders are in the Tleilaxu Tanks they may
// revive 1 leader per turn until all of their leaders have been revived."
// So the window opens when no leader is available, and STAYS open (one a
// turn) until the tanks hold none of their leaders.
function isEligibleForLeaderRevival(state, factionId) {
  const faction = state.factions[factionId];
  if ((faction.leaders.killed ?? []).length === 0) return false;
  return (faction.leaders.available ?? []).length === 0 || Boolean(faction.leaderRevivalOpen);
}

// "Dead Again": a revived leader killed again stays face down until all of the
// player's other leaders in the tanks have been revived and killed again.
function isFaceDown(faction, leaderId) {
  const revived = faction.leaders.revivedOnce ?? [];
  if (!revived.includes(leaderId)) return false;
  return (faction.leaders.killed ?? []).some(id => !revived.includes(id));
}

function canReviveLeader(state, factionId, leaderId, leaderFightingValue) {
  const faction = state.factions[factionId];

  if (!isEligibleForLeaderRevival(state, factionId)) {
    return { ok: false, reason: 'Leader revival only triggers when the faction has no leaders currently available to play (dead or captured).' };
  }
  if (!(faction.leaders.killed ?? []).includes(leaderId)) {
    return { ok: false, reason: 'That leader is not in this faction\'s Tleilaxu Tanks.' };
  }
  if (faction.leaderRevivedThisTurn) {
    return { ok: false, reason: 'Only 1 leader may be revived per turn.' };
  }
  if (isFaceDown(faction, leaderId)) {
    return { ok: false, reason: 'Dead again: this leader cannot be revived until your other leaders in the tanks have been revived first.' };
  }
  if (leaderFightingValue > faction.spice) {
    return { ok: false, reason: `Reviving this leader costs ${leaderFightingValue} spice (their fighting strength), which exceeds current spice.` };
  }

  return { ok: true, cost: leaderFightingValue };
}

function reviveLeader(state, factionId, leaderId, leaderFightingValue) {
  const check = canReviveLeader(state, factionId, leaderId, leaderFightingValue);
  if (!check.ok) throw new Error(check.reason);

  const faction = state.factions[factionId];
  faction.leaders.killed = faction.leaders.killed.filter(id => id !== leaderId);
  faction.leaders.available.push(leaderId);
  faction.spice -= check.cost;
  faction.leaderRevivedThisTurn = true;
  state.spiceBank.totalInCirculation += check.cost;
  noteLeaderRevived(faction, leaderId);

  return { factionId, leaderId, cost: check.cost };
}

function resetRevivalTurnFlags(state) {
  for (const factionId of Object.keys(state.factions)) {
    state.factions[factionId].freeRevivalTithed = false;
    state.factions[factionId].forcesRevivedThisTurn = 0;
    state.factions[factionId].starredForcesRevivedThisTurn = 0;
    state.factions[factionId].leaderRevivedThisTurn = false;
  }
  return state;
}

// Emperor alliance advantage: the Emperor may pay for up to 3 extra forces
// for their ally each turn, beyond the ally's normal limit, at 2 spice each.
function canEmperorReviveForAlly(state, allyId, amount) {
  const emperor = state.factions.emperor, ally = state.factions[allyId];
  const allyOfEmperor = (state.alliances ?? []).find(a => a.factions.includes('emperor'))?.factions.find(f => f !== 'emperor');
  if (!emperor || allyOfEmperor !== allyId) return { ok: false, reason: 'Only the Emperor’s ally can be helped.' };
  if (amount < 1 || amount > 3) return { ok: false, reason: 'The Emperor may pay for 1 to 3 extra forces.' };
  const ordinaryInTanks = (ally.revivalTanks ?? 0) - (ally.starredRevivalTanks ?? 0);
  if (amount > ordinaryInTanks) return { ok: false, reason: 'Not that many forces in the tanks.' };
  if (amount * 2 > emperor.spice) return { ok: false, reason: 'The Emperor cannot afford that.' };
  return { ok: true, cost: amount * 2 };
}

function emperorRevivesForAlly(state, allyId, amount) {
  const check = canEmperorReviveForAlly(state, allyId, amount);
  if (!check.ok) throw new Error(check.reason);
  state.factions.emperor.spice -= check.cost;
  state.spiceBank.totalInCirculation += check.cost;
  state.factions[allyId].revivalTanks -= amount;
  state.factions[allyId].forces.reserve += amount;
  return { payer: 'emperor', factionId: allyId, amount, cost: check.cost };
}

// Bookkeeping shared by paid revival and the Ghola card.
function noteLeaderRevived(faction, leaderId) {
  // Once every leader is back, the Dead Again cycle starts over.
  if (!faction.leaders.killed.length) {
    faction.leaderRevivalOpen = false;
    faction.leaders.revivedOnce = [];
  } else {
    faction.leaderRevivalOpen = true;
    faction.leaders.revivedOnce = [...new Set([...(faction.leaders.revivedOnce ?? []), leaderId])];
  }
}

export {
  revivalTerms,
  noteLeaderRevived,
  isFaceDown,
  canEmperorReviveForAlly,
  emperorRevivesForAlly,
  freeRevivalAllowance,
  canReviveForces,
  reviveForces,
  isEligibleForLeaderRevival,
  canReviveLeader,
  reviveLeader,
  resetRevivalTurnFlags
};
