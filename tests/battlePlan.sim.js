// battlePlan.sim.js — the battle scene's plan logic (ui/battlePlan.js), checked against the engine.
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as battleEngine from '../js/battleEngine.js';
import { planFromChoices, slotAllows, voiceProblem, voiceSlot } from '../ui/battlePlan.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cards = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const cat = id => cards[id]?.category;
const lv = {}; for (const list of Object.values(leaders)) if (Array.isArray(list)) for (const l of list) lv[l.id] = l.fightingValue;
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const ids = ['atreides', 'harkonnen', 'emperor'];
const s = initializeGame({ activeFactionIds: ids, playerCircleOrder: ids, rulesConfig, seed: 2, spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
s.factions.harkonnen.forces.onBoard.arrakeen = 5;
s.factions.atreides.spice = 10;
const hero = Object.keys(cards).find(id => cat(id) === 'specialLeaderSubstitute');
s.factions.atreides.treacheryHand = ['crysknife', 'shield1', hero, 'baliset'];
const ok = pl => battleEngine.canDeclareBattlePlan(s, 'arrakeen', 'atreides', planFromChoices(pl, id => lv[id]), cards);

console.log('Test 1: choices become valid engine plans');
assert(ok({ forces: 4, spice: 2, lead: { kind: 'leader', id: 'ladyJessica' }, weapon: 'crysknife', defense: 'shield1' }).ok, 'dial, spice, leader, weapon and defence');
assert(ok({ forces: 0, spice: 0, lead: { kind: 'hero', id: hero } }).ok, 'a Cheap Hero instead of a leader');
assert(ok({ forces: 10, spice: 10, lead: { kind: 'leader', id: 'thufirHawat' }, weapon: 'baliset' }).ok, 'everything dialled and backed, a worthless card as a bluff');
assert(!ok({ forces: 11, spice: 0, lead: { kind: 'leader', id: 'ladyJessica' } }).ok, 'more forces than are there is refused by the engine');
const p = planFromChoices({ forces: 5, starred: 3, spice: 4, lead: { kind: 'leader', id: 'gurneyHalleck' }, kh: true }, id => lv[id]);
assert(p.supportedStarredCount === 3 && p.supportedOrdinaryCount === 1 && p.useKwisatzHaderach && p.leaderFightingValue === lv.gurneyHalleck, 'spice backs elite forces first; the Kwisatz Haderach and leader value carry through');

console.log('\nTest 2: slots and the Voice');
const hand = s.factions.atreides.treacheryHand;
assert(slotAllows('crysknife', 'weapon', { cat }) && !slotAllows('crysknife', 'defense', { cat }), 'a weapon goes only in the weapon slot');
assert(slotAllows('baliset', 'weapon', { cat }) && slotAllows('baliset', 'defense', { cat }), 'a worthless card goes in either');
const notPlay = { command: 'notPlay', category: cat('crysknife') };
assert(!slotAllows('crysknife', 'weapon', { cat, voice: notPlay, hand }), 'the Voice "must not play" bars that kind of card');
const play = { command: 'play', category: cat('shield1') };
assert(voiceSlot(play.category) === 'defense' && !slotAllows('baliset', 'defense', { cat, voice: play, hand }) && slotAllows('shield1', 'defense', { cat, voice: play, hand }),
  'the Voice "must play" a shield: the defence slot takes only a shield');
assert(voiceProblem({ weapon: 'crysknife' }, { voice: play, hand, cat }) && !voiceProblem({ defense: 'shield1' }, { voice: play, hand, cat }), 'and the plan is held until the shield is played');
assert(!voiceProblem({}, { voice: play, hand: ['crysknife'], cat }), 'with no shield in hand, "must play" asks nothing');

console.log('\nAll battle plan tests passed.');

console.log('\nTest 3: Chemistry and Weirding Way can go in either slot');
{
  const chem = Object.keys(cards).find(id => cat(id) === 'chemistry'), weird = Object.keys(cards).find(id => cat(id) === 'weirdingWay');
  assert(slotAllows(chem, 'weapon', { cat }) && slotAllows(chem, 'defense', { cat }), 'Chemistry is offered as a weapon and as a defence');
  assert(slotAllows(weird, 'weapon', { cat }) && slotAllows(weird, 'defense', { cat }), 'Weirding Way is offered as a weapon and as a defence');
  s.factions.atreides.treacheryHand = [chem, 'shield1'];
  assert(!ok({ forces: 2, lead: { kind: 'leader', id: 'ladyJessica' }, weapon: chem }).ok, 'Chemistry as a weapon on its own is refused');
  assert(ok({ forces: 2, lead: { kind: 'leader', id: 'ladyJessica' }, weapon: chem, defense: 'shield1' }).ok, 'and accepted alongside another defence');
}
