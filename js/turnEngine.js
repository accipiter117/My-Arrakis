// turnEngine.js
//
// Orchestrates one full turn by walking phaseEngine.js's PHASE_ORDER and
// calling the real phase engine for each step. Two kinds of phases:
//
//   DETERMINISTIC: Spice Blow, CHOAM Charity eligibility, Spice Collection,
//   Mentat Pause. These have no genuine strategic choice involved (or the
//   "choice" is always correct, like claiming free charity), so they run
//   for real, fully, no stub involved.
//
//   DECISION-DEPENDENT: Storm dial values, Bidding, Revival amounts,
//   Shipment & Movement, Battles, Alliance actions. These need actual
//   strategy, which is the AI layer, explicitly separate, not-yet-built
//   work. This file defines the interface those decisions come through
//   (`decisionProvider`) and calls it, but does NOT implement strategy.
//   `passiveDecisionProvider` below is a minimal, always-legal stub used
//   to prove the turn loop mechanically works, not a real opponent.

const phaseEngine = require('./phaseEngine.js');
const stormEngine = require('./stormEngine.js');
const spiceEngine = require('./spiceEngine.js');
const choamCharityEngine = require('./choamCharityEngine.js');
const biddingEngine = require('./biddingEngine.js');
const revivalEngine = require('./revivalEngine.js');
const movementEngine = require('./movementEngine.js');
const battleEngine = require('./battleEngine.js');
const spiceCollectionEngine = require('./spiceCollectionEngine.js');
const victoryEngine = require('./victoryEngine.js');
const allianceEngine = require('./allianceEngine.js');

// --- The decision provider interface --------------------------------
//
// Every method takes (state, ...context) and returns a plain decision
// object. None of them may mutate state directly, the phase runner below
// applies whatever they return through the real engine functions, same
// as a human or AI action would go through canX()/executeX().

const passiveDecisionProvider = {
  // 0 is legal for the first storm (0-20 range), 1 is the minimum legal
  // value for subsequent storms (1-3 range).
  chooseStormDial(state, factionId, isFirstStorm) {
    return isFirstStorm ? 0 : 1;
  },
  // Never proposes or breaks alliances.
  chooseAllianceActions(state) {
    return { form: [], breakFrom: [] };
  },
  // Never bids, every card goes unsold, ending the Bidding phase
  // immediately per the rulebook's own "no bids at all" rule.
  chooseBid(state, factionId, cardId, currentBid) {
    return null; // null = pass
  },
  // Claims only the free revival allowance, never spends spice on more.
  chooseRevival(state, factionId) {
    const free = revivalEngine.freeRevivalAllowance(factionId);
    const tanked = state.factions[factionId].revivalTanks ?? 0;
    return { forces: Math.min(free, tanked), starred: 0, leaderId: null };
  },
  // Never ships, never moves.
  chooseShipmentAndMovement(state, factionId) {
    return { shipment: null, movement: null };
  },
  // Dials 0 forces, plays the first available leader if one exists (a
  // leader/cheap hero must be played if possible, per the rulebook, so
  // even a passive plan has to satisfy that), no cards, no spice.
  chooseBattlePlan(state, factionId, territoryId, opponentFactionId) {
    const available = state.factions[factionId].leaders.available ?? [];
    return {
      forcesCommitted: 0, starredForcesCommitted: 0, spiceCommitted: 0,
      supportedStarredCount: 0, supportedOrdinaryCount: 0,
      leaderId: available[0] ?? null, leaderFightingValue: 0,
      cheapHeroCardId: null, weaponCardId: null, defenseCardId: null,
      useKwisatzHaderach: false
    };
  }
};

// --- Individual phase runners --------------------------------------------

function runStormPhase(state, decisionProvider) {
  const isFirstStorm = state.meta.turn === 1;
  // Which two factions dial genuinely needs player-circle sector data for
  // the first storm (nearest either side of Storm Start) and is fully
  // derivable for later storms (last two who fought a battle) without any
  // sector data at all, tracked via state.meta.lastBattleParticipants.
  const dialers = isFirstStorm
    ? (state.meta.turnOrder ?? []).slice(0, 2) // placeholder pending player-circle sectors, see docs/STORM_TODO.md
    : (state.meta.lastBattleParticipants ?? (state.meta.turnOrder ?? []).slice(0, 2));

  const dialA = decisionProvider.chooseStormDial(state, dialers[0], isFirstStorm);
  const dialB = decisionProvider.chooseStormDial(state, dialers[1], isFirstStorm);
  const sectorsToMove = isFirstStorm
    ? stormEngine.rollFirstStormMovement(dialA, dialB)
    : stormEngine.rollSubsequentStormMovement(dialA, dialB);

  const previousPosition = state.board.stormPosition ?? 0;
  state.board.stormPosition = stormEngine.advanceStormPosition(previousPosition, sectorsToMove);

  // First Player is genuinely blocked on player-circle sector data (see
  // docs/STORM_TODO.md), but leaving state.meta.firstPlayer as null broke
  // biddingEngine.js downstream (it indexes turnOrder by firstPlayer with
  // no null guard, and JS's negative modulo on array access returns
  // undefined rather than wrapping, so a null firstPlayer crashed rather
  // than degraded). Rotating through turnOrder by turn number as an
  // explicit placeholder is honest about not being the real rule while
  // keeping every downstream phase functional.
  const turnOrder = state.meta.turnOrder ?? [];
  if (turnOrder.length > 0) {
    state.meta.firstPlayer = turnOrder[(state.meta.turn - 1) % turnOrder.length];
  }

  // Damage and First Player determination are genuinely blocked on sector
  // data, see docs/STORM_TODO.md, not silently skipped, explicitly noted
  // on the result so nothing downstream mistakes this for a complete Storm phase.
  return { sectorsToMove, newPosition: state.board.stormPosition, damageApplied: false, firstPlayerDetermined: false };
}

function runSpiceBlowPhase(state, decisionProvider) {
  const result = spiceEngine.resolveSpiceBlowPhase(state);
  if (state.nexus.active) {
    const actions = decisionProvider.chooseAllianceActions(state);
    for (const factionId of actions.breakFrom ?? []) {
      if (allianceEngine.canBreakAlliance(state, factionId).ok) {
        allianceEngine.breakAlliance(state, factionId);
      }
    }
    for (const [a, b] of actions.form ?? []) {
      if (allianceEngine.canFormAlliance(state, a, b).ok) {
        allianceEngine.formAlliance(state, a, b);
      }
    }
  }
  return result;
}

function runCharityPhase(state) {
  // No real decision here, claiming charity has no downside, so this runs
  // for real rather than going through the decision provider at all.
  const results = [];
  for (const factionId of Object.keys(state.factions)) {
    if (choamCharityEngine.canClaimCharity(state, factionId).ok) {
      results.push(choamCharityEngine.claimCharity(state, factionId));
    }
  }
  return results;
}

function runBiddingPhase(state, decisionProvider) {
  biddingEngine.startBiddingPhase(state);
  const results = [];

  while (state.bidding?.active) {
    const cardId = state.bidding.cardsUpForBid[state.bidding.currentCardIndex];
    let opener = biddingEngine.determineOpeningBidder(state);
    const order = (state.meta.turnOrder ?? []).filter(id => !biddingEngine.isAtHandLimit(state, id));
    const startIdx = order.indexOf(opener);

    // Single pass around the table asking each eligible faction once,
    // sufficient for a passive provider that never raises, a real
    // decision provider would need this loop to keep going while any
    // faction still wants to raise, left as-is since the passive stub
    // never creates that situation.
    for (let i = 0; i < order.length; i++) {
      const factionId = order[(startIdx + i) % order.length];
      if (state.bidding.passedThisCard.includes(factionId)) continue;
      const bid = decisionProvider.chooseBid(state, factionId, cardId, state.bidding.currentBid);
      if (bid && biddingEngine.canBid(state, factionId, bid).ok) {
        biddingEngine.placeBid(state, factionId, bid);
      } else {
        biddingEngine.passBid(state, factionId);
      }
    }

    if (biddingEngine.isAuctionResolved(state)) {
      results.push(biddingEngine.resolveCurrentCard(state));
    }
  }

  return results;
}

function runRevivalPhase(state, decisionProvider) {
  const results = [];
  for (const factionId of Object.keys(state.factions)) {
    const decision = decisionProvider.chooseRevival(state, factionId);
    if (decision.forces > 0 && revivalEngine.canReviveForces(state, factionId, decision.forces, decision.starred).ok) {
      results.push(revivalEngine.reviveForces(state, factionId, decision.forces, decision.starred));
    }
    if (decision.leaderId) {
      // Caller-supplied fighting value expected on the decision itself,
      // this runner deliberately doesn't reach into leaders.json, same
      // separation of concerns as battleEngine.js's killLeader().
      if (decision.leaderFightingValue !== undefined &&
          revivalEngine.canReviveLeader(state, factionId, decision.leaderId, decision.leaderFightingValue).ok) {
        results.push(revivalEngine.reviveLeader(state, factionId, decision.leaderId, decision.leaderFightingValue));
      }
    }
  }
  revivalEngine.resetRevivalTurnFlags(state);
  return results;
}

function runShipmentMovementPhase(state, decisionProvider) {
  const results = [];
  const turnOrder = state.meta.turnOrder ?? Object.keys(state.factions);

  for (const factionId of turnOrder) {
    const decision = decisionProvider.chooseShipmentAndMovement(state, factionId);
    if (decision.shipment) {
      const { territoryId, amount } = decision.shipment;
      if (movementEngine.canShip(state, factionId, territoryId, amount).ok) {
        results.push({ factionId, type: 'shipment', ...movementEngine.executeShipment(state, factionId, territoryId, amount) });
      }
    }
    if (decision.movement) {
      const { from, to, amount } = decision.movement;
      if (movementEngine.canMove(state, factionId, from, to, amount).ok) {
        movementEngine.executeMove(state, factionId, from, to, amount);
        results.push({ factionId, type: 'movement', from, to, amount });
      }
    }
  }

  // Enforce the alliance overlap penalty (see allianceEngine.js) now that
  // everyone's had their shipment/movement turn.
  for (const violation of allianceEngine.findAllyOverlapViolations(state)) {
    const penalty = allianceEngine.enforceAllyOverlapPenalty(state, turnOrder, violation);
    if (penalty) results.push({ type: 'allyOverlapPenalty', ...penalty });
  }

  movementEngine.resetTurnMovementFlags(state);
  return results;
}

function findBattleTerritories(state) {
  const territories = {};
  for (const factionId of Object.keys(state.factions)) {
    for (const territoryId of Object.keys(state.factions[factionId].forces.onBoard)) {
      if (territoryId === 'polarSink') continue; // free haven, never a battle site
      territories[territoryId] = territories[territoryId] ?? [];
      territories[territoryId].push(factionId);
    }
  }
  return Object.entries(territories).filter(([, factions]) => factions.length >= 2);
}

function runBattlePhase(state, decisionProvider, cardLookup) {
  const results = [];
  battleEngine.resetKwisatzHaderachPhaseLock(state);
  const participants = new Set();

  // Resolve territories one at a time, re-checking after each battle since
  // a resolved battle can remove one of the factions entirely, changing
  // what's left to fight, rather than computing the full list up front.
  let battleSites = findBattleTerritories(state);
  while (battleSites.length > 0) {
    const [territoryId, factionsPresent] = battleSites[0];
    const [aggressorId, defenderId] = factionsPresent; // aggressor order (First Player priority) is sector/turn-order dependent, simplified to array order here
    participants.add(aggressorId);
    participants.add(defenderId);

    const aggressorPlan = decisionProvider.chooseBattlePlan(state, aggressorId, territoryId, defenderId);
    const defenderPlan = decisionProvider.chooseBattlePlan(state, defenderId, territoryId, aggressorId);
    const outcome = battleEngine.resolveBattle(state, territoryId, aggressorId, defenderId, aggressorPlan, defenderPlan, cardLookup ?? {});
    results.push({ territoryId, ...outcome });

    battleSites = findBattleTerritories(state);
  }

  state.meta.lastBattleParticipants = Array.from(participants).slice(0, 2);
  return results;
}

function runSpiceCollectionPhase(state) {
  const turnOrder = state.meta.turnOrder ?? Object.keys(state.factions);
  return spiceCollectionEngine.resolveSpiceCollectionPhase(state, turnOrder);
}

function runMentatPausePhase(state, territoriesData) {
  const result = victoryEngine.resolveMentatPause(state, territoriesData);
  if (result.gameOver) {
    state.victory.achieved = true;
    state.victory.winningFactions = result.winners;
    state.victory.method = result.method;
  }
  return result;
}

// --- Full turn orchestration -----------------------------------------

function runFullTurn(state, decisionProvider, territoriesData, cardLookup) {
  const log = [];

  while (true) {
    const phase = phaseEngine.currentPhase(state);
    let result = null;

    switch (phase) {
      case 'storm': result = runStormPhase(state, decisionProvider); break;
      case 'spiceBlow': result = runSpiceBlowPhase(state, decisionProvider); break;
      case 'nexus': result = null; break; // handled inside runSpiceBlowPhase, this step is a no-op pass-through
      case 'charity': result = runCharityPhase(state); break;
      case 'bidding': result = runBiddingPhase(state, decisionProvider); break;
      case 'revival': result = runRevivalPhase(state, decisionProvider); break;
      case 'shipment':
      case 'movement':
        // Both phases share one combined runner (ship-then-move per
        // faction, per the rulebook's own phase description), only run
        // it once when we hit 'shipment', 'movement' becomes a no-op pass.
        result = phase === 'shipment' ? runShipmentMovementPhase(state, decisionProvider) : null;
        break;
      case 'battle': result = runBattlePhase(state, decisionProvider, cardLookup); break;
      case 'spiceCollection': result = runSpiceCollectionPhase(state); break;
      case 'mentatPause': result = runMentatPausePhase(state, territoriesData); break;
      case 'victoryCheck': result = null; break; // victory already resolved inside mentatPause
      default:
        throw new Error(`turnEngine has no runner for phase "${phase}"`);
    }

    log.push({ phase, result });

    if (state.victory.achieved) break;

    const turnBefore = state.meta.turn;
    phaseEngine.nextPhase(state);
    if (state.meta.turn !== turnBefore) break; // completed exactly one full turn
  }

  return log;
}

module.exports = {
  passiveDecisionProvider,
  runStormPhase,
  runSpiceBlowPhase,
  runCharityPhase,
  runBiddingPhase,
  runRevivalPhase,
  runShipmentMovementPhase,
  runBattlePhase,
  runSpiceCollectionPhase,
  runMentatPausePhase,
  runFullTurn,
  findBattleTerritories
};
