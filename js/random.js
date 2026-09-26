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

export function setSeed(seed) {
  source = seededRandom(seed);
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
