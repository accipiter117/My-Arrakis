// advisors.sim.js — Bene Gesserit advisors (base game, advanced).
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import * as adv from '../js/advisors.js';
import { canMove, executeMove, isStrongholdBlocked } from '../js/movementEngine.js';
import { strongholdIdsFrom, strongholdsOccupiedBy } from '../js/victoryEngine.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cards = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const ids = ['atreides', 'harkonnen', 'emperor', 'gesserit', 'guild'];
const game = () => initializeGame({ activeFactionIds: ids, playerCircleOrder: ids, rulesConfig, seed: 8, spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
const P = turnEngine.passiveDecisionProvider;
const ship = (f, t, n) => ({ ...P, chooseShipmentAndMovement: (st, x) => x === f ? { shipment: { territoryId: t, amount: n }, movement: null } : { shipment: null, movement: null } });

console.log('Test 1: an advisor goes in with another faction\'s shipment, and coexists');
let s = game(); s.meta.turn = 2; s.factions.harkonnen.spice = 20;
await turnEngine.runShipmentMovementPhase(s, { ...ship('harkonnen', 'habbanyaSietch', 3), chooseAdvisor: (st, f, shipper, info) => info.territoryId });
assert(s.factions.gesserit.forces.onBoard.habbanyaSietch === 1 && adv.isAdvisorTerritory(s, 'habbanyaSietch'), 'one Bene Gesserit advisor in Habbanya Sietch');
const battles = await turnEngine.runBattlePhase(s, P, cards);
assert(!battles.some(b => b.territoryId === 'habbanyaSietch') && s.factions.gesserit.forces.onBoard.habbanyaSietch === 1, 'no battle there: advisors never fight');
assert(!strongholdsOccupiedBy(s, 'gesserit', strongholdIdsFrom(territories)).includes('habbanyaSietch'), 'and they do not hold the stronghold');
assert(!isStrongholdBlocked(s, 'habbanyaSietch', 'emperor'), 'nor count towards the two-faction limit (Harkonnen and advisors there: the Emperor may still enter)');

console.log('\nTest 2: Universal Stewards and moving');
s = game();
s.factions.gesserit.forces.onBoard.funeralPlain = 3; adv.setAdvisors(s, 'funeralPlain', true);
await turnEngine.runBattlePhase(s, P, cards);
assert(!adv.isAdvisorTerritory(s, 'funeralPlain'), 'advisors alone in the Funeral Plain become fighters before battles');
s.factions.gesserit.forces.onBoard.theGreatFlat = 2; adv.setAdvisors(s, 'theGreatFlat', true);
s.factions.harkonnen.forces.onBoard.theGreaterFlat = 4;
s.meta.bgMoveAsAdvisors = true;
executeMove(s, 'gesserit', 'theGreatFlat', 'theGreaterFlat', 2);
delete s.meta.bgMoveAsAdvisors;
assert(adv.isAdvisorTerritory(s, 'theGreaterFlat'), 'moved into an occupied territory, they may stay advisors');
s.factions.gesserit.hasMovedThisTurn = false;
executeMove(s, 'gesserit', 'theGreaterFlat', 'habbanyaErg', 2);
assert(!adv.isAdvisorTerritory(s, 'habbanyaErg') && s.factions.gesserit.forces.onBoard.habbanyaErg === 2, 'moved into an empty territory, they must become fighters');

console.log('\nTest 3: Intrusion, and taking up arms');
s = game(); s.meta.turn = 2;
s.factions.gesserit.forces.onBoard.tueksSietch = 3; delete s.factions.guild.forces.onBoard.tueksSietch; s.factions.guild.forces.reserve += 5;
s.factions.harkonnen.forces.onBoard.southMesa = 5; s.factions.harkonnen.spice = 20;
await turnEngine.runShipmentMovementPhase(s, { ...P, chooseIntrusion: () => true,
  chooseShipmentAndMovement: (st, f) => f === 'harkonnen' ? { shipment: null, movement: { from: 'southMesa', to: 'tueksSietch', amount: 5 } } : { shipment: null, movement: null } });
assert(adv.isAdvisorTerritory(s, 'tueksSietch'), 'Harkonnen moved into Tuek\'s Sietch: the Bene Gesserit fighters became advisors');
await turnEngine.runShipmentMovementPhase(s, { ...P, chooseAdvisorsToFight: (st, f, { territories: ts }) => ts });
assert(!adv.isAdvisorTerritory(s, 'tueksSietch'), 'next turn, before shipments, they took up arms again');
const b3 = await turnEngine.runBattlePhase(s, P, cards);
assert(b3.some(b => b.territoryId === 'tueksSietch'), 'and a battle follows there');

console.log('\nAll advisor tests passed.');
