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

import * as stormEngine from '../stormEngine.js';
import { withNoField, forcesAfterReveal } from '../noField.js';
import * as cardEffects from '../cardEffects.js';
import { spendingPower } from '../allySupport.js';
import { cacheCardValue } from '../richese.js';
import { battleSpice } from '../allySupport.js';
import { defaultTokenChoice, tokensOwnedBy } from '../techTokens.js';
import { random } from '../random.js';
import * as movementEngine from '../movementEngine.js';
import * as revivalEngine from '../revivalEngine.js';
import * as battleEngine from '../battleEngine.js';
import * as allianceEngine from '../allianceEngine.js';

// Card types that fill each slot come from the battle engine (base game plus
// the Ixians & Tleilaxu cards), so new cards are handled everywhere at once.
const WEAPON_CATEGORIES = battleEngine.WEAPONS;
const DEFENSE_CATEGORIES = battleEngine.DEFENSES;

export function createBasicAI({ leadersData, cardLookup, rng = random }) {
  // Leader fighting values are printed on the discs, so they are public.
  const leaderValue = {};
  for (const factionLeaders of Object.values(leadersData)) {
    if (!Array.isArray(factionLeaders)) continue; // skips the _notes metadata entry
    for (const leader of factionLeaders) leaderValue[leader.id] = leader.fightingValue;
  }

  const randInt = (min, max) => min + Math.floor(rng() * (max - min + 1));
  const own = (state, factionId) => state.factions[factionId];
  // Rough worth of a treachery card for the AI's own card choices.
  const cardWorth = id => { const c = cardLookup[id]?.category;
    if (!id) return 0; if (id.startsWith('karama')) return 8;
    if (c === 'worthless' || cardEffects.UNBUILT_CARDS.includes(id)) return 0;
    return { specialWeapon: 7, stoneBurner: 6, shieldSnooper: 6, mirrorWeapon: 5, poisonBlade: 5, artilleryStrike: 5, poisonTooth: 5,
      projectileWeapon: 4, poisonWeapon: 4, projectileDefense: 4, poisonDefense: 4, chemistry: 4, weirdingWay: 4 }[c] ?? 2; };

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
    // Tech Tokens: go after a rival's tokens (most of all one short of the set),
    // but keep my token away from the rival it would complete.
    if (state.techTokens && mine === 0) {
      const myTokens = tokensOwnedBy(state, factionId).length;
      for (const [f, x] of Object.entries(state.factions)) {
        if (f === factionId || f === allianceEngine.allyOf(state, factionId) || !(x.forces.onBoard[territoryId] > 0)) continue;
        const theirs = tokensOwnedBy(state, f).length;
        if (theirs === 2 && myTokens) value -= 8;
        else if (theirs === 2) value += 4;
        else if (theirs) value += 1.5;
      }
    }
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
      if (['poisonWeapon'].includes(incoming)) defenseCardId = find(['poisonDefense', 'chemistry', 'shieldSnooper']);
      if (['projectileWeapon', 'weirdingWay'].includes(incoming)) defenseCardId = find(['projectileDefense', 'shieldSnooper']);
      if (incoming === 'poisonBlade') defenseCardId = find(['shieldSnooper']);                 // only a Shield Snooper stops it
      if (incoming === 'artilleryStrike') defenseCardId = find(['projectileDefense', 'shieldSnooper']);
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
      const defenseCardId = usingLasgun && battleEngine.isShieldCard(cardLookup[plan.defenseCardId]) ? null : plan.defenseCardId;
      return { ...plan, weaponCardId, defenseCardId };
    }
    if (intel.element === 'number') {
      const forcesCommitted = Math.min(present, Math.max(plan.forcesCommitted, intel.value + 1));
      const starredForcesCommitted = Math.min(starredPresent, forcesCommitted);
      // Fremen fight at full strength without spice (advanced), so they never pay it.
      const spiceCommitted = factionId === 'fremen' ? 0 : Math.max(0, Math.min(forcesCommitted, battleSpice(state, factionId) - 2));
      const supportedStarredCount = Math.min(starredForcesCommitted, spiceCommitted);
      return { ...plan, forcesCommitted, starredForcesCommitted, spiceCommitted,
               supportedStarredCount, supportedOrdinaryCount: spiceCommitted - supportedStarredCount };
    }
    return plan;
  }

  // A Truthtrance this faction asked earlier: true/false, or undefined if never asked.
  function confirmedTraitor(state, me, opp, leaderId) {
    const truth = (state.meta.truths ?? []).filter(t => t.asker === me && t.target === opp
      && t.question.kind === 'isTraitor' && t.question.leaderId === leaderId).pop();
    return truth ? truth.answer : undefined;
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

    // Ixian Technology: swap a dud from our hand for a strong card about to be auctioned.
    chooseIxianTechnology(state, factionId, upcoming) {
      const good = id => id.startsWith('karama') || [...WEAPON_CATEGORIES, ...DEFENSE_CATEGORIES].includes(cardLookup[id]?.category);
      const dud = own(state, factionId).treacheryHand.find(id => cardLookup[id]?.category === 'worthless');
      return good(upcoming) && dud ? dud : null;
    },
    chooseSuboidExchange(state, factionId, { max }) { return max; },

    // Tleilaxu leader deals: ask for a strong leader back early when rich enough...
    chooseEarlyLeaderRevival(state, factionId) {
      const me = own(state, factionId);
      const best = me.leaders.killed.slice().sort((a, b) => (leaderValue[b] ?? 0) - (leaderValue[a] ?? 0))[0];
      return best && (leaderValue[best] ?? 0) >= 4 && me.spice >= (leaderValue[best] ?? 0) + 5 ? best : null;
    },
    // ...set a price as the Tleilaxu (never help someone about to win)...
    chooseLeaderRevivalPrice(state, factionId, { factionId: other, leaderId }) {
      const held = Object.keys(state.board.territories).filter(t => state.board.territories[t].type === 'stronghold' && (state.factions[other].forces.onBoard[t] ?? 0) > 0).length;
      if (held >= 2 && allianceEngine.allyOf(state, factionId) !== other) return null;
      return (leaderValue[leaderId] ?? 0) + (allianceEngine.allyOf(state, factionId) === other ? 0 : 2);
    },
    // ...and accept a fair price.
    chooseAcceptLeaderRevivalPrice(state, factionId, { leaderId, price }) {
      return price <= (leaderValue[leaderId] ?? 0) + 3 && own(state, factionId).spice - price >= 3;
    },
    // Tleilaxu Gholas: take the strongest dead leader when short of leaders and spice allows.
    chooseGholaRevival(state, factionId, options) {
      const me = own(state, factionId);
      if (me.leaders.available.length >= 4) return null;
      const best = options.filter(o => me.spice - o.cost >= 4).sort((a, b) => (leaderValue[b.leaderId] ?? 0) - (leaderValue[a.leaderId] ?? 0))[0];
      return best?.leaderId ?? null;
    },

    // Ixians: keep the best starting card (Karama, Lasgun, Shield Snooper, a defence, a weapon).
    chooseIxianStartingCard(state, factionId, ids) {
      const rank = id => { const c = cardLookup[id]?.category;
        return id.startsWith('karama') ? 0 : c === 'specialWeapon' ? 1 : c === 'shieldSnooper' ? 2 : DEFENSE_CATEGORIES.includes(c) ? 3 : WEAPON_CATEGORIES.includes(c) ? 4 : 9; };
      return ids.slice().sort((a, b) => rank(a) - rank(b))[0];
    },
    // Tech Tokens: complete our own set, else the token that pays soonest.
    chooseTechTokenToTake(state, factionId, options) { return defaultTokenChoice(state, factionId, options); },
    // Place the HMS next to the most spice, else in the Polar Sink (it reaches everywhere).
    chooseHmsPlacement(state, factionId, sites) {
      const spiceNear = t => [t, ...(state.board.territories[t]?.adjacentDraft ?? [])]
        .reduce((n, x) => n + state.board.spiceBlowMarkers.filter(m => m.territoryId === x).reduce((a, m) => a + m.amount, 0), 0);
      const best = sites.slice().sort((a, b) => spiceNear(b) - spiceNear(a))[0];
      return best && spiceNear(best) > 0 ? best : (sites.includes('polarSink') ? 'polarSink' : best);
    },
    // Move the HMS along the richest reachable path, if any spice is on the way.
    chooseHmsMove(state, factionId, reachable) {
      const gain = path => path.slice(1).reduce((n, t) => n + state.board.spiceBlowMarkers.filter(m => m.territoryId === t).reduce((a, m) => a + m.amount, 0), 0);
      const best = Object.entries(reachable).sort((a, b) => gain(b[1]) - gain(a[1]))[0];
      return best && gain(best[1]) > 0 ? best[0] : null;
    },
    // --- Richese cache auctions --------------------------------------------------
    // Auction the card rivals will pay most for: Silent when two or more rivals are rich.
    chooseCacheAuction(state, factionId, { cache }) {
      const best = cache.slice().sort((a, b) => cacheCardValue(b, cardEffects.UNBUILT_CARDS) - cacheCardValue(a, cardEffects.UNBUILT_CARDS))[0];
      const rich = Object.entries(state.factions).filter(([f, x]) => f !== factionId && x.spice >= 8).length;
      return { cardId: best, position: rich ? 'first' : 'last', method: rich >= 2 ? 'silent' : 'onceAround' };
    },
    chooseOnceAroundDirection() { return 'cw'; },
    chooseRevealNoField() { return false; }, // keep rivals guessing until a battle, storm or worm
    // Weather Control: steer the storm over rivals' forces and away from ours.
    chooseWeatherControl(state, factionId) {
      const ally = allianceEngine.allyOf(state, factionId);
      const from = state.board.stormPosition ?? 0;
      let best = null;
      for (let n = 0; n <= 10; n++) {
        let score = 0;
        for (const t of stormEngine.territoriesInPath(state, from, n)) for (const [f, x] of Object.entries(state.factions)) {
          const here = x.forces.onBoard[t] ?? 0;
          if (!here) continue;
          const hurt = f === 'fremen' ? Math.ceil(here / 2) : here;
          score += f === factionId || f === ally ? -1.5 * hurt : hurt;
        }
        if (!best || score > best.score) best = { n, score };
      }
      return best && best.score >= 4 ? best.n : null;
    },
    // Family Atomics: when it destroys more of the rivals than of us, counting what
    // this storm then catches in the newly exposed Arrakeen, Carthag and Imperial Basin.
    chooseFamilyAtomics(state, factionId, { from, sectors }) {
      const ally = allianceEngine.allyOf(state, factionId);
      const swept = new Set(stormEngine.sectorsSwept(from, sectors));
      let value = 0;
      for (const [f, x] of Object.entries(state.factions)) {
        const side = f === factionId || f === ally ? -2 : 1;
        value += side * (x.forces.onBoard.shieldWall ?? 0);
        for (const t of ['arrakeen', 'carthag', 'imperialBasin']) if (swept.has(state.board.territories[t]?.stormSector)) value += side * (x.forces.onBoard[t] ?? 0);
      }
      return value >= 5;
    },
    // --- Richese cache cards and Black Market -----------------------------------
    chooseNullentropy(state, factionId, { cards }) {
      const best = cards.slice().sort((a, b) => cardWorth(b) - cardWorth(a))[0];
      return best && cardWorth(best) >= 6 ? best : null;
    },
    // Distrans: pass a dud to the leading rival, clogging their hand.
    chooseDistrans(state, factionId, { targets, cards }) {
      const dud = cards.find(id => cardWorth(id) <= 1);
      const held = f => Object.keys(own(state, f).forces.onBoard).filter(t => state.board.territories[t]?.type === 'stronghold').length;
      const target = targets.filter(t => t !== allianceEngine.allyOf(state, factionId)).sort((a, b) => held(b) - held(a))[0];
      return dud && target ? { targetId: target, cardId: dud } : null;
    },
    // Black Market: sell a weak card, sometimes claiming it is a strong one.
    chooseBlackMarket(state, factionId, { hand }) {
      const weak = hand.slice().sort((a, b) => cardWorth(a) - cardWorth(b))[0];
      if (hand.length < 2 || cardWorth(weak) > (hand.length >= 3 ? 4 : 3)) return null;
      const bluff = random() < 0.4;
      return { cardId: weak, claimId: bluff ? (Object.keys(cardLookup).find(id => cardLookup[id]?.category === 'specialWeapon') ?? weak) : weak, method: 'normal' };
    },
    chooseJuiceOfSapho(state, factionId, { use }) { return use === 'aggressor' ? 'aggressor' : null; },
    chooseAllyNoField() { return true; },
    chooseResidualPoison(state, factionId, { opponentId }) { return own(state, opponentId).leaders.available.length >= 2; },
    choosePortableSnooper(state, factionId, { opponentPlan }) {
      const c = cardLookup[opponentPlan.weaponCardId]?.category;
      return c === 'poisonWeapon' || c === 'chemistry';
    },
    chooseStoneBurnerMode(state, factionId, { opponentPlan, ownPlan }) {
      return (opponentPlan.leaderFightingValue ?? 0) >= (ownPlan.leaderFightingValue ?? 0) ? 'kill' : 'zero';
    },
    chooseSemuta(state, factionId, { cards }) {
      const best = cards.slice().sort((a, b) => cardWorth(b) - cardWorth(a))[0];
      return best && cardWorth(best) >= 4 ? best : null;
    },
    chooseGiveCacheCard() { return null; },
    // Gholas: buy back a strong leader when rich; the Tleilaxu sell at its value or more.
    chooseGholaBuyBack(state, factionId, { leaderId }) {
      const v = leaderValue[leaderId] ?? 0;
      return v >= 4 && own(state, factionId).spice >= v + 5 ? v + 1 : null;
    },
    chooseAcceptGholaBuyBack(state, factionId, { leaderId, price }) { return price >= (leaderValue[leaderId] ?? 0); },
    // Face Dancer replacements: reserves first, then the largest stacks outside strongholds.
    chooseFaceDancerSources(state, factionId, { count, reserve, board }) {
      let need = count; const from = {};
      const r = Math.min(need, reserve); need -= r;
      for (const [t, n] of Object.entries(board).sort((a, b) => b[1] - a[1])) {
        if (need <= 0) break;
        if (state.board.territories[t]?.type === 'stronghold') continue;
        const take = Math.min(n, need); from[t] = take; need -= take;
      }
      return { reserve: r, from };
    },
    // Bid up to the card's worth, keeping 3 spice for shipping.
    chooseOnceAroundBid(state, factionId, { cardId, highBid, blackMarket, actualId }) {
      const worth = blackMarket ? Math.min(cardWorth(actualId ?? cardId), actualId ? 8 : 3) : cacheCardValue(cardId, cardEffects.UNBUILT_CARDS);
      const cap = Math.min(worth, spendingPower(state, factionId) - 3);
      return cap > highBid ? highBid + 1 : null;
    },
    chooseOnceAroundFinal(state, factionId, { cardId, highBid }) {
      // Keep only a card worth far more than its price (the sale is Richese's income).
      const cap = Math.min(cacheCardValue(cardId, cardEffects.UNBUILT_CARDS) - 3, spendingPower(state, factionId) - 6);
      return cap > highBid ? highBid + 1 : null;
    },
    chooseSilentBid(state, factionId, { cardId, blackMarket, actualId }) {
      if (factionId === 'richese' && !blackMarket) return 0; // never pay to keep our own cache card
      const worth = blackMarket ? Math.min(cardWorth(actualId ?? cardId), actualId ? 8 : 3) : cacheCardValue(cardId, cardEffects.UNBUILT_CARDS);
      return Math.max(0, Math.min(worth - 1, spendingPower(state, factionId) - 3));
    },
    chooseFreeOrRemove() { return 'take'; },

    // --- CHOAM ---------------------------------------------------------------
    // End of a phase: cash every duplicate; cash worthless cards too, keeping at
    // most one effect card (Kull Wahad first, then La La La) while spice is healthy.
    chooseChoamDiscards(state, factionId, { duplicates, worthless }) {
      const me = own(state, factionId);
      const keepOrder = ['kullWahad', 'laLaLa', 'tripToGamont', 'jubbaCloak', 'baliset', 'kulon'];
      const keep = me.spice >= 6 && me.treacheryHand.length < 5 ? keepOrder.find(id => worthless.includes(id)) : null;
      return [...duplicates, ...worthless.filter(id => id !== keep && !duplicates.includes(id))];
    },
    // Worthless effects, used only where they clearly help.
    chooseChoamEffect(state, factionId, { cardId, options, context = {} }) {
      const ally = allianceEngine.allyOf(state, factionId);
      const forces = (f, t) => state.factions[f]?.forces.onBoard[t] ?? 0;
      // Kull Wahad: stop a Karama aimed at the ally's own power (Voice, Prescience, capture).
      if (cardId === 'kullWahad') {
        const owner = { voice: 'gesserit', prescience: 'atreides', capture: 'harkonnen' }[context.purpose];
        return owner && owner === ally ? options[0] : null;
      }
      if (cardId === 'laLaLa') {
        const best = options.filter(f => f !== ally).sort((a, b) => (state.factions[b].revivalTanks ?? 0) - (state.factions[a].revivalTanks ?? 0))[0];
        return best && (state.factions[best].revivalTanks ?? 0) >= 3 ? best : null;
      }
      if (cardId === 'jubbaCloak') {
        const best = options.slice().sort((a, b) => forces(factionId, b) - forces(factionId, a))[0];
        return best && forces(factionId, best) >= 3 ? best : null;
      }
      if (cardId === 'kulon') return Object.values(own(state, factionId).forces.onBoard).some(n => n >= 3) ? true : null;
      if (cardId === 'baliset') {
        // Keep the strongest neighbour out of a CHOAM-held stronghold.
        const near = o => (state.board.territories[o.territoryId]?.type === 'stronghold' ? 1 : 0)
          * (state.board.territories[o.territoryId]?.adjacentDraft ?? []).reduce((n, t) => n + forces(o.factionId, t), 0);
        const best = options.slice().sort((a, b) => near(b) - near(a))[0];
        return best && near(best) >= 3 ? best : null;
      }
      if (cardId === 'tripToGamont') {
        // Break a lone-force hold on a stronghold, preferring the faction with the most strongholds.
        const held = f => Object.keys(own(state, f).forces.onBoard).filter(t => state.board.territories[t]?.type === 'stronghold').length;
        const lone = options.filter(o => o.factionId !== ally && forces(o.factionId, o.territoryId) === 1 && state.board.territories[o.territoryId]?.type === 'stronghold');
        const best = lone.sort((a, b) => held(b.factionId) - held(a.factionId))[0];
        return best && held(best.factionId) >= 2 ? best : null;
      }
      return null;
    },
    // Inflation: Double while CHOAM is short of spice (its own collection dwarfs what it pays out).
    chooseInflation(state, factionId) {
      return state.meta.turn >= 2 && own(state, factionId).spice < 8 ? 'double' : null;
    },
    // Pay off the Auditor when the hand holds something worth hiding and it stays affordable.
    chooseCancelAudit(state, factionId, { cost }) {
      const me = own(state, factionId);
      const precious = me.treacheryHand.some(id => id.startsWith('karama') || cardLookup[id]?.category === 'specialWeapon');
      return precious && me.spice - cost >= 2;
    },
    // Ally trade: CHOAM passes on its least useful card; the ally answers with its own least useful.
    chooseChoamAllyTrade(state, factionId, allyId) {
      const hand = own(state, factionId).treacheryHand;
      const dud = hand.find(id => cardLookup[id]?.category === 'worthless') ?? null;
      return dud && own(state, allyId).treacheryHand.length ? dud : null;
    },
    chooseChoamAllyTradeResponse(state, factionId, { offered }) {
      const worth = id => { const c = cardLookup[id]?.category;
        return c === 'worthless' ? 0 : ['weatherControl', 'familyAtomics'].includes(id) ? 3 : c === 'special' ? 2 : 5; };
      const mine = own(state, factionId).treacheryHand.slice().sort((a, b) => worth(a) - worth(b))[0];
      return mine && worth(mine) <= worth(offered) ? mine : null;
    },
    // Pay for the ally's forces, keeping a reserve for CHOAM's own needs.
    chooseChoamBattleSupport(state, factionId, { max }) {
      return Math.max(0, Math.min(max, own(state, factionId).spice - 4));
    },

    // Auction: bury the least useful card at the bottom of the deck.
    chooseIxianBury(state, factionId, ids) {
      const worth = id => { const c = cardLookup[id]?.category;
        return c === 'worthless' ? 0 : ['weatherControl', 'familyAtomics'].includes(id) ? 3 : c === 'special' ? 2 : 5; };
      return { cardId: ids.slice().sort((a, b) => worth(a) - worth(b))[0], where: 'bottom' };
    },
    // Ixian ally: swap a dud card just bought for the top of the deck.
    chooseIxianAllySwap(state, factionId, cardId) {
      return cardLookup[cardId]?.category === 'worthless';
    },

    // Tleilaxu: always spring a Face Dancer (the win still counts for them,
    // but their leader dies and their forces there become ours).
    chooseRevealFaceDancer() {
      return true;
    },
    // Swap out a Face Dancer who can never come up: one of our own leaders
    // first, then one who is dead or captured.
    chooseFaceDancerToReplace(state, factionId, leaderIds) {
      const me = own(state, factionId);
      const ownLeader = leaderIds.find(id => me.leaders.available.includes(id) || me.leaders.killed.includes(id));
      return ownLeader ?? leaderIds.find(id => !Object.values(state.factions).some(f => f.leaders.available.includes(id))) ?? null;
    },
    // Raise another faction's revival limit to 5 (they pay us), unless they're
    // close to winning; always for our ally.
    chooseIncreaseRevivalLimit(state, factionId, { factionId: other }) {
      if (allianceEngine.allyOf(state, factionId) === other) return true;
      const held = Object.keys(state.board.territories).filter(t => state.board.territories[t].type === 'stronghold' && (state.factions[other].forces.onBoard[t] ?? 0) > 0).length;
      return held < 2 && state.factions[other].spice >= 8;
    },

    // Thumper: call a worm onto the last spice territory if it would swallow a
    // big enemy stack (and none of ours or our ally's).
    chooseThumper(state, factionId) {
      const top = state.decks.spiceDiscardA[state.decks.spiceDiscardA.length - 1];
      if (top?.type !== 'territory') return false;
      const ally = allianceEngine.allyOf(state, factionId);
      let mine = 0, theirs = 0;
      for (const [f, x] of Object.entries(state.factions)) {
        const n = x.forces.onBoard[top.id] ?? 0;
        if (f === factionId || f === ally) mine += n; else if (f !== 'fremen') theirs += n;
      }
      return mine === 0 && theirs >= 5;
    },
    // Harvester: double the richest blow we have troops in or next to.
    chooseHarvester(state, factionId, blows) {
      const near = t => [t, ...(state.board.territories[t]?.adjacentDraft ?? [])].some(x => (own(state, factionId).forces.onBoard[x] ?? 0) > 0);
      const best = blows.filter(b => near(b.territoryId)).sort((a, b) => b.amount - a.amount)[0];
      return best ? best.territoryId : null;
    },
    // Amal: when a rival is far richer, halve everyone's spice.
    chooseAmal(state, factionId) {
      const richest = Math.max(...Object.entries(state.factions).filter(([f]) => f !== factionId).map(([, x]) => x.spice));
      return richest >= 12 && own(state, factionId).spice * 2 < richest;
    },

    // Poison Tooth, after the reveal: withhold it if it would cost us a better
    // leader than it takes from them (it kills both).
    choosePoisonToothUse(state, factionId, territoryId, opponentId, mine, theirs) {
      return (theirs.leaderFightingValue ?? 0) >= (mine.leaderFightingValue ?? 0);
    },

    // Truthtrance before a battle: is my strongest available leader your traitor?
    chooseTruthtrance(state, factionId, territoryId, opponentId) {
      const best = own(state, factionId).leaders.available
        .filter(id => battleEngine.isLeaderAvailable(state, factionId, id, territoryId) && confirmedTraitor(state, factionId, opponentId, id) === undefined)
        .sort((a, b) => (leaderValue[b] ?? 0) - (leaderValue[a] ?? 0))[0];
      return best ? { kind: 'isTraitor', leaderId: best } : null;
    },

    // Karama: always save a leader from capture; cancel the Voice or
    // Prescience when the battle is for a stronghold.
    chooseKaramaCancel(state, factionId, purpose, { territoryId }) {
      if (purpose === 'capture') return true;
      return state.board.territories[territoryId]?.type === 'stronghold';
    },

    // Alliance: a well-off faction pledges about a third of its spice to its ally.
    chooseAllyPledge(state, factionId) {
      const spice = own(state, factionId).spice;
      return spice >= 12 ? Math.floor(spice / 3) : 0;
    },

    // The Emperor pays for extra revivals for its ally when it can spare it.
    chooseEmperorAllyRevival(state, factionId, allyId) {
      const ally = own(state, allyId);
      const spare = Math.floor((own(state, 'emperor').spice - 6) / 2);
      return Math.max(0, Math.min(3, spare, (ally.revivalTanks ?? 0) - (ally.starredRevivalTanks ?? 0)));
    },

    // Bene Gesserit: always send a free advisor to the Polar Sink.
    chooseAdvisor(state) {
      return (own(state, 'gesserit').forces.reserve ?? 0) > 0;
    },

    // Spacing Guild: act last, having seen everyone else's shipments.
    chooseGuildTiming() {
      return null;
    },

    // Fremen: hold Sietch Tabr in strength, with pickets on both False Walls.
    chooseFremenPlacement() {
      return { sietchTabr: 6, falseWallSouth: 2, falseWallWest: 2 };
    },

    // Shed cards whose effects aren't in the game yet: they only block bidding.
    chooseDiscards(state, factionId, dead) {
      return dead;
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
      // Atreides (Prescience) and the Ixians (who saw this auction's cards) know the card.
      if ((factionId === 'atreides' || factionId === 'ixians') && cardId) {
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
      const free = revivalEngine.freeRevivalAllowance(factionId, state);
      // How many may be revived this turn (3 normally; no limit for the
      // Tleilaxu; 5 if the Tleilaxu raised it) and what each costs.
      // CHOAM revives cheaply but without limit: bring back only what it can ship soon.
      const cap = Math.min(revivalEngine.revivalTerms(state, factionId).cap, factionId === 'choam' ? 6 : 20);
      let forces = Math.min(free, tanked);
      if (me.spice >= 12 || factionId === 'tleilaxu') {
        forces = Math.min(cap, tanked);
        const keep = factionId === 'tleilaxu' ? 3 : 4;
        while (forces > Math.min(free, tanked)) {
          const r = revivalEngine.canReviveForces(state, factionId, forces, 0);
          if (r.ok && r.cost <= me.spice - keep) break;
          forces--;
        }
      }
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
    chooseShipmentAndMovement(state, factionId) { return withNoField(state, factionId, this.baseShipmentAndMovement(state, factionId)); },
    baseShipmentAndMovement(state, factionId) {
      const me = own(state, factionId);
      let shipment = null;
      let movement = null;

      // Shipment: best-value territory we can afford a meaningful force for.
      const reserve = me.forces.reserve ?? 0;
      if (reserve > 0) {
        // A faction with (almost) nothing on the board must get back onto it:
        // it may spend all its spice and land even one troop somewhere
        // modest. Otherwise it keeps a little spice and ships with purpose.
        // (An earlier version always kept 3 spice, stranding poor factions:
        // a quarter of AI turns ended with nothing on the board.)
        const onBoardNow = Object.values(me.forces.onBoard).reduce((a, b) => a + b, 0);
        const stranded = onBoardNow < 3;
        const keep = stranded ? 0 : 3, minValue = stranded ? 0 : 3, minAmount = stranded ? 1 : 2;
        let best = null;
        for (const territoryId of Object.keys(state.board.territories)) {
          const value = territoryValue(state, factionId, territoryId);
          if (value <= minValue) continue;
          const perForce = movementEngine.shipmentCostPerForce(state, factionId, territoryId);
          const affordable = perForce === 0 ? reserve : Math.floor((me.spice - keep) / perForce);
          const needed = Math.max(3, enemyForcesIn(state, factionId, territoryId) + 2);
          const amount = Math.min(reserve, affordable, Math.max(needed, 4), 8);
          if (amount < minAmount) continue;
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
      const present = forcesAfterReveal(state, factionId, territoryId);
      const starredPresent = me.forces.starredOnBoard?.[territoryId] ?? 0;
      const isStronghold = state.board.territories[territoryId]?.type === 'stronghold';

      const forcesCommitted = Math.min(present, Math.ceil(present * (isStronghold ? 0.75 : 0.5)));
      const starredForcesCommitted = Math.min(starredPresent, forcesCommitted);
      // Fremen fight at full strength without spice (advanced), so they never pay it.
      const spiceCommitted = factionId === 'fremen' ? 0 : Math.max(0, Math.min(forcesCommitted, battleSpice(state, factionId) - 2));
      const supportedStarredCount = Math.min(starredForcesCommitted, spiceCommitted);
      const supportedOrdinaryCount = spiceCommitted - supportedStarredCount;

      // Only leaders who haven't fought in another territory this turn, and
      // never one a Truthtrance has confirmed is this opponent's traitor.
      const leaders = me.leaders.available.filter(id => battleEngine.isLeaderAvailable(state, factionId, id, territoryId)
          && !confirmedTraitor(state, factionId, opponentId, id))
        .sort((a, b) => (leaderValue[b] ?? 0) - (leaderValue[a] ?? 0));
      const leaderId = leaders[0] ?? null;
      const hand = me.treacheryHand.map(id => ({ id, category: cardLookup[id]?.category }));
      const cheapHeroCardId = leaderId ? null : (hand.find(c => c.category === 'specialLeaderSubstitute')?.id ?? null);

      const nonLasgun = hand.find(c => c.category === 'poisonWeapon' || c.category === 'projectileWeapon');
      const lasgun = hand.find(c => c.category === 'specialWeapon');
      const weaponCardId = (nonLasgun ?? lasgun)?.id ?? null;
      const usingLasgun = weaponCardId && cardLookup[weaponCardId]?.category === 'specialWeapon';
      const defense = hand.find(c => DEFENSE_CATEGORIES.includes(c.category) &&
        !(usingLasgun && battleEngine.isShieldCard(c)));
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
