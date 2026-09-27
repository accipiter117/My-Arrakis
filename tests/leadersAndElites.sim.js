// leadersAndElites.sim.js — leader revival until all are back, Dead Again,
// and choosing elite troops when shipping and moving.
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import { canReviveLeader, reviveLeader, resetRevivalTurnFlags, isEligibleForLeaderRevival } from '../js/revivalEngine.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const ALL = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const game = () => initializeGame({ activeFactionIds: ALL, playerCircleOrder: ALL, rulesConfig, seed: 8, spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });

console.log('Test 1: leader revival is closed while any leader is alive');
let s = game();
const at = s.factions.atreides;
const all = [...at.leaders.available];
at.leaders.killed = all.slice(0, 4); at.leaders.available = all.slice(4); at.spice = 50;
assert(!isEligibleForLeaderRevival(s, 'atreides'), 'with one leader still alive, no revival');

console.log('\nTest 2: once all are dead, one a turn until all are back');
at.leaders.killed = [...all]; at.leaders.available = [];
let revived = 0;
for (let turn = 0; turn < 6; turn++) {
  const next = at.leaders.killed[0];
  if (next && canReviveLeader(s, 'atreides', next, 1).ok) { reviveLeader(s, 'atreides', next, 1); revived++; }
  if (next && at.leaders.killed.length) assert(!canReviveLeader(s, 'atreides', at.leaders.killed[0], 1).ok, `turn ${turn + 1}: only one per turn`);
  resetRevivalTurnFlags(s);
}
assert(revived === 5 && at.leaders.killed.length === 0, 'all 5 leaders revived over 5 turns, although one was alive after the first');
assert(!isEligibleForLeaderRevival(s, 'atreides'), 'with everyone back, the window closes');

console.log('\nTest 3: Dead Again');
s = game();
const hk = s.factions.harkonnen, H = [...hk.leaders.available];
hk.spice = 50; hk.leaders.killed = [...H]; hk.leaders.available = [];
reviveLeader(s, 'harkonnen', H[0], 1); resetRevivalTurnFlags(s);
hk.leaders.available = hk.leaders.available.filter(id => id !== H[0]); hk.leaders.killed.push(H[0]); // killed again
assert(!canReviveLeader(s, 'harkonnen', H[0], 1).ok, 'a leader killed again waits while others are still in the tanks');
assert(canReviveLeader(s, 'harkonnen', H[1], 1).ok, 'the others can still be revived');

console.log('\nTest 4: the Emperor chooses how many Sardaukar ship, and the Fremen how many Fedaykin move');
s = game();
await turnEngine.runShipmentMovementPhase(s, { ...turnEngine.passiveDecisionProvider,
  chooseShipmentAndMovement: (st, f) => f === 'emperor' ? { shipment: { territoryId: 'arrakeen', amount: 4, starred: 1 }, movement: null } : { shipment: null, movement: null } });
assert(s.factions.emperor.forces.onBoard.arrakeen === 4 && s.factions.emperor.forces.starredOnBoard.arrakeen === 1, 'Emperor shipped 4, exactly 1 of them Sardaukar');
s = game();
s.factions.fremen.forces.onBoard.sietchTabr = 10; s.factions.fremen.forces.starredOnBoard = { sietchTabr: 3 };
await turnEngine.runShipmentMovementPhase(s, { ...turnEngine.passiveDecisionProvider,
  chooseShipmentAndMovement: (st, f) => f === 'fremen' ? { shipment: null, movement: { from: 'sietchTabr', to: 'plasticBasin', amount: 4, starred: 0 } } : { shipment: null, movement: null } });
assert(s.factions.fremen.forces.onBoard.plasticBasin === 4 && !(s.factions.fremen.forces.starredOnBoard.plasticBasin), 'Fremen moved 4 ordinary troops, keeping all 3 Fedaykin at home');

console.log('\nAll leader and elite troop checks passed.');
