// storm.sim.js — headless sanity check.
// Run with: node storm.sim.js

const {
  rollFirstStormMovement, rollSubsequentStormMovement, advanceStormPosition,
  sectorsSwept, applyStormDamage, isTerritoryPartiallyInStorm, determineFirstPlayer
} = require('./js/stormEngine.js');

function assert(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('  ok - ' + message);
}

console.log('Test 1: first storm movement (0-20 range, summed)');
assert(rollFirstStormMovement(8, 12) === 20, '8 + 12 = 20');
let rangeCheck;
try { rollFirstStormMovement(21, 5); rangeCheck = 'allowed'; } catch (e) { rangeCheck = 'blocked'; }
assert(rangeCheck === 'blocked', 'dial values above 20 are rejected for the first storm');

console.log('\nTest 2: subsequent storm movement (1-3 range, summed)');
assert(rollSubsequentStormMovement(2, 3) === 5, '2 + 3 = 5');
let rangeCheck2;
try { rollSubsequentStormMovement(0, 2); rangeCheck2 = 'allowed'; } catch (e) { rangeCheck2 = 'blocked'; }
assert(rangeCheck2 === 'blocked', 'dial value of 0 is rejected for subsequent storms (must be 1-3)');

console.log('\nTest 3: sector position wraps correctly at the 18-sector boundary');
assert(advanceStormPosition(16, 3) === 1, '16 + 3 = 19, wraps to 1 (mod 18)');
assert(advanceStormPosition(0, 18) === 0, 'a full lap (18) returns to the same sector');
assert(advanceStormPosition(5, 0) === 5, 'zero movement stays put');

console.log('\nTest 4: swept sectors list is correct and in order');
const swept = sectorsSwept(16, 4);
assert(JSON.stringify(swept) === JSON.stringify([17, 0, 1, 2]), `expected [17,0,1,2], got ${JSON.stringify(swept)}`);

console.log('\nTest 5: sector-dependent functions fail loudly rather than silently no-op-ing');
let damageResult;
try { applyStormDamage({}, [1, 2, 3], null); damageResult = 'ran silently'; }
catch (e) { damageResult = e.message.startsWith('NOT_IMPLEMENTED') ? 'threw clearly' : 'threw unclear error'; }
assert(damageResult === 'threw clearly', 'applyStormDamage refuses to silently no-op without sector data');

let stormCheckResult;
try { isTerritoryPartiallyInStorm('arrakeen', 5, null); stormCheckResult = 'ran silently'; }
catch (e) { stormCheckResult = e.message.startsWith('NOT_IMPLEMENTED') ? 'threw clearly' : 'threw unclear error'; }
assert(stormCheckResult === 'threw clearly', 'isTerritoryPartiallyInStorm refuses to silently no-op without sector data');

let firstPlayerResult;
try { determineFirstPlayer({}, 5, null); firstPlayerResult = 'ran silently'; }
catch (e) { firstPlayerResult = e.message.startsWith('NOT_IMPLEMENTED') ? 'threw clearly' : 'threw unclear error'; }
assert(firstPlayerResult === 'threw clearly', 'determineFirstPlayer refuses to silently no-op without sector data');

console.log('\nAll storm engine sanity checks passed (movement math verified, sector-dependent stubs confirmed to fail loudly).');
