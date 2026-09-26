// cardsAndAllies.sim.js — Truthtrance, Karama cancels, and alliance support.
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import { playTruthtrance } from '../js/cardEffects.js';
import { formAlliance } from '../js/allianceEngine.js';
import { setPledge, spendingPower } from '../js/allySupport.js';
import { canShip, executeShipment } from '../js/movementEngine.js';
import { freeRevivalAllowance, canEmperorReviveForAlly, emperorRevivesForAlly } from '../js/revivalEngine.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cards = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const ALL = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const game = () => {
  const s = initializeGame({ activeFactionIds: ALL, playerCircleOrder: ALL, rulesConfig, seed: 2, spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
  for (const f of ALL) { delete s.factions[f].pendingTraitorHand; s.factions[f].traitorHand = []; }
  return s;
};
const give = (s, f, id) => { for (const x of ALL) s.factions[x].treacheryHand = s.factions[x].treacheryHand.filter(c => c !== id); s.decks.treacheryDeck = s.decks.treacheryDeck.filter(c => c !== id); s.factions[f].treacheryHand.push(id); };
const plan = (leaderId, forces = 1) => ({ forcesCommitted: forces, starredForcesCommitted: 0, spiceCommitted: 0, supportedStarredCount: 0, supportedOrdinaryCount: 0, leaderId, leaderFightingValue: 3, weaponCardId: null, defenseCardId: null, cheapHeroCardId: null });

console.log('Test 1: Truthtrance answers truthfully, publicly, and uses up the card');
let s = game();
give(s, 'atreides', 'truthtrance1');
s.factions.harkonnen.traitorHand = ['thufirHawat'];
let r = playTruthtrance(s, 'atreides', 'harkonnen', { kind: 'isTraitor', leaderId: 'thufirHawat' }, cards);
assert(r.answer === true && s.meta.truths.length === 1, 'yes: Thufir is Harkonnen\'s traitor, recorded publicly');
assert(!s.factions.atreides.treacheryHand.includes('truthtrance1') && s.decks.treacheryDiscard.includes('truthtrance1'), 'Truthtrance discarded');

console.log('\nTest 2: in battle, the AI asks about its leader and avoids a confirmed traitor');
s = game();
give(s, 'atreides', 'truthtrance1');
s.factions.harkonnen.traitorHand = ['ladyJessica'];
s.factions.harkonnen.forces.onBoard.arrakeen = 4;
const { createBasicAI } = await import('../js/ai/basicAI.js');
const ai = createBasicAI({ leadersData: leaders, cardLookup: cards });
let [res] = await turnEngine.runBattlePhase(s, ai, cards);
assert(s.meta.truths?.[0]?.question.leaderId === 'ladyJessica' && s.meta.truths[0].answer === true, 'Atreides asked about Lady Jessica: yes, a traitor');
assert(res.plans.atreides.leaderId !== 'ladyJessica' && !res.traitor, `so Atreides fought with ${res.plans.atreides.leaderId} instead, and no traitor struck`);

console.log('\nTest 3: Karama cancels the Voice, Prescience, and a Harkonnen capture');
s = game();
give(s, 'harkonnen', 'karama1');
s.factions.gesserit.forces.onBoard.carthag = 3;
const voicer = { ...turnEngine.passiveDecisionProvider, chooseVoice: () => ({ command: 'notPlay', category: 'poisonWeapon' }), chooseKaramaCancel: () => true };
[res] = await turnEngine.runBattlePhase(s, voicer, cards);
assert(res.voice === null && s.meta.karamas?.[0]?.purpose === 'voice', 'Harkonnen cancelled the Voice with Karama');
s = game();
give(s, 'harkonnen', 'karama1');
s.factions.atreides.forces.onBoard.carthag = 3;
let asked = false;
[res] = await turnEngine.runBattlePhase(s, { ...turnEngine.passiveDecisionProvider, choosePrescienceElement: () => { asked = true; return 'weapon'; }, chooseKaramaCancel: () => true }, cards);
assert(!asked && !res.prescience, 'Harkonnen cancelled Atreides Prescience');
s = game();
give(s, 'atreides', 'karama1');
s.factions.harkonnen.forces.onBoard.arrakeen = 10;
[res] = await turnEngine.runBattlePhase(s, { ...turnEngine.passiveDecisionProvider, chooseKaramaCancel: (st, f, p) => p === 'capture',
  chooseBattlePlan: (st, f) => f === 'harkonnen' ? plan('feydRautha', 10) : plan('duncanIdaho', 0) }, cards);
assert(res.winnerFactionId === 'harkonnen' && res.capture?.action === 'prevented', 'Atreides lost but used Karama to stop the capture');

console.log('\nTest 4: allies pledge spice for each other\'s shipments');
s = game(); s.nexus.active = true;
formAlliance(s, 'fremen', 'guild');
s.factions.fremen.spice = 0; s.factions.guild.spice = 20;
assert(!canShip(s, 'fremen', 'arrakeen', 3).ok, 'without a pledge, the broke Fremen cannot ship into Arrakeen');
setPledge(s, 'guild', 6);
assert(spendingPower(s, 'fremen') === 6 && canShip(s, 'fremen', 'arrakeen', 3).ok, 'with the Guild pledging 6, they can');
executeShipment(s, 'fremen', 'arrakeen', 3);
assert(s.meta.allyPledges.fremen < 6 && s.factions.fremen.spice === 0, `the Guild paid ${6 - s.meta.allyPledges.fremen} from its pledge (and, as the Guild, collected the shipping fee straight back)`);

console.log('\nTest 5: the Fremen ally revives 3 free; the Emperor pays for its ally');
s = game(); s.nexus.active = true;
formAlliance(s, 'fremen', 'guild');
assert(freeRevivalAllowance('guild', s) === 3 && freeRevivalAllowance('guild') === 1, 'Guild free revival: 3 as the Fremen ally, 1 normally');
s = game(); s.nexus.active = true;
formAlliance(s, 'emperor', 'atreides');
s.factions.atreides.revivalTanks = 5;
assert(canEmperorReviveForAlly(s, 'atreides', 3).ok, 'Emperor can pay for 3 extra for its ally');
emperorRevivesForAlly(s, 'atreides', 3);
assert(s.factions.atreides.revivalTanks === 2 && s.factions.emperor.spice === 4, '3 revived at the Emperor\'s cost of 6 spice');

console.log('\nAll Truthtrance, Karama and ally support checks passed.');
