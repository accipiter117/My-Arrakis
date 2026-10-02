// negotiation.sim.js — deals and bribes (js/negotiation.js).
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as neg from '../js/negotiation.js';
import * as movement from '../js/movementEngine.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const SIX = ['atreides', 'harkonnen', 'emperor', 'fremen', 'gesserit', 'choam'];
const game = (ids = SIX, seed = 7) => {
  const s = initializeGame({ activeFactionIds: ids, playerCircleOrder: ids, rulesConfig, seed,
    spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
  for (const f of Object.keys(s.factions)) { delete s.factions[f].pendingTraitorHand; s.factions[f].traitorHand ??= []; }
  s.meta.turn = 2; s.meta.phase = 'bidding';
  s.bidding = { cardsUpForBid: ['c1', 'c2', 'c3', 'c4'] };
  neg.openWindow(s, { kind: 'bidding' });
  return s;
};
const totalSpice = s => Object.values(s.factions).reduce((n, f) => n + f.spice, 0) + Object.values(s.negotiation?.held ?? {}).reduce((a, b) => a + b, 0);
const fixed = () => 0; // deterministic rng
neg.RECEIVE_CAP.perWindow = 99; neg.RECEIVE_CAP.perTurn = 99; // caps have their own test

console.log('Test 1: a spice-for-promise bribe settles, spice is conserved and held until the Mentat Pause');
let s = game();
s.factions.atreides.spice = 10; s.factions.harkonnen.spice = 3;
let before = totalSpice(s);
let r = neg.makeOffer(s, { from: 'atreides', to: 'harkonnen', give: { spice: 4 }, ask: { promises: [{ type: 'noEnter', territoryId: 'arrakeen', turns: 2 }] } });
assert(r.ok, 'offer is valid');
let a = neg.acceptOffer(s, r.offer.id, fixed);
assert(a.ok && s.factions.atreides.spice === 6 && s.factions.harkonnen.spice === 3, 'spice leaves the payer but is not behind the receiver\'s shield');
assert(neg.heldSpice(s, 'harkonnen') === 4, '4 spice held in front of the Harkonnen shield');
assert(totalSpice(s) === before, 'spice conserved, counting held spice');
const moved = neg.collectHeldSpice(s);
assert(moved.harkonnen === 4 && s.factions.harkonnen.spice === 7 && !neg.heldSpice(s, 'harkonnen'), 'Mentat Pause: held spice joins normal spice');
assert(totalSpice(s) === before, 'still conserved after collection');

console.log('\nTest 2: the promise is binding and expires on time');
assert(neg.entryForbiddenBy(s, 'harkonnen', 'arrakeen'), 'Harkonnen may not enter Arrakeen');
assert(!neg.entryForbiddenBy(s, 'harkonnen', 'carthag'), 'other territories are fine');
assert(!neg.entryForbiddenBy(s, 'atreides', 'arrakeen'), 'the promise binds only the promiser');
neg.expirePromises(s); // end of turn 2
assert(neg.entryForbiddenBy(s, 'harkonnen', 'arrakeen'), 'still in force on turn 3 (2 turns)');
s.meta.turn = 3; neg.expirePromises(s);
assert(!neg.entryForbiddenBy(s, 'harkonnen', 'arrakeen') && s.negotiation.promises[0].status === 'kept', 'lapses as kept after turn 3');

console.log('\nTest 3: who may deal');
s = game();
s.alliances = [{ factions: ['atreides', 'fremen'], formedTurn: 1 }];
assert(neg.dealBlockedReason(s, 'atreides', 'fremen'), 'allies cannot deal');
assert(!neg.dealBlockedReason(s, 'atreides', 'emperor'), 'non-allies can');
neg.closeWindow(s); s.meta.phase = 'revival';
assert(!neg.makeOffer(s, { from: 'atreides', to: 'emperor', give: { spice: 1 }, ask: {} }).ok, 'no deals outside the four windows');
s.meta.phase = 'spiceBlow'; neg.openWindow(s, { kind: 'nexus' });
assert(neg.makeOffer(s, { from: 'atreides', to: 'emperor', give: { spice: 1 }, ask: {} }).ok, 'Nexus is a window');
assert(!neg.makeOffer(s, { from: 'atreides', to: 'emperor', give: {}, ask: {} }).ok, 'empty offers are refused');
s.factions.atreides.spice = 2;
assert(!neg.makeOffer(s, { from: 'atreides', to: 'emperor', give: { spice: 5 }, ask: {} }).ok, 'cannot offer more spice than held behind the shield');

console.log('\nTest 4: CHOAM Inflation on Double blocks every deal');
s = game();
s.factions.choam.specialFactionState ??= {};
s.factions.choam.specialFactionState.inflation = { status: 'double', flipped: false };
assert(!neg.makeOffer(s, { from: 'atreides', to: 'emperor', give: { spice: 1 }, ask: {} }).ok, 'spice bribe blocked');
assert(!neg.makeOffer(s, { from: 'atreides', to: 'emperor', give: { promises: [{ type: 'noBid' }] }, ask: { secrets: [{ kind: 'spiceTotal' }] } }).ok, 'non-spice deal blocked too');
s.factions.choam.specialFactionState.inflation.status = 'cancel';
assert(neg.makeOffer(s, { from: 'atreides', to: 'emperor', give: { spice: 1 }, ask: {} }).ok, 'Cancel side does not block');

console.log('\nTest 5: information goes only to the buyer, and is true');
s = game();
s.factions.harkonnen.traitorHand = ['duncanIdaho'];
s.factions.emperor.spice = 10;
r = neg.makeOffer(s, { from: 'emperor', to: 'harkonnen', give: { spice: 3 }, ask: { secrets: [{ kind: 'traitor' }, { kind: 'cardPeek' }] } });
a = neg.acceptOffer(s, r.offer.id, fixed);
assert(a.ok, 'deal settles');
const empK = neg.knowledgeFor(s, 'emperor');
assert(empK.find(k => k.kind === 'traitor')?.value[0] === 'duncanIdaho', 'Emperor learns the real traitor');
assert(empK.find(k => k.kind === 'cardPeek')?.value === s.factions.harkonnen.treacheryHand[0], 'Emperor sees a real card from the hand');
for (const f of SIX.filter(f => f !== 'emperor')) assert(!neg.knowledgeFor(s, f).length, `${f} learns nothing`);
assert(neg.knowledgeFor(s, null).length === 2, 'a spectator sees everything');
assert(!Object.keys(s.meta.knownCards ?? {}).length, 'the public known-cards list is untouched');
assert(neg.privatelyKnownCards(s, 'emperor')[s.factions.harkonnen.treacheryHand[0]] === 'harkonnen', 'private known cards are available to the Emperor\'s AI');
assert(!neg.describeOffer(r.offer).includes('duncanIdaho'), 'the public description names the secret, not its value');

console.log('\nTest 6: third-party resale');
s.factions.fremen.spice = 5;
const resale = neg.sellableSecrets(s, 'emperor', 'fremen').filter(x => x.kind === 'resale');
assert(resale.length === 2, 'Emperor can resell both things learned about Harkonnen');
assert(!neg.sellableSecrets(s, 'emperor', 'harkonnen').some(x => x.kind === 'resale'), 'but not back to Harkonnen themselves');
r = neg.makeOffer(s, { from: 'emperor', to: 'fremen', give: { secrets: [{ kind: 'resale', entryId: resale.find(x => true).entryId }] }, ask: { spice: 2 } });
a = neg.acceptOffer(s, r.offer.id, fixed);
const fk = neg.knowledgeFor(s, 'fremen')[0];
assert(a.ok && fk.about === 'harkonnen' && fk.resoldBy === 'emperor', 'Fremen learn it, marked as resold by the Emperor');

console.log('\nTest 7: faction secrets');
s = game(['atreides', 'harkonnen', 'gesserit', 'fremen', 'emperor', 'guild']);
s.factions.gesserit.specialFactionState.prediction = { factionId: 'harkonnen', turn: 5 };
s.board.nextStormCard = 4;
assert(neg.sellableSecrets(s, 'gesserit', 'atreides').some(x => x.kind === 'bgPrediction'), 'Bene Gesserit can sell the prediction');
assert(neg.sellableSecrets(s, 'fremen', 'atreides').some(x => x.kind === 'stormCard'), 'Fremen can sell the next storm');
assert(!neg.sellableSecrets(s, 'atreides', 'fremen').some(x => x.kind === 'nextSpiceCard'), 'Atreides cannot sell the spice card before Movement');
s.meta.phase = 'shipment';
assert(neg.sellableSecrets(s, 'atreides', 'fremen').some(x => x.kind === 'nextSpiceCard'), 'but can from Shipment and Movement');

console.log('\nTest 8: the six promise types are enforced');
s = game();
s.factions.emperor.forces.onBoard.carthag = 3;
const mk = (from, to, promises) => neg.acceptOffer(s, neg.makeOffer(s, { from, to, give: { promises }, ask: { spice: 1 } }).offer.id, fixed);
for (const f of SIX) s.factions[f].spice = 10;
mk('fremen', 'emperor', [{ type: 'noAttack', factionId: 'emperor', turns: 1 }]);
assert(neg.entryForbiddenBy(s, 'fremen', 'carthag'), 'noAttack: Fremen may not enter where the Emperor stands');
assert(!neg.entryForbiddenBy(s, 'fremen', 'polarSink'), 'the Polar Sink is never forbidden');
mk('harkonnen', 'atreides', [{ type: 'noTraitorOn', factionId: 'atreides', turns: 2 }]);
assert(neg.traitorCallForbiddenBy(s, 'harkonnen', 'atreides') && !neg.traitorCallForbiddenBy(s, 'harkonnen', 'emperor'), 'noTraitorOn binds against that faction only');
mk('gesserit', 'emperor', [{ type: 'bidPass', cardIndex: 2 }]);
assert(neg.bidForbiddenBy(s, 'gesserit', 2) && !neg.bidForbiddenBy(s, 'gesserit', 1), 'bidPass covers one card');
mk('choam', 'emperor', [{ type: 'noBid' }]);
assert(neg.bidForbiddenBy(s, 'choam', 0) && neg.bidForbiddenBy(s, 'choam', 3), 'noBid covers the whole round');
mk('atreides', 'emperor', [{ type: 'allianceAt', factionId: 'emperor' }]);
assert(neg.allianceOwed(s, 'atreides') === 'emperor', 'allianceAt: Atreides owe the Emperor an alliance at the next Nexus');
neg.closeAlliancePromises(s, 'atreides', 'kept');
assert(!neg.allianceOwed(s, 'atreides'), 'closed once the alliance forms');
neg.openWindow(s, { kind: 'battle', territoryId: 'carthag' });
assert(!neg.makeOffer(s, { from: 'atreides', to: 'emperor', give: { promises: [{ type: 'noBid' }] }, ask: { spice: 1 } }).ok, 'bid promises only at the start of Bidding');
assert(neg.checkPromise(s, 'atreides', { type: 'noEnter', territoryId: 'arrakeen', turns: 9 }).promise.turns === 3, 'promises last 3 turns at most');

console.log('\nTest 9: one counter, then accept or refuse');
s = game();
for (const f of SIX) s.factions[f].spice = 10;
r = neg.makeOffer(s, { from: 'atreides', to: 'emperor', give: { spice: 2 }, ask: { secrets: [{ kind: 'spiceTotal' }] } });
const c = neg.makeOffer(s, { from: 'emperor', to: 'atreides', give: { secrets: [{ kind: 'spiceTotal' }] }, ask: { spice: 4 }, counterOf: r.offer.id });
assert(c.ok && r.offer.status === 'countered', 'Emperor counters');
assert(!neg.canCounter(s, c.offer.id) && !neg.makeOffer(s, { from: 'atreides', to: 'emperor', give: { spice: 3 }, ask: {}, counterOf: c.offer.id }).ok, 'no counter to a counter');
neg.refuseOffer(s, c.offer.id);
assert(c.offer.status === 'refused' && !neg.acceptOffer(s, c.offer.id).ok, 'refused offers cannot be accepted');
r = neg.makeOffer(s, { from: 'atreides', to: 'emperor', give: { spice: 1 }, ask: {} });
neg.lapseOpenOffers(s);
assert(r.offer.status === 'lapsed', 'open offers lapse when the window closes');

console.log('\nTest 10: settlement re-checks (spent spice, alliance formed since)');
s = game();
s.factions.atreides.spice = 5;
r = neg.makeOffer(s, { from: 'atreides', to: 'emperor', give: { spice: 5 }, ask: {} });
s.factions.atreides.spice = 2;
before = totalSpice(s);
assert(!neg.acceptOffer(s, r.offer.id).ok && totalSpice(s) === before && s.factions.atreides.spice === 2, 'no partial settlement when the payer can no longer pay');

console.log('\nTest 11: offer caps (one per window, two per turn, counters free)');
neg.RECEIVE_CAP.perWindow = 1; neg.RECEIVE_CAP.perTurn = 2;
s = game();
for (const f of SIX) s.factions[f].spice = 10;
const o1 = neg.makeOffer(s, { from: 'atreides', to: 'emperor', give: { spice: 1 }, ask: {} });
assert(o1.ok && !neg.makeOffer(s, { from: 'fremen', to: 'emperor', give: { spice: 1 }, ask: {} }).ok, 'second offer to the Emperor in one window is refused');
assert(neg.makeOffer(s, { from: 'emperor', to: 'atreides', give: { spice: 1 }, ask: {}, counterOf: o1.offer.id }).ok, 'a counter is not capped');
neg.closeWindow(s); neg.openWindow(s, { kind: 'shipment' });
assert(neg.makeOffer(s, { from: 'fremen', to: 'emperor', give: { spice: 1 }, ask: {} }).ok, 'next window: allowed again');
neg.closeWindow(s); neg.openWindow(s, { kind: 'battle' });
assert(!neg.makeOffer(s, { from: 'gesserit', to: 'emperor', give: { spice: 1 }, ask: {} }).ok, 'third offer in a turn is refused');
s.meta.turn = 3;
assert(neg.makeOffer(s, { from: 'gesserit', to: 'emperor', give: { spice: 1 }, ask: {} }).ok, 'new turn resets');
neg.closeWindow(s);
assert(!neg.makeOffer(s, { from: 'gesserit', to: 'fremen', give: { spice: 1 }, ask: {} }).ok, 'no offers with no window open');

console.log('\nTest 12: promises feed movement legality');
s = game();
for (const f of SIX) s.factions[f].spice = 10;
neg.acceptOffer(s, neg.makeOffer(s, { from: 'harkonnen', to: 'atreides', give: { promises: [{ type: 'noEnter', territoryId: 'arrakeen' }] }, ask: { spice: 2 } }).offer.id);
s.factions.harkonnen.forces.reserve = 5;
const ship = movement.canShip(s, 'harkonnen', 'arrakeen', 1);
assert(!ship.ok && /promised/.test(ship.reason), 'canShip refuses, with a plain reason');
assert(movement.canShip(s, 'harkonnen', 'carthag', 1).ok, 'other shipments unaffected');
const fresh = game(); fresh.factions.harkonnen.forces.reserve = 5;
assert(movement.canShip(fresh, 'harkonnen', 'arrakeen', 1).ok, 'without the promise the same shipment is legal');

console.log('\nAll negotiation tests passed.');
