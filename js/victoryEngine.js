// victoryEngine.js
//
// Phase 9: Mentat Pause. Standard stronghold victory is checked every
// turn; the Fremen and Guild special victory conditions only trigger
// "if no faction has won by the end of the last turn," per the rulebook,
// so they're gated on state.meta.turn === maxTurns rather than checked
// unconditionally every phase.

function strongholdIdsFrom(territoriesData) {
  return Object.keys(territoriesData.territories).filter(
    id => territoriesData.territories[id].type === 'stronghold'
  );
}

function strongholdsOccupiedBy(state, factionId, strongholdIds) {
  const forces = state.factions[factionId].forces.onBoard;
  return strongholdIds.filter(id => (forces[id] ?? 0) > 0);
}

function getAllianceFor(state, factionId) {
  return (state.alliances ?? []).find(a => a.factions.includes(factionId)) ?? null;
}

// --- Standard stronghold victory (checked every turn) --------------------

function checkSoloVictory(state, strongholdIds, requiredCount) {
  const winners = [];
  for (const factionId of Object.keys(state.factions)) {
    if (getAllianceFor(state, factionId)) continue; // allied factions win jointly, checked separately
    const held = strongholdsOccupiedBy(state, factionId, strongholdIds);
    if (held.length >= requiredCount) winners.push(factionId);
  }
  return winners;
}

function checkAllianceVictory(state, strongholdIds, requiredCount) {
  const checkedAlliances = new Set();
  const winningAlliances = [];

  for (const alliance of state.alliances ?? []) {
    const key = alliance.factions.slice().sort().join('+');
    if (checkedAlliances.has(key)) continue;
    checkedAlliances.add(key);

    // Allies can't occupy the same territory (per the rulebook's alliance
    // constraint), so a simple union with no overlap concern is safe here.
    const combinedHeld = new Set();
    for (const factionId of alliance.factions) {
      for (const strongholdId of strongholdsOccupiedBy(state, factionId, strongholdIds)) {
        combinedHeld.add(strongholdId);
      }
    }
    if (combinedHeld.size >= requiredCount) winningAlliances.push(alliance.factions);
  }

  return winningAlliances;
}

// --- Special victory conditions (final turn only) -------------------------

function checkFremenSpecialVictory(state) {
  if (!state.factions.fremen) return null;

  const sietchTabrOccupants = occupantsOf(state, 'sietchTabr');
  const habbanyaSietchOccupants = occupantsOf(state, 'habbanyaSietch');
  const tueksSietchOccupants = occupantsOf(state, 'tueksSietch');

  const fremenOrNoOneHoldsSietchTabr = sietchTabrOccupants.length === 0 || sietchTabrOccupants.every(f => f === 'fremen');
  const fremenOrNoOneHoldsHabbanya = habbanyaSietchOccupants.length === 0 || habbanyaSietchOccupants.every(f => f === 'fremen');

  // Per the rulebook: neither Harkonnen, Atreides, nor Emperor may occupy
  // Tuek's Sietch. The independent faction-reference cross-check we did
  // earlier noted Richese also blocks this if the CHOAM & Richese
  // expansion is active, included here since expansions default to
  // disabled but this should still be correct if they're ever turned on.
  const blockingFactions = ['harkonnen', 'atreides', 'emperor', 'richese'];
  const tueksSietchClear = !tueksSietchOccupants.some(f => blockingFactions.includes(f));

  if (fremenOrNoOneHoldsSietchTabr && fremenOrNoOneHoldsHabbanya && tueksSietchClear) {
    const allianceFactions = getAllianceFor(state, 'fremen')?.factions ?? ['fremen'];
    return allianceFactions;
  }
  return null;
}

function checkGuildSpecialVictory(state) {
  if (!state.factions.guild) return null;
  const allianceFactions = getAllianceFor(state, 'guild')?.factions ?? ['guild'];
  return allianceFactions;
}

// Per the rulebook's own Q&A: if Guild isn't in the game, Fremen wins
// instead. If Fremen also isn't in play, whoever holds the most
// strongholds wins, all tied factions win together.
function checkFallbackVictory(state, strongholdIds) {
  if (state.factions.fremen) {
    const allianceFactions = getAllianceFor(state, 'fremen')?.factions ?? ['fremen'];
    return allianceFactions;
  }

  let maxHeld = -1;
  let leaders = [];
  for (const factionId of Object.keys(state.factions)) {
    const held = strongholdsOccupiedBy(state, factionId, strongholdIds).length;
    if (held > maxHeld) {
      maxHeld = held;
      leaders = [factionId];
    } else if (held === maxHeld) {
      leaders.push(factionId);
    }
  }
  return leaders;
}

function occupantsOf(state, territoryId) {
  return Object.keys(state.factions).filter(
    factionId => (state.factions[factionId].forces.onBoard[territoryId] ?? 0) > 0
  );
}

// --- Full Mentat Pause resolution -----------------------------------------

function resolveMentatPause(state, territoriesData) {
  const strongholdIds = strongholdIdsFrom(territoriesData);
  const requiredCount = state.rulesConfig.victoryVariants.soloStrongholdCount;
  const allianceRequiredCount = state.rulesConfig.victoryVariants.allianceStrongholdCount;
  const maxTurns = state.rulesConfig.victoryVariants.maxTurns;

  const soloWinners = checkSoloVictory(state, strongholdIds, requiredCount);
  if (soloWinners.length > 0) {
    return { gameOver: true, winners: soloWinners, method: 'stronghold-solo' };
  }

  const allianceWins = checkAllianceVictory(state, strongholdIds, allianceRequiredCount);
  if (allianceWins.length > 0) {
    return { gameOver: true, winners: allianceWins[0], method: 'stronghold-alliance' };
  }

  if (state.meta.turn === maxTurns) {
    const fremenWin = checkFremenSpecialVictory(state);
    if (fremenWin) {
      return { gameOver: true, winners: fremenWin, method: 'fremen-special' };
    }
    const guildWin = checkGuildSpecialVictory(state);
    if (guildWin) {
      return { gameOver: true, winners: guildWin, method: 'guild-special' };
    }
    const fallbackWin = checkFallbackVictory(state, strongholdIds);
    return { gameOver: true, winners: fallbackWin, method: 'fallback-most-strongholds' };
  }

  return { gameOver: false, winners: [], method: null };
}

module.exports = {
  strongholdIdsFrom,
  strongholdsOccupiedBy,
  checkSoloVictory,
  checkAllianceVictory,
  checkFremenSpecialVictory,
  checkGuildSpecialVictory,
  checkFallbackVictory,
  resolveMentatPause
};
