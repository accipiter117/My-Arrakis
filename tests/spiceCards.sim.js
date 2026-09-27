// spiceCards.sim.js — Sandtrout, Thumper, Harvester, Amal and the Cheap Hero traitor (expansion M1).
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import { playAmal } from '../js/cardEffects.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cards = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const ALL = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const game = () => {
  const s = initializeGame({ activeFactionIds: ALL, playerCircleOrder: ALL, rulesConfig, seed: 12, spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
  s.meta.turn = 3;
  return s;
};
const T = id => ({ type: 'territory', id, maxValue: territories.territories[id].spiceBlow.maxValue });
const W = n => ({ type: 'shaiHulud', id: `shaiHulud${n}` });
const stack = (s, cardsTopLast) => { s.decks.spiceDeck = cardsTopLast; }; // draws pop from the end

console.log('Test 1: Sandtrout and Kull Wahad are in play only with the expansion cards');
let s = game();
assert(s.decks.spiceDeck.some(c => c.type === 'sandtrout'), 'Sandtrout is in the spice deck');
const off = initializeGame({ activeFactionIds: ALL, playerCircleOrder: ALL, rulesConfig: { ...rulesConfig, expansions: { ixTlCards: false } }, seed: 12, spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
assert(!off.decks.spiceDeck.some(c => c.type === 'sandtrout'), '...and not without them');
assert(!s.decks.treacheryDeck.includes('kullWahad'), 'Kull Wahad stays out while worthless cards are off (decision D1)');

console.log('\nTest 2: Sandtrout cancels alliances, calms the next worm, doubles the blow after it');
s = game();
s.alliances = [{ factions: ['atreides', 'fremen'], formedTurn: 1 }];
s.decks.spiceDiscardA = [T('theGreatFlat')]; s.decks.spiceDiscardB = [T('southMesa')];
stack(s, [T('funeralPlain'), T('habbanyaErg'), W(1), { type: 'sandtrout', id: 'sandtrout' }]);
await turnEngine.runSpiceBlowPhase(s, turnEngine.passiveDecisionProvider);
const draws = s.nexus.draws;
assert(s.alliances.length === 0, 'the Atreides-Fremen alliance was cancelled');
assert(draws.some(d => d.kind === 'worm' && d.sandtrout), 'the worm after the Sandtrout brought no Nexus');
const blow = draws.find(d => d.kind === 'territory' && d.pile === 'A');
assert(blow.doubled && blow.amount === territories.territories.habbanyaErg.spiceBlow.maxValue * 2, `the following blow doubled (${blow.amount} spice in Habbanya Erg)`);
assert(!s.nexus.active, 'no Nexus this phase');

console.log('\nTest 3: Thumper calls a worm onto the last spice territory, with a Nexus');
s = game();
s.decks.spiceDiscardA = [T('theGreatFlat')];
s.board.spiceBlowMarkers.push({ territoryId: 'theGreatFlat', amount: 10, pile: 'A', turn: 2 });
s.factions.harkonnen.forces.onBoard.theGreatFlat = 6;
s.factions.atreides.treacheryHand = ['thumper'];
stack(s, [T('southMesa'), T('funeralPlain')]);
await turnEngine.runSpiceBlowPhase(s, { ...turnEngine.passiveDecisionProvider, chooseThumper: (st, f) => f === 'atreides' });
assert(!s.factions.harkonnen.forces.onBoard.theGreatFlat && s.nexus.active, 'the worm devoured 6 Harkonnen on the Great Flat, and a Nexus followed');
assert(!s.factions.atreides.treacheryHand.includes('thumper'), 'the Thumper was used up');

console.log('\nTest 4: Harvester doubles a fresh blow');
s = game();
s.decks.spiceDiscardA = [T('theGreatFlat')]; s.decks.spiceDiscardB = [T('southMesa')];
s.factions.fremen.treacheryHand = ['harvester'];
stack(s, [T('funeralPlain'), T('habbanyaErg')]);
await turnEngine.runSpiceBlowPhase(s, { ...turnEngine.passiveDecisionProvider, chooseHarvester: (st, f, blows) => blows[0].territoryId });
const doubled = s.board.spiceBlowMarkers.find(m => m.territoryId === 'habbanyaErg');
assert(doubled.amount === territories.territories.habbanyaErg.spiceBlow.maxValue * 2, `Habbanya Erg doubled to ${doubled.amount}`);

console.log('\nTest 5: Amal halves every faction\'s spice, rounded up');
s = game();
s.factions.atreides.treacheryHand = ['amal']; s.factions.guild.spice = 21;
const before = s.factions.guild.spice;
playAmal(s, 'atreides');
assert(s.factions.guild.spice === before - Math.ceil(before / 2), `Guild 21 -> ${s.factions.guild.spice}`);

console.log('\nTest 6: the Cheap Hero traitor springs against any Cheap Hero');
s = game();
for (const f of ALL) { delete s.factions[f].pendingTraitorHand; s.factions[f].traitorHand = []; s.factions[f].treacheryHand = []; }
s.factions.atreides.traitorHand = ['cheapHeroTraitor'];
s.factions.harkonnen.treacheryHand = ['cheapHero1'];
s.factions.harkonnen.forces.onBoard.arrakeen = 8;
const plan = (leaderId, v, forces, hero = null) => ({ forcesCommitted: forces, starredForcesCommitted: 0, spiceCommitted: 0, supportedStarredCount: 0, supportedOrdinaryCount: 0,
  leaderId, leaderFightingValue: v, weaponCardId: null, defenseCardId: null, cheapHeroCardId: hero });
const [res] = await turnEngine.runBattlePhase(s, { ...turnEngine.passiveDecisionProvider,
  chooseBattlePlan: (st, f) => f === 'harkonnen' ? plan(null, 0, 8, 'cheapHero1') : plan('duncanIdaho', 2, 0) }, cards);
assert(res.traitor && res.winnerFactionId === 'atreides', 'Atreides revealed the Cheap Hero traitor and won outright');

console.log('\nAll Ixians & Tleilaxu special card checks passed.');
