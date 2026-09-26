// diplomacy.sim.js — alliances in play: Nexus proposals, betrayal record,
// allies never fighting or sharing territory, ally powers, traitor choices.
// Run with: node tests/diplomacy.sim.js

import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import { canShip, shipmentCostPerForce } from '../js/movementEngine.js';
import { formAlliance, breakAlliance } from '../js/allianceEngine.js';

const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] =
  ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cards = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const ALL = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];

function assert(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('  ok - ' + message);
}
function game() {
  const s = initializeGame({ activeFactionIds: ALL, playerCircleOrder: ALL, rulesConfig, seed: 9,
    spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
  for (const f of ALL) { delete s.factions[f].pendingTraitorHand; s.factions[f].traitorHand = []; }
  s.nexus.active = true;
  return s;
}
const plan = (leaderId, forces = 1) => ({ forcesCommitted: forces, starredForcesCommitted: 0, spiceCommitted: 0,
  supportedStarredCount: 0, supportedOrdinaryCount: 0, leaderId, leaderFightingValue: 3,
  weaponCardId: null, defenseCardId: null, cheapHeroCardId: null });

console.log('Test 1: at a Nexus, a proposal that is accepted forms an alliance; a rejected one does not');
let s = game();
let asked = [];
const diplomat = accept => ({ ...turnEngine.passiveDecisionProvider,
  chooseAllianceProposal: (st, f) => (f === 'atreides' ? 'fremen' : null),
  chooseAllianceResponse: (st, f, from) => { asked.push(`${from}->${f}`); return accept; } });
await turnEngine.runNexusDiplomacy(s, diplomat(true));
assert(asked.join() === 'atreides->fremen', 'Fremen were asked by Atreides');
assert(s.alliances.some(a => a.factions.includes('atreides') && a.factions.includes('fremen')), 'Atreides and Fremen are allied');
s = game(); asked = [];
await turnEngine.runNexusDiplomacy(s, diplomat(false));
assert(s.alliances.length === 0, 'a rejected proposal forms nothing');

console.log('\nTest 2: breaking an alliance is public and remembered');
s = game();
formAlliance(s, 'atreides', 'fremen');
breakAlliance(s, 'atreides');
assert(s.meta.betrayals.length === 1 && s.meta.betrayals[0].by === 'atreides' && s.meta.betrayals[0].of === 'fremen', 'betrayal recorded');

console.log('\nTest 3: allies never fight, even when sharing a territory with an enemy');
s = game();
formAlliance(s, 'atreides', 'fremen');
s.factions.fremen.forces.onBoard.arrakeen = 3;   // ally alongside Atreides
s.factions.harkonnen.forces.onBoard.arrakeen = 4; // enemy
const sites = turnEngine.findBattleTerritories(s).filter(([t]) => t === 'arrakeen');
assert(sites.length === 1 && !(sites[0][1].includes('atreides') && sites[0][1].includes('fremen')), `the battle in Arrakeen is never Atreides vs Fremen (got ${sites[0]?.[1]})`);
s.factions.harkonnen.forces.onBoard = { carthag: 10 };
assert(!turnEngine.findBattleTerritories(s).some(([t]) => t === 'arrakeen'), 'allies alone together: no battle at all');

console.log('\nTest 4: allies may not ship into each other\'s territory; the Guild\'s ally ships at Guild rates');
s = game();
formAlliance(s, 'atreides', 'guild');
assert(!canShip(s, 'guild', 'arrakeen', 2).ok, 'Guild cannot ship into Atreides-held Arrakeen');
assert(shipmentCostPerForce(s, 'atreides', 'theGreatFlat') === 1, 'Atreides, allied to the Guild, ships at half price (1, not 2)');
assert(shipmentCostPerForce(s, 'harkonnen', 'theGreatFlat') === 2, 'Harkonnen still pays full price');

console.log('\nTest 5: a player may decline to reveal a traitor, and the battle is fought normally');
s = game();
s.factions.atreides.traitorHand = ['feydRautha'];
s.factions.harkonnen.forces.onBoard.arrakeen = 8;
const battleWith = (reveal, extra = {}) => ({ ...turnEngine.passiveDecisionProvider, ...extra,
  chooseRevealTraitor: () => reveal,
  chooseBattlePlan: (st, f) => f === 'harkonnen' ? plan('feydRautha', 8) : plan('duncanIdaho', 1) });
let [res] = await turnEngine.runBattlePhase(s, battleWith(false), cards);
assert(!res.traitor && res.winnerFactionId === 'harkonnen', 'kept secret: Harkonnen wins on strength');
s = game();
s.factions.atreides.traitorHand = ['feydRautha'];
s.factions.harkonnen.forces.onBoard.arrakeen = 8;
[res] = await turnEngine.runBattlePhase(s, battleWith(true), cards);
assert(res.traitor && res.winnerFactionId === 'atreides' && res.traitorCard.leaderId === 'feydRautha', 'revealed: Atreides wins outright');

console.log('\nTest 6: Harkonnen can spring a traitor for its ally');
s = game();
formAlliance(s, 'harkonnen', 'fremen');
s.factions.harkonnen.traitorHand = ['thufirHawat'];
s.factions.fremen.forces.onBoard.arrakeen = 6;
const allyBattle = { ...turnEngine.passiveDecisionProvider,
  chooseBattlePlan: (st, f) => f === 'atreides' ? plan('thufirHawat', 5) : plan('stilgar', 1) };
[res] = await turnEngine.runBattlePhase(s, allyBattle, cards);
assert(res.traitorCard?.revealedBy === 'harkonnen' && res.traitorCard.forFaction === 'fremen', 'Harkonnen revealed Thufir for the Fremen');
assert(res.winnerFactionId === 'fremen', 'the Fremen win');

console.log('\nTest 7: Atreides uses Prescience in its ally\'s battle');
s = game();
formAlliance(s, 'atreides', 'fremen');
s.factions.harkonnen.forces.onBoard.sietchTabr = 4;
let intelFor = null;
[res] = await turnEngine.runBattlePhase(s, { ...turnEngine.passiveDecisionProvider,
  chooseBattlePlan: (st, f, t, o, intel) => { if (intel) intelFor = f; return turnEngine.passiveDecisionProvider.chooseBattlePlan(st, f, t, o); } }, cards);
assert(intelFor === 'fremen' && res.prescience?.forFaction === 'fremen', 'the Fremen planned with Atreides Prescience');

console.log('\nAll diplomacy checks passed.');
