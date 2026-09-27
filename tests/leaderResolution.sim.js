// leaderResolution.sim.js — the Ixians & Tleilaxu battle cards (expansion M1).
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import { resolveWeaponDefense, checkPlanCards, enforceVoice, resolveBattle } from '../js/battleEngine.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cards = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const ALL = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const game = () => initializeGame({ activeFactionIds: ALL, playerCircleOrder: ALL, rulesConfig, seed: 9, spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
const plan = (w = null, d = null, extra = {}) => ({ weaponCardId: w, defenseCardId: d, leaderId: 'x', ...extra });
const kills = (w, d) => resolveWeaponDefense(plan(w), plan(null, d), cards).defenderLeaderKilled;

console.log('Test 1: new weapons against defences (does the defending leader die?)');
const table = [
  ['poisonBlade', null, true], ['poisonBlade', 'shield1', true], ['poisonBlade', 'snooper1', true], ['poisonBlade', 'shieldSnooper', false],
  ['hunterSeeker', null, true], ['hunterSeeker', 'shield5', false], ['basiliaWeapon', 'snooper5', false], ['basiliaWeapon', 'shield1', true],
  ['weirdingWay', 'shield1', false], ['weirdingWay', 'snooper1', true], ['chaumas', 'shieldSnooper', false], ['stunner', 'shieldSnooper', false],
  ['chaumas', 'chemistry', false], ['stunner', 'chemistry', true]
];
for (const [w, d, dies] of table) assert(kills(w, d) === dies, `${cards[w].name} vs ${d ? cards[d].name : 'no defence'}: leader ${dies ? 'dies' : 'lives'}`);

console.log('\nTest 2: slot rules for Weirding Way and Chemistry');
const s = game();
s.factions.atreides.treacheryHand = ['weirdingWay', 'chemistry', 'stunner', 'shield1'];
assert(!checkPlanCards(s, 'atreides', plan(null, 'weirdingWay'), cards).ok, 'Weirding Way as a defence needs a weapon beside it');
assert(checkPlanCards(s, 'atreides', plan('stunner', 'weirdingWay'), cards).ok, 'Weirding Way as a defence beside a Stunner is fine');
assert(resolveWeaponDefense(plan('stunner'), plan('stunner', 'weirdingWay'), cards).defenderLeaderKilled === false, '...and it stops a projectile weapon');
assert(!checkPlanCards(s, 'atreides', plan('chemistry'), cards).ok, 'Chemistry as a weapon needs a defence beside it');
assert(resolveWeaponDefense(plan('chemistry', 'shield1'), plan(null, 'shield1'), cards).defenderLeaderKilled === true, 'Chemistry as a weapon (beside a Shield) is a poison weapon: a Shield does not stop it');

console.log('\nTest 3: Shield Snooper counts as a Shield for Lasgun explosions');
assert(resolveWeaponDefense(plan('lasgun'), plan(null, 'shieldSnooper'), cards).explosion, 'Lasgun meets Shield Snooper: explosion');

console.log('\nTest 4: Poison Tooth kills both leaders unless withheld');
let r = resolveWeaponDefense(plan('poisonTooth'), plan(null, 'snooper1'), cards);
assert(r.aggressorLeaderKilled && r.defenderLeaderKilled, 'used: both leaders die, a Snooper does not help');
r = resolveWeaponDefense(plan('poisonTooth', null, { poisonToothWithheld: true }), plan(null, 'snooper1'), cards);
assert(!r.aggressorLeaderKilled && !r.defenderLeaderKilled, 'withheld: no effect');

console.log('\nTest 5: Artillery Strike');
r = resolveWeaponDefense(plan('artilleryStrike'), plan(null, 'shield1'), cards);
assert(r.aggressorLeaderKilled && !r.defenderLeaderKilled && !r.leadersCount && r.noSpiceForKills, 'kills the unshielded leader only; leaders do not count; no spice for kills');

console.log('\nTest 6: in a real battle, Artillery ignores surviving leaders and is always discarded');
const g = game();
g.factions.harkonnen.forces.onBoard.arrakeen = 10;
for (const f of ALL) { g.factions[f].treacheryHand = []; delete g.factions[f].pendingTraitorHand; g.factions[f].traitorHand = []; } // test Artillery alone, no traitors
g.factions.atreides.treacheryHand = ['artilleryStrike'];
g.factions.harkonnen.treacheryHand = ['shield1'];
const battlePlan = (leaderId, v, forces, w, d) => ({ forcesCommitted: forces, starredForcesCommitted: 0, spiceCommitted: 0, supportedStarredCount: 0, supportedOrdinaryCount: 0,
  leaderId, leaderFightingValue: v, weaponCardId: w, defenseCardId: d, cheapHeroCardId: null });
const [res] = await turnEngine.runBattlePhase(g, { ...turnEngine.passiveDecisionProvider, chooseCardsToDiscard: () => [],
  chooseBattlePlan: (st, f) => f === 'atreides' ? battlePlan('thufirHawat', 5, 4, 'artilleryStrike', null) : battlePlan('feydRautha', 6, 4, null, 'shield1') }, cards);
// Atreides 4 forces (unbacked = 2) vs Harkonnen 4 forces (unbacked = 2); leaders don't count; tie goes to the aggressor.
assert(res.winnerFactionId === res.aggressorId, `with leaders not counting, 2 vs 2 is a tie that goes to the aggressor (${res.aggressorId})`);
assert(g.decks.treacheryDiscard.includes('artilleryStrike'), 'the Artillery Strike was discarded even though its side won (or lost)');

console.log('\nTest 7: the Voice names card types, and new cards count as every type they are');
const v = game();
v.factions.harkonnen.treacheryHand = ['poisonBlade'];
let p = enforceVoice(v, 'harkonnen', plan('poisonBlade'), { command: 'notPlay', category: 'poisonWeapon' }, cards);
assert(p.weaponCardId === null, '"Must not play a poison weapon" also forbids a Poison Blade');
p = enforceVoice(v, 'harkonnen', plan(null), { command: 'play', category: 'projectileWeapon' }, cards);
assert(p.weaponCardId === 'poisonBlade', '"Must play a projectile weapon" is satisfied by a Poison Blade');

console.log('\nAll Ixians & Tleilaxu battle card checks passed.');
