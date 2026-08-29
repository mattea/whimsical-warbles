import { useCallback, useEffect, useRef, useState } from 'react';
import '../styles/boop.css';

/**
 * BoopMascot — a delightful, self-contained "boop the puggle" toy.
 *
 * Renders the pugglenaut (a baby platypus in an astronaut helmet, mirroring
 * public/favicon.svg + the in-game sprite) as an inline SVG inside a real
 * <button>. Booping it — click, tap, or Enter/Space — plays a quick squish +
 * wobble, floats a little "boop!" and a sparkle or two, and increments a
 * counter persisted in localStorage under `pugglenaut-boops`. Every 25th boop
 * shows a brief milestone message.
 *
 * Accessibility & polish:
 *  - It's a native <button>, so Enter/Space and focus come for free.
 *  - prefers-reduced-motion → only a tiny non-bouncy scale, no particles.
 *  - Concurrent particles are capped so mashing never spawns infinitely.
 *  - All timers are tracked and cleared on unmount.
 *  - Themed entirely through --rp-* tokens (Paper / CRT / Sketch).
 */

const STORAGE_KEY = 'pugglenaut-boops';
const MILESTONE_EVERY = 25;
const MAX_PARTICLES = 8; // hard cap on concurrent floating particles
const SQUISH_MS = 460; // must match the keyframe duration in boop.css
const PARTICLE_MS = 900; // must match the float keyframe duration
const MESSAGE_MS = 2600;

type ParticleKind = 'boop' | 'sparkle';

interface Particle {
  id: number;
  kind: ParticleKind;
  x: number; // px horizontal drift from center
  rot: number; // deg rotation for sparkles
  scale: number;
}

function readCount(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeCount(n: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(n));
  } catch {
    /* storage may be unavailable (private mode) — booping still works */
  }
}

function caption(n: number): string {
  if (n <= 0) return 'boop me!';
  if (n === 1) return 'booped once';
  return `booped ${n} times`;
}

export default function BoopMascot() {
  const [count, setCount] = useState(0);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [tick, setTick] = useState(0); // bumps to restart the squish animation
  const [pressed, setPressed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reduced, setReduced] = useState(false);

  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const idRef = useRef(0);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate the count from storage after mount (avoids SSR mismatch).
  useEffect(() => {
    setCount(readCount());
  }, []);

  // Track prefers-reduced-motion live.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    // addEventListener is the modern API; guard for older Safari.
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
    mq.addListener(apply);
    return () => mq.removeListener(apply);
  }, []);

  // Clear every pending timer on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    };
  }, []);

  const track = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timersRef.current.delete(t);
      fn();
    }, ms);
    timersRef.current.add(t);
  }, []);

  const spawnParticles = useCallback(() => {
    const additions: Particle[] = [];
    const nextId = () => ++idRef.current;

    // One "boop!" label...
    additions.push({
      id: nextId(),
      kind: 'boop',
      x: (Math.random() - 0.5) * 26,
      rot: 0,
      scale: 1,
    });
    // ...plus one or two sparkles.
    const sparkles = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < sparkles; i++) {
      additions.push({
        id: nextId(),
        kind: 'sparkle',
        x: (Math.random() - 0.5) * 88,
        rot: Math.random() * 360,
        scale: 0.7 + Math.random() * 0.6,
      });
    }

    setParticles((prev) => {
      // Keep only the newest MAX_PARTICLES so mashing stays bounded.
      const next = [...prev, ...additions];
      return next.slice(-MAX_PARTICLES);
    });

    // Schedule removal of exactly the ones we added.
    additions.forEach((p) => {
      track(() => setParticles((prev) => prev.filter((q) => q.id !== p.id)), PARTICLE_MS);
    });
  }, [track]);

  const handleBoop = useCallback(() => {
    // Counter always increments — every boop counts, even rapid ones.
    setCount((prev) => {
      const next = prev + 1;
      writeCount(next);
      if (next % MILESTONE_EVERY === 0) {
        setMessage(`${next} boops! the puggle is delighted.`);
        if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
        messageTimerRef.current = setTimeout(() => {
          messageTimerRef.current = null;
          setMessage(null);
        }, MESSAGE_MS);
      }
      return next;
    });

    // Restart the squish animation (remount the figure via a changing key).
    setTick((t) => t + 1);
    setPressed(true);
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      setPressed(false);
    }, SQUISH_MS);

    // Particles only when motion is welcome.
    if (!reduced) spawnParticles();
  }, [reduced, spawnParticles]);

  return (
    <div className="pg-boop" data-reduced={reduced ? 'true' : 'false'}>
      <button
        type="button"
        className={`pg-boop-btn${pressed ? ' is-booped' : ''}`}
        aria-label="Boop the pugglenaut"
        onClick={handleBoop}
      >
        <span className="pg-boop-stage" aria-hidden="true">
          {/* Floating particles live above the figure. */}
          {particles.map((p) => (
            <span
              key={p.id}
              className={p.kind === 'boop' ? 'pg-boop-pop' : 'pg-boop-sparkle'}
              style={
                {
                  '--pg-x': `${p.x}px`,
                  '--pg-rot': `${p.rot}deg`,
                  '--pg-scale': p.scale,
                } as React.CSSProperties
              }
            >
              {p.kind === 'boop' ? 'boop!' : '✦'}
            </span>
          ))}

          <svg
            key={tick}
            className="pg-boop-figure"
            viewBox="0 0 140 140"
            width="140"
            height="140"
            role="img"
            focusable="false"
          >
            {/* webbed foot / tail hint at the back */}
            <ellipse
              cx="30"
              cy="106"
              rx="16"
              ry="9"
              fill="#8f7a45"
              transform="rotate(-26 30 106)"
            />
            {/* body — rounded tan/khaki platypus blob */}
            <ellipse
              cx="66"
              cy="80"
              rx="49"
              ry="43"
              fill="#cbb27a"
              stroke="#8f7a45"
              strokeWidth="2.5"
            />
            {/* duck bill — dark flat rounded paddle at the front */}
            <ellipse cx="108" cy="84" rx="21" ry="11" fill="#3a3140" />
            <circle cx="114" cy="81" r="1.4" fill="#cbb27a" />
            <circle cx="114" cy="87" r="1.4" fill="#cbb27a" />
            {/* eye peeking inside the helmet */}
            <circle cx="84" cy="64" r="6.2" fill="#20202a" />
            <circle cx="82.2" cy="61.8" r="1.7" fill="#f7f4ea" />
            {/* astronaut helmet — translucent white bubble. Centered over the
                face (shifted right + slightly down and enlarged) so the duck
                bill sits inside the visor rather than poking through it. */}
            <circle
              cx="82"
              cy="65"
              r="53"
              fill="rgba(255,255,255,0.16)"
              stroke="rgba(255,255,255,0.85)"
              strokeWidth="2.6"
            />
            {/* helmet highlight glint (top-left) */}
            <path
              d="M49 56 A42 42 0 0 1 72 27"
              fill="none"
              stroke="rgba(255,255,255,0.9)"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </button>

      <p className="pg-boop-caption" aria-live="polite">
        {message ?? caption(count)}
      </p>
    </div>
  );
}
