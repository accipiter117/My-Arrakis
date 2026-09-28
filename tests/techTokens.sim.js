// techTokens.sim.js — the Tech Tokens variant (expansion plan M4).
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import { reviveForces } from '../js/revivalEngine.js';
import { executeShipment } from '../js/movementEngine.js';
import { claimCharity } from '../js/choamCharityEngine.js';
import { strongholdIdsFrom, strongholdsOccupiedBy, resolveMentatPause } from '../js/victoryEngine.js';
import { assessVictoryWatch } from '../js/victoryWatch.js';
import { placeHms } from '../js/hms.js';
import * as tech from '../js/techTokens.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cards = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const rules = mode => ({ ...rulesConfig, expansions: { ...rulesConfig.expansions, techTokens: mode } });
const game = (ids, mode = 'auto', seed = 11) => initializeGame({ activeFactionIds: ids, playerCircleOrder: ids, rulesConfig: rules(mode), seed,
  spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
const owner = (s, t) => s.techTokens[t].owner;
const BASE = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];
const EXP = ['atreides', 'harkonnen', 'fremen', 'gesserit', 'ixians', 'tleilaxu'];

console.log('Test 1: when the variant is on');
assert(!game(BASE).techTokens, 'auto: off with neither Ixians nor Tleilaxu seated');
assert(Boolean(game(EXP).techTokens), 'auto: on with them seated');
assert(!game(EXP, 'off').techTokens && Boolean(game(BASE, 'on').techTokens), '"off" and "on" override the default');

console.log('\nTest 2: default owners take their tokens at setup');
let s = game(EXP);
assert(owner(s, 'axlotl') === 'tleilaxu' && owner(s, 'heighliner') === 'ixians' && owner(s, 'spiceProd') === 'fremen', 'Tleilaxu Axlotl Tanks, Ixians Heighliners, Fremen Spice Production');
assert(s.meta.techTokensAssigned, 'nothing left to deal after the first storm');

console.log('\nTest 3: the rulebook example (Ixians, Atreides, Guild, Fremen)');
const EX = ['ixians', 'atreides', 'guild', 'fremen'];
s = game(EX, 'auto');
assert(owner(s, 'heighliner') === 'ixians' && owner(s, 'spiceProd') === 'fremen' && owner(s, 'axlotl') === null, 'Axlotl Tanks waits for the first storm');
await turnEngine.runStormPhase(s, turnEngine.passiveDecisionProvider);
const start = s.meta.turnOrder.indexOf(s.meta.firstPlayer);
const fromFirst = [...s.meta.turnOrder.slice(start), ...s.meta.turnOrder.slice(0, start)];
const expected = fromFirst.find(f => !['ixians', 'fremen'].includes(f));
assert(owner(s, 'axlotl') === expected, `after the storm it goes to the first faction without a token from the First Player (${expected})`);

console.log('\nTest 4: none of the default owners seated; dealt one each in turn order');
s = game(['atreides', 'harkonnen', 'emperor', 'guild', 'gesserit'], 'on');
await turnEngine.runStormPhase(s, turnEngine.passiveDecisionProvider);
const owners = tech.TECH_TOKENS.map(t => owner(s, t));
const st = s.meta.turnOrder.indexOf(s.meta.firstPlayer);
const firstThree = [...s.meta.turnOrder.slice(st), ...s.meta.turnOrder.slice(0, st)].slice(0, 3);
assert(new Set(owners).size === 3 && owners.every(f => firstThree.includes(f)), `the first three factions from the First Player each hold one (${firstThree.join(', ')})`);

console.log('\nTest 5: two players, three tokens');
s = game(['atreides', 'harkonnen'], 'on');
await turnEngine.runStormPhase(s, turnEngine.passiveDecisionProvider);
assert(tech.TECH_TOKENS.filter(t => owner(s, t)).length === 2 && tech.tokensOwnedBy(s, 'atreides').length === 1, 'one each; the third stays out of play');

console.log('\nTest 6: Axlotl Tanks income');
s = game(EXP);
s.factions.atreides.revivalTanks = 3;
s.factions.tleilaxu.revivalTanks = 3;
reviveForces(s, 'tleilaxu', 2, 0);
assert(tech.payTechTokens(s, 'revival').length === 0, 'only the Tleilaxu took free revival: no income');
reviveForces(s, 'atreides', 2, 0);
let before = s.factions.tleilaxu.spice;
let paid = tech.payTechTokens(s, 'revival');
assert(paid.length === 1 && s.factions.tleilaxu.spice === before + 1, 'Atreides took free revival: the Tleilaxu collect 1');
assert(tech.payTechTokens(s, 'revival').length === 0, 'once per phase: triggers are cleared after paying');
s.factions.atreides.revivalTanks = 3; s.factions.atreides.forcesRevivedThisTurn = 2; s.factions.atreides.spice = 10;
reviveForces(s, 'atreides', 1, 0);
assert(!s.techTokens.axlotl.triggeredBy.length, 'a paid revival does not trigger it');

console.log('\nTest 7: income scales with tokens held, and pays per token triggered');
s = game(EXP);
s.techTokens.heighliner.owner = 'tleilaxu';
s.factions.atreides.revivalTanks = 2;
reviveForces(s, 'atreides', 2, 0);
s.factions.harkonnen.spice = 20;
executeShipment(s, 'harkonnen', 'arrakeen', 2);
before = s.factions.tleilaxu.spice;
tech.payTechTokens(s, 'revival'); tech.payTechTokens(s, 'shipment');
assert(s.factions.tleilaxu.spice === before + 4, 'the rulebook example: two tokens, both triggered, 2 + 2 = 4 spice');

console.log('\nTest 8: Heighliners triggers and exclusions');
s = game(['atreides', 'harkonnen', 'fremen', 'guild', 'ixians', 'tleilaxu']);
s.factions.guild.spice = 20;
executeShipment(s, 'guild', 'carthag', 2);
assert(tech.payTechTokens(s, 'shipment').length === 0, 'only the Guild shipped: no income');
executeShipment(s, 'fremen', 'theGreatFlat', 2);
assert(!s.techTokens.heighliner.triggeredBy.includes('fremen'), 'a Fremen shipment comes from the deep desert, not off-planet');
placeHms(s, 'theGreatFlat');
executeShipment(s, 'ixians', 'hms', 1);
before = s.factions.ixians.spice;
assert(tech.payTechTokens(s, 'shipment')[0]?.amount === 1 && s.factions.ixians.spice === before + 1, 'the owner shipping counts ("including you")');

console.log('\nTest 9: Spice Production triggers and exclusions');
s = game(EXP);
s.factions.gesserit.spice = 10;
claimCharity(s, 'gesserit');
assert(tech.payTechTokens(s, 'charity').length === 0, 'only the Bene Gesserit took charity: no income');
s.factions.harkonnen.spice = 0;
claimCharity(s, 'harkonnen');
before = s.factions.fremen.spice;
tech.payTechTokens(s, 'charity');
assert(s.factions.fremen.spice === before + 1, 'Harkonnen took charity: the Fremen collect 1');

console.log('\nTest 10: the turn engine pays at the end of the phase');
s = game(EXP);
s.meta.phase = 'charity';
s.factions.atreides.spice = 0;
const events = [];
before = s.factions.fremen.spice;
await turnEngine.stepOnePhase(s, { ...turnEngine.passiveDecisionProvider, observe: e => events.push(e) }, territories, cards);
assert(s.factions.fremen.spice === before + 1 && events.some(e => e.type === 'techIncome' && e.token === 'spiceProd'), 'Spice Production paid when Charity ended, with an event for the log');

console.log('\nTest 11: winning a battle takes a token');
s = game(EXP);
for (const f of EXP) { delete s.factions[f].pendingTraitorHand; s.factions[f].traitorHand = []; }
s.factions.tleilaxu.faceDancers = [];
s.techTokens.axlotl.owner = 'atreides'; s.techTokens.spiceProd.owner = 'atreides';
s.factions.harkonnen.forces.onBoard.arrakeen = 10;
const plan = (leaderId, v, forces) => ({ forcesCommitted: forces, starredForcesCommitted: 0, spiceCommitted: 0, supportedStarredCount: 0, supportedOrdinaryCount: 0,
  leaderId, leaderFightingValue: v, weaponCardId: null, defenseCardId: null, cheapHeroCardId: null });
let asked = null;
const [res] = await turnEngine.runBattlePhase(s, { ...turnEngine.passiveDecisionProvider,
  chooseTechTokenToTake: (st, f, opts, from) => { asked = { f, opts, from }; return 'spiceProd'; },
  chooseBattlePlan: (st, f) => f === 'harkonnen' ? plan('feydRautha', 6, 5) : plan('duncanIdaho', 2, 0) }, cards);
assert(res.winnerFactionId === 'harkonnen' && asked?.f === 'harkonnen' && asked.from === 'atreides' && asked.opts.length === 2, 'Harkonnen won and chose between Atreides\' two tokens');
assert(owner(s, 'spiceProd') === 'harkonnen' && owner(s, 'axlotl') === 'atreides' && res.techToken?.token === 'spiceProd', 'Harkonnen took Spice Production; Atreides kept Axlotl Tanks');

console.log('\nTest 12: all three count as a stronghold; allies cannot combine');
s = game(EXP);
const ids = strongholdIdsFrom(territories);
for (const t of tech.TECH_TOKENS) s.techTokens[t].owner = 'harkonnen';
s.factions.harkonnen.forces.onBoard = { carthag: 5, arrakeen: 3 };
s.factions.atreides.forces.onBoard = {};
assert(strongholdsOccupiedBy(s, 'harkonnen', ids).includes(tech.TECH_STRONGHOLD), 'the full set is counted');
s.meta.turn = 3;
const win = resolveMentatPause(s, territories);
assert(win.gameOver && win.winners.includes('harkonnen'), 'Carthag, Arrakeen and all three tokens: Harkonnen win');
s = game(EXP);
s.alliances = [{ factions: ['harkonnen', 'fremen'], formedTurn: 1 }];
s.techTokens.axlotl.owner = 'harkonnen'; s.techTokens.heighliner.owner = 'harkonnen'; s.techTokens.spiceProd.owner = 'fremen';
assert(!strongholdsOccupiedBy(s, 'harkonnen', ids).includes(tech.TECH_STRONGHOLD) && !strongholdsOccupiedBy(s, 'fremen', ids).includes(tech.TECH_STRONGHOLD), 'split between allies, the set does not count');

console.log('\nTest 13: the victory watch sees a token set');
s = game(EXP);
for (const f of EXP) s.factions[f].forces.onBoard = {};
s.factions.harkonnen.forces.onBoard = { carthag: 5 };
for (const t of tech.TECH_TOKENS) s.techTokens[t].owner = 'harkonnen';
const watch = assessVictoryWatch(s, territories);
assert(watch.some(w => w.level === 'warning' && w.factions.includes('harkonnen') && /Tech Tokens/.test(w.detail)), 'one stronghold plus the full set is flagged as one short');

console.log('\nTest 14: AI choice');
s = game(EXP);
s.techTokens.axlotl.owner = 'harkonnen'; s.techTokens.heighliner.owner = 'harkonnen';
assert(tech.defaultTokenChoice(s, 'harkonnen', ['spiceProd', 'axlotl']) === 'spiceProd', 'takes the token that completes its set');
assert(tech.defaultTokenChoice(s, 'emperor', ['heighliner', 'spiceProd']) === 'spiceProd', 'otherwise the one that pays soonest (Charity)');

console.log('\nAll Tech Token tests passed.');
