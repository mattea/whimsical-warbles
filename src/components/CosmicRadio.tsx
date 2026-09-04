import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, IconButton, Icon } from '@retropolis/ui';
import { RadioEngine } from '../lib/radio/engine';
import { GENRE_STATIONS, WALK_STATIONS, type Station } from '../lib/radio/stations';
import '../styles/radio.css';

/**
 * Cosmic Radio — a self-contained Web Audio player. No audio files anywhere:
 * every station is synthesized live from oscillators and one noise buffer.
 *
 * Two families of station share the dial:
 *   - the four "classic" stations improvise a single melodic line over a
 *     pentatonic scale (a gently-weighted random walk, so they never loop);
 *   - the genre pack drives a full multi-track engine — drums, bass, chords and
 *     lead over a chord progression with an intro/build/drop arrangement.
 *
 * The genre pack is hidden until it is unlocked from mission control
 * (`sensory-overload`), at which point the station picker becomes a dropdown.
 *
 * The heavy lifting lives in src/lib/radio/; this component is the chassis:
 * transport, volume, visualizer and persistence. It still never autoplays — the
 * AudioContext is created and resumed only on a real click — and everything is
 * torn down on pause and on unmount.
 */

const STORAGE_KEY = 'pugglenaut-radio';
const PACK_KEY = 'pugglenaut-radio-pack';
export const PACK_EVENT = 'pugglenaut:radiopack';
const NUM_BARS = 7;

interface Persisted {
  /** Station id. Preferred over the legacy index so the list can grow. */
  stationId?: string;
  /** Legacy: an index into the original four stations. */
  stationIndex?: number;
  volume: number;
}

function readPersisted(): { stationId: string; volume: number } {
  const fallback = { stationId: WALK_STATIONS[0].id, volume: 0.25 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    const vol =
      typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1
        ? parsed.volume
        : 0.25;
    let id = typeof parsed.stationId === 'string' ? parsed.stationId : undefined;
    if (!id && typeof parsed.stationIndex === 'number') {
      id = WALK_STATIONS[parsed.stationIndex]?.id;
    }
    return { stationId: id ?? fallback.stationId, volume: vol };
  } catch {
    return fallback;
  }
}

export function readPackUnlocked(): boolean {
  try {
    return localStorage.getItem(PACK_KEY) === 'on';
  } catch {
    return false;
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
  const initial = typeof window !== 'undefined'
    ? readPersisted()
    : { stationId: WALK_STATIONS[0].id, volume: 0.25 };

  const [unlocked, setUnlocked] = useState(false);
  const [stationId, setStationId] = useState(initial.stationId);
  const [volume, setVolume] = useState(initial.volume);
  const [playing, setPlaying] = useState(false);
  const [bars, setBars] = useState<number[]>(() => Array(NUM_BARS).fill(0.15));

  // The dial: the classic four, plus the genre pack once it is unlocked.
  const stations: Station[] = useMemo(
    () => (unlocked ? [...WALK_STATIONS, ...GENRE_STATIONS] : [...WALK_STATIONS]),
    [unlocked],
  );

  const stationIndex = Math.max(0, stations.findIndex((s) => s.id === stationId));
  const station = stations[stationIndex] ?? stations[0];

  const engineRef = useRef<RadioEngine | null>(null);
  const rafRef = useRef<number | null>(null);
  const reduced = typeof window !== 'undefined' ? prefersReducedMotion() : false;

  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  /* ---- Unlock state: read once, then follow the console command --------- */
  useEffect(() => {
    setUnlocked(readPackUnlocked());
    const onPack = (e: Event) => {
      const on = (e as CustomEvent<{ on: boolean }>).detail?.on ?? false;
      setUnlocked(on);
    };
    window.addEventListener(PACK_EVENT, onPack);
    return () => window.removeEventListener(PACK_EVENT, onPack);
  }, []);

  /* ---- If the pack is locked while a genre station is playing, fall back - */
  useEffect(() => {
    if (unlocked) return;
    if (!WALK_STATIONS.some((s) => s.id === stationId)) {
      setStationId(WALK_STATIONS[0].id);
    }
  }, [unlocked, stationId]);

  /* ---- Persist ---------------------------------------------------------- */
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ stationId, volume } satisfies Persisted));
    } catch {
      /* storage may be unavailable (private mode) — ignore */
    }
  }, [stationId, volume]);

  /* ---- Live volume ------------------------------------------------------ */
  useEffect(() => {
    engineRef.current?.setVolume(volume);
  }, [volume]);

  /* ---- Visualizer ------------------------------------------------------- */
  const runVisualizer = useCallback(() => {
    const analyser = engineRef.current?.analyser;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const step = Math.floor(data.length / NUM_BARS) || 1;
    const next: number[] = [];
    for (let i = 0; i < NUM_BARS; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) sum += data[i * step + j] ?? 0;
      next.push(Math.max(0.08, Math.min(1, (sum / step / 255) * 1.6)));
    }
    setBars(next);
    rafRef.current = requestAnimationFrame(runVisualizer);
  }, []);

  const stopAudio = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    engineRef.current?.stop();
    engineRef.current = null;
    setBars(Array(NUM_BARS).fill(0.15));
  }, []);

  const startAudio = useCallback(
    async (s: Station) => {
      const engine = new RadioEngine();
      engineRef.current = engine;
      await engine.start(s, volumeRef.current);
      if (!reduced) {
        rafRef.current = requestAnimationFrame(runVisualizer);
      } else {
        setBars(Array.from({ length: NUM_BARS }, (_, i) => 0.35 + (i % 3) * 0.15));
      }
    },
    [reduced, runVisualizer],
  );

  const togglePlay = useCallback(() => {
    setPlaying((wasPlaying) => {
      if (wasPlaying) {
        stopAudio();
        return false;
      }
      void startAudio(station);
      return true;
    });
  }, [startAudio, stopAudio, station]);

  const changeStation = useCallback(
    (nextIndex: number) => {
      const wrapped = (nextIndex + stations.length) % stations.length;
      const next = stations[wrapped];
      setStationId(next.id);
      setPlaying((wasPlaying) => {
        if (wasPlaying) {
          stopAudio();
          void startAudio(next);
          return true;
        }
        return false;
      });
    },
    [stations, startAudio, stopAudio],
  );

  const prevStation = useCallback(() => changeStation(stationIndex - 1), [changeStation, stationIndex]);
  const nextStation = useCallback(() => changeStation(stationIndex + 1), [changeStation, stationIndex]);

  /* ---- Unmount ---------------------------------------------------------- */
  useEffect(() => stopAudio, [stopAudio]);

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

        <div className="pg-radio-display" style={{ ['--pg-radio-tint' as string]: station.tint }}>
          <div className="pg-radio-visualizer" aria-hidden="true">
            {bars.map((h, i) => (
              <span key={i} className="pg-radio-bar" style={{ height: `${Math.round(h * 100)}%` }} />
            ))}
          </div>
          <div className="pg-radio-nowplaying" aria-live="polite">
            <span className="pg-radio-label">{playing ? 'Now playing' : 'Paused'}</span>
            <span className="pg-radio-station">{station.name}</span>
            <span className="pg-radio-blurb">{station.blurb}</span>
          </div>
        </div>

        <div className="pg-radio-transport">
          <IconButton
            icon="play" label="Previous station" variant="secondary" size="sm"
            onClick={prevStation} className="pg-radio-flip"
          />
          <IconButton
            icon={playing ? 'pause' : 'play'}
            label={playing ? 'Pause radio' : 'Play radio'}
            variant="primary" size="md" onClick={togglePlay}
          />
          <IconButton icon="play" label="Next station" variant="secondary" size="sm" onClick={nextStation} />
        </div>

        <div className="pg-radio-volume">
          <Icon name="music" size={14} title="Volume" />
          <input
            className="pg-radio-slider" type="range" min={0} max={1} step={0.01}
            value={volume} aria-label="Radio volume"
            onChange={(e) => setVolume(Number(e.currentTarget.value))}
          />
          <span className="pg-radio-vol-num" aria-hidden="true">{Math.round(volume * 100)}</span>
        </div>

        {/* Locked: the original four as chips. Unlocked: a full dropdown, since
            thirteen chips would swamp the panel. */}
        {unlocked ? (
          <div className="pg-radio-picker">
            <label className="pg-radio-select-label" htmlFor="pg-radio-station-select">
              Station
            </label>
            <select
              id="pg-radio-station-select"
              className="pg-radio-select"
              value={station.id}
              onChange={(e) => {
                const idx = stations.findIndex((s) => s.id === e.currentTarget.value);
                if (idx >= 0) changeStation(idx);
              }}
            >
              <optgroup label="Classic">
                {WALK_STATIONS.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
              <optgroup label="Sensory Overload">
                {GENRE_STATIONS.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
            </select>
          </div>
        ) : (
          <div className="pg-radio-stations" role="group" aria-label="Stations">
            {stations.map((s, i) => (
              <Button
                key={s.id} size="sm"
                variant={i === stationIndex ? 'sunshine' : 'ghost'}
                onClick={() => changeStation(i)}
                aria-pressed={i === stationIndex}
              >
                {s.name}
              </Button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
