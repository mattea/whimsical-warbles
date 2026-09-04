/**
 * The Cosmic Radio playback engine.
 *
 * One look-ahead scheduler drives both station families. Notes are scheduled a
 * little ahead of the AudioContext clock (which is sample-accurate) rather than
 * fired from timers (which are not), so timing stays tight even when the main
 * thread is busy.
 *
 * Signal path:
 *
 *     drum voices  ─────────────────────────┐
 *                                           ├─→ master low-pass → analyser
 *     pitched voices → duck (sidechain) ────┘         → master gain → out
 *
 * Drums bypass the duck so the kick itself never ducks; everything pitched goes
 * through it, which is what produces the EDM "pump".
 */

import {
  chordTones,
  midiToHz,
  nearestChordTone,
  scaleDegree,
} from './theory';
import {
  clap,
  hat,
  kick,
  makeNoiseBuffer,
  riser,
  snare,
  tone,
  wobbleBass,
  type VoiceEnv,
} from './voices';
import type { GenreStation, Station, Track, WalkStation } from './stations';

/** Seeded PRNG (mulberry32) — cheap, and reseeded on every Play. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Look-ahead window and polling interval for the scheduler. */
const LOOKAHEAD_S = 0.12;
const TICK_MS = 25;
/** Hard ceiling on simultaneously-scheduled sources, to protect weak devices. */
const MAX_VOICES = 220;

interface TrackState {
  /** Arpeggio cursor. */
  i: number;
  /** Ping-pong direction for arpUpDown. */
  dir: number;
  /** Current scale degree for `walk` picks. */
  deg: number;
}

export class RadioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private duck: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private mix: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private noise: AudioBuffer | null = null;

  private live = new Set<AudioScheduledSourceNode>();
  private timer: number | null = null;

  private station: Station | null = null;
  private rng: () => number = Math.random;
  private nextTime = 0;
  private step = 0;
  private trackStates: TrackState[] = [];
  /** Walk-station melodic position (index into its Hz scale). */
  private walkIdx = 0;

  get analyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  get isRunning(): boolean {
    return this.ctx !== null;
  }

  /** The current station's output trim (1 for the classic stations). */
  private stationMix(): number {
    const st = this.station;
    if (!st || st.kind !== 'genre') return 1;
    return st.mix ?? 1;
  }

  /** Build the graph. Must be called from a user gesture. */
  private ensureGraph(volume: number): AudioContext {
    if (this.ctx) return this.ctx;
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();

    const master = ctx.createGain();
    master.gain.setValueAtTime(volume, ctx.currentTime);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(this.station?.cutoff ?? 6000, ctx.currentTime);
    filter.Q.setValueAtTime(0.7, ctx.currentTime);

    const duck = ctx.createGain();
    duck.gain.setValueAtTime(1, ctx.currentTime);

    // Per-station output trim. A dense genre mix is far louder than the sparse
    // ambient stations, so each station declares a `mix` to bring them into
    // roughly the same loudness range — otherwise switching stations is a
    // 14 dB jump in the listener's ears.
    const mix = ctx.createGain();
    mix.gain.setValueAtTime(this.stationMix(), ctx.currentTime);

    // Safety limiter. Stacked supersaws, a driven wobble and a kick can easily
    // sum past full scale; without this the mix clips and the distortion is
    // the ugly digital kind. Sitting before the volume control keeps the
    // balance identical at every volume setting.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.setValueAtTime(-6, ctx.currentTime);
    limiter.knee.setValueAtTime(4, ctx.currentTime);
    limiter.ratio.setValueAtTime(20, ctx.currentTime);
    // A 1 ms attack is needed to actually catch a kick transient; at 3 ms the
    // leading edge slips through and the output can still pass full scale.
    limiter.attack.setValueAtTime(0.001, ctx.currentTime);
    limiter.release.setValueAtTime(0.12, ctx.currentTime);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.8;

    // duck → filter → analyser → volume → limiter → out.
    // The limiter sits LAST so it protects the actual output at any volume;
    // putting it before the volume control would let a high setting push the
    // mix past full scale again. The analyser sits before the volume control
    // so the visualizer reads the mix, not the listening level.
    duck.connect(filter);
    filter.connect(mix);
    mix.connect(analyser);
    analyser.connect(master);
    master.connect(limiter);
    limiter.connect(ctx.destination);

    this.ctx = ctx;
    this.master = master;
    this.filter = filter;
    this.duck = duck;
    this.limiter = limiter;
    this.mix = mix;
    this.analyserNode = analyser;
    this.noise = makeNoiseBuffer(ctx);
    return ctx;
  }

  async start(station: Station, volume: number): Promise<void> {
    this.station = station;
    const ctx = this.ensureGraph(volume);
    this.master?.gain.setValueAtTime(volume, ctx.currentTime);
    this.mix?.gain.setValueAtTime(this.stationMix(), ctx.currentTime);
    this.filter?.frequency.setValueAtTime(station.cutoff, ctx.currentTime);
    try {
      if (ctx.state === 'suspended') await ctx.resume();
    } catch {
      /* the gesture may have been lost — fail quietly */
    }
    this.rng = mulberry32((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    this.step = 0;
    this.trackStates =
      station.kind === 'genre'
        ? station.tracks.map(() => ({ i: 0, dir: 1, deg: 0 }))
        : [];
    this.walkIdx = station.kind === 'walk' ? station.home : 0;
    this.nextTime = ctx.currentTime + 0.1;
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.live.forEach((n) => {
      try {
        n.onended = null;
        n.stop();
        n.disconnect();
      } catch {
        /* already stopped */
      }
    });
    this.live.clear();
    const ctx = this.ctx;
    if (ctx) {
      try {
        this.duck?.disconnect();
        this.filter?.disconnect();
        this.limiter?.disconnect();
        this.mix?.disconnect();
        this.analyserNode?.disconnect();
        this.master?.disconnect();
      } catch {
        /* ignore */
      }
      if (ctx.state !== 'closed') void ctx.close().catch(() => {});
    }
    this.ctx = null;
    this.master = null;
    this.filter = null;
    this.duck = null;
    this.limiter = null;
    this.mix = null;
    this.analyserNode = null;
    this.noise = null;
    this.step = 0;
  }

  setVolume(v: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(v, ctx.currentTime, 0.03);
  }

  /* ---- Scheduling ------------------------------------------------------- */

  private tick = (): void => {
    const ctx = this.ctx;
    const st = this.station;
    if (!ctx || !st) return;

    const stepDur =
      st.kind === 'walk'
        ? 60 / st.bpm / st.subdiv
        : 60 / st.bpm / 4; // genre grid is always sixteenths

    while (this.nextTime < ctx.currentTime + LOOKAHEAD_S) {
      if (st.kind === 'walk') this.walkStep(st, this.nextTime);
      else this.genreStep(st, this.nextTime, stepDur);
      this.step += 1;
      this.nextTime += stepDur;
    }
    this.timer = window.setTimeout(this.tick, TICK_MS);
  };

  private env(dest: AudioNode): VoiceEnv {
    return {
      ctx: this.ctx as AudioContext,
      dest,
      noise: this.noise as AudioBuffer,
      register: (n) => {
        this.live.add(n);
        const prev = n.onended;
        n.onended = (e) => {
          this.live.delete(n);
          if (typeof prev === 'function') prev.call(n, e);
        };
      },
    };
  }

  /* ---- The original random-walk stations (behaviour preserved) ---------- */

  private walkStep(st: WalkStation, time: number): void {
    const ctx = this.ctx;
    const duck = this.duck;
    if (!ctx || !duck) return;
    const rng = this.rng;
    const secondsPerBeat = 60 / st.bpm;
    const noteLen = secondsPerBeat * st.sustain;

    const voice = (scaleIdx: number, gainPeak: number) => {
      const freq = st.scale[Math.max(0, Math.min(st.scale.length - 1, scaleIdx))];
      const osc = ctx.createOscillator();
      osc.type = (st.waves[Math.floor(rng() * st.waves.length)] ?? st.waves[0]) as OscillatorType;
      osc.frequency.setValueAtTime(freq, time);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(gainPeak, time + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, time + noteLen);
      osc.connect(g);
      g.connect(duck);
      osc.start(time);
      osc.stop(time + noteLen + 0.05);
      this.live.add(osc);
      osc.onended = () => {
        this.live.delete(osc);
        try { osc.disconnect(); g.disconnect(); } catch { /* gone */ }
      };
    };

    if (rng() < st.restProb) return;

    let move: number;
    if (rng() < st.leapProb) {
      const dir = rng() < 0.5 ? -1 : 1;
      move = dir * (1 + Math.floor(rng() * st.leapMax));
    } else {
      const r = rng();
      move = r < 0.42 ? -1 : r < 0.84 ? 1 : r < 0.92 ? -2 : r < 0.98 ? 2 : 0;
    }
    if (rng() < st.gravity) move += Math.sign(st.home - this.walkIdx);

    let idx = this.walkIdx + move;
    const top = st.scale.length - 1;
    if (idx < 0) idx = -idx;
    if (idx > top) idx = top - (idx - top);
    idx = Math.max(0, Math.min(top, idx));
    this.walkIdx = idx;

    voice(idx, st.peak);
    if (st.harmonyProb > 0 && rng() < st.harmonyProb) {
      voice(idx + st.harmonyOffset, st.peak * 0.62);
    }
  }

  /* ---- The multi-track genre engine ------------------------------------- */

  private genreStep(st: GenreStation, rawTime: number, stepDur: number): void {
    const ctx = this.ctx;
    const duck = this.duck;
    const filter = this.filter;
    if (!ctx || !duck || !filter) return;
    const rng = this.rng;

    const stepInBar = this.step % 16;
    const bar = Math.floor(this.step / 16);
    const cycleBar = bar % st.cycleBars;
    const lastBar = cycleBar === st.cycleBars - 1;

    // Shuffle: push the odd sixteenths late. This is the whole of "swing".
    const swing = st.swing ?? 0;
    const time = swing > 0 && stepInBar % 2 === 1 ? rawTime + stepDur * swing : rawTime;

    const chord = st.progression[bar % st.progression.length];
    const tones = chordTones(st.key, st.scale, chord);
    const secondsPerBeat = 60 / st.bpm;

    // Drums bypass the duck; pitched voices go through it.
    const drumEnv = this.env(filter);
    const musicEnv = this.env(duck);
    const crowded = this.live.size > MAX_VOICES;

    st.tracks.forEach((track, ti) => {
      const from = track.from ?? 0;
      const to = track.to ?? st.cycleBars - 1;
      if (cycleBar < from || cycleBar > to) return;

      const pattern = lastBar && track.fill ? track.fill : track.steps;
      const p = pattern[stepInBar] ?? 0;
      if (p <= 0) return;
      // Probabilities below 1 make ghost notes and variation possible.
      if (p < 1 && rng() > p) return;

      switch (track.type) {
        case 'kick': {
          kick(drumEnv, time, {
            peak: track.peak, startHz: track.startHz, endHz: track.endHz,
            decay: track.decay, pitchDecay: track.pitchDecay,
          });
          // Duck everything pitched — the sidechain pump.
          const depth = st.sidechain ?? 0;
          if (depth > 0) {
            const recover = Math.min(0.3, secondsPerBeat * 0.85);
            duck.gain.cancelScheduledValues(time);
            duck.gain.setValueAtTime(Math.max(0.02, 1 - depth), time);
            duck.gain.linearRampToValueAtTime(1, time + recover);
          }
          break;
        }
        case 'snare':
          snare(drumEnv, time, {
            peak: track.peak, decay: track.decay, tone: track.tone, bodyHz: track.bodyHz,
          });
          break;
        case 'hat':
          hat(drumEnv, time, (track.open ?? []).includes(stepInBar), track.peak ?? 0.2);
          break;
        case 'clap':
          clap(drumEnv, time, track.peak ?? 0.4);
          break;
        case 'riser':
          riser(drumEnv, time, secondsPerBeat * 4 * (track.bars ?? 1), track.peak ?? 0.18);
          break;
        case 'wobble': {
          if (crowded) break;
          const st2 = this.trackStates[ti];
          const rate = track.rates[bar % track.rates.length];
          // Rate is in notes-per-beat; convert to an LFO frequency in Hz.
          const lfoHz = (st.bpm / 60) * rate;
          const midi = this.pickPitch(track, tones, st, st2, stepInBar, rng);
          wobbleBass(musicEnv, time, midiToHz(midi), {
            dur: stepDur * (track.len ?? 4),
            lfoHz,
            low: track.low, high: track.high, q: track.q,
            drive: track.drive, peak: track.peak ?? 0.4,
          });
          break;
        }
        case 'tone': {
          if (crowded) break;
          const st2 = this.trackStates[ti];
          const dur = stepDur * (track.len ?? 2);
          const common = {
            dur,
            wave: track.wave ?? 'sawtooth',
            peak: track.peak ?? 0.2,
            attack: track.attack,
            filter: track.filter,
            detune: track.detune,
            voices: track.voices,
            drive: track.drive,
          };
          if (track.pick === 'chord') {
            // Play the whole chord. Slightly lower per-note gain so stacking
            // four voices doesn't overshoot the mix.
            const oct = (track.octave ?? 0) * 12;
            tones.forEach((t) => tone(musicEnv, time, midiToHz(t + oct), common));
          } else {
            const midi = this.pickPitch(track, tones, st, st2, stepInBar, rng);
            tone(musicEnv, time, midiToHz(midi), common);
          }
          break;
        }
      }
    });
  }

  /**
   * Choose a pitch for a pitched track against the current chord.
   *
   * `walk` is the interesting one: on strong beats it snaps to the nearest
   * chord tone, and between them it wanders by step through the scale. That
   * combination is what makes a generated line sound like it is following the
   * harmony rather than merely avoiding wrong notes.
   */
  private pickPitch(
    track: Extract<Track, { type: 'tone' | 'wobble' }>,
    tones: number[],
    st: GenreStation,
    state: TrackState,
    stepInBar: number,
    rng: () => number,
  ): number {
    const oct = (track.octave ?? 0) * 12;
    switch (track.pick ?? 'root') {
      case 'root':
        return tones[0] + oct;
      case 'rootFifth': {
        const n = tones.length > 1 ? tones[state.i % 2 === 0 ? 0 : 1] : tones[0];
        state.i += 1;
        return n + oct;
      }
      case 'arpUp': {
        const n = tones[state.i % tones.length];
        state.i += 1;
        return n + oct;
      }
      case 'arpDown': {
        const n = tones[(tones.length - 1 - (state.i % tones.length))];
        state.i += 1;
        return n + oct;
      }
      case 'arpUpDown': {
        const n = tones[state.i];
        state.i += state.dir;
        if (state.i >= tones.length) { state.i = Math.max(0, tones.length - 2); state.dir = -1; }
        if (state.i < 0) { state.i = Math.min(1, tones.length - 1); state.dir = 1; }
        return (n ?? tones[0]) + oct;
      }
      case 'walk':
      default: {
        const strong = stepInBar % 4 === 0;
        if (strong) {
          // Snap onto the harmony.
          const current = st.key + scaleDegree(st.scale, state.deg) + oct;
          const snapped = nearestChordTone(tones.map((t) => t + oct), current);
          // Re-derive an approximate degree so the next wander starts from here.
          state.deg = Math.round(((snapped - oct - st.key) / 12) * st.scale.length);
          return snapped;
        }
        const r = rng();
        state.deg += r < 0.4 ? 1 : r < 0.8 ? -1 : r < 0.9 ? 2 : -2;
        // Keep the line inside a comfortable two-octave window.
        if (state.deg > st.scale.length * 2) state.deg -= st.scale.length;
        if (state.deg < -st.scale.length) state.deg += st.scale.length;
        return st.key + scaleDegree(st.scale, state.deg) + oct;
      }
    }
  }
}
