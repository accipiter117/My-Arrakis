// victoryWatch.sim.js — the warnings match the real victory rules.
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import { assessVictoryWatch } from '../js/victoryWatch.js';
import { formAlliance } from '../js/allianceEngine.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const ALL = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const game = () => initializeGame({ activeFactionIds: ALL, playerCircleOrder: ALL, rulesConfig, seed: 1, spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });

console.log('Test 1: the starting position raises no warnings on turn 1');
let s = game();
assert(assessVictoryWatch(s, territories).length === 0, 'nobody starts one stronghold from victory');

console.log('\nTest 2: a faction on 2 strongholds is one step away, and the open strongholds decide it');
s = game();
s.factions.guild.forces.onBoard.carthag = 3;
let w = assessVictoryWatch(s, territories);
const guild = w.find(x => x.factions.includes('guild'));
assert(guild?.level === 'warning' && guild.deciding.includes('arrakeen') && !guild.deciding.includes('carthag'), 'Guild warning names Arrakeen, not Carthag, as deciding');

console.log('\nTest 3: an alliance on 3 of 4 is one step away; on 4 it is critical');
s = game();
s.nexus.active = true; formAlliance(s, 'atreides', 'harkonnen');
s.factions.atreides.forces.onBoard.habbanyaSietch = 2;
w = assessVictoryWatch(s, territories);
assert(w.some(x => x.level === 'warning' && x.factions.includes('atreides') && x.factions.includes('harkonnen')), 'alliance on 3 of 4 flagged');
s.factions.harkonnen.forces.onBoard.sietchTabr = 2;
w = assessVictoryWatch(s, territories);
assert(w[0].level === 'critical' && w[0].factions.includes('harkonnen'), 'alliance on 4 flagged as winning this turn');

console.log('\nTest 4: the Fremen special victory is flagged near the end, and blocked by one troop in Tuek’s Sietch');
s = game();
s.meta.turn = 9;
s.factions.guild.forces.onBoard = {};
w = assessVictoryWatch(s, territories);
assert(w.some(x => x.headline.includes('Fremen special')), 'Fremen special flagged on turn 9');
s.factions.atreides.forces.onBoard.tueksSietch = 1;
w = assessVictoryWatch(s, territories);
assert(!w.some(x => x.headline.includes('Fremen special')), 'one Atreides troop in Tuek’s Sietch clears it');

console.log('\nAll victory watch checks passed.');
