/**
 * Opt-in "delights" for the site, kept framework-agnostic so both the header
 * ControlDeck and the Mission Control console can drive them. Everything here
 * is browser-only (guarded by `typeof document`) and every animated effect
 * honors `prefers-reduced-motion`. Nothing here runs on its own — each effect
 * is triggered by an explicit user action, so the default page stays calm.
 */

export const FX_KEYS = {
  sky: 'pugglenaut-fx-sky',
  bubbles: 'pugglenaut-fx-bubbles',
} as const;

function canDom(): boolean {
  return typeof document !== 'undefined';
}

export function prefersReducedMotion(): boolean {
  return (
    canDom() &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'on';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    /* storage unavailable (private mode) — effect still works for the session */
  }
}

/* --------------------------------------------------------------------------
 * Time-aware sky — tints the page background to match the visitor's local hour.
 * Off by default; toggled from a clock icon. The bucket is written to
 * <html data-sky="…">, which global.css turns into a translucent gradient.
 * ------------------------------------------------------------------------ */

export type SkyBucket = 'dawn' | 'day' | 'dusk' | 'night';

export function skyBucketFor(hour: number): SkyBucket {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'dusk';
  return 'night';
}

export function isSkyOn(): boolean {
  return readFlag(FX_KEYS.sky);
}

export function setSky(on: boolean): void {
  if (!canDom()) return;
  const root = document.documentElement;
  if (on) {
    root.dataset.sky = skyBucketFor(new Date().getHours());
  } else {
    delete root.dataset.sky;
  }
  writeFlag(FX_KEYS.sky, on);
}

/* --------------------------------------------------------------------------
 * Bubble trail — tiny rising bubbles follow the cursor (platypus underwater
 * meets astronaut-in-space). Off by default; toggled from a sparkle icon.
 * Skipped entirely under reduced-motion.
 * ------------------------------------------------------------------------ */

let bubbleLayer: HTMLDivElement | null = null;
let bubbleHandler: ((e: PointerEvent) => void) | null = null;
let lastBubble = 0;

export function isBubblesOn(): boolean {
  return readFlag(FX_KEYS.bubbles);
}

export function setBubbles(on: boolean): void {
  if (!canDom()) return;
  writeFlag(FX_KEYS.bubbles, on);

  if (!on || prefersReducedMotion()) {
    if (bubbleHandler) window.removeEventListener('pointermove', bubbleHandler);
    bubbleHandler = null;
    bubbleLayer?.remove();
    bubbleLayer = null;
    return;
  }
  if (bubbleHandler) return; // already running

  bubbleLayer = document.createElement('div');
  bubbleLayer.className = 'fx-bubble-layer';
  bubbleLayer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bubbleLayer);

  bubbleHandler = (e: PointerEvent) => {
    const now = Date.now();
    if (now - lastBubble < 55) return; // throttle
    lastBubble = now;
    const b = document.createElement('span');
    b.className = 'fx-bubble';
    const size = 6 + Math.floor((now % 10)) + (e.pressure ? 4 : 0);
    b.style.left = `${e.clientX}px`;
    b.style.top = `${e.clientY}px`;
    b.style.width = `${size}px`;
    b.style.height = `${size}px`;
    b.addEventListener('animationend', () => b.remove(), { once: true });
    bubbleLayer?.appendChild(b);
  };
  window.addEventListener('pointermove', bubbleHandler, { passive: true });
}

/* --------------------------------------------------------------------------
 * Barrel roll — the ship does a spacewalk tumble. Triggered by the Konami code
 * or the `roll` console command. One-shot; no-op under reduced-motion.
 * ------------------------------------------------------------------------ */

export function barrelRoll(): void {
  if (!canDom() || prefersReducedMotion()) return;
  const body = document.body;
  if (body.classList.contains('fx-roll')) return;
  body.classList.add('fx-roll');
  body.addEventListener(
    'animationend',
    () => body.classList.remove('fx-roll'),
    { once: true },
  );
}

/* --------------------------------------------------------------------------
 * Boot sequence — a skippable retro power-on / POST screen. Triggered by the
 * power (▶) icon or the `boot` console command; never auto-plays. Returns a
 * promise that resolves when the sequence finishes or the visitor skips.
 * ------------------------------------------------------------------------ */

const BOOT_LINES = [
  'PUGGLENAUT BIOS v0.1 ......... OK',
  'Monotreme life-support ....... ONLINE',
  'Helmet seal .................. NOMINAL',
  'Snack reserves ............... 98%',
  'Cosmic-vibe antenna .......... CALIBRATED',
  'Loading whimsy.sys ...........',
  '',
  '>> Welcome aboard, pugglenaut.',
];

export function runBootSequence(): Promise<void> {
  if (!canDom()) return Promise.resolve();
  // Don't stack two boot overlays.
  if (document.querySelector('.fx-boot')) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fx-boot';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Boot sequence');

    const screen = document.createElement('pre');
    screen.className = 'fx-boot-screen';
    overlay.appendChild(screen);

    const hint = document.createElement('div');
    hint.className = 'fx-boot-hint';
    hint.textContent = 'press any key to skip';
    overlay.appendChild(hint);

    document.body.appendChild(overlay);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    let done = false;
    const timers: number[] = [];
    const finish = () => {
      if (done) return;
      done = true;
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener('keydown', finish);
      overlay.removeEventListener('click', finish);
      overlay.classList.add('is-leaving');
      window.setTimeout(() => {
        overlay.remove();
        document.body.style.overflow = prevOverflow;
        resolve();
      }, 260);
    };

    if (prefersReducedMotion()) {
      // Show the whole readout at once, then hold briefly.
      screen.textContent = BOOT_LINES.join('\n');
      timers.push(window.setTimeout(finish, 1400));
    } else {
      const step = 260;
      BOOT_LINES.forEach((line, i) => {
        timers.push(
          window.setTimeout(() => {
            screen.textContent += (i ? '\n' : '') + line;
          }, i * step),
        );
      });
      timers.push(window.setTimeout(finish, BOOT_LINES.length * step + 900));
    }

    window.addEventListener('keydown', finish);
    overlay.addEventListener('click', finish);
  });
}

/* --------------------------------------------------------------------------
 * Konami code — ↑↑↓↓←→←→ B A. Always listening, but only ever fires on the
 * exact sequence, so it's inert until deliberately summoned. Returns a cleanup
 * function.
 * ------------------------------------------------------------------------ */

const KONAMI = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a',
];

export function initKonami(onTrigger: () => void): () => void {
  if (!canDom()) return () => {};
  let idx = 0;
  const onKey = (e: KeyboardEvent) => {
    const want = KONAMI[idx];
    if (e.key.toLowerCase() === want.toLowerCase()) {
      idx += 1;
      if (idx === KONAMI.length) {
        idx = 0;
        onTrigger();
      }
    } else {
      // Allow a fresh start if the mistaken key was the first key.
      idx = e.key.toLowerCase() === KONAMI[0].toLowerCase() ? 1 : 0;
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
