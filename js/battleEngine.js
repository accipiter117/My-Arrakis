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
  if (factionId === 'ixians') return 2; // Cyborgs
  if (factionId === 'emperor') {
    return opponentFactionId === 'fremen' ? 1 : 2; // Sardaukar's stated exception
  }
  if (factionId === 'fremen') {
    return 2; // Fedaykin, no stated exception either direction
  }
  return 0; // no other faction has starred units
}

// --- Battle Plan validation ------------------------------------------

// Card categories that can fill each slot (base game plus the Ixians &
// Tleilaxu cards). Chemistry (a defence) may fill the weapon slot alongside
// another defence; Weirding Way (a weapon) may fill the defence slot
// alongside another weapon.
const WEAPONS = ['poisonWeapon', 'projectileWeapon', 'specialWeapon', 'poisonBlade', 'weirdingWay', 'poisonTooth', 'artilleryStrike'];
const DEFENSES = ['poisonDefense', 'projectileDefense', 'shieldSnooper', 'chemistry'];

// What a plan's cards effectively ARE in their slots, as sets of tags:
//   weapon:  proj, poison, lasgun, tooth, artillery
//   defence: proj, poison, shield (a real Shield, for Lasgun explosions and Artillery)
function slotKinds(plan, cardLookup) {
  const w = plan.weaponCardId ? cardLookup[plan.weaponCardId] : null;
  const d = plan.defenseCardId ? cardLookup[plan.defenseCardId] : null;
  const weapon = new Set({
    projectileWeapon: ['proj'], poisonWeapon: ['poison'], specialWeapon: ['lasgun'], poisonBlade: ['proj', 'poison'],
    weirdingWay: ['proj'], poisonTooth: ['tooth'], artilleryStrike: ['artillery'],
    chemistry: d ? ['poison'] : []                       // Chemistry as a weapon, alongside a defence
  }[w?.category] ?? []);
  const defense = new Set({
    projectileDefense: ['proj', 'shield'], poisonDefense: ['poison'], shieldSnooper: ['proj', 'poison', 'shield'],
    chemistry: ['poison'],
    weirdingWay: w ? ['proj'] : []                       // Weirding Way as a defence, alongside a weapon
  }[d?.category] ?? []);
  return { weapon, defense };
}
const isShieldCard = card => ['projectileDefense', 'shieldSnooper'].includes(card?.category);

function checkPlanCards(state, factionId, plan, cardLookup) {
  const hand = state.factions[factionId].treacheryHand ?? [];
  const slots = [
    ['weaponCardId', [...WEAPONS, 'worthless', 'chemistry'], 'weapon'],
    ['defenseCardId', [...DEFENSES, 'worthless', 'weirdingWay'], 'defence'],
    ['cheapHeroCardId', ['specialLeaderSubstitute'], 'Cheap Hero']
  ];
  const used = [];
  for (const [key, allowed, label] of slots) {
    const id = plan[key];
    if (!id) continue;
    if (!hand.includes(id)) return { ok: false, reason: `The ${label} card played is not in your hand.` };
    if (!allowed.includes(cardLookup[id]?.category)) return { ok: false, reason: `That card cannot be played as a ${label}.` };
    if (used.includes(id)) return { ok: false, reason: 'The same card cannot fill two slots.' };
    used.push(id);
  }
  if (plan.cheapHeroCardId && plan.leaderId) return { ok: false, reason: 'A Cheap Hero is played instead of a leader, not as well as one.' };
  if (cardLookup[plan.weaponCardId]?.category === 'chemistry' && !plan.defenseCardId) return { ok: false, reason: 'Chemistry can only be played as a weapon alongside another defence.' };
  if (cardLookup[plan.defenseCardId]?.category === 'weirdingWay' && !plan.weaponCardId) return { ok: false, reason: 'Weirding Way can only be played as a defence alongside another weapon.' };
  return { ok: true };
}

function canDeclareBattlePlan(state, territoryId, factionId, plan, cardLookup) {
  if (cardLookup) {
    const cardCheck = checkPlanCards(state, factionId, plan, cardLookup);
    if (!cardCheck.ok) return cardCheck;
  }
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
    ? isLeaderAvailable(state, factionId, leaderId, territoryId)
    : false;
  if (!leaderId && !cheapHeroCardId) {
    const anyLeaderAvailable = (faction.leaders.available ?? []).some(id => isLeaderAvailable(state, factionId, id, territoryId));
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

// A leader may fight more than once in the SAME territory in a Battle
// phase, but not in two different territories.
function isLeaderAvailable(state, factionId, leaderId, territoryId) {
  const faction = state.factions[factionId];
  if (!(faction.leaders.available ?? []).includes(leaderId)) return false;
  const usedIn = state.battle?.leaderTerritory?.[leaderId];
  return !usedIn || usedIn === territoryId;
}

// --- Strength calculation ------------------------------------------------

// Advanced rule: Fremen forces count at full strength in battle without
// spice. Applied wherever strength is computed, so every dialed Fremen force
// counts as supported (and the Fremen never need to commit spice).
function fremenFullStrength(factionId, plan) {
  // Ixian Suboids can never be boosted with spice: they always count half.
  if (factionId === 'ixians') return { ...plan, supportedOrdinaryCount: 0 };
  if (factionId !== 'fremen') return plan;
  const starred = plan.starredForcesCommitted ?? 0;
  return { ...plan, supportedStarredCount: starred, supportedOrdinaryCount: (plan.forcesCommitted ?? 0) - starred };
}

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
  const A = slotKinds(aggressorPlan, cardLookup), D = slotKinds(defenderPlan, cardLookup);

  // Lasgun/shield explosion: EITHER side plays a Lasgun and EITHER side a Shield.
  if ((A.weapon.has('lasgun') || D.weapon.has('lasgun')) && (A.defense.has('shield') || D.defense.has('shield'))) {
    return { explosion: true, aggressorLeaderKilled: false, defenderLeaderKilled: false, leadersCount: true, noSpiceForKills: false };
  }
  let aggressorLeaderKilled = killsLeader(D.weapon, A.defense);
  let defenderLeaderKilled = killsLeader(A.weapon, D.defense);
  let leadersCount = true, noSpiceForKills = false;

  // Poison Tooth (unless its owner withheld it after the reveal): kills BOTH
  // leaders; a Snooper does not stop it.
  if ((A.weapon.has('tooth') && !aggressorPlan.poisonToothWithheld) || (D.weapon.has('tooth') && !defenderPlan.poisonToothWithheld)) {
    aggressorLeaderKilled = true; defenderLeaderKilled = true;
  }
  // Artillery Strike: kills both leaders unless shielded; surviving leaders
  // do not count, and no spice is paid for the kills.
  if (A.weapon.has('artillery') || D.weapon.has('artillery')) {
    if (!A.defense.has('shield')) aggressorLeaderKilled = true;
    if (!D.defense.has('shield')) defenderLeaderKilled = true;
    leadersCount = false; noSpiceForKills = true;
  }
  return { explosion: false, aggressorLeaderKilled, defenderLeaderKilled, leadersCount, noSpiceForKills };
}

// Does an incoming weapon (its tags) kill a leader protected by these defence tags?
function killsLeader(weapon, defense) {
  if (weapon.has('lasgun')) return true;                                             // no Shield, so no explosion: it kills
  if (weapon.has('proj') && weapon.has('poison')) return !(defense.has('proj') && defense.has('poison')); // Poison Blade
  if (weapon.has('proj')) return !defense.has('proj');
  if (weapon.has('poison')) return !defense.has('poison');
  return false;                                                                       // no weapon, or a worthless bluff
}

// --- Traitor check --------------------------------------------------------

function checkTraitor(revealingFactionState, opponentLeaderId) {
  return (revealingFactionState.traitorHand ?? []).includes(opponentLeaderId);
}

// --- Full battle resolution -----------------------------------------------

// traitorCalls (optional): { [factionId]: true } for each side that chose to
// reveal a traitor. Eligibility and the choice are made by the turn runner
// (it also handles Harkonnen traitors used for an ally). Without it, any
// eligible traitor is revealed automatically.
// Zoal (Tleilaxu) has no printed value: he takes the value of the opposing
// leader disc (0 against a Cheap Hero or no leader).
function withZoal(plan, other) {
  if (plan.leaderId !== 'zoal') return plan;
  return { ...plan, leaderFightingValue: other.leaderId && other.leaderId !== 'zoal' ? (other.leaderFightingValue ?? 0) : 0 };
}

function resolveBattle(state, territoryId, aggressorFactionId, defenderFactionId, aggressorPlanRaw, defenderPlanRaw, cardLookup, traitorCalls) {
  const aggressorPlanInput = withZoal(aggressorPlanRaw, defenderPlanRaw);
  const defenderPlanInput = withZoal(defenderPlanRaw, aggressorPlanRaw);
  // Traitor check first: either side may hold a traitor card matching the
  // OTHER side's leader. Cheap heroes can't be traitors (no leaderId).
  const aggressorHoldsTraitor = traitorCalls ? Boolean(traitorCalls[aggressorFactionId]) : isTraitorAgainst(state, aggressorFactionId, defenderPlanInput.leaderId);
  const defenderHoldsTraitor = traitorCalls ? Boolean(traitorCalls[defenderFactionId]) : isTraitorAgainst(state, defenderFactionId, aggressorPlanInput.leaderId);

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
    ...fremenFullStrength(aggressorFactionId, aggressorPlanInput),
    starredUnitValue: starredUnitValueFor(aggressorFactionId, defenderFactionId),
    kwisatzHaderachBonus: kwisatzHaderachBonusFor(state, aggressorFactionId, territoryId, aggressorPlanInput)
  };
  const defenderPlan = {
    ...fremenFullStrength(defenderFactionId, defenderPlanInput),
    starredUnitValue: starredUnitValueFor(defenderFactionId, aggressorFactionId),
    kwisatzHaderachBonus: kwisatzHaderachBonusFor(state, defenderFactionId, territoryId, defenderPlanInput)
  };

  // (Artillery Strike: surviving leaders do not count either.)
  const aggressorStrength = calculateStrength({
    ...aggressorPlan,
    leaderWasKilled: weaponResult.aggressorLeaderKilled || !weaponResult.leadersCount
  });
  const defenderStrength = calculateStrength({
    ...defenderPlan,
    leaderWasKilled: weaponResult.defenderLeaderKilled || !weaponResult.leadersCount
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

  return {
    ...applyBattleOutcome(state, territoryId, {
      winnerFactionId, loserFactionId, winnerPlan, loserPlan,
      winnerLeaderKilled, loserLeaderKilled, noSpiceForKills: weaponResult.noSpiceForKills
    }),
    leadersCount: weaponResult.leadersCount
  };
}

function removeForcesFromTerritory(state, factionId, territoryId, totalToRemove, starredToRemove) {
  const faction = state.factions[factionId];
  faction.revivalTanks = (faction.revivalTanks ?? 0) + totalToRemove;

  faction.forces.onBoard[territoryId] = (faction.forces.onBoard[territoryId] ?? 0) - totalToRemove;
  if (faction.forces.onBoard[territoryId] <= 0) delete faction.forces.onBoard[territoryId];

  if (starredToRemove > 0) {
    faction.starredRevivalTanks = (faction.starredRevivalTanks ?? 0) + starredToRemove;
    faction.forces.starredOnBoard[territoryId] = (faction.forces.starredOnBoard[territoryId] ?? 0) - starredToRemove;
    if (faction.forces.starredOnBoard[territoryId] <= 0) delete faction.forces.starredOnBoard[territoryId];
  }

  recordForceLossForKwisatzHaderach(state, factionId, totalToRemove);
}

function wipeAllForcesFromTerritory(state, factionId, territoryId) {
  const faction = state.factions[factionId];
  const total = faction.forces.onBoard[territoryId] ?? 0;
  faction.revivalTanks = (faction.revivalTanks ?? 0) + total;
  faction.starredRevivalTanks = (faction.starredRevivalTanks ?? 0) + (faction.forces.starredOnBoard?.[territoryId] ?? 0);
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
    spiceOwedToWinner += killLeader(state, winnerFactionId, winnerPlan.leaderId, winnerPlan.leaderFightingValue);
  }
  if (loserLeaderKilled && loserPlan.leaderId) {
    spiceOwedToWinner += killLeader(state, loserFactionId, loserPlan.leaderId, loserPlan.leaderFightingValue);
  }
  if (outcome.noSpiceForKills) spiceOwedToWinner = 0; // Artillery Strike: no spice for the dead
  winner.spice += spiceOwedToWinner;
  state.spiceBank.totalInCirculation -= spiceOwedToWinner;

  // Card discard: loser discards everything they played, always.
  // Winner may keep or discard, that's a decision point for the UI/AI
  // layer, not resolved automatically here.
  discardPlanCards(state, loserFactionId, loserPlan);

  return { winnerFactionId, loserFactionId, spiceOwedToWinner };
}

// Returns the leader's fighting value, which is the spice the battle
// winner collects for it. The value comes from the battle plan itself
// (every plan already declares leaderFightingValue), so this module still
// needs no dependency on leaders.json.
function killLeader(state, holderFactionId, leaderId, fightingValue = 0) {
  const holder = state.factions[holderFactionId];
  holder.leaders.available = holder.leaders.available.filter(id => id !== leaderId);
  const captured = capturedLeaders(state);
  const originalOwner = holderFactionId === 'harkonnen' ? captured[leaderId] : null;
  // A Tleilaxu Ghola goes back to its ORIGINAL owner's tanks.
  const gholas = holderFactionId === 'tleilaxu' ? holder.specialFactionState?.gholas : null;
  const gholaOwner = gholas?.[leaderId] ?? null;
  (originalOwner ? state.factions[originalOwner] : gholaOwner ? state.factions[gholaOwner] : holder).leaders.killed.push(leaderId);
  if (originalOwner) delete captured[leaderId];
  if (gholaOwner) delete gholas[leaderId];
  return fightingValue ?? 0;
}

// --- Traitors and Harkonnen captured leaders -------------------------------

function capturedLeaders(state) {
  const h = state.factions.harkonnen;
  if (!h) return {};
  h.specialFactionState = h.specialFactionState ?? {};
  h.specialFactionState.captured = h.specialFactionState.captured ?? {};
  return h.specialFactionState.captured; // leaderId -> original owner
}

// A leader is a traitor to `revealerId` if they hold its traitor card, or
// if Harkonnen is playing a leader captured from them: a captured leader
// always stays loyal to its original owner.
function isTraitorAgainst(state, revealerId, leaderId) {
  if (!leaderId) return false;
  if ((state.factions[revealerId].traitorHand ?? []).includes(leaderId)) return true;
  return state.factions.harkonnen ? capturedLeaders(state)[leaderId] === revealerId : false;
}

// Loser's leaders Harkonnen may capture: any still alive, including the one
// used in this battle, but not one that fought elsewhere this turn.
function captureCandidates(state, loserId, territoryId) {
  const captured = capturedLeaders(state);
  return state.factions[loserId].leaders.available.filter(id => {
    const usedIn = state.battle?.leaderTerritory?.[id];
    return (!usedIn || usedIn === territoryId) && !captured[id];
  });
}

function applyCapture(state, loserId, leaderId, action) {
  const loser = state.factions[loserId];
  const harkonnen = state.factions.harkonnen;
  loser.leaders.available = loser.leaders.available.filter(id => id !== leaderId);
  if (action === 'keep') {
    harkonnen.leaders.available.push(leaderId);
    capturedLeaders(state)[leaderId] = loserId;
  } else {
    loser.leaders.killed.push(leaderId); // to the tanks; the owner may revive it later
    harkonnen.spice += 2;
    state.spiceBank.totalInCirculation -= 2;
  }
}

// A captured leader is used once, then returns to its owner if it lived.
function returnCapturedLeader(state, leaderId) {
  const captured = capturedLeaders(state);
  const owner = captured[leaderId];
  if (!owner) return;
  const harkonnen = state.factions.harkonnen;
  if (harkonnen.leaders.available.includes(leaderId)) {
    harkonnen.leaders.available = harkonnen.leaders.available.filter(id => id !== leaderId);
    state.factions[owner].leaders.available.push(leaderId);
  }
  delete captured[leaderId];
}

// If every Harkonnen leader of their own is dead, captured ones go home.
function returnAllCapturedIfNeeded(state) {
  if (!state.factions.harkonnen) return;
  const captured = capturedLeaders(state);
  const ownAlive = state.factions.harkonnen.leaders.available.filter(id => !captured[id]);
  if (ownAlive.length === 0) for (const id of Object.keys(captured)) returnCapturedLeader(state, id);
}

// --- Bene Gesserit Voice -----------------------------------------------------

const VOICE_CATEGORIES = ['poisonWeapon', 'projectileWeapon', 'specialWeapon', 'poisonDefense', 'projectileDefense', 'worthless', 'specialLeaderSubstitute'];
// Does this card count as the named type (for the Voice)? New cards count as
// every type they are: a Poison Blade is a poison AND a projectile weapon.
function cardIsType(card, type) {
  if (!card) return false;
  if (card.category === type) return true;
  const c = card.category;
  return (type === 'projectileWeapon' && ['poisonBlade', 'weirdingWay'].includes(c))
    || (type === 'poisonWeapon' && c === 'poisonBlade')
    || (type === 'specialWeapon' && ['poisonTooth', 'artilleryStrike'].includes(c))
    || (type === 'projectileDefense' && c === 'shieldSnooper')
    || (type === 'poisonDefense' && ['shieldSnooper', 'chemistry'].includes(c));
}

// Makes a plan obey a Voice command where the player is able to; if they
// can't comply (no such card), they may play as they wish.
function enforceVoice(state, factionId, plan, voice, cardLookup) {
  if (!voice) return plan;
  const cat = id => cardLookup[id]?.category;
  const is = (id, type) => cardIsType(cardLookup[id], type);
  const p = { ...plan };
  const slotsFor = category => category === 'specialLeaderSubstitute' ? ['cheapHeroCardId']
    : WEAPONS.includes(category) ? ['weaponCardId'] : DEFENSES.includes(category) ? ['defenseCardId']
    : ['weaponCardId', 'defenseCardId'];
  if (voice.command === 'notPlay') {
    for (const key of ['weaponCardId', 'defenseCardId', 'cheapHeroCardId']) {
      if (p[key] && is(p[key], voice.category)) p[key] = null;
    }
    if (voice.category === 'specialLeaderSubstitute' && !p.leaderId) {
      const leader = state.factions[factionId].leaders.available.find(id => isLeaderAvailable(state, factionId, id, plan.territoryId));
      if (leader) p.leaderId = leader;
    }
    return p;
  }
  const already = ['weaponCardId', 'defenseCardId', 'cheapHeroCardId'].some(k => p[k] && is(p[k], voice.category));
  if (already) return p;
  const inPlan = new Set([p.weaponCardId, p.defenseCardId, p.cheapHeroCardId]);
  const card = state.factions[factionId].treacheryHand.find(id => is(id, voice.category) && !inPlan.has(id)
    && !['chemistry', 'weirdingWay'].includes(cat(id)));
  if (!card) return p; // cannot comply
  const slots = slotsFor(voice.category);
  const slot = slots.find(k => !p[k]) ?? slots[0];
  p[slot] = card;
  if (slot === 'cheapHeroCardId') { p.leaderId = null; p.leaderFightingValue = 0; p.useKwisatzHaderach = false; }
  return p;
}

// A minimal legal plan, used when a submitted plan breaks the rules.
function fallbackPlan(state, territoryId, factionId, cardLookup) {
  const faction = state.factions[factionId];
  const leaderId = faction.leaders.available.find(id => isLeaderAvailable(state, factionId, id, territoryId)) ?? null;
  const hero = leaderId ? null : faction.treacheryHand.find(id => cardLookup[id]?.category === 'specialLeaderSubstitute') ?? null;
  return {
    forcesCommitted: 0, starredForcesCommitted: 0, spiceCommitted: 0,
    supportedStarredCount: 0, supportedOrdinaryCount: 0,
    leaderId, leaderFightingValue: 0, cheapHeroCardId: hero,
    weaponCardId: null, defenseCardId: null, useKwisatzHaderach: false
  };
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
    spiceOwed = killLeader(state, revealedFactionId, leaderId, revealedPlan.leaderFightingValue);
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

export {
  withZoal,
  killLeader,
  slotKinds,
  isShieldCard,
  cardIsType,
  fremenFullStrength,
  WEAPONS,
  DEFENSES,
  VOICE_CATEGORIES,
  isLeaderAvailable,
  checkPlanCards,
  isTraitorAgainst,
  captureCandidates,
  applyCapture,
  returnCapturedLeader,
  returnAllCapturedIfNeeded,
  enforceVoice,
  fallbackPlan,
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
