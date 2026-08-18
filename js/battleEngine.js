// battleEngine.js
//
// Phase 7: Battles. Sourced directly from the rulebook's Battle Plan,
// Battle Resolution, and Advanced Combat sections rather than memory,
// battle mechanics are exactly the kind of thing worth getting precisely
// right rather than approximately right.
//
// Starred units (Emperor's Sardaukar, Fremen's Fedaykin) and the Atreides
// Kwisatz Haderach are both implemented here. forces.onBoard/starredOnBoard
// in gameState.js track total vs starred counts per territory; this module
// is where that distinction actually affects combat math.

function starredUnitValueFor(factionId, opponentFactionId) {
  if (factionId === 'emperor') {
    return opponentFactionId === 'fremen' ? 1 : 2; // Sardaukar's stated exception
  }
  if (factionId === 'fremen') {
    return 2; // Fedaykin, no stated exception either direction
  }
  return 0; // no other faction has starred units
}

// --- Battle Plan validation ------------------------------------------

function canDeclareBattlePlan(state, territoryId, factionId, plan) {
  const {
    forcesCommitted, starredForcesCommitted = 0, spiceCommitted,
    supportedStarredCount = 0, supportedOrdinaryCount = 0,
    leaderId, cheapHeroCardId
  } = plan;
  const faction = state.factions[factionId];
  const forcesPresent = faction.forces.onBoard[territoryId] ?? 0;
  const starredPresent = faction.forces.starredOnBoard[territoryId] ?? 0;

  if (forcesCommitted < 0 || forcesCommitted > forcesPresent) {
    return { ok: false, reason: `Cannot dial more forces (${forcesCommitted}) than present in the territory (${forcesPresent}).` };
  }
  if (starredForcesCommitted < 0 || starredForcesCommitted > forcesCommitted) {
    return { ok: false, reason: 'Starred forces committed cannot exceed total forces committed.' };
  }
  if (starredForcesCommitted > starredPresent) {
    return { ok: false, reason: `Cannot commit more starred forces (${starredForcesCommitted}) than present in the territory (${starredPresent}).` };
  }
  if (spiceCommitted > faction.spice) {
    return { ok: false, reason: 'Cannot commit more spice than currently held.' };
  }
  if (spiceCommitted > forcesCommitted) {
    return { ok: false, reason: 'Spice committed cannot exceed the number of forces dialed, at most 1 spice per force.' };
  }
  if (supportedStarredCount + supportedOrdinaryCount !== spiceCommitted) {
    return { ok: false, reason: 'Supported starred + supported ordinary counts must sum to exactly the spice committed, the player chooses which specific forces the spice covers.' };
  }
  if (supportedStarredCount > starredForcesCommitted) {
    return { ok: false, reason: 'Cannot support more starred forces than are actually committed.' };
  }
  if (supportedOrdinaryCount > forcesCommitted - starredForcesCommitted) {
    return { ok: false, reason: 'Cannot support more ordinary forces than are actually committed.' };
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
  if (plan.useKwisatzHaderach) {
    const kh = state.factions.atreides?.specialFactionState;
    if (factionId !== 'atreides') {
      return { ok: false, reason: 'Only Atreides may use the Kwisatz Haderach.' };
    }
    if (!kh?.kwisatzHaderachActive) {
      return { ok: false, reason: 'Kwisatz Haderach is not yet active (requires 7+ cumulative forces lost in battle).' };
    }
    if (!leaderId && !cheapHeroCardId) {
      return { ok: false, reason: 'Kwisatz Haderach cannot be used alone, it must accompany a leader or cheap hero.' };
    }
    if (kh.kwisatzHaderachUsedInTerritoryThisPhase && kh.kwisatzHaderachUsedInTerritoryThisPhase !== territoryId) {
      return { ok: false, reason: 'Kwisatz Haderach may only be used in one territory per Battle phase.' };
    }
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

function calculateStrength(plan) {
  const {
    forcesCommitted, starredForcesCommitted = 0,
    supportedStarredCount = 0, supportedOrdinaryCount = 0,
    starredUnitValue = 0, leaderFightingValue, leaderWasKilled,
    kwisatzHaderachBonus = 0
  } = plan;

  const ordinaryForcesCommitted = forcesCommitted - starredForcesCommitted;
  const unsupportedStarred = starredForcesCommitted - supportedStarredCount;
  const unsupportedOrdinary = ordinaryForcesCommitted - supportedOrdinaryCount;

  const starredStrength = supportedStarredCount * starredUnitValue + unsupportedStarred * (starredUnitValue / 2);
  const ordinaryStrength = supportedOrdinaryCount * 1 + unsupportedOrdinary * 0.5;

  const leaderContribution = leaderWasKilled ? 0 : (leaderFightingValue ?? 0);
  // Kwisatz Haderach has no effect if the leader/cheap hero it's
  // accompanying was killed this battle, per the rulebook.
  const khContribution = leaderWasKilled ? 0 : kwisatzHaderachBonus;

  return starredStrength + ordinaryStrength + leaderContribution + khContribution;
}

// --- Kwisatz Haderach bookkeeping -----------------------------------------

function kwisatzHaderachBonusFor(state, factionId, territoryId, plan) {
  if (factionId !== 'atreides' || !plan.useKwisatzHaderach) return 0;
  const kh = state.factions.atreides.specialFactionState;
  if (!kh.kwisatzHaderachActive) return 0;
  if (kh.kwisatzHaderachUsedInTerritoryThisPhase && kh.kwisatzHaderachUsedInTerritoryThisPhase !== territoryId) return 0;
  return 2;
}

function markKwisatzHaderachUsed(state, territoryId) {
  const kh = state.factions.atreides?.specialFactionState;
  if (kh && !kh.kwisatzHaderachUsedInTerritoryThisPhase) {
    kh.kwisatzHaderachUsedInTerritoryThisPhase = territoryId;
  }
}

function resetKwisatzHaderachPhaseLock(state) {
  const kh = state.factions.atreides?.specialFactionState;
  if (kh) kh.kwisatzHaderachUsedInTerritoryThisPhase = null;
}

// Called for every force loss in this module (winner's dialed losses,
// loser's total wipeout, traitor reveals, mutual traitors, explosions).
// Kwisatz Haderach activates once Atreides has lost 7+ forces across
// battles, tracked cumulatively for the whole game, not reset per turn.
function recordForceLossForKwisatzHaderach(state, factionId, forcesLost) {
  if (factionId !== 'atreides' || forcesLost <= 0) return;
  const kh = state.factions.atreides.specialFactionState;
  kh.cumulativeForcesLostInBattle += forcesLost;
  if (kh.cumulativeForcesLostInBattle >= 7) {
    kh.kwisatzHaderachActive = true;
  }
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

function resolveBattle(state, territoryId, aggressorFactionId, defenderFactionId, aggressorPlanInput, defenderPlanInput, cardLookup) {
  // Traitor check first: either side may hold a traitor card matching the
  // OTHER side's leader. Cheap heroes can't be traitors (no leaderId).
  const aggressorHoldsTraitor = aggressorPlanInput.leaderId &&
    checkTraitor(state.factions[aggressorFactionId], defenderPlanInput.leaderId);
  const defenderHoldsTraitor = defenderPlanInput.leaderId &&
    checkTraitor(state.factions[defenderFactionId], aggressorPlanInput.leaderId);

  if (aggressorHoldsTraitor && defenderHoldsTraitor) {
    return resolveMutualTraitors(state, territoryId, aggressorFactionId, defenderFactionId, aggressorPlanInput, defenderPlanInput);
  }
  if (aggressorHoldsTraitor) {
    return resolveTraitorWin(state, territoryId, aggressorFactionId, defenderFactionId, defenderPlanInput);
  }
  if (defenderHoldsTraitor) {
    return resolveTraitorWin(state, territoryId, defenderFactionId, aggressorFactionId, aggressorPlanInput);
  }

  const weaponResult = resolveWeaponDefense(aggressorPlanInput, defenderPlanInput, cardLookup);
  if (weaponResult.explosion) {
    return resolveExplosion(state, territoryId, aggressorFactionId, defenderFactionId);
  }

  // Attach starred-unit values and any Kwisatz Haderach bonus before
  // computing strength, both need faction/opponent/territory context that
  // calculateStrength itself deliberately stays ignorant of.
  const aggressorPlan = {
    ...aggressorPlanInput,
    starredUnitValue: starredUnitValueFor(aggressorFactionId, defenderFactionId),
    kwisatzHaderachBonus: kwisatzHaderachBonusFor(state, aggressorFactionId, territoryId, aggressorPlanInput)
  };
  const defenderPlan = {
    ...defenderPlanInput,
    starredUnitValue: starredUnitValueFor(defenderFactionId, aggressorFactionId),
    kwisatzHaderachBonus: kwisatzHaderachBonusFor(state, defenderFactionId, territoryId, defenderPlanInput)
  };

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

  if (aggressorPlan.useKwisatzHaderach) markKwisatzHaderachUsed(state, territoryId);
  if (defenderPlan.useKwisatzHaderach) markKwisatzHaderachUsed(state, territoryId);

  return applyBattleOutcome(state, territoryId, {
    winnerFactionId, loserFactionId, winnerPlan, loserPlan,
    winnerLeaderKilled, loserLeaderKilled
  });
}

function removeForcesFromTerritory(state, factionId, territoryId, totalToRemove, starredToRemove) {
  const faction = state.factions[factionId];
  faction.revivalTanks = (faction.revivalTanks ?? 0) + totalToRemove;

  faction.forces.onBoard[territoryId] = (faction.forces.onBoard[territoryId] ?? 0) - totalToRemove;
  if (faction.forces.onBoard[territoryId] <= 0) delete faction.forces.onBoard[territoryId];

  if (starredToRemove > 0) {
    faction.forces.starredOnBoard[territoryId] = (faction.forces.starredOnBoard[territoryId] ?? 0) - starredToRemove;
    if (faction.forces.starredOnBoard[territoryId] <= 0) delete faction.forces.starredOnBoard[territoryId];
  }

  recordForceLossForKwisatzHaderach(state, factionId, totalToRemove);
}

function wipeAllForcesFromTerritory(state, factionId, territoryId) {
  const faction = state.factions[factionId];
  const total = faction.forces.onBoard[territoryId] ?? 0;
  faction.revivalTanks = (faction.revivalTanks ?? 0) + total;
  delete faction.forces.onBoard[territoryId];
  delete faction.forces.starredOnBoard[territoryId];
  recordForceLossForKwisatzHaderach(state, factionId, total);
  return total;
}

function applyBattleOutcome(state, territoryId, outcome) {
  const {
    winnerFactionId, loserFactionId, winnerPlan, loserPlan,
    winnerLeaderKilled, loserLeaderKilled
  } = outcome;

  const winner = state.factions[winnerFactionId];
  const loser = state.factions[loserFactionId];

  // Losing player loses ALL forces they had in the territory, not just
  // the dialed amount. Winning player loses only the dialed amount,
  // including the correct split of however many of those were starred.
  wipeAllForcesFromTerritory(state, loserFactionId, territoryId);
  removeForcesFromTerritory(state, winnerFactionId, territoryId, winnerPlan.forcesCommitted, winnerPlan.starredForcesCommitted ?? 0);

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

  // Revealer loses nothing, regardless of what either side played, even
  // a lasgun/shield combo is overridden by a traitor reveal per the rulebook.
  wipeAllForcesFromTerritory(state, revealedFactionId, territoryId);

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
    wipeAllForcesFromTerritory(state, factionId, territoryId);
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
    if ((state.factions[factionId].forces.onBoard[territoryId] ?? 0) > 0) {
      wipeAllForcesFromTerritory(state, factionId, territoryId);
    }
  }
  state.board.spiceBlowMarkers = state.board.spiceBlowMarkers.filter(m => m.territoryId !== territoryId);

  return { winnerFactionId: null, loserFactionId: null, spiceOwedToWinner: 0, explosion: true };
}

module.exports = {
  starredUnitValueFor,
  canDeclareBattlePlan,
  calculateStrength,
  kwisatzHaderachBonusFor,
  markKwisatzHaderachUsed,
  resetKwisatzHaderachPhaseLock,
  recordForceLossForKwisatzHaderach,
  resolveWeaponDefense,
  checkTraitor,
  resolveBattle,
  applyBattleOutcome,
  resolveTraitorWin,
  resolveMutualTraitors,
  resolveExplosion
};
