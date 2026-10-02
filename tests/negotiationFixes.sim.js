// negotiationFixes.sim.js — fixes from the turn-30 export review:
// no secret sold (or bought) twice; alliance promises wait for a real Nexus.
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as phaseEngine from '../js/phaseEngine.js';
import * as neg from '../js/negotiation.js';
import { createNegotiator } from '../js/ai/negotiator.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const ids = ['emperor', 'fremen', 'guild', 'tleilaxu', 'choam', 'richese'];
const s = initializeGame({ activeFactionIds: ids, playerCircleOrder: ids, rulesConfig, seed: 9, spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
phaseEngine.nextPhase(s);
neg.initNegotiation(s);
s.meta.turn = 24; s.board.nextStormCard = 5;
s.factions.fremen.traitorHand = s.factions.fremen.traitorHand?.length ? s.factions.fremen.traitorHand : ['bashar'];

console.log('Test 1: a secret already bought is not offered again');
const kinds = (seller, buyer) => neg.sellableSecrets(s, seller, buyer).map(x => x.kind);
assert(kinds('fremen', 'tleilaxu').includes('stormCard') && kinds('fremen', 'emperor').includes('traitor'), 'before any deal, the storm card and traitor are on sale');
s.negotiation.knowledge.tleilaxu = [{ id: 'k1', kind: 'stormCard', about: 'fremen', value: 5, turn: 24 }];
s.negotiation.knowledge.emperor = [{ id: 'k2', kind: 'traitor', about: 'fremen', value: [...s.factions.fremen.traitorHand], turn: 24 }];
assert(!kinds('fremen', 'tleilaxu').includes('stormCard'), 'the Tleilaxu, who already know this turn\'s storm card, are not offered it again');
assert(!kinds('fremen', 'emperor').includes('traitor'), 'the Emperor, who already know the Fremen traitor, are not offered it again');
assert(kinds('fremen', 'guild').includes('stormCard'), 'others can still buy it');
s.meta.turn = 25; s.board.nextStormCard = 3;
assert(kinds('fremen', 'tleilaxu').includes('stormCard'), 'next turn the new storm card is on sale again');
const ai = createNegotiator({});
const offer = { from: 'fremen', to: 'emperor', give: { spice: 0, secrets: [{ kind: 'traitor' }], promises: [] }, ask: { spice: 2, secrets: [], promises: [] } };
assert(ai.chooseOfferResponse(s, 'emperor', offer).action !== 'accept', 'and the AI will not pay for a traitor it already knows');

console.log('\nTest 2: an alliance promise waits for the next Nexus');
s.negotiation.promises.push({ id: 'p1', by: 'emperor', to: 'tleilaxu', type: 'allianceAt', factionId: 'tleilaxu', turns: 3, turn: 25, untilTurn: 27, status: 'active' });
s.negotiation.promises.push({ id: 'p2', by: 'tleilaxu', to: 'emperor', type: 'noEnter', territoryId: 'arrakeen', turns: 3, turn: 25, untilTurn: 27, status: 'active' });
s.meta.turn = 28; neg.expirePromises(s);
const p1 = s.negotiation.promises.find(p => p.id === 'p1'), p2 = s.negotiation.promises.find(p => p.id === 'p2');
assert(p2.status === 'kept' && p1.status === 'active', 'three turns with no Nexus: the stay-out promise ends, the alliance promise is still owed');
assert(neg.allianceOwed(s, 'emperor') === 'tleilaxu', 'the Emperor still owe the Tleilaxu that alliance at the next Nexus');

console.log('\nAll negotiation fix tests passed.');
