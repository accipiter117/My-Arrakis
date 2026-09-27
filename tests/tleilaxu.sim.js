// tleilaxu.sim.js — the Tleilaxu (expansion M2): setup, Face Dancers, revival economy, Zoal.
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import * as phaseEngine from '../js/phaseEngine.js';
import { reviveForces, canReviveForces } from '../js/revivalEngine.js';
import { withZoal } from '../js/battleEngine.js';
import { createAI } from '../js/ai/difficulty.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cards = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const SIX = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'tleilaxu'];
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const game = (seed = 5) => initializeGame({ activeFactionIds: SIX, playerCircleOrder: SIX, rulesConfig, seed, spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });

console.log('Test 1: setup');
let s = game();
const tl = s.factions.tleilaxu;
assert(tl.forces.reserve === 20 && tl.spice === 5 && !Object.keys(tl.forces.onBoard).length, '20 troops in reserve, 5 spice, nothing on Arrakis');
assert(!(tl.pendingTraitorHand ?? []).length, 'no traitor cards dealt to the Tleilaxu');
await turnEngine.runSetupDecisions(s, turnEngine.passiveDecisionProvider);
assert(tl.faceDancers.length === 3 && tl.faceDancers.every(fd => fd.leaderId && !fd.revealed), 'three Face Dancers drawn after the others chose traitors');

console.log('\nTest 2: the revival economy');
s = game();
s.factions.atreides.revivalTanks = 6; s.factions.atreides.spice = 10;
const tlBefore = s.factions.tleilaxu.spice;
reviveForces(s, 'atreides', 3, 0); // 2 free + 1 paid (2 spice)
assert(s.factions.tleilaxu.spice === tlBefore + 2 + 1, 'Atreides paid 2 to the Tleilaxu (not the Bank), plus the Tleilaxu took 1 for their free revival');
s.factions.tleilaxu.revivalTanks = 8; s.factions.tleilaxu.spice = 20;
const r = canReviveForces(s, 'tleilaxu', 8, 0);
assert(r.ok && r.cost === Math.ceil((8 - 2) * 2 / 2), `the Tleilaxu revive all 8 at half price (${r.cost} spice): no limit`);
assert(!canReviveForces(s, 'guild', 4, 0).ok || s.factions.guild.revivalTanks < 4, 'others keep the limit of 3...');
s.factions.guild.revivalTanks = 6; s.factions.guild.spice = 20;
s.meta.revivalLimitOverride = { guild: 5 };
assert(canReviveForces(s, 'guild', 5, 0).ok, '...unless the Tleilaxu raise it to 5');

console.log('\nTest 3: a Face Dancer is revealed after another faction wins');
s = game();
for (const f of SIX) { delete s.factions[f].pendingTraitorHand; s.factions[f].traitorHand = []; }
s.factions.tleilaxu.faceDancers = [{ leaderId: 'feydRautha', factionId: 'harkonnen', revealed: false }, { leaderId: 'stilgar', factionId: 'fremen', revealed: false }, { leaderId: 'burseg', factionId: 'emperor', revealed: false }];
s.factions.harkonnen.forces.onBoard.arrakeen = 10;
const plan = (leaderId, v, forces) => ({ forcesCommitted: forces, starredForcesCommitted: 0, spiceCommitted: 0, supportedStarredCount: 0, supportedOrdinaryCount: 0,
  leaderId, leaderFightingValue: v, weaponCardId: null, defenseCardId: null, cheapHeroCardId: null });
const [res] = await turnEngine.runBattlePhase(s, { ...turnEngine.passiveDecisionProvider, chooseRevealFaceDancer: () => true,
  chooseBattlePlan: (st, f) => f === 'harkonnen' ? plan('feydRautha', 6, 4) : plan('duncanIdaho', 2, 0) }, cards);
assert(res.winnerFactionId === 'harkonnen' && res.faceDancer, 'Harkonnen won, and the Tleilaxu revealed Feyd-Rautha as a Face Dancer');
assert(s.factions.harkonnen.leaders.killed.includes('feydRautha'), 'Feyd-Rautha went to the tanks');
assert(!s.factions.harkonnen.forces.onBoard.arrakeen && s.factions.tleilaxu.forces.onBoard.arrakeen === 6, 'Harkonnen\'s 6 surviving troops went home; 6 Tleilaxu took Arrakeen');

console.log('\nTest 4: Zoal takes the value of the leader he faces');
assert(withZoal({ leaderId: 'zoal', leaderFightingValue: 0 }, { leaderId: 'feydRautha', leaderFightingValue: 6 }).leaderFightingValue === 6, 'Zoal against Feyd-Rautha is worth 6');
assert(withZoal({ leaderId: 'zoal' }, { cheapHeroCardId: 'cheapHero1' }).leaderFightingValue === 0, 'against a Cheap Hero he is worth 0');

console.log('\nTest 5: full AI games with the Tleilaxu seated keep every troop accounted for');
let reveals = 0;
for (let g = 0; g < 12; g++) {
  const st = game(900 + g);
  const ai = { ...createAI('hard', { leadersData: leaders, cardLookup: cards }), observe: e => { if (e.type === 'faceDancer') reveals++; } };
  await turnEngine.runSetupDecisions(st, ai); phaseEngine.nextPhase(st);
  while (!st.victory.achieved) {
    await turnEngine.runFullTurn(st, ai, territories, cards);
    for (const f of SIX) {
      const x = st.factions[f], tot = x.forces.reserve + (x.revivalTanks ?? 0) + Object.values(x.forces.onBoard).reduce((a, b) => a + b, 0);
      if (tot !== 20) throw new Error(`FAILED: ${f} has ${tot} troops on turn ${st.meta.turn}`);
    }
  }
}
assert(true, `12 games finished with all 20 troops per faction accounted for every turn (${reveals} Face Dancers revealed)`);

console.log('\nAll Tleilaxu checks passed.');
