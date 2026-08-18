// revival.sim.js — headless sanity check for charity + revival.
// Run with: node revival.sim.js

const {
  isEligibleForCharity, canClaimCharity, claimCharity
} = require('./js/choamCharityEngine.js');
const {
  freeRevivalAllowance, canReviveForces, reviveForces,
  isEligibleForLeaderRevival, canReviveLeader, reviveLeader
} = require('./js/revivalEngine.js');

function makeState() {
  return {
    spiceBank: { totalInCirculation: 1000 },
    factions: {
      fremen: {
        spice: 1, revivalTanks: 5, forces: { reserve: 3 },
        leaders: { available: ['chani'], killed: ['stilgar', 'otheym'] }
      },
      atreides: {
        spice: 10, revivalTanks: 6, forces: { reserve: 0 },
        leaders: { available: [], killed: ['thufirHawat', 'gurneyHalleck', 'duncanIdaho', 'drYueh', 'ladyJessica'] }
      },
      gesserit: {
        spice: 15, revivalTanks: 0, forces: { reserve: 0 },
        leaders: { available: ['alia'], killed: [] }
      }
    }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('  ok - ' + message);
}

console.log('Test 1: CHOAM Charity eligibility and payout');
let state = makeState();
assert(isEligibleForCharity(state, 'fremen') === true, 'fremen (1 spice) is eligible for charity');
assert(isEligibleForCharity(state, 'atreides') === false, 'atreides (10 spice) is not eligible');
assert(isEligibleForCharity(state, 'gesserit') === true, 'bene gesserit always eligible regardless of spice');

const fremenResult = claimCharity(state, 'fremen');
assert(fremenResult.amountReceived === 1, 'fremen tops up from 1 to 2, receiving 1');
assert(state.factions.fremen.spice === 2, 'fremen spice correctly at 2 after charity');

const gesseritResult = claimCharity(state, 'gesserit');
assert(gesseritResult.amountReceived === 2, 'bene gesserit always receives a flat 2, even starting from 15 spice');
assert(state.factions.gesserit.spice === 17, 'bene gesserit spice increased by the flat 2, not topped up to 2');

let secondClaim;
try { claimCharity(state, 'fremen'); secondClaim = 'allowed'; } catch (e) { secondClaim = 'blocked'; }
assert(secondClaim === 'blocked', 'cannot claim charity twice in the same turn');

console.log('\nTest 2: force revival, free allowance per faction');
state = makeState();
assert(freeRevivalAllowance('fremen') === 3, 'fremen free revival allowance is 3');
assert(freeRevivalAllowance('atreides') === 2, 'atreides free revival allowance is 2');

const fremenRevive = canReviveForces(state, 'fremen', 3);
assert(fremenRevive.ok === true && fremenRevive.cost === 0, 'fremen reviving exactly their free allowance (3) costs nothing');

reviveForces(state, 'fremen', 3);
assert(state.factions.fremen.forces.reserve === 6, 'fremen reserve increased by the revived amount (3 + 3 = 6)');
assert(state.factions.fremen.revivalTanks === 2, 'fremen tanks decreased correctly (5 - 3 = 2)');

console.log('\nTest 3: force revival beyond free allowance costs spice');
state = makeState();
const atreidesRevive = canReviveForces(state, 'atreides', 3); // free allowance is 2, so 1 must be paid
assert(atreidesRevive.ok === true, 'atreides can afford reviving 3 forces');
assert(atreidesRevive.freeUsed === 2 && atreidesRevive.paidUsed === 1, 'atreides correctly splits 2 free + 1 paid');
assert(atreidesRevive.cost === 2, 'the 1 paid force costs 2 spice as per the rulebook rate');

reviveForces(state, 'atreides', 3);
assert(state.factions.atreides.spice === 8, 'atreides spice reduced by the paid cost only (10 - 2 = 8)');

console.log('\nTest 4: revival cap of 3 per turn enforced even with enough tank forces and spice');
state = makeState();
let cappedCheck;
try { reviveForces(state, 'atreides', 4); cappedCheck = 'allowed'; } catch (e) { cappedCheck = 'blocked'; }
assert(cappedCheck === 'blocked', 'cannot revive more than 3 forces in one turn regardless of resources');

console.log('\nTest 5: leader revival only triggers when no leaders are available (per Q&A, not literal "all 5 in tanks")');
state = makeState();
assert(isEligibleForLeaderRevival(state, 'fremen') === false, 'fremen has 1 available leader (chani), not eligible for emergency leader revival');
assert(isEligibleForLeaderRevival(state, 'atreides') === true, 'atreides has zero available leaders, eligible');

const fremenLeaderCheck = canReviveLeader(state, 'fremen', 'stilgar', 7);
assert(fremenLeaderCheck.ok === false, 'fremen cannot revive a leader while they still have one available to play');

const atreidesLeaderCheck = canReviveLeader(state, 'atreides', 'thufirHawat', 5);
assert(atreidesLeaderCheck.ok === true && atreidesLeaderCheck.cost === 5, 'atreides can revive, cost equals the leader\'s fighting strength (5)');

reviveLeader(state, 'atreides', 'thufirHawat', 5);
assert(state.factions.atreides.leaders.available.includes('thufirHawat'), 'thufir hawat moved to available');
assert(!state.factions.atreides.leaders.killed.includes('thufirHawat'), 'thufir hawat removed from killed list');
assert(state.factions.atreides.spice === 5, 'atreides paid the fighting strength in spice (10 - 5 = 5)');

let secondLeaderRevive;
try { reviveLeader(state, 'atreides', 'gurneyHalleck', 4); secondLeaderRevive = 'allowed'; }
catch (e) { secondLeaderRevive = 'blocked'; }
assert(secondLeaderRevive === 'blocked', 'only 1 leader revival allowed per turn');

console.log('\nAll charity + revival sanity checks passed.');
