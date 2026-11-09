// Synthesized audio for Crunch Rally. No audio files; everything is Web Audio.

export type SfxName =
  | 'countdown' | 'go' | 'hop' | 'tier1' | 'tier2' | 'tier3' | 'miniturbo' | 'boostpad' | 'ramp' | 'trick' | 'land'
  | 'wall' | 'crate' | 'roulette' | 'itemget' | 'throw' | 'drop' | 'hit' | 'blocked' | 'pop' | 'fall' | 'respawn'
  | 'lap' | 'finallap' | 'finish' | 'ability' | 'abilityReady' | 'shield' | 'slowed' | 'click' | 'whoosh';

type Opts = { vol?: number; pitch?: number };

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let masterVol = 0.8;
let muted = false;

// engine nodes
let eng: {
  o1: OscillatorNode; o2: OscillatorNode; lp: BiquadFilterNode; g: GainNode;
  nSrc: AudioBufferSourceNode; nBP: BiquadFilterNode; squeal: GainNode;
  nLP: BiquadFilterNode; rumble: GainNode;
} | null = null;

function applyMaster(): void {
  if (!master || !ctx) return;
  master.gain.setTargetAtTime(muted ? 0 : masterVol, ctx.currentTime, 0.02);
}

function ready(): boolean {
  return !!ctx && !!sfxBus && !muted && ctx.state !== 'closed';
}

function makeNoise(c: AudioContext): AudioBuffer {
  const len = c.sampleRate * 2;
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

// ---- one-shot helpers ----
function tone(
  type: OscillatorType, f0: number, f1: number, t0: number, dur: number, vol: number,
  bus: AudioNode | null = sfxBus, attack = 0.005,
): void {
  if (!ctx || !bus) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(bus);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
  o.onended = () => { o.disconnect(); g.disconnect(); };
}

function noise(
  t0: number, dur: number, vol: number, f0: number, f1: number,
  type: BiquadFilterType = 'bandpass', q = 1, bus: AudioNode | null = sfxBus,
): void {
  if (!ctx || !bus || !noiseBuf) return;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.01, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g).connect(bus);
  s.start(t0, Math.random() * 1.5, dur + 0.02);
  s.onended = () => { s.disconnect(); f.disconnect(); g.disconnect(); };
}

const hz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

function ding(t: number, f: number, vol: number, dur = 0.35): void {
  tone('sine', f, f, t, dur, vol);
  tone('triangle', f * 2, f * 2, t, dur * 0.6, vol * 0.4);
}

function playNow(name: SfxName, o: Opts): void {
  if (!ctx) return;
  const t = ctx.currentTime;
  const v = o.vol ?? 1;
  const p = o.pitch ?? 1;
  switch (name) {
    case 'countdown': tone('square', 440, 440, t, 0.18, 0.22 * v); break;
    case 'go':
      tone('square', 880, 880, t, 0.5, 0.22 * v);
      tone('triangle', 1760, 1760, t, 0.4, 0.12 * v);
      break;
    case 'hop': tone('sine', 300, 600, t, 0.12, 0.25 * v); break;
    case 'tier1': ding(t, 988 * p, 0.25 * v); break;
    case 'tier2': ding(t, 1319 * p, 0.27 * v); ding(t + 0.07, 1568 * p, 0.2 * v, 0.3); break;
    case 'tier3':
      ding(t, 1568 * p, 0.27 * v);
      ding(t + 0.07, 1976 * p, 0.25 * v);
      ding(t + 0.14, 2637 * p, 0.25 * v, 0.45);
      break;
    case 'miniturbo': {
      const s = 0.6 + 0.4 * (o.pitch ?? 1);
      noise(t, 0.45, 0.35 * v * s, 600, 4000, 'bandpass', 1.2);
      tone('sawtooth', 200, 900 * Math.max(0.6, p), t, 0.4, 0.14 * v * s);
      break;
    }
    case 'boostpad':
      noise(t, 0.5, 0.3 * v, 500, 5000, 'bandpass', 1);
      tone('square', 330, 1100, t, 0.4, 0.12 * v);
      break;
    case 'ramp': tone('sine', 250, 900, t, 0.3, 0.25 * v); noise(t, 0.25, 0.12 * v, 800, 3000); break;
    case 'trick':
      [0, 4, 7, 12].forEach((n, i) => tone('triangle', hz(72 + n), hz(72 + n), t + i * 0.05, 0.18, 0.2 * v));
      break;
    case 'land':
      tone('sine', 140, 50, t, 0.18, 0.4 * v);
      noise(t, 0.12, 0.2 * v, 400, 150, 'lowpass');
      break;
    case 'wall':
      tone('square', 120, 60, t, 0.14, 0.25 * v);
      noise(t, 0.12, 0.3 * v, 1200, 300, 'bandpass', 0.8);
      break;
    case 'crate':
      noise(t, 0.2, 0.35 * v, 3000, 800, 'bandpass', 0.7);
      tone('square', 600, 300, t, 0.1, 0.12 * v);
      break;
    case 'roulette': tone('square', 1200 * p, 1200 * p, t, 0.03, 0.12 * v, sfxBus, 0.002); break;
    case 'itemget':
      [0, 4, 7].forEach((n, i) => tone('square', hz(76 + n), hz(76 + n), t + i * 0.06, 0.12, 0.14 * v));
      break;
    case 'throw':
      noise(t, 0.18, 0.28 * v, 2500, 600, 'bandpass', 1.5);
      tone('sine', 500, 250, t, 0.12, 0.15 * v);
      break;
    case 'drop': tone('sine', 400, 120, t, 0.15, 0.3 * v); break;
    case 'hit':
      tone('square', 220, 90, t, 0.12, 0.35 * v);
      tone('triangle', 500, 120, t + 0.1, 0.5, 0.25 * v);
      if (ctx) {
        // wobble via second oscillator detune LFO-like steps
        for (let i = 1; i <= 4; i++) tone('sine', 300 - i * 30, 250 - i * 30, t + 0.1 + i * 0.07, 0.07, 0.08 * v);
      }
      break;
    case 'blocked':
      tone('square', 800, 800, t, 0.05, 0.2 * v);
      tone('square', 600, 600, t + 0.05, 0.08, 0.2 * v);
      break;
    case 'pop':
      for (let i = 0; i < 5; i++) noise(t + i * 0.035 + Math.random() * 0.02, 0.03, 0.3 * v, 1500 + Math.random() * 3000, 800, 'bandpass', 3);
      tone('sine', 700, 300, t, 0.06, 0.15 * v);
      break;
    case 'fall': tone('sine', 900, 80, t, 0.9, 0.25 * v); break;
    case 'respawn':
      [0, 7, 12, 16].forEach((n, i) => tone('triangle', hz(67 + n), hz(67 + n), t + i * 0.07, 0.2, 0.2 * v));
      break;
    case 'lap':
      ding(t, 1319, 0.25 * v); ding(t + 0.1, 1760, 0.25 * v, 0.4);
      break;
    case 'finallap':
      [0, 4, 7, 12].forEach((n, i) => tone('square', hz(72 + n), hz(72 + n), t + i * 0.09, 0.18, 0.15 * v));
      ding(t + 0.4, 2093, 0.2 * v, 0.6);
      break;
    case 'finish': {
      const seq: [number, number][] = [[0, 0], [4, 0.14], [7, 0.28], [12, 0.42], [7, 0.62], [12, 0.76]];
      seq.forEach(([n, d], i) => {
        const dur = i === seq.length - 1 ? 0.7 : 0.16;
        tone('square', hz(67 + n), hz(67 + n), t + d, dur, 0.16 * v);
        tone('triangle', hz(55 + n), hz(55 + n), t + d, dur, 0.18 * v);
      });
      break;
    }
    case 'ability':
      [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => tone('triangle', hz(72 + n), hz(72 + n), t + i * 0.05, 0.2, 0.18 * v));
      break;
    case 'abilityReady':
      ding(t, 1568, 0.2 * v, 0.25); ding(t + 0.09, 2093, 0.2 * v, 0.35);
      break;
    case 'shield':
      tone('sine', 400, 900, t, 0.25, 0.2 * v);
      tone('triangle', 1200, 1200, t + 0.1, 0.3, 0.1 * v);
      break;
    case 'slowed':
      tone('sawtooth', 400, 100, t, 0.5, 0.15 * v);
      break;
    case 'click': tone('square', 900, 900, t, 0.03, 0.12 * v, sfxBus, 0.002); break;
    case 'whoosh': noise(t, 0.3, 0.25 * v, 400 * p, 3000 * p, 'bandpass', 1); break;
  }
}

// ---- engine ----
function ensureEngine(): void {
  if (!ctx || !sfxBus || !noiseBuf || eng) return;
  const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
  const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 55.8;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; lp.Q.value = 2;
  const g = ctx.createGain(); g.gain.value = 0;
  o1.connect(lp); o2.connect(lp); lp.connect(g).connect(sfxBus);
  const nSrc = ctx.createBufferSource(); nSrc.buffer = noiseBuf; nSrc.loop = true;
  const nBP = ctx.createBiquadFilter(); nBP.type = 'bandpass'; nBP.frequency.value = 2600; nBP.Q.value = 4;
  const squeal = ctx.createGain(); squeal.gain.value = 0;
  const nLP = ctx.createBiquadFilter(); nLP.type = 'lowpass'; nLP.frequency.value = 180;
  const rumble = ctx.createGain(); rumble.gain.value = 0;
  nSrc.connect(nBP).connect(squeal).connect(sfxBus);
  nSrc.connect(nLP).connect(rumble).connect(sfxBus);
  o1.start(); o2.start(); nSrc.start();
  eng = { o1, o2, lp, g, nSrc, nBP, squeal, nLP, rumble };
}

function destroyEngine(): void {
  if (!eng) return;
  const e = eng;
  eng = null;
  try { e.o1.stop(); e.o2.stop(); e.nSrc.stop(); } catch { /* ignore */ }
  [e.o1, e.o2, e.lp, e.g, e.nSrc, e.nBP, e.squeal, e.nLP, e.rumble].forEach((n) => { try { n.disconnect(); } catch { /* ignore */ } });
}

// ---- music ----
// 16 bars of 4/4 at 130 bpm, 8th-note grid (128 steps). Chords: C, Am, F, G repeating (4 bars each phrase x2 w/ variation).
const BPM = 130;
const STEP = 60 / BPM / 2;
const ROOTS = [48, 45, 41, 43]; // C3 A2 F2 G2
const CHORDS = [[0, 4, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7]]; // semitones above root (arpeggio tones)
const MELODY: number[][] = [ // per 8-bar phrase of 4 chords: scale degrees as semitone offsets from C5(72), -1 = rest
  [0, -1, 4, 7, 4, -1, 7, 9, 7, 4, 2, 4, 0, -1, -1, -1],
  [9, -1, 9, 7, 9, 12, 9, 7, 5, 7, 9, 5, 4, -1, 2, -1],
  [5, -1, 9, 12, 9, -1, 12, 14, 12, 9, 7, 9, 5, -1, -1, -1],
  [7, 11, 14, 11, 7, 11, 14, 11, 12, 11, 9, 7, 7, -1, -1, -1],
];
const TOTAL_STEPS = 128;

let musicOn = false;
let musicTimer: ReturnType<typeof setInterval> | null = null;
let nextStepTime = 0;
let stepIdx = 0;

function scheduleStep(i: number, t: number): void {
  const bar = Math.floor(i / 8);          // 0..15
  const inBar = i % 8;
  const chordIdx = bar % 4;
  const root = ROOTS[chordIdx];
  // bass: root on 1, 5th-ish octave pattern
  const bassPat = [0, -1, 12, -1, 0, -1, 7, -1];
  if (bassPat[inBar] >= 0) tone('triangle', hz(root + bassPat[inBar]), hz(root + bassPat[inBar]), t, STEP * 1.6, 0.35, musicBus, 0.005);
  // lead: 16 steps per 2 bars; bars 8..15 use melody an octave variation
  const phrase = Math.floor(bar / 2) % 4;
  const m = MELODY[phrase][(bar % 2) * 8 + inBar];
  if (m >= 0) {
    const n = 72 + m + (bar >= 8 ? 0 : 0);
    tone('square', hz(n), hz(n), t, STEP * 0.9, 0.12, musicBus, 0.004);
  }
  // arpeggio shimmer on off-beats
  if (inBar % 2 === 1) {
    const a = root + 24 + CHORDS[chordIdx][(inBar >> 1) % 3];
    tone('square', hz(a), hz(a), t, STEP * 0.5, 0.04, musicBus, 0.003);
  }
  // drums
  if (inBar === 0 || inBar === 4) tone('sine', 150, 45, t, 0.14, 0.5, musicBus, 0.002);
  if (inBar === 2 || inBar === 6) noise(t, 0.09, 0.22, 2500, 1800, 'highpass', 0.7, musicBus);
  else noise(t, 0.025, 0.08, 7000, 7000, 'highpass', 0.7, musicBus);
}

function musicTick(): void {
  if (!ctx || !musicOn) return;
  while (nextStepTime < ctx.currentTime + 0.25) {
    if (nextStepTime >= ctx.currentTime - 0.05) scheduleStep(stepIdx, nextStepTime);
    nextStepTime += STEP;
    stepIdx = (stepIdx + 1) % TOTAL_STEPS;
  }
}

function startMusic(): void {
  if (!ctx || musicTimer !== null) return;
  nextStepTime = ctx.currentTime + 0.1;
  stepIdx = 0;
  musicTick();
  musicTimer = setInterval(musicTick, 80);
}

function stopMusic(): void {
  if (musicTimer !== null) { clearInterval(musicTimer); musicTimer = null; }
}

export const sfx = {
  unlock(): void {
    if (typeof window === 'undefined') return;
    try {
      if (!ctx) {
        const AC: typeof AudioContext | undefined =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        master = ctx.createGain();
        sfxBus = ctx.createGain();
        musicBus = ctx.createGain();
        sfxBus.gain.value = 1;
        musicBus.gain.value = 0.22;
        sfxBus.connect(master);
        musicBus.connect(master);
        master.connect(comp).connect(ctx.destination);
        noiseBuf = makeNoise(ctx);
        applyMaster();
        if (musicOn) startMusic();
      }
      if (ctx.state === 'suspended') void ctx.resume().catch(() => { /* ignore */ });
    } catch {
      ctx = null; master = null; sfxBus = null; musicBus = null;
    }
  },

  setVolume(v: number): void {
    masterVol = Math.max(0, Math.min(1, v));
    applyMaster();
  },

  get muted(): boolean { return muted; },
  set muted(m: boolean) { muted = m; applyMaster(); },

  engine(speed01: number, throttle: number, drifting: boolean, boosting: boolean, offroad: boolean): void {
    if (!ready()) return;
    ensureEngine();
    if (!eng || !ctx) return;
    const t = ctx.currentTime;
    const s = Math.max(0, Math.min(1, speed01));
    const th = Math.max(0, Math.min(1, throttle));
    const f = 55 + s * 135 + (boosting ? 25 : 0);
    eng.o1.frequency.setTargetAtTime(f, t, 0.05);
    eng.o2.frequency.setTargetAtTime(f * 1.012, t, 0.05);
    eng.lp.frequency.setTargetAtTime(300 + s * 900 + th * 400 + (boosting ? 400 : 0), t, 0.06);
    eng.g.gain.setTargetAtTime(0.05 + th * 0.07 + s * 0.04, t, 0.08);
    eng.squeal.gain.setTargetAtTime(drifting ? 0.07 : 0, t, 0.04);
    eng.nBP.frequency.setTargetAtTime(2200 + s * 1200, t, 0.1);
    eng.rumble.gain.setTargetAtTime(offroad ? 0.25 : 0, t, 0.08);
  },

  stopEngine(): void {
    if (!eng || !ctx) return;
    const t = ctx.currentTime;
    eng.g.gain.setTargetAtTime(0, t, 0.08);
    eng.squeal.gain.setTargetAtTime(0, t, 0.08);
    eng.rumble.gain.setTargetAtTime(0, t, 0.08);
    const e = eng;
    setTimeout(() => { if (eng === e) destroyEngine(); }, 500);
  },

  play(name: SfxName, opts?: Opts): void {
    if (!ready()) return;
    try { playNow(name, opts ?? {}); } catch { /* ignore */ }
  },

  music(on: boolean): void {
    musicOn = on;
    if (on) startMusic(); else stopMusic();
  },
};
