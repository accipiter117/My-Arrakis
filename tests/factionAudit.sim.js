// factionAudit.sim.js — faction abilities added in the audit.
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import * as battleEngine from '../js/battleEngine.js';
import { holdsKarama, playKarama } from '../js/cardEffects.js';
import { canCrossShip, executeCrossShip, canRetreatToReserves, executeRetreatToReserves } from '../js/movementEngine.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cards = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const ALL = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const game = () => {
  const s = initializeGame({ activeFactionIds: ALL, playerCircleOrder: ALL, rulesConfig, seed: 4, spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
  for (const f of ALL) { delete s.factions[f].pendingTraitorHand; s.factions[f].traitorHand = []; }
  return s;
};
const plan = (leaderId, value, forces, extra = {}) => ({ forcesCommitted: forces, starredForcesCommitted: 0, spiceCommitted: 0, supportedStarredCount: 0, supportedOrdinaryCount: 0,
  leaderId, leaderFightingValue: value, weaponCardId: null, defenseCardId: null, cheapHeroCardId: null, ...extra });

console.log('Test 1: Fremen forces fight at full strength without spice');
let s = game();
s.factions.harkonnen.forces.onBoard.sietchTabr = 4;
let r = battleEngine.resolveBattle(s, 'sietchTabr', 'harkonnen', 'fremen', plan('feydRautha', 6, 4), plan('stilgar', 6, 4), cards);
assert(r.winnerFactionId === 'fremen', 'Fremen 4 troops unbacked (4) + 6 beat Harkonnen 4 unbacked (2) + 6');

console.log('\nTest 2: a leader carrying the Kwisatz Haderach cannot turn traitor');
s = game();
s.factions.atreides.specialFactionState.kwisatzHaderachActive = true;
s.factions.harkonnen.traitorHand = ['thufirHawat'];
s.factions.harkonnen.forces.onBoard.arrakeen = 3;
const khProvider = { ...turnEngine.passiveDecisionProvider, chooseBattlePlan: (st, f) => f === 'atreides' ? plan('thufirHawat', 5, 2, { useKwisatzHaderach: true }) : plan('feydRautha', 6, 1) };
let [res] = await turnEngine.runBattlePhase(s, khProvider, cards);
assert(!res.traitor && res.winnerFactionId === 'atreides', 'Harkonnen held Thufir as a traitor, but with the Kwisatz Haderach he stayed loyal');

console.log('\nTest 3: Bene Gesserit may use a worthless card as a Karama');
s = game();
s.factions.gesserit.treacheryHand = ['baliset'];
s.factions.harkonnen.treacheryHand = ['baliset2'].filter(() => false);
assert(holdsKarama(s, 'gesserit') && !holdsKarama({ ...s, factions: { ...s.factions, gesserit: { ...s.factions.gesserit, treacheryHand: [] } } }, 'gesserit'), 'a worthless card counts as a Karama for Bene Gesserit');
s.factions.harkonnen.treacheryHand = ['baliset'];
assert(!holdsKarama(s, 'harkonnen'), 'but not for anyone else');
s.factions.harkonnen.treacheryHand = [];
playKarama(s, 'gesserit', 'voice');
assert(!s.factions.gesserit.treacheryHand.includes('baliset') && s.decks.treacheryDiscard.includes('baliset'), 'the worthless card was spent as the Karama');

console.log('\nTest 4: Spiritual Advisors, a free force to the Polar Sink when another faction ships in');
s = game();
const before = s.factions.gesserit.forces.onBoard.polarSink ?? 0;
await turnEngine.runShipmentMovementPhase(s, { ...turnEngine.passiveDecisionProvider, chooseAdvisor: () => true,
  chooseShipmentAndMovement: (st, f) => ({ shipment: f === 'atreides' ? { territoryId: 'arrakeen', amount: 2 } : null, movement: null }) });
assert(s.factions.gesserit.forces.onBoard.polarSink === before + 1 && s.factions.gesserit.forces.reserve === 18, 'Atreides shipped in; Bene Gesserit placed 1 advisor in the Polar Sink');

console.log('\nTest 5: Guild ships across the planet and back to reserves');
s = game();
s.factions.guild.spice = 10;
assert(canCrossShip(s, 'guild', 'tueksSietch', 'theGreatFlat', 3).ok, 'Guild can ship 3 from Tuek\'s Sietch to the Great Flat');
executeCrossShip(s, 'guild', 'tueksSietch', 'theGreatFlat', 3);
assert(s.factions.guild.forces.onBoard.theGreatFlat === 3 && s.factions.guild.forces.onBoard.tueksSietch === 2 && s.factions.guild.spice === 7, 'moved 3 for 3 spice (half of 2 each, rounded up)');
executeRetreatToReserves(s, 'guild', 'theGreatFlat', 3);
assert(s.factions.guild.forces.reserve === 18 && s.factions.guild.spice === 5, '3 back to reserves for 2 spice (1 per 2, rounded up)');
assert(!canCrossShip(s, 'atreides', 'arrakeen', 'theGreatFlat', 2).ok, 'nobody else can');

console.log('\nTest 6: the Guild may act at any point in the order');
s = game();
const order = [];
await turnEngine.runShipmentMovementPhase(s, { ...turnEngine.passiveDecisionProvider, chooseGuildTiming: () => 0,
  chooseShipmentAndMovement: (st, f) => { order.push(f); return { shipment: null, movement: null }; } });
assert(order[0] === 'guild', `the Guild chose to go first (order: ${order.join(', ')})`);

console.log('\nTest 7: the Fremen choose their starting positions');
s = game();
await turnEngine.runSetupDecisions(s, { ...turnEngine.passiveDecisionProvider, chooseFremenPlacement: () => ({ sietchTabr: 4, falseWallSouth: 3, falseWallWest: 3 }) });
assert(JSON.stringify(s.factions.fremen.forces.onBoard) === JSON.stringify({ sietchTabr: 4, falseWallSouth: 3, falseWallWest: 3 }), 'Fremen placed 4 / 3 / 3');
s = game();
await turnEngine.runSetupDecisions(s, { ...turnEngine.passiveDecisionProvider, chooseFremenPlacement: () => ({ sietchTabr: 4, arrakeen: 6 }) });
assert(s.factions.fremen.forces.onBoard.sietchTabr === 10, 'an illegal placement is ignored (all 10 stay in Sietch Tabr)');

console.log('\nAll faction audit checks passed.');
