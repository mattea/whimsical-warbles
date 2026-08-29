import { useEffect, useRef, useState } from 'react';
import '../styles/companion.css';

/**
 * CursorCompanion — an opt-in tiny pugglenaut that follows the mouse.
 *
 * It is a self-driving island: the orchestrator mounts it once via
 * `<CursorCompanion client:idle />` and never passes props. Behavior is driven
 * entirely by:
 *   • localStorage key `pugglenaut-companion` ('on' | 'off', default 'off'),
 *   • a window CustomEvent `pugglenaut:companion` with detail `{ on: boolean }`
 *     — a header toggle button and a console command (both wired by the
 *     orchestrator) dispatch this to enable/disable at runtime; we persist the
 *     new value to localStorage.
 *
 * When ENABLED (and only on fine-pointer devices, and NOT under
 * prefers-reduced-motion), a small (~40px) inline-SVG pugglenaut — helmet +
 * bill, mirroring public/favicon.svg + BoopMascot — is rendered in a
 * position:fixed, pointer-events:none, high-z-index element that follows the
 * cursor with a gentle spring lag (lerp). It leans toward its direction of
 * travel and does a tiny idle bob when the cursor is still; a short, capped
 * trail of sparkles fades behind it.
 *
 * When DISABLED (or unmounted): the pointermove listener is removed, the rAF
 * loop is cancelled, and nothing is rendered. No leaks.
 *
 * The companion is purely decorative (aria-hidden). All fast-changing motion
 * lives in refs + a single rAF loop and is written straight to the DOM via
 * transforms, so following the cursor never triggers a React re-render.
 */

const STORAGE_KEY = 'pugglenaut-companion';
const TOGGLE_EVENT = 'pugglenaut:companion';

/** Spring/lerp factor per frame — lower = laggier, floatier follow. */
const EASE = 0.14;
/** Max concurrent sparkles in the fading trail. */
const MAX_SPARKLES = 6;
/** Min pointer travel (px) between spawned sparkles. */
const SPARKLE_MIN_DIST = 26;

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

function hasFinePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: fine)').matches
  );
}

interface Sparkle {
  id: number;
  x: number;
  y: number;
}

export default function CursorCompanion() {
  // `active` is the single gate for whether the companion runs at all: enabled
  // in storage/at runtime AND on a fine pointer AND not reduced-motion.
  const [active, setActive] = useState(false);

  // Whether the *user preference* is on. Kept separate from `active` so that a
  // change in device capability (reduced-motion, pointer) is re-evaluated
  // without losing the persisted opt-in.
  const enabledRef = useRef(false);

  // Live sparkle trail — small enough that re-rendering on spawn/expire is fine.
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);

  // rAF-driven motion state (refs → no re-render on the follow loop).
  const spriteRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const sparkleIdRef = useRef(0);

  // Target (raw pointer) and current (eased) positions.
  const targetRef = useRef({ x: 0, y: 0 });
  const posRef = useRef({ x: 0, y: 0 });
  const seenPointerRef = useRef(false);
  const lastSparkleRef = useRef({ x: 0, y: 0 });
  const bobRef = useRef(0);

  /** Recompute whether the companion should currently be active. */
  const evaluate = () => {
    setActive(enabledRef.current && hasFinePointer() && !prefersReducedMotion());
  };

  // Establish initial preference + gates on mount, and listen for the runtime
  // toggle event. Also react to changes in pointer / reduced-motion.
  useEffect(() => {
    enabledRef.current = readEnabled();
    evaluate();

    const onToggle = (e: Event) => {
      const detail = (e as CustomEvent<{ on?: boolean }>).detail;
      const on = !!(detail && detail.on);
      enabledRef.current = on;
      writeEnabled(on);
      evaluate();
    };
    window.addEventListener(TOGGLE_EVENT, onToggle as EventListener);

    // If capabilities change (e.g. user flips reduced-motion, or a hybrid
    // device gains/loses a fine pointer), re-evaluate the gate live.
    const mqs: MediaQueryList[] = [];
    if (typeof window.matchMedia === 'function') {
      mqs.push(window.matchMedia('(prefers-reduced-motion: reduce)'));
      mqs.push(window.matchMedia('(pointer: fine)'));
    }
    const onMq = () => evaluate();
    mqs.forEach((mq) => {
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onMq);
      else mq.addListener(onMq); // older Safari
    });

    return () => {
      window.removeEventListener(TOGGLE_EVENT, onToggle as EventListener);
      mqs.forEach((mq) => {
        if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onMq);
        else mq.removeListener(onMq);
      });
    };
  }, []);

  // The follow loop — only wired while active. Everything here is torn down
  // when active flips to false (disable / reduced-motion / coarse pointer) or
  // on unmount: pointermove listener removed, rAF cancelled, trail cleared.
  useEffect(() => {
    if (!active) {
      // Ensure a clean slate whenever we go inert.
      seenPointerRef.current = false;
      setSparkles([]);
      return;
    }

    const onMove = (e: PointerEvent | MouseEvent) => {
      targetRef.current = { x: e.clientX, y: e.clientY };
      if (!seenPointerRef.current) {
        // First sighting: teleport the sprite under the cursor so it doesn't
        // fly in from the corner.
        seenPointerRef.current = true;
        posRef.current = { x: e.clientX, y: e.clientY };
        lastSparkleRef.current = { x: e.clientX, y: e.clientY };
      }
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    let lastT = performance.now();
    const step = (now: number) => {
      const dt = Math.min(2.5, (now - lastT) / 16.67); // frames elapsed, clamped
      lastT = now;

      const pos = posRef.current;
      const target = targetRef.current;
      const prevX = pos.x;
      const prevY = pos.y;

      // Frame-rate-independent lerp toward the pointer.
      const k = 1 - Math.pow(1 - EASE, dt);
      pos.x += (target.x - pos.x) * k;
      pos.y += (target.y - pos.y) * k;

      const vx = pos.x - prevX;
      const vy = pos.y - prevY;
      const speed = Math.hypot(vx, vy);

      // Lean toward travel direction; tiny idle bob when nearly still.
      let lean = 0;
      let bobY = 0;
      if (speed > 0.4) {
        lean = Math.max(-16, Math.min(16, vx * 2.2));
      } else {
        bobRef.current += 0.05 * dt;
        bobY = Math.sin(bobRef.current) * 2.4;
      }

      const el = spriteRef.current;
      if (el) {
        el.style.transform =
          `translate3d(${pos.x}px, ${pos.y + bobY}px, 0)` +
          ` translate(-50%, -50%) rotate(${lean}deg)`;
      }

      // Spawn a sparkle when we've travelled far enough (capped, fades via CSS).
      const last = lastSparkleRef.current;
      if (Math.hypot(pos.x - last.x, pos.y - last.y) >= SPARKLE_MIN_DIST) {
        lastSparkleRef.current = { x: pos.x, y: pos.y };
        const id = ++sparkleIdRef.current;
        // Drop the sparkle slightly behind the direction of travel.
        const bx = pos.x - vx * 1.5;
        const by = pos.y - vy * 1.5;
        setSparkles((prev) => {
          const next = [...prev, { id, x: bx, y: by }];
          return next.slice(-MAX_SPARKLES);
        });
      }

      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      window.removeEventListener('pointermove', onMove);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [active]);

  const handleSparkleEnd = (id: number) => {
    setSparkles((prev) => prev.filter((s) => s.id !== id));
  };

  if (!active) return null;

  return (
    <div className="pg-comp-layer" aria-hidden="true">
      {/* Fading sparkle trail — each fixed at its spawn point, fades via CSS. */}
      {sparkles.map((s) => (
        <span
          key={s.id}
          className="pg-comp-sparkle"
          style={{ left: `${s.x}px`, top: `${s.y}px` }}
          onAnimationEnd={() => handleSparkleEnd(s.id)}
        >
          ✦
        </span>
      ))}

      {/* The companion sprite — positioned entirely via JS transform. */}
      <div ref={spriteRef} className="pg-comp-sprite">
        <svg viewBox="0 0 140 140" width="40" height="40" role="img" focusable="false">
          {/* webbed foot / tail hint at the back */}
          <ellipse cx="30" cy="106" rx="16" ry="9" fill="#8f7a45" transform="rotate(-26 30 106)" />
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
          {/* astronaut helmet — translucent white bubble */}
          <circle
            cx="74"
            cy="62"
            r="50"
            fill="rgba(255,255,255,0.16)"
            stroke="rgba(255,255,255,0.85)"
            strokeWidth="2.6"
          />
          {/* helmet highlight glint (top-left) */}
          <path
            d="M40 54 A40 40 0 0 1 62 26"
            fill="none"
            stroke="rgba(255,255,255,0.9)"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}
