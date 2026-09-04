import { describe, it, expect } from 'vitest';
import {
  midiToHz,
  scaleDegree,
  chordTones,
  nearestChordTone,
  SCALES,
  CHORD_SHAPES,
} from './theory';
import { ALL_STATIONS, GENRE_STATIONS, WALK_STATIONS } from './stations';
import { mulberry32 } from './engine';

describe('midiToHz', () => {
  it('anchors A4 at 440 Hz', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 6);
  });
  it('doubles every octave', () => {
    expect(midiToHz(81)).toBeCloseTo(880, 6);
    expect(midiToHz(57)).toBeCloseTo(220, 6);
  });
  it('puts middle C near 261.63 Hz', () => {
    expect(midiToHz(60)).toBeCloseTo(261.63, 2);
  });
});

describe('scaleDegree', () => {
  const major = SCALES.major;
  it('returns the plain scale within one octave', () => {
    expect(major.map((_, i) => scaleDegree(major, i))).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });
  it('wraps upward into the next octave', () => {
    expect(scaleDegree(major, 7)).toBe(12);
    expect(scaleDegree(major, 8)).toBe(14);
  });
  it('wraps downward for negative degrees', () => {
    expect(scaleDegree(major, -1)).toBe(-1); // the leading tone below the root
    expect(scaleDegree(major, -7)).toBe(-12);
  });
});

describe('chordTones', () => {
  it('builds an A minor triad on the tonic of A minor', () => {
    // A3 = 57. A minor triad = A C E = 57, 60, 64.
    expect(chordTones(57, SCALES.naturalMinor, { degree: 0, shape: 'min' })).toEqual([57, 60, 64]);
  });
  it('builds the VI major chord of A minor as F major', () => {
    // Degree 5 of A natural minor is F (57 + 8 = 65); F major = F A C.
    expect(chordTones(57, SCALES.naturalMinor, { degree: 5, shape: 'maj' })).toEqual([65, 69, 72]);
  });
  it('gives power chords no third', () => {
    const t = chordTones(52, SCALES.naturalMinor, { degree: 0, shape: 'power' });
    expect(t).toEqual([52, 59, 64]);
    // Root + fifth + octave: the interval set contains no 3rd or b3rd.
    const intervals = t.map((n) => n - t[0]);
    expect(intervals).not.toContain(3);
    expect(intervals).not.toContain(4);
  });
});

describe('nearestChordTone', () => {
  it('snaps to the closest chord tone in any octave', () => {
    const tones = [57, 60, 64]; // A minor
    expect(nearestChordTone(tones, 61)).toBe(60);
    expect(nearestChordTone(tones, 70)).toBe(69); // A one octave up
    expect(nearestChordTone(tones, 45)).toBe(45); // A two octaves down
  });
});

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });
  it('stays within [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 2000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('produces a roughly uniform spread', () => {
    const r = mulberry32(99);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 10000; i++) buckets[Math.floor(r() * 10)]++;
    // Each decile should hold roughly a tenth of the samples.
    for (const b of buckets) expect(b).toBeGreaterThan(700);
  });
});

describe('station definitions', () => {
  it('has unique ids', () => {
    const ids = ALL_STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every station a name, blurb and tint', () => {
    for (const s of ALL_STATIONS) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.blurb.length).toBeGreaterThan(0);
      expect(s.tint).toMatch(/^var\(--rp-/);
    }
  });

  it('keeps every tempo in a plausible musical range', () => {
    for (const s of ALL_STATIONS) {
      expect(s.bpm).toBeGreaterThanOrEqual(60);
      expect(s.bpm).toBeLessThanOrEqual(200);
    }
  });

  describe('walk stations', () => {
    it('keeps scales ascending and probabilities in range', () => {
      for (const s of WALK_STATIONS) {
        for (let i = 1; i < s.scale.length; i++) {
          expect(s.scale[i]).toBeGreaterThan(s.scale[i - 1]);
        }
        expect(s.home).toBeLessThan(s.scale.length);
        for (const p of [s.restProb, s.gravity, s.leapProb, s.harmonyProb]) {
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
        }
      }
    });
  });

  describe('genre stations', () => {
    it('uses exactly 16 steps per bar in every pattern', () => {
      for (const s of GENRE_STATIONS) {
        for (const t of s.tracks) {
          expect(t.steps).toHaveLength(16);
          if (t.fill) expect(t.fill).toHaveLength(16);
        }
      }
    });

    it('keeps every step value a probability', () => {
      for (const s of GENRE_STATIONS) {
        for (const t of s.tracks) {
          for (const v of [...t.steps, ...(t.fill ?? [])]) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
        }
      }
    });

    it('keeps track bar ranges inside the arrangement cycle', () => {
      for (const s of GENRE_STATIONS) {
        for (const t of s.tracks) {
          const from = t.from ?? 0;
          const to = t.to ?? s.cycleBars - 1;
          expect(from).toBeGreaterThanOrEqual(0);
          expect(to).toBeLessThan(s.cycleBars);
          expect(from).toBeLessThanOrEqual(to);
        }
      }
    });

    it('gives every station at least one audible track per bar of its cycle', () => {
      for (const s of GENRE_STATIONS) {
        for (let bar = 0; bar < s.cycleBars; bar++) {
          const active = s.tracks.filter((t) => {
            const from = t.from ?? 0;
            const to = t.to ?? s.cycleBars - 1;
            return bar >= from && bar <= to && t.steps.some((v) => v > 0);
          });
          expect(active.length, `${s.id} bar ${bar} is silent`).toBeGreaterThan(0);
        }
      }
    });

    it('resolves every progression chord to real pitches', () => {
      for (const s of GENRE_STATIONS) {
        expect(s.progression.length).toBeGreaterThan(0);
        for (const c of s.progression) {
          expect(CHORD_SHAPES[c.shape]).toBeDefined();
          const tones = chordTones(s.key, s.scale, c);
          expect(tones.length).toBeGreaterThanOrEqual(2);
          for (const t of tones) {
            // Everything should land in a sane MIDI/audible range.
            expect(t).toBeGreaterThan(20);
            expect(t).toBeLessThan(115);
          }
        }
      }
    });

    it('keeps wobble LFO rates positive and sane', () => {
      for (const s of GENRE_STATIONS) {
        for (const t of s.tracks) {
          if (t.type !== 'wobble') continue;
          expect(t.rates.length).toBeGreaterThan(0);
          for (const r of t.rates) {
            expect(r).toBeGreaterThan(0);
            // Converted to Hz this must stay a wobble, not an audible tone.
            expect((s.bpm / 60) * r).toBeLessThan(40);
          }
        }
      }
    });

    it('keeps every station mix trim in a sane range', () => {
      for (const s of GENRE_STATIONS) {
        if (s.mix === undefined) continue;
        expect(s.mix).toBeGreaterThan(0.2);
        expect(s.mix).toBeLessThanOrEqual(1);
      }
    });

    it('keeps swing and sidechain within range', () => {
      for (const s of GENRE_STATIONS) {
        if (s.swing !== undefined) {
          expect(s.swing).toBeGreaterThanOrEqual(0);
          expect(s.swing).toBeLessThanOrEqual(0.4);
        }
        if (s.sidechain !== undefined) {
          expect(s.sidechain).toBeGreaterThanOrEqual(0);
          expect(s.sidechain).toBeLessThan(1);
        }
      }
    });

    it('starts percussive stations with drums in the very first bar', () => {
      // Regression guard: Neon Drop originally held its kick back until bar 4,
      // which at 128 BPM is 7.5 seconds of no drums after pressing play — long
      // enough to read as broken. Any station that has drums at all must use
      // some of them immediately.
      for (const s of GENRE_STATIONS) {
        const drums = s.tracks.filter((t) =>
          ['kick', 'snare', 'hat', 'clap'].includes(t.type),
        );
        if (drums.length === 0) continue; // the classical station, by design
        const inFirstBar = drums.filter((t) => (t.from ?? 0) === 0 && t.steps.some((v) => v > 0));
        expect(inFirstBar.length, `${s.id} has no percussion in bar 0`).toBeGreaterThan(0);
      }
    });

    it('never leaves a gap longer than two bars without percussion', () => {
      for (const s of GENRE_STATIONS) {
        const drums = s.tracks.filter((t) =>
          ['kick', 'snare', 'hat', 'clap'].includes(t.type),
        );
        if (drums.length === 0) continue;
        for (let bar = 0; bar < s.cycleBars; bar++) {
          const live = drums.some((t) => {
            const from = t.from ?? 0;
            const to = t.to ?? s.cycleBars - 1;
            return bar >= from && bar <= to && t.steps.some((v) => v > 0);
          });
          expect(live, `${s.id} bar ${bar} has no percussion`).toBe(true);
        }
      }
    });

    it('puts a kick on the downbeat of every four-on-the-floor station', () => {
      // Sanity-check the genres whose identity depends on that pulse.
      for (const id of ['neon-drop', 'ignition']) {
        const s = GENRE_STATIONS.find((g) => g.id === id)!;
        const kickTrack = s.tracks.find((t) => t.type === 'kick')!;
        expect(kickTrack.steps[0]).toBe(1);
        expect(kickTrack.steps[4]).toBe(1);
        expect(kickTrack.steps[8]).toBe(1);
        expect(kickTrack.steps[12]).toBe(1);
      }
    });

    it('gives the rock station a backbeat on 2 and 4', () => {
      const s = GENRE_STATIONS.find((g) => g.id === 'power-chord')!;
      const sn = s.tracks.find((t) => t.type === 'snare')!;
      expect(sn.steps[4]).toBe(1);
      expect(sn.steps[12]).toBe(1);
      expect(sn.steps[0]).toBe(0);
    });

    it('gives dubstep its half-time snare on beat 3', () => {
      const s = GENRE_STATIONS.find((g) => g.id === 'bass-cannon')!;
      const sn = s.tracks.find((t) => t.type === 'snare')!;
      expect(sn.steps[8]).toBe(1);
      // Nothing on beat 2 — that absence is what creates the half-time feel.
      expect(sn.steps[4]).toBe(0);
    });

    it('leaves the classical station drumless', () => {
      const s = GENRE_STATIONS.find((g) => g.id === 'moonlight')!;
      const percussive = s.tracks.filter((t) =>
        ['kick', 'snare', 'hat', 'clap'].includes(t.type),
      );
      expect(percussive).toHaveLength(0);
    });
  });
});
