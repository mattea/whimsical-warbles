/**
 * Synth voices for the Cosmic Radio genre engine.
 *
 * Every sound here is generated from oscillators and one shared noise buffer —
 * there are no samples anywhere on the site. Each function schedules a short
 * self-contained node graph at an absolute AudioContext time and tears itself
 * down on `ended`, so the engine never has to track individual voices beyond
 * registering them for a hard stop on pause.
 *
 * The drum voices follow the classic analogue recipes:
 *   kick  — a sine with a fast downward pitch sweep (≈160 Hz → 48 Hz)
 *   snare — filtered noise plus a short tuned "body" tone
 *   hat   — high-passed noise, very short (closed) or ringing (open)
 *   clap  — three noise bursts a few ms apart through a band-pass
 * These are what make a genre legible: for a casual listener the drum pattern
 * carries more genre information than the harmony does.
 */

export interface VoiceEnv {
  ctx: AudioContext;
  /** Where this voice routes — usually the sidechained music bus or the drum bus. */
  dest: AudioNode;
  /** Shared white-noise buffer (generated once per engine). */
  noise: AudioBuffer;
  /** Register a source so the engine can hard-stop it on teardown. */
  register: (node: AudioScheduledSourceNode) => void;
}

/** One second of white noise, reused by every percussion hit. */
export function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * A soft-clipping curve for the rock/dubstep distortion stages.
 * tanh saturates smoothly instead of hard-clipping, so it adds harmonics
 * without the harsh aliasing buzz of a fold-back curve.
 */
export function makeDistortionCurve(amount: number, samples = 2048): Float32Array<ArrayBuffer> {
  // Back the array with an explicit ArrayBuffer so the type matches
  // WaveShaperNode.curve exactly (it rejects SharedArrayBuffer-backed views).
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  const k = Math.max(0.0001, amount);
  const norm = Math.tanh(k);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

/** Start a noise source and register it. */
function noiseSource(env: VoiceEnv, time: number, dur: number): AudioBufferSourceNode {
  const src = env.ctx.createBufferSource();
  src.buffer = env.noise;
  // Start at a random offset so repeated hits aren't bit-identical.
  const offset = Math.random() * Math.max(0, env.noise.duration - dur - 0.01);
  src.start(time, offset, dur + 0.02);
  env.register(src);
  return src;
}

/** Exponential decay envelope from `peak` down to silence. */
function decayEnv(ctx: AudioContext, time: number, peak: number, decay: number, attack = 0.003): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
  return g;
}

/* ---- Percussion --------------------------------------------------------- */

export interface KickOpts {
  peak?: number;
  /** Where the pitch sweep starts (Hz) — higher is clickier. */
  startHz?: number;
  /** Where it lands (Hz) — lower is deeper/808-ier. */
  endHz?: number;
  /** How fast the pitch falls (s). */
  pitchDecay?: number;
  /** Amplitude decay (s). 0.3 ≈ house, 0.8 ≈ 808 boom. */
  decay?: number;
}

export function kick(env: VoiceEnv, time: number, o: KickOpts = {}): void {
  const { ctx } = env;
  const peak = o.peak ?? 0.9;
  const startHz = o.startHz ?? 160;
  const endHz = o.endHz ?? 48;
  const pitchDecay = o.pitchDecay ?? 0.055;
  const decay = o.decay ?? 0.32;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(startHz, time);
  osc.frequency.exponentialRampToValueAtTime(endHz, time + pitchDecay);

  const g = decayEnv(ctx, time, peak, decay, 0.004);
  osc.connect(g);
  g.connect(env.dest);
  osc.start(time);
  osc.stop(time + decay + 0.08);
  env.register(osc);
  osc.onended = () => {
    try { osc.disconnect(); g.disconnect(); } catch { /* gone */ }
  };
}

export interface SnareOpts {
  peak?: number;
  decay?: number;
  /** Band-pass centre for the noise (Hz). */
  tone?: number;
  /** Tuned body under the noise (Hz); 0 disables it. */
  bodyHz?: number;
}

export function snare(env: VoiceEnv, time: number, o: SnareOpts = {}): void {
  const { ctx } = env;
  const peak = o.peak ?? 0.5;
  const decay = o.decay ?? 0.18;
  const tone = o.tone ?? 1800;
  const bodyHz = o.bodyHz ?? 180;

  // Noise "crack" through a band-pass.
  const src = noiseSource(env, time, decay + 0.05);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(tone, time);
  bp.Q.setValueAtTime(0.8, time);
  const ng = decayEnv(ctx, time, peak, decay);
  src.connect(bp); bp.connect(ng); ng.connect(env.dest);
  src.onended = () => {
    try { src.disconnect(); bp.disconnect(); ng.disconnect(); } catch { /* gone */ }
  };

  // Short tuned body so it reads as a drum, not just a hiss.
  if (bodyHz > 0) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(bodyHz, time);
    osc.frequency.exponentialRampToValueAtTime(bodyHz * 0.6, time + 0.09);
    const bg = decayEnv(ctx, time, peak * 0.55, 0.09);
    osc.connect(bg); bg.connect(env.dest);
    osc.start(time);
    osc.stop(time + 0.16);
    env.register(osc);
    osc.onended = () => {
      try { osc.disconnect(); bg.disconnect(); } catch { /* gone */ }
    };
  }
}

export function hat(env: VoiceEnv, time: number, open = false, peak = 0.22): void {
  const { ctx } = env;
  const decay = open ? 0.26 : 0.042;
  const src = noiseSource(env, time, decay + 0.05);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(7200, time);
  const g = decayEnv(ctx, time, peak, decay, 0.002);
  src.connect(hp); hp.connect(g); g.connect(env.dest);
  src.onended = () => {
    try { src.disconnect(); hp.disconnect(); g.disconnect(); } catch { /* gone */ }
  };
}

export function clap(env: VoiceEnv, time: number, peak = 0.4): void {
  const { ctx } = env;
  // Three tight bursts then a slightly longer tail — the classic 909 clap.
  const offsets = [0, 0.011, 0.023];
  for (const off of offsets) {
    const src = noiseSource(env, time + off, 0.05);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1250, time + off);
    bp.Q.setValueAtTime(1.2, time + off);
    const g = decayEnv(ctx, time + off, peak, 0.035, 0.001);
    src.connect(bp); bp.connect(g); g.connect(env.dest);
    src.onended = () => {
      try { src.disconnect(); bp.disconnect(); g.disconnect(); } catch { /* gone */ }
    };
  }
  const tail = noiseSource(env, time + 0.023, 0.14);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(1100, time);
  bp.Q.setValueAtTime(1.0, time);
  const g = decayEnv(ctx, time + 0.023, peak * 0.55, 0.12, 0.002);
  tail.connect(bp); bp.connect(g); g.connect(env.dest);
  tail.onended = () => {
    try { tail.disconnect(); bp.disconnect(); g.disconnect(); } catch { /* gone */ }
  };
}

/** A filtered noise sweep upward — the "we are about to drop" riser. */
export function riser(env: VoiceEnv, time: number, dur: number, peak = 0.18): void {
  const { ctx } = env;
  const src = noiseSource(env, time, dur + 0.05);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.setValueAtTime(3, time);
  bp.frequency.setValueAtTime(400, time);
  bp.frequency.exponentialRampToValueAtTime(6000, time + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(peak, time + dur * 0.9);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  src.connect(bp); bp.connect(g); g.connect(env.dest);
  src.onended = () => {
    try { src.disconnect(); bp.disconnect(); g.disconnect(); } catch { /* gone */ }
  };
}

/* ---- Pitched voices ----------------------------------------------------- */

export type Wave = OscillatorType;

export interface ToneOpts {
  wave?: Wave;
  peak?: number;
  attack?: number;
  /** Total sounding length in seconds. */
  dur: number;
  /** Release portion of `dur` spent fading out. */
  release?: number;
  /** Optional low-pass with an envelope: [startHz, endHz, Q]. */
  filter?: [number, number, number];
  /** Detune spread in cents across `voices` oscillators (supersaw). */
  detune?: number;
  voices?: number;
  /** Soft-clip amount; 0 disables the waveshaper. */
  drive?: number;
}

/**
 * A general pitched voice: one or more detuned oscillators through an optional
 * filter envelope and optional soft clipping. This one function covers plucks,
 * pads, supersaw stabs, chiptune leads and distorted power chords — the
 * differences between those are all envelope and filter settings.
 */
export function tone(env: VoiceEnv, time: number, hz: number, o: ToneOpts): void {
  const { ctx } = env;
  const wave = o.wave ?? 'sawtooth';
  const peak = o.peak ?? 0.2;
  const attack = o.attack ?? 0.008;
  const dur = o.dur;
  const release = o.release ?? Math.min(0.25, dur * 0.5);
  const nVoices = Math.max(1, o.voices ?? 1);
  const detune = o.detune ?? 0;

  let node: AudioNode;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, time);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + attack);
  // Hold, then fall away over the release.
  amp.gain.setValueAtTime(Math.max(0.0002, peak), time + Math.max(attack, dur - release));
  amp.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  node = amp;

  // Optional soft clipping (rock power chords, gritty bass).
  if (o.drive && o.drive > 0) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDistortionCurve(o.drive);
    shaper.oversample = '2x';
    amp.connect(shaper);
    node = shaper;
  }

  // Optional low-pass envelope — the single biggest timbral lever.
  if (o.filter) {
    const [f0, f1, q] = o.filter;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.max(40, f0), time);
    lp.frequency.exponentialRampToValueAtTime(Math.max(40, f1), time + dur);
    lp.Q.setValueAtTime(q, time);
    node.connect(lp);
    node = lp;
  }
  node.connect(env.dest);

  const oscs: OscillatorNode[] = [];
  for (let i = 0; i < nVoices; i++) {
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(hz, time);
    if (detune !== 0 && nVoices > 1) {
      // Spread voices evenly across ±detune cents.
      const spread = (i / (nVoices - 1)) * 2 - 1;
      osc.detune.setValueAtTime(spread * detune, time);
    }
    osc.connect(amp);
    osc.start(time);
    osc.stop(time + dur + 0.05);
    env.register(osc);
    oscs.push(osc);
  }
  // Clean up once the last oscillator finishes.
  const last = oscs[oscs.length - 1];
  last.onended = () => {
    try {
      oscs.forEach((o2) => o2.disconnect());
      amp.disconnect();
      if (node !== amp) node.disconnect();
    } catch { /* gone */ }
  };
}

export interface WobbleOpts {
  dur: number;
  peak?: number;
  /** LFO rate in Hz — the engine derives this from the tempo. */
  lfoHz: number;
  /** Filter sweep floor and ceiling (Hz). */
  low?: number;
  high?: number;
  /** Resonance: 8–18 is the classic screaming dubstep range. */
  q?: number;
  drive?: number;
  wave?: Wave;
}

/**
 * The dubstep wobble: detuned saws through a resonant low-pass whose cutoff is
 * driven by an LFO. The LFO is an oscillator whose output is scaled by a gain
 * node and summed into `filter.frequency` — that summing is what makes the
 * cutoff swing between `low` and `high` at `lfoHz`, which is the entire sound.
 */
export function wobbleBass(env: VoiceEnv, time: number, hz: number, o: WobbleOpts): void {
  const { ctx } = env;
  const dur = o.dur;
  const peak = o.peak ?? 0.5;
  const low = o.low ?? 140;
  const high = o.high ?? 2400;
  const q = o.q ?? 12;

  const centre = (low + high) / 2;
  const depth = (high - low) / 2;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(centre, time);
  lp.Q.setValueAtTime(q, time);

  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(o.lfoHz, time);
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.setValueAtTime(depth, time);
  lfo.connect(lfoDepth);
  lfoDepth.connect(lp.frequency); // sums with the .value above
  lfo.start(time);
  lfo.stop(time + dur + 0.05);
  env.register(lfo);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, time);
  amp.gain.exponentialRampToValueAtTime(peak, time + 0.012);
  amp.gain.setValueAtTime(peak, time + Math.max(0.02, dur - 0.06));
  amp.gain.exponentialRampToValueAtTime(0.0001, time + dur);

  let out: AudioNode = lp;
  if (o.drive && o.drive > 0) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDistortionCurve(o.drive);
    shaper.oversample = '2x';
    lp.connect(shaper);
    out = shaper;
  }
  out.connect(amp);
  amp.connect(env.dest);

  const oscs: OscillatorNode[] = [];
  for (let i = 0; i < 2; i++) {
    const osc = ctx.createOscillator();
    osc.type = o.wave ?? 'sawtooth';
    osc.frequency.setValueAtTime(hz, time);
    osc.detune.setValueAtTime(i === 0 ? -8 : 8, time);
    osc.connect(lp);
    osc.start(time);
    osc.stop(time + dur + 0.05);
    env.register(osc);
    oscs.push(osc);
  }
  // A sub sine an octave down keeps the low end solid while the filter screams.
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(hz / 2, time);
  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0.0001, time);
  subGain.gain.exponentialRampToValueAtTime(peak * 0.8, time + 0.012);
  subGain.gain.setValueAtTime(peak * 0.8, time + Math.max(0.02, dur - 0.06));
  subGain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  sub.connect(subGain);
  subGain.connect(env.dest);
  sub.start(time);
  sub.stop(time + dur + 0.05);
  env.register(sub);

  sub.onended = () => {
    try {
      oscs.forEach((o2) => o2.disconnect());
      lfo.disconnect(); lfoDepth.disconnect(); lp.disconnect();
      amp.disconnect(); sub.disconnect(); subGain.disconnect();
      if (out !== lp) out.disconnect();
    } catch { /* gone */ }
  };
}
