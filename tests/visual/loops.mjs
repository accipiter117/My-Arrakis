// tests/visual/loops.mjs
//
// The phase loops repeat without a gap or click. For each loop the game plays (the files
// ui/sfx.js loads first), decoded the way the game decodes it (decodeLoop in ui/sfx.js)
// for a 44.1 kHz and a 48 kHz device, in the browser's own audio engine:
//   - no silence at the start or end (a gap at the loop point);
//   - the join is no sharper than the sound itself: each sample is predicted from the two
//     before it (carrying on the same slope), and the miss at the join must be within the
//     sound's own ordinary misses (a click is a sudden break in the waveform's direction);
//   - looped playback (rendered offline) runs straight from the last sample into the first.
//
//   node tests/visual/loops.mjs

import { launch, startServer, sleep } from './harness.mjs';

const LOOPS = ['battle.flac?v=2', 'harvest.flac', 'bidding.flac', 'shipping.flac', 'revival-tanks.flac'];

async function main() {
  const server = startServer();
  const browser = await launch();
  const page = await browser.newPage();
  for (let i = 0; i < 40; i++) { try { await page.goto('http://127.0.0.1:8123/?debug=1'); break; } catch { await sleep(250); } }
  // Decoded at 44.1 kHz and at 48 kHz (most phones), since the browser converts every
  // sound to the device's rate as it loads it.
  const results = await page.evaluate(async files => {
    const { decodeLoop } = await import('/ui/sfx.js');
    const out = [];
    for (const deviceRate of [44100, 48000]) for (const f of files) {
      const data = await (await fetch(`/assets/sfx/${f}`)).arrayBuffer();
      const buf = await decodeLoop(new OfflineAudioContext(1, 1, deviceRate), data);
      const n = buf.length, ch = buf.numberOfChannels, rate = buf.sampleRate;
      // Silence at either end (anything under -80 dB counts as silent).
      const quiet = x => Math.abs(x) < 1e-4;
      let lead = 0, tail = 0;
      for (let i = 0; i < n && [...Array(ch).keys()].every(c => quiet(buf.getChannelData(c)[i])); i++) lead++;
      for (let i = n - 1; i >= 0 && [...Array(ch).keys()].every(c => quiet(buf.getChannelData(c)[i])); i--) tail++;
      // The join, against the sound's own 99.9th-percentile miss when carrying on its slope.
      let joinStep = 0; const steps = [];
      const miss = (x, i) => Math.abs(x[(i + n) % n] - (2 * x[(i - 1 + n) % n] - x[(i - 2 + n) % n]));
      for (let c = 0; c < ch; c++) {
        const x = buf.getChannelData(c);
        joinStep = Math.max(joinStep, miss(x, 0), miss(x, 1)); // the first two samples after the join
        for (let i = 2; i < n; i += 7) steps.push(miss(x, i));
      }
      steps.sort((a, b) => a - b);
      const typical = steps[Math.floor(steps.length * 0.999)];
      // Looped playback in the audio engine: 2.5 loops, check the samples around each join.
      const ctx = new OfflineAudioContext(ch, Math.floor(n * 2.5), rate);
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.connect(ctx.destination); src.start();
      const out2 = await ctx.startRendering();
      let maxErr = 0;
      for (let c = 0; c < ch; c++) {
        const y = out2.getChannelData(c), x = buf.getChannelData(c);
        for (const j of [n, 2 * n]) for (let k = -200; k < 200; k++) maxErr = Math.max(maxErr, Math.abs(y[j + k] - x[(j + k + n) % n]));
      }
      out.push({ f: `${f} @ ${deviceRate / 1000} kHz device`, seconds: +(n / rate).toFixed(2), rate, ch, leadMs: +(lead / rate * 1000).toFixed(2), tailMs: +(tail / rate * 1000).toFixed(2), joinStep, typical, maxErr });
    }
    return out;
  }, LOOPS);
  let failed = 0;
  for (const r of results) {
    const ok = r.leadMs < 1 && r.tailMs < 1 && r.joinStep <= r.typical && r.maxErr < 1e-6;
    if (!ok) failed++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${r.f}: ${r.seconds} s, ${r.rate} Hz, ${r.ch} ch; silence at start ${r.leadMs} ms, end ${r.tailMs} ms; ` +
      `break at the join ${r.joinStep.toFixed(4)} (ordinary up to ${r.typical.toFixed(4)}); looped playback off by ${r.maxErr.toExponential(1)}`);
  }
  await browser.close(); server.kill();
  console.log(failed ? `${failed} loop(s) not seamless.` : 'Every loop is seamless.');
  return failed ? 1 : 0;
}

main().then(code => process.exit(code), err => { console.error(err); process.exit(1); });
