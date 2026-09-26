// ui/music.js
//
// The score: plays the tracks in order, then cycles, for as long as the
// game is open. Phones block audio until the player touches the page, so
// start() is called from a tap. Audio runs through a Web Audio gain node
// because iOS ignores the volume of a plain <audio> element; that also
// gives smooth fades between tracks and when the tab is hidden.

const TRACKS = [
  { title: 'Yah-Lama-Yah', src: '../assets/music/yah-lama-yah.m4a' },
  { title: 'The Vast Sands', src: '../assets/music/the-vast-sands.m4a' }
];
const KEY = 'my-arrakis-music';
const FADE = 1.2; // seconds

export function createMusic({ onChange } = {}) {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  const settings = { enabled: saved.enabled ?? true, volume: saved.volume ?? 0.6 };
  const audio = new Audio();
  audio.preload = 'auto';
  let index = 0;
  let ctx = null, gain = null, started = false;

  const save = () => localStorage.setItem(KEY, JSON.stringify(settings));
  const notify = () => onChange?.({ ...settings, playing: started && !audio.paused, title: TRACKS[index].title });

  function ensureGraph() {
    if (ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return; // very old browsers: plain audio, no fades
    ctx = new Ctx();
    gain = ctx.createGain();
    gain.gain.value = 0;
    ctx.createMediaElementSource(audio).connect(gain).connect(ctx.destination);
  }

  function rampTo(value, seconds = FADE) {
    if (!gain) { audio.volume = value; return; }
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(value, now + seconds);
  }

  function load(i) {
    index = (i + TRACKS.length) % TRACKS.length;
    audio.src = new URL(TRACKS[index].src, import.meta.url).href;
  }

  async function play() {
    if (!settings.enabled) return;
    try {
      if (ctx?.state === 'suspended') await ctx.resume();
      await audio.play();
      rampTo(settings.volume);
    } catch (err) {
      console.warn('Music could not start yet', err); // e.g. no tap yet
    }
    notify();
  }

  // Next track when one ends; the playlist cycles.
  audio.addEventListener('ended', () => { load(index + 1); play(); });

  // Be polite: fade out and pause when the tab is hidden, resume on return.
  document.addEventListener('visibilitychange', () => {
    if (!started || !settings.enabled) return;
    if (document.hidden) { rampTo(0, 0.4); setTimeout(() => audio.pause(), 450); }
    else play();
  });

  load(0);

  return {
    tracks: TRACKS,
    // Call from a user tap: phones only allow audio to start from one.
    start() {
      if (started) return;
      started = true;
      ensureGraph();
      play();
    },
    setEnabled(enabled) {
      settings.enabled = enabled;
      save();
      if (enabled) { if (!started) { started = true; ensureGraph(); } play(); }
      else { rampTo(0, 0.5); setTimeout(() => { audio.pause(); notify(); }, 550); }
      notify();
    },
    setVolume(volume) {
      settings.volume = volume;
      save();
      if (started && settings.enabled) rampTo(volume, 0.15);
      notify();
    },
    // Dip the score briefly so a loud effect cuts through.
    duck(seconds = 3) {
      if (!started || !settings.enabled || !gain) return;
      rampTo(settings.volume * 0.3, 0.25);
      clearTimeout(this._duck);
      this._duck = setTimeout(() => rampTo(settings.volume, 1.0), seconds * 1000);
    },
    skip() {
      rampTo(0, 0.4);
      setTimeout(() => { load(index + 1); if (started) play(); else notify(); }, 420);
    },
    get settings() { return { ...settings }; },
    get title() { return TRACKS[index].title; },
    get element() { return audio; } // for debug-mode tests
  };
}
