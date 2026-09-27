// expansionExtras.sim.js — Ixian Technology and Suboid exchange; Tleilaxu Gholas and leader deals.
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import { killLeader } from '../js/battleEngine.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cards = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const SIX = ['atreides', 'harkonnen', 'emperor', 'fremen', 'ixians', 'tleilaxu'];
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const game = () => {
  const s = initializeGame({ activeFactionIds: SIX, playerCircleOrder: SIX, rulesConfig, seed: 17, spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
  for (const f of SIX) { delete s.factions[f].pendingTraitorHand; s.factions[f].traitorHand = []; }
  s.meta.turn = 3;
  return s;
};

console.log('Test 1: Ixian Technology swaps the card about to be auctioned');
let s = game();
s.factions.ixians.treacheryHand = ['baliset'];
let offered = null;
await turnEngine.runBiddingPhase(s, { ...turnEngine.passiveDecisionProvider, chooseIxianTechnology: (st, f, upcoming) => { offered = upcoming; return 'baliset'; } });
assert(offered && s.factions.ixians.treacheryHand.includes(offered) && !s.factions.ixians.treacheryHand.includes('baliset'), `the Ixians took ${offered} and put Baliset up for auction instead`);

console.log('\nTest 2: the rulebook example of Suboids replacing lost Cyborgs');
s = game();
const ix = s.factions.ixians;
ix.forces.onBoard = { arrakeen: 8 }; ix.forces.starredOnBoard = { arrakeen: 2 };   // 2 Cyborgs, 6 Suboids
ix.forces.reserve = 12; ix.forces.starredReserve = 5;
s.factions.atreides.forces.onBoard.arrakeen = 1;
const plan = (leaderId, v, forces, starred = 0) => ({ forcesCommitted: forces, starredForcesCommitted: starred, spiceCommitted: 0, supportedStarredCount: 0, supportedOrdinaryCount: 0,
  leaderId, leaderFightingValue: v, weaponCardId: null, defenseCardId: null, cheapHeroCardId: null });
const [res] = await turnEngine.runBattlePhase(s, { ...turnEngine.passiveDecisionProvider, chooseSuboidExchange: (st, f, { max }) => max,
  chooseBattlePlan: (st, f) => f === 'ixians' ? plan('tessiaVernius', 5, 6, 2) : plan('duncanIdaho', 2, 0) }, cards);
assert(res.winnerFactionId === 'ixians', 'the Ixians won, dialling 6 (2 Cyborgs, 4 Suboids)');
assert(ix.forces.onBoard.arrakeen === 2 && ix.forces.starredOnBoard.arrakeen === 2, 'afterwards Arrakeen holds 2 Cyborgs and no Suboids');
assert(ix.revivalTanks === 6 && (ix.starredRevivalTanks ?? 0) === 0, 'and the tanks hold 6 Suboids');

console.log('\nTest 3: a Tleilaxu Ghola fights for them, and returns to its owner\'s tanks when it dies');
s = game();
const tl = s.factions.tleilaxu;
tl.leaders.available = ['blin']; tl.spice = 10;
s.factions.harkonnen.leaders.available = s.factions.harkonnen.leaders.available.filter(id => id !== 'feydRautha');
s.factions.harkonnen.leaders.killed.push('feydRautha');
await turnEngine.runRevivalPhase(s, { ...turnEngine.passiveDecisionProvider, chooseGholaRevival: (st, f, opts) => opts.find(o => o.leaderId === 'feydRautha')?.leaderId });
assert(tl.leaders.available.includes('feydRautha') && tl.spice === 7, 'the Tleilaxu revived Feyd-Rautha as a Ghola for 3 spice (half of 6, rounded up)');
killLeader(s, 'tleilaxu', 'feydRautha', 6);
assert(s.factions.harkonnen.leaders.killed.includes('feydRautha') && !tl.leaders.killed.includes('feydRautha'), 'killed, he went back to the Harkonnen tanks');

console.log('\nTest 4: buying a leader back early from the Tleilaxu');
s = game();
const at = s.factions.atreides;
at.leaders.available = at.leaders.available.filter(id => id !== 'thufirHawat'); at.leaders.killed.push('thufirHawat'); at.spice = 12;
const tlSpice = s.factions.tleilaxu.spice;
await turnEngine.runRevivalPhase(s, { ...turnEngine.passiveDecisionProvider,
  chooseEarlyLeaderRevival: (st, f) => (f === 'atreides' ? 'thufirHawat' : null), chooseLeaderRevivalPrice: () => 7, chooseAcceptLeaderRevivalPrice: () => true });
assert(at.leaders.available.includes('thufirHawat') && at.spice === 5 && s.factions.tleilaxu.spice === tlSpice + 7, 'Atreides paid the Tleilaxu 7 spice and got Thufir Hawat back');

console.log('\nAll expansion extras checks passed.');
