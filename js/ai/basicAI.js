// js/ai/basicAI.js
//
// Basic AI (brief Phase 3): plays legally and with simple sense, not
// strategy. It bids, ships, moves, revives and fights, which makes games
// actually happen, but it does not assess threats, bluff, form alliances
// or plan ahead. That is the strategic layer (Phase 4), built on top of
// this same decision-provider interface later.
//
// HIDDEN INFORMATION RULE (brief section 6): every method here reads only
//   - public state: board positions, spice blow markers, storm, turn,
//     which leaders are dead, alliances
//   - its OWN faction's private state: spice, hand, traitors, reserves
// It never reads another faction's spice, treachery hand, traitor hand
// or battle plan. Opponent spice sits behind a player shield in the
// physical game, so it is treated as unknown here too.
//
// Every decision is only a proposal: turnEngine runs it through the same
// canX() validators a human action would use, so an illegal proposal is
// simply refused rather than bending the rules.

import { random } from '../random.js';
import * as movementEngine from '../movementEngine.js';
import * as revivalEngine from '../revivalEngine.js';
import * as battleEngine from '../battleEngine.js';

const WEAPON_CATEGORIES = ['poisonWeapon', 'projectileWeapon', 'specialWeapon'];
const DEFENSE_CATEGORIES = ['poisonDefense', 'projectileDefense'];

export function createBasicAI({ leadersData, cardLookup, rng = random }) {
  // Leader fighting values are printed on the discs, so they are public.
  const leaderValue = {};
  for (const factionLeaders of Object.values(leadersData)) {
    if (!Array.isArray(factionLeaders)) continue; // skips the _notes metadata entry
    for (const leader of factionLeaders) leaderValue[leader.id] = leader.fightingValue;
  }

  const randInt = (min, max) => min + Math.floor(rng() * (max - min + 1));
  const own = (state, factionId) => state.factions[factionId];

  // --- Public board reading helpers -------------------------------------

  function forcesIn(state, territoryId) {
    const result = {};
    for (const [factionId, faction] of Object.entries(state.factions)) {
      const n = faction.forces.onBoard[territoryId] ?? 0;
      if (n > 0) result[factionId] = n;
    }
    return result;
  }

  function enemyForcesIn(state, factionId, territoryId) {
    const allyId = allyOf(state, factionId);
    return Object.entries(forcesIn(state, territoryId))
      .filter(([f]) => f !== factionId && f !== allyId)
      .reduce((sum, [, n]) => sum + n, 0);
  }

  function allyOf(state, factionId) {
    const alliance = (state.alliances ?? []).find(a => a.factions.includes(factionId));
    return alliance ? alliance.factions.find(f => f !== factionId) : null;
  }

  function spiceAt(state, territoryId) {
    return state.board.spiceBlowMarkers
      .filter(m => m.territoryId === territoryId)
      .reduce((sum, m) => sum + m.amount, 0);
  }

  // How much this faction wants to have forces in a territory. Simple,
  // readable weights, deliberately not tuned: tuning is Phase 4/7 work.
  function territoryValue(state, factionId, territoryId) {
    if (territoryId === 'polarSink') return 1;
    const territory = state.board.territories[territoryId];
    if (!territory) return 0;
    let value = 0;
    const mine = own(state, factionId).forces.onBoard[territoryId] ?? 0;
    if (territory.type === 'stronghold' && mine === 0) value += 12;
    value += spiceAt(state, territoryId) * 0.8;
    value -= enemyForcesIn(state, factionId, territoryId) * 1.2;
    return value;
  }

  // Adjusts a battle plan using one revealed element of the opponent's plan
  // (Atreides Prescience). Only ever called with legitimately revealed info.
  function applyIntel(plan, intel, me, hand, present, starredPresent) {
    const categoryOf = id => cardLookup[id]?.category;
    const find = cats => hand.find(c => cats.includes(c.category))?.id ?? null;

    if (intel.element === 'leader' && intel.value && (me.traitorHand ?? []).includes(intel.value)) {
      // Their leader is our traitor: the reveal wins outright, so risk nothing.
      return { ...plan, forcesCommitted: 0, starredForcesCommitted: 0, spiceCommitted: 0,
               supportedStarredCount: 0, supportedOrdinaryCount: 0, weaponCardId: null, defenseCardId: null };
    }
    if (intel.element === 'weapon') {
      const incoming = categoryOf(intel.value);
      let defenseCardId = null;
      if (incoming === 'poisonWeapon') defenseCardId = find(['poisonDefense']);
      if (incoming === 'projectileWeapon') defenseCardId = find(['projectileDefense']);
      // Lasgun: nothing defends against it, and our own shield would
      // explode the territory, so defenseCardId stays null.
      return { ...plan, defenseCardId };
    }
    if (intel.element === 'defense') {
      const theirs = categoryOf(intel.value);
      let weaponCardId;
      if (theirs === 'poisonDefense') weaponCardId = find(['projectileWeapon', 'specialWeapon']);
      else if (theirs === 'projectileDefense') weaponCardId = find(['poisonWeapon']); // a lasgun into their shield explodes
      else weaponCardId = find(['poisonWeapon', 'projectileWeapon']) ?? find(['specialWeapon']);
      const usingLasgun = categoryOf(weaponCardId) === 'specialWeapon';
      const defenseCardId = usingLasgun && categoryOf(plan.defenseCardId) === 'projectileDefense' ? null : plan.defenseCardId;
      return { ...plan, weaponCardId, defenseCardId };
    }
    if (intel.element === 'number') {
      const forcesCommitted = Math.min(present, Math.max(plan.forcesCommitted, intel.value + 1));
      const starredForcesCommitted = Math.min(starredPresent, forcesCommitted);
      const spiceCommitted = Math.max(0, Math.min(forcesCommitted, me.spice - 2));
      const supportedStarredCount = Math.min(starredForcesCommitted, spiceCommitted);
      return { ...plan, forcesCommitted, starredForcesCommitted, spiceCommitted,
               supportedStarredCount, supportedOrdinaryCount: spiceCommitted - supportedStarredCount };
    }
    return plan;
  }

  // --- Decisions --------------------------------------------------------

  return {
    name: 'Basic AI',

    chooseStormDial(state, factionId, isFirstStorm) {
      return isFirstStorm ? randInt(0, 20) : randInt(1, 3);
    },

    // Keep the most valuable opponent leader as a traitor.
    chooseTraitor(state, factionId, pendingHand) {
      const opponents = pendingHand.filter(c => c.factionId !== factionId);
      const pool = opponents.length ? opponents : pendingHand;
      return pool.slice().sort((a, b) => (leaderValue[b.leaderId] ?? 0) - (leaderValue[a.leaderId] ?? 0))[0].leaderId;
    },

    // Bene Gesserit only. Predicts a faction that tends to win through
    // strongholds (Guild and Fremen special wins don't count for a
    // prediction), on a mid-to-late turn. A strategic AI would read the board.
    choosePrediction(state, factionId) {
      const candidates = Object.keys(state.factions).filter(f => !['gesserit', 'guild', 'fremen'].includes(f));
      const pool = candidates.length ? candidates : Object.keys(state.factions).filter(f => f !== factionId);
      return { factionId: pool[randInt(0, pool.length - 1)], turn: randInt(4, state.rulesConfig.victoryVariants.maxTurns) };
    },

    // No diplomacy at this tier.
    // The Basic AI stays unaligned (the easier opponent); the Strategic AI
    // adds diplomacy (js/ai/diplomacy.js).
    chooseBreakAlliance() {
      return false;
    },
    chooseAllianceProposal() {
      return null;
    },
    chooseAllianceResponse() {
      return false;
    },

    // Always spring a traitor: the battle is won outright at no cost.
    chooseRevealTraitor() {
      return true;
    },

    // Bids on unknown cards up to a small personal valuation, keeping a
    // spice reserve for shipping. Atreides legitimately sees each card
    // before bidding (their faction ability), so only Atreides uses cardId.
    chooseBid(state, factionId, cardId, currentBid) {
      const me = own(state, factionId);
      const keep = 4;
      let valuation = 2 + randInt(0, 2);
      if (me.treacheryHand.length === 0) valuation += 2;
      if (factionId === 'harkonnen') valuation += 2; // every purchase comes with a free card
      if (factionId === 'atreides' && cardId) {
        const category = cardLookup[cardId]?.category;
        if (category === 'worthless') return null;
        if (WEAPON_CATEGORIES.includes(category) || DEFENSE_CATEGORIES.includes(category)) valuation += 2;
      }
      const next = currentBid + 1;
      if (next > valuation || next > me.spice - keep) return null;
      return next;
    },

    // Free revivals always; pays for more only when comfortably funded.
    // Revives the cheapest dead leader if it has none left to fight with.
    chooseRevival(state, factionId) {
      const me = own(state, factionId);
      const tanked = me.revivalTanks ?? 0;
      const free = revivalEngine.freeRevivalAllowance(factionId);
      let forces = Math.min(free, tanked);
      if (me.spice >= 12) forces = Math.min(3, tanked);
      // At most one starred force per turn; the rest must be ordinary ones
      // actually present in the tanks.
      const starredTanked = me.starredRevivalTanks ?? 0;
      const starred = Math.min(1, starredTanked, forces);
      forces = Math.min(forces, tanked - starredTanked + starred);

      let leaderId = null;
      let leaderFightingValue;
      if (revivalEngine.isEligibleForLeaderRevival(state, factionId) && me.leaders.killed.length) {
        const cheapest = me.leaders.killed.slice().sort((a, b) => (leaderValue[a] ?? 0) - (leaderValue[b] ?? 0))[0];
        if ((leaderValue[cheapest] ?? 0) + 2 <= me.spice) {
          leaderId = cheapest;
          leaderFightingValue = leaderValue[cheapest] ?? 0;
        }
      }
      // Ghola: a free leader if we have none to fight with, otherwise a
      // free batch of forces once enough are in the tanks.
      let ghola = null;
      if (me.treacheryHand.includes('ghola')) {
        if (!me.leaders.available.length && me.leaders.killed.length && !leaderId) {
          ghola = { leaderId: me.leaders.killed.slice().sort((a, b) => (leaderValue[b] ?? 0) - (leaderValue[a] ?? 0))[0] };
        } else if (tanked - forces >= 4) {
          ghola = { forces: Math.min(5, tanked - forces) };
        }
      }
      return { forces, starred, leaderId, leaderFightingValue, ghola };
    },

    // One shipment and one move, each only if it clearly improves things.
    chooseShipmentAndMovement(state, factionId) {
      const me = own(state, factionId);
      let shipment = null;
      let movement = null;

      // Shipment: best-value territory we can afford a meaningful force for.
      const reserve = me.forces.reserve ?? 0;
      if (reserve > 0) {
        let best = null;
        for (const territoryId of Object.keys(state.board.territories)) {
          const value = territoryValue(state, factionId, territoryId);
          if (value <= 3) continue;
          const perForce = movementEngine.shipmentCostPerForce(state, factionId, territoryId);
          const affordable = perForce === 0 ? reserve : Math.floor((me.spice - 3) / perForce);
          const needed = Math.max(3, enemyForcesIn(state, factionId, territoryId) + 2);
          const amount = Math.min(reserve, affordable, Math.max(needed, 4), 8);
          if (amount < 2) continue;
          if (!movementEngine.canShip(state, factionId, territoryId, amount).ok) continue;
          const score = value + rng();
          if (!best || score > best.score) best = { territoryId, amount, score };
        }
        if (best) shipment = { territoryId: best.territoryId, amount: best.amount };
      }

      // Movement: shift forces towards something better within range,
      // never stripping a held stronghold below a small garrison.
      const range = movementEngine.moveRangeFor(state, factionId);
      let bestMove = null;
      const candidateMoves = [];
      for (const [from, count] of Object.entries(me.forces.onBoard)) {
        const fromType = state.board.territories[from]?.type;
        const garrison = fromType === 'stronghold' ? 4 : 0;
        const movable = count - garrison;
        if (movable < 2) continue;
        const currentValue = fromType === 'stronghold' ? 6 : territoryValue(state, factionId, from);
        for (const to of movementEngine.reachableTerritories(state, factionId, from, range)) {
          const gain = territoryValue(state, factionId, to) - currentValue;
          if (gain < 4) continue;
          if (!movementEngine.canMove(state, factionId, from, to, movable).ok) continue;
          const score = gain + rng();
          candidateMoves.push({ from, to, amount: movable, score });
          if (!bestMove || score > bestMove.score) bestMove = { from, to, amount: movable, score };
        }
      }
      if (bestMove) movement = { from: bestMove.from, to: bestMove.to, amount: bestMove.amount };

      // Hajr: a second move from a different group, if one is worth making.
      let hajrMove = null;
      if (bestMove && me.treacheryHand.includes('hajr')) {
        const second = candidateMoves.filter(c => c.from !== bestMove.from && c.to !== bestMove.to)
          .sort((a, b) => b.score - a.score)[0];
        if (second) hajrMove = { from: second.from, to: second.to, amount: second.amount };
      }

      return { shipment, movement, hajrMove };
    },

    // Commits more for strongholds, backs forces with spice while keeping
    // a little in reserve, plays its strongest leader and whatever weapon
    // and defence it holds. Never pairs its own lasgun with its own shield.
    // Bene Gesserit only. With a weapon in hand, forbid the defence that
    // stops it; with a defence, command the weapon it stops (wasting it).
    chooseVoice(state, factionId) {
      const hand = own(state, factionId).treacheryHand.map(id => cardLookup[id]?.category);
      if (hand.includes('poisonWeapon')) return { command: 'notPlay', category: 'poisonDefense' };
      if (hand.includes('projectileWeapon')) return { command: 'notPlay', category: 'projectileDefense' };
      if (hand.includes('poisonDefense')) return { command: 'play', category: 'poisonWeapon' };
      if (hand.includes('projectileDefense')) return { command: 'play', category: 'projectileWeapon' };
      return { command: 'notPlay', category: 'specialWeapon' };
    },

    // After a win, shed worthless cards and keep everything useful.
    chooseCardsToDiscard(state, factionId, played) {
      return played.filter(id => cardLookup[id]?.category === 'worthless');
    },

    // Harkonnen: keep a strong captured leader to fight with, kill a weak
    // one for 2 spice.
    chooseCaptureAction(state, factionId, leaderId) {
      return (leaderValue[leaderId] ?? 0) >= 4 ? 'keep' : 'kill';
    },

    // Fremen: ride the worm to the most valuable territory it can land in.
    chooseWormRide(state, factionId, from) {
      let best = null;
      for (const to of Object.keys(state.board.territories)) {
        if (!movementEngine.canRideWorm(state, from, to).ok) continue;
        const score = territoryValue(state, factionId, to) + rng();
        if (score > 5 && (!best || score > best.score)) best = { to, score };
      }
      return best?.to ?? null;
    },

    // Atreides only: protect the leader by learning the weapon.
    choosePrescienceElement() {
      return 'weapon';
    },

    chooseBattlePlan(state, factionId, territoryId, opponentId, intel) {
      const me = own(state, factionId);
      const present = me.forces.onBoard[territoryId] ?? 0;
      const starredPresent = me.forces.starredOnBoard?.[territoryId] ?? 0;
      const isStronghold = state.board.territories[territoryId]?.type === 'stronghold';

      const forcesCommitted = Math.min(present, Math.ceil(present * (isStronghold ? 0.75 : 0.5)));
      const starredForcesCommitted = Math.min(starredPresent, forcesCommitted);
      const spiceCommitted = Math.max(0, Math.min(forcesCommitted, me.spice - 2));
      const supportedStarredCount = Math.min(starredForcesCommitted, spiceCommitted);
      const supportedOrdinaryCount = spiceCommitted - supportedStarredCount;

      // Only leaders who haven't fought in another territory this turn.
      const leaders = me.leaders.available.filter(id => battleEngine.isLeaderAvailable(state, factionId, id, territoryId))
        .sort((a, b) => (leaderValue[b] ?? 0) - (leaderValue[a] ?? 0));
      const leaderId = leaders[0] ?? null;
      const hand = me.treacheryHand.map(id => ({ id, category: cardLookup[id]?.category }));
      const cheapHeroCardId = leaderId ? null : (hand.find(c => c.category === 'specialLeaderSubstitute')?.id ?? null);

      const nonLasgun = hand.find(c => c.category === 'poisonWeapon' || c.category === 'projectileWeapon');
      const lasgun = hand.find(c => c.category === 'specialWeapon');
      const weaponCardId = (nonLasgun ?? lasgun)?.id ?? null;
      const usingLasgun = weaponCardId && cardLookup[weaponCardId]?.category === 'specialWeapon';
      const defense = hand.find(c => DEFENSE_CATEGORIES.includes(c.category) &&
        !(usingLasgun && c.category === 'projectileDefense'));
      let defenseCardId = defense?.id ?? null;
      // Worthless cards can only be shed by playing them: fill empty slots.
      const worthless = hand.filter(c => c.category === 'worthless').map(c => c.id);
      let finalWeapon = weaponCardId;
      if (!finalWeapon && worthless.length) finalWeapon = worthless.shift();
      if (!defenseCardId && worthless.length) defenseCardId = worthless.shift();

      const plan = {
        forcesCommitted, starredForcesCommitted, spiceCommitted,
        supportedStarredCount, supportedOrdinaryCount,
        leaderId, leaderFightingValue: leaderId ? (leaderValue[leaderId] ?? 0) : 0,
        cheapHeroCardId, weaponCardId: finalWeapon, defenseCardId,
        // The Kwisatz Haderach may join only one territory's battle per phase.
        useKwisatzHaderach: Boolean(me.specialFactionState?.kwisatzHaderachActive && (leaderId || cheapHeroCardId) &&
          [null, undefined, territoryId].includes(me.specialFactionState?.kwisatzHaderachUsedInTerritoryThisPhase))
      };
      return intel ? applyIntel(plan, intel, me, hand, present, starredPresent) : plan;
    }
  };
}
