// negotiationEngine.sim.js — negotiation wired into the turn engine: windows,
// binding promises in Bidding, Shipment, Battle and the Nexus, Mentat Pause
// collection, private secrets, and spice conservation.
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as te from '../js/turnEngine.js';
import * as phaseEngine from '../js/phaseEngine.js';
import * as neg from '../js/negotiation.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const SIX = ['atreides', 'harkonnen', 'emperor', 'fremen', 'gesserit', 'guild'];
const P = te.passiveDecisionProvider;

const game = (ids = SIX, seed = 5) => {
  const s = initializeGame({ activeFactionIds: ids, playerCircleOrder: ids, rulesConfig, seed,
    spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
  phaseEngine.nextPhase(s);
  return s;
};
const stepTo = async (s, phase, dp) => { let g = 0; while (s.meta.phase !== phase && g++ < 40) await te.stepOnePhase(s, dp, territories, {}); };
const spiceTotal = s => Object.values(s.factions).reduce((n, f) => n + f.spice, 0) + Object.values(s.negotiation?.held ?? {}).reduce((a, b) => a + b, 0);

// A scripted provider: offers by window kind, everyone accepts, and observes events.
function scripted(script, extra = {}) {
  const events = [];
  return { events, ...P,
    chooseNegotiationOffers: (state, f, ctx) => (script[ctx.kind]?.[f] ?? []),
    chooseOfferResponse: () => ({ action: 'accept' }),
    observe: e => { events.push(e); },
    ...extra };
}

console.log('Test 1: no negotiation methods, no windows (pure AI games unchanged)');
let s = game();
const plain = { ...P }; delete plain.chooseNegotiationOffers;
await stepTo(s, 'revival', plain);
assert(!s.negotiation, 'state.negotiation is never created');

console.log('\nTest 2: a bribe at the start of Bidding is binding, held, and collected at the Mentat Pause');
s = game();
let dp = scripted({ bidding: { atreides: [{ to: 'harkonnen', give: { spice: 3 }, ask: { promises: [{ type: 'noBid' }] } }] } },
  { chooseBid: (state, f, cardId, cur) => (f === 'harkonnen' && state.factions.harkonnen.spice > cur ? cur + 1 : null) });
await stepTo(s, 'bidding', dp);
const before = spiceTotal(s), harkHand = s.factions.harkonnen.treacheryHand.length, atrSpice = s.factions.atreides.spice;
await te.stepOnePhase(s, dp, territories, {});
assert(dp.events.some(e => e.type === 'deal' && e.from === 'atreides' && e.to === 'harkonnen'), 'deal recorded as an event');
assert(s.factions.atreides.spice === atrSpice - 3 && neg.heldSpice(s, 'harkonnen') === 3, '3 spice held in front of the Harkonnen shield');
assert(s.factions.harkonnen.treacheryHand.length === harkHand, 'Harkonnen wanted every card but bid on none');
assert(dp.events.filter(e => e.type === 'pass' && e.factionId === 'harkonnen').every(e => e.promised), 'each pass is marked as a promise');
assert(spiceTotal(s) + 0 >= 0 && dp.events.every(e => !(e.type === 'bid' && e.factionId === 'harkonnen')), 'no Harkonnen bid ever reached the auction');
assert(!neg.currentWindow(s), 'the window closed');
await stepTo(s, 'victoryCheck', dp);
assert(!neg.heldSpice(s, 'harkonnen') && dp.events.some(e => e.type === 'bribesCollected' && e.collected.harkonnen === 3), 'collected at the Mentat Pause');
assert(dp.events.some(e => e.type === 'promiseEnded' && e.by === 'harkonnen' && e.status === 'kept'), 'the promise ends as kept');

console.log('\nTest 3: a promise to stay out blocks the shipment it covers');
s = game();
dp = scripted({ shipment: { atreides: [{ to: 'harkonnen', give: { spice: 1 }, ask: { promises: [{ type: 'noEnter', territoryId: 'arrakeen' }] } }] } },
  { chooseShipmentAndMovement: (state, f) => (f === 'harkonnen' ? { shipment: { territoryId: 'arrakeen', amount: 2 }, movement: null } : { shipment: null, movement: null }) });
await stepTo(s, 'shipment', dp);
s.factions.harkonnen.spice = 20;
const ctl = structuredClone(s); const ctlDp = scripted({}, { chooseShipmentAndMovement: dp.chooseShipmentAndMovement });
await te.stepOnePhase(ctl, ctlDp, territories, {});
assert((ctl.factions.harkonnen.forces.onBoard.arrakeen ?? 0) > 0, 'control: without the deal, Harkonnen do ship into Arrakeen');
const harkBefore = s.factions.harkonnen.forces.onBoard.arrakeen ?? 0;
await te.stepOnePhase(s, dp, territories, {});
assert((s.factions.harkonnen.forces.onBoard.arrakeen ?? 0) === harkBefore, 'Harkonnen did not ship into Arrakeen');
assert(!dp.events.some(e => e.type === 'shipment' && e.factionId === 'harkonnen'), 'no shipment event');

console.log('\nTest 4: secrets go only to the buyer, with privateTo on the event');
s = game();
dp = scripted({ shipment: { emperor: [{ to: 'fremen', give: { spice: 2 }, ask: { secrets: [{ kind: 'spiceTotal' }, { kind: 'traitor' }] } }] } });
await stepTo(s, 'shipment', dp);
s.factions.fremen.traitorHand = ['feydRautha'];
await te.stepOnePhase(s, dp, territories, {});
const learned = dp.events.filter(e => e.type === 'secretLearned');
assert(learned.length === 2 && learned.every(e => e.privateTo === 'emperor'), 'two secretLearned events, both private to the Emperor');
assert(!dp.events.filter(e => e.type === 'deal').some(e => JSON.stringify(e).includes(s.factions.fremen.traitorHand[0])), 'the public deal event never carries the traitor\'s name');
assert(neg.knowledgeFor(s, 'emperor').find(k => k.kind === 'traitor').value[0] === s.factions.fremen.traitorHand[0], 'Emperor knows the real traitor');

console.log('\nTest 5: refusals and counters run through the engine');
s = game();
let asked = 0;
dp = scripted({ shipment: { emperor: [{ to: 'fremen', give: { spice: 1 }, ask: { secrets: [{ kind: 'traitor' }] } }] } }, {
  chooseOfferResponse: (state, f, offer) => (asked++ === 0 ? { action: 'counter', counter: { give: { secrets: [{ kind: 'traitor' }] }, ask: { spice: 4 } } } : { action: 'refuse' })
});
await stepTo(s, 'shipment', dp);
s.factions.fremen.traitorHand = ['feydRautha'];
await te.stepOnePhase(s, dp, territories, {});
assert(dp.events.filter(e => e.type === 'offer').length === 2 && dp.events.some(e => e.type === 'offerRefused'), 'offer, counter, refusal');
assert(!neg.knowledgeFor(s, 'emperor').length, 'nothing changed hands');

console.log('\nTest 6: CHOAM Inflation on Double: no windows open');
s = game(['atreides', 'harkonnen', 'emperor', 'choam']);
dp = scripted({ shipment: { atreides: [{ to: 'harkonnen', give: { spice: 1 }, ask: {} }] } });
await stepTo(s, 'shipment', dp);
s.factions.choam.specialFactionState ??= {};
s.factions.choam.specialFactionState.inflation = { status: 'double', flipped: false };
await te.stepOnePhase(s, dp, territories, {});
assert(!dp.events.some(e => e.type === 'offer'), 'no offers were made');

console.log('\nTest 7: an alliance promise is honoured at the Nexus');
s = game();
s.meta.turn = 2; s.meta.phase = 'spiceBlow'; s.nexus.active = true;
neg.initNegotiation(s);
neg.openWindow(s, { kind: 'nexus' });
for (const f of SIX) s.factions[f].spice = 10;
neg.acceptOffer(s, neg.makeOffer(s, { from: 'fremen', to: 'guild', give: { promises: [{ type: 'allianceAt', factionId: 'guild' }] }, ask: { spice: 2 } }).offer.id);
neg.closeWindow(s);
dp = scripted({}, { chooseAllianceProposal: () => null, chooseAllianceResponse: (state, f) => f === 'guild' });
await te.runNexusDiplomacy(s, dp);
assert(s.alliances.some(a => a.factions.includes('fremen') && a.factions.includes('guild')), 'Fremen proposed to the Guild as promised, and the Guild accepted');
assert(!neg.allianceOwed(s, 'fremen'), 'promise settled');

console.log('\nTest 8: every spice paid in a deal arrives at the Mentat Pause (three turns of deals)');
s = game();
const every = { to: null, give: { spice: 1 }, ask: { secrets: [{ kind: 'spiceTotal' }] } };
const all = Object.fromEntries(SIX.map((f, i) => [f, [{ ...every, to: SIX[(i + 1) % SIX.length] }]]));
dp = scripted({ bidding: all, shipment: all, battle: all, nexus: all });
for (let t = 0; t < 3; t++) { const turn = s.meta.turn; while (s.meta.turn === turn && !s.victory.achieved) await te.stepOnePhase(s, dp, territories, {}); }
const deals = dp.events.filter(e => e.type === 'deal');
const paid = deals.reduce((n, e) => n + (e.give.spice ?? 0) + (e.ask.spice ?? 0), 0);
const arrived = dp.events.filter(e => e.type === 'bribesCollected').reduce((n, e) => n + Object.values(e.collected).reduce((a, b) => a + b, 0), 0);
assert(deals.length >= 6, `${deals.length} deals over three turns`);
assert(paid === arrived && paid > 0, `${paid} spice paid in deals, ${arrived} collected at Mentat Pauses`);
assert(SIX.every(f => s.factions[f].spice >= 0) && !Object.values(s.negotiation.held).some(Boolean), 'nobody below zero, nothing left held');
assert(dp.events.filter(e => e.type === 'offer').every(e => !e.counterOf) && deals.every(e => e.window), 'every deal is tagged with its window');

console.log('\nAll negotiation engine tests passed.');
