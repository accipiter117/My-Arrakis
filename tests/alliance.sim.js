// alliance.sim.js — headless sanity check.
// Run with: node alliance.sim.js

const {
  isFactionAllied, canFormAlliance, formAlliance,
  canBreakAlliance, breakAlliance, findAllyOverlapViolations, enforceAllyOverlapPenalty
} = require('./js/allianceEngine.js');

function makeState(nexusActive = true, turn = 3) {
  return {
    meta: { turn },
    nexus: { active: nexusActive },
    alliances: [],
    factions: {
      atreides: { forces: { onBoard: {} }, revivalTanks: 0 },
      fremen: { forces: { onBoard: {} }, revivalTanks: 0 },
      harkonnen: { forces: { onBoard: {} }, revivalTanks: 0 },
      guild: { forces: { onBoard: {} }, revivalTanks: 0 }
    }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('  ok - ' + message);
}

console.log('Test 1: alliances can only form during an active Nexus');
let state = makeState(false); // nexus not active
let check = canFormAlliance(state, 'atreides', 'fremen');
assert(check.ok === false, 'cannot form an alliance outside of a Nexus');

console.log('\nTest 2: forming an alliance works during an active Nexus');
state = makeState(true);
formAlliance(state, 'atreides', 'fremen');
assert(isFactionAllied(state, 'atreides') === true, 'atreides now flagged as allied');
assert(isFactionAllied(state, 'fremen') === true, 'fremen now flagged as allied');
assert(isFactionAllied(state, 'harkonnen') === false, 'harkonnen, uninvolved, remains unallied');

console.log('\nTest 3: no faction can join a second alliance');
check = canFormAlliance(state, 'atreides', 'harkonnen');
assert(check.ok === false, 'atreides cannot form a second alliance while already in one');
check = canFormAlliance(state, 'harkonnen', 'fremen');
assert(check.ok === false, 'fremen (via harkonnen attempt) blocked the same way from the other side');

console.log('\nTest 4: a faction can break its alliance during a Nexus, then immediately form a new one');
state = makeState(true);
formAlliance(state, 'atreides', 'fremen');
breakAlliance(state, 'atreides');
assert(isFactionAllied(state, 'atreides') === false, 'atreides no longer allied after breaking');
assert(isFactionAllied(state, 'fremen') === false, 'fremen also freed, the alliance record itself was removed');
const reformCheck = canFormAlliance(state, 'atreides', 'harkonnen');
assert(reformCheck.ok === true, 'atreides can immediately ally with someone new in the same nexus after breaking');

console.log('\nTest 5: cannot break an alliance outside a Nexus');
state = makeState(true);
formAlliance(state, 'atreides', 'fremen');
state.nexus.active = false; // nexus closed
let breakCheck = canBreakAlliance(state, 'atreides');
assert(breakCheck.ok === false, 'cannot break an alliance once the nexus window has closed');

console.log('\nTest 6: ally overlap violation detection and enforcement');
state = makeState(true);
formAlliance(state, 'atreides', 'fremen');
state.factions.atreides.forces.onBoard.arrakeen = 3;
state.factions.fremen.forces.onBoard.arrakeen = 2;
let violations = findAllyOverlapViolations(state);
assert(violations.length === 1 && violations[0].territoryId === 'arrakeen', 'detects the shared arrakeen occupation as a violation');

const penalty = enforceAllyOverlapPenalty(state, ['fremen', 'atreides'], violations[0]);
assert(penalty.penalizedFactionId === 'atreides', 'second-in-turn-order faction (atreides here) is the one penalized');
assert(state.factions.atreides.forces.onBoard.arrakeen === undefined, 'penalized faction lost their forces in the shared territory');
assert(state.factions.fremen.forces.onBoard.arrakeen === 2, 'the first-in-turn-order ally keeps their forces untouched');
assert(state.factions.atreides.revivalTanks === 3, 'lost forces went to the tanks');

console.log('\nTest 7: overlap violation resolves naturally if one ally already moved out before enforcement');
state = makeState(true);
formAlliance(state, 'atreides', 'fremen');
state.factions.atreides.forces.onBoard.arrakeen = 3;
state.factions.fremen.forces.onBoard.arrakeen = 2;
violations = findAllyOverlapViolations(state);
delete state.factions.atreides.forces.onBoard.arrakeen; // atreides moved out on their own
const noOpPenalty = enforceAllyOverlapPenalty(state, ['fremen', 'atreides'], violations[0]);
assert(noOpPenalty === null, 'no penalty applied since the overlap resolved itself before enforcement ran');

console.log('\nTest 8: Polar Sink is exempt from the overlap rule entirely');
state = makeState(true);
formAlliance(state, 'atreides', 'fremen');
state.factions.atreides.forces.onBoard.polarSink = 1;
state.factions.fremen.forces.onBoard.polarSink = 1;
violations = findAllyOverlapViolations(state);
assert(violations.length === 0, 'sharing the polar sink never counts as a violation, allies free haven');

console.log('\nAll alliance engine sanity checks passed.');
