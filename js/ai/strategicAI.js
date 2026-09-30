// js/ai/strategicAI.js
//
// Step 2 of docs/AI_PLAN.md: the strategic layer. Wraps the Basic AI and
// overrides shipment and movement with goal-driven intents:
//
//   CLOSE OUT: I hold 2 strongholds, go for a third (vacant first).
//   DENY:      someone else is close to winning, break their weakest
//              stronghold, or block a live Fremen special condition.
//
// Uses public information only: board positions, turn number, alliances.
// Opponent spice and hands are never read.

import { withNoField, usableNoFields } from '../noField.js';
import { ownsAllTechTokens, TECH_STRONGHOLD, tokensOwnedBy } from '../techTokens.js';
import { createBasicAI } from './basicAI.js';
import { createFactionStrategy } from './factionStrategy.js';
import * as movementEngine from '../movementEngine.js';
import { createDiplomacy } from './diplomacy.js';
import { createBattleBrain } from './battleBrain.js';
import { createBiddingBrain } from './biddingBrain.js';

const BLOCKS_FREMEN_AT_TUEKS = ['harkonnen', 'atreides', 'emperor', 'richese'];

export function createStrategicAI(options) {
  const base = createBasicAI(options);
  const diplomacy = createDiplomacy({ rng: options.rng });
  // Leader fighting values are printed on the discs: public.
  const leaderValue = {};
  for (const list of Object.values(options.leadersData)) if (Array.isArray(list)) for (const l of list) leaderValue[l.id] = l.fightingValue;
  const brain = options.battleBrain === false ? null
    : createBattleBrain({ cardLookup: options.cardLookup, leaderValue, rng: options.rng, samples: options.battleSamples ?? 150 });
  // Diplomacy can be switched off for easier opponents.
  const allies = options.diplomacy !== false;
  // Opt-in: the bidding brain has not yet beaten the Basic bidding in seeded
  // head-to-heads (43 vs 45 wins; Harkonnen much worse), see docs/AI_NOTES.md.
  const bidder = options.biddingBrain === true ? createBiddingBrain({ cardLookup: options.cardLookup, rng: options.rng }) : null;

  const strongholds = state => Object.keys(state.board.territories)
    .filter(id => state.board.territories[id].type === 'stronghold');
  const forcesOf = (state, f, t) => state.factions[f]?.forces.onBoard[t] ?? 0;
  const occupants = (state, t) => Object.keys(state.factions).filter(f => forcesOf(state, f, t) > 0);
  const allyOf = (state, f) => (state.alliances ?? []).find(a => a.factions.includes(f))?.factions.find(x => x !== f) ?? null;
  // All three Tech Tokens in one hand count as a stronghold.
  const held = (state, f) => [...strongholds(state).filter(t => forcesOf(state, f, t) > 0), ...(ownsAllTechTokens(state, f) ? [TECH_STRONGHOLD] : [])];

  // --- Strategic assessment ---------------------------------------------

  // How close each faction (or alliance) is to winning, from public info.
  function assessThreats(state, me) {
    const myAlly = allyOf(state, me);
    const maxTurns = state.rulesConfig.victoryVariants.maxTurns;
    const threats = [];

    const seen = new Set();
    for (const f of Object.keys(state.factions)) {
      if (f === me || f === myAlly || seen.has(f)) continue;
      const ally = allyOf(state, f);
      const group = ally ? [f, ally] : [f];
      group.forEach(x => seen.add(x));
      const groupHeld = [...new Set(group.flatMap(x => held(state, x)))];
      const needed = ally ? state.rulesConfig.victoryVariants.allianceStrongholdCount : state.rulesConfig.victoryVariants.soloStrongholdCount;
      const missing = needed - groupHeld.length;
      if (missing <= 1) threats.push({ kind: 'strongholds', group, held: groupHeld, urgency: missing <= 0 ? 3 : 2 });
    }

    // Tech Tokens: a rival with two tokens, or the full set, is fought for them.
    if (state.techTokens) {
      for (const f of Object.keys(state.factions)) {
        if (f === me || f === myAlly) continue;
        const n = tokensOwnedBy(state, f).length;
        if (n < 2) continue;
        // Holding the token they lack, I stay clear: losing to them would complete their set.
        if (n === 2 && tokensOwnedBy(state, me).length) continue;
        const ally = allyOf(state, f);
        const group = ally ? [f, ally] : [f];
        const needed = ally ? state.rulesConfig.victoryVariants.allianceStrongholdCount : state.rulesConfig.victoryVariants.soloStrongholdCount;
        const real = [...new Set(group.flatMap(x => held(state, x)))].filter(t => t !== TECH_STRONGHOLD).length;
        if (real + 1 >= needed - (n === 3 ? 0 : 1)) threats.push({ kind: 'techTokens', holder: f, group, held: [], urgency: n === 3 && real + 1 >= needed ? 3 : 2 });
      }
    }

    // Fremen special condition: only matters near the final turn.
    if (state.factions.fremen && me !== 'fremen' && myAlly !== 'fremen' && state.meta.turn >= maxTurns - 2 && state.meta.turn <= maxTurns) {
      const cleanOf = t => occupants(state, t).every(f => f === 'fremen' || f === allyOf(state, 'fremen'));
      const tueksBlocked = occupants(state, 'tueksSietch').some(f => BLOCKS_FREMEN_AT_TUEKS.includes(f));
      if (cleanOf('sietchTabr') && cleanOf('habbanyaSietch') && !tueksBlocked) {
        threats.push({ kind: 'fremenSpecial', urgency: state.meta.turn === maxTurns ? 3 : 2 });
      }
    }
    return threats.sort((a, b) => b.urgency - a.urgency);
  }

  // --- Candidate actions --------------------------------------------------

  function shipTo(state, me, territoryId, desired) {
    const faction = state.factions[me];
    const reserve = faction.forces.reserve ?? 0;
    let amount = Math.min(reserve, desired);
    while (amount >= 1) {
      if (movementEngine.canShip(state, me, territoryId, amount).ok) return { territoryId, amount };
      amount--;
    }
    return null;
  }

  function moveTo(state, me, targetId, desired) {
    const faction = state.factions[me];
    const range = movementEngine.moveRangeFor(state, me);
    let best = null;
    for (const [from, count] of Object.entries(faction.forces.onBoard)) {
      if (from === targetId) continue;
      // Never strip a stronghold I hold to act elsewhere: an earlier version
      // did, and handed rivals the very stronghold that won them the game.
      if (state.board.territories[from]?.type === 'stronghold') continue;
      const movable = count;
      if (!movementEngine.reachableTerritories(state, me, from, range).includes(targetId)) continue;
      const amount = Math.min(movable, desired);
      if (!movementEngine.canMove(state, me, from, targetId, amount).ok) continue;
      if (!best || amount > best.amount) best = { from, to: targetId, amount };
    }
    return best;
  }

  // The HMS cannot be shipped into (except by the Ixians): ship to the territory
  // it is over, then move the group straight in, all in one turn.
  function enterTarget(state, me, t, need) {
    if (t !== 'hms') return shipTo(state, me, t, need) ?? moveTo(state, me, t, need);
    const direct = moveTo(state, me, 'hms', need);
    if (direct && direct.amount >= Math.min(need, 3)) return direct;
    const host = state.board.hms?.placed ? state.board.hms.territoryId : null;
    if (!host) return null;
    const ship = shipTo(state, me, host, need);
    if (!ship) return null;
    // Checked as if the shipment had landed.
    const fx = state.factions[me].forces;
    fx.reserve -= ship.amount; fx.onBoard[host] = (fx.onBoard[host] ?? 0) + ship.amount;
    const amount = fx.onBoard[host];
    const ok = movementEngine.canMove(state, me, host, 'hms', amount).ok;
    fx.reserve += ship.amount; fx.onBoard[host] -= ship.amount; if (!fx.onBoard[host]) delete fx.onBoard[host];
    return ok ? { shipment: ship, movement: { from: host, to: 'hms', amount } } : null;
  }

  // Forces needed to have a fair chance of taking a territory: defenders
  // plus a margin for their leader and spice support.
  const forcesToContest = (state, t, me) =>
    occupants(state, t).filter(f => f !== me && f !== allyOf(state, me))
      .reduce((n, f) => n + forcesOf(state, f, t), 0) + 3;

  function denyAction(state, me, threat) {
    if (threat.kind === 'fremenSpecial') {
      // Cheapest block first: occupy Tuek's Sietch if my faction counts.
      const targets = BLOCKS_FREMEN_AT_TUEKS.includes(me)
        ? ['tueksSietch', 'habbanyaSietch', 'sietchTabr'] : ['habbanyaSietch', 'sietchTabr'];
      for (const t of targets) {
        const need = t === 'tueksSietch' && !occupants(state, t).length ? 2 : forcesToContest(state, t, me);
        const action = shipTo(state, me, t, need) ?? moveTo(state, me, t, need);
        if (action) return { action, reason: 'block the Fremen special victory' };
      }
      return null;
    }
    // Tech Tokens: attack the holder's weakest stack; winning that battle takes a token.
    if (threat.kind === 'techTokens') {
      const stacks = Object.entries(state.factions[threat.holder].forces.onBoard).filter(([t, n]) => n > 0 && t !== 'polarSink')
        .map(([t]) => ({ t, need: forcesToContest(state, t, me) })).sort((a, b) => a.need - b.need);
      for (const { t, need } of stacks) {
        const action = enterTarget(state, me, t, need);
        if (action && (action.amount ?? action.movement?.amount ?? 0) >= Math.max(3, need - 2)) return { action, reason: `fight ${threat.holder} for their Tech Tokens` };
      }
      return null;
    }
    // Break the threat's weakest stronghold (the HMS included, by ship-then-move).
    const targets = threat.held.filter(t => t !== TECH_STRONGHOLD) // a full token set is broken in battle, not by moving in
      .map(t => ({ t, need: forcesToContest(state, t, me) }))
      .sort((a, b) => a.need - b.need);
    for (const { t, need } of targets) {
      const action = enterTarget(state, me, t, need);
      // Only block with a fair chance: feeding in a handful of forces just loses them.
      if (action && (action.amount ?? action.movement?.amount ?? 0) >= Math.max(3, need - 2)) {
        return { action, reason: `stop ${threat.group.join(' and ')} reaching victory` };
      }
    }
    return null;
  }

  function closeOutAction(state, me) {
    const mine = held(state, me);
    const myAlly = allyOf(state, me);
    const needed = myAlly ? state.rulesConfig.victoryVariants.allianceStrongholdCount : state.rulesConfig.victoryVariants.soloStrongholdCount;
    const ours = [...new Set([...mine, ...(myAlly ? held(state, myAlly) : [])])];
    if (ours.length !== needed - 1) return null;
    const targets = strongholds(state)
      .filter(t => !ours.includes(t))
      .map(t => ({ t, need: forcesToContest(state, t, me) }))
      .sort((a, b) => a.need - b.need);
    for (const { t, need } of targets) {
      const action = enterTarget(state, me, t, need + 1);
      if (action) return { action, reason: 'take the stronghold that wins the game' };
    }
    return null;
  }

  // --- Faction strategies: CHOAM and Richese -------------------------------
  // The weakest stronghold I could take: fewest defenders, then most spice.
  function softestStronghold(state, me) {
    const ally = allyOf(state, me);
    return strongholds(state)
      .filter(t => forcesOf(state, me, t) === 0 && !(ally && forcesOf(state, ally, t) > 0))
      .map(t => ({ t, need: forcesToContest(state, t, me) - 3, spice: state.board.spiceBlowMarkers.filter(m => m.territoryId === t).reduce((a, m) => a + m.amount, 0) }))
      .sort((a, b) => a.need - b.need || b.spice - a.spice);
  }
  const shipCost = (state, me, t, n) => movementEngine.shipmentCostPerForce(state, me, t) * n;

  // CHOAM: rich but thin on the board. Turn the wealth into force: one heavy
  // landing in the softest stronghold, keeping about 1 spice a force to back
  // them in battle.
  function choamPlan(state, me) {
    const x = state.factions[me];
    if (x.spice < 8 || x.forces.reserve < 4) return null;
    for (const { t, need } of softestStronghold(state, me)) {
      if (t === 'hms') continue;
      const want = Math.min(x.forces.reserve, 12, Math.max(need + 4, 6));
      let n = want;
      while (n >= Math.max(need + 2, 4) && shipCost(state, me, t, n) + n > x.spice) n--;
      if (n >= Math.max(need + 2, 4) && movementEngine.canShip(state, me, t, n).ok) {
        return { action: { territoryId: t, amount: n }, reason: `land in force at ${t}, backed by CHOAM spice` };
      }
    }
    return null;
  }

  // Richese: poor, with a hidden No-Field token. Save up rather than trickle
  // in; land real forces in a weakly held stronghold when affordable, or send
  // a No-Field token there as a bluff that turns into real strength.
  function richesePlan(state, me) {
    const x = state.factions[me];
    const onBoard = Object.values(x.forces.onBoard).reduce((a, b) => a + b, 0);
    const token = usableNoFields(state).filter(v => v >= 3).pop() ?? null;
    for (const { t, need } of softestStronghold(state, me)) {
      if (t === 'hms') continue;
      const want = Math.min(x.forces.reserve, Math.max(need + 2, 4));
      if (want >= 2 && shipCost(state, me, t, want) <= x.spice - 1 && movementEngine.canShip(state, me, t, want).ok) {
        return { action: { territoryId: t, amount: want }, reason: `land a real force at ${t}` };
      }
      if (token && token >= need + 1 && !state.factions.richese.noField.onPlanet && shipCost(state, me, t, 1) <= x.spice && movementEngine.canShip(state, me, t, 1).ok) {
        return { action: { territoryId: t, amount: 1, noField: token }, reason: `No-Field ${token} into ${t}` };
      }
    }
    // Nothing worth it: save (the muster plan decides when to land).
    return { action: { save: true }, reason: 'save up for a stronghold landing' };
  }

  // Guild (rich, few forces) and poor Richese: muster in reserve and land once,
  // in strength, rather than feeding revived forces into fights a few at a time.
  function musterPlan(state, me) {
    const x = state.factions[me];
    const onBoard = Object.values(x.forces.onBoard).reduce((a, b) => a + b, 0);
    for (const { t, need } of softestStronghold(state, me)) {
      if (t === 'hms') continue;
      const want = Math.min(x.forces.reserve, Math.max(need + 3, 5));
      if (want < Math.max(need + 3, 5) && x.forces.reserve < 10) continue; // not enough yet for this one
      if (shipCost(state, me, t, want) <= x.spice - (me === 'guild' ? 5 : 1) && movementEngine.canShip(state, me, t, want).ok) {
        return { action: { territoryId: t, amount: want }, reason: `land in strength at ${t}` };
      }
    }
    // Not enough yet: keep what is on the board, and save.
    return onBoard >= 1 || x.forces.reserve < 5 ? { action: { save: true }, reason: 'muster reserves before landing' } : null;
  }

  // Denial is a public good: the blocker pays, everyone else benefits. So
  // only block when it's the last chance, or when I'm one of the two
  // non-threat factions best placed to do it (most forces in reserve, which
  // is public). Otherwise leave it to them and look after my own position.
  function shouldIDeny(state, me, threat) {
    if (useFactionStrategy && factionStrategy.wontDeny(state, me, threat)) return false; // the Bene Gesserit let their prediction come true
    if (threat.urgency >= 3) return true;
    const threatGroup = threat.group ?? ['fremen', allyOf(state, 'fremen')];
    // Best placed = most force it can actually bring: forces on the board plus
    // the reserves it can afford to ship (reserves alone made penniless
    // factions like Richese, and CHOAM, the permanent blockers).
    const power = f => {
      const x = state.factions[f];
      const board = Object.values(x.forces.onBoard).reduce((n, v) => n + v, 0);
      return board + Math.min(x.forces.reserve ?? 0, Math.floor((x.spice ?? 0) / 2));
    };
    const candidates = Object.keys(state.factions)
      .filter(f => !threatGroup.includes(f))
      .sort((a, b) => power(b) - power(a));
    return candidates.slice(0, 2).includes(me);
  }

  // --- Decision override ---------------------------------------------------

  // options.factionStrategy === false plays without the per-faction strategies (for head-to-head tests).
  const useFactionStrategy = options.factionStrategy !== false;
  const factionStrategy = createFactionStrategy({ allyOf, forcesOf, occupants, strongholds, forcesToContest, shipTo, moveTo, enterTarget });

  return {
    ...base,
    name: 'Strategic AI',

    // Bidding by card value and denial (js/ai/biddingBrain.js).
    chooseBid(state, me, cardId, currentBid) {
      return bidder ? bidder.chooseBid(state, me, cardId, currentBid) : base.chooseBid(state, me, cardId, currentBid);
    },

    // Battles by sampling (js/ai/battleBrain.js); falls back to the Basic plan.
    chooseBattlePlan(state, me, territoryId, opponentId, intel, voice) {
      if (brain) {
        const issued = state.meta.currentBattle?.voice;
        const plan = brain.choosePlan(state, me, territoryId, opponentId, intel, issued?.target === opponentId ? issued : null);
        if (plan) return plan;
      }
      return base.chooseBattlePlan(state, me, territoryId, opponentId, intel, voice);
    },

    chooseAllianceProposal: (state, me) => (allies ? diplomacy.propose(state, me) : null),
    chooseAllianceResponse: (state, me, proposer) => (allies ? diplomacy.respond(state, me, proposer) : false),
    chooseBreakAlliance: (state, me, ally) => (allies ? diplomacy.shouldBreak(state, me, ally) : false),

    assessThreats,

    chooseShipmentAndMovement(state, me) { return withNoField(state, me, this.strategicShipmentAndMovement(state, me)); },
    strategicShipmentAndMovement(state, me) {
      const plan = base.chooseShipmentAndMovement(state, me);
      const threats = assessThreats(state, me);

      // Denying an imminent win outranks everything, then closing out my own.
      let goal = null;
      for (const threat of threats) {
        if (!shouldIDeny(state, me, threat)) continue;
        goal = denyAction(state, me, threat);
        if (goal) break;
      }
      if (!goal) goal = closeOutAction(state, me);
      if (!goal && me === 'choam') goal = choamPlan(state, me);
      if (!goal && me === 'richese') goal = richesePlan(state, me);
      if ((!goal || goal.action.save) && ['guild', 'richese'].includes(me)) goal = musterPlan(state, me) ?? goal;
      // Every other faction plays to its own strengths (js/ai/factionStrategy.js).
      if (useFactionStrategy && !goal && !['choam', 'richese', 'guild'].includes(me)) goal = factionStrategy.plan(state, me);
      // Weak factions never trickle a handful into a defended territory.
      if (!goal) return useFactionStrategy ? factionStrategy.muster(state, me, plan) : plan;
      if (goal.action.save) return { ...plan, shipment: null, reason: goal.reason };

      const { action, reason } = goal;
      if (action.shipment && action.movement) return { ...plan, shipment: action.shipment, movement: action.movement, hajrMove: null, reason };
      if (action.territoryId) {
        return { ...plan, shipment: action, reason };
      }
      // A move replaces the basic move; keep the basic shipment.
      return { ...plan, movement: action, hajrMove: null, reason };
    }
  };
}
