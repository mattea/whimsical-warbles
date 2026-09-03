import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@retropolis/ui';
import '../styles/snake.css';

/**
 * Comet Snake — a chill retro snake reimagined as a comet.
 *
 * You steer a comet: a small pugglenaut head (a baby platypus in an astronaut
 * helmet) leading a glowing tail of segments across a grid. Eat twinkling stars
 * to grow and score; the comet speeds up slightly as it grows. The edges WRAP
 * (friendly) so you never crash into a wall — but running into your own tail
 * ends the run.
 *
 * As in <PuggleGame />, all fast-changing game state lives in one mutable ref
 * (`engineRef`) driven by a single requestAnimationFrame loop, so gameplay never
 * triggers React re-renders. React handles only the surrounding UI (start /
 * game-over cards). Every browser API is touched inside effects and torn down on
 * unmount, since this island mounts with `client:load`.
 */

/* ---- Grid + world constants (a fixed 4:3 virtual space) ----------------- */

const COLS = 24;
const ROWS = 18;
const CELL = 24;
const WORLD_W = COLS * CELL; // 576
const WORLD_H = ROWS * CELL; // 432

const START_TICK = 0.16; // seconds per grid step at the start
const MIN_TICK = 0.072; // fastest the comet ever gets
const TICK_RAMP = 0.004; // seconds shaved off per star eaten

const START_LEN = 4; // starting tail length (segments incl. head)

const FIXED_DT = 1 / 120; // fixed-timestep accumulator (matches PuggleGame)
const MAX_FRAME = 0.25; // clamp huge gaps (tab was backgrounded)

const BEST_KEY = 'pugglenaut-snake-best';
const SWIPE_MIN = 24; // px a swipe must travel to register

type Phase = 'idle' | 'playing' | 'gameover';

interface Cell {
  x: number;
  y: number;
}

interface Palette {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  magenta: string;
  sunshine: string;
  teal: string;
  lime: string;
  violet: string;
  pixel: string;
  mono: string;
}

interface Engine {
  phase: Phase;
  paused: boolean;

  // The comet: head is index 0, tail grows toward the end.
  body: Cell[];
  prev: Cell[]; // previous-tick positions, for smooth interpolation
  dir: Cell; // current heading (grid units)
  nextDir: Cell; // queued heading, applied on the next tick
  grow: number; // pending segments to add (from eaten stars)

  star: Cell;
  starTw: number; // twinkle phase

  tick: number; // seconds per grid step (shrinks as you grow)
  acc: number; // fixed-step accumulator remainder (drives interpolation)
  score: number;

  shake: number; // decaying screen-shake magnitude (px)
  deathFlash: number;

  reduced: boolean;
  palette: Palette;

  scaleX: number;
  scaleY: number;
}

/* ---- Small helpers ------------------------------------------------------ */

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function readBest(): number {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeBest(score: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(score));
  } catch {
    /* private mode — best simply won't persist this session */
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Snapshot the current theme's colors from the CSS custom properties. */
function readPalette(): Palette {
  const s = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => {
    const v = s.getPropertyValue(name).trim();
    return v || fallback;
  };
  return {
    bg: get('--rp-bg', '#0b0f1a'),
    surface: get('--rp-surface', '#141a2e'),
    text: get('--rp-text', '#f4f4f8'),
    muted: get('--rp-text-muted', '#9aa0b5'),
    border: get('--rp-border', '#000000'),
    magenta: get('--rp-magenta', '#ff2e97'),
    sunshine: get('--rp-sunshine', '#ffcf33'),
    teal: get('--rp-teal', '#00b3b3'),
    lime: get('--rp-lime', '#8bd450'),
    violet: get('--rp-violet-600', '#6621d6'),
    pixel: get('--rp-font-pixel', "'Silkscreen', monospace"),
    mono: get('--rp-font-mono', "'VT323', monospace"),
  };
}

/** Place a star on a free cell (never under the comet). */
function placeStar(body: Cell[]): Cell {
  // Small grid → rejection sampling is cheap and simple.
  for (let tries = 0; tries < 200; tries++) {
    const c = {
      x: Math.floor(Math.random() * COLS),
      y: Math.floor(Math.random() * ROWS),
    };
    if (!body.some((b) => b.x === c.x && b.y === c.y)) return c;
  }
  // Fallback (comet fills nearly the whole board): first free cell.
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!body.some((b) => b.x === x && b.y === y)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

/**
 * Shortest wrapped delta between two cells along one axis, in [-size/2, size/2].
 * Lets a segment interpolate the short way even when it wrapped the board.
 */
function wrapDelta(from: number, to: number, size: number): number {
  let d = to - from;
  if (d > size / 2) d -= size;
  else if (d < -size / 2) d += size;
  return d;
}

/* ---- The pugglenaut comet head, drawn from canvas primitives ------------ */

function drawHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  dir: Cell,
  pal: Palette,
  reduced: boolean,
) {
  const angle = Math.atan2(dir.y, dir.x);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // Draw in a "facing +x" frame, then un-rotate so internal details stay upright.
  ctx.rotate(-angle);

  // Comet glow halo around the head.
  if (!reduced) {
    const glow = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 2.1);
    glow.addColorStop(0, 'rgba(255,207,51,0.45)');
    glow.addColorStop(1, 'rgba(255,207,51,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // Body — a rounded tan/khaki blob (baby platypus "puggle").
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#8f7a45';
  ctx.fillStyle = '#cbb27a';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.96, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Duck bill — a dark flat paddle poking toward the heading.
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  ctx.fillStyle = '#3a3140';
  ctx.beginPath();
  ctx.ellipse(nx * r * 0.7, ny * r * 0.7, r * 0.4, r * 0.24, angle, 0, Math.PI * 2);
  ctx.fill();

  // Eye peeking inside the helmet (offset toward the heading).
  ctx.fillStyle = '#20202a';
  ctx.beginPath();
  ctx.arc(nx * r * 0.28, ny * r * 0.28 - r * 0.12, r * 0.14, 0, Math.PI * 2);
  ctx.fill();

  // Astronaut helmet — a translucent bubble with a rim + glint.
  ctx.beginPath();
  ctx.arc(0, -r * 0.04, r * 0.98, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -r * 0.04, r * 0.76, Math.PI * 1.05, Math.PI * 1.5);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();

  ctx.restore();
}

/* ======================================================================== */

export default function CometSnake() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const rafRef = useRef<number | null>(null);
  const phaseRef = useRef<Phase>('idle');

  // UI state (low-frequency — set at phase transitions, not per frame).
  const [phase, setPhase] = useState<Phase>('idle');
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  // Mirror `best` into a ref so the render loop can draw the live HUD without
  // re-subscribing every update.
  const bestRef = useRef(0);
  useEffect(() => {
    bestRef.current = best;
  }, [best]);

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  /* --- Engine lifecycle -------------------------------------------------- */

  const resetEngine = useCallback((): Engine => {
    // Start mid-board, heading right, with a short stub of tail.
    const hx = Math.floor(COLS / 2);
    const hy = Math.floor(ROWS / 2);
    const body: Cell[] = [];
    for (let i = 0; i < START_LEN; i++) body.push({ x: hx - i, y: hy });
    const prev = body.map((c) => ({ ...c }));
    return {
      phase: 'idle',
      paused: false,
      body,
      prev,
      dir: { x: 1, y: 0 },
      nextDir: { x: 1, y: 0 },
      grow: 0,
      star: placeStar(body),
      starTw: 0,
      tick: START_TICK,
      acc: 0,
      score: 0,
      shake: 0,
      deathFlash: 0,
      reduced: prefersReducedMotion(),
      palette: readPalette(),
      // Seed the world→canvas scale from the CURRENT canvas so a run started
      // (or restarted) mid-session draws full-size instead of ~2/3 until the
      // next window resize. resize() keeps this in sync afterwards.
      scaleX: canvasRef.current ? canvasRef.current.width / WORLD_W : 1,
      scaleY: canvasRef.current ? canvasRef.current.height / WORLD_H : 1,
    };
  }, []);

  const startRun = useCallback(() => {
    const eng = resetEngine();
    eng.phase = 'playing';
    eng.palette = readPalette();
    eng.reduced = prefersReducedMotion();
    engineRef.current = eng;
    setScore(0);
    setPhaseBoth('playing');
    // Move focus onto the shell so keyboard controls work and Space doesn't
    // re-trigger whatever button was just clicked.
    shellRef.current?.focus();
  }, [resetEngine, setPhaseBoth]);

  const endRun = useCallback(() => {
    const eng = engineRef.current;
    if (!eng || eng.phase !== 'playing') return;
    eng.phase = 'gameover';
    eng.deathFlash = eng.reduced ? 0 : 1;
    eng.shake = eng.reduced ? 0 : 12;
    const final = eng.score;
    setScore(final);
    setBest((prev) => {
      const next = Math.max(prev, final);
      if (next > prev) writeBest(next);
      return next;
    });
    setPhaseBoth('gameover');
  }, [setPhaseBoth]);

  /* --- One grid step (a "tick") ------------------------------------------ */

  const tickStep = useCallback(
    (eng: Engine) => {
      if (eng.phase !== 'playing') return;

      // Commit the queued heading (guards against 180° reversals handled at input).
      eng.dir = eng.nextDir;

      // Snapshot current positions so the render can interpolate toward the new ones.
      eng.prev = eng.body.map((c) => ({ ...c }));

      const head = eng.body[0];
      const nx = (head.x + eng.dir.x + COLS) % COLS; // friendly wrap
      const ny = (head.y + eng.dir.y + ROWS) % ROWS;

      const eating = nx === eng.star.x && ny === eng.star.y;

      // Self-collision: the tail cell we're about to vacate is safe to enter
      // (unless we're growing this tick). Check against the body that will remain.
      const willKeepTail = eating || eng.grow > 0;
      const lastIndex = eng.body.length - 1;
      for (let i = 0; i < eng.body.length; i++) {
        if (!willKeepTail && i === lastIndex) continue; // tail moves out of the way
        if (eng.body[i].x === nx && eng.body[i].y === ny) {
          endRun();
          return;
        }
      }

      // Advance: prepend the new head.
      eng.body.unshift({ x: nx, y: ny });

      if (eating) {
        eng.score += 1;
        eng.grow += 2; // each star adds a couple of segments over the next ticks
        eng.tick = Math.max(MIN_TICK, START_TICK - eng.score * TICK_RAMP);
        eng.star = placeStar(eng.body);
        if (!eng.reduced) eng.shake = Math.min(eng.shake + 4, 7);
      }

      if (eng.grow > 0) {
        eng.grow -= 1; // keep the tail this tick (grow)
      } else {
        eng.body.pop(); // normal move: drop the tail
      }

      // Keep prev the same length as body so interpolation lines up. A freshly
      // added head has no previous cell — anchor it to the old head's spot.
      if (eng.prev.length < eng.body.length) {
        eng.prev.unshift({ ...eng.body[1] });
      } else if (eng.prev.length > eng.body.length) {
        eng.prev.pop();
      }
    },
    [endRun],
  );

  /* --- Rendering --------------------------------------------------------- */

  const render = useCallback((eng: Engine, ctx: CanvasRenderingContext2D) => {
    const pal = eng.palette;

    let sx = 0;
    let sy = 0;
    if (eng.shake > 0) {
      sx = (Math.random() * 2 - 1) * eng.shake;
      sy = (Math.random() * 2 - 1) * eng.shake;
    }
    ctx.setTransform(eng.scaleX, 0, 0, eng.scaleY, sx * eng.scaleX, sy * eng.scaleY);

    // Sky.
    ctx.fillStyle = pal.bg;
    ctx.fillRect(-20, -20, WORLD_W + 40, WORLD_H + 40);

    // Faint grid lattice so the play space reads as a grid.
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = pal.muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < COLS; c++) {
      ctx.moveTo(c * CELL, 0);
      ctx.lineTo(c * CELL, WORLD_H);
    }
    for (let r = 1; r < ROWS; r++) {
      ctx.moveTo(0, r * CELL);
      ctx.lineTo(WORLD_W, r * CELL);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Interpolation fraction for smooth gliding between grid cells.
    const t = eng.phase === 'playing' ? clamp(eng.acc / eng.tick, 0, 1) : 1;

    // The comet tail — glowing segments, brightest at the head.
    const n = eng.body.length;
    for (let i = n - 1; i >= 1; i--) {
      const cur = eng.body[i];
      const prev = eng.prev[i] || cur;
      // Interpolate the short (wrapped) way; skip the tween across a wrap seam.
      const dx = wrapDelta(prev.x, cur.x, COLS);
      const dy = wrapDelta(prev.y, cur.y, ROWS);
      const gx = (prev.x + dx * t + 0.5) * CELL;
      const gy = (prev.y + dy * t + 0.5) * CELL;

      const frac = 1 - i / n; // 1 near head, →0 at tail tip
      const rad = CELL * (0.28 + frac * 0.16);
      const twk = eng.reduced ? 1 : 0.85 + Math.sin(eng.starTw * 0.6 + i * 0.5) * 0.15;

      if (!eng.reduced) {
        const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, rad * 2.2);
        glow.addColorStop(0, 'rgba(0,179,179,0.35)');
        glow.addColorStop(1, 'rgba(0,179,179,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(gx, gy, rad * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Segment body: teal→violet gradient down the tail.
      ctx.fillStyle = i / n < 0.5 ? pal.teal : pal.violet;
      ctx.globalAlpha = 0.6 + frac * 0.4 * twk;
      ctx.beginPath();
      ctx.arc(gx, gy, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Collectible star (twinkling four-point sparkle).
    {
      const tw = eng.reduced ? 1 : 0.7 + Math.abs(Math.sin(eng.starTw)) * 0.5;
      const R = CELL * 0.4 * tw;
      const cx = (eng.star.x + 0.5) * CELL;
      const cy = (eng.star.y + 0.5) * CELL;
      if (!eng.reduced) {
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 2.4);
        glow.addColorStop(0, 'rgba(255,207,51,0.5)');
        glow.addColorStop(1, 'rgba(255,207,51,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = pal.sunshine;
      ctx.beginPath();
      ctx.moveTo(0, -R);
      ctx.lineTo(R * 0.28, -R * 0.28);
      ctx.lineTo(R, 0);
      ctx.lineTo(R * 0.28, R * 0.28);
      ctx.lineTo(0, R);
      ctx.lineTo(-R * 0.28, R * 0.28);
      ctx.lineTo(-R, 0);
      ctx.lineTo(-R * 0.28, -R * 0.28);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // The comet head (pugglenaut), interpolated toward its target cell.
    {
      const cur = eng.body[0];
      const prev = eng.prev[0] || cur;
      const dx = wrapDelta(prev.x, cur.x, COLS);
      const dy = wrapDelta(prev.y, cur.y, ROWS);
      const gx = (prev.x + dx * t + 0.5) * CELL;
      const gy = (prev.y + dy * t + 0.5) * CELL;
      drawHead(ctx, gx, gy, CELL * 0.44, eng.dir, pal, eng.reduced);
    }

    // Live HUD (drawn on-canvas so it never costs a React render).
    if (eng.phase === 'playing' || eng.phase === 'gameover') {
      ctx.textBaseline = 'top';
      ctx.font = `16px ${pal.pixel}`;
      ctx.fillStyle = pal.text;
      ctx.textAlign = 'left';
      ctx.fillText(`SCORE ${eng.score}`, 12, 10);
      const bestNow = Math.max(bestRef.current, eng.score);
      ctx.textAlign = 'right';
      ctx.fillStyle = pal.sunshine;
      ctx.fillText(`BEST ${bestNow}`, WORLD_W - 12, 10);
      ctx.textAlign = 'left';
    }

    // Death flash.
    if (eng.deathFlash > 0) {
      ctx.fillStyle = `rgba(255,46,151,${eng.deathFlash * 0.35})`;
      ctx.fillRect(-20, -20, WORLD_W + 40, WORLD_H + 40);
    }

    // Paused veil.
    if (eng.paused && eng.phase === 'playing') {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(-20, -20, WORLD_W + 40, WORLD_H + 40);
      ctx.fillStyle = pal.text;
      ctx.font = `22px ${pal.pixel}`;
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', WORLD_W / 2, WORLD_H / 2 - 12);
      ctx.textAlign = 'left';
    }
  }, []);

  /* --- Steering ---------------------------------------------------------- */

  // Queue a heading, rejecting a direct 180° reversal into the neck.
  const steer = useCallback((dx: number, dy: number) => {
    const eng = engineRef.current;
    if (!eng || eng.phase !== 'playing') return;
    // Compare against the committed dir so a fast double-tap can't fold back.
    if (dx === -eng.dir.x && dy === -eng.dir.y) return;
    if (dx === eng.dir.x && dy === eng.dir.y) return;
    eng.nextDir = { x: dx, y: dy };
  }, []);

  /* --- Main effect: canvas sizing, input, and the rAF loop --------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setBest(readBest());
    engineRef.current = resetEngine();

    // --- Sizing (devicePixelRatio-aware) ---
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const eng = engineRef.current;
      if (eng) {
        eng.scaleX = canvas.width / WORLD_W;
        eng.scaleY = canvas.height / WORLD_H;
      }
    };
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);
    window.addEventListener('resize', resize);

    // Refresh the palette when the theme attribute flips (Paper/CRT/Sketch).
    const mo = new MutationObserver(() => {
      const eng = engineRef.current;
      if (eng) eng.palette = readPalette();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-rp-theme'] });

    // Track reduced-motion changes live.
    const mq =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    const onReduced = () => {
      const eng = engineRef.current;
      if (eng) eng.reduced = !!mq?.matches;
    };
    mq?.addEventListener?.('change', onReduced);

    // --- Pause on blur / hidden tab ---
    const pause = () => {
      const eng = engineRef.current;
      if (eng) eng.paused = true;
    };
    const resume = () => {
      const eng = engineRef.current;
      if (eng) eng.paused = false;
      last = performance.now();
    };
    const onVisibility = () => {
      if (document.hidden) pause();
      else resume();
    };
    window.addEventListener('blur', pause);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', onVisibility);

    // --- Keyboard ---
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          steer(0, -1);
          e.preventDefault();
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          steer(0, 1);
          e.preventDefault();
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          steer(-1, 0);
          e.preventDefault();
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          steer(1, 0);
          e.preventDefault();
          break;
        case ' ':
        case 'Enter':
          if (phaseRef.current !== 'playing') {
            e.preventDefault();
            startRun();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);

    // --- Pointer / touch: swipe to steer, tap to start ---
    let sx0 = 0;
    let sy0 = 0;
    let swiping = false;
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault(); // keep the page from scrolling under the swipe
      const tch = e.changedTouches[0];
      if (!tch) return;
      sx0 = tch.clientX;
      sy0 = tch.clientY;
      swiping = true;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!swiping) return;
      e.preventDefault();
      const tch = e.changedTouches[0];
      if (!tch) return;
      const dx = tch.clientX - sx0;
      const dy = tch.clientY - sy0;
      if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return;
      if (Math.abs(dx) > Math.abs(dy)) steer(dx > 0 ? 1 : -1, 0);
      else steer(0, dy > 0 ? 1 : -1);
      // Re-anchor so a continued drag can turn again.
      sx0 = tch.clientX;
      sy0 = tch.clientY;
    };
    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      const tch = e.changedTouches[0];
      const moved =
        tch && (Math.abs(tch.clientX - sx0) > 4 || Math.abs(tch.clientY - sy0) > 4);
      // A tap (no real movement) from idle/gameover starts a run.
      if (!moved && phaseRef.current !== 'playing') startRun();
      swiping = false;
    };
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });
    // Mouse click on the canvas from idle/gameover also starts a run.
    const onMouseDown = () => {
      if (phaseRef.current !== 'playing') startRun();
    };
    canvas.addEventListener('mousedown', onMouseDown);

    // --- The loop: fixed-timestep accumulator ---
    let last = performance.now();
    const frame = (now: number) => {
      rafRef.current = requestAnimationFrame(frame);
      const eng = engineRef.current;
      if (!eng) return;

      let elapsed = (now - last) / 1000;
      last = now;
      if (elapsed > MAX_FRAME) elapsed = MAX_FRAME;

      if (!eng.paused) {
        // Twinkle/glow phase advances every frame for a little life.
        eng.starTw += elapsed * 6;

        if (eng.phase === 'playing') {
          eng.acc += elapsed;
          // Fixed sub-steps keep timing steady; a grid step fires each `tick`.
          let guard = 0;
          while (eng.acc >= eng.tick && guard < 8) {
            eng.acc -= eng.tick;
            tickStep(eng);
            if (eng.phase !== 'playing') {
              eng.acc = 0;
              break;
            }
            guard++;
          }
        }

        // Decay transient effects (frame-rate independent-ish).
        if (eng.shake > 0) eng.shake = Math.max(0, eng.shake - elapsed * 24);
        if (eng.deathFlash > 0) eng.deathFlash = Math.max(0, eng.deathFlash - elapsed * 2);
      }

      render(eng, ctx);
    };
    // FIXED_DT participates only as documentation of the intended cadence; the
    // grid step is driven by `eng.tick` above. (Kept for parity with PuggleGame.)
    void FIXED_DT;
    rafRef.current = requestAnimationFrame(frame);

    // --- Cleanup ---
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      ro?.disconnect();
      mo.disconnect();
      mq?.removeEventListener?.('change', onReduced);
      window.removeEventListener('resize', resize);
      window.removeEventListener('blur', pause);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
      canvas.removeEventListener('mousedown', onMouseDown);
    };
  }, [render, resetEngine, startRun, steer, tickStep]);

  /* --- Overlays ----------------------------------------------------------- */

  return (
    <div className="pg-snake-shell" ref={shellRef} tabIndex={0} aria-label="Comet Snake game">
      <p className="pg-snake-sr-only">
        Comet Snake is a chill retro snake game. You steer a comet — a pugglenaut, a baby platypus
        in an astronaut helmet, leading a glowing tail of segments — around a grid. Use the arrow
        keys or W, A, S, D to change direction, or swipe on the play area on a touch screen. Eat the
        twinkling stars to grow your tail and raise your score; the comet speeds up a little as it
        grows. The edges wrap around, so you never hit a wall, but running into your own tail ends
        the run. Press Space or Enter to start and to restart. Your best score is saved in this
        browser. This is a visual arcade game.
      </p>

      <div className="pg-snake-stage">
        <canvas
          ref={canvasRef}
          className="pg-snake-canvas"
          role="img"
          aria-label="Comet Snake play area"
        />

        {phase === 'idle' && (
          <div className="pg-snake-overlay">
            <div className="pg-snake-card">
              <h2 className="pg-snake-card-title">Comet Snake</h2>
              <p className="pg-snake-howto">
                Steer with <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> / <kbd>WASD</kbd> or
                swipe — eat stars to grow, don't bite your own tail. Edges wrap!
              </p>
              <div className="pg-snake-stats">
                <div className="pg-snake-stat">
                  <span className="pg-snake-stat-label">Best</span>
                  <span className="pg-snake-stat-value is-best">{best}</span>
                </div>
              </div>
              <div className="pg-snake-actions">
                <Button variant="primary" icon="star" size="lg" onClick={startRun}>
                  Start
                </Button>
              </div>
            </div>
          </div>
        )}

        {phase === 'gameover' && (
          <div className="pg-snake-overlay">
            <div className="pg-snake-card">
              <h2 className="pg-snake-card-title">Burnout!</h2>
              <p className="pg-snake-card-sub">The comet crossed its own tail.</p>
              <div className="pg-snake-stats">
                <div className="pg-snake-stat">
                  <span className="pg-snake-stat-label">Score</span>
                  <span className="pg-snake-stat-value">{score}</span>
                </div>
                <div className="pg-snake-stat">
                  <span className="pg-snake-stat-label">Best</span>
                  <span className="pg-snake-stat-value is-best">{best}</span>
                </div>
              </div>
              <div className="pg-snake-actions">
                <Button variant="primary" icon="refresh" size="lg" onClick={startRun}>
                  Restart
                </Button>
              </div>
              <p className="pg-snake-note">Best score is saved locally in this browser.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
