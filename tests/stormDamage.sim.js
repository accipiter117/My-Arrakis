// stormDamage.sim.js — the storm wipes sand territories it passes over.
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import { applyStormDamage } from '../js/stormEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import { executeShipment, shipmentCostPerForce } from '../js/movementEngine.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const ALL = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const game = () => initializeGame({ activeFactionIds: ALL, playerCircleOrder: ALL, rulesConfig, seed: 3, spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
const T = territories.territories;

console.log('Test 1: every territory has a storm sector');
assert(Object.values(T).filter(t => !t.dynamic).every(t => Number.isInteger(t.stormSector) && t.stormSector >= 0 && t.stormSector < 18), 'all 42 map territories are assigned a sector 0-17 (the moving HMS has none: it is immune)');

console.log('\nTest 2: sand in the storm\'s path is wiped; stone and strongholds are not');
let s = game();
const sand = 'theGreatFlat', sector = T[sand].stormSector;          // sand
const rock = Object.keys(T).find(id => T[id].type === 'rock' && T[id].stormSector === T['sietchTabr'].stormSector);
s.factions.atreides.forces.onBoard[sand] = 4;
s.factions.atreides.forces.onBoard[rock] = 3;
s.board.spiceBlowMarkers.push({ territoryId: sand, amount: 10, turn: 1 });
let d = applyStormDamage(s, (sector + 17) % 18, 1);                  // move 1 sector, onto the Great Flat's sector
assert(!s.factions.atreides.forces.onBoard[sand] && s.factions.atreides.revivalTanks === 4, '4 Atreides on the Great Flat went to the tanks');
assert(!s.board.spiceBlowMarkers.some(m => m.territoryId === sand), 'the 10 spice there was blown away');
d = applyStormDamage(s, (T['sietchTabr'].stormSector + 17) % 18, 1);
assert(s.factions.fremen.forces.onBoard.sietchTabr === 10 && s.factions.atreides.forces.onBoard[rock] === 3, 'Sietch Tabr (stronghold) and neighbouring stone are untouched');

console.log('\nTest 3: the Fremen lose only half (rounded up); Imperial Basin is sheltered');
s = game();
s.factions.fremen.forces.onBoard[sand] = 5;
applyStormDamage(s, (sector + 17) % 18, 1);
assert(s.factions.fremen.forces.onBoard[sand] === 2 && s.factions.fremen.revivalTanks === 3, 'Fremen lost 3 of 5 (half, rounded up)');
s.factions.harkonnen.forces.onBoard.imperialBasin = 4;
applyStormDamage(s, (T.imperialBasin.stormSector + 17) % 18, 1);
assert(s.factions.harkonnen.forces.onBoard.imperialBasin === 4, 'Imperial Basin, behind the Shield Wall, is safe');

console.log('\nTest 4: Fremen shipping is free (nothing to the Guild), and brings no Bene Gesserit advisor');
s = game();
const guildBefore = s.factions.guild.spice, fremenBefore = s.factions.fremen.spice, bgSink = s.factions.gesserit.forces.onBoard.polarSink ?? 0;
assert(shipmentCostPerForce(s, 'fremen', 'theGreatFlat') === 0, 'Fremen pay nothing per force');
await turnEngine.runShipmentMovementPhase(s, { ...turnEngine.passiveDecisionProvider, chooseAdvisor: () => true,
  chooseShipmentAndMovement: (st, f) => ({ shipment: f === 'fremen' ? { territoryId: 'theGreatFlat', amount: 3 } : null, movement: null }) });
assert(s.factions.fremen.forces.onBoard.theGreatFlat === 3 && s.factions.guild.spice === guildBefore && s.factions.fremen.spice === fremenBefore, 'Fremen shipped 3; no spice changed hands');
assert((s.factions.gesserit.forces.onBoard.polarSink ?? 0) === bgSink, 'no Bene Gesserit advisor followed the Fremen');

console.log('\nAll storm damage checks passed.');
