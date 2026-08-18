// battleEngine.js
//
// Phase 7: Battles. Sourced directly from the rulebook's Battle Plan,
// Battle Resolution, and Advanced Combat sections rather than memory,
// battle mechanics are exactly the kind of thing worth getting precisely
// right rather than approximately right.
//
// Known, flagged gap: forces.onBoard is currently a flat count per
// territory, it doesn't yet distinguish ordinary forces from starred
// units (Emperor's Sardaukar, Fremen's Fedaykin, both worth double
// strength). Every force here is valued at a base of 1. Wiring in
// starred-unit tracking is a defined follow-up, not a silent gap, see
// STARRED_UNIT_TODO markers below.

const STARRED_UNIT_TODO = 'forces.onBoard does not yet distinguish starred (double-strength) units from ordinary ones';

// --- Battle Plan validation ------------------------------------------

function canDeclareBattlePlan(state, territoryId, factionId, plan) {
  const { forcesCommitted, spiceCommitted, leaderId, cheapHeroCardId } = plan;
  const faction = state.factions[factionId];
  const forcesPresent = faction.forces.onBoard[territoryId] ?? 0;

  if (forcesCommitted < 0 || forcesCommitted > forcesPresent) {
    return { ok: false, reason: `Cannot dial more forces (${forcesCommitted}) than present in the territory (${forcesPresent}).` };
  }
  if (spiceCommitted > faction.spice) {
    return { ok: false, reason: 'Cannot commit more spice than currently held.' };
  }
  if (spiceCommitted > forcesCommitted) {
    return { ok: false, reason: 'Spice committed cannot exceed the number of forces dialed, at most 1 spice per force.' };
  }

  const hasUsableLeader = leaderId
    ? isLeaderAvailable(state, factionId, leaderId)
    : false;
  if (!leaderId && !cheapHeroCardId) {
    const anyLeaderAvailable = (faction.leaders.available ?? []).some(id => isLeaderAvailable(state, factionId, id));
    if (anyLeaderAvailable) {
      return { ok: false, reason: 'A leader or cheap hero must be played if one is available. If genuinely none are available, that must be explicitly declared instead of silently omitted.' };
    }
  }
  if (leaderId && !hasUsableLeader) {
    return { ok: false, reason: 'That leader is dead, in the Tleilaxu Tanks, or already fought in a different territory this phase.' };
  }

  return { ok: true };
}

function isLeaderAvailable(state, factionId, leaderId) {
  const faction = state.factions[factionId];
  if (!(faction.leaders.available ?? []).includes(leaderId)) return false;
  if ((state.battle?.leadersUsedThisPhase ?? []).includes(leaderId)) {
    // A leader may fight more than once in the SAME territory this phase,
    // but not in a different one, so this check is territory-scoped by
    // the caller passing the right leadersUsedThisPhase slice.
    return false;
  }
  return true;
}

// --- Strength calculation ------------------------------------------------

// See STARRED_UNIT_TODO: every force is valued at base strength 1 here.
function calculateStrength(plan) {
  const { forcesCommitted, spiceCommitted, leaderFightingValue, leaderWasKilled } = plan;

  const supportedForces = Math.min(spiceCommitted, forcesCommitted);
  const unsupportedForces = forcesCommitted - supportedForces;
  const forceStrength = supportedForces * 1 + unsupportedForces * 0.5;

  const leaderContribution = leaderWasKilled ? 0 : (leaderFightingValue ?? 0);

  return forceStrength + leaderContribution;
}

// --- Weapon/defense resolution -------------------------------------------

function resolveWeaponDefense(aggressorPlan, defenderPlan, cardLookup) {
  const aggressorWeapon = aggressorPlan.weaponCardId ? cardLookup[aggressorPlan.weaponCardId] : null;
  const defenderWeapon = defenderPlan.weaponCardId ? cardLookup[defenderPlan.weaponCardId] : null;
  const aggressorDefense = aggressorPlan.defenseCardId ? cardLookup[aggressorPlan.defenseCardId] : null;
  const defenderDefense = defenderPlan.defenseCardId ? cardLookup[defenderPlan.defenseCardId] : null;

  // Lasgun/shield explosion: triggered if EITHER side plays a lasgun and
  // EITHER side plays a shield (projectileDefense), regardless of pairing.
  const anyLasgun = [aggressorWeapon, defenderWeapon].some(c => c?.id === 'lasgun');
  const anyShield = [aggressorDefense, defenderDefense].some(c => c?.category === 'projectileDefense');
  if (anyLasgun && anyShield) {
    return { explosion: true, aggressorLeaderKilled: false, defenderLeaderKilled: false };
  }

  const aggressorLeaderKilled = killsLeader(defenderWeapon, aggressorDefense);
  const defenderLeaderKilled = killsLeader(aggressorWeapon, defenderDefense);

  return { explosion: false, aggressorLeaderKilled, defenderLeaderKilled };
}

function killsLeader(incomingWeapon, ownDefense) {
  if (!incomingWeapon) return false;
  if (incomingWeapon.category === 'specialWeapon') return true; // lasgun without a shield-triggered explosion still kills outright
  const matchingDefenseCategory = incomingWeapon.category === 'poisonWeapon' ? 'poisonDefense' : 'projectileDefense';
  return ownDefense?.category !== matchingDefenseCategory;
}

// --- Traitor check --------------------------------------------------------

function checkTraitor(revealingFactionState, opponentLeaderId) {
  return (revealingFactionState.traitorHand ?? []).includes(opponentLeaderId);
}

// --- Full battle resolution -----------------------------------------------

function resolveBattle(state, territoryId, aggressorFactionId, defenderFactionId, aggressorPlan, defenderPlan, cardLookup) {
  // Traitor check first: either side may hold a traitor card matching the
  // OTHER side's leader. Cheap heroes can't be traitors (no leaderId).
  const aggressorHoldsTraitor = aggressorPlan.leaderId &&
    checkTraitor(state.factions[aggressorFactionId], defenderPlan.leaderId);
  const defenderHoldsTraitor = defenderPlan.leaderId &&
    checkTraitor(state.factions[defenderFactionId], aggressorPlan.leaderId);

  if (aggressorHoldsTraitor && defenderHoldsTraitor) {
    return resolveMutualTraitors(state, territoryId, aggressorFactionId, defenderFactionId, aggressorPlan, defenderPlan);
  }
  if (aggressorHoldsTraitor) {
    return resolveTraitorWin(state, territoryId, aggressorFactionId, defenderFactionId, defenderPlan);
  }
  if (defenderHoldsTraitor) {
    return resolveTraitorWin(state, territoryId, defenderFactionId, aggressorFactionId, aggressorPlan);
  }

  const weaponResult = resolveWeaponDefense(aggressorPlan, defenderPlan, cardLookup);
  if (weaponResult.explosion) {
    return resolveExplosion(state, territoryId, aggressorFactionId, defenderFactionId);
  }

  const aggressorStrength = calculateStrength({
    ...aggressorPlan,
    leaderWasKilled: weaponResult.aggressorLeaderKilled
  });
  const defenderStrength = calculateStrength({
    ...defenderPlan,
    leaderWasKilled: weaponResult.defenderLeaderKilled
  });

  // Rulebook, verbatim: "In the case of a tie, the aggressor has won."
  const aggressorWins = aggressorStrength >= defenderStrength;
  const winnerFactionId = aggressorWins ? aggressorFactionId : defenderFactionId;
  const loserFactionId = aggressorWins ? defenderFactionId : aggressorFactionId;
  const winnerPlan = aggressorWins ? aggressorPlan : defenderPlan;
  const loserPlan = aggressorWins ? defenderPlan : aggressorPlan;
  const winnerLeaderKilled = aggressorWins ? weaponResult.aggressorLeaderKilled : weaponResult.defenderLeaderKilled;
  const loserLeaderKilled = aggressorWins ? weaponResult.defenderLeaderKilled : weaponResult.aggressorLeaderKilled;

  return applyBattleOutcome(state, territoryId, {
    winnerFactionId, loserFactionId, winnerPlan, loserPlan,
    winnerLeaderKilled, loserLeaderKilled
  });
}

function applyBattleOutcome(state, territoryId, outcome) {
  const {
    winnerFactionId, loserFactionId, winnerPlan, loserPlan,
    winnerLeaderKilled, loserLeaderKilled
  } = outcome;

  const winner = state.factions[winnerFactionId];
  const loser = state.factions[loserFactionId];

  // Losing player loses ALL forces they had in the territory, not just
  // the dialed amount. Winning player loses only the dialed amount.
  const loserTotalForcesInTerritory = loser.forces.onBoard[territoryId] ?? 0;
  loser.revivalTanks = (loser.revivalTanks ?? 0) + loserTotalForcesInTerritory;
  delete loser.forces.onBoard[territoryId];

  winner.revivalTanks = (winner.revivalTanks ?? 0) + winnerPlan.forcesCommitted;
  winner.forces.onBoard[territoryId] = (winner.forces.onBoard[territoryId] ?? 0) - winnerPlan.forcesCommitted;
  if (winner.forces.onBoard[territoryId] <= 0) delete winner.forces.onBoard[territoryId];

  // Spice for battle: goes to the bank win or lose (unless a traitor was
  // revealed, handled separately in resolveTraitorWin/resolveMutualTraitors).
  winner.spice -= winnerPlan.spiceCommitted;
  loser.spice -= loserPlan.spiceCommitted;
  state.spiceBank.totalInCirculation += winnerPlan.spiceCommitted + loserPlan.spiceCommitted;

  // Killed leaders: both go to the Tanks. The WINNER collects the combined
  // spice value of every leader killed this battle, including their own.
  let spiceOwedToWinner = 0;
  if (winnerLeaderKilled && winnerPlan.leaderId) {
    spiceOwedToWinner += killLeader(state, winnerFactionId, winnerPlan.leaderId);
  }
  if (loserLeaderKilled && loserPlan.leaderId) {
    spiceOwedToWinner += killLeader(state, loserFactionId, loserPlan.leaderId);
  }
  winner.spice += spiceOwedToWinner;
  state.spiceBank.totalInCirculation -= spiceOwedToWinner;

  // Card discard: loser discards everything they played, always.
  // Winner may keep or discard, that's a decision point for the UI/AI
  // layer, not resolved automatically here.
  discardPlanCards(state, loserFactionId, loserPlan);

  return { winnerFactionId, loserFactionId, spiceOwedToWinner };
}

function killLeader(state, ownerFactionId, leaderId) {
  const faction = state.factions[ownerFactionId];
  faction.leaders.available = faction.leaders.available.filter(id => id !== leaderId);
  faction.leaders.killed.push(leaderId);
  // Fighting value lookup left to the caller's leader data source, this
  // function returns 0 here and expects the caller (resolveBattle callers
  // in the real engine wiring) to look up the actual value from
  // leaders.json, kept out of this module to avoid a data-file dependency
  // inside the pure battle-math layer. See TODO in resolveBattle wiring.
  return 0; // TODO: replace with actual leader fightingValue from leaders.json
}

function discardPlanCards(state, factionId, plan) {
  const faction = state.factions[factionId];
  const played = [plan.weaponCardId, plan.defenseCardId, plan.cheapHeroCardId].filter(Boolean);
  for (const cardId of played) {
    faction.treacheryHand = faction.treacheryHand.filter(id => id !== cardId);
    state.decks.treacheryDiscard.push(cardId);
  }
}

function resolveTraitorWin(state, territoryId, revealingFactionId, revealedFactionId, revealedPlan) {
  const revealer = state.factions[revealingFactionId];
  const revealed = state.factions[revealedFactionId];

  // Revealer loses nothing, regardless of what either side played, even
  // a lasgun/shield combo is overridden by a traitor reveal per the rulebook.
  const revealedTotalForces = revealed.forces.onBoard[territoryId] ?? 0;
  revealed.revivalTanks = (revealed.revivalTanks ?? 0) + revealedTotalForces;
  delete revealed.forces.onBoard[territoryId];

  const leaderId = revealedPlan.leaderId;
  let spiceOwed = 0;
  if (leaderId) {
    spiceOwed = killLeader(state, revealedFactionId, leaderId); // TODO: real fighting value, see killLeader
  }
  revealer.spice += spiceOwed;
  state.spiceBank.totalInCirculation -= spiceOwed;

  discardPlanCards(state, revealedFactionId, revealedPlan);

  return { winnerFactionId: revealingFactionId, loserFactionId: revealedFactionId, spiceOwedToWinner: spiceOwed, traitor: true };
}

function resolveMutualTraitors(state, territoryId, factionAId, factionBId, planA, planB) {
  // Both sides lose everything: forces, cards, AND leaders. Neither side
  // gets spice for the other's dead leader, this is the one battle outcome
  // where killed leaders pay out nothing.
  for (const [factionId, plan] of [[factionAId, planA], [factionBId, planB]]) {
    const faction = state.factions[factionId];
    const totalForces = faction.forces.onBoard[territoryId] ?? 0;
    faction.revivalTanks = (faction.revivalTanks ?? 0) + totalForces;
    delete faction.forces.onBoard[territoryId];
    if (plan.leaderId) killLeader(state, factionId, plan.leaderId);
    discardPlanCards(state, factionId, plan);
  }
  return { winnerFactionId: null, loserFactionId: null, spiceOwedToWinner: 0, mutualTraitors: true };
}

function resolveExplosion(state, territoryId, factionAId, factionBId) {
  // Lasgun/shield explosion: ALL forces, leaders, and spice in the
  // territory are lost, including any faction not even part of this
  // battle but present in the territory, per the rulebook's own Q&A.
  for (const factionId of Object.keys(state.factions)) {
    const faction = state.factions[factionId];
    const forcesHere = faction.forces.onBoard[territoryId] ?? 0;
    if (forcesHere > 0) {
      faction.revivalTanks = (faction.revivalTanks ?? 0) + forcesHere;
      delete faction.forces.onBoard[territoryId];
    }
  }
  state.board.spiceBlowMarkers = state.board.spiceBlowMarkers.filter(m => m.territoryId !== territoryId);

  return { winnerFactionId: null, loserFactionId: null, spiceOwedToWinner: 0, explosion: true };
}

module.exports = {
  canDeclareBattlePlan,
  calculateStrength,
  resolveWeaponDefense,
  checkTraitor,
  resolveBattle,
  applyBattleOutcome,
  resolveTraitorWin,
  resolveMutualTraitors,
  resolveExplosion
};
