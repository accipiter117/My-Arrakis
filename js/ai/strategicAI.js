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

import { createBasicAI } from './basicAI.js';
import * as movementEngine from '../movementEngine.js';

const BLOCKS_FREMEN_AT_TUEKS = ['harkonnen', 'atreides', 'emperor', 'richese'];

export function createStrategicAI(options) {
  const base = createBasicAI(options);

  const strongholds = state => Object.keys(state.board.territories)
    .filter(id => state.board.territories[id].type === 'stronghold');
  const forcesOf = (state, f, t) => state.factions[f]?.forces.onBoard[t] ?? 0;
  const occupants = (state, t) => Object.keys(state.factions).filter(f => forcesOf(state, f, t) > 0);
  const allyOf = (state, f) => (state.alliances ?? []).find(a => a.factions.includes(f))?.factions.find(x => x !== f) ?? null;
  const held = (state, f) => strongholds(state).filter(t => forcesOf(state, f, t) > 0);

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

    // Fremen special condition: only matters near the final turn.
    if (state.factions.fremen && me !== 'fremen' && myAlly !== 'fremen' && state.meta.turn >= maxTurns - 2) {
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
    // Break the threat's weakest stronghold.
    const targets = threat.held
      .map(t => ({ t, need: forcesToContest(state, t, me) }))
      .sort((a, b) => a.need - b.need);
    for (const { t, need } of targets) {
      const action = shipTo(state, me, t, need) ?? moveTo(state, me, t, need);
      if (action && (action.amount ?? 0) >= Math.min(need, 3)) {
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
      const action = shipTo(state, me, t, need + 1) ?? moveTo(state, me, t, need + 1);
      if (action) return { action, reason: 'take the stronghold that wins the game' };
    }
    return null;
  }

  // Denial is a public good: the blocker pays, everyone else benefits. So
  // only block when it's the last chance, or when I'm one of the two
  // non-threat factions best placed to do it (most forces in reserve, which
  // is public). Otherwise leave it to them and look after my own position.
  function shouldIDeny(state, me, threat) {
    if (threat.urgency >= 3) return true;
    const threatGroup = threat.group ?? ['fremen', allyOf(state, 'fremen')];
    const candidates = Object.keys(state.factions)
      .filter(f => !threatGroup.includes(f))
      .sort((a, b) => (state.factions[b].forces.reserve ?? 0) - (state.factions[a].forces.reserve ?? 0));
    return candidates.slice(0, 2).includes(me);
  }

  // --- Decision override ---------------------------------------------------

  return {
    ...base,
    name: 'Strategic AI',

    assessThreats,

    chooseShipmentAndMovement(state, me) {
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
      if (!goal) return plan;

      const { action, reason } = goal;
      if (action.territoryId) {
        return { ...plan, shipment: action, reason };
      }
      // A move replaces the basic move; keep the basic shipment.
      return { ...plan, movement: action, hajrMove: null, reason };
    }
  };
}
