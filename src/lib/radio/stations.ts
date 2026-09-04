/**
 * Station definitions for the Cosmic Radio.
 *
 * Two families share one dial:
 *
 *  - `walk` stations are the original four. One melodic voice doing a
 *    gently-weighted random walk over a pentatonic scale. Preserved exactly.
 *
 *  - `genre` stations drive the multi-track engine: a 16th-note grid, a chord
 *    progression advancing one chord per bar, an arrangement that moves through
 *    intro/build/drop sections, and separate percussion and pitched tracks.
 *
 * The genre parameters are deliberately explicit rather than clever. For a
 * casual listener the drum pattern and the tempo carry most of the genre
 * signal, so those are written out step by step where they can be read and
 * tweaked, instead of being derived from something abstract.
 */

import {
  SCALES,
  PROG_EDM_MINOR,
  PROG_POP,
  PROG_ROCK,
  PROG_CLASSICAL,
  PROG_LOFI,
  PROG_BATTLE,
  PROG_OVERWORLD,
  type Chord,
} from './theory';

export type Wave3 = 'square' | 'triangle' | 'sine';

/* ---- The original four (unchanged behaviour) ---------------------------- */

export interface WalkStation {
  kind: 'walk';
  id: string;
  name: string;
  blurb: string;
  waves: Wave3[];
  bpm: number;
  subdiv: number;
  /** Absolute frequencies (Hz) — kept as-is so these stations sound identical. */
  scale: number[];
  sustain: number;
  tint: string;
  cutoff: number;
  restProb: number;
  home: number;
  gravity: number;
  leapProb: number;
  leapMax: number;
  harmonyProb: number;
  harmonyOffset: number;
  peak: number;
}

const A_PENTA = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];
const C_PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
const SNACK = [196.0, 220.0, 246.94, 293.66, 329.63, 392.0, 440.0, 493.88, 587.33, 659.25];
const DICE = [
  110.0, 130.81, 146.83, 164.81, 196.0, 220.0, 261.63, 293.66, 329.63, 392.0,
  440.0, 523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1318.51,
];

export const WALK_STATIONS: WalkStation[] = [
  {
    kind: 'walk', id: 'orbit-fm', name: 'Orbit FM',
    blurb: 'Steady little arpeggios drifting in low orbit.',
    waves: ['triangle'], bpm: 104, subdiv: 2, scale: A_PENTA, sustain: 0.85,
    tint: 'var(--rp-teal)', cutoff: 1800,
    restProb: 0.14, home: 4, gravity: 0.35, leapProb: 0.12, leapMax: 3,
    harmonyProb: 0, harmonyOffset: 2, peak: 0.26,
  },
  {
    kind: 'walk', id: 'nebula-lounge', name: 'Nebula Lounge',
    blurb: 'Warm, slow chords for floating and thinking.',
    waves: ['sine'], bpm: 72, subdiv: 1, scale: C_PENTA, sustain: 2.6,
    tint: 'var(--rp-violet-400)', cutoff: 1200,
    restProb: 0.34, home: 4, gravity: 0.5, leapProb: 0.08, leapMax: 2,
    harmonyProb: 0.5, harmonyOffset: 2, peak: 0.2,
  },
  {
    kind: 'walk', id: 'snack-break', name: 'Snack Break',
    blurb: 'A bouncy jingle for the puggle snack cabinet.',
    waves: ['square'], bpm: 120, subdiv: 2, scale: SNACK, sustain: 0.6,
    tint: 'var(--rp-sunshine)', cutoff: 1600,
    restProb: 0.22, home: 3, gravity: 0.3, leapProb: 0.18, leapMax: 4,
    harmonyProb: 0.08, harmonyOffset: 2, peak: 0.22,
  },
  {
    kind: 'walk', id: 'roll-dice', name: 'Roll the Dice',
    blurb: 'Pure improvisation — three octaves, never the same twice.',
    waves: ['triangle', 'square', 'sine'], bpm: 108, subdiv: 2, scale: DICE, sustain: 0.8,
    tint: 'var(--rp-magenta)', cutoff: 1900,
    restProb: 0.2, home: 7, gravity: 0.22, leapProb: 0.36, leapMax: 7,
    harmonyProb: 0.24, harmonyOffset: 2, peak: 0.22,
  },
];

/* ---- Genre stations ----------------------------------------------------- */

/** How a pitched track chooses its note against the current bar's chord. */
export type Pick =
  | 'root'      // the chord root (bass lines)
  | 'rootFifth' // alternate root and fifth
  | 'chord'     // every chord tone at once (stabs, pads)
  | 'arpUp'     // walk up the chord tones
  | 'arpDown'
  | 'arpUpDown'
  | 'walk';     // melodic wander: chord tones on strong beats, scale in between

interface TrackBase {
  /** First/last bar of the arrangement cycle this track plays in (inclusive). */
  from?: number;
  to?: number;
  /** Sixteen per-step probabilities covering one bar (index 0 = the downbeat). */
  steps: number[];
  /** Replaces `steps` on the final bar of the cycle — drum fills, snare rolls. */
  fill?: number[];
  peak?: number;
}

export interface KickTrack extends TrackBase {
  type: 'kick';
  startHz?: number; endHz?: number; decay?: number; pitchDecay?: number;
}
export interface SnareTrack extends TrackBase {
  type: 'snare';
  tone?: number; decay?: number; bodyHz?: number;
}
export interface HatTrack extends TrackBase {
  type: 'hat';
  /** Steps that ring open instead of closed. */
  open?: number[];
}
export interface ClapTrack extends TrackBase { type: 'clap' }
export interface RiserTrack extends TrackBase {
  type: 'riser';
  /** Length of the sweep, in bars. */
  bars?: number;
}

interface PitchedBase extends TrackBase {
  /** Octave offset applied to the chord root. */
  octave?: number;
  pick?: Pick;
  /** Note length in 16th steps. */
  len?: number;
  wave?: OscillatorType;
  /** Low-pass envelope [startHz, endHz, Q]. */
  filter?: [number, number, number];
  detune?: number;
  voices?: number;
  drive?: number;
  attack?: number;
}

export interface ToneTrack extends PitchedBase { type: 'tone' }

export interface WobbleTrack extends PitchedBase {
  type: 'wobble';
  /** LFO rate per bar of the cycle, as a fraction of a beat.
      2 = eighth-note wobble, 4 = sixteenth-note. Cycles across bars. */
  rates: number[];
  low?: number; high?: number; q?: number;
}

export type Track = KickTrack | SnareTrack | HatTrack | ClapTrack | RiserTrack | ToneTrack | WobbleTrack;

export interface GenreStation {
  kind: 'genre';
  id: string;
  name: string;
  blurb: string;
  tint: string;
  bpm: number;
  /** Root MIDI note of the key (60 = middle C). */
  key: number;
  scale: readonly number[];
  progression: Chord[];
  /** Bars in one arrangement cycle; the progression repeats within it. */
  cycleBars: number;
  tracks: Track[];
  /** Master low-pass cutoff (Hz). */
  cutoff: number;
  /** Sidechain duck depth, 0–1. The EDM "pump"; 0 disables it. */
  sidechain?: number;
  /** Shuffle: fraction of a step that odd 16ths are pushed late (0–0.4). */
  swing?: number;
  /** Output trim (0–1) used to level the stations against each other. */
  mix?: number;
}

// Sixteen-step helpers keep the pattern tables readable.
const X = 1;
const o = 0;

export const GENRE_STATIONS: GenreStation[] = [
  /* ---------------------------------------------------------------- EDM -- */
  {
    kind: 'genre', id: 'neon-drop', name: 'Neon Drop',
    blurb: 'Big-room EDM — four-on-the-floor, supersaws, and a proper drop.',
    tint: 'var(--rp-magenta)', bpm: 128, key: 57 /* A3 */, scale: SCALES.naturalMinor,
    progression: PROG_EDM_MINOR, cycleBars: 16, cutoff: 9000, sidechain: 0.78, mix: 0.55,
    // Arrangement across the 16-bar cycle. The pulse starts immediately —
    // a radio station that withholds its kick for eight bars just reads as
    // broken — and the breakdown/build sits in the middle instead.
    //   bars 0-9   main groove
    //   bars 10-11 breakdown + build (kick drops out, snare roll, riser)
    //   bars 12-15 the drop
    tracks: [
      // Four-on-the-floor: in from the first bar, out for the build.
      { type: 'kick', from: 0, to: 9, steps: [X,o,o,o, X,o,o,o, X,o,o,o, X,o,o,o],
        startHz: 170, endHz: 46, decay: 0.30, peak: 0.9 },
      { type: 'kick', from: 12, to: 15, steps: [X,o,o,o, X,o,o,o, X,o,o,o, X,o,o,o],
        startHz: 170, endHz: 46, decay: 0.30, peak: 0.9 },
      // Claps on 2 and 4.
      { type: 'clap', from: 2, steps: [o,o,o,o, X,o,o,o, o,o,o,o, X,o,o,o], peak: 0.3 },
      // Closed hats on every eighth, open on the offbeats — the house shuffle.
      { type: 'hat', steps: [o,o,X,o, o,o,X,o, o,o,X,o, o,o,X,o],
        open: [2, 6, 10, 14], peak: 0.18 },
      // Driving eighth-note bass, also pulled for the build.
      { type: 'tone', from: 1, to: 9, steps: [X,o,X,o, X,o,X,o, X,o,X,o, X,o,X,o],
        pick: 'root', octave: -1, len: 1.6, wave: 'sawtooth',
        filter: [900, 420, 6], peak: 0.3 },
      { type: 'tone', from: 12, to: 15, steps: [X,o,X,o, X,o,X,o, X,o,X,o, X,o,X,o],
        pick: 'root', octave: -1, len: 1.6, wave: 'sawtooth',
        filter: [900, 420, 6], peak: 0.3 },
      // The supersaw chord stab: seven detuned saws, one hit per bar.
      { type: 'tone', steps: [X,o,o,o, o,o,o,o, o,o,o,o, o,o,o,o],
        pick: 'chord', octave: 1, len: 15, wave: 'sawtooth',
        voices: 7, detune: 22, filter: [1200, 5200, 1], peak: 0.055, attack: 0.03 },
      // Snare roll through the build, then a riser into the drop.
      { type: 'snare', from: 10, to: 11, steps: [X,o,o,o, X,o,o,o, X,o,X,o, X,o,X,X],
        fill: [X,o,X,o, X,o,X,o, X,X,X,X, X,X,X,X], peak: 0.3, decay: 0.11 },
      { type: 'riser', from: 10, to: 10, steps: [X,o,o,o, o,o,o,o, o,o,o,o, o,o,o,o],
        bars: 2, peak: 0.14 },
    ],
  },

  /* ------------------------------------------------------------ dubstep -- */
  {
    kind: 'genre', id: 'bass-cannon', name: 'Bass Cannon',
    blurb: 'Dubstep — half-time drums and a filthy LFO wobble.',
    tint: 'var(--rp-lime)', bpm: 140, key: 54 /* F#3 */, scale: SCALES.naturalMinor,
    progression: [
      { degree: 0, shape: 'min' }, { degree: 0, shape: 'min' },
      { degree: 5, shape: 'maj' }, { degree: 6, shape: 'maj' },
    ],
    cycleBars: 8, cutoff: 9000, sidechain: 0.35, mix: 0.5,
    tracks: [
      // Half-time: kick on 1, snare on 3. At 140 BPM this reads as ~70 —
      // the tempo illusion that defines the genre.
      { type: 'kick', steps: [X,o,o,o, o,o,o,o, o,o,X,o, o,o,o,o],
        startHz: 150, endHz: 40, decay: 0.42, peak: 0.95 },
      { type: 'snare', steps: [o,o,o,o, o,o,o,o, X,o,o,o, o,o,o,o],
        fill: [o,o,o,o, o,o,o,o, X,o,o,X, o,X,o,X], peak: 0.5, decay: 0.2 },
      { type: 'hat', steps: [o,o,X,o, o,X,o,o, o,o,X,o, o,X,o,X], peak: 0.14 },
      // The wobble: one long note per half-bar, LFO rate changing every bar
      // so the pattern never settles into a loop.
      { type: 'wobble', steps: [X,o,o,o, o,o,o,o, X,o,o,o, o,o,o,o],
        rates: [2, 4, 2, 8, 3, 4, 6, 4], pick: 'root', octave: -1, len: 7.5,
        low: 130, high: 2600, q: 13, drive: 3.0, peak: 0.26 },
      // A distant pad so the gaps between wobbles aren't empty.
      { type: 'tone', steps: [X,o,o,o, o,o,o,o, o,o,o,o, o,o,o,o],
        pick: 'chord', octave: 1, len: 15, wave: 'sawtooth',
        voices: 3, detune: 12, filter: [700, 1600, 1], peak: 0.045, attack: 0.4 },
    ],
  },

  /* ---------------------------------------------------------------- DnB -- */
  {
    kind: 'genre', id: 'velocity', name: 'Velocity',
    blurb: 'Drum & bass at 174 — breakbeat, sub bass, permanent forward motion.',
    tint: 'var(--rp-teal)', bpm: 174, key: 52 /* E3 */, scale: SCALES.naturalMinor,
    progression: [
      { degree: 0, shape: 'min7' }, { degree: 5, shape: 'maj7' },
      { degree: 2, shape: 'maj7' }, { degree: 4, shape: 'min7' },
    ],
    cycleBars: 8, cutoff: 9500, sidechain: 0.3, mix: 0.5,
    tracks: [
      // The two-step break: kick on 1 and the "and" of 3, snare on 2 and 4.
      { type: 'kick', steps: [X,o,o,o, o,o,o,o, o,o,X,o, o,o,o,o],
        startHz: 150, endHz: 44, decay: 0.26, peak: 0.9 },
      { type: 'snare', steps: [o,o,o,o, X,o,o,o, o,o,o,o, X,o,o,o],
        fill: [o,o,o,o, X,o,o,X, o,o,X,o, X,o,X,X], peak: 0.5, decay: 0.15 },
      { type: 'hat', steps: [X,o,X,X, o,X,X,o, X,o,X,X, o,X,o,X],
        open: [5, 13], peak: 0.15 },
      // Long sub-bass notes — the genre's whole low end.
      { type: 'tone', steps: [X,o,o,o, o,o,o,X, o,o,o,o, o,o,X,o],
        pick: 'root', octave: -2, len: 4, wave: 'sine', peak: 0.42 },
      // Sparse jazzy stabs over the top.
      { type: 'tone', from: 2, steps: [o,o,o,o, o,o,X,o, o,o,o,o, o,o,o,o],
        pick: 'chord', octave: 1, len: 3, wave: 'triangle',
        filter: [2600, 900, 2], peak: 0.075 },
    ],
  },

  /* --------------------------------------------------------------- rock -- */
  {
    kind: 'genre', id: 'power-chord', name: 'Power Chord',
    blurb: 'Driving rock — backbeat drums and distorted fifths.',
    tint: 'var(--rp-tangerine)', bpm: 132, key: 52 /* E3 */, scale: SCALES.naturalMinor,
    progression: PROG_ROCK, cycleBars: 8, cutoff: 7000, mix: 0.45,
    tracks: [
      { type: 'kick', steps: [X,o,o,o, o,o,X,o, o,o,X,o, o,o,o,o],
        startHz: 140, endHz: 50, decay: 0.24, peak: 0.85 },
      // Backbeat: snare on 2 and 4. The single most recognisable rock cue.
      { type: 'snare', steps: [o,o,o,o, X,o,o,o, o,o,o,o, X,o,o,o],
        fill: [o,o,o,o, X,o,o,o, o,o,X,X, X,X,X,X], peak: 0.46, decay: 0.16, tone: 2100 },
      { type: 'hat', steps: [X,o,X,o, X,o,X,o, X,o,X,o, X,o,X,o], peak: 0.16 },
      // Distorted power chords chugging in eighths.
      { type: 'tone', steps: [X,o,X,o, X,o,X,o, X,o,X,o, X,o,X,o],
        pick: 'chord', octave: 0, len: 1.7, wave: 'sawtooth',
        drive: 4.5, filter: [2400, 1500, 1.4], peak: 0.055 },
      // Bass locked to the root.
      { type: 'tone', steps: [X,o,o,o, X,o,o,o, X,o,o,o, X,o,o,o],
        pick: 'root', octave: -1, len: 3.6, wave: 'sawtooth',
        filter: [700, 400, 3], peak: 0.3 },
      // A pentatonic lead that wanders in over the second half.
      { type: 'tone', from: 4, steps: [o,o,o,X, o,o,X,o, o,X,o,o, X,o,o,X],
        pick: 'walk', octave: 1, len: 1.8, wave: 'sawtooth',
        drive: 4, filter: [3000, 1800, 2], peak: 0.1 },
    ],
  },

  /* ---------------------------------------------------------- classical -- */
  {
    kind: 'genre', id: 'moonlight', name: 'Moonlight Study',
    blurb: 'Classical nocturne — broken chords under a slow melody. No drums.',
    tint: 'var(--rp-violet-400)', bpm: 66, key: 57 /* A3 */, scale: SCALES.harmonicMinor,
    progression: PROG_CLASSICAL, cycleBars: 8, cutoff: 3200, mix: 0.8,
    tracks: [
      // Alberti bass: the broken-chord accompaniment figure that carries most
      // of the classical keyboard repertoire.
      { type: 'tone', steps: [X,o,X,o, X,o,X,o, X,o,X,o, X,o,X,o],
        pick: 'arpUpDown', octave: -1, len: 2.2, wave: 'triangle',
        filter: [2200, 1200, 0.8], peak: 0.14, attack: 0.012 },
      // A sustained melody moving mostly by step.
      { type: 'tone', steps: [X,o,o,o, o,o,X,o, o,o,o,o, X,o,o,o],
        pick: 'walk', octave: 1, len: 5, wave: 'sine',
        filter: [2600, 1500, 0.7], peak: 0.2, attack: 0.05 },
      // A quiet held root underneath, like a sustain pedal.
      { type: 'tone', steps: [X,o,o,o, o,o,o,o, o,o,o,o, o,o,o,o],
        pick: 'root', octave: -1, len: 15, wave: 'sine', peak: 0.1, attack: 0.3 },
    ],
  },

  /* ------------------------------------------------------ chiptune quest -- */
  {
    kind: 'genre', id: 'overworld', name: 'Overworld',
    blurb: 'Video-game adventure — bouncy square leads and a marching bass.',
    tint: 'var(--rp-sunshine)', bpm: 144, key: 60 /* C4 */, scale: SCALES.major,
    progression: PROG_OVERWORLD, cycleBars: 8, cutoff: 6000, mix: 0.65,
    tracks: [
      // NES-style noise percussion.
      { type: 'hat', steps: [o,o,X,o, o,o,X,o, o,o,X,o, o,o,X,o], peak: 0.1 },
      { type: 'kick', steps: [X,o,o,o, o,o,o,o, X,o,o,o, o,o,o,o],
        startHz: 130, endHz: 55, decay: 0.16, peak: 0.5 },
      // Marching root/fifth bass — the pulse channel.
      { type: 'tone', steps: [X,o,X,o, X,o,X,o, X,o,X,o, X,o,X,o],
        pick: 'rootFifth', octave: -1, len: 1.6, wave: 'square',
        filter: [1600, 900, 1], peak: 0.2 },
      // Bouncy arpeggiated lead.
      { type: 'tone', steps: [X,o,X,X, o,X,o,X, X,o,X,o, X,X,o,X],
        pick: 'arpUp', octave: 1, len: 1.5, wave: 'square', peak: 0.14 },
      // A counter-melody that fills the back half of the cycle.
      { type: 'tone', from: 4, steps: [o,X,o,o, X,o,o,X, o,o,X,o, o,o,X,o],
        pick: 'walk', octave: 2, len: 1.4, wave: 'triangle', peak: 0.1 },
    ],
  },

  /* -------------------------------------------------------- chiptune boss -- */
  {
    kind: 'genre', id: 'boss-rush', name: 'Boss Rush',
    blurb: 'Video-game battle theme — relentless sixteenths, minor key, no mercy.',
    tint: 'var(--rp-magenta)', bpm: 168, key: 50 /* D3 */, scale: SCALES.harmonicMinor,
    progression: PROG_BATTLE, cycleBars: 8, cutoff: 6500, mix: 0.55,
    tracks: [
      { type: 'kick', steps: [X,o,o,X, o,o,X,o, X,o,o,X, o,o,o,o],
        startHz: 145, endHz: 48, decay: 0.18, peak: 0.7 },
      { type: 'snare', steps: [o,o,o,o, X,o,o,o, o,o,o,o, X,o,o,X],
        fill: [X,o,X,o, X,o,X,o, X,X,X,X, X,X,X,X], peak: 0.34, decay: 0.1, tone: 2400 },
      { type: 'hat', steps: [X,X,X,X, X,X,X,X, X,X,X,X, X,X,X,X], peak: 0.085 },
      // Driving sixteenth arpeggio — the battle-theme engine.
      { type: 'tone', steps: [X,X,X,X, X,X,X,X, X,X,X,X, X,X,X,X],
        pick: 'arpUpDown', octave: 0, len: 0.95, wave: 'square',
        filter: [3200, 2000, 1.5], peak: 0.1 },
      { type: 'tone', steps: [X,o,o,X, o,o,X,o, X,o,o,X, o,o,X,o],
        pick: 'root', octave: -1, len: 1.4, wave: 'sawtooth',
        filter: [800, 500, 3], peak: 0.32 },
      { type: 'tone', from: 2, steps: [X,o,o,o, o,o,o,o, X,o,o,o, o,o,o,o],
        pick: 'chord', octave: 1, len: 7, wave: 'square', peak: 0.055 },
    ],
  },

  /* -------------------------------------------------------------- lo-fi -- */
  {
    kind: 'genre', id: 'deep-current', name: 'Deep Current',
    blurb: 'Lo-fi chill — swung drums, jazzy sevenths, background-friendly.',
    tint: 'var(--rp-teal)', bpm: 84, key: 53 /* F3 */, scale: SCALES.major,
    progression: PROG_LOFI, cycleBars: 8, cutoff: 4600, swing: 0.22, sidechain: 0.18, mix: 0.7,
    tracks: [
      { type: 'kick', steps: [X,o,o,o, o,o,X,o, o,o,o,o, o,o,o,o],
        startHz: 120, endHz: 42, decay: 0.36, peak: 0.7 },
      { type: 'snare', steps: [o,o,o,o, X,o,o,o, o,o,o,o, X,o,o,o],
        peak: 0.2, decay: 0.13, tone: 1500, bodyHz: 0 },
      { type: 'hat', steps: [X,o,X,o, X,o,X,o, X,o,X,o, X,o,X,X], peak: 0.12 },
      // Warm seventh chords, softened by the low master cutoff.
      { type: 'tone', steps: [X,o,o,o, o,o,o,o, o,o,X,o, o,o,o,o],
        pick: 'chord', octave: 0, len: 6, wave: 'triangle',
        filter: [1400, 700, 0.8], peak: 0.085, attack: 0.06 },
      { type: 'tone', steps: [X,o,o,o, o,o,X,o, o,o,o,o, X,o,o,o],
        pick: 'root', octave: -1, len: 3, wave: 'sine', peak: 0.34 },
      // A sparse, unhurried melody.
      { type: 'tone', from: 2, steps: [o,o,X,o, o,o,o,X, o,o,o,o, o,X,o,o],
        pick: 'walk', octave: 1, len: 3, wave: 'sine',
        filter: [2000, 1100, 0.7], peak: 0.12, attack: 0.03 },
    ],
  },

  /* --------------------------------------------------------- synthwave -- */
  {
    kind: 'genre', id: 'ignition', name: 'Ignition',
    blurb: 'Synthwave — neon arpeggios and an eighth-note pulse. Pure momentum.',
    tint: 'var(--rp-violet-400)', bpm: 116, key: 55 /* G3 */, scale: SCALES.naturalMinor,
    progression: PROG_POP, cycleBars: 8, cutoff: 8000, sidechain: 0.5, mix: 0.55,
    tracks: [
      { type: 'kick', steps: [X,o,o,o, X,o,o,o, X,o,o,o, X,o,o,o],
        startHz: 155, endHz: 47, decay: 0.28, peak: 0.85 },
      { type: 'clap', steps: [o,o,o,o, X,o,o,o, o,o,o,o, X,o,o,o], peak: 0.28 },
      { type: 'hat', steps: [o,o,X,o, o,o,X,o, o,o,X,o, o,o,X,o], open: [14], peak: 0.16 },
      // The relentless eighth-note bass that defines the style.
      { type: 'tone', steps: [X,o,X,o, X,o,X,o, X,o,X,o, X,o,X,o],
        pick: 'root', octave: -1, len: 1.7, wave: 'sawtooth',
        filter: [1000, 500, 5], peak: 0.34 },
      // Wide, glassy pad.
      { type: 'tone', steps: [X,o,o,o, o,o,o,o, o,o,o,o, o,o,o,o],
        pick: 'chord', octave: 0, len: 15, wave: 'sawtooth',
        voices: 5, detune: 18, filter: [900, 3200, 1.2], peak: 0.06, attack: 0.25 },
      // A sixteenth arpeggio riding on top from the third bar.
      { type: 'tone', from: 2, steps: [X,X,X,X, X,X,X,X, X,X,X,X, X,X,X,X],
        pick: 'arpUp', octave: 1, len: 0.9, wave: 'square',
        filter: [3600, 1800, 2], peak: 0.07 },
    ],
  },
];

export type Station = WalkStation | GenreStation;

export const ALL_STATIONS: Station[] = [...WALK_STATIONS, ...GENRE_STATIONS];
