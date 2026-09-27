// alliancePerks.sim.js — every faction's alliance advantage, in one place.
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import { shipmentCostPerForce } from '../js/movementEngine.js';
import { canReviveForces, freeRevivalAllowance, canEmperorReviveForAlly } from '../js/revivalEngine.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cards = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const game = factions => {
  const s = initializeGame({ activeFactionIds: factions, playerCircleOrder: factions, rulesConfig, seed: 3, spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
  for (const f of factions) { delete s.factions[f].pendingTraitorHand; s.factions[f].traitorHand = []; }
  return s;
};
const ally = (s, a, b) => { s.alliances = [{ factions: [a, b], formedTurn: 1 }]; };
const plan = (leaderId, v, forces) => ({ forcesCommitted: forces, starredForcesCommitted: 0, spiceCommitted: 0, supportedStarredCount: 0, supportedOrdinaryCount: 0, leaderId, leaderFightingValue: v, weaponCardId: null, defenseCardId: null, cheapHeroCardId: null });

console.log('Every alliance advantage:');
let s = game(['atreides', 'guild', 'harkonnen']); ally(s, 'atreides', 'guild');
assert(shipmentCostPerForce(s, 'atreides', 'theGreatFlat') === 1, 'Guild: the ally ships at half price');

s = game(['atreides', 'fremen', 'harkonnen']); ally(s, 'atreides', 'fremen');
assert(freeRevivalAllowance('atreides', s) === 3, 'Fremen: the ally revives 3 free');

s = game(['atreides', 'emperor', 'harkonnen']); ally(s, 'atreides', 'emperor'); s.factions.atreides.revivalTanks = 5;
assert(canEmperorReviveForAlly(s, 'atreides', 3).ok, 'Emperor: may pay for 3 extra revivals for the ally');

s = game(['atreides', 'fremen', 'harkonnen']); ally(s, 'atreides', 'fremen');
s.factions.harkonnen.forces.onBoard.sietchTabr = 4;
let intelFor = null;
await turnEngine.runBattlePhase(s, { ...turnEngine.passiveDecisionProvider, chooseBattlePlan: (st, f, t, o, intel) => { if (intel) intelFor = f; return turnEngine.passiveDecisionProvider.chooseBattlePlan(st, f, t, o); } }, cards);
assert(intelFor === 'fremen', 'Atreides: Prescience in the ally\'s battles');

s = game(['gesserit', 'fremen', 'harkonnen']); ally(s, 'gesserit', 'fremen');
s.factions.harkonnen.forces.onBoard.sietchTabr = 4;
let voiced = false;
await turnEngine.runBattlePhase(s, { ...turnEngine.passiveDecisionProvider, chooseVoice: () => { voiced = true; return { command: 'notPlay', category: 'poisonWeapon' }; } }, cards);
assert(voiced, 'Bene Gesserit: the Voice in the ally\'s battles');

s = game(['harkonnen', 'fremen', 'atreides']); ally(s, 'harkonnen', 'fremen');
s.factions.harkonnen.traitorHand = ['thufirHawat']; s.factions.fremen.forces.onBoard.arrakeen = 6;
const [hr] = await turnEngine.runBattlePhase(s, { ...turnEngine.passiveDecisionProvider,
  chooseBattlePlan: (st, f) => f === 'atreides' ? plan('thufirHawat', 5, 5) : plan('stilgar', 7, 1) }, cards);
assert(hr.traitorCard?.revealedBy === 'harkonnen' && hr.winnerFactionId === 'fremen', 'Harkonnen: its traitors work in the ally\'s battles');

s = game(['atreides', 'tleilaxu', 'harkonnen']); ally(s, 'atreides', 'tleilaxu');
s.factions.atreides.revivalTanks = 5; s.factions.atreides.spice = 10;
assert(canReviveForces(s, 'atreides', 3, 0).cost === 1, 'Tleilaxu: the ally revives at half price (1 paid force: 2 spice, halved to 1)');

s = game(['atreides', 'ixians', 'harkonnen']); ally(s, 'atreides', 'ixians'); s.meta.turn = 2;
for (const f of Object.keys(s.factions)) s.factions[f].spice = f === 'atreides' ? 20 : 0;
s.decks.treacheryDeck.push('baliset');
let swapped = false;
await turnEngine.runBiddingPhase(s, { ...turnEngine.passiveDecisionProvider,
  chooseBid: (st, f, id, cur) => (f === 'atreides' && cur === 0 ? 1 : null),
  chooseIxianAllySwap: () => { swapped = true; return true; } });
assert(swapped, 'Ixians: the ally may swap a card it has just bought for the top card');

console.log('\nAll alliance advantages work.');
