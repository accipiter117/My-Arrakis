// recorder.sim.js — the match record behind exports (ui/recorder.js), run over AI games.
import fs from 'fs';
import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import * as phaseEngine from '../js/phaseEngine.js';
import { createAI } from '../js/ai/difficulty.js';
import { createRecorder, summarise } from '../ui/recorder.js';
const L = p => JSON.parse(fs.readFileSync('./data/' + p, 'utf8'));
const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = ['territories.json', 'spiceDeck.json', 'treacheryDeck.json', 'leaders.json', 'rulesConfig.json'].map(L);
const cards = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok - ' + m); };
const LINEUPS = [['emperor', 'fremen', 'guild', 'tleilaxu', 'choam', 'richese'], ['atreides', 'harkonnen', 'gesserit', 'ixians', 'tleilaxu', 'richese']];
let estimates = 0, noField = 0;
for (let g = 0; g < 6; g++) {
  const ids = LINEUPS[g % 2];
  const state = initializeGame({ activeFactionIds: ids, playerCircleOrder: ids, rulesConfig, seed: 900 + g,
    spiceDeckData: spiceDeck, territoriesData: territories, treacheryDeckData: treacheryDeck, leadersData: leaders });
  let rec = createRecorder();
  rec.start(state, { seed: 900 + g });
  const ai = rec.wrapAI(createAI('hard', { leadersData: leaders, cardLookup: cards }), () => state);
  const dp = { ...ai, observe: (e, st) => rec.event(e, st) };
  await turnEngine.runSetupDecisions(state, dp);
  phaseEngine.nextPhase(state);
  let guard = 0;
  while (!state.victory.achieved && guard++ < 400) {
    const before = rec.spiceNow(state);
    const entry = await turnEngine.stepOnePhase(state, dp, territories, cards);
    rec.phase(entry, before, state);
    if (guard === 20) rec = createRecorder(JSON.parse(JSON.stringify(rec.data))); // survives a save and resume
  }
  const s = summarise(rec.data, state, cards);
  if (!s.checks.passed) throw new Error(`game ${g}: ${s.checks.problems.join('; ')}`);
  for (const f of ids) {
    const net = s.spice[f].net, actual = state.factions[f].spice - rec.data.start.factions[f].spice;
    if (net !== actual) throw new Error(`game ${g}: ${f} spice by phase ${net} but changed by ${actual}`);
  }
  if (rec.data.turns.length < state.meta.turn - 1) throw new Error(`game ${g}: only ${rec.data.turns.length} turn snapshots`);
  estimates += s.aiBattleEstimates.length;
  noField += s.reveal.noFieldPlacements.filter(p => p.value !== null).length;
  JSON.stringify({ record: rec.data, review: s }); // exports as JSON
  if (g === 0) console.log(`  (game 0: ${s.counts.events} events, ${s.counts.aiDecisions} AI decisions, ${s.counts.turnsSnapshotted} turns; calibration ${JSON.stringify(s.aiBattleCalibration)})`);
}
assert(true, '6 AI games: conservation checks pass; spice by phase adds up to each faction\'s real change; one snapshot a turn; the record survives a save');
assert(estimates > 0, `AI battle estimates recorded (${estimates}) and matched to results`);
assert(noField > 0, `No-Field token values revealed (${noField} placements)`);
console.log('\nAll recorder tests passed.');
