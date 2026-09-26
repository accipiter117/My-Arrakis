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

import * as phaseEngine from './phaseEngine.js';
import * as stormEngine from './stormEngine.js';
import * as spiceEngine from './spiceEngine.js';
import * as choamCharityEngine from './choamCharityEngine.js';
import * as biddingEngine from './biddingEngine.js';
import * as revivalEngine from './revivalEngine.js';
import * as movementEngine from './movementEngine.js';
import * as battleEngine from './battleEngine.js';
import * as spiceCollectionEngine from './spiceCollectionEngine.js';
import * as victoryEngine from './victoryEngine.js';
import * as allianceEngine from './allianceEngine.js';
import * as traitorDeckEngine from './traitorDeckEngine.js';
import * as setupEngine from './setupEngine.js';
import * as cardEffects from './cardEffects.js';
import { random } from './random.js';
import * as allySupport from './allySupport.js';

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
  // Keeps the first dealt card that isn't one of its own leaders (falls
  // back to the first card if all four are its own).
  chooseTraitor(state, factionId, pendingHand) {
    const opponent = pendingHand.find(c => c.factionId !== factionId);
    return (opponent ?? pendingHand[0]).leaderId;
  },
  // Bene Gesserit only: predicts the first other faction to win on the last turn.
  choosePrediction(state, factionId) {
    const other = Object.keys(state.factions).find(f => f !== factionId);
    return { factionId: other, turn: state.rulesConfig.victoryVariants.maxTurns };
  },
  chooseTruthtrance() { return null; },
  chooseAdvisor() { return false; },
  chooseGuildTiming() { return null; }, // null: act last
  chooseFremenPlacement() { return null; }, // null: all 10 in Sietch Tabr
  chooseKaramaCancel() { return false; },
  chooseAllyPledge() { return 0; },
  chooseEmperorAllyRevival() { return 0; },
  // Keeps every card.
  chooseDiscards() {
    return [];
  },
  // Always reveals a traitor when it can.
  chooseRevealTraitor() {
    return true;
  },
  // No diplomacy.
  chooseBreakAlliance() {
    return false;
  },
  chooseAllianceProposal() {
    return null;
  },
  chooseAllianceResponse() {
    return false;
  },
  // Bene Gesserit only: no Voice.
  chooseVoice() {
    return null;
  },
  // Battle winners keep every card they played.
  chooseCardsToDiscard() {
    return [];
  },
  // Harkonnen always sends a captured leader to the tanks for 2 spice.
  chooseCaptureAction() {
    return 'kill';
  },
  // Fremen never ride worms.
  chooseWormRide() {
    return null;
  },
  // Atreides only: always asks about the weapon.
  choosePrescienceElement() {
    return 'weapon';
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

async function runStormPhase(state, decisionProvider) {
  const isFirstStorm = state.meta.turn === 1;
  // Which two factions dial genuinely needs player-circle sector data for
  // the first storm (nearest either side of Storm Start) and is fully
  // derivable for later storms (last two who fought a battle) without any
  // sector data at all, tracked via state.meta.lastBattleParticipants.
  const dialers = isFirstStorm
    ? (state.meta.turnOrder ?? []).slice(0, 2) // placeholder pending player-circle sectors, see docs/STORM_TODO.md
    : (state.meta.lastBattleParticipants ?? (state.meta.turnOrder ?? []).slice(0, 2));

  // How far the storm moves:
  //   First storm: two players dial 0-20 each.
  //   Afterwards, with the Fremen in play (advanced rules): the Storm card
  //   the Fremen secretly previewed last turn is revealed.
  //   Afterwards, without the Fremen: the last two battlers dial 1-3 each.
  const useStormDeck = !isFirstStorm && Boolean(state.factions.fremen);
  let dials = null, stormCard = null, sectorsToMove;
  if (useStormDeck) {
    stormCard = state.board.nextStormCard ?? stormEngine.drawStormCard(random);
    sectorsToMove = stormCard;
  } else {
    const dialA = await decisionProvider.chooseStormDial(state, dialers[0], isFirstStorm);
    const dialB = await decisionProvider.chooseStormDial(state, dialers[1], isFirstStorm);
    dials = [dialA, dialB];
    sectorsToMove = isFirstStorm
      ? stormEngine.rollFirstStormMovement(dialA, dialB)
      : stormEngine.rollSubsequentStormMovement(dialA, dialB);
  }

  const previousPosition = state.board.stormPosition ?? 0;
  state.board.stormPosition = stormEngine.advanceStormPosition(previousPosition, sectorsToMove);
  // The Fremen shuffle every Storm card back and secretly preview next turn's.
  if (state.factions.fremen) state.board.nextStormCard = stormEngine.drawStormCard(random);
  await observe(decisionProvider, { type: 'storm', from: previousPosition, to: state.board.stormPosition, sectors: sectorsToMove, dials, stormCard, first: isFirstStorm }, state);

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

async function runSpiceBlowPhase(state, decisionProvider) {
  spiceEngine.resolveSpiceBlowPhase(state);
  foreseeSpice(state); // Atreides see the next card as soon as this Spice Blow is over (house rule)
  for (const draw of state.nexus.draws ?? []) await observe(decisionProvider, { type: 'spiceCard', ...draw }, state);
  // Snapshot what was placed now, later phases (collection, worms) can
  // remove these markers before anything reads the log.
  const result = {
    placed: state.board.spiceBlowMarkers
      .filter(m => m.turn === state.meta.turn)
      .map(m => ({ territoryId: m.territoryId, amount: m.amount })),
    nexus: Boolean(state.nexus.active),
    rides: []
  };
  if (state.nexus.active) result.diplomacy = await runNexusDiplomacy(state, decisionProvider);
  // Fremen caught by a worm may ride it to any one territory.
  if (state.factions.fremen && decisionProvider.chooseWormRide) {
    for (const from of state.nexus.wormTerritories ?? []) {
      if (!(state.factions.fremen.forces.onBoard[from] > 0)) continue;
      const to = await decisionProvider.chooseWormRide(state, 'fremen', from);
      if (to && movementEngine.canRideWorm(state, from, to).ok) {
        const ride = movementEngine.rideWorm(state, from, to);
        result.rides.push(ride);
        await observe(decisionProvider, { type: 'wormRide', factionId: 'fremen', ...ride }, state);
      }
    }
  }
  return result;
}

function runCharityPhase(state) {
  // Charity is once per turn: clear last turn's claims first. (An earlier
  // version never reset this, so each faction could claim only once per
  // game; Bene Gesserit starved for want of their 2 spice a turn.)
  choamCharityEngine.resetCharityFlags(state);
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

async function runBiddingPhase(state, decisionProvider) {
  // Before the auction, anyone holding cards whose effects aren't built yet
  // may discard them (so a full hand of dead cards can bid again).
  if (decisionProvider.chooseDiscards) {
    for (const f of state.meta.turnOrder ?? Object.keys(state.factions)) {
      const dead = state.factions[f].treacheryHand.filter(id => cardEffects.UNBUILT_CARDS.includes(id));
      if (!dead.length) continue;
      for (const id of (await decisionProvider.chooseDiscards(state, f, dead)) ?? []) {
        if (cardEffects.canDiscardUnbuilt(state, f, id).ok) cardEffects.discardUnbuilt(state, f, id);
      }
    }
  }
  // Alliance advantage: allies may pledge spice toward each other's cards and
  // shipments for this turn.
  allySupport.clearPledges(state);
  if (decisionProvider.chooseAllyPledge) {
    for (const f of state.meta.turnOrder ?? Object.keys(state.factions)) {
      const ally = allySupport.allyOf(state, f);
      if (!ally || state.factions[f].spice < 1) continue;
      const amount = await decisionProvider.chooseAllyPledge(state, f, ally);
      if (amount > 0) {
        const pledged = allySupport.setPledge(state, f, amount);
        await observe(decisionProvider, { type: 'pledge', from: f, to: ally, amount: pledged }, state);
      }
    }
  }
  biddingEngine.startBiddingPhase(state);
  const results = [];

  while (state.bidding?.active) {
    const cardIndex = state.bidding.currentCardIndex;
    const cardId = state.bidding.cardsUpForBid[cardIndex];
    // cardId travels with the event; the UI reveals it only to Atreides.
    await observe(decisionProvider, { type: 'auctionStart', cardId, index: cardIndex, total: state.bidding.cardsUpForBid.length }, state);
    const opener = biddingEngine.determineOpeningBidder(state);
    const order = (state.meta.turnOrder ?? []).filter(id => !biddingEngine.isAtHandLimit(state, id));
    let idx = Math.max(0, order.indexOf(opener));

    // Keep going around the table until only the high bidder (or nobody)
    // is left. Terminates because every bid must strictly exceed the last
    // and spice is finite, and a faction that passes is out for this card.
    let safety = 0;
    while (!biddingEngine.isAuctionResolved(state) && safety++ < 500) {
      const factionId = order[idx % order.length];
      idx++;
      if (state.bidding.passedThisCard.includes(factionId)) continue;
      if (factionId === state.bidding.currentBidder) continue;
      const bid = await decisionProvider.chooseBid(state, factionId, cardId, state.bidding.currentBid);
      if (bid && biddingEngine.canBid(state, factionId, bid).ok) {
        biddingEngine.placeBid(state, factionId, bid);
        await observe(decisionProvider, { type: 'bid', factionId, amount: bid }, state);
      } else {
        biddingEngine.passBid(state, factionId);
        await observe(decisionProvider, { type: 'pass', factionId }, state);
      }
    }

    const winner = state.bidding.currentBidder;
    const price = state.bidding.currentBid;
    biddingEngine.resolveCurrentCard(state);
    results.push(winner ? { winner, price } : { unsold: true, cardsReturned: state.bidding.cardsUpForBid.length - cardIndex });
    await observe(decisionProvider, winner ? { type: 'auctionWon', factionId: winner, price, bonus: winner === 'harkonnen' }
      : { type: 'auctionUnsold', returned: state.bidding.cardsUpForBid.length - cardIndex }, state);
  }

  return results;
}

async function runRevivalPhase(state, decisionProvider) {
  const results = [];
  for (const factionId of Object.keys(state.factions)) {
    const decision = await decisionProvider.chooseRevival(state, factionId);
    if (decision.forces > 0 && revivalEngine.canReviveForces(state, factionId, decision.forces, decision.starred).ok) {
      results.push(revivalEngine.reviveForces(state, factionId, decision.forces, decision.starred));
    }
    // Ghola: free revival of a leader or up to 5 forces, after normal revival.
    if (decision.ghola && cardEffects.canPlayGhola(state, factionId, decision.ghola).ok) {
      cardEffects.playGhola(state, factionId, decision.ghola);
      results.push({ factionId, card: 'ghola', ...decision.ghola });
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
  // Alliance advantage: the Emperor may pay for up to 3 extra forces for their ally.
  const emperorAlly = allySupport.allyOf(state, 'emperor');
  if (emperorAlly && decisionProvider.chooseEmperorAllyRevival) {
    const n = await decisionProvider.chooseEmperorAllyRevival(state, 'emperor', emperorAlly);
    if (n > 0 && revivalEngine.canEmperorReviveForAlly(state, emperorAlly, n).ok) {
      results.push({ ...revivalEngine.emperorRevivesForAlly(state, emperorAlly, n), allyRevival: true });
    }
  }
  revivalEngine.resetRevivalTurnFlags(state);
  return results;
}

async function runShipmentMovementPhase(state, decisionProvider) {
  const results = [];
  // Atreides Prescience: during Shipment and Movement, Atreides may look at
  // the top card of the Spice Deck (the next card drawn). Private knowledge,
  // kept until that card is drawn.
  foreseeSpice(state); // unchanged since the Spice Blow: nothing is drawn in between
  const turnOrder = state.meta.turnOrder ?? Object.keys(state.factions);

  // Spacing Guild (advanced): may take its turn at any point in the order.
  let order = turnOrder;
  if (turnOrder.includes('guild') && decisionProvider.chooseGuildTiming) {
    const others = turnOrder.filter(f => f !== 'guild');
    const pos = await decisionProvider.chooseGuildTiming(state, others);
    const at = Number.isInteger(pos) ? Math.max(0, Math.min(others.length, pos)) : others.length;
    order = [...others.slice(0, at), 'guild', ...others.slice(at)];
  }

  for (const factionId of order) {
    const decision = await decisionProvider.chooseShipmentAndMovement(state, factionId);
    if (decision.shipment) {
      const { territoryId, amount } = decision.shipment;
      if (movementEngine.canShip(state, factionId, territoryId, amount).ok) {
        movementEngine.executeShipment(state, factionId, territoryId, amount);
        results.push({ factionId, type: 'shipment', territoryId, amount });
        await observe(decisionProvider, { type: 'shipment', factionId, territoryId, amount }, state);
        // Bene Gesserit Spiritual Advisors: whenever another faction ships in
        // from off-planet, Bene Gesserit may place 1 force in the Polar Sink free.
        if (factionId !== 'gesserit' && state.factions.gesserit?.forces.reserve > 0 && decisionProvider.chooseAdvisor
            && await decisionProvider.chooseAdvisor(state, 'gesserit', factionId)) {
          state.factions.gesserit.forces.reserve -= 1;
          state.factions.gesserit.forces.onBoard.polarSink = (state.factions.gesserit.forces.onBoard.polarSink ?? 0) + 1;
          results.push({ factionId: 'gesserit', type: 'advisor', territoryId: 'polarSink', amount: 1 });
          await observe(decisionProvider, { type: 'shipment', factionId: 'gesserit', territoryId: 'polarSink', amount: 1, advisor: true }, state);
        }
      }
    } else if (factionId === 'guild' && decision.crossShip) {
      // Guild (advanced): ship across the planet instead of from reserves.
      const { from, to, amount } = decision.crossShip;
      if (movementEngine.canCrossShip(state, 'guild', from, to, amount).ok) {
        movementEngine.executeCrossShip(state, 'guild', from, to, amount);
        results.push({ factionId, type: 'crossShip', from, to, amount });
        await observe(decisionProvider, { type: 'move', factionId, from, to, amount, ornithopter: true }, state);
      }
    } else if (factionId === 'guild' && decision.retreat) {
      // Guild (advanced): ship forces back to reserves, 1 spice per 2 forces.
      const { from, amount } = decision.retreat;
      if (movementEngine.canRetreatToReserves(state, 'guild', from, amount).ok) {
        movementEngine.executeRetreatToReserves(state, 'guild', from, amount);
        results.push({ factionId, type: 'retreat', from, amount });
      }
    }
    if (decision.movement) {
      const { from, to, amount } = decision.movement;
      if (movementEngine.canMove(state, factionId, from, to, amount).ok) {
        // Ornithopter access is decided at the start of the move: leaving
        // Arrakeen or Carthag in this very move still flies.
        const ornithopter = movementEngine.hasOrnithopterAccess(state, factionId);
        movementEngine.executeMove(state, factionId, from, to, amount);
        results.push({ factionId, type: 'movement', from, to, amount, ornithopter });
        await observe(decisionProvider, { type: 'move', factionId, from, to, amount, ornithopter }, state);
      }
    }
    // Hajr: one extra move, played after the normal one.
    if (decision.hajrMove && cardEffects.canPlayHajr(state, factionId, decision.hajrMove).ok) {
      const { from, to, amount } = decision.hajrMove;
      const ornithopter = movementEngine.hasOrnithopterAccess(state, factionId);
      cardEffects.playHajr(state, factionId, decision.hajrMove);
      results.push({ factionId, type: 'movement', from, to, amount, card: 'hajr', ornithopter });
      await observe(decisionProvider, { type: 'move', factionId, from, to, amount, card: 'hajr', ornithopter }, state);
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

// The single element Atreides asked about. The question and answer are
// spoken aloud at the table, so this is public once revealed.
const PRESCIENCE_ELEMENTS = ['leader', 'weapon', 'defense', 'number'];
function revealPlanElement(plan, element) {
  if (!PRESCIENCE_ELEMENTS.includes(element)) element = 'weapon';
  const value = {
    leader: plan.leaderId ?? (plan.cheapHeroCardId ? 'cheapHero' : null),
    weapon: plan.weaponCardId ?? null,
    defense: plan.defenseCardId ?? null,
    number: plan.forcesCommitted
  }[element];
  return { element, value };
}

// --- Nexus diplomacy -----------------------------------------------------------
// In turn order: allied factions may break away; then each unallied faction
// may propose to one other unallied faction, who accepts or rejects.
async function runNexusDiplomacy(state, decisionProvider) {
  const events = [];
  const order = state.meta.turnOrder ?? Object.keys(state.factions);
  for (const f of order) {
    if (!allianceEngine.isFactionAllied(state, f) || !decisionProvider.chooseBreakAlliance) continue;
    const ally = allianceEngine.allyOf(state, f);
    if (await decisionProvider.chooseBreakAlliance(state, f, ally)) {
      allianceEngine.breakAlliance(state, f);
      events.push({ type: 'allianceBroken', by: f, of: ally });
      await observe(decisionProvider, events[events.length - 1], state);
    }
  }
  for (const f of order) {
    if (allianceEngine.isFactionAllied(state, f) || !decisionProvider.chooseAllianceProposal) continue;
    const target = await decisionProvider.chooseAllianceProposal(state, f);
    if (!target || !allianceEngine.canFormAlliance(state, f, target).ok) continue;
    const accepted = await decisionProvider.chooseAllianceResponse(state, target, f);
    const event = { type: accepted ? 'allianceFormed' : 'allianceRejected', proposer: f, target };
    if (accepted) allianceEngine.formAlliance(state, f, target);
    events.push(event);
    await observe(decisionProvider, event, state);
  }
  return events;
}

// Public knowledge of who holds which treachery card (revealed in battle and
// kept). Referee bookkeeping: entries drop once a card leaves that hand,
// which always happens publicly (discarded, played and lost, used up).
function recordKnownCards(state, holder, cardIds) {
  const known = state.meta.knownCards = state.meta.knownCards ?? {};
  for (const id of cardIds) if (id && holder && state.factions[holder].treacheryHand.includes(id)) known[id] = holder;
  for (const [id, f] of Object.entries(known)) {
    if (!state.factions[f]?.treacheryHand.includes(id)) delete known[id];
  }
}

// Atreides Prescience: the top card of the Spice Deck (the next card drawn).
// Officially seen during Shipment and Movement; here from the end of the
// Spice Blow (house rule, data/rulesConfig.json: atreidesForesightTiming).
// The card cannot change in between, since nothing is drawn until the next
// Spice Blow, so only the timing of the knowledge differs.
function foreseeSpice(state) {
  if (!state.factions.atreides) return;
  const top = state.decks.spiceDeck[state.decks.spiceDeck.length - 1];
  state.factions.atreides.specialFactionState.foreseenSpice = top
    ? { type: top.type, territoryId: top.type === 'territory' ? top.id : null, amount: top.maxValue ?? null }
    : { reshuffle: true };
}

// Lets the UI present each event as it happens (cards, sweeps, marches).
// Awaited so play only continues once the presentation has finished.
async function observe(decisionProvider, event, state) {
  if (decisionProvider.observe) await decisionProvider.observe(event, state);
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
  const allied = (a, b) => allianceEngine.allyOf(state, a) === b;
  return Object.entries(territories)
    .map(([territoryId, factions]) => {
      for (let i = 0; i < factions.length; i++) {
        for (let j = i + 1; j < factions.length; j++) {
          if (!allied(factions[i], factions[j])) return [territoryId, [factions[i], factions[j]]];
        }
      }
      return null; // only allies here (or one faction): no battle
    })
    .filter(Boolean);
}

async function runBattlePhase(state, decisionProvider, cardLookup) {
  const results = [];
  cardLookup = cardLookup ?? {};
  battleEngine.resetKwisatzHaderachPhaseLock(state);
  state.battle = { leaderTerritory: {} }; // which territory each leader fought in this phase
  const participants = new Set();

  // Resolve territories one at a time, re-checking after each battle since
  // a resolved battle can remove a faction entirely.
  let battleSites = findBattleTerritories(state);
  let guard = 0;
  while (battleSites.length > 0 && guard++ < 60) {
    const [territoryId, factionsPresent] = battleSites[0];
    const [aggressorId, defenderId] = factionsPresent; // aggressor order (First Player priority) awaits sector data
    participants.add(aggressorId);
    participants.add(defenderId);
    const opponentOf = f => (f === aggressorId ? defenderId : aggressorId);
    const fighting = [aggressorId, defenderId];

    // 0. Truthtrance: a combatant may ask the opponent one factual question.
    for (const f of fighting) {
      if (!decisionProvider.chooseTruthtrance || !cardEffects.canPlayTruthtrance(state, f, opponentOf(f)).ok) continue;
      const question = await decisionProvider.chooseTruthtrance(state, f, territoryId, opponentOf(f));
      if (question) {
        const record = cardEffects.playTruthtrance(state, f, opponentOf(f), question, cardLookup);
        await observe(decisionProvider, { type: 'truthtrance', territoryId, ...record }, state);
      }
    }
    // Karama: the target of a faction advantage may cancel it as it is used.
    const karamaCancels = async (f, purpose, extra = {}) => {
      if (!cardEffects.holdsKarama(state, f) || !decisionProvider.chooseKaramaCancel) return false;
      if (!(await decisionProvider.chooseKaramaCancel(state, f, purpose, { territoryId, ...extra }))) return false;
      cardEffects.playKarama(state, f, purpose);
      await observe(decisionProvider, { type: 'karama', factionId: f, purpose, territoryId }, state);
      return true;
    };

    // 1. Bene Gesserit Voice, always before Atreides Prescience.
    const allyOf = f => allianceEngine.allyOf(state, f);
    // The faction a power works for: itself, or its ally (alliance advantage).
    const beneficiary = power => fighting.find(f => f === power) ?? fighting.find(f => allyOf(f) === power) ?? null;
    let voice = null;
    const voiced = state.factions.gesserit ? beneficiary('gesserit') : null;
    if (voiced && decisionProvider.chooseVoice) {
      const target = opponentOf(voiced);
      const command = await decisionProvider.chooseVoice(state, 'gesserit', territoryId, target);
      if (command && ['play', 'notPlay'].includes(command.command) && battleEngine.VOICE_CATEGORIES.includes(command.category)) {
        voice = { ...command, target };
        if (await karamaCancels(target, 'voice', { voice: command })) voice = null;
      }
    }
    const voiceFor = f => (voice?.target === f ? voice : null);
    // Public facts about this battle (Voice is spoken aloud at the table).
    state.meta.currentBattle = { territoryId, aggressorId, defenderId, voice };

    // Every plan is made to obey any Voice, then checked against the rules;
    // a plan that breaks them is replaced by a minimal legal one.
    const planFor = async (f, intel) => {
      let plan = await decisionProvider.chooseBattlePlan(state, f, territoryId, opponentOf(f), intel, voiceFor(f));
      plan = battleEngine.enforceVoice(state, f, { ...plan, territoryId }, voiceFor(f), cardLookup);
      const check = battleEngine.canDeclareBattlePlan(state, territoryId, f, plan, cardLookup);
      if (!check.ok) plan = { ...battleEngine.fallbackPlan(state, territoryId, f, cardLookup), refused: check.reason };
      return plan;
    };

    // 2. Atreides Prescience: the opponent locks first (they must play what
    // they reveal anyway), then Atreides sees the named element and plans.
    const plans = {};
    let prescience = null;
    let seer = state.factions.atreides ? beneficiary('atreides') : null;
    if (seer && await karamaCancels(opponentOf(seer), 'prescience')) seer = null;
    if (seer) {
      const opp = opponentOf(seer);
      const element = await decisionProvider.choosePrescienceElement(state, 'atreides', territoryId, opp);
      plans[opp] = await planFor(opp);
      prescience = { ...revealPlanElement(plans[opp], element), opponentId: opp, forFaction: seer };
      plans[seer] = await planFor(seer, prescience);
    } else {
      plans[aggressorId] = await planFor(aggressorId);
      plans[defenderId] = await planFor(defenderId);
    }

    // Traitors: once plans are revealed, each side holding a traitor card for
    // the opposing leader (or whose Harkonnen ally does) may reveal it.
    const traitorCalls = {};
    let traitor = null;
    for (const f of fighting) {
      const theirLeader = plans[opponentOf(f)].leaderId;
      // A leader carrying the Kwisatz Haderach cannot turn traitor (advanced).
      if (opponentOf(f) === 'atreides' && plans.atreides.useKwisatzHaderach) continue;
      const holder = battleEngine.isTraitorAgainst(state, f, theirLeader) ? f
        : allyOf(f) === 'harkonnen' && battleEngine.isTraitorAgainst(state, 'harkonnen', theirLeader) ? 'harkonnen' : null;
      if (!holder) continue;
      const reveal = decisionProvider.chooseRevealTraitor
        ? await decisionProvider.chooseRevealTraitor(state, holder, theirLeader, territoryId, opponentOf(f), f)
        : true;
      if (reveal) {
        traitorCalls[f] = true;
        traitor = { revealedBy: holder, forFaction: f, leaderId: theirLeader, against: opponentOf(f) };
        await observe(decisionProvider, { type: 'traitor', territoryId, ...traitor }, state);
      }
    }

    const forcesBefore = Object.fromEntries(fighting.map(f => [f, state.factions[f].forces.onBoard[territoryId] ?? 0]));
    const outcome = battleEngine.resolveBattle(state, territoryId, aggressorId, defenderId, plans[aggressorId], plans[defenderId], cardLookup, traitorCalls);
    for (const f of fighting) if (plans[f].leaderId) state.battle.leaderTerritory[plans[f].leaderId] = territoryId;

    // 3. The winner may keep or discard each card they played.
    let discarded = [];
    const winner = outcome.winnerFactionId;
    if (winner && decisionProvider.chooseCardsToDiscard) {
      const hand = state.factions[winner].treacheryHand;
      const played = [plans[winner].weaponCardId, plans[winner].defenseCardId, plans[winner].cheapHeroCardId].filter(id => id && hand.includes(id));
      if (played.length) {
        discarded = ((await decisionProvider.chooseCardsToDiscard(state, winner, played)) ?? []).filter(id => played.includes(id));
        state.factions[winner].treacheryHand = hand.filter(id => !discarded.includes(id));
        state.decks.treacheryDiscard.push(...discarded);
      }
    }

    // Public card knowledge: cards the winner played and kept are now known
    // to be in their hand. Known cards that have since been discarded or
    // used are forgotten. The AI reads only this record, never real hands.
    recordKnownCards(state, winner, winner ? [plans[winner].weaponCardId, plans[winner].defenseCardId, plans[winner].cheapHeroCardId] : []);

    // 4. A captured leader Harkonnen used goes home after one battle.
    if (fighting.includes('harkonnen') && plans.harkonnen.leaderId) battleEngine.returnCapturedLeader(state, plans.harkonnen.leaderId);

    // 5. Harkonnen captures a random leader from the faction it beat.
    let capture = null;
    if (winner === 'harkonnen' && outcome.loserFactionId && decisionProvider.chooseCaptureAction) {
      const candidates = battleEngine.captureCandidates(state, outcome.loserFactionId, territoryId);
      if (candidates.length) {
        const leaderId = candidates[Math.floor(random() * candidates.length)];
        if (await karamaCancels(outcome.loserFactionId, 'capture', { leaderId })) {
          capture = { leaderId, from: outcome.loserFactionId, action: 'prevented' };
        } else {
          const action = (await decisionProvider.chooseCaptureAction(state, 'harkonnen', leaderId, outcome.loserFactionId)) === 'keep' ? 'keep' : 'kill';
          battleEngine.applyCapture(state, outcome.loserFactionId, leaderId, action);
          capture = { leaderId, from: outcome.loserFactionId, action };
        }
      }
    }
    battleEngine.returnAllCapturedIfNeeded(state);

    // Plans are revealed after a battle in the physical game.
    const reveal = plan => ({
      forces: plan.forcesCommitted, spice: plan.spiceCommitted, leaderId: plan.leaderId,
      cheapHero: Boolean(plan.cheapHeroCardId), weapon: plan.weaponCardId, defense: plan.defenseCardId,
      refused: plan.refused ?? null,
      // Everything needed to replay the arithmetic for the player.
      starred: plan.starredForcesCommitted ?? 0, supportedStarred: plan.supportedStarredCount ?? 0,
      supportedOrdinary: plan.supportedOrdinaryCount ?? 0, leaderValue: plan.leaderFightingValue ?? 0,
      kwisatzHaderach: Boolean(plan.useKwisatzHaderach), forcesPresent: forcesBefore[plan === plans[aggressorId] ? aggressorId : defenderId]
    });
    results.push({ territoryId, aggressorId, defenderId, prescience, voice, discarded, capture, traitorCard: traitor,
      plans: { [aggressorId]: reveal(plans[aggressorId]), [defenderId]: reveal(plans[defenderId]) }, ...outcome });
    await observe(decisionProvider, { type: 'battle', ...results[results.length - 1] }, state);

    battleSites = findBattleTerritories(state);
  }

  state.meta.lastBattleParticipants = Array.from(participants).slice(0, 2);
  delete state.meta.currentBattle;
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

// --- Setup-time decisions ------------------------------------------

// Runs once, straight after initializeGame(). Every faction except
// Harkonnen (who keeps all four automatically) picks one traitor from its
// dealt hand; the other three go to the bottom of the traitor deck.
async function runTraitorSelection(state, decisionProvider) {
  const results = [];
  for (const factionId of Object.keys(state.factions)) {
    const pending = state.factions[factionId].pendingTraitorHand;
    if (!pending) continue;
    const choice = await decisionProvider.chooseTraitor(state, factionId, pending);
    const result = traitorDeckEngine.selectTraitor(state, factionId, choice);
    state.decks.traitorDeck = [...state.decks.traitorDeck, ...result.returnedToDeck];
    results.push({ factionId, kept: result.kept });
  }
  return results;
}

// Every one-off decision made during setup: traitors, then (if Bene
// Gesserit is playing) their secret Prediction.
async function runSetupDecisions(state, decisionProvider) {
  // The Fremen split their 10 starting forces between Sietch Tabr, False
  // Wall South and False Wall West as they choose.
  if (state.factions.fremen && decisionProvider.chooseFremenPlacement) {
    const p = await decisionProvider.chooseFremenPlacement(state, 'fremen');
    const allowed = ['sietchTabr', 'falseWallSouth', 'falseWallWest'];
    if (p && Object.keys(p).every(k => allowed.includes(k)) && Object.values(p).every(n => Number.isInteger(n) && n >= 0)
        && Object.values(p).reduce((a, b) => a + b, 0) === 10) {
      state.factions.fremen.forces.onBoard = Object.fromEntries(Object.entries(p).filter(([, n]) => n > 0));
    }
  }
  const traitors = await runTraitorSelection(state, decisionProvider);
  let prediction = null;
  if (state.factions.gesserit) {
    const choice = await decisionProvider.choosePrediction(state, 'gesserit');
    if (setupEngine.canSetPrediction(state, choice.factionId, choice.turn).ok) {
      setupEngine.setPrediction(state, choice.factionId, choice.turn);
      prediction = choice;
    }
  }
  return { traitors, prediction };
}

// --- Full turn orchestration -----------------------------------------

// Runs exactly one phase's logic (not advancing past it), returns what
// happened. Used directly by the UI's "step one phase" control, and by
// runFullTurn() below in a loop, so both share one code path rather than
// the UI reimplementing phase dispatch separately.
async function runOnePhaseLogic(state, decisionProvider, territoriesData, cardLookup) {
  const phase = phaseEngine.currentPhase(state);
  const turn = state.meta.turn; // stamped before anything can advance it
  let result = null;

  switch (phase) {
    case 'storm': result = await runStormPhase(state, decisionProvider); break;
    case 'spiceBlow': result = await runSpiceBlowPhase(state, decisionProvider); break;
    case 'nexus': result = null; break; // handled inside runSpiceBlowPhase, this step is a no-op pass-through
    case 'charity': result = runCharityPhase(state); break;
    case 'bidding': result = await runBiddingPhase(state, decisionProvider); break;
    case 'revival': result = await runRevivalPhase(state, decisionProvider); break;
    case 'shipment':
    case 'movement':
      // Both phases share one combined runner (ship-then-move per
      // faction, per the rulebook's own phase description), only run
      // it once when we hit 'shipment', 'movement' becomes a no-op pass.
      result = phase === 'shipment' ? await runShipmentMovementPhase(state, decisionProvider) : null;
      break;
    case 'battle': result = await runBattlePhase(state, decisionProvider, cardLookup); break;
    case 'spiceCollection': result = runSpiceCollectionPhase(state); break;
    case 'mentatPause': result = runMentatPausePhase(state, territoriesData); break;
    case 'victoryCheck': result = null; break; // victory already resolved inside mentatPause
    default:
      throw new Error(`turnEngine has no runner for phase "${phase}"`);
  }

  return { phase, result, turn };
}

// Steps exactly one phase forward, including advancing phaseEngine past
// it, and returns the single log entry. This is the function the UI's
// "Step One Phase" control calls directly.
async function stepOnePhase(state, decisionProvider, territoriesData, cardLookup) {
  const entry = await runOnePhaseLogic(state, decisionProvider, territoriesData, cardLookup);
  if (!state.victory.achieved) {
    phaseEngine.nextPhase(state);
  }
  return entry;
}

async function runFullTurn(state, decisionProvider, territoriesData, cardLookup) {
  const log = [];

  while (true) {
    const entry = await runOnePhaseLogic(state, decisionProvider, territoriesData, cardLookup);
    log.push(entry);

    if (state.victory.achieved) break;

    const turnBefore = state.meta.turn;
    phaseEngine.nextPhase(state);
    if (state.meta.turn !== turnBefore) break; // completed exactly one full turn
  }

  return log;
}

export {
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
  stepOnePhase,
  runTraitorSelection,
  runSetupDecisions,
  runNexusDiplomacy,
  runFullTurn,
  findBattleTerritories,
  revealPlanElement
};
