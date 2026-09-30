// js/ai/factionStrategy.js
//
// Faction-specific strategy for the Strategic AI: each faction plays to its own
// advantages. Used when choosing where to ship and move (after denial and
// close-out), and consulted by the denial rule. Every faction also follows the
// general muster rule: when weak (short of forces or spice), do not feed small
// groups into defended territories; build up and land once, in strength.
//
//   Atreides   Prescience makes their battles safer: attack with a thinner margin,
//              around Arrakeen and the nearby strongholds.
//   Harkonnen  Four traitors: attack strongholds held by factions whose leaders
//              they hold as traitors; buy cards hard (hand of 8, bonus draw).
//   Emperor    Rich and elite: land big, Sardaukar-heavy stacks in strongholds.
//   Fremen     Free shipment near the Great Flat and the sietches; the special
//              victory: hold Sietch Tabr and Habbanya Sietch, keep others off
//              Tuek's Sietch; fight at full strength without spice.
//   Guild      Half-price shipping and a fortune: muster, then land large.
//   Bene Gesserit  The prediction: never block the predicted faction's win on the
//              predicted turn; otherwise build in the Polar Sink and move in late.
//   Ixians     The HMS: keep it, and take strongholds near where it floats.
//   Tleilaxu   Face Dancers: attack strongholds held by factions whose leaders are
//              Face Dancers (winning battles there hands the Tleilaxu the stronghold);
//              cheap revival feeds big landings.
//   CHOAM, Richese  Their own plans in strategicAI (kept); the margins below apply.

import * as movementEngine from '../movementEngine.js';

const STRONGHOLD_TYPE = 'stronghold';

export function createFactionStrategy({ allyOf, forcesOf, occupants, strongholds, forcesToContest, shipTo, moveTo, enterTarget }) {
  const leaderFaction = (state, leaderId) => {
    for (const [f, x] of Object.entries(state.factions)) if ([...x.leaders.available, ...x.leaders.killed].includes(leaderId)) return f;
    return null;
  };
  const traitorFactions = (state, me) => new Set((state.factions[me].traitorHand ?? []).map(id => leaderFaction(state, id)).filter(Boolean));
  const faceDancerFactions = state => new Set((state.factions.tleilaxu?.faceDancers ?? []).filter(fd => !fd.revealed).map(fd => leaderFaction(state, fd.leaderId)).filter(Boolean));
  const onBoard = x => Object.values(x.forces.onBoard).reduce((a, b) => a + b, 0);

  // Weak: little left to fight with, or no money to ship it.
  function isWeak(state, me) {
    const x = state.factions[me];
    return onBoard(x) + x.forces.reserve < 8 || (x.spice < 3 && me !== 'fremen');
  }

  // Extra forces to land above what the defenders need, by faction.
  const margin = { atreides: 2, harkonnen: 2, emperor: 3, fremen: 2, guild: 3, gesserit: 2, ixians: 2, tleilaxu: 2, choam: 3, richese: 2 };

  // How attractive a stronghold is to this faction (higher is better).
  function targetBonus(state, me, t) {
    const here = occupants(state, t).filter(f => f !== me);
    let bonus = 0;
    if (me === 'harkonnen') { const tf = traitorFactions(state, me); if (here.some(f => tf.has(f))) bonus += 6; }
    if (me === 'tleilaxu') { const fd = faceDancerFactions(state); if (here.some(f => fd.has(f))) bonus += 3; }
    if (me === 'fremen' && ['sietchTabr', 'habbanyaSietch', 'tueksSietch'].includes(t)) bonus += 5;
    if (me === 'atreides' && ['arrakeen', 'carthag', 'sietchTabr'].includes(t)) bonus += 2;
    if (me === 'ixians' && state.board.hms?.placed) {
      const host = state.board.hms.territoryId;
      if ((state.board.territories[host]?.adjacentDraft ?? []).includes(t) || host === t) bonus += 3;
    }
    if (me === 'gesserit') {
      // Stay out of the predicted faction's way.
      const pred = state.factions.gesserit?.specialFactionState?.prediction?.factionId;
      if (pred && here.includes(pred)) bonus -= 8;
    }
    // Spice there is worth having.
    bonus += state.board.spiceBlowMarkers.filter(m => m.territoryId === t).reduce((a, m) => a + m.amount, 0) * 0.15;
    return bonus;
  }

  // The faction's own landing plan: the best stronghold for it, in strength.
  function plan(state, me) {
    const x = state.factions[me];
    const ally = allyOf(state, me);
    // The Bene Gesserit hold back until late unless their Polar Sink army is ready.
    // The Bene Gesserit only move in around their predicted turn (head-to-head tests:
    // committing earlier cost them wins); before that their usual play builds the Polar Sink army.
    if (me === 'gesserit') {
      const pred = state.factions.gesserit.specialFactionState?.prediction;
      if (!pred || state.meta.turn < pred.turn - 1) return null;
    }
    const options = strongholds(state)
      .filter(t => forcesOf(state, me, t) === 0 && !(ally && forcesOf(state, ally, t) > 0))
      .map(t => ({ t, need: forcesToContest(state, t, me) - 3 }))
      .map(o => ({ ...o, score: targetBonus(state, me, o.t) - o.need * 0.8 }))
      .sort((a, b) => b.score - a.score);
    // Only soft targets for factions whose ordinary play is already strong (the
    // Fremen and Ixians lost wins when their plan overrode it against held strongholds).
    // Head-to-head results: the Fremen lost wins in every run with their plan; the Atreides
    // one was no better than their ordinary play. Both keep their ordinary play.
    if (me === 'fremen' || me === 'atreides') return null;
    const maxNeed = { ixians: 1 }[me] ?? Infinity;
    for (const { t, need } of options.slice(0, 4).filter(o => o.need <= maxNeed)) {
      const want = Math.max(need + (margin[me] ?? 2), me === 'emperor' ? 5 : 4);
      const action = enterTarget(state, me, t, want);
      const amount = action?.amount ?? action?.movement?.amount ?? 0;
      if (action && amount >= Math.max(need + 1, 3)) return { action, reason: `${me} strategy: take ${t} in strength` };
    }
    return null;
  }

  // The general muster rule: a weak faction does not trickle small groups into
  // defended territory. Returns the plan with that shipment or move cancelled.
  function muster(state, me, planned) {
    // Not the Fremen (they fight at full strength in small groups) nor the Bene
    // Gesserit (small moves feed their army): both lost wins under this rule.
    if (['fremen', 'gesserit'].includes(me) || !isWeak(state, me) || !planned) return planned;
    const risky = (t, n) => t && n < 4 && occupants(state, t).some(f => f !== me && f !== allyOf(state, me) && forcesOf(state, f, t) >= n);
    let out = planned;
    if (planned.shipment && !planned.shipment.noField && risky(planned.shipment.territoryId, planned.shipment.amount)) out = { ...out, shipment: null, reason: 'muster: too few to land there' };
    if (planned.movement && risky(planned.movement.to, planned.movement.amount)) out = { ...out, movement: null, reason: 'muster: too few to attack there' };
    return out;
  }

  // Denial: the Bene Gesserit never block their predicted faction on the predicted turn.
  function wontDeny(state, me, threat) {
    if (me !== 'gesserit') return false;
    const pred = state.factions.gesserit.specialFactionState?.prediction;
    return Boolean(pred && threat.group?.includes(pred.factionId) && state.meta.turn === pred.turn);
  }

  return { plan, muster, wontDeny, isWeak, traitorFactions, faceDancerFactions };
}
