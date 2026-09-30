// stormCards.sim.js — Weather Control and Family Atomics.
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import * as stormEngine from '../js/stormEngine.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const ids = ['atreides', 'harkonnen', 'emperor', 'guild', 'gesserit'];
const game = () => initializeGame({ activeFactionIds: ids, playerCircleOrder: ids, rulesConfig, seed: 5, spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
const P = turnEngine.passiveDecisionProvider;

console.log('Test 1: Weather Control');
let s = game(); s.meta.turn = 2; s.board.stormPosition = 3;
s.factions.harkonnen.treacheryHand = ['weatherControl'];
await turnEngine.runStormPhase(s, { ...P, chooseWeatherControl: (st, f) => 7 });
assert(s.board.stormPosition === 10 && s.decks.treacheryDiscard.includes('weatherControl') && !s.factions.harkonnen.treacheryHand.length, 'Harkonnen moved the storm exactly 7 sectors and discarded the card');
s = game(); s.meta.turn = 1; s.factions.harkonnen.treacheryHand = ['weatherControl'];
let asked = false;
await turnEngine.runStormPhase(s, { ...P, chooseWeatherControl: () => { asked = true; return 5; } });
assert(!asked, 'not offered on the first storm');

console.log('\nTest 2: Family Atomics');
s = game(); s.meta.turn = 2; s.board.stormPosition = 0;
s.factions.harkonnen.treacheryHand = ['familyAtomics'];
s.factions.emperor.forces.onBoard.shieldWall = 4;
assert(!stormEngine.canUseFamilyAtomics(s, 'harkonnen'), 'needs forces on or next to the Shield Wall');
s.factions.harkonnen.forces.onBoard.imperialBasin = 2;
assert(stormEngine.canUseFamilyAtomics(s, 'harkonnen'), 'Harkonnen next door in Imperial Basin may detonate');
const arrSector = territories.territories.arrakeen.stormSector;
s.board.stormPosition = (arrSector + 17) % 18;   // sector 7: between Imperial Basin (8) and the Shield Wall (6)
assert(!stormEngine.canUseFamilyAtomics(s, 'harkonnen'), 'but not with the storm between Imperial Basin and the Shield Wall');
delete s.factions.harkonnen.forces.onBoard.imperialBasin;
s.factions.harkonnen.forces.onBoard.holeInTheRock = 2;   // same sector as the Shield Wall: nothing between
assert(stormEngine.canUseFamilyAtomics(s, 'harkonnen'), 'from Hole in the Rock the way is clear');
const before = s.factions.emperor.revivalTanks ?? 0;
await turnEngine.runStormPhase(s, { ...P, chooseStormDial: () => 1, chooseFamilyAtomics: () => true });
assert(!s.factions.emperor.forces.onBoard.shieldWall && s.factions.emperor.revivalTanks >= before + 4, 'the 4 Emperor forces on the Shield Wall are destroyed');
assert(s.board.shieldWallDestroyed && !s.factions.harkonnen.treacheryHand.includes('familyAtomics'), 'the Shield Wall is down and the card discarded');
assert(stormEngine.territoriesInPath(s, (arrSector + 17) % 18, 1).includes('arrakeen'), 'Arrakeen now lies in the storm\'s path');
s.factions.atreides.forces.onBoard.arrakeen = 10;
stormEngine.applyStormDamage(s, (arrSector + 17) % 18, 1);
assert(!s.factions.atreides.forces.onBoard.arrakeen, 'and the storm destroys the Atreides forces in Arrakeen');

console.log('\nAll storm card tests passed.');
