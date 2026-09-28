// richese.sim.js — Richese (expansion M6), part 1: setup and the cache auction.
import fs from 'fs';
import { initializeGame, treacheryCardsInPlay } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import * as phaseEngine from '../js/phaseEngine.js';
import { onceAroundOrder } from '../js/richese.js';
import { createAI } from '../js/ai/difficulty.js';
import { createBasicAI } from '../js/ai/basicAI.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cards = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const SIX = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'richese'];
const game = (ids = SIX, seed = 9) => initializeGame({ activeFactionIds: ids, playerCircleOrder: ids, rulesConfig, seed,
  spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
const P = turnEngine.passiveDecisionProvider;
const handsTotal = s => Object.values(s.factions).reduce((n, f) => n + f.treacheryHand.length, 0);

console.log('Test 1: setup');
let s = game();
const ri = s.factions.richese;
assert(ri.spice === 5 && ri.forces.reserve === 20 && !Object.keys(ri.forces.onBoard).length && ri.leaders.available.length === 5, '5 spice, 20 in reserve, nothing on Arrakis, five leaders');
assert(ri.cache.length === 10 && !s.decks.treacheryDeck.some(id => cards[id].cache), 'a cache of 10 cards, none of them in the Treachery Deck');

console.log('\nTest 2: one fewer normal card, and a Once Around auction');
s = game(); s.meta.turn = 2; s.meta.firstPlayer = 'atreides';
for (const f of SIX) { s.factions[f].treacheryHand = []; s.factions[f].spice = 20; }
let calls = [], asked = [];
const results = await turnEngine.runBiddingPhase(s, { ...P,
  chooseCacheAuction: (st, f, { cache }) => ({ cardId: 'stoneBurner', position: 'first', method: 'onceAround' }),
  chooseOnceAroundBid: (st, f, { highBid }) => { asked.push(f); return f === 'emperor' ? 4 : f === 'fremen' ? 6 : null; },
  chooseOnceAroundFinal: () => null,
  observe: e => calls.push(e) });
assert(calls.filter(e => e.type === 'auctionStart').length === 0 || calls.find(e => e.type === 'auctionStart').total === 5, 'six factions able to bid: five normal cards (one fewer)');
assert(JSON.stringify(asked) === JSON.stringify(onceAroundOrder(s, 'cw')), `each other faction bid once, in order round the table from Richese (${asked.join(', ')})`);
assert(s.factions.fremen.treacheryHand.includes('stoneBurner') && s.factions.richese.spice === 26 && !s.factions.richese.cache.includes('stoneBurner'), 'Fremen won at 6 and paid Richese');

console.log('\nTest 3: Richese outbid at the end, paying the Emperor');
s = game(); s.meta.turn = 2;
for (const f of SIX) { s.factions[f].treacheryHand = []; s.factions[f].spice = 20; }
let emperorBefore = s.factions.emperor.spice;
await turnEngine.runBiddingPhase(s, { ...P,
  chooseCacheAuction: () => ({ cardId: 'mirrorWeapon', position: 'last', method: 'onceAround' }),
  chooseOnceAroundBid: (st, f, { highBid }) => f === 'atreides' ? 3 : null,
  chooseOnceAroundFinal: (st, f, { highBid }) => highBid + 1 });
assert(s.factions.richese.treacheryHand.includes('mirrorWeapon') && s.factions.emperor.spice === emperorBefore + 4, 'Richese outbid 3 with 4, paid to the Emperor');

console.log('\nTest 4: Silent auction, ties by storm order, Harkonnen bonus card');
s = game(); s.meta.turn = 2; s.meta.firstPlayer = 'harkonnen';
for (const f of SIX) { s.factions[f].treacheryHand = []; s.factions[f].spice = 20; }
const cardsBefore = s.decks.treacheryDeck.length;
await turnEngine.runBiddingPhase(s, { ...P,
  chooseCacheAuction: () => ({ cardId: 'karamaRichese', position: 'first', method: 'silent' }),
  chooseSilentBid: (st, f) => ['harkonnen', 'guild'].includes(f) ? 5 : 1 });
assert(s.factions.harkonnen.treacheryHand.includes('karamaRichese') && s.factions.harkonnen.treacheryHand.length === 2, 'tie at 5: Harkonnen (first in storm order) win, and draw their bonus card');
assert(s.factions.harkonnen.spice === 15 && s.factions.richese.spice === 25, 'Harkonnen paid 5 to Richese');

console.log('\nTest 5: nobody bids: take it free or remove it');
s = game(); s.meta.turn = 2;
for (const f of SIX) s.factions[f].treacheryHand = [];
await turnEngine.runBiddingPhase(s, { ...P, chooseCacheAuction: () => ({ cardId: 'distrans', position: 'first', method: 'silent' }), chooseFreeOrRemove: () => 'remove' });
assert(s.decks.removedFromGame?.includes('distrans') && !s.factions.richese.treacheryHand.includes('distrans'), 'removed from the game');
await turnEngine.runBiddingPhase(s, { ...P, chooseCacheAuction: () => ({ cardId: 'semutaDrug', position: 'first', method: 'onceAround' }) });
assert(s.factions.richese.treacheryHand.includes('semutaDrug') && s.factions.richese.cache.length === 8, 'taken free; eight left in the cache');

console.log('\nTest 6: with the cache empty, normal bidding returns to full size');
s = game(); s.meta.turn = 2; s.factions.richese.cache = [];
for (const f of SIX) s.factions[f].treacheryHand = [];
calls = [];
await turnEngine.runBiddingPhase(s, { ...P, observe: e => calls.push(e) });
assert(!calls.some(e => e.type === 'cacheAuctionStart') && calls.find(e => e.type === 'auctionStart').total === 6, 'six normal cards, no cache auction');

console.log('\nTest 7: full AI games with Richese seated keep every troop, leader and card accounted for');
const LINEUPS = [SIX, ['atreides', 'harkonnen', 'ixians', 'tleilaxu', 'choam', 'richese'], ['richese', 'gesserit', 'fremen'], ['richese', 'harkonnen']];
let sold = 0;
for (let g = 0; g < 20; g++) {
  const ids = LINEUPS[g % LINEUPS.length];
  const st = game(ids, 700 + g);
  const ai = g % 2 ? createAI('hard', { leadersData: leaders, cardLookup: cards }) : createBasicAI({ leadersData: leaders, cardLookup: cards });
  const leadersTotal = ids.reduce((n, f) => n + leaders[f].length, 0);
  const cardTotal = treacheryCardsInPlay(rulesConfig, treacheryDeck, ids).length + 10;
  await turnEngine.runSetupDecisions(st, ai);
  phaseEngine.nextPhase(st);
  const force = x => x.forces.reserve + (x.revivalTanks ?? 0) + Object.values(x.forces.onBoard).reduce((a, b) => a + b, 0);
  const totals = Object.fromEntries(ids.map(f => [f, force(st.factions[f])]));
  let guard = 0;
  while (!st.victory.achieved && guard++ < 400) {
    const entry = await turnEngine.stepOnePhase(st, ai, territories, cards);
    for (const f of ids) {
      if (force(st.factions[f]) !== totals[f]) throw new Error(`game ${g}: ${f} forces changed after ${entry.phase}`);
      if (st.factions[f].spice < 0) throw new Error(`game ${g}: ${f} spice ${st.factions[f].spice}`);
      if (st.factions[f].treacheryHand.length > ({ harkonnen: 8, choam: 5 }[f] ?? 4)) throw new Error(`game ${g}: ${f} over its hand limit after ${entry.phase}`);
    }
    const ls = Object.values(st.factions).flatMap(x => [...x.leaders.available, ...x.leaders.killed]);
    if (ls.length !== leadersTotal || new Set(ls).size !== leadersTotal) throw new Error(`game ${g}: leaders not conserved after ${entry.phase}`);
    const n = st.decks.treacheryDeck.length + st.decks.treacheryDiscard.length + handsTotal(st) + st.factions.richese.cache.length + (st.decks.removedFromGame?.length ?? 0);
    if (n !== cardTotal) throw new Error(`game ${g}: ${n} cards, expected ${cardTotal} after ${entry.phase}`);
  }
  if (!st.victory.achieved) throw new Error(`game ${g} never ended`);
  sold += 10 - st.factions.richese.cache.length;
}
assert(true, `20 games across 2 to 6 factions: troops, leaders and cards (cache included) all accounted for; ${sold} cache cards auctioned`);

console.log('\nTest 8: No-Field tokens');
const nf = await import('../js/noField.js');
const { canShip, canMove, executeMove } = await import('../js/movementEngine.js');
const { applyStormDamage } = await import('../js/stormEngine.js');
const { strongholdIdsFrom, strongholdsOccupiedBy } = await import('../js/victoryEngine.js');
const { resolveSpiceCollectionPhase } = await import('../js/spiceCollectionEngine.js');
const shipNF = (st, territoryId, value, dp = P) => turnEngine.runShipmentMovementPhase(st, { ...dp,
  chooseShipmentAndMovement: (x, f) => f === 'richese' ? { shipment: { territoryId, amount: 1, noField: value }, movement: null } : { shipment: null, movement: null } });
s = game(); s.meta.turn = 2; s.factions.richese.spice = 20;
const guildBefore = s.factions.guild.spice;
await shipNF(s, 'habbanyaSietch', 5);
const R = s.factions.richese;
assert(R.forces.onBoard.habbanyaSietch === 1 && R.forces.reserve === 19 && R.noField.onPlanet.value === 5, 'a 5 token placed in Habbanya Sietch: one stand-in force, 19 left in reserve');
assert(s.factions.guild.spice === guildBefore + 1 && R.spice === 19, 'paid for one force (1 spice to a stronghold, to the Guild)');
assert(JSON.stringify(nf.usableNoFields(s)) === '[0,3]', 'the 5 is now face up: only 0 and 3 are usable');
assert(strongholdsOccupiedBy(s, 'richese', strongholdIdsFrom(territories)).includes('habbanyaSietch'), 'the token holds the stronghold on its own');
await shipNF(s, 'theGreatFlat', 3);
assert(R.forces.onBoard.habbanyaSietch === 5 && R.noField.onPlanet.territoryId === 'theGreatFlat' && JSON.stringify(nf.usableNoFields(s)) === '[0,5]',
  'a second token first reveals the old one (5 forces in Habbanya); the 3 is placed; 5 returns behind the shield');

console.log('\nTest 9: a 0 token still collects spice as one force');
s = game(); s.meta.turn = 2; s.factions.richese.spice = 20;
await shipNF(s, 'theGreatFlat', 0);
s.board.spiceBlowMarkers.push({ territoryId: 'theGreatFlat', amount: 8, pile: 'A', turn: 2 });
let spiceBefore = s.factions.richese.spice;
resolveSpiceCollectionPhase(s, s.meta.turnOrder);
assert(s.factions.richese.spice === spiceBefore + 2, 'collected 2 spice with the 0 token');

console.log('\nTest 10: storm reveals it, then destroys the forces');
s = game(); s.meta.turn = 2; s.factions.richese.spice = 20;
await shipNF(s, 'theGreatFlat', 5);
const sec = territories.territories.theGreatFlat.stormSector;
const dmg = applyStormDamage(s, (sec + 17) % 18, 1);
assert(dmg.noFieldRevealed.length === 1 && s.factions.richese.revivalTanks === 5 && !s.factions.richese.forces.onBoard.theGreatFlat && s.factions.richese.forces.reserve === 15,
  'revealed as 5, and all 5 went to the tanks');

console.log('\nTest 11: the token moves with its whole stack');
s = game(); s.meta.turn = 2; s.factions.richese.spice = 20;
await shipNF(s, 'theGreatFlat', 3);
executeMove(s, 'richese', 'theGreatFlat', 'funeralPlain', 1);
assert(s.factions.richese.noField.onPlanet.territoryId === 'funeralPlain', 'moved to the Funeral Plain');

console.log('\nTest 12: battle: plans are made before the reveal; Atreides cannot see the dial');
s = game(); s.meta.turn = 2; s.factions.richese.spice = 20;
for (const f of SIX) { delete s.factions[f].pendingTraitorHand; s.factions[f].traitorHand = []; }
await shipNF(s, 'arrakeen', 5);
let seenByAtreides = null, element = null;
const bplan = (leaderId, v, forces) => ({ forcesCommitted: forces, starredForcesCommitted: 0, spiceCommitted: 0, supportedStarredCount: 0, supportedOrdinaryCount: 0, leaderId, leaderFightingValue: v, weaponCardId: null, defenseCardId: null, cheapHeroCardId: null });
const [bt] = await turnEngine.runBattlePhase(s, { ...P,
  choosePrescienceElement: () => 'number',
  chooseBattlePlan: (st, f, t, o, intel) => { if (f === 'atreides') { seenByAtreides = st.factions.richese.forces.onBoard.arrakeen; element = intel?.element; } return f === 'richese' ? bplan('premierEinCalimar', 5, 5) : bplan('thufirHawat', 5, 3); } }, cards);
assert(seenByAtreides === 1 && element === 'weapon', 'Atreides planned against one visible force, and asked for the dial were shown the weapon instead');
assert(!bt.plans.richese.refused && bt.plans.richese.forces === 5 && bt.plans.richese.forcesPresent === 5, 'after the reveal Richese had 5 forces and their dial of 5 stood');

console.log('\nTest 13: the AI ships with No-Field tokens');
s = game(); s.meta.turn = 2; s.factions.richese.spice = 30;
const ai = createBasicAI({ leadersData: leaders, cardLookup: cards });
const d = ai.chooseShipmentAndMovement(s, 'richese');
assert(!d.shipment || d.shipment.noField === 5, `the AI ships as a No-Field 5 when it ships (${JSON.stringify(d.shipment)})`);

console.log('\nAll Richese tests passed.');
