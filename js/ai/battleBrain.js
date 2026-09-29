// js/ai/battleBrain.js
//
// Step 3 of docs/AI_PLAN.md: battles decided by sampling (ISMCTS-lite).
// Imagine many versions of the opponent's hand and battle plan that are
// consistent with what an honest player knows, test every sensible plan of
// our own against all of them, and play the best on average.
//
// Knowledge used (brief section 6): our own hand, traitors and forces; the
// public board, leaders and hand sizes; the discard pile; cards publicly
// known to be held (state.meta.knownCards); anything Prescience revealed or
// our Voice commanded. Never the opponent's actual hand, spice or plan.

import { forcesAfterReveal } from '../noField.js';
import { tokensOwnedBy, TECH_TOKENS } from '../techTokens.js';
import { battleSpice } from '../allySupport.js';
import * as battleEngine from '../battleEngine.js';
import { random } from '../random.js';

const { WEAPONS, DEFENSES } = battleEngine;

export function createBattleBrain({ cardLookup, leaderValue, rng = random, samples = 150 }) {
  const cat = id => cardLookup[id]?.category;
  const pick = arr => arr[Math.floor(rng() * arr.length)];
  const allyOf = (state, f) => (state.alliances ?? []).find(a => a.factions.includes(f))?.factions.find(x => x !== f) ?? null;

  // Cards that could be in any unknown hand.
  function unknownPool(state, me) {
    const known = new Set([...state.factions[me].treacheryHand, ...state.decks.treacheryDiscard, ...Object.keys(state.meta.knownCards ?? {})]);
    return Object.keys(cardLookup).filter(id => !known.has(id));
  }

  function sampleHand(state, opp, pool) {
    const theirs = Object.entries(state.meta.knownCards ?? {}).filter(([, f]) => f === opp).map(([id]) => id);
    const need = Math.max(0, state.factions[opp].treacheryHand.length - theirs.length);
    const bag = pool.slice();
    for (let i = 0; i < need && bag.length; i++) {
      const j = i + Math.floor(rng() * (bag.length - i));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return [...theirs, ...bag.slice(0, need)];
  }

  // A plausible plan for the opponent holding `hand`.
  function samplePlan(state, opp, territoryId, hand, intel, voice) {
    let forces = state.factions[opp].forces.onBoard[territoryId] ?? 0;
    // A face-down Richese No-Field token shows as one force but may be 0, 3 or 5:
    // guess one (the AI never peeks at the real value).
    if (opp === 'richese' && state.factions.richese?.noField?.onPlanet?.territoryId === territoryId) {
      forces = forces - 1 + [0, 3, 5][Math.floor(rng() * 3)];
    }
    const leaders = state.factions[opp].leaders.available
      .filter(id => battleEngine.isLeaderAvailable(state, opp, id, territoryId))
      .sort((a, b) => (leaderValue[b] ?? 0) - (leaderValue[a] ?? 0));
    const hero = hand.find(id => cat(id) === 'specialLeaderSubstitute');
    let leaderId = leaders.length ? (rng() < 0.65 ? leaders[0] : pick(leaders)) : null;
    let cheapHeroCardId = !leaderId && hero ? hero : (hero && rng() < 0.15 ? hero : null);
    if (cheapHeroCardId) leaderId = null;
    const weapons = hand.filter(id => WEAPONS.includes(cat(id)));
    const defenses = hand.filter(id => DEFENSES.includes(cat(id)));
    const worthless = hand.filter(id => cat(id) === 'worthless');
    let weaponCardId = weapons.length && rng() < 0.75 ? pick(weapons) : (worthless.length && rng() < 0.4 ? worthless[0] : null);
    let defenseCardId = defenses.length && rng() < 0.7 ? pick(defenses) : null;
    if (cat(weaponCardId) === 'specialWeapon' && battleEngine.isShieldCard(cardLookup[defenseCardId])) defenseCardId = null;
    const dial = Math.round(forces * (0.3 + rng() * 0.7));
    const spice = Math.round(dial * rng());
    const plan = {
      forcesCommitted: dial, starredForcesCommitted: 0, spiceCommitted: spice,
      supportedStarredCount: 0, supportedOrdinaryCount: spice,
      leaderId, leaderFightingValue: leaderId ? (leaderValue[leaderId] ?? 0) : 0,
      cheapHeroCardId, weaponCardId, defenseCardId, kwisatzHaderachBonus: 0
    };
    // What Prescience showed us is certain.
    if (intel) {
      if (intel.element === 'leader') {
        plan.leaderId = intel.value === 'cheapHero' ? null : intel.value;
        plan.leaderFightingValue = plan.leaderId ? (leaderValue[plan.leaderId] ?? 0) : 0;
      }
      if (intel.element === 'weapon') plan.weaponCardId = intel.value;
      if (intel.element === 'defense') plan.defenseCardId = intel.value;
      if (intel.element === 'number') plan.forcesCommitted = intel.value;
    }
    // So is our own Voice, where they could comply.
    if (voice) {
      const slot = WEAPONS.includes(voice.category) ? 'weaponCardId' : DEFENSES.includes(voice.category) ? 'defenseCardId' : null;
      if (slot && voice.command === 'notPlay' && cat(plan[slot]) === voice.category) plan[slot] = null;
      if (slot && voice.command === 'play') { const c = hand.find(id => cat(id) === voice.category); if (c) plan[slot] = c; }
    }
    return plan;
  }

  // Chance a leader of mine is secretly working for this opponent.
  function traitorRisk(state, me, opp, leaderId) {
    if (!leaderId) return 0;
    const captured = state.factions.harkonnen?.specialFactionState?.captured ?? {};
    if (captured[leaderId] === opp) return 1; // a captured leader stays loyal to its owner
    // A Truthtrance answer is certain (only for the opponent's own traitors).
    const truth = (state.meta.truths ?? []).filter(t => t.asker === me && t.target === opp && t.question.kind === 'isTraitor' && t.question.leaderId === leaderId).pop();
    if (truth && allyOf(state, opp) !== 'harkonnen') return truth.answer ? 1 : 0;
    const holders = [opp, allyOf(state, opp) === 'harkonnen' ? 'harkonnen' : null].filter(Boolean);
    const cardsHeld = holders.reduce((n, f) => n + (f === 'harkonnen' ? 4 : 1), 0);
    const pool = 30 - (state.factions[me].traitorHand?.length ?? 0);
    return Math.min(0.5, cardsHeld / pool);
  }

  function territoryWorth(state, territoryId) {
    const t = state.board.territories[territoryId];
    const spice = state.board.spiceBlowMarkers.filter(m => m.territoryId === territoryId).reduce((a, m) => a + m.amount, 0);
    return (t?.type === 'stronghold' ? 9 : 2) + spice * 0.4;
  }

  // Tech Tokens at stake: the winner takes one of the loser's. Worth more when it
  // completes a set (a stronghold) or stops a rival completing one.
  function tokenStakes(state, me, opp) {
    if (!state.techTokens) return { gain: 0, loss: 0 };
    const mine = tokensOwnedBy(state, me).length, theirs = tokensOwnedBy(state, opp).length;
    const full = TECH_TOKENS.length;
    const gain = !theirs ? 0 : 2.5 + (mine === full - 1 ? 7 : 0) + (theirs === full ? 6 : theirs === full - 1 ? 3 : 0);
    const loss = !mine ? 0 : 2.5 + (theirs === full - 1 ? 8 : 0) + (mine === full ? 7 : 0);
    return { gain, loss };
  }

  // Candidate plans worth considering for me.
  function candidates(state, me, territoryId, opp) {
    const faction = state.factions[me];
    const present = forcesAfterReveal(state, me, territoryId);
    const starredPresent = faction.forces.starredOnBoard?.[territoryId] ?? 0;
    const hand = faction.treacheryHand;
    const leaders = faction.leaders.available
      .filter(id => battleEngine.isLeaderAvailable(state, me, id, territoryId))
      .sort((a, b) => (leaderValue[b] ?? 0) - (leaderValue[a] ?? 0)).slice(0, 3);
    const heroes = hand.filter(id => cat(id) === 'specialLeaderSubstitute').slice(0, 1);
    const commanders = [...leaders.map(id => ({ leaderId: id })), ...heroes.map(id => ({ cheapHeroCardId: id }))];
    if (!commanders.length) commanders.push({});
    const uniq = arr => [...new Set(arr)];
    const weaponOpts = [null, ...uniq(hand.filter(id => WEAPONS.includes(cat(id))).map(cat)).map(c => hand.find(id => cat(id) === c)),
      hand.find(id => cat(id) === 'worthless') ?? null];
    const defenseOpts = [null, ...uniq(hand.filter(id => DEFENSES.includes(cat(id))).map(cat)).map(c => hand.find(id => cat(id) === c))];
    const dials = uniq([0, Math.ceil(present * 0.25), Math.ceil(present * 0.5), Math.ceil(present * 0.75), present]);
    const kh = faction.specialFactionState?.kwisatzHaderachActive &&
      [null, undefined, territoryId].includes(faction.specialFactionState?.kwisatzHaderachUsedInTerritoryThisPhase);
    const starredValue = battleEngine.starredUnitValueFor(me, opp);
    const plans = [];
    for (const cmd of commanders) for (const weaponCardId of uniq(weaponOpts)) for (const defenseCardId of uniq(defenseOpts)) {
      if (weaponCardId && weaponCardId === defenseCardId) continue;
      if (cat(weaponCardId) === 'specialWeapon' && battleEngine.isShieldCard(cardLookup[defenseCardId])) continue; // own explosion
      // Fremen fight at full strength without spice (advanced): never back with spice.
      const spare = me === 'fremen' ? 0 : Math.max(0, battleSpice(state, me) - 2);
      for (const dial of dials) for (const backed of uniq([0, Math.min(Math.ceil(dial / 2), spare), Math.min(dial, spare)])) {
        const starred = Math.min(starredPresent, dial);
        const supportedStarredCount = Math.min(starred, backed);
        plans.push({
          forcesCommitted: dial, starredForcesCommitted: starred, spiceCommitted: backed,
          supportedStarredCount, supportedOrdinaryCount: backed - supportedStarredCount,
          leaderId: cmd.leaderId ?? null, leaderFightingValue: cmd.leaderId ? (leaderValue[cmd.leaderId] ?? 0) : 0,
          cheapHeroCardId: cmd.cheapHeroCardId ?? null, weaponCardId, defenseCardId,
          useKwisatzHaderach: Boolean(kh && (cmd.leaderId || cmd.cheapHeroCardId)),
          starredUnitValue: starredValue
        });
      }
    }
    return plans;
  }

  // Value of one battle outcome to me.
  // lastWin: whether the last utility() call was a win (for the export's AI record).
  let lastWin = false;
  function utility(state, me, opp, territoryId, mine, theirs, isAggressor) {
    lastWin = false;
    const myForces = state.factions[me].forces.onBoard[territoryId] ?? 0;
    const worth = territoryWorth(state, territoryId);
    const myLeaderValue = (mine.leaderId ? (leaderValue[mine.leaderId] ?? 0) : 0) + 1.5;
    if ((state.factions[me].traitorHand ?? []).includes(theirs.leaderId)) {
      lastWin = true;
      return tokenStakes(state, me, opp).gain + worth + (theirs.leaderFightingValue ?? 0); // we'd spring our traitor: free win
    }
    const agg = isAggressor ? mine : theirs, def = isAggressor ? theirs : mine;
    const wd = battleEngine.resolveWeaponDefense(agg, def, cardLookup);
    if (wd.explosion) return -myForces - myLeaderValue - mine.spiceCommitted * 0.5;
    const myKilled = isAggressor ? wd.aggressorLeaderKilled : wd.defenderLeaderKilled;
    const theirKilled = isAggressor ? wd.defenderLeaderKilled : wd.aggressorLeaderKilled;
    const myS = battleEngine.calculateStrength({ ...battleEngine.fremenFullStrength(me, mine), leaderWasKilled: myKilled || !wd.leadersCount, kwisatzHaderachBonus: mine.useKwisatzHaderach ? 2 : 0 });
    const theirS = battleEngine.calculateStrength({ ...battleEngine.fremenFullStrength(opp, theirs), leaderWasKilled: theirKilled || !wd.leadersCount, starredUnitValue: battleEngine.starredUnitValueFor(opp, me) });
    const iWin = isAggressor ? myS >= theirS : myS > theirS;
    // Played cards the loser discards; a small nudge to shed worthless cards.
    const shed = cat(mine.weaponCardId) === 'worthless' ? 0.3 : 0;
    // Spice matters less to a rich faction (CHOAM especially): it should back its forces.
    const wealth = battleSpice(state, me);
    const spiceCost = mine.spiceCommitted * (wealth >= 20 ? 0.2 : wealth >= 10 ? 0.35 : 0.5);
    const leaderPay = wd.noSpiceForKills ? 0 : (theirKilled ? theirs.leaderFightingValue ?? 0 : 0) + (myKilled ? mine.leaderFightingValue ?? 0 : 0);
    lastWin = iWin;
    const stakes = tokenStakes(state, me, opp);
    if (iWin) return stakes.gain + worth - mine.forcesCommitted - spiceCost + leaderPay * 0.6 - (myKilled ? myLeaderValue : 0) + shed;
    return -stakes.loss - myForces - spiceCost - (myKilled ? myLeaderValue : 0) - 1 + shed;
  }

  return {
    // Best plan by expected utility across sampled opponent hands and plans.
    choosePlan(state, me, territoryId, opp, intel, voiceWeIssued) {
      const pool = unknownPool(state, me);
      const futures = [];
      for (let i = 0; i < samples; i++) {
        const hand = sampleHand(state, opp, pool);
        futures.push(samplePlan(state, opp, territoryId, hand, intel, voiceWeIssued));
      }
      const isAggressor = (state.meta.currentBattle?.aggressorId ?? me) === me;
      let best = null;
      for (const plan of candidates(state, me, territoryId, opp)) {
        const risk = traitorRisk(state, me, opp, plan.leaderId);
        const myForces = state.factions[me].forces.onBoard[territoryId] ?? 0;
        const betrayed = -tokenStakes(state, me, opp).loss - myForces - (plan.leaderId ? (leaderValue[plan.leaderId] ?? 0) + 1.5 : 0);
        let total = 0, wins = 0;
        for (const theirs of futures) { total += utility(state, me, opp, territoryId, plan, theirs, isAggressor); if (lastWin) wins++; }
        const expected = (1 - risk) * (total / futures.length) + risk * betrayed;
        if (!best || expected > best.expected) best = { plan, expected, wins, risk };
      }
      if (!best) return null;
      const { starredUnitValue, ...plan } = best.plan;
      // What the AI believed when it chose (read by the match export; the engine ignores it).
      plan._ai = { winChance: Math.round((1 - best.risk) * (best.wins / futures.length) * 100) / 100, traitorRisk: Math.round(best.risk * 100) / 100,
        expectedValue: Math.round(best.expected * 10) / 10, samples: futures.length };
      return plan;
    }
  };
}
