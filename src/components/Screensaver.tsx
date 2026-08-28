import { useEffect, useRef, useState } from 'react';
import '../styles/screensaver.css';

/**
 * Screensaver — an opt-in homage to the classic After Dark "flying toasters"
 * screensaver, reimagined for the Pugglenaut site: little pugglenauts, rockets
 * and twinkling stars drifting across a dark starfield.
 *
 * It is a self-driving island: the orchestrator mounts it once in the site
 * header via `<Screensaver client:idle />` and never passes props. Behavior is
 * driven entirely by:
 *   • localStorage key `pugglenaut-screensaver` ('on' | 'off', default 'off'),
 *   • a window CustomEvent `pugglenaut:screensaver` with detail `{ on: boolean }`
 *     — a header toggle button (wired by the orchestrator) dispatches this to
 *     enable/disable at runtime; we persist the new value to localStorage.
 *
 * When ENABLED (and not under prefers-reduced-motion), 45s of no user input
 * fades in a full-screen overlay with a <canvas> animation. ANY user input
 * dismisses it instantly and restarts the idle countdown. When DISABLED it is
 * completely inert — no timer, no listeners, nothing in the DOM.
 *
 * All fast-changing animation state lives in refs and a single rAF loop, so the
 * drifting sprites never trigger React re-renders. Everything is torn down on
 * unmount and whenever the screensaver is disabled or dismissed.
 */

const STORAGE_KEY = 'pugglenaut-screensaver';
const TOGGLE_EVENT = 'pugglenaut:screensaver';
const IDLE_MS = 45_000;

/** Input that counts as "activity" — resets the idle timer / dismisses. */
const INPUT_EVENTS = [
  'mousemove',
  'keydown',
  'pointerdown',
  'touchstart',
  'scroll',
  'wheel',
] as const;

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false; // storage unavailable (private mode) → stay off
  }
}

function writeEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable — the runtime toggle still works for this session */
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/* ------------------------------------------------------------------------- *
 * Palette — snapshot the active theme's colors from the CSS custom properties
 * so the sprites read correctly in Paper / CRT / Sketch (and re-read when the
 * theme flips). Every lookup has a sensible dark-space fallback.
 * ------------------------------------------------------------------------- */

interface Palette {
  text: string;
  magenta: string;
  sunshine: string;
  teal: string;
  lime: string;
  violet: string;
}

function readPalette(): Palette {
  const s = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    text: get('--rp-text', '#f4f4f8'),
    magenta: get('--rp-magenta', '#ff2e97'),
    sunshine: get('--rp-sunshine', '#ffcf33'),
    teal: get('--rp-teal', '#00b3b3'),
    lime: get('--rp-lime', '#8bd450'),
    violet: get('--rp-violet-600', '#6621d6'),
  };
}

/* ------------------------------------------------------------------------- *
 * Sprite model
 * ------------------------------------------------------------------------- */

type Kind = 'pug' | 'rocket' | 'star';

interface Sprite {
  kind: Kind;
  x: number;
  y: number;
  vx: number; // px/s
  vy: number; // px/s
  size: number;
  depth: number; // 0.35..1 → parallax (bigger/faster = nearer)
  color: string;
  spin: number; // gentle rotation for rockets, phase for stars
  seed: number;
}

/** A far, near-static twinkle star for starfield depth. */
interface Twinkle {
  x: number;
  y: number;
  r: number;
  rate: number;
  phase: number;
}

const TAU = Math.PI * 2;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** ~a dozen drifting sprites (pugs + rockets + a few large sparkle stars). */
function makeSprites(w: number, h: number, pal: Palette): Sprite[] {
  const bodyColors = [pal.teal, pal.violet, pal.magenta, pal.lime];
  const spec: Kind[] = [
    'pug',
    'pug',
    'pug',
    'pug',
    'rocket',
    'rocket',
    'rocket',
    'star',
    'star',
    'star',
    'star',
    'star',
  ];
  return spec.map((kind, i) => {
    const depth = rand(0.4, 1);
    const base = kind === 'star' ? 10 : 26;
    return {
      kind,
      x: rand(0, w),
      y: rand(0, h),
      vx: rand(-1, 1) * (14 + depth * 26),
      vy: rand(-1, 1) * (10 + depth * 20),
      size: base * (0.7 + depth * 0.8),
      depth,
      color: bodyColors[i % bodyColors.length],
      spin: rand(0, TAU),
      seed: rand(0, TAU),
    };
  });
}

function makeTwinkles(w: number, h: number): Twinkle[] {
  const count = Math.min(90, Math.round((w * h) / 22_000));
  const out: Twinkle[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      x: rand(0, w),
      y: rand(0, h),
      r: rand(0.6, 1.8),
      rate: rand(0.8, 2.4),
      phase: rand(0, TAU),
    });
  }
  return out;
}

/* ------------------------------------------------------------------------- *
 * Drawing (context is pre-scaled to CSS pixels; every shape is drawn around
 * the sprite's own origin via translate).
 * ------------------------------------------------------------------------- */

function drawSparkle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.22, -r * 0.22);
  ctx.lineTo(r, 0);
  ctx.lineTo(r * 0.22, r * 0.22);
  ctx.lineTo(0, r);
  ctx.lineTo(-r * 0.22, r * 0.22);
  ctx.lineTo(-r, 0);
  ctx.lineTo(-r * 0.22, -r * 0.22);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** A baby platypus in an astronaut helmet: rounded body + bill + helmet bubble. */
function drawPug(ctx: CanvasRenderingContext2D, s: Sprite, pal: Palette): void {
  const r = s.size;
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.lineJoin = 'round';

  // Body
  ctx.fillStyle = s.color;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.beginPath();
  ctx.ellipse(0, r * 0.34, r * 0.72, r * 0.62, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();

  // Platypus bill
  ctx.fillStyle = pal.sunshine;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.76, r * 0.34, r * 0.17, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();

  // Helmet bubble
  ctx.beginPath();
  ctx.arc(0, -r * 0.12, r * 0.6, 0, TAU);
  ctx.fillStyle = 'rgba(180,230,255,0.22)';
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.strokeStyle = 'rgba(220,240,255,0.72)';
  ctx.stroke();

  // Eyes
  ctx.fillStyle = 'rgba(20,24,40,0.9)';
  ctx.beginPath();
  ctx.arc(-r * 0.16, r * 0.08, r * 0.08, 0, TAU);
  ctx.arc(r * 0.16, r * 0.08, r * 0.08, 0, TAU);
  ctx.fill();

  // Helmet highlight
  ctx.beginPath();
  ctx.arc(-r * 0.2, -r * 0.3, r * 0.15, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fill();

  ctx.restore();
}

/** A little rocket with a flickering flame, aimed along its travel direction. */
function drawRocket(ctx: CanvasRenderingContext2D, s: Sprite, pal: Palette, t: number): void {
  const r = s.size;
  ctx.save();
  ctx.translate(s.x, s.y);
  // Point the nose along the direction of motion (default: straight up).
  const angle = Math.atan2(s.vy, s.vx) + Math.PI / 2;
  ctx.rotate(angle);
  ctx.lineJoin = 'round';

  // Flame (flickers)
  const flick = 0.55 + Math.abs(Math.sin(t * 0.012 + s.seed)) * 0.7;
  ctx.beginPath();
  ctx.moveTo(-r * 0.28, r * 0.7);
  ctx.lineTo(0, r * (0.72 + 0.7 * flick));
  ctx.lineTo(r * 0.28, r * 0.7);
  ctx.closePath();
  ctx.fillStyle = pal.sunshine;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-r * 0.15, r * 0.7);
  ctx.lineTo(0, r * (0.72 + 0.42 * flick));
  ctx.lineTo(r * 0.15, r * 0.7);
  ctx.closePath();
  ctx.fillStyle = pal.magenta;
  ctx.fill();

  // Body capsule
  ctx.fillStyle = s.color;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, r * 0.07);
  ctx.beginPath();
  ctx.moveTo(-r * 0.34, r * 0.7);
  ctx.lineTo(-r * 0.34, -r * 0.1);
  ctx.quadraticCurveTo(-r * 0.34, -r * 0.86, 0, -r * 0.96);
  ctx.quadraticCurveTo(r * 0.34, -r * 0.86, r * 0.34, -r * 0.1);
  ctx.lineTo(r * 0.34, r * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Fins
  ctx.fillStyle = pal.magenta;
  ctx.beginPath();
  ctx.moveTo(-r * 0.34, r * 0.28);
  ctx.lineTo(-r * 0.6, r * 0.72);
  ctx.lineTo(-r * 0.34, r * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(r * 0.34, r * 0.28);
  ctx.lineTo(r * 0.6, r * 0.72);
  ctx.lineTo(r * 0.34, r * 0.72);
  ctx.closePath();
  ctx.fill();

  // Porthole
  ctx.beginPath();
  ctx.arc(0, -r * 0.16, r * 0.2, 0, TAU);
  ctx.fillStyle = pal.teal;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.stroke();

  ctx.restore();
}

/* ------------------------------------------------------------------------- *
 * Component
 * ------------------------------------------------------------------------- */

export default function Screensaver() {
  // `enabled` resolves after mount (SSR-safe: starts off, so nothing renders
  // on the server and the first client paint is empty until we read storage).
  const [enabled, setEnabled] = useState(false);
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  activeRef.current = active;

  // Resolve the initial state from storage and subscribe to the toggle event.
  useEffect(() => {
    setEnabled(readEnabled());
    const onToggle = (e: Event) => {
      const detail = (e as CustomEvent<{ on?: boolean }>).detail;
      const on = !!detail?.on;
      writeEnabled(on); // persist the runtime toggle
      setEnabled(on);
    };
    window.addEventListener(TOGGLE_EVENT, onToggle as EventListener);
    return () => window.removeEventListener(TOGGLE_EVENT, onToggle as EventListener);
  }, []);

  // Idle detection. Only armed while enabled and not under reduced-motion; a
  // change to either re-runs this effect (reduced-motion is tracked in state).
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(prefersReducedMotion());
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setActive(false);
      return;
    }
    // Under reduced-motion, never auto-activate a moving full-screen overlay.
    if (reduced) {
      setActive(false);
      return;
    }

    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setActive(true), IDLE_MS);
    };
    const onInput = () => {
      if (activeRef.current) setActive(false); // any input dismisses instantly
      schedule(); // …and always restarts the idle countdown
    };

    // Capture-phase + passive so we notice activity anywhere without
    // interfering with the page (and Escape/any key comes through keydown).
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    INPUT_EVENTS.forEach((ev) => window.addEventListener(ev, onInput, opts));
    schedule();

    return () => {
      window.clearTimeout(timer);
      INPUT_EVENTS.forEach((ev) =>
        window.removeEventListener(ev, onInput, { capture: true }),
      );
    };
  }, [enabled, reduced]);

  // The animation loop — mounts only while the overlay is active.
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let palette = readPalette();
    let w = 0;
    let h = 0;
    let sprites: Sprite[] = [];
    let twinkles: Twinkle[] = [];
    let seeded = false;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
      if (!seeded) {
        sprites = makeSprites(w, h, palette);
        twinkles = makeTwinkles(w, h);
        seeded = true;
      }
    };
    resize();
    window.addEventListener('resize', resize);

    // Re-read colors if the theme flips while the overlay is up.
    const mo = new MutationObserver(() => {
      palette = readPalette(); // sprites read from `palette` each frame
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-rp-theme'],
    });

    const margin = 60;
    const wrap = (s: Sprite) => {
      const m = margin + s.size;
      if (s.x < -m) s.x = w + m;
      else if (s.x > w + m) s.x = -m;
      if (s.y < -m) s.y = h + m;
      else if (s.y > h + m) s.y = -m;
    };

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); // clamp big gaps
      last = now;

      ctx.clearRect(0, 0, w, h);

      // Far starfield — gentle twinkle in place.
      for (const tw of twinkles) {
        const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(now * 0.001 * tw.rate + tw.phase));
        ctx.globalAlpha = a;
        ctx.fillStyle = palette.text;
        ctx.beginPath();
        ctx.arc(tw.x, tw.y, tw.r, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Drifting sprites with wrap-around.
      for (const s of sprites) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        wrap(s);
        if (s.kind === 'pug') drawPug(ctx, s, palette);
        else if (s.kind === 'rocket') drawRocket(ctx, s, palette, now);
        else {
          const a = 0.5 + 0.5 * Math.sin(now * 0.004 + s.seed);
          drawSparkle(ctx, s.x, s.y, s.size, palette.sunshine, 0.4 + 0.6 * a);
        }
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      mo.disconnect();
    };
  }, [active]);

  // Render nothing at all unless the overlay is currently showing.
  if (!active) return null;

  return (
    <div
      className="pg-ss-overlay"
      role="img"
      aria-label="Screensaver — pugglenauts drifting through space"
    >
      <canvas ref={canvasRef} className="pg-ss-canvas" aria-hidden="true" />
    </div>
  );
}
