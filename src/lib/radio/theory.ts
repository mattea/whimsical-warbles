/**
 * Music theory helpers for the Cosmic Radio generators.
 *
 * Everything upstream of the synth works in MIDI note numbers (integers) and
 * only converts to Hz at the last moment. That keeps transposition, chord
 * building and octave shifts as plain integer arithmetic instead of
 * error-prone frequency tables.
 */

/** MIDI note number → frequency in Hz (A4 = MIDI 69 = 440 Hz). */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/* ---- Scales: semitone offsets from the key's root ----------------------- */

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  minorPenta: [0, 3, 5, 7, 10],
  majorPenta: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
} as const;

export type ScaleName = keyof typeof SCALES;

/**
 * Take the n-th degree of a scale, wrapping into higher octaves as n grows
 * past the end (and lower octaves for negative n). This is what lets a melody
 * "walk up the scale" across octaves without any special-casing.
 */
export function scaleDegree(scale: readonly number[], degree: number): number {
  const len = scale.length;
  const octave = Math.floor(degree / len);
  const within = ((degree % len) + len) % len;
  return scale[within] + octave * 12;
}

/* ---- Chords: semitone offsets from the chord's own root ----------------- */

export const CHORD_SHAPES = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  min9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  /** Root + fifth (+ octave): the rock power chord — no third, so it stays
      neutral under distortion, where a third would beat against the harmonics. */
  power: [0, 7, 12],
} as const;

export type ChordShape = keyof typeof CHORD_SHAPES;

/** One bar of harmony: a scale degree (0-indexed) plus the chord quality on it. */
export interface Chord {
  /** Degree within the station's scale — 0 is the tonic, 4 is the fifth, etc. */
  degree: number;
  shape: ChordShape;
}

/**
 * Resolve a chord to absolute MIDI notes.
 *
 * @param root   the key's root MIDI note
 * @param scale  the key's scale (semitone offsets)
 * @param chord  degree + quality
 * @returns the chord tones, lowest first
 */
export function chordTones(root: number, scale: readonly number[], chord: Chord): number[] {
  const chordRoot = root + scaleDegree(scale, chord.degree);
  return CHORD_SHAPES[chord.shape].map((iv) => chordRoot + iv);
}

/**
 * Pick a chord tone near a target pitch — the workhorse for bass lines and
 * arpeggios that need to stay in a register without jumping octaves randomly.
 */
export function nearestChordTone(tones: number[], target: number): number {
  let best = tones[0];
  let bestDist = Infinity;
  for (const t of tones) {
    // Consider the tone in a few octaves so we can land close to `target`.
    for (let oct = -2; oct <= 2; oct++) {
      const cand = t + oct * 12;
      const d = Math.abs(cand - target);
      if (d < bestDist) {
        bestDist = d;
        best = cand;
      }
    }
  }
  return best;
}

/* ---- Common progressions (as degree + shape per bar) -------------------- */
/* Written in the key's own scale, so the same progression works in any root. */

/** i – VI – III – VII: the "epic minor" loop behind a great deal of EDM. */
export const PROG_EDM_MINOR: Chord[] = [
  { degree: 0, shape: 'min' },
  { degree: 5, shape: 'maj' },
  { degree: 2, shape: 'maj' },
  { degree: 6, shape: 'maj' },
];

/** I – V – vi – IV: the pop/"four chords" progression. */
export const PROG_POP: Chord[] = [
  { degree: 0, shape: 'maj' },
  { degree: 4, shape: 'maj' },
  { degree: 5, shape: 'min' },
  { degree: 3, shape: 'maj' },
];

/** i – VII – VI – VII: the driving rock/metal vamp. */
export const PROG_ROCK: Chord[] = [
  { degree: 0, shape: 'power' },
  { degree: 6, shape: 'power' },
  { degree: 5, shape: 'power' },
  { degree: 6, shape: 'power' },
];

/** i – iv – V – i: the classical minor cadence. */
export const PROG_CLASSICAL: Chord[] = [
  { degree: 0, shape: 'min' },
  { degree: 3, shape: 'min' },
  { degree: 4, shape: 'maj' }, // raised third → a proper dominant
  { degree: 0, shape: 'min' },
];

/** ii7 – V7 – Imaj7 – Imaj7: the jazz turnaround behind lo-fi beats. */
export const PROG_LOFI: Chord[] = [
  { degree: 1, shape: 'min7' },
  { degree: 4, shape: 'dom7' },
  { degree: 0, shape: 'maj7' },
  { degree: 0, shape: 'maj7' },
];

/** i – VI – VII – i: a compact minor loop for game/battle music. */
export const PROG_BATTLE: Chord[] = [
  { degree: 0, shape: 'min' },
  { degree: 5, shape: 'maj' },
  { degree: 6, shape: 'maj' },
  { degree: 0, shape: 'min' },
];

/** I – IV – V – IV: bright, heroic overworld harmony. */
export const PROG_OVERWORLD: Chord[] = [
  { degree: 0, shape: 'maj' },
  { degree: 3, shape: 'maj' },
  { degree: 4, shape: 'maj' },
  { degree: 3, shape: 'maj' },
];
