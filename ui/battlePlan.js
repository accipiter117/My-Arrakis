// ui/battlePlan.js
//
// The battle scene's plan logic, kept free of the page so it can be tested in
// node: turning the player's choices into the engine's plan object, which cards
// each slot may take, and the Voice. The engine's canDeclareBattlePlan still has
// the final say on every plan.

import { WEAPONS, DEFENSES } from '../js/battleEngine.js';

// The slot a Voice category concerns (worthless cards can go either way: weapon).
export const voiceSlot = category => (DEFENSES.includes(category) ? 'defense' : 'weapon');

// Must the player play a card of the Voice's category, and does the hand hold one?
export function mustPlay(voice, hand, cat) {
  return voice?.command === 'play' && hand.some(id => cat(id) === voice.category);
}

// May this card go in this slot, given the Voice?
export function slotAllows(cardId, which, { voice = null, hand = [], cat }) {
  const c = cat(cardId);
  // Chemistry also works as a weapon (alongside another defence), and Weirding Way as a
  // defence (alongside another weapon); the engine checks the pairing on commit.
  const base = (which === 'weapon' ? [...WEAPONS, 'chemistry'] : [...DEFENSES, 'weirdingWay']).includes(c) || c === 'worthless';
  if (!base) return false;
  if (voice?.command === 'notPlay' && c === voice.category) return false;
  // "Must play": the commanded slot only takes the commanded kind of card.
  if (mustPlay(voice, hand, cat) && voiceSlot(voice.category) === which && c !== voice.category) return false;
  return true;
}

// A reason the plan breaks the Voice, or null.
export function voiceProblem(choices, { voice = null, hand = [], cat, categoryName = c => c }) {
  if (!mustPlay(voice, hand, cat)) return null;
  const played = [choices.weapon, choices.defense].some(id => id && cat(id) === voice.category);
  return played ? null : `The Voice: you must play ${categoryName(voice.category)}.`;
}

// The player's choices as the engine's plan object.
export function planFromChoices(pl, leaderValue) {
  const starred = Math.min(pl.starred ?? 0, pl.forces), spice = Math.min(pl.spice ?? 0, pl.forces);
  const supportedStarredCount = Math.min(starred, spice);
  const leaderId = pl.lead?.kind === 'leader' ? pl.lead.id : null;
  return { forcesCommitted: pl.forces, starredForcesCommitted: starred, spiceCommitted: spice, supportedStarredCount, supportedOrdinaryCount: spice - supportedStarredCount,
    leaderId, leaderFightingValue: leaderId ? (leaderValue(leaderId) ?? 0) : 0, cheapHeroCardId: pl.lead?.kind === 'hero' ? pl.lead.id : null,
    weaponCardId: pl.weapon ?? null, defenseCardId: pl.defense ?? null, useKwisatzHaderach: Boolean(pl.kh) };
}
