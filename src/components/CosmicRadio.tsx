import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, IconButton, Icon } from '@retropolis/ui';
import '../styles/radio.css';

/**
 * Cosmic Radio — a self-contained Web Audio chiptune player.
 *
 * No audio files: every "station" is a short looping procedural sequence
 * synthesized live from OscillatorNodes (square / triangle / sine) fed through
 * a per-note gain envelope, a shared master gain (volume) and a soft low-pass
 * filter so the bleeps stay gentle. A tiny step sequencer walks a pentatonic
 * scale, scheduling notes a little ahead of the audio clock for steady timing.
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
/* Frequencies (Hz) for a pleasant, never-dissonant palette. Each station
   picks notes from its own scale so wrong notes are impossible. */

type Wave = 'square' | 'triangle' | 'sine';

interface Station {
  id: string;
  name: string;
  blurb: string;
  wave: Wave;
  /** Beats per minute — kept slow-ish for background listening. */
  bpm: number;
  /** Scale note frequencies (Hz). */
  scale: number[];
  /** Step pattern: index into `scale`, or null for a rest. */
  pattern: (number | null)[];
  /** Master tint for this station's readout + bars. */
  tint: string;
  /** Cutoff (Hz) of the shared low-pass — lower = mellower. */
  cutoff: number;
}

// A minor pentatonic around A (A C D E G) across a couple of octaves.
const A_PENTA = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33];
// C major pentatonic (C D E G A) — brighter, "lounge"-y.
const C_PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
// A lower, sparse set for a cozy "snack break" jingle.
const SNACK = [196.0, 246.94, 293.66, 329.63, 392.0, 493.88];

const STATIONS: Station[] = [
  {
    id: 'orbit-fm',
    name: 'Orbit FM',
    blurb: 'Steady little arpeggios drifting in low orbit.',
    wave: 'triangle',
    bpm: 104,
    scale: A_PENTA,
    // A gently rolling arpeggio with breathing rests.
    pattern: [0, 2, 4, 2, 5, 4, 2, null, 0, 2, 4, 5, 6, 5, 4, null],
    tint: 'var(--rp-teal)',
    cutoff: 1800,
  },
  {
    id: 'nebula-lounge',
    name: 'Nebula Lounge',
    blurb: 'Warm, slow chords for floating and thinking.',
    wave: 'sine',
    bpm: 76,
    scale: C_PENTA,
    // Sparse, held-feeling notes — lots of space between them.
    pattern: [0, null, 3, null, 4, null, 2, null, 5, null, 4, null, 3, null, 2, null],
    tint: 'var(--rp-violet-400)',
    cutoff: 1300,
  },
  {
    id: 'snack-break',
    name: 'Snack Break',
    blurb: 'A bouncy jingle for the puggle snack cabinet.',
    wave: 'square',
    bpm: 120,
    scale: SNACK,
    // Playful bleeps — squares kept soft via a low cutoff + gentle gain.
    pattern: [0, 2, 4, 3, 2, 4, 5, 4, 0, 2, 3, 2, 4, 3, 1, null],
    tint: 'var(--rp-sunshine)',
    cutoff: 1500,
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
  const stepRef = useRef(0);
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
    const step = stepRef.current % st.pattern.length;
    const slot = st.pattern[step];

    if (slot !== null) {
      const freq = st.scale[slot];
      const secondsPerBeat = 60 / st.bpm;
      // Each pattern step is an eighth-ish note; keep them short & soft.
      const noteLen = secondsPerBeat * 0.9;

      const osc = ctx.createOscillator();
      osc.type = st.wave;
      osc.frequency.setValueAtTime(freq, time);

      const env = ctx.createGain();
      // Gentle pluck envelope: quick soft attack, smooth decay to silence.
      const peak = 0.28;
      env.gain.setValueAtTime(0.0001, time);
      env.gain.exponentialRampToValueAtTime(peak, time + 0.02);
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
    }

    stepRef.current += 1;
  }, []);

  /* ---- Look-ahead scheduler loop ---------------------------------------- */
  const runScheduler = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const st = stationRef.current;
    const secondsPerBeat = 60 / st.bpm;
    const stepDur = secondsPerBeat / 2; // two steps per beat

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
    stepRef.current = 0;
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
    stepRef.current = 0;
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
