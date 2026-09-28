// richeseCards.sim.js — Richese part 3 (Black Market, cache card effects, alliance),
// plus Ghola buy-back and Face Dancer replacements from the board.
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import * as rc from '../js/richeseCards.js';
import { resolveWeaponDefense } from '../js/battleEngine.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cards = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const SIX = ['atreides', 'harkonnen', 'emperor', 'fremen', 'tleilaxu', 'richese'];
const game = (ids = SIX, seed = 4) => initializeGame({ activeFactionIds: ids, playerCircleOrder: ids, rulesConfig, seed,
  spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
const P = turnEngine.passiveDecisionProvider;
const clearTraitors = s => { for (const f of Object.keys(s.factions)) { delete s.factions[f].pendingTraitorHand; s.factions[f].traitorHand = []; } s.factions.tleilaxu && (s.factions.tleilaxu.faceDancers = []); };
const plan = (leaderId, v, forces, extra = {}) => ({ forcesCommitted: forces, starredForcesCommitted: 0, spiceCommitted: 0, supportedStarredCount: 0, supportedOrdinaryCount: 0,
  leaderId, leaderFightingValue: v, weaponCardId: null, defenseCardId: null, cheapHeroCardId: null, ...extra });

console.log('Test 1: Black Market');
let s = game(); s.meta.turn = 2; s.factions.richese.cache = [];
for (const f of SIX) { s.factions[f].treacheryHand = []; s.factions[f].spice = 20; }
s.factions.richese.treacheryHand = ['baliset'];
const evs = [];
await turnEngine.runBiddingPhase(s, { ...P, observe: e => evs.push(e),
  chooseBlackMarket: () => ({ cardId: 'baliset', claimId: 'lasgun', method: 'silent' }),
  chooseSilentBid: (st, f, info) => (f === 'emperor' && info.blackMarket ? 7 : 0) });
assert(s.factions.emperor.treacheryHand.includes('baliset') && s.factions.richese.spice === 27, 'sold (announced as a Lasgun) to the Emperor for 7, all to Richese');
assert(evs.find(e => e.type === 'auctionStart')?.total === 5, 'one fewer normal card that round');
s = game(); s.meta.turn = 2; s.factions.richese.cache = [];
for (const f of SIX) s.factions[f].treacheryHand = [];
s.factions.richese.treacheryHand = ['chaumas'];
await turnEngine.runBiddingPhase(s, { ...P, chooseBlackMarket: () => ({ cardId: 'chaumas', claimId: 'chaumas', method: 'normal' }) });
assert(s.factions.richese.treacheryHand.includes('chaumas'), 'no spice bid: Richese keep it');

console.log('\nTest 2: Mirror Weapon, Portable Snooper, Stone Burner');
let wd = resolveWeaponDefense(plan('a', 1, 1, { weaponCardId: 'mirrorWeapon' }), plan('b', 1, 1, { weaponCardId: 'chaumas' }), cards);
assert(wd.defenderLeaderKilled && wd.aggressorLeaderKilled, 'a Mirror Weapon copies a poison weapon: both leaders die');
wd = resolveWeaponDefense(plan('a', 1, 1, { weaponCardId: 'chaumas' }), plan('b', 1, 1, { defenseCardId: 'portableSnooper' }), cards);
assert(!wd.defenderLeaderKilled, 'a Portable Snooper stops a poison weapon');
s = game(); clearTraitors(s);
s.factions.richese.forces.onBoard = { carthag: 6 }; s.factions.richese.treacheryHand = ['stoneBurner'];
let [b] = await turnEngine.runBattlePhase(s, { ...P, chooseStoneBurnerMode: () => 'kill',
  chooseBattlePlan: (st, f) => f === 'richese' ? plan('talisBalt', 2, 1, { weaponCardId: 'stoneBurner' }) : plan('feydRautha', 6, 8) }, cards);
assert(b.winnerFactionId === 'richese' && s.factions.harkonnen.leaders.killed.includes('feydRautha') && s.factions.richese.leaders.killed.includes('talisBalt'),
  'Stone Burner (kill): both leaders die; Richese have 5 undialled forces to Harkonnen\'s 2, and win');
assert(s.decks.treacheryDiscard.includes('stoneBurner'), 'discarded after use, even by the winner');

console.log('\nTest 3: Residual Poison and Portable Snooper in the battle runner');
s = game(); clearTraitors(s);
s.factions.richese.forces.onBoard = { carthag: 3 }; s.factions.richese.treacheryHand = ['residualPoison', 'portableSnooper'];
s.factions.harkonnen.treacheryHand = ['chaumas'];
const before = s.factions.harkonnen.leaders.available.length;
[b] = await turnEngine.runBattlePhase(s, { ...P, chooseResidualPoison: () => true, choosePortableSnooper: () => true,
  chooseBattlePlan: (st, f) => f === 'richese' ? plan('talisBalt', 2, 3) : plan(st.factions.harkonnen.leaders.available[0], 1, 1, { weaponCardId: 'chaumas' }) }, cards);
assert(s.factions.harkonnen.leaders.killed.length >= 1 && before - 1 >= 0, 'Residual Poison killed a Harkonnen leader before plans');
assert(b.plans.richese.defense === 'portableSnooper' && s.factions.richese.leaders.available.includes('talisBalt'), 'Portable Snooper added after the reveal saved Talis Balt from Chaumas');

console.log('\nTest 4: Distrans, Nullentropy Box, Semuta Drug');
s = game();
s.factions.richese.treacheryHand = ['distrans', 'baliset']; s.factions.atreides.treacheryHand = [];
assert(rc.playDistrans(s, 'richese', 'atreides', 'baliset') && s.factions.atreides.treacheryHand.includes('baliset') && s.decks.treacheryDiscard.includes('distrans'), 'Distrans passes a card');
s.factions.richese.treacheryHand = ['nullentropyBox']; s.factions.richese.spice = 5; s.decks.treacheryDiscard = ['lasgun', 'chaumas'];
rc.playNullentropy(s, 'richese', 'lasgun');
assert(s.factions.richese.treacheryHand.includes('lasgun') && s.factions.richese.spice === 3 && s.decks.treacheryDiscard.at(-1) === 'nullentropyBox', 'Nullentropy Box: 2 spice, takes the Lasgun, goes on top');
s.factions.fremen.treacheryHand = ['semutaDrug']; rc.markSemuta(s, 'fremen');
s.decks.treacheryDiscard.push('shield1');
assert(JSON.stringify(rc.semutaChoices(s, 'fremen')) === '["shield1"]' && rc.playSemuta(s, 'fremen', 'shield1') && s.factions.fremen.treacheryHand.includes('shield1'), 'Semuta Drug takes a card just discarded');

console.log('\nTest 5: Juice of Sapho makes the defender the aggressor');
s = game(); clearTraitors(s);
s.factions.richese.forces.onBoard = { carthag: 5 }; s.factions.richese.treacheryHand = ['juiceOfSapho'];
[b] = await turnEngine.runBattlePhase(s, { ...P, chooseJuiceOfSapho: () => 'aggressor',
  chooseBattlePlan: (st, f) => f === 'richese' ? plan('talisBalt', 2, 3) : plan('feydRautha', 2, 3) }, cards);
assert(b.aggressorId === 'richese', 'Richese fought as the aggressor');

console.log('\nTest 6: Richese ship their ally with a No-Field token');
s = game(); s.meta.turn = 2;
s.alliances = [{ factions: ['richese', 'atreides'], formedTurn: 1 }];
s.factions.atreides.spice = 10;
await turnEngine.runShipmentMovementPhase(s, { ...P, chooseAllyNoField: () => true,
  chooseShipmentAndMovement: (st, f) => f === 'atreides' ? { shipment: { territoryId: 'theGreatFlat', amount: 5, noField: 5 }, movement: null } : { shipment: null, movement: null } });
assert(s.factions.atreides.forces.onBoard.theGreatFlat === 5 && s.factions.atreides.spice === 8 && s.factions.richese.noField.lastUsed === 5 && !s.factions.richese.noField.onPlanet,
  '5 Atreides arrive for the price of one force (2 spice); the token is face up, nothing hidden on the planet');

console.log('\nTest 7: Ghola buy-back');
s = game(); s.meta.turn = 2;
s.factions.atreides.leaders.available = s.factions.atreides.leaders.available.filter(l => l !== 'ladyJessica');
s.factions.tleilaxu.leaders.available.push('ladyJessica');
s.factions.tleilaxu.specialFactionState = { gholas: { ladyJessica: 'atreides' } };
s.factions.atreides.spice = 20; const tlSpice = s.factions.tleilaxu.spice;
await turnEngine.runRevivalPhase(s, { ...P, chooseGholaBuyBack: () => 6, chooseAcceptGholaBuyBack: () => true });
assert(s.factions.atreides.leaders.available.includes('ladyJessica') && s.factions.atreides.spice === 14 && s.factions.tleilaxu.spice === tlSpice + 6, 'Atreides bought Lady Jessica back for 6');

console.log('\nTest 8: Face Dancer replacements from the board');
s = game(); clearTraitors(s);
s.factions.tleilaxu.faceDancers = [{ leaderId: 'feydRautha', factionId: 'harkonnen', revealed: false }, { leaderId: 'x1', revealed: false }, { leaderId: 'x2', revealed: false }];
s.factions.tleilaxu.forces.reserve = 2; s.factions.tleilaxu.forces.onBoard = { theGreatFlat: 6 };
s.factions.harkonnen.forces.onBoard.arrakeen = 10;
[b] = await turnEngine.runBattlePhase(s, { ...P, chooseRevealFaceDancer: () => true,
  chooseFaceDancerSources: (st, f, { count, reserve }) => ({ reserve, from: { theGreatFlat: count - reserve } }),
  chooseBattlePlan: (st, f) => f === 'harkonnen' ? plan('feydRautha', 6, 4) : plan('duncanIdaho', 2, 0) }, cards);
assert(s.factions.tleilaxu.forces.onBoard.arrakeen === 6 && s.factions.tleilaxu.forces.onBoard.theGreatFlat === 2 && s.factions.tleilaxu.forces.reserve === 0,
  '6 Tleilaxu took Arrakeen: 2 from reserves and 4 from the Great Flat');

console.log('\nAll Richese card, alliance, Ghola and Face Dancer tests passed.');
