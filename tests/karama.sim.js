// karama.sim.js — Karama card uses and faction Karama powers.
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cards = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const ids = ['atreides', 'harkonnen', 'emperor', 'guild', 'tleilaxu', 'choam'];
const game = () => initializeGame({ activeFactionIds: ids, playerCircleOrder: ids, rulesConfig, seed: 12, spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
const P = turnEngine.passiveDecisionProvider;
const clearTraitors = s => { for (const f of ids) { delete s.factions[f].pendingTraitorHand; s.factions[f].traitorHand = []; } s.factions.tleilaxu.faceDancers = []; };

console.log('Test 1: win a card free with Karama');
let s = game(); s.meta.turn = 2;
for (const f of ids) s.factions[f].treacheryHand = [];
s.factions.atreides.treacheryHand = ['karama1'];
const empBefore = s.factions.emperor?.spice ?? 0, atrBefore = s.factions.atreides.spice;
await turnEngine.runBiddingPhase(s, { ...P, chooseBid: (st, f, c, cur) => f === 'harkonnen' ? cur + 1 : null, chooseKaramaBuy: (st, f) => f === 'atreides' });
assert(s.factions.atreides.treacheryHand.length >= 1 && !s.factions.atreides.treacheryHand.includes('karama1') && s.factions.atreides.spice === atrBefore, 'Atreides took a card with Karama and paid nothing');

console.log('\nTest 2: ship at half price with Karama');
s = game(); s.meta.turn = 2; s.factions.harkonnen.treacheryHand = ['karama2']; s.factions.harkonnen.spice = 20;
await turnEngine.runShipmentMovementPhase(s, { ...P, chooseShipmentAndMovement: (st, f) => f === 'harkonnen' ? { shipment: { territoryId: 'theGreatFlat', amount: 6, karama: true }, movement: null } : { shipment: null, movement: null } });
assert(s.factions.harkonnen.forces.onBoard.theGreatFlat === 6 && s.factions.harkonnen.spice === 20 - 6, '6 forces to the Great Flat for 6 spice instead of 12');

console.log('\nTest 3: Guild stops a shipment');
s = game(); s.meta.turn = 2; s.factions.guild.treacheryHand = ['karama1']; s.factions.harkonnen.spice = 20;
await turnEngine.runShipmentMovementPhase(s, { ...P, chooseKaramaPower: (st, f, i) => f === 'guild' && i.kind === 'stopShipment',
  chooseShipmentAndMovement: (st, f) => f === 'harkonnen' ? { shipment: { territoryId: 'habbanyaSietch', amount: 5 }, movement: null } : { shipment: null, movement: null } });
assert(!s.factions.harkonnen.forces.onBoard.habbanyaSietch && s.factions.harkonnen.spice === 20, 'the Harkonnen shipment never happened, and cost nothing');

console.log('\nTest 4: Emperor free revival; Tleilaxu stop a revival');
s = game(); s.meta.turn = 2;
s.factions.emperor.treacheryHand = ['karama1']; s.factions.emperor.revivalTanks = 5; s.factions.emperor.forces.reserve -= 5;
await turnEngine.runRevivalPhase(s, { ...P, chooseKaramaPower: (st, f, i) => i.kind === 'freeRevival' ? { forces: 3 } : null });
assert(s.factions.emperor.revivalTanks <= 2, 'the Emperor revived 3 forces free (and any normal revival on top)');
s = game(); s.meta.turn = 2;
s.factions.tleilaxu.treacheryHand = ['karama1']; s.factions.atreides.revivalTanks = 6; s.factions.atreides.forces.reserve -= 6;
await turnEngine.runRevivalPhase(s, { ...P, chooseRevival: () => ({ forces: 2 }), chooseKaramaPower: (st, f, i) => i.kind === 'stopRevival' ? 'atreides' : null });
assert(s.factions.atreides.revivalTanks === 6, 'Atreides could not revive at all');

console.log('\nTest 5: Harkonnen take cards blind; CHOAM sell cards');
s = game(); s.meta.turn = 2;
s.factions.harkonnen.treacheryHand = ['karama1', 'baliset', 'kulon'];
s.factions.atreides.treacheryHand = ['lasgun', 'shield1'];
for (const f of ['emperor', 'guild', 'tleilaxu', 'choam']) s.factions[f].treacheryHand = [];
await turnEngine.runBiddingPhase(s, { ...P, chooseKaramaPower: (st, f, i) => i.kind === 'takeCards' ? { targetId: 'atreides', count: 2 } : null, chooseCardsToGiveBack: () => ['baliset', 'kulon'] });
assert(s.factions.harkonnen.treacheryHand.includes('lasgun') && s.factions.atreides.treacheryHand.includes('baliset') && s.factions.atreides.treacheryHand.length >= 2, 'Harkonnen took both Atreides cards and gave back Baliset and Kulon');
s = game(); s.meta.phase = 'charity';
s.factions.choam.treacheryHand = ['karama1', 'lasgun', 'chaumas']; const chBefore = s.factions.choam.spice;
await turnEngine.stepOnePhase(s, { ...P, chooseChoamDiscards: () => [], chooseKaramaPower: (st, f, i) => i.kind === 'sellCards' ? ['lasgun', 'chaumas'] : null }, territories, cards);
assert(s.factions.choam.treacheryHand.length === 0 && s.factions.choam.spice >= chBefore + 6, 'CHOAM sold two cards for 3 each');

console.log('\nTest 6: Atreides see the whole plan');
s = game(); clearTraitors(s);
s.factions.atreides.treacheryHand = ['karama1']; s.factions.harkonnen.forces.onBoard.arrakeen = 5;
let intelSeen = null;
const plan = (leaderId, v, n) => ({ forcesCommitted: n, starredForcesCommitted: 0, spiceCommitted: 0, supportedStarredCount: 0, supportedOrdinaryCount: 0, leaderId, leaderFightingValue: v, weaponCardId: null, defenseCardId: null, cheapHeroCardId: null });
await turnEngine.runBattlePhase(s, { ...P, chooseKaramaPower: (st, f, i) => i.kind === 'seePlan',
  chooseBattlePlan: (st, f, t, o, intel) => { if (f === 'atreides') intelSeen = intel; return f === 'atreides' ? plan('ladyJessica', 5, 4) : plan('feydRautha', 6, 3); } }, cards);
assert(intelSeen?.full && intelSeen.plan.leaderId === 'feydRautha' && intelSeen.plan.forcesCommitted === 3, 'Atreides planned knowing Feyd-Rautha and a dial of 3');

console.log('\nTest 7: Fremen call a sandworm; Ixians move the HMS');
{
  const ids2 = ['fremen', 'harkonnen', 'ixians', 'choam', 'richese'];
  const g2 = () => initializeGame({ activeFactionIds: ids2, playerCircleOrder: ids2, rulesConfig, seed: 21, spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
  let t = g2(); t.meta.turn = 2;
  t.factions.fremen.treacheryHand = ['karama1'];
  t.factions.harkonnen.forces.onBoard.theGreatFlat = 6; t.factions.harkonnen.forces.reserve -= 6;
  await turnEngine.runSpiceBlowPhase(t, { ...P, chooseKaramaPower: (st, f, i) => i.kind === 'placeWorm' ? 'theGreatFlat' : null });
  assert(!t.factions.harkonnen.forces.onBoard.theGreatFlat && t.factions.harkonnen.revivalTanks >= 6, 'the Fremen worm swallowed 6 Harkonnen in the Great Flat');
  const { placeHms } = await import('../js/hms.js');
  t = g2(); t.meta.turn = 2; placeHms(t, 'theGreatFlat');
  t.factions.ixians.treacheryHand = ['karama1'];
  let opts = null;
  await turnEngine.runShipmentMovementPhase(t, { ...P, chooseKaramaPower: (st, f, i) => { if (i.kind !== 'moveHms') return null; opts = i.options; return i.options[i.options.length - 1]; } });
  assert(opts?.length && t.board.hms.territoryId === opts[opts.length - 1] && t.board.hms.territoryId !== 'theGreatFlat', `the Ixians moved the HMS to ${t.board.hms.territoryId} (up to 2 away)`);

  console.log('\nTest 8: Karama against expansion powers');
  t = g2(); t.meta.turn = 2; t.factions.harkonnen.treacheryHand = ['karama1']; t.factions.richese.spice = 10;
  await turnEngine.runShipmentMovementPhase(t, { ...P, chooseKaramaCancel: (st, f, purpose) => purpose === 'noFieldShip',
    chooseShipmentAndMovement: (st, f) => f === 'richese' ? { shipment: { territoryId: 'habbanyaSietch', amount: 1, noField: 5 }, movement: null } : { shipment: null, movement: null } });
  assert(!t.factions.richese.noField.onPlanet && !t.factions.richese.forces.onBoard.habbanyaSietch, 'Harkonnen stopped the Richese No-Field shipment');
  t = g2(); t.meta.turn = 2; t.meta.phase = 'charity'; t.factions.harkonnen.treacheryHand = ['karama1'];
  for (const f of ids2) t.factions[f].spice = 10; t.factions.harkonnen.spice = 0;
  const ch0 = t.factions.choam.spice;
  await turnEngine.stepOnePhase(t, { ...P, chooseKaramaCancel: (st, f, purpose) => purpose === 'choamCharity' }, territories, cards);
  assert(t.factions.choam.spice === ch0 && t.factions.harkonnen.spice === 2, 'Karama on CHOAM charity: CHOAM collected nothing extra, the Bank paid Harkonnen');
}

console.log('\nAll Karama tests passed.');
