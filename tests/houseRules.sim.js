// houseRules.sim.js — no turn limit, no Guild special victory, stalemate cap.
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import { resolveMentatPause } from '../js/victoryEngine.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, live] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const ALL = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const rules = { ...live, houseRules: { ...live.houseRules, noTurnLimit: true, noGuildSpecialVictory: true, stalemateTurnCap: 30 } };
const game = () => {
  const s = initializeGame({ activeFactionIds: ALL, playerCircleOrder: ALL, rulesConfig: rules, seed: 6, spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
  s.factions.gesserit.specialFactionState.prediction = null; // keep the Prediction out of these checks
  return s;
};

console.log('Test 1: turn 10 with no winner does not end the game (no Guild win, no fallback)');
let s = game();
s.meta.turn = 10;
s.factions.fremen.forces.onBoard = { theGreatFlat: 10 }; // Fremen special not met (they are out of their sietches)
s.factions.harkonnen.forces.onBoard.sietchTabr = 1;
let r = resolveMentatPause(s, territories);
assert(!r.gameOver, 'play continues past turn 10');

console.log('\nTest 2: the Fremen special victory is still checked once, at the end of turn 10');
s = game();
s.meta.turn = 10;
s.factions.guild.forces.onBoard = {};                     // nobody else in Tuek's Sietch
r = resolveMentatPause(s, territories);
assert(r.gameOver && r.method === 'fremen-special', 'Fremen win on turn 10 when their conditions are met');
s.meta.turn = 11;
r = resolveMentatPause(s, territories);
assert(!r.gameOver, 'but not on turn 11: it was a one-time check');

console.log('\nTest 3: a stronghold victory on turn 15 still ends the game');
s = game();
s.meta.turn = 15;
s.factions.atreides.forces.onBoard.carthag = 2; s.factions.atreides.forces.onBoard.tueksSietch = 2;
r = resolveMentatPause(s, territories);
assert(r.gameOver && r.method === 'stronghold-solo' && r.winners.includes('atreides'), 'Atreides win with 3 strongholds on turn 15');

console.log('\nTest 4: a stalemate ends in a draw at the safety cap');
s = game();
s.meta.turn = 30;
r = resolveMentatPause(s, territories);
assert(r.gameOver && r.method === 'stalemate' && r.winners.length === 0, 'turn 30 with no winner is a draw');

console.log('\nAll house rule checks passed.');
