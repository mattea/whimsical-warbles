import { useEffect, useRef, useState } from 'react';
import { HitCounter } from '@retropolis/ui';
import { apiEnabled, hitCounter } from '../lib/api';
import { prefersReducedMotion } from '../lib/effects';
import '../styles/counter.css';

/**
 * Live visitor hit counter — the 90s odometer, wired to the Pugglenaut backend.
 *
 * Renders the Retropolis `HitCounter` immediately with a decorative starting
 * value (no blank space, no layout shift), then on mount — if the backend is
 * configured — POSTs a single increment and swaps in the real running total.
 * With no backend it just shows a stable, pleasant retro number: clearly
 * decorative, never an error. Any network hiccup degrades to that same number.
 */

/** Shown when the backend is off (or a call fails) — looks like a real counter. */
const DECORATIVE_COUNT = 40096;

/** How far below the target the count-up animation starts. */
const COUNT_UP_LEAD = 120;
/** Duration of the subtle count-up, in ms. */
const COUNT_UP_MS = 900;

interface VisitorCounterProps {
  /** Counter key on the backend. @default "home" */
  page?: string;
  /** Caption under the odometer. @default "pugglenauts aboard" */
  label?: React.ReactNode;
  /** Zero-pad to at least this many digits (passed straight through). */
  digits?: number;
}

export default function VisitorCounter({
  page = 'home',
  label = 'pugglenauts aboard',
  digits,
}: VisitorCounterProps) {
  // Start from the decorative value so the very first paint is a full odometer.
  const [count, setCount] = useState(DECORATIVE_COUNT);

  // Guard the increment against React's double-invoke (StrictMode / remounts):
  // the counter must be hit exactly once per real mount.
  const hitOnce = useRef(false);
  // Track the in-flight rAF so we can cancel it on unmount.
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // No backend: keep the decorative number, nothing to fetch.
    if (!apiEnabled) return;
    if (hitOnce.current) return;
    hitOnce.current = true;

    let cancelled = false;

    hitCounter(page)
      .then(({ count: total }) => {
        if (cancelled) return;
        animateTo(total);
      })
      .catch(() => {
        // Swallow: the decorative number stays put, no error surfaced.
      });

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // Run once per mount; `page` changing is not expected during a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Subtle count-up from just below the target to the real total. Snaps
   * straight to the value under reduced-motion (or for a tiny/backwards delta).
   */
  function animateTo(target: number) {
    const from = Math.max(0, target - COUNT_UP_LEAD);
    if (prefersReducedMotion() || target - from < 2) {
      setCount(target);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS);
      // easeOutCubic — quick to arrive, then settles.
      const eased = 1 - Math.pow(1 - t, 3);
      setCount(Math.round(from + (target - from) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        setCount(target); // land exactly on the total
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  return (
    <div className="pg-vc">
      <HitCounter count={count} label={label} {...(digits != null ? { digits } : {})} />
    </div>
  );
}
