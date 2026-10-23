// Synthesized sound effects (Web Audio, no audio files).
// Browsers only allow audio after a user gesture, so main.js calls unlock()
// from the first pointer or key event.

let ctx = null;
let master = null;
let enabled = true;
let noiseBuffer = null;

function audio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

export function setSoundEnabled(on) {
  enabled = on;
}

export function unlock() {
  if (!enabled) return;
  const ac = audio();
  if (ac?.state === 'suspended') ac.resume();
}

function ready() {
  if (!enabled) return null;
  const ac = audio();
  if (!ac || ac.state !== 'running') return null;
  return ac;
}

function tone(ac, { freq, to = freq, type = 'sine', at = 0, dur = 0.12, gain = 0.2 }) {
  const t = ac.currentTime + at;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(ac, { at = 0, dur = 0.08, gain = 0.25, freq = 1800, to = freq, q = 0.8 }) {
  const t = ac.currentTime + at;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, t);
  if (to !== freq) filter.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

const notes = (ac, freqs, { step = 0.09, type = 'triangle', dur = 0.16, gain = 0.16 } = {}) =>
  freqs.forEach((freq, i) => tone(ac, { freq, type, at: i * step, dur, gain }));

const EFFECTS = {
  // A card slapped onto the pile.
  play: (ac) => {
    noise(ac, { dur: 0.05, gain: 0.35, freq: 2200 });
    tone(ac, { freq: 160, to: 90, type: 'triangle', dur: 0.08, gain: 0.18 });
  },
  // A card slid off the deck.
  draw: (ac) => noise(ac, { dur: 0.16, gain: 0.18, freq: 900, to: 3800, q: 1.2 }),
  action: (ac) => {
    EFFECTS.play(ac);
    tone(ac, { freq: 440, to: 660, type: 'square', at: 0.04, dur: 0.12, gain: 0.05 });
  },
  wild: (ac) => {
    EFFECTS.play(ac);
    notes(ac, [523, 659, 784, 1047], { step: 0.05, dur: 0.12, gain: 0.08 });
  },
  last: (ac) => notes(ac, [880, 1175], { step: 0.11, type: 'sine', dur: 0.3, gain: 0.2 }),
  penalty: (ac) => tone(ac, { freq: 220, to: 110, type: 'sawtooth', dur: 0.35, gain: 0.08 }),
  turn: (ac) => tone(ac, { freq: 740, type: 'sine', dur: 0.12, gain: 0.08 }),
  win: (ac) => notes(ac, [523, 659, 784, 1047, 1319], { step: 0.1, dur: 0.28, gain: 0.14 }),
  lose: (ac) => notes(ac, [392, 330, 262], { step: 0.14, type: 'sine', dur: 0.3, gain: 0.12 }),
};

export function playSound(name) {
  const ac = ready();
  if (ac && EFFECTS[name]) EFFECTS[name](ac);
}
