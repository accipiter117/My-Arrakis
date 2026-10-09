// ui/sfx.js
//
// Sound effects, played through Web Audio so they start instantly and can
// overlap the score. Unlocked on the player's first tap (phones require
// one). The same sound never stacks on itself within a short window, so a
// burst of shipments doesn't become a wall of noise.
//
// Credits (see docs/CREDITS.md):
//   worm-roar.mp3    "Beast Roar" by barrypirro, CC0, https://freesound.org/s/530573/
//   ship-arrival.mp3 "Spaceship flight" by BloodPixelHero, CC BY 4.0, https://freesound.org/s/572623/
//   ornithopter.mp3  provided by the project owner (loudness-levelled)
//   bid-1..8.mp3     "Bag of pistachio shells drops on wood" by zabuhailo, https://freesound.org/s/871411/
//                    (provided by the project owner; eight drops, trimmed, faded and levelled)
//   card-slide.mp3   "slidecard04" by silverdubloons, https://freesound.org/s/817579/ (provided by the project owner)
//   card-slap.mp3    "slap cards" by themfish, https://freesound.org/s/45821/ (provided by the project owner; one slap)
//   harvest.wav      provided by the project owner (grain scooping loop, Spice Collection; made seamless, raised)
//   battle.wav       provided by the project owner (Battle phase loop; made seamless, levelled)
//   spice-1..3.mp3   provided by the project owner (spice blow landing; levelled, faded)
//   footsteps.mp3    "Snow footsteps running" by qubodup, https://freesound.org/s/216570/ (provided by the
//                    project owner; the loudest 3 seconds, trimmed, faded and levelled)
//   (the first two trimmed, faded and loudness-levelled for the game)

const SOUNDS = {
  wormRoar: '../assets/sfx/worm-roar.mp3',
  shipArrival: '../assets/sfx/ship-arrival.mp3',
  ornithopter: '../assets/sfx/ornithopter.mp3?v=2',
  footsteps: '../assets/sfx/footsteps.mp3?v=1',
  // A bid: one of eight drops of a bag of shells, picked at random.
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map(i => [`bid${i}`, `../assets/sfx/bid-${i}.mp3?v=1`])),
  // A spice blow landing: one of three, at random.
  ...Object.fromEntries([1, 2, 3].map(i => [`spice${i}`, `../assets/sfx/spice-${i}.mp3?v=1`])),
  // Phase ambiences: seamless loops (WAV, since MP3 padding leaves a gap on every loop).
  revivalTanks: '../assets/sfx/revival-tanks.wav',
  bidding: '../assets/sfx/bidding.wav',
  shipping: '../assets/sfx/shipping.wav',
  battle: '../assets/sfx/battle.wav?v=1',
  harvest: '../assets/sfx/harvest.wav?v=1',
  cardSlide: '../assets/sfx/card-slide.mp3?v=1',   // a card selected or put out for auction
  cardSlap: '../assets/sfx/card-slap.mp3?v=1',     // a card revealing itself
  wormDelivery: '../assets/sfx/worm-delivery.mp3',
  // Turn announcements, played as a faction's turn banner appears.
  'turn-atreides': '../assets/sfx/turn-atreides.mp3',
  'turn-harkonnen': '../assets/sfx/turn-harkonnen.mp3',
  'turn-gesserit': '../assets/sfx/turn-gesserit.mp3'
};
const KEY = 'my-arrakis-sfx';
const MIN_GAP_MS = 700;

export function createSfx({ onPlay } = {}) {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  const settings = { enabled: saved.enabled ?? true, volume: saved.volume ?? 0.8 };
  let ctx = null, gain = null;
  const buffers = {};
  const lastPlayed = {};
  const lastRandom = {};
  const loops = {};
  const save = () => localStorage.setItem(KEY, JSON.stringify(settings));

  async function loadAll() {
    await Promise.all(Object.entries(SOUNDS).map(async ([name, path]) => {
      try {
        const data = await (await fetch(new URL(path, import.meta.url))).arrayBuffer();
        buffers[name] = await ctx.decodeAudioData(data);
      } catch (err) {
        console.warn(`Could not load sound ${name}`, err);
      }
    }));
  }

  return {
    // Call from a user tap.
    unlock() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      ctx = new Ctx();
      gain = ctx.createGain();
      gain.gain.value = settings.volume;
      gain.connect(ctx.destination);
      loadAll();
    },
    // seconds: play only that long (fading out over the last quarter second),
    // e.g. footsteps lasting exactly as long as a march across the map.
    play(name, { seconds = null } = {}) {
      if (!settings.enabled || !ctx || !buffers[name]) return false;
      const now = performance.now();
      if (now - (lastPlayed[name] ?? -Infinity) < MIN_GAP_MS) return false;
      lastPlayed[name] = now;
      if (ctx.state === 'suspended') ctx.resume();
      const source = ctx.createBufferSource();
      source.buffer = buffers[name];
      if (seconds) {
        const g = ctx.createGain(), t = ctx.currentTime, len = Math.min(seconds, buffers[name].duration);
        g.gain.setValueAtTime(1, t);
        g.gain.setValueAtTime(1, t + Math.max(0, len - 0.25));
        g.gain.linearRampToValueAtTime(0, t + len);
        source.connect(g); g.connect(gain);
        source.start(); source.stop(t + len + 0.05);
        onPlay?.(name, len);
        return true;
      }
      source.connect(gain);
      source.start();
      onPlay?.(name, buffers[name].duration);
      return true;
    },
    // One sound from a numbered pool (bid1..bid8), at random, never the same twice running.
    playRandom(prefix) {
      const pool = Object.keys(buffers).filter(n => n.startsWith(prefix) && /\d+$/.test(n) && n !== lastRandom[prefix]);
      if (!pool.length) return false;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      lastRandom[prefix] = pick;
      return this.play(pick);
    },
    // A phase ambience: loops from the start of its phase, fading in, until
    // stopLoop fades it out. Starting one that is already playing does nothing.
    startLoop(name, fadeIn = 0.8) {
      if (!settings.enabled || !ctx || !buffers[name] || loops[name]) return false;
      if (ctx.state === 'suspended') ctx.resume();
      const source = ctx.createBufferSource();
      source.buffer = buffers[name];
      source.loop = true;
      const fader = ctx.createGain();
      fader.gain.setValueAtTime(0, ctx.currentTime);
      fader.gain.linearRampToValueAtTime(1, ctx.currentTime + fadeIn);
      source.connect(fader).connect(gain);
      source.start();
      loops[name] = { source, fader };
      return true;
    },
    stopLoop(name, fadeOut = 1.5) {
      const loop = loops[name];
      if (!loop) return;
      delete loops[name];
      const now = ctx.currentTime;
      loop.fader.gain.cancelScheduledValues(now);
      loop.fader.gain.setValueAtTime(loop.fader.gain.value, now);
      loop.fader.gain.linearRampToValueAtTime(0, now + fadeOut);
      loop.source.stop(now + fadeOut + 0.05);
    },
    stopAllLoops() { Object.keys(loops).forEach(n => this.stopLoop(n, 0.4)); },
    setEnabled(enabled) { settings.enabled = enabled; save(); if (!enabled) Object.keys(loops).forEach(n => this.stopLoop(n, 0.4)); },
    setVolume(volume) { settings.volume = volume; save(); if (gain) gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.05); },
    get settings() { return { ...settings }; },
    get loaded() { return Object.keys(buffers); }
  };
}
