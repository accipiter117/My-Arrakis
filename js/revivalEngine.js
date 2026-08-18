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
  gesserit: 1
};

const FORCE_REVIVAL_CAP_PER_TURN = 3;
const FORCE_REVIVAL_SPICE_COST = 2;
const STARRED_REVIVAL_CAP_PER_TURN = 1; // "Only one Sardaukar/Fedaykin force can be revived per turn"

// --- Force revival ---------------------------------------------------

function freeRevivalAllowance(factionId) {
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
  if (amount > FORCE_REVIVAL_CAP_PER_TURN) {
    return { ok: false, reason: `Cannot revive more than ${FORCE_REVIVAL_CAP_PER_TURN} forces per turn, regardless of spice.` };
  }
  if ((faction.forcesRevivedThisTurn ?? 0) + amount > FORCE_REVIVAL_CAP_PER_TURN) {
    return { ok: false, reason: 'Would exceed the per-turn revival cap when combined with forces already revived this turn.' };
  }
  if (starredAmount > STARRED_REVIVAL_CAP_PER_TURN) {
    return { ok: false, reason: `Cannot revive more than ${STARRED_REVIVAL_CAP_PER_TURN} starred force per turn, regardless of the overall cap.` };
  }
  if ((faction.starredForcesRevivedThisTurn ?? 0) + starredAmount > STARRED_REVIVAL_CAP_PER_TURN) {
    return { ok: false, reason: 'Would exceed the per-turn starred-force revival cap.' };
  }

  const freeAllowance = freeRevivalAllowance(factionId);
  const alreadyUsedFree = Math.min(faction.forcesRevivedThisTurn ?? 0, freeAllowance);
  const remainingFree = Math.max(0, freeAllowance - alreadyUsedFree);
  const paidPortion = Math.max(0, amount - remainingFree);
  const cost = paidPortion * FORCE_REVIVAL_SPICE_COST;

  if (cost > faction.spice) {
    return { ok: false, reason: `Not enough spice, this revival needs ${cost} spice beyond the free allowance.` };
  }

  return { ok: true, cost, freeUsed: amount - paidPortion, paidUsed: paidPortion };
}

function reviveForces(state, factionId, amount, starredAmount = 0) {
  const check = canReviveForces(state, factionId, amount, starredAmount);
  if (!check.ok) throw new Error(check.reason);

  const faction = state.factions[factionId];
  faction.revivalTanks -= amount;
  faction.forces.reserve = (faction.forces.reserve ?? 0) + amount;
  faction.forcesRevivedThisTurn = (faction.forcesRevivedThisTurn ?? 0) + amount;
  faction.spice -= check.cost;
  state.spiceBank.totalInCirculation += check.cost;

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
function isEligibleForLeaderRevival(state, factionId) {
  const faction = state.factions[factionId];
  return (faction.leaders.available ?? []).length === 0;
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

  return { factionId, leaderId, cost: check.cost };
}

function resetRevivalTurnFlags(state) {
  for (const factionId of Object.keys(state.factions)) {
    state.factions[factionId].forcesRevivedThisTurn = 0;
    state.factions[factionId].starredForcesRevivedThisTurn = 0;
    state.factions[factionId].leaderRevivedThisTurn = false;
  }
  return state;
}

module.exports = {
  freeRevivalAllowance,
  canReviveForces,
  reviveForces,
  isEligibleForLeaderRevival,
  canReviveLeader,
  reviveLeader,
  resetRevivalTurnFlags
};
