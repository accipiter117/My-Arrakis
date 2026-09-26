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
//   (the first two trimmed, faded and loudness-levelled for the game)

const SOUNDS = {
  wormRoar: '../assets/sfx/worm-roar.mp3',
  shipArrival: '../assets/sfx/ship-arrival.mp3',
  ornithopter: '../assets/sfx/ornithopter.mp3?v=2',
  // Phase ambiences: seamless loops (WAV, since MP3 padding leaves a gap on every loop).
  revivalTanks: '../assets/sfx/revival-tanks.wav',
  bidding: '../assets/sfx/bidding.wav',
  shipping: '../assets/sfx/shipping.wav',
  // Turn announcements, played as a faction's turn banner appears.
  'turn-atreides': '../assets/sfx/turn-atreides.mp3'
};
const KEY = 'my-arrakis-sfx';
const MIN_GAP_MS = 700;

export function createSfx({ onPlay } = {}) {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  const settings = { enabled: saved.enabled ?? true, volume: saved.volume ?? 0.8 };
  let ctx = null, gain = null;
  const buffers = {};
  const lastPlayed = {};
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
    play(name) {
      if (!settings.enabled || !ctx || !buffers[name]) return false;
      const now = performance.now();
      if (now - (lastPlayed[name] ?? -Infinity) < MIN_GAP_MS) return false;
      lastPlayed[name] = now;
      if (ctx.state === 'suspended') ctx.resume();
      const source = ctx.createBufferSource();
      source.buffer = buffers[name];
      source.connect(gain);
      source.start();
      onPlay?.(name, buffers[name].duration);
      return true;
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
