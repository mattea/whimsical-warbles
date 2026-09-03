import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Input, Table } from '@retropolis/ui';
import { apiEnabled, getHighScores, postHighScore, type HighScore } from '../lib/api';
import '../styles/game.css';

/**
 * Puggle Drift — an endless jetpack dodger played on a <canvas>.
 *
 * The pugglenaut (a baby platypus in an astronaut helmet) falls under gravity;
 * hold thrust to rise. The world scrolls right→left and slowly speeds up while
 * asteroids and twinkling bonus stars stream past. Touch the top/bottom of the
 * play area or an asteroid and the run ends.
 *
 * All the fast-changing game state lives in a single mutable ref (`engineRef`)
 * driven by one requestAnimationFrame loop, so gameplay never triggers React
 * re-renders. React only handles the surrounding UI: the start / game-over
 * cards and the leaderboard. Every browser API is touched inside effects and
 * torn down on unmount, since this island mounts with `client:load`.
 */

/* ---- World constants (a fixed 3:2 virtual space, scaled to the display) -- */

const WORLD_W = 600;
const WORLD_H = 400;
const PUG_X = 140; // the pugglenaut holds a fixed x; the world moves past it
const PUG_R = 17;

const GRAVITY = 1200; // px/s² pulling down
const THRUST = -2500; // px/s² added while thrusting (net lift ≈ 1300 up)
const VY_MIN = -340; // clamp rise speed
const VY_MAX = 520; // clamp fall speed

const START_SPEED = 155; // world scroll, px/s
const MAX_SPEED = 360;
const SPEED_RAMP = 4.5; // px/s gained per second survived

const FIXED_DT = 1 / 120; // fixed-timestep for deterministic physics
const MAX_FRAME = 0.25; // clamp huge gaps (tab was backgrounded)

const BEST_KEY = 'pugglenaut-best';
const MAX_NAME = 16;

type Phase = 'idle' | 'playing' | 'gameover';

interface Asteroid {
  x: number;
  y: number;
  r: number;
  rot: number;
  spin: number;
  verts: number[]; // per-vertex radius multipliers → a rough rocky circle
}

interface Star {
  x: number;
  y: number;
  r: number;
  tw: number; // twinkle phase
}

interface BgStar {
  x: number;
  y: number;
  r: number;
  layer: number; // 0..2, controls parallax speed + brightness
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
  thrusting: boolean;
  paused: boolean;

  // pugglenaut
  py: number;
  vy: number;
  flame: number; // 0..1 flicker envelope

  speed: number;
  elapsed: number;
  distance: number;
  starBonus: number;

  asteroids: Asteroid[];
  stars: Star[];
  bg: BgStar[];
  nextAsteroid: number; // seconds until next spawn
  nextStar: number;

  shake: number; // decaying screen-shake magnitude (px)
  deathFlash: number;

  reduced: boolean;
  palette: Palette;

  // canvas → world scale (device px per world unit)
  scaleX: number;
  scaleY: number;
}

/* ---- Small helpers ------------------------------------------------------ */

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

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

function makeBgStars(): BgStar[] {
  const stars: BgStar[] = [];
  const count = 46;
  for (let i = 0; i < count; i++) {
    const layer = i % 3;
    stars.push({
      x: rand(0, WORLD_W),
      y: rand(0, WORLD_H),
      r: 0.6 + layer * 0.7,
      layer,
    });
  }
  return stars;
}

function makeAsteroid(): Asteroid {
  const r = rand(16, 40);
  const verts: number[] = [];
  const n = 10;
  for (let i = 0; i < n; i++) verts.push(rand(0.78, 1.16));
  return {
    x: WORLD_W + r + 8,
    y: rand(r + 12, WORLD_H - r - 12),
    r,
    rot: rand(0, Math.PI * 2),
    spin: rand(-0.8, 0.8),
    verts,
  };
}

function makeStar(): Star {
  return {
    x: WORLD_W + 20,
    y: rand(40, WORLD_H - 40),
    r: 9,
    tw: rand(0, Math.PI * 2),
  };
}

/* ---- The pugglenaut, drawn from canvas primitives ----------------------- */

function drawPugglenaut(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  vy: number,
  flame: number,
  pal: Palette,
) {
  const tilt = clamp(vy / 900, -0.35, 0.5); // nose up when rising, down when falling
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);

  // Rocket flame (behind the body) while thrusting.
  if (flame > 0.02) {
    const fl = flame * (0.8 + Math.random() * 0.4);
    ctx.save();
    ctx.translate(-r * 0.95, r * 0.35);
    const grad = ctx.createLinearGradient(0, 0, -r * 1.8 * fl, 0);
    grad.addColorStop(0, pal.sunshine);
    grad.addColorStop(0.6, pal.magenta);
    grad.addColorStop(1, 'rgba(255,46,151,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.4);
    ctx.quadraticCurveTo(-r * 1.9 * fl, 0, 0, r * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Body — a rounded tan/khaki blob (baby platypus "puggle").
  const bodyFill = '#cbb27a';
  const bodyEdge = '#8f7a45';
  ctx.lineWidth = 2;
  ctx.strokeStyle = bodyEdge;
  ctx.fillStyle = bodyFill;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.06, r * 0.94, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // A little webbed foot/tail hint at the back.
  ctx.fillStyle = bodyEdge;
  ctx.beginPath();
  ctx.ellipse(-r * 0.7, r * 0.55, r * 0.34, r * 0.22, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // Duck bill — a dark, flat rounded paddle at the front.
  ctx.fillStyle = '#3a3140';
  const bx = r * 0.72;
  const by = r * 0.1;
  const bw = r * 0.62;
  const bh = r * 0.34;
  ctx.beginPath();
  const rr = bh * 0.5;
  ctx.moveTo(bx - bw + rr, by - bh / 2);
  ctx.arcTo(bx, by - bh / 2, bx, by, rr);
  ctx.arcTo(bx, by + bh / 2, bx - bw, by + bh / 2, rr);
  ctx.arcTo(bx - bw, by + bh / 2, bx - bw, by - bh / 2, rr);
  ctx.arcTo(bx - bw, by - bh / 2, bx, by - bh / 2, rr);
  ctx.closePath();
  ctx.fill();

  // Eye peeking inside the helmet.
  ctx.fillStyle = '#20202a';
  ctx.beginPath();
  ctx.arc(r * 0.3, -r * 0.18, r * 0.13, 0, Math.PI * 2);
  ctx.fill();

  // Astronaut helmet — a translucent white bubble with a rim + highlight.
  ctx.beginPath();
  ctx.arc(r * 0.15, -r * 0.05, r * 0.98, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fill();
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.stroke();

  // Helmet highlight arc (top-left glint).
  ctx.beginPath();
  ctx.arc(r * 0.15, -r * 0.05, r * 0.78, Math.PI * 1.05, Math.PI * 1.5);
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();

  ctx.restore();
}

/* ======================================================================== */

export default function PuggleGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const rafRef = useRef<number | null>(null);
  const phaseRef = useRef<Phase>('idle');
  const startedAtRef = useRef<number>(0);

  // UI state (low-frequency — set at phase transitions, not per frame).
  const [phase, setPhase] = useState<Phase>('idle');
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  // Mirror `best` into a ref so the render loop (which must not depend on React
  // state) can draw the live "BEST" HUD without re-subscribing every update.
  const bestRef = useRef(0);
  useEffect(() => {
    bestRef.current = best;
  }, [best]);

  // Leaderboard / submit state.
  const [board, setBoard] = useState<HighScore[] | null>(null);
  const [boardStatus, setBoardStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [name, setName] = useState('');
  const [website, setWebsite] = useState(''); // honeypot — stays empty for humans
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>(
    'idle',
  );
  const [submitError, setSubmitError] = useState('');

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  /* --- Engine lifecycle -------------------------------------------------- */

  const resetEngine = useCallback((): Engine => {
    return {
      phase: 'idle',
      thrusting: false,
      paused: false,
      py: WORLD_H * 0.42,
      vy: 0,
      flame: 0,
      speed: START_SPEED,
      elapsed: 0,
      distance: 0,
      starBonus: 0,
      asteroids: [],
      stars: [],
      bg: makeBgStars(),
      nextAsteroid: 0.9,
      nextStar: 1.8,
      shake: 0,
      deathFlash: 0,
      reduced: prefersReducedMotion(),
      palette: readPalette(),
      // Seed the world→canvas scale from the CURRENT canvas so a game started
      // (or restarted) mid-session draws full-size. Without this, a fresh engine
      // defaulted to 1:1 and the 600×400 world filled only ~2/3 of a larger
      // canvas until the next window resize recomputed it. resize() keeps this
      // in sync afterwards.
      scaleX: canvasRef.current ? canvasRef.current.width / WORLD_W : 1,
      scaleY: canvasRef.current ? canvasRef.current.height / WORLD_H : 1,
    };
  }, []);

  const currentScore = useCallback((eng: Engine): number => {
    return Math.floor(eng.distance * 0.06) + eng.starBonus;
  }, []);

  const startRun = useCallback(() => {
    const eng = resetEngine();
    eng.phase = 'playing';
    eng.palette = readPalette();
    eng.reduced = prefersReducedMotion();
    engineRef.current = eng;
    startedAtRef.current = Date.now();
    // Reset submit flow for the new run.
    setSubmitStatus('idle');
    setSubmitError('');
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
    eng.thrusting = false;
    eng.deathFlash = eng.reduced ? 0 : 1;
    eng.shake = eng.reduced ? 0 : 10;
    const final = currentScore(eng);
    setScore(final);
    setBest((prev) => {
      const next = Math.max(prev, final);
      if (next > prev) writeBest(next);
      return next;
    });
    setPhaseBoth('gameover');
  }, [currentScore, setPhaseBoth]);

  /* --- Physics + spawning (one fixed-timestep step) ---------------------- */

  const step = useCallback(
    (eng: Engine, dt: number) => {
      if (eng.phase !== 'playing') return;

      eng.elapsed += dt;
      eng.speed = Math.min(MAX_SPEED, START_SPEED + eng.elapsed * SPEED_RAMP);
      eng.distance += eng.speed * dt;

      // Vertical physics.
      eng.vy += GRAVITY * dt;
      if (eng.thrusting) eng.vy += THRUST * dt;
      eng.vy = clamp(eng.vy, VY_MIN, VY_MAX);
      eng.py += eng.vy * dt;

      // Flame envelope follows thrust.
      eng.flame += ((eng.thrusting ? 1 : 0) - eng.flame) * Math.min(1, dt * 18);

      // Out-of-bounds (top/bottom) ends the run.
      if (eng.py - PUG_R <= 0 || eng.py + PUG_R >= WORLD_H) {
        eng.py = clamp(eng.py, PUG_R, WORLD_H - PUG_R);
        endRun();
        return;
      }

      // Parallax background drift.
      const bgFactor = eng.reduced ? 0.25 : 1;
      for (const b of eng.bg) {
        b.x -= eng.speed * (0.18 + b.layer * 0.28) * bgFactor * dt;
        if (b.x < -2) {
          b.x += WORLD_W + 4;
          b.y = rand(0, WORLD_H);
        }
      }

      // Spawn asteroids on a speed-scaled cadence.
      eng.nextAsteroid -= dt;
      if (eng.nextAsteroid <= 0) {
        eng.asteroids.push(makeAsteroid());
        eng.nextAsteroid = rand(0.85, 1.5) * (START_SPEED / eng.speed);
      }
      // Spawn collectible stars.
      eng.nextStar -= dt;
      if (eng.nextStar <= 0) {
        eng.stars.push(makeStar());
        eng.nextStar = rand(1.6, 3.4);
      }

      // Move + test asteroids.
      for (let i = eng.asteroids.length - 1; i >= 0; i--) {
        const a = eng.asteroids[i];
        a.x -= eng.speed * dt;
        a.rot += a.spin * dt;
        if (a.x + a.r < -8) {
          eng.asteroids.splice(i, 1);
          continue;
        }
        const dx = PUG_X - a.x;
        const dy = eng.py - a.y;
        const hit = a.r * 0.84 + PUG_R * 0.8;
        if (dx * dx + dy * dy < hit * hit) {
          endRun();
          return;
        }
      }

      // Move + collect stars.
      for (let i = eng.stars.length - 1; i >= 0; i--) {
        const st = eng.stars[i];
        st.x -= eng.speed * dt;
        st.tw += dt * 6;
        if (st.x + st.r < -8) {
          eng.stars.splice(i, 1);
          continue;
        }
        const dx = PUG_X - st.x;
        const dy = eng.py - st.y;
        const reach = st.r + PUG_R;
        if (dx * dx + dy * dy < reach * reach) {
          eng.stars.splice(i, 1);
          eng.starBonus += 25;
          if (!eng.reduced) eng.shake = Math.min(eng.shake + 3, 6);
        }
      }

      // Decay transient effects.
      if (eng.shake > 0) eng.shake = Math.max(0, eng.shake - dt * 22);
      if (eng.deathFlash > 0) eng.deathFlash = Math.max(0, eng.deathFlash - dt * 2);
    },
    [endRun],
  );

  /* --- Rendering --------------------------------------------------------- */

  const render = useCallback((eng: Engine, ctx: CanvasRenderingContext2D) => {
    const pal = eng.palette;

    let sx = 0;
    let sy = 0;
    if (eng.shake > 0) {
      sx = rand(-eng.shake, eng.shake);
      sy = rand(-eng.shake, eng.shake);
    }
    ctx.setTransform(eng.scaleX, 0, 0, eng.scaleY, sx * eng.scaleX, sy * eng.scaleY);

    // Sky.
    ctx.fillStyle = pal.bg;
    ctx.fillRect(-20, -20, WORLD_W + 40, WORLD_H + 40);

    // Parallax starfield.
    for (const b of eng.bg) {
      const bright = 0.28 + b.layer * 0.22;
      ctx.globalAlpha = bright;
      ctx.fillStyle = b.layer === 2 ? pal.teal : pal.text;
      ctx.fillRect(b.x, b.y, b.r, b.r);
    }
    ctx.globalAlpha = 1;

    // Collectible stars (twinkling four-point sparkles).
    for (const st of eng.stars) {
      const tw = 0.7 + Math.abs(Math.sin(st.tw)) * 0.5;
      const R = st.r * tw;
      ctx.save();
      ctx.translate(st.x, st.y);
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

    // Asteroids (rough rocky circles).
    for (const a of eng.asteroids) {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.rot);
      ctx.beginPath();
      const n = a.verts.length;
      for (let i = 0; i <= n; i++) {
        const idx = i % n;
        const ang = (idx / n) * Math.PI * 2;
        const rr = a.r * a.verts[idx];
        const vx = Math.cos(ang) * rr;
        const vy = Math.sin(ang) * rr;
        if (i === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.fillStyle = pal.violet;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = pal.border;
      ctx.stroke();
      // A couple of craters for texture.
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.arc(a.r * 0.2, -a.r * 0.15, a.r * 0.18, 0, Math.PI * 2);
      ctx.arc(-a.r * 0.25, a.r * 0.22, a.r * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // The pugglenaut.
    drawPugglenaut(ctx, PUG_X, eng.py, PUG_R, eng.vy, eng.phase === 'playing' ? eng.flame : 0, pal);

    // Live HUD (drawn on-canvas so it never costs a React render).
    if (eng.phase === 'playing' || eng.phase === 'gameover') {
      const s = currentScore(eng);
      ctx.textBaseline = 'top';
      ctx.font = `16px ${pal.pixel}`;
      ctx.fillStyle = pal.text;
      ctx.fillText(`SCORE ${s}`, 12, 10);
      const bestNow = Math.max(bestRef.current, s);
      const label = `BEST ${bestNow}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = pal.sunshine;
      ctx.fillText(label, WORLD_W - 12, 10);
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
  }, [currentScore]);

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

    // --- Pause on blur / hidden tab ---
    const pause = () => {
      const eng = engineRef.current;
      if (eng) {
        eng.paused = true;
        eng.thrusting = false;
      }
    };
    const resume = () => {
      const eng = engineRef.current;
      if (eng) eng.paused = false;
      last = performance.now();
      acc = 0;
    };
    const onVisibility = () => {
      if (document.hidden) pause();
      else resume();
    };
    window.addEventListener('blur', pause);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', onVisibility);

    // --- Keyboard ---
    const isThrustKey = (k: string) => k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W';
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // Never hijack typing in the name field or other inputs.
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (isThrustKey(e.key)) {
        if (phaseRef.current === 'playing') {
          const eng = engineRef.current;
          if (eng) eng.thrusting = true;
          e.preventDefault(); // stop the page scrolling on Space/ArrowUp
        } else if (e.key === ' ') {
          e.preventDefault();
          startRun();
        }
      } else if (e.key === 'Enter') {
        if (phaseRef.current !== 'playing') startRun();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (isThrustKey(e.key)) {
        const eng = engineRef.current;
        if (eng) eng.thrusting = false;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // --- Pointer / touch ---
    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      if (phaseRef.current === 'playing') {
        const eng = engineRef.current;
        if (eng) eng.thrusting = true;
      }
      // Tapping the canvas from idle/gameover starts a run.
      else {
        startRun();
      }
    };
    const stopThrust = () => {
      const eng = engineRef.current;
      if (eng) eng.thrusting = false;
    };
    // touchstart with passive:false so preventDefault actually blocks scroll.
    const onTouchStart = (e: TouchEvent) => e.preventDefault();
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', stopThrust);
    canvas.addEventListener('pointercancel', stopThrust);
    canvas.addEventListener('pointerleave', stopThrust);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });

    // --- The loop: fixed-timestep accumulator ---
    let last = performance.now();
    let acc = 0;
    const frame = (now: number) => {
      rafRef.current = requestAnimationFrame(frame);
      const eng = engineRef.current;
      if (!eng) return;

      let elapsed = (now - last) / 1000;
      last = now;
      if (elapsed > MAX_FRAME) elapsed = MAX_FRAME;

      if (!eng.paused) {
        acc += elapsed;
        while (acc >= FIXED_DT) {
          step(eng, FIXED_DT);
          acc -= FIXED_DT;
        }
      } else {
        // Still bleed off shake/flash so the paused frame looks settled.
        acc = 0;
      }

      render(eng, ctx);
    };
    rafRef.current = requestAnimationFrame(frame);

    // --- Cleanup ---
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      ro?.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('blur', pause);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', stopThrust);
      canvas.removeEventListener('pointercancel', stopThrust);
      canvas.removeEventListener('pointerleave', stopThrust);
      canvas.removeEventListener('touchstart', onTouchStart);
    };
  }, [render, resetEngine, startRun, step]);

  /* --- Leaderboard fetch (once, if the backend is live) ------------------ */

  useEffect(() => {
    if (!apiEnabled) return;
    let alive = true;
    setBoardStatus('loading');
    getHighScores()
      .then((scores) => {
        if (!alive) return;
        setBoard(scores);
        setBoardStatus('ready');
      })
      .catch(() => {
        if (!alive) return;
        setBoardStatus('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  const submitScore = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (submitStatus === 'submitting' || submitStatus === 'done') return;
      const trimmed = name.trim().slice(0, MAX_NAME);
      if (!trimmed) {
        setSubmitError('Enter a pilot name first.');
        return;
      }
      setSubmitStatus('submitting');
      setSubmitError('');
      try {
        const scores = await postHighScore({
          name: trimmed,
          score,
          website, // honeypot — empty for real players
          startedAt: startedAtRef.current,
        });
        setBoard(scores);
        setBoardStatus('ready');
        setSubmitStatus('done');
      } catch (err) {
        setSubmitStatus('error');
        setSubmitError(
          err instanceof Error && err.message ? err.message : 'Could not submit — try again.',
        );
      }
    },
    [name, score, submitStatus, website],
  );

  /* --- Leaderboard rendering --------------------------------------------- */

  const renderBoard = () => {
    if (boardStatus === 'loading') {
      return <p className="pg-loading">Loading the leaderboard…</p>;
    }
    if (boardStatus === 'error') {
      return <p className="pg-error">Leaderboard is offline right now.</p>;
    }
    if (board && board.length > 0) {
      const rows = board.slice(0, 10).map((h, i) => ({
        rank: i + 1,
        name: h.name,
        score: h.score,
      }));
      return (
        <div className="pg-board">
          <h3 className="pg-board-title">Top pilots</h3>
          <Table
            columns={[
              { key: 'rank', header: '#', align: 'right' },
              { key: 'name', header: 'Pilot' },
              { key: 'score', header: 'Score', align: 'right' },
            ]}
            data={rows}
          />
        </div>
      );
    }
    if (board) {
      return <p className="pg-note">No scores yet — be the first to make the board!</p>;
    }
    return null;
  };

  const renderLeaderboardSection = () => {
    if (!apiEnabled) {
      return (
        <p className="pg-note">
          Global leaderboard lights up once the backend is connected. Your best is saved locally
          for now.
        </p>
      );
    }
    return (
      <>
        {submitStatus !== 'done' ? (
          <form className="pg-form" onSubmit={submitScore}>
            <div className="pg-form-row">
              <Input
                label="Pilot name"
                value={name}
                maxLength={MAX_NAME}
                placeholder="pugglenaut"
                onChange={(e) => setName(e.target.value)}
                disabled={submitStatus === 'submitting'}
              />
              <Button type="submit" variant="primary" icon="star" disabled={submitStatus === 'submitting'}>
                {submitStatus === 'submitting' ? 'Sending…' : 'Submit score'}
              </Button>
            </div>
            {/* Honeypot: hidden from humans + a11y tree; bots fill it and get rejected. */}
            <div className="pg-honeypot" aria-hidden="true">
              <label>
                Website
                <input
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </label>
            </div>
            {submitStatus === 'error' && <p className="pg-error">{submitError}</p>}
          </form>
        ) : (
          <p className="pg-note">Score submitted — nice flying!</p>
        )}
        {renderBoard()}
      </>
    );
  };

  /* --- Overlays ----------------------------------------------------------- */

  return (
    <div className="pg-shell" ref={shellRef} tabIndex={0} aria-label="Puggle Drift game">
      <p className="pg-sr-only">
        Puggle Drift is an endless jetpack dodging game. You pilot the pugglenaut — a baby platypus
        in an astronaut helmet — as it falls under gravity. Hold Space, the up arrow, W, or press
        and hold on the screen to fire the jetpack and rise; release to fall. The world scrolls past
        and slowly speeds up. Avoid asteroids and the top and bottom edges, and collect twinkling
        stars for bonus points. This is a visual arcade game; a text leaderboard of scores is shown
        below when available.
      </p>

      <div className="pg-stage">
        <canvas
          ref={canvasRef}
          className="pg-canvas"
          role="img"
          aria-label="Puggle Drift play area"
        />

        {phase === 'idle' && (
          <div className="pg-overlay">
            <div className="pg-card">
              <h2 className="pg-card-title">Puggle Drift</h2>
              <p className="pg-howto">
                Hold <kbd>Space</kbd> / <kbd>↑</kbd> / <kbd>W</kbd> or tap-and-hold to thrust — dodge
                asteroids, grab stars.
              </p>
              <div className="pg-stats">
                <div className="pg-stat">
                  <span className="pg-stat-label">Best</span>
                  <span className="pg-stat-value is-best">{best}</span>
                </div>
              </div>
              <div className="pg-actions">
                <Button variant="primary" icon="rocket" size="lg" onClick={startRun}>
                  Start
                </Button>
              </div>
            </div>
          </div>
        )}

        {phase === 'gameover' && (
          <div className="pg-overlay">
            <div className="pg-card">
              <h2 className="pg-card-title">Splashdown!</h2>
              <p className="pg-card-sub">The pugglenaut drifted off course.</p>
              <div className="pg-stats">
                <div className="pg-stat">
                  <span className="pg-stat-label">Score</span>
                  <span className="pg-stat-value">{score}</span>
                </div>
                <div className="pg-stat">
                  <span className="pg-stat-label">Best</span>
                  <span className="pg-stat-value is-best">{best}</span>
                </div>
              </div>
              <div className="pg-actions">
                <Button variant="primary" icon="refresh" size="lg" onClick={startRun}>
                  Restart
                </Button>
              </div>
              {renderLeaderboardSection()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
