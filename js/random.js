// js/random.js
//
// One random source for the whole engine (brief section 39). Seed it once
// per game and every shuffle, storm dial and AI choice becomes
// reproducible: the same seed replays the same game exactly, which is how
// bugs get reproduced and AI versions get compared fairly.

let source = Math.random;

// mulberry32: small, fast, good enough for games.
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The engine's own seeded stream keeps its position in a plain number, so
// it can be saved with a game and restored exactly (save/resume must draw
// the same cards the original game would have).
let seededState = null;
function nextSeeded() {
  seededState = (seededState + 0x6D2B79F5) >>> 0;
  let t = Math.imul(seededState ^ (seededState >>> 15), 1 | seededState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function setSeed(seed) {
  seededState = seed >>> 0;
  source = nextSeeded;
}

export function getRandomState() {
  return seededState;
}

export function setRandomState(value) {
  seededState = value >>> 0;
  source = nextSeeded;
}

export function random() {
  return source();
}

// Unbiased Fisher-Yates shuffle. Returns a new array.
export function shuffle(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function newSeed() {
  return Math.floor(Math.random() * 1e9);
}
