// negotiationAI.sim.js — the AI's side of deals (js/ai/negotiator.js).
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as te from '../js/turnEngine.js';
import * as phaseEngine from '../js/phaseEngine.js';
import * as neg from '../js/negotiation.js';
import { createNegotiator } from '../js/ai/negotiator.js';
import { createStrategicAI } from '../js/ai/strategicAI.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cardLookup = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const SIX = ['atreides', 'harkonnen', 'emperor', 'fremen', 'gesserit', 'guild'];
const game = (seed = 9) => {
  const s = initializeGame({ activeFactionIds: SIX, playerCircleOrder: SIX, rulesConfig, seed,
    spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
  for (const f of SIX) { delete s.factions[f].pendingTraitorHand; s.factions[f].traitorHand = []; }
  s.meta.turn = 2; s.meta.phase = 'shipment';
  return s;
};
let seed = 1; const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const ai = createNegotiator({ leadersData: leaders, rng });
const offer = (s, from, to, give, ask) => neg.makeOffer(s, { from, to, give, ask }).offer;

console.log('Test 1: accepts a fair offer, refuses a bad one');
let s = game();
neg.openWindow(s, { kind: 'shipment' });
s.factions.fremen.spice = 2; s.factions.emperor.spice = 20;
let o = offer(s, 'emperor', 'fremen', { spice: 5 }, { secrets: [{ kind: 'spiceTotal' }] });
assert(ai.chooseOfferResponse(s, 'fremen', o).action === 'accept', 'poor Fremen sell their spice total for 5');
neg.closeWindow(s); neg.openWindow(s, { kind: 'shipment' });
s.factions.fremen.traitorHand = ['feydRautha'];
o = offer(s, 'emperor', 'fremen', { spice: 0 }, { secrets: [{ kind: 'traitor' }] });
assert(o === undefined || ai.chooseOfferResponse(s, 'fremen', o).action !== 'accept', 'nothing for a traitor is refused');

console.log('\nTest 2: never sells a secret to the faction it is about to fight');
s = game();
s.factions.harkonnen.traitorHand = ['paulAtreides'];
s.factions.atreides.spice = 30;
neg.openWindow(s, { kind: 'battle', territoryId: 'arrakeen', fighters: ['atreides', 'harkonnen'] });
o = offer(s, 'atreides', 'harkonnen', { spice: 15 }, { secrets: [{ kind: 'traitor' }] });
assert(ai.chooseOfferResponse(s, 'harkonnen', o).action === 'refuse', 'Harkonnen refuse even 15 spice for their traitor mid-fight');

console.log('\nTest 3: counters once when close, and a counter is never countered');
s = game();
neg.openWindow(s, { kind: 'shipment' });
s.factions.emperor.spice = 20; s.factions.atreides.spice = 10;
s.factions.atreides.forces.onBoard.arrakeen = 10;
o = offer(s, 'emperor', 'atreides', { spice: 1 }, { secrets: [{ kind: 'cardPeek' }] });
let r = ai.chooseOfferResponse(s, 'atreides', o);
assert(r.action === 'counter' && r.counter.ask.spice > 1, `counter asks for more spice (${r.counter?.ask.spice})`);
const c = neg.makeOffer(s, { from: 'atreides', to: 'emperor', give: r.counter.give, ask: r.counter.ask, counterOf: o.id });
assert(c.ok && ai.chooseOfferResponse(s, 'emperor', c.offer).action !== 'counter', 'the Emperor accepts or refuses the counter');

console.log('\nTest 4: prices promises: a cheap promise for good spice, not a stronghold for a pittance');
s = game();
neg.openWindow(s, { kind: 'shipment' });
s.factions.emperor.spice = 20; s.factions.guild.spice = 3;
o = offer(s, 'emperor', 'guild', { spice: 4 }, { promises: [{ type: 'noEnter', territoryId: 'cielagoNorth' }] });
assert(ai.chooseOfferResponse(s, 'guild', o).action === 'accept', 'Guild stay out of a sand territory for 4');
s.factions.guild.forces.onBoard.carthag = 2; s.factions.guild.forces.onBoard.arrakeen = 2;
neg.closeWindow(s); neg.openWindow(s, { kind: 'shipment' });
o = offer(s, 'emperor', 'guild', { spice: 1 }, { promises: [{ type: 'noEnter', territoryId: 'sietchTabr', turns: 3 }] });
assert(ai.chooseOfferResponse(s, 'guild', o).action !== 'accept', 'but not out of a third stronghold for 1');

console.log('\nTest 5: pitches are rare, valid and one at a time');
s = game();
let pitches = 0, valid = 0, maxOne = true;
for (let i = 0; i < 200; i++) {
  neg.openWindow(s, { kind: 'bidding' });
  s.bidding = { cardsUpForBid: ['a', 'b', 'c'] };
  s.factions.emperor.spice = 20; s.factions.harkonnen.spice = 10; s.factions.fremen.spice = 1;
  s.factions.fremen.traitorHand = ['feydRautha']; s.factions.fremen.treacheryHand = s.factions.fremen.treacheryHand.length ? s.factions.fremen.treacheryHand : ['lasgun'];
  for (const f of SIX) {
    const list = ai.chooseNegotiationOffers(s, f, { kind: 'bidding' });
    if (list.length > 1) maxOne = false;
    pitches += list.length;
    for (const p of list) if (neg.makeOffer(structuredClone(s), { from: f, ...p }).ok) valid++;
  }
  neg.closeWindow(s);
}
assert(pitches > 0 && pitches < 200 * 6 * 0.5, `${pitches} pitches in 1200 chances`);
assert(valid === pitches, 'every pitch is a legal offer');
assert(maxOne, 'never more than one pitch per faction per window');

console.log('\nTest 6: AI-only games: deals happen, spice never goes negative, held spice is all collected');
let deals = 0, refusals = 0;
for (let g = 0; g < 4; g++) {
  const st = initializeGame({ activeFactionIds: SIX, playerCircleOrder: SIX, rulesConfig, seed: 100 + g,
    spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
  phaseEngine.nextPhase(st);
  const brain = createStrategicAI({ leadersData: leaders, cardLookup, rng, battleSamples: 20 });
  const events = [];
  const dp = { ...brain, observe: e => { events.push(e); } };
  await te.runSetupDecisions?.(st, dp);
  let guard = 0;
  while (!st.victory.achieved && st.meta.turn <= 6 && guard++ < 200) {
    await te.stepOnePhase(st, dp, territories, cardLookup);
    for (const f of SIX) if (st.factions[f].spice < 0 || (st.negotiation?.held?.[f] ?? 0) < 0) throw new Error(`negative spice for ${f}`);
  }
  const paid = events.filter(e => e.type === 'deal').reduce((n, e) => n + (e.give.spice ?? 0) + (e.ask.spice ?? 0), 0);
  const got = events.filter(e => e.type === 'bribesCollected').reduce((n, e) => n + Object.values(e.collected).reduce((a, b) => a + b, 0), 0);
  const stillHeld = Object.values(st.negotiation?.held ?? {}).reduce((a, b) => a + b, 0);
  assert(paid === got + stillHeld, `game ${g + 1}: ${paid} spice in deals = ${got} collected + ${stillHeld} still held`);
  deals += events.filter(e => e.type === 'deal').length;
  refusals += events.filter(e => e.type === 'offerRefused').length;
}
assert(deals > 0, `${deals} deals and ${refusals} refusals across 4 AI games`);

console.log('\nAll negotiation AI tests passed.');
