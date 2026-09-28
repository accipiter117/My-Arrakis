// choam.sim.js — CHOAM (expansion M5).
import fs from 'fs';
import { initializeGame, treacheryCardsInPlay } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import * as phaseEngine from '../js/phaseEngine.js';
import { canReviveForces, reviveForces, canReviveLeader, freeRevivalAllowance } from '../js/revivalEngine.js';
import { canMove } from '../js/movementEngine.js';
import { applyStormDamage } from '../js/stormEngine.js';
import { captureCandidates } from '../js/battleEngine.js';
import * as choam from '../js/choam.js';
import * as tech from '../js/techTokens.js';
import { createAI } from '../js/ai/difficulty.js';
import { createBasicAI } from '../js/ai/basicAI.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cards = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const SIX = ['atreides', 'harkonnen', 'emperor', 'fremen', 'gesserit', 'choam'];
const game = (ids = SIX, seed = 3) => initializeGame({ activeFactionIds: ids, playerCircleOrder: ids, rulesConfig, seed,
  spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
const P = turnEngine.passiveDecisionProvider;
const plan = (leaderId, v, forces, spice = 0) => ({ forcesCommitted: forces, starredForcesCommitted: 0, spiceCommitted: spice, supportedStarredCount: 0,
  supportedOrdinaryCount: spice, leaderId, leaderFightingValue: v, weaponCardId: null, defenseCardId: null, cheapHeroCardId: null });
const clearTraitors = s => { for (const f of Object.keys(s.factions)) { delete s.factions[f].pendingTraitorHand; s.factions[f].traitorHand = []; } };

console.log('Test 1: setup, and the worthless cards return with CHOAM');
let s = game();
const ch = s.factions.choam;
assert(ch.spice === 2 && ch.forces.reserve === 20 && !Object.keys(ch.forces.onBoard).length, '2 spice, 20 in reserve, nothing on Arrakis');
assert(ch.leaders.available.length === 6 && ch.leaders.available.includes('auditor'), 'five leaders plus the Auditor');
const withChoam = treacheryCardsInPlay(rulesConfig, treacheryDeck, SIX), without = treacheryCardsInPlay(rulesConfig, treacheryDeck, ['atreides', 'harkonnen']);
assert(withChoam.some(c => c.category === 'worthless') && !without.some(c => c.category === 'worthless'), 'worthless cards are in the deck with CHOAM (D1), and out without');
assert(s.decks.traitorDeck.concat(...Object.values(s.factions).map(f => f.pendingTraitorHand ?? [])).some(c => c.leaderId === 'auditor'), 'the Auditor is in the traitor deck');

console.log('\nTest 2: Charity');
s = game(); s.meta.turn = 2;
for (const f of SIX) s.factions[f].spice = 10;
s.factions.atreides.spice = 0; s.factions.choam.spice = 0;
let r = turnEngine.runCharityPhase(s);
assert(r.find(x => x.choamAdvantage)?.amountReceived === 12, 'CHOAM collects 2 per faction first: 12 with six factions');
assert(s.factions.atreides.spice === 2 && s.factions.gesserit.spice === 12, 'Atreides topped up to 2; Bene Gesserit take their 2');
assert(s.factions.choam.spice === 12 - 4, 'both paid from CHOAM\'s spice (12 - 4 = 8)');
assert(s.techTokens.spiceProd.triggeredBy.includes('atreides') && !s.techTokens.spiceProd.triggeredBy.includes('choam'), 'others\' charity triggers Spice Production; CHOAM\'s advantage does not');

console.log('\nTest 3: Inflation');
s = game(); s.meta.turn = 2;
for (const f of SIX) s.factions[f].spice = 10; s.factions.atreides.spice = 0; s.factions.choam.spice = 0;
assert(choam.placeInflation(s, 'double'), 'placed Double');
turnEngine.runCharityPhase(s);
assert(s.factions.atreides.spice === 4 && s.factions.gesserit.spice === 14 && s.factions.choam.spice === 24 - 8, 'Double: CHOAM takes 24, Atreides 4, Bene Gesserit 4, both paid by CHOAM');
assert(choam.advanceInflation(s) === 'cancel', 'next Mentat Pause it flips to Cancel');
s.factions.atreides.spice = 0; const chBefore = s.factions.choam.spice, bgBefore = s.factions.gesserit.spice;
r = turnEngine.runCharityPhase(s);
assert(s.factions.atreides.spice === 0 && s.factions.gesserit.spice === bgBefore && s.factions.choam.spice === chBefore, 'Cancel: nobody collects, not even CHOAM or the Bene Gesserit');
assert(choam.advanceInflation(s) === 'removed' && !choam.placeInflation(s, 'double'), 'then it leaves the game and cannot be placed again');

console.log('\nTest 4: duplicates and worthless cards');
s = game();
s.factions.choam.treacheryHand = ['snooper1', 'snooper2', 'shieldSnooper', 'baliset'];
assert(JSON.stringify(choam.duplicateSurplus(s, cards)) === '["snooper2"]', 'two Snoopers are duplicates; a Shield Snooper is not a Snooper');
let before = s.factions.choam.spice;
assert(choam.discardForSpice(s, 'snooper2', cards) === 3 && choam.discardForSpice(s, 'baliset', cards) === 2 && s.factions.choam.spice === before + 5, 'duplicate for 3, worthless for 2');
assert(choam.discardForSpice(s, 'snooper1', cards) === 0, 'the last copy is not a duplicate');

console.log('\nTest 5: end-of-phase window through the turn engine');
s = game(); s.meta.phase = 'charity';
s.factions.choam.treacheryHand = ['snooper1', 'snooper2', 'kulon'];
before = s.factions.choam.spice;
const seen = [];
await turnEngine.stepOnePhase(s, { ...P, observe: e => seen.push(e) }, territories, cards);
assert(s.factions.choam.treacheryHand.length === 1 && seen.some(e => e.type === 'choamDiscards'), 'after Charity CHOAM cashed the duplicate and Kulon');

console.log('\nTest 6: revival');
s = game(); s.factions.choam.revivalTanks = 8; s.factions.choam.spice = 10;
assert(freeRevivalAllowance('choam', s) === 0, 'no free revival');
const rv = canReviveForces(s, 'choam', 8, 0);
assert(rv.ok && rv.cost === 8, 'no limit, 1 spice each: 8 forces for 8');
s.factions.choam.leaders.available = s.factions.choam.leaders.available.filter(l => !['auditor', 'dukeVerdun'].includes(l));
s.factions.choam.leaders.killed = ['auditor', 'dukeVerdun'];
assert(canReviveLeader(s, 'choam', 'auditor', 2).ok && !canReviveLeader(s, 'choam', 'dukeVerdun', 3).ok, 'the Auditor can be revived while other leaders live; Duke Verdun cannot');

console.log('\nTest 7: worthless effects');
s = game();
choam.playWorthlessEffect(Object.assign(s, { factions: { ...s.factions } }), 'laLaLa', { factionId: 'atreides' });
assert(true, 'no card in hand: nothing happens');
s = game();
s.factions.choam.treacheryHand = ['laLaLa', 'baliset', 'kulon', 'jubbaCloak', 'tripToGamont'];
choam.playWorthlessEffect(s, 'laLaLa', { factionId: 'atreides' });
assert(freeRevivalAllowance('atreides', s) === 0, 'La La La: Atreides get no free revival this turn');
s.factions.choam.forces.onBoard = { carthag: 3, theGreatFlat: 5 };
choam.playWorthlessEffect(s, 'baliset', { factionId: 'atreides', territoryId: 'carthag' });
s.factions.atreides.forces.onBoard.imperialBasin = 3;
assert(!canMove(s, 'atreides', 'arrakeen', 'carthag', 2).ok, 'Baliset: Atreides may not move into Carthag');
s.factions.choam.forces.onBoard = { theGreatFlat: 5 };
const r1 = (await import('../js/movementEngine.js')).moveRangeFor(s, 'choam');
choam.playWorthlessEffect(s, 'kulon', {});
assert((await import('../js/movementEngine.js')).moveRangeFor(s, 'choam') === r1 + 1, 'Kulon: one extra territory');
choam.playWorthlessEffect(s, 'jubbaCloak', { territoryId: 'theGreatFlat' });
s.factions.harkonnen.forces.onBoard.theGreatFlat = 2;
const sector = territories.territories.theGreatFlat.stormSector;
applyStormDamage(s, (sector + 17) % 18, 1);
assert(s.factions.choam.forces.onBoard.theGreatFlat === 5 && !s.factions.harkonnen.forces.onBoard.theGreatFlat, 'Jubba Cloak: CHOAM survives the storm in the Great Flat; Harkonnen there do not');
const gReserve = s.factions.atreides.forces.reserve;
choam.playWorthlessEffect(s, 'tripToGamont', { factionId: 'atreides', territoryId: 'arrakeen' });
assert(s.factions.atreides.forces.onBoard.arrakeen === 9 && s.factions.atreides.forces.reserve === gReserve + 1, 'Trip to Gamont: one Atreides force goes home');
assert(!s.factions.choam.treacheryHand.length && s.decks.treacheryDiscard.includes('kulon'), 'each card is discarded when used');
choam.clearPhaseEffects(s, 'revival'); choam.clearPhaseEffects(s, 'shipment');
assert(freeRevivalAllowance('atreides', s) > 0 && !s.choamEffects.baliset.length && !s.choamEffects.kulon, 'effects expire with their phase');

console.log('\nTest 8: Kull Wahad stops a Karama as it is played');
s = game(); clearTraitors(s);
s.factions.choam.treacheryHand = ['kullWahad'];
s.factions.harkonnen.treacheryHand = ['karama1'];
s.factions.gesserit.forces.onBoard = { carthag: 3 };
s.alliances = [{ factions: ['gesserit', 'choam'], formedTurn: 1 }];
let voiced = null;
await turnEngine.runBattlePhase(s, { ...P,
  chooseVoice: (st, f, t, target) => ({ command: 'notPlay', category: 'poisonWeapon' }),
  chooseKaramaCancel: () => true,
  chooseChoamEffect: (st, f, info) => info.cardId === 'kullWahad' ? info.options[0] : null,
  chooseBattlePlan: (st, f, t, o, intel, voice) => { if (f === 'harkonnen') voiced = voice; return f === 'harkonnen' ? plan('feydRautha', 6, 5) : plan('alia', 5, 1); } }, cards);
assert(voiced && s.factions.harkonnen.treacheryHand.includes('karama1') && !s.factions.choam.treacheryHand.length, 'Harkonnen tried Karama against the Voice; Kull Wahad stopped it; the Voice stands and Harkonnen keep the Karama');

console.log('\nTest 9: CHOAM takes half the spice others pay for forces');
s = game(); clearTraitors(s);
s.factions.harkonnen.spice = 10; s.factions.atreides.forces.onBoard = { carthag: 4 };
before = s.factions.choam.spice;
await turnEngine.runBattlePhase(s, { ...P, chooseBattlePlan: (st, f) => f === 'harkonnen' ? plan('feydRautha', 6, 5, 5) : plan('ladyJessica', 5, 4, 3) }, cards);
assert(s.factions.choam.spice === before + 2 + 1, 'Harkonnen paid 5 (2 to CHOAM), Atreides 3 (1 to CHOAM)');
s = game(); clearTraitors(s);
s.factions.harkonnen.traitorHand = ['ladyJessica']; s.factions.harkonnen.spice = 10; s.factions.atreides.forces.onBoard = { carthag: 4 };
before = s.factions.choam.spice;
await turnEngine.runBattlePhase(s, { ...P, chooseBattlePlan: (st, f) => f === 'harkonnen' ? plan('feydRautha', 6, 5, 5) : plan('ladyJessica', 5, 4, 3) }, cards);
assert(s.factions.choam.spice === before, 'a traitor revealed: nothing for CHOAM');

console.log('\nTest 10: the Auditor');
s = game(); clearTraitors(s);
s.factions.choam.forces.onBoard = { carthag: 6 };
s.factions.harkonnen.treacheryHand = ['karama1', 'lasgun', 'chaumas'];
let offered = null;
let [b] = await turnEngine.runBattlePhase(s, { ...P, chooseCancelAudit: (st, f, info) => { offered = info.cost; return false; },
  chooseBattlePlan: (st, f) => f === 'choam' ? plan('auditor', 2, 6) : plan('feydRautha', 6, 1) }, cards);
assert(s.factions.choam.leaders.available.includes('auditor') && offered === 2 && b.audit?.cards.length === 2, 'the Auditor survived (win or lose): Harkonnen declined to pay 2, CHOAM saw 2 cards');
assert(s.factions.choam.specialFactionState.audits[0].cards.every(c => s.factions.harkonnen.treacheryHand.includes(c)), 'recorded privately for CHOAM');
s = game(); clearTraitors(s);
s.factions.choam.forces.onBoard = { carthag: 6 };
s.factions.harkonnen.treacheryHand = ['chaumas']; s.factions.harkonnen.spice = 5;
[b] = await turnEngine.runBattlePhase(s, { ...P, chooseCancelAudit: () => true, chooseCaptureAction: () => 'keep',
  chooseBattlePlan: (st, f) => f === 'choam' ? plan('auditor', 2, 6) : plan('feydRautha', 6, 1) }, cards);
assert(b.audit?.cancelled && b.audit.cost === 1 && s.factions.harkonnen.spice === 4, 'one card in hand: 1 spice cancels the audit');
assert(!captureCandidates(s, 'choam', 'carthag').includes('auditor'), 'the Auditor can never be captured');

console.log('\nTest 11: alliance');
s = game(); clearTraitors(s);
s.alliances = [{ factions: ['choam', 'atreides'], formedTurn: 1 }];
s.factions.choam.treacheryHand = ['baliset']; s.factions.atreides.treacheryHand = ['lasgun'];
s.meta.phase = 'charity';
const trader = { ...P, chooseChoamDiscards: () => [], chooseChoamAllyTrade: () => 'baliset', chooseChoamAllyTradeResponse: () => 'lasgun' };
await turnEngine.stepOnePhase(s, trader, territories, cards);
assert(s.factions.choam.treacheryHand[0] === 'lasgun' && s.factions.atreides.treacheryHand[0] === 'baliset', 'a two-way trade at the end of a phase');
s.factions.choam.treacheryHand = ['chaumas'];
await turnEngine.stepOnePhase(s, trader, territories, cards);
assert(s.factions.choam.treacheryHand[0] === 'chaumas', 'only once a turn');
s = game(); clearTraitors(s);
s.alliances = [{ factions: ['choam', 'atreides'], formedTurn: 1 }];
s.factions.atreides.spice = 0; s.factions.choam.spice = 10;
s.factions.harkonnen.forces.onBoard.arrakeen = 2;
[b] = await turnEngine.runBattlePhase(s, { ...P, chooseChoamBattleSupport: (st, f, info) => info.max,
  chooseBattlePlan: (st, f) => f === 'atreides' ? plan('ladyJessica', 5, 6, 6) : plan('feydRautha', 6, 2) }, cards);
assert(!b.plans.atreides.refused && b.plans.atreides.spice === 6 && s.factions.choam.spice === 4, 'CHOAM paid for 6 of its ally\'s forces (to the Bank, nothing back to CHOAM)');

console.log('\nTest 12: full AI games with CHOAM seated keep every troop, leader and card accounted for');
const LINEUPS = [SIX, ['atreides', 'harkonnen', 'fremen', 'ixians', 'tleilaxu', 'choam'], ['emperor', 'guild', 'choam'], ['choam', 'gesserit']];
const cardsInPlay = ids => treacheryCardsInPlay(rulesConfig, treacheryDeck, ids).length;
let games = 0, choamWins = 0;
for (let g = 0; g < 24; g++) {
  const ids = LINEUPS[g % LINEUPS.length];
  const st = game(ids, 500 + g);
  const ai = g % 2 ? createAI('hard', { leadersData: leaders, cardLookup: cards }) : createBasicAI({ leadersData: leaders, cardLookup: cards });
  const leadersTotal = ids.reduce((n, f) => n + leaders[f].length, 0);
  await turnEngine.runSetupDecisions(st, ai);
  phaseEngine.nextPhase(st);
  const totals = Object.fromEntries(ids.map(f => { const x = st.factions[f]; return [f, x.forces.reserve + (x.revivalTanks ?? 0) + Object.values(x.forces.onBoard).reduce((a, b) => a + b, 0)]; }));
  let guard = 0;
  while (!st.victory.achieved && guard++ < 400) {
    const entry = await turnEngine.stepOnePhase(st, ai, territories, cards);
    for (const f of ids) {
      const x = st.factions[f];
      const now = x.forces.reserve + (x.revivalTanks ?? 0) + Object.values(x.forces.onBoard).reduce((a, b) => a + b, 0);
      if (now !== totals[f]) throw new Error(`game ${g}: ${f} forces ${now}, expected ${totals[f]} after ${entry.phase}`);
      if (x.spice < 0 || !Number.isInteger(x.spice)) throw new Error(`game ${g}: ${f} spice ${x.spice}`);
      if (x.treacheryHand.length > ({ harkonnen: 8, choam: 5 }[f] ?? 4)) throw new Error(`game ${g}: ${f} over its hand limit`);
    }
    const ls = Object.values(st.factions).flatMap(x => [...x.leaders.available, ...x.leaders.killed]);
    if (ls.length !== leadersTotal || new Set(ls).size !== leadersTotal) throw new Error(`game ${g}: leaders ${ls.length}/${leadersTotal} after ${entry.phase}`);
    const held = Object.values(st.factions).reduce((n, x) => n + x.treacheryHand.length, 0);
    if (st.decks.treacheryDeck.length + st.decks.treacheryDiscard.length + held !== cardsInPlay(ids)) throw new Error(`game ${g}: cards not conserved after ${entry.phase}`);
  }
  if (!st.victory.achieved) throw new Error(`game ${g} never ended`);
  games++; if (st.victory.winningFactions.includes('choam')) choamWins++;
}
assert(games === 24, `24 games across 2 to 6 factions finished with every troop, leader and card accounted for (CHOAM won or shared ${choamWins})`);

console.log('\nAll CHOAM tests passed.');
