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
//   harvest.flac     provided by the project owner (grain scooping loop, Spice Collection; made seamless, raised)
//   battle.flac      provided by the project owner (Battle phase loop; made seamless, levelled, 22.05 kHz)
//   (the phase loops are FLAC, lossless and gap-free; the .wav beside each is a fallback for
//   browsers that cannot decode FLAC)
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
  // Phase ambiences: seamless loops. FLAC is lossless with no padding (MP3 and AAC add
  // silence at the start, a gap on every loop); WAV is the fallback if FLAC won't decode.
  revivalTanks: ['../assets/sfx/revival-tanks.flac', '../assets/sfx/revival-tanks.wav'],
  bidding: ['../assets/sfx/bidding.flac', '../assets/sfx/bidding.wav'],
  shipping: ['../assets/sfx/shipping.flac', '../assets/sfx/shipping.wav'],
  battle: ['../assets/sfx/battle.flac?v=2', '../assets/sfx/battle.wav?v=2'],
  harvest: ['../assets/sfx/harvest.flac', '../assets/sfx/harvest.wav?v=1'],
  cardSlide: '../assets/sfx/card-slide.mp3?v=1',   // a card selected or put out for auction
  cardSlap: '../assets/sfx/card-slap.mp3?v=1',     // a card revealing itself
  wormDelivery: '../assets/sfx/worm-delivery.mp3',
  // Turn announcements, played as a faction's turn banner appears.
  'turn-atreides': '../assets/sfx/turn-atreides.mp3',
  'turn-harkonnen': '../assets/sfx/turn-harkonnen.mp3',
  'turn-gesserit': '../assets/sfx/turn-gesserit.mp3'
};
const LOOPED = new Set(['revivalTanks', 'bidding', 'shipping', 'battle', 'harvest']);
const KEY = 'my-arrakis-sfx';

// A file's own sample rate, from its header (FLAC or WAV), or null.
function sampleRateOf(bytes) {
  const b = new Uint8Array(bytes, 0, Math.min(64, bytes.byteLength));
  const tag = String.fromCharCode(...b.slice(0, 4));
  if (tag === 'fLaC') return (b[18] << 12) | (b[19] << 4) | (b[20] >> 4); // STREAMINFO
  if (tag === 'RIFF') return b[24] | (b[25] << 8) | (b[26] << 16) | (b[27] << 24);
  return null;
}

// A loop for the device's sample rate, without a click at the join. Browsers convert every
// sound to the device's rate as they decode it, treating the file's two ends as hard edges,
// which leaves a kink where the loop joins. So: decode at the file's own rate, play it three
// times round in a silent offline render at the device's rate, and keep the middle round,
// whose ends come from continuous sound. Falls back to an ordinary decode.
export async function decodeLoop(ctx, data) {
  const native = sampleRateOf(data);
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!native || native === ctx.sampleRate || !Offline) return decode(ctx, data);
  const spare = data.slice(0); // decoding uses up the data
  try {
    const raw = await decode(new Offline(1, 1, native), data);
    const len = Math.round(raw.duration * ctx.sampleRate);
    const r = new Offline(raw.numberOfChannels, len * 3, ctx.sampleRate);
    const src = r.createBufferSource();
    src.buffer = raw; src.loop = true; src.connect(r.destination); src.start();
    const done = new Promise(ok => { r.oncomplete = e => ok(e.renderedBuffer); }); // older Safari: no promise from startRendering
    const three = await (r.startRendering() ?? done);
    const out = ctx.createBuffer(raw.numberOfChannels, len, ctx.sampleRate);
    for (let c = 0; c < raw.numberOfChannels; c++) out.getChannelData(c).set(three.getChannelData(c).subarray(len, len * 2));
    return out;
  } catch (err) {
    console.warn('Loop: seamless decode failed, using the plain one', err);
    return decode(ctx, spare);
  }
}
const decode = (ctx, data) => new Promise((ok, fail) => ctx.decodeAudioData(data, ok, fail)); // callback form: older Safari
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

  // Fetches and decodes every sound, trying each file of a sound in turn (FLAC, then WAV).
  // A sound that fails is skipped: the game plays on without it. Listeners hear about each
  // sound once it is settled, loaded or not (see preload), so a loading screen can count
  // them. Runs once.
  let loading = null;
  const settled = new Set(), listeners = new Set(); // sounds finished (loaded or failed), progress listeners
  function ensureContext() {
    if (ctx) return true;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    ctx = new Ctx(); // starts suspended until a tap; decoding works meanwhile
    gain = ctx.createGain();
    gain.gain.value = settings.volume;
    gain.connect(ctx.destination);
    return true;
  }
  function loadAll() {
    if (loading) return loading;
    loading = Promise.all(Object.entries(SOUNDS).map(async ([name, paths]) => {
      for (const path of [].concat(paths)) {
        try {
          const res = await fetch(new URL(path, import.meta.url));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.arrayBuffer();
          buffers[name] = LOOPED.has(name) ? await decodeLoop(ctx, data) : await decode(ctx, data);
          break;
        } catch (err) {
          console.warn(`Could not load sound ${name} from ${path}`, err);
        }
      }
      settled.add(name);
      listeners.forEach(fn => fn(name));
    }));
    return loading;
  }

  return {
    // Call from a user tap.
    unlock() {
      if (!ensureContext()) return;
      if (ctx.state === 'suspended') ctx.resume();
      loadAll();
    },
    // Loading screen: fetch and decode every sound now. Resolves when all are done
    // (failures skipped); onEach(name) after each one.
    preload(onEach = () => {}) {
      if (!ensureContext()) { Object.keys(SOUNDS).forEach(n => onEach(n)); return Promise.resolve(); }
      settled.forEach(n => onEach(n)); // already done before the screen asked
      listeners.add(onEach);
      return loadAll().finally(() => listeners.delete(onEach));
    },
    get count() { return Object.keys(SOUNDS).length; },
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
