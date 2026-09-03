import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, IconButton, Icon } from '@retropolis/ui';
import '../styles/radio.css';

/**
 * Cosmic Radio — a self-contained Web Audio chiptune player.
 *
 * No audio files: every "station" improvises live from OscillatorNodes
 * (square / triangle / sine) fed through a per-note gain envelope, a shared
 * master gain (volume) and a soft low-pass filter so the bleeps stay gentle.
 * A look-ahead scheduler walks a pentatonic scale as a gently-weighted random
 * walk — no fixed loop — so the melody keeps evolving and effectively never
 * repeats, at the same cost as a fixed pattern. Notes are scheduled a little
 * ahead of the audio clock for steady timing.
 *
 * Everything mounts happily with `client:visible`:
 *   - NEVER autoplays. The AudioContext is created/resumed only on the first
 *     user click (browsers require a gesture). Starts paused.
 *   - Last station + volume persist to localStorage (`pugglenaut-radio`) and
 *     restore on mount — but playback stays paused.
 *   - Optional visualizer bars bounce on rAF; under prefers-reduced-motion the
 *     rAF loop is skipped and the bars sit static.
 *   - On pause and on unmount every oscillator is stopped, every node
 *     disconnected, the rAF is cancelled and the AudioContext is closed — no
 *     leaks, no stuck notes.
 *
 * This is an MPA, so navigating away tears the island down and the music stops.
 * That's expected: it's a homepage toy, not a site-wide jukebox.
 */

/* ---- Music theory: gentle pentatonic scales ----------------------------- */
/* Frequencies (Hz) for a pleasant, never-dissonant palette. Each station picks
   notes from its own pentatonic scale, so wrong notes are impossible. Rather
   than replaying a fixed loop, the sequencer walks the scale procedurally (a
   gently-weighted random walk), so the music keeps evolving and effectively
   never repeats — same cost as before, just different notes each step. */

type Wave = 'square' | 'triangle' | 'sine';

interface Station {
  id: string;
  name: string;
  blurb: string;
  /** Oscillator wave(s). If several, one is picked per note for variety. */
  waves: Wave[];
  /** Beats per minute — kept slow-ish for background listening. */
  bpm: number;
  /** Steps per beat (the rhythmic grid). */
  subdiv: number;
  /** Scale note frequencies (Hz), spanning ~2–3 octaves for melodic room. */
  scale: number[];
  /** Note length as a fraction of a beat (>1 sustains across steps → pads). */
  sustain: number;
  /** Master tint for this station's readout + bars. */
  tint: string;
  /** Cutoff (Hz) of the shared low-pass — lower = mellower. */
  cutoff: number;

  /* --- Generative behavior (the "personality" of the random walk) --- */
  /** Chance each step is a rest (silence). */
  restProb: number;
  /** Scale index the melody drifts back toward. */
  home: number;
  /** 0–1: how strongly each step is pulled toward `home`. */
  gravity: number;
  /** Chance of a bigger jump instead of a small stepwise move. */
  leapProb: number;
  /** Largest leap (in scale steps). */
  leapMax: number;
  /** Chance of layering a harmony note under the melody note. */
  harmonyProb: number;
  /** Harmony interval, in scale steps (2 ≈ a third in a pentatonic). */
  harmonyOffset: number;
  /** Per-note gain peak (loudness before the master volume). */
  peak: number;
}

// A minor pentatonic (A C D E G), A3→A5.
const A_PENTA = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];
// C major pentatonic (C D E G A), C4→C6 — brighter, "lounge"-y.
const C_PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
// G major pentatonic (G A B D E), G3→E5 — a cozy "snack break" palette.
const SNACK = [196.0, 220.0, 246.94, 293.66, 329.63, 392.0, 440.0, 493.88, 587.33, 659.25];
// A minor pentatonic across THREE octaves (A2→E6) — wide room for big leaps.
const DICE = [
  110.0, 130.81, 146.83, 164.81, 196.0, 220.0, 261.63, 293.66, 329.63, 392.0,
  440.0, 523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1318.51,
];

const STATIONS: Station[] = [
  {
    id: 'orbit-fm',
    name: 'Orbit FM',
    blurb: 'Steady little arpeggios drifting in low orbit.',
    waves: ['triangle'],
    bpm: 104,
    subdiv: 2,
    scale: A_PENTA,
    sustain: 0.85,
    tint: 'var(--rp-teal)',
    cutoff: 1800,
    restProb: 0.14,
    home: 4,
    gravity: 0.35,
    leapProb: 0.12,
    leapMax: 3,
    harmonyProb: 0,
    harmonyOffset: 2,
    peak: 0.26,
  },
  {
    id: 'nebula-lounge',
    name: 'Nebula Lounge',
    blurb: 'Warm, slow chords for floating and thinking.',
    waves: ['sine'],
    bpm: 72,
    subdiv: 1,
    scale: C_PENTA,
    sustain: 2.6, // long, overlapping → a pad
    tint: 'var(--rp-violet-400)',
    cutoff: 1200,
    restProb: 0.34,
    home: 4,
    gravity: 0.5,
    leapProb: 0.08,
    leapMax: 2,
    harmonyProb: 0.5, // soft floating chords
    harmonyOffset: 2,
    peak: 0.2,
  },
  {
    id: 'snack-break',
    name: 'Snack Break',
    blurb: 'A bouncy jingle for the puggle snack cabinet.',
    waves: ['square'],
    bpm: 120,
    subdiv: 2,
    scale: SNACK,
    sustain: 0.6,
    tint: 'var(--rp-sunshine)',
    cutoff: 1600,
    restProb: 0.22,
    home: 3,
    gravity: 0.3,
    leapProb: 0.18,
    leapMax: 4,
    harmonyProb: 0.08,
    harmonyOffset: 2,
    peak: 0.22,
  },
  {
    id: 'roll-dice',
    name: 'Roll the Dice',
    blurb: 'Pure improvisation — three octaves, never the same twice.',
    waves: ['triangle', 'square', 'sine'], // a fresh timbre per note
    bpm: 108,
    subdiv: 2,
    scale: DICE,
    sustain: 0.8,
    tint: 'var(--rp-magenta)',
    cutoff: 1900,
    restProb: 0.2,
    home: 7,
    gravity: 0.22,
    leapProb: 0.36, // lots of octave-hopping
    leapMax: 7,
    harmonyProb: 0.24, // occasional stacked notes
    harmonyOffset: 2,
    peak: 0.22,
  },
];

const STORAGE_KEY = 'pugglenaut-radio';
const NUM_BARS = 7;

interface Persisted {
  stationIndex: number;
  volume: number;
}

function readPersisted(): Persisted {
  const fallback: Persisted = { stationIndex: 0, volume: 0.25 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    const idx =
      typeof parsed.stationIndex === 'number' &&
      parsed.stationIndex >= 0 &&
      parsed.stationIndex < STATIONS.length
        ? parsed.stationIndex
        : 0;
    const vol =
      typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1
        ? parsed.volume
        : 0.25;
    return { stationIndex: idx, volume: vol };
  } catch {
    return fallback;
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/* A tiny, fast seeded PRNG (mulberry32). Seeding it fresh at each Play means
   every listening session improvises a different melody, while staying a pure
   function of the seed — cheap and dependency-free. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function CosmicRadio() {
  const initial = typeof window !== 'undefined' ? readPersisted() : { stationIndex: 0, volume: 0.25 };

  const [stationIndex, setStationIndex] = useState(initial.stationIndex);
  const [volume, setVolume] = useState(initial.volume);
  const [playing, setPlaying] = useState(false);
  // Static heights for the reduced-motion / paused visualizer.
  const [bars, setBars] = useState<number[]>(() => Array(NUM_BARS).fill(0.15));

  const station = STATIONS[stationIndex];

  /* ---- Web Audio graph (all held in refs; never in React state) --------- */
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const filterRef = useRef<BiquadFilterNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  // Oscillators currently sounding, so we can hard-stop them on teardown.
  const liveOscRef = useRef<Set<OscillatorNode>>(new Set());
  const schedulerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  // Current position in the scale (the random walk's state) + its RNG.
  const idxRef = useRef(0);
  const rngRef = useRef<() => number>(() => Math.random());
  const nextNoteTimeRef = useRef(0);

  // Keep the latest station/volume reachable from the scheduler closure.
  const stationRef = useRef(station);
  stationRef.current = station;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  const reduced = typeof window !== 'undefined' ? prefersReducedMotion() : false;

  /* ---- Persist on change ------------------------------------------------ */
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ stationIndex, volume } satisfies Persisted),
      );
    } catch {
      /* storage may be unavailable (private mode) — ignore. */
    }
  }, [stationIndex, volume]);

  /* ---- Live volume: ramp the master gain smoothly ----------------------- */
  useEffect(() => {
    const master = masterRef.current;
    const ctx = ctxRef.current;
    if (master && ctx) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(volume, ctx.currentTime, 0.03);
    }
  }, [volume]);

  /* ---- Schedule one note ------------------------------------------------ */
  const scheduleNote = useCallback((time: number) => {
    const ctx = ctxRef.current;
    const filter = filterRef.current;
    if (!ctx || !filter) return;

    const st = stationRef.current;
    const rng = rngRef.current;
    const secondsPerBeat = 60 / st.bpm;
    const noteLen = secondsPerBeat * st.sustain;

    // Spawn one voice at a given scale index. Shared by melody + harmony.
    const voice = (scaleIdx: number, gainPeak: number) => {
      const freq = st.scale[Math.max(0, Math.min(st.scale.length - 1, scaleIdx))];
      const osc = ctx.createOscillator();
      // Pick a timbre; single-wave stations just always use their one wave.
      osc.type = st.waves[Math.floor(rng() * st.waves.length)] ?? st.waves[0];
      osc.frequency.setValueAtTime(freq, time);

      const env = ctx.createGain();
      // Gentle pluck envelope: quick soft attack, smooth decay to silence.
      env.gain.setValueAtTime(0.0001, time);
      env.gain.exponentialRampToValueAtTime(gainPeak, time + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, time + noteLen);

      osc.connect(env);
      env.connect(filter);
      osc.start(time);
      osc.stop(time + noteLen + 0.05);

      liveOscRef.current.add(osc);
      osc.onended = () => {
        try {
          osc.disconnect();
          env.disconnect();
        } catch {
          /* already gone */
        }
        liveOscRef.current.delete(osc);
      };
    };

    // Rest? Leave a gap but keep the walk's position where it is.
    if (rng() < st.restProb) return;

    // --- Advance the random walk to the next scale index ---
    let move: number;
    if (rng() < st.leapProb) {
      // A bigger jump (octave-hopping personality).
      const dir = rng() < 0.5 ? -1 : 1;
      move = dir * (1 + Math.floor(rng() * st.leapMax));
    } else {
      // A small, mostly-stepwise wander (favor ±1, sometimes ±2 or hold).
      const r = rng();
      move = r < 0.42 ? -1 : r < 0.84 ? 1 : r < 0.92 ? -2 : r < 0.98 ? 2 : 0;
    }
    // Gentle gravity back toward home so the melody never wanders off forever.
    if (rng() < st.gravity) {
      move += Math.sign(st.home - idxRef.current);
    }

    let idx = idxRef.current + move;
    // Reflect off the edges instead of clamping, so we don't stick to a rail.
    const top = st.scale.length - 1;
    if (idx < 0) idx = -idx;
    if (idx > top) idx = top - (idx - top);
    idx = Math.max(0, Math.min(top, idx));
    idxRef.current = idx;

    voice(idx, st.peak);
    // Occasional harmony a pentatonic "third" above, softer than the melody.
    if (st.harmonyProb > 0 && rng() < st.harmonyProb) {
      voice(idx + st.harmonyOffset, st.peak * 0.62);
    }
  }, []);

  /* ---- Look-ahead scheduler loop ---------------------------------------- */
  const runScheduler = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const st = stationRef.current;
    const secondsPerBeat = 60 / st.bpm;
    const stepDur = secondsPerBeat / st.subdiv; // rhythmic grid per station

    // Schedule everything due within the next 100ms.
    while (nextNoteTimeRef.current < ctx.currentTime + 0.1) {
      scheduleNote(nextNoteTimeRef.current);
      nextNoteTimeRef.current += stepDur;
    }
    schedulerRef.current = window.setTimeout(runScheduler, 25);
  }, [scheduleNote]);

  /* ---- Visualizer ------------------------------------------------------- */
  const runVisualizer = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    const step = Math.floor(data.length / NUM_BARS) || 1;
    const next: number[] = [];
    for (let i = 0; i < NUM_BARS; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) sum += data[i * step + j] ?? 0;
      const avg = sum / step / 255;
      next.push(Math.max(0.08, Math.min(1, avg * 1.6)));
    }
    setBars(next);
    rafRef.current = requestAnimationFrame(runVisualizer);
  }, []);

  /* ---- Build the audio graph on demand ---------------------------------- */
  const ensureGraph = useCallback(() => {
    if (ctxRef.current) return ctxRef.current;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();

    const master = ctx.createGain();
    master.gain.setValueAtTime(volumeRef.current, ctx.currentTime);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(stationRef.current.cutoff, ctx.currentTime);
    filter.Q.setValueAtTime(0.7, ctx.currentTime);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.8;

    // filter -> analyser -> master -> speakers
    filter.connect(analyser);
    analyser.connect(master);
    master.connect(ctx.destination);

    ctxRef.current = ctx;
    masterRef.current = master;
    filterRef.current = filter;
    analyserRef.current = analyser;
    return ctx;
  }, []);

  /* ---- Stop everything (used by pause + unmount + station switch) ------- */
  const teardownAudio = useCallback(() => {
    if (schedulerRef.current !== null) {
      clearTimeout(schedulerRef.current);
      schedulerRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    // Hard-stop any oscillators still sounding, so no note gets stuck.
    liveOscRef.current.forEach((osc) => {
      try {
        osc.onended = null;
        osc.stop();
        osc.disconnect();
      } catch {
        /* already stopped */
      }
    });
    liveOscRef.current.clear();

    const ctx = ctxRef.current;
    if (ctx) {
      try {
        masterRef.current?.disconnect();
        filterRef.current?.disconnect();
        analyserRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      if (ctx.state !== 'closed') {
        void ctx.close().catch(() => {});
      }
    }
    ctxRef.current = null;
    masterRef.current = null;
    filterRef.current = null;
    analyserRef.current = null;
    idxRef.current = 0;
    setBars(Array(NUM_BARS).fill(0.15));
  }, []);

  /* ---- Start playback (only ever from a user gesture) ------------------- */
  const startPlayback = useCallback(async () => {
    const ctx = ensureGraph();
    // Set the master to the current volume immediately.
    masterRef.current?.gain.setValueAtTime(volumeRef.current, ctx.currentTime);
    filterRef.current?.frequency.setValueAtTime(stationRef.current.cutoff, ctx.currentTime);
    try {
      if (ctx.state === 'suspended') await ctx.resume();
    } catch {
      /* resume can reject if the gesture was lost — bail gracefully */
    }
    // Fresh improvisation every time Play is pressed.
    rngRef.current = mulberry32((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    idxRef.current = stationRef.current.home;
    nextNoteTimeRef.current = ctx.currentTime + 0.08;
    runScheduler();
    if (!reduced) {
      rafRef.current = requestAnimationFrame(runVisualizer);
    } else {
      // Static-but-present bars so the visualizer still reads as "on".
      setBars(Array.from({ length: NUM_BARS }, (_, i) => 0.35 + (i % 3) * 0.15));
    }
  }, [ensureGraph, runScheduler, runVisualizer, reduced]);

  const togglePlay = useCallback(() => {
    setPlaying((wasPlaying) => {
      if (wasPlaying) {
        teardownAudio();
        return false;
      }
      void startPlayback();
      return true;
    });
  }, [startPlayback, teardownAudio]);

  /* ---- Switch station --------------------------------------------------- */
  const changeStation = useCallback(
    (nextIndex: number) => {
      const wrapped = (nextIndex + STATIONS.length) % STATIONS.length;
      setStationIndex(wrapped);
      // If we're playing, restart the graph cleanly on the new station.
      setPlaying((wasPlaying) => {
        if (wasPlaying) {
          teardownAudio();
          // stationRef updates on the next render; nudge it now so the
          // restarted graph uses the new station immediately.
          stationRef.current = STATIONS[wrapped];
          void startPlayback();
          return true;
        }
        return false;
      });
    },
    [startPlayback, teardownAudio],
  );

  const prevStation = useCallback(() => changeStation(stationIndex - 1), [changeStation, stationIndex]);
  const nextStation = useCallback(() => changeStation(stationIndex + 1), [changeStation, stationIndex]);

  /* ---- Unmount: tear the whole graph down ------------------------------- */
  useEffect(() => {
    return () => {
      teardownAudio();
    };
  }, [teardownAudio]);

  /* ---- Render ----------------------------------------------------------- */
  return (
    <section className="pg-radio" aria-label="Cosmic Radio chiptune player">
      <div className="pg-radio-chassis">
        <div className="pg-radio-top">
          <span className="pg-radio-brand">
            <Icon name="music" size={18} />
            Cosmic Radio
          </span>
          <span className={`pg-radio-led${playing ? ' is-on' : ''}`} aria-hidden="true" />
        </div>

        {/* Now-playing readout doubles as a live region. */}
        <div
          className="pg-radio-display"
          style={{ ['--pg-radio-tint' as string]: station.tint }}
        >
          <div className="pg-radio-visualizer" aria-hidden="true">
            {bars.map((h, i) => (
              <span
                key={i}
                className="pg-radio-bar"
                style={{ height: `${Math.round(h * 100)}%` }}
              />
            ))}
          </div>
          <div className="pg-radio-nowplaying" aria-live="polite">
            <span className="pg-radio-label">
              {playing ? 'Now playing' : 'Paused'}
            </span>
            <span className="pg-radio-station">{station.name}</span>
            <span className="pg-radio-blurb">{station.blurb}</span>
          </div>
        </div>

        {/* Transport controls */}
        <div className="pg-radio-transport">
          <IconButton
            icon="play"
            label="Previous station"
            variant="secondary"
            size="sm"
            onClick={prevStation}
            className="pg-radio-flip"
          />
          <IconButton
            icon={playing ? 'pause' : 'play'}
            label={playing ? 'Pause radio' : 'Play radio'}
            variant="primary"
            size="md"
            onClick={togglePlay}
          />
          <IconButton
            icon="play"
            label="Next station"
            variant="secondary"
            size="sm"
            onClick={nextStation}
          />
        </div>

        {/* Volume */}
        <div className="pg-radio-volume">
          <Icon name="music" size={14} title="Volume" />
          <input
            className="pg-radio-slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            aria-label="Radio volume"
            onChange={(e) => setVolume(Number(e.currentTarget.value))}
          />
          <span className="pg-radio-vol-num" aria-hidden="true">
            {Math.round(volume * 100)}
          </span>
        </div>

        {/* Station picker as chips */}
        <div className="pg-radio-stations" role="group" aria-label="Stations">
          {STATIONS.map((s, i) => (
            <Button
              key={s.id}
              size="sm"
              variant={i === stationIndex ? 'sunshine' : 'ghost'}
              onClick={() => changeStation(i)}
              aria-pressed={i === stationIndex}
            >
              {s.name}
            </Button>
          ))}
        </div>
      </div>
    </section>
  );
}
