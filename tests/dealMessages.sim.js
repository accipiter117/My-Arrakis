// dealMessages.sim.js: confirmation messages for deals (ui/dealMessages.js),
// built from real offers made through js/negotiation.js.
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as neg from '../js/negotiation.js';
import { dealMessage, dealTerms, cardsGained } from '../ui/dealMessages.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`FAILED: ${m}\n      got:  ${a}\n      want: ${b}`); console.log('  ok - ' + m); };

const IDS = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];
const s = initializeGame({ activeFactionIds: IDS, playerCircleOrder: IDS, rulesConfig, seed: 7,
  spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
for (const f of Object.keys(s.factions)) { delete s.factions[f].pendingTraitorHand; s.factions[f].traitorHand ??= []; }
s.meta.turn = 2; s.meta.phase = 'bidding';
s.bidding = { cardsUpForBid: ['c1', 'c2', 'c3'] };
for (const f of IDS) s.factions[f].spice = 20;
neg.openWindow(s, { kind: 'bidding' });

const NAMES = { atreides: 'Atreides', harkonnen: 'Harkonnen', emperor: 'Emperor', fremen: 'Fremen', guild: 'Guild', gesserit: 'Bene Gesserit' };
const names = { faction: id => NAMES[id] ?? id, territory: id => ({ arrakeen: 'Arrakeen', carthag: 'Carthag' }[id] ?? id), knowledge: k => `${NAMES[k.about]}'s traitor: Stilgar` };
const ev = (type, o, extra = {}) => ({ type, offerId: o.id, from: o.from, to: o.to, give: o.give, ask: o.ask, counterOf: o.counterOf, ...extra });
const offer = spec => { const r = neg.makeOffer(s, spec); assert(r.ok, `offer made (${r.reason ?? 'ok'})`); return r.offer; };

console.log('Accepted offers, from the human side');
const o1 = offer({ from: 'atreides', to: 'guild', give: { promises: [{ type: 'noEnter', territoryId: 'arrakeen', turns: 1 }] }, ask: { spice: 8 } });
eq(dealMessage(ev('deal', o1), 'atreides', names), 'Guild accepted: you get 8 spice, you stay out of Arrakeen for 1 turn', 'the handover example reads exactly');
eq(dealMessage(ev('deal', o1), 'guild', names), 'Deal agreed with Atreides: Atreides will stay out of Arrakeen for 1 turn, you pay 8 spice', 'accepting an offer reads from your side');
eq(dealMessage(ev('deal', o1), 'emperor', names), null, 'no message when you are not part of the deal');
eq(dealMessage(ev('deal', o1), null, names), null, 'no message when spectating');

const o2 = offer({ from: 'harkonnen', to: 'atreides', give: { spice: 3, promises: [{ type: 'noAttack', factionId: 'atreides', turns: 2 }] }, ask: { promises: [{ type: 'noBid' }] } });
eq(dealMessage(ev('deal', o2), 'atreides', names), "Deal agreed with Harkonnen: you get 3 spice, Harkonnen won't move in on you for 2 turns, you won't bid this round", 'promises about you say "you"');

console.log('Refusals and counters');
eq(dealMessage(ev('offerRefused', o2), 'harkonnen', names), 'Atreides refused your offer', 'your offer refused');
eq(dealMessage(ev('offerRefused', o2), 'atreides', names), "You refused Harkonnen's offer", 'your own refusal is confirmed');
const o3 = offer({ from: 'emperor', to: 'fremen', give: { spice: 5 }, ask: { promises: [{ type: 'bidPass', cardIndex: 1 }] } });
eq(dealMessage(ev('offer', o3), 'fremen', names), null, 'a plain incoming offer gets no message (the offer card handles it)');
const c3 = offer({ from: 'fremen', to: 'emperor', give: { promises: [{ type: 'bidPass', cardIndex: 1 }] }, ask: { spice: 7 }, counterOf: o3.id });
eq(dealMessage(ev('offer', c3), 'emperor', names), 'Fremen countered: Fremen will pass on card 2, you pay 7 spice', 'a counter spells out its terms');
eq(dealMessage(ev('offer', c3), 'fremen', names), null, 'your own counter gets no message');

console.log('Secrets and failed deals');
eq(dealMessage({ type: 'secretLearned', privateTo: 'atreides', knowledge: { kind: 'traitor', about: 'fremen', value: ['stilgar'] } }, 'atreides', names),
  "You learned: Fremen's traitor: Stilgar", 'the buyer sees what they learned');
eq(dealMessage({ type: 'secretLearned', privateTo: 'atreides', knowledge: { kind: 'traitor', about: 'fremen', value: ['stilgar'] } }, 'harkonnen', names),
  null, 'nobody else sees the secret');
eq(dealTerms({ from: 'atreides', to: 'gesserit', give: { secrets: [{ kind: 'spiceTotal' }] }, ask: { secrets: [{ kind: 'traitor' }] } }, 'atreides', names),
  'you learn their traitor, Bene Gesserit learns your spice total', 'secrets read as yours and theirs');
eq(dealMessage({ type: 'dealFailed', from: 'guild', to: 'atreides', reason: 'Not enough spice behind the shield for 9.' }, 'atreides', names),
  'The deal with Guild fell through: Not enough spice behind the shield for 9', 'a failed deal says why');
eq(dealMessage({ type: 'bid', factionId: 'atreides', amount: 3 }, 'atreides', names), null, 'other events give no message');

console.log('Cards won at auction');
eq(cardsGained(['a', 'b'], ['a', 'b', 'c']).join(), 'c', 'one card won');
eq(cardsGained(['a'], ['a', 'c', 'd']).join(), 'c,d', 'Harkonnen: the card and the bonus, in order');
eq(cardsGained(['a', 'a'], ['a', 'a', 'a']).join(), 'a', 'a second copy of a card you hold counts as new');
eq(cardsGained(['a', 'b'], ['a', 'b', 'z']).join(), 'z', 'Ixian ally swap: the card you end up with');
eq(cardsGained(['a', 'b'], ['a', 'b']).join(), '', 'nothing gained, nothing shown');
console.log('dealMessages: all passed');
