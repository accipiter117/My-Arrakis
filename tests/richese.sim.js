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

console.log('\nAll Richese tests passed.');
