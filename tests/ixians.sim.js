// ixians.sim.js — the Ixians (expansion M3 core).
import fs from 'fs';
import { initializeGame, treacheryCardsInPlay } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import * as phaseEngine from '../js/phaseEngine.js';
import { canShip, canMove } from '../js/movementEngine.js';
import { canReviveForces } from '../js/revivalEngine.js';
import { calculateStrength, fremenFullStrength } from '../js/battleEngine.js';
import { placeHms, hmsReachable, moveHms } from '../js/hms.js';
import { strongholdIdsFrom, strongholdsOccupiedBy } from '../js/victoryEngine.js';
import { createAI } from '../js/ai/difficulty.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cards = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const SIX = ['atreides', 'harkonnen', 'emperor', 'fremen', 'ixians', 'tleilaxu'];
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const game = (seed = 7) => initializeGame({ activeFactionIds: SIX, playerCircleOrder: SIX, rulesConfig, seed, spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });

console.log('Test 1: setup and the starting draft');
let s = game();
const ix = s.factions.ixians;
assert(ix.spice === 10 && ix.forces.onBoard.hms === 6 && ix.forces.starredOnBoard.hms === 3 && ix.forces.reserve === 14 && ix.forces.starredReserve === 4, '10 spice; 6 in the HMS (3 Cyborgs); 14 in reserve (4 Cyborgs)');
const handsBefore = Object.fromEntries(SIX.map(f => [f, s.factions[f].treacheryHand.length]));
await turnEngine.runSetupDecisions(s, turnEngine.passiveDecisionProvider);
assert(SIX.every(f => s.factions[f].treacheryHand.length === handsBefore[f]), 'after the draft every faction still holds the same number of cards');

console.log('\nTest 2: the HMS counts as a stronghold, and only the Ixians ship straight in');
placeHms(s, 'theGreatFlat');
assert(strongholdIdsFrom(territories).includes('hms') && strongholdsOccupiedBy(s, 'ixians', strongholdIdsFrom(territories)).includes('hms'), 'the Ixians hold the HMS for victory');
assert(canShip(s, 'ixians', 'hms', 2).ok && !canShip(s, 'harkonnen', 'hms', 2).ok, 'Ixians may ship into it; Harkonnen may not');
s.factions.harkonnen.forces.onBoard.theGreatFlat = 3;
assert(canMove(s, 'harkonnen', 'theGreatFlat', 'hms', 3).ok, 'Harkonnen can enter it from the territory it points at');

console.log('\nTest 3: the HMS moves and collects spice');
s = game(); placeHms(s, 'theGreatFlat');
s.board.spiceBlowMarkers.push({ territoryId: 'funeralPlain', amount: 10, pile: 'A', turn: 1 });
const paths = hmsReachable(s);
assert(paths.funeralPlain && Object.keys(paths).every(t => territories.territories[t].type !== 'stronghold'), 'reachable territories exclude strongholds');
const before = s.factions.ixians.spice;
const r = moveHms(s, paths.funeralPlain);
assert(r.collected === 10 && s.factions.ixians.spice === before + 10 && s.board.hms.territoryId === 'funeralPlain', 'moved to the Funeral Plain and collected its 10 spice (up to 12 for 6 forces)');

console.log('\nTest 4: Cyborgs and Suboids in battle; Cyborg revival cost');
const plan = { forcesCommitted: 4, starredForcesCommitted: 2, spiceCommitted: 4, supportedStarredCount: 2, supportedOrdinaryCount: 2, leaderFightingValue: 0, starredUnitValue: 2 };
assert(calculateStrength(fremenFullStrength('ixians', plan)) === 2 * 2 + 2 * 0.5, '2 backed Cyborgs (2 each) + 2 Suboids (½ each, never boosted) = 5');
s = game(); s.factions.ixians.revivalTanks = 3; s.factions.ixians.starredRevivalTanks = 2; s.factions.ixians.spice = 20;
const rv = canReviveForces(s, 'ixians', 3, 2);
assert(rv.ok && rv.cost === 2 * 2 + 2, '3 revived incl. 2 Cyborgs: 1 free, then 2 paid Cyborgs at 3 each = 6 spice');
assert(canMove({ ...s, factions: { ...s.factions } }, 'ixians', 'hms', 'hms', 1).ok === false, 'no zero-length moves');

console.log('\nTest 5: the auction bury');
s = game(); s.meta.turn = 2;
await turnEngine.runSetupDecisions(s, turnEngine.passiveDecisionProvider);
let seen = null;
await turnEngine.runBiddingPhase(s, { ...turnEngine.passiveDecisionProvider, chooseIxianBury: (st, f, ids) => { seen = ids; return { cardId: ids[0], where: 'bottom' }; } });
const auctionSize = seen.length - 1;
assert(seen && auctionSize >= 1 && s.decks.treacheryDeck.includes(seen[0]) && !Object.values(s.factions).some(f => f.treacheryHand.includes(seen[0])), `Ixians saw ${seen.length} cards (${auctionSize} for auction + 1) and put one back in the deck`);

console.log('\nTest 6: full AI games with the Ixians and Tleilaxu seated keep every troop and card accounted for');
const cardsInPlay = treacheryCardsInPlay(rulesConfig, treacheryDeck).length;
let hmsMoves = 0;
for (let g = 0; g < 12; g++) {
  const st = game(600 + g);
  const ai = { ...createAI('hard', { leadersData: leaders, cardLookup: cards }), observe: e => { if (e.type === 'hmsMove') hmsMoves++; } };
  await turnEngine.runSetupDecisions(st, ai); phaseEngine.nextPhase(st);
  while (!st.victory.achieved) {
    await turnEngine.runFullTurn(st, ai, territories, cards);
    for (const f of SIX) {
      const x = st.factions[f], tot = x.forces.reserve + (x.revivalTanks ?? 0) + Object.values(x.forces.onBoard).reduce((a, b) => a + b, 0);
      if (tot !== 20) throw new Error(`FAILED: ${f} has ${tot} troops on turn ${st.meta.turn}`);
    }
    const inPlay = st.decks.treacheryDeck.length + st.decks.treacheryDiscard.length + SIX.reduce((n, f) => n + st.factions[f].treacheryHand.length, 0);
    if (inPlay !== cardsInPlay) throw new Error(`FAILED: ${inPlay} treachery cards on turn ${st.meta.turn}`);
  }
}
assert(true, `12 games finished, every troop and card accounted for every turn (the HMS moved ${hmsMoves} times)`);

console.log('\nAll Ixian checks passed.');
