import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Input, Card } from '@retropolis/ui';
import '../styles/oracle.css';

/**
 * Ask the Cosmos — a fully static, backend-free cosmic magic-8-ball.
 *
 * The visitor (optionally) types a yes/no question, then taps the cosmic orb or
 * the "Consult the cosmos" button. The orb does a brief swirl/shake, then a
 * random fortune is revealed in a Retropolis Card. "Consult again" rerolls.
 *
 * Everything runs in the browser: the fortunes are a hard-coded list and the
 * pick is `Math.random`, so this island is self-contained and mounts happily
 * with `client:visible`. It never repeats the same fortune twice in a row, and
 * it honors `prefers-reduced-motion` by skipping the shake + revealing instantly.
 */

/* ---- The curated fortune deck ------------------------------------------- */
/* A playful mix: affirmative, negative, and cryptic — all space/puggle-flavored. */

const FORTUNES: string[] = [
  // Affirmative
  'The stars say: absolutely.',
  'Orbit confirmed — yes.',
  'The constellations align in your favor.',
  'Mission control gives a thumbs-up.',
  'Yes. The puggle has spoken (through a mouthful of snacks).',
  'All telemetry points to yes.',
  'The comet says go for it.',
  'A resounding yes echoes across the void.',
  // Negative
  'The void is non-committal today.',
  'Sensors say: probably not.',
  'The nebula shakes its head, gently.',
  'Not in this galaxy, friend.',
  'The moon has filed a polite objection.',
  'Signals jammed — the answer is no.',
  'The asteroid belt advises against it.',
  // Cryptic / neutral
  'Signs point to snacks.',
  'Ask again after the next flyby.',
  'The answer drifts somewhere past Pluto.',
  'Consult the tides of the third ring.',
  'Reply hazy — solar flares detected.',
  'The puggle merely blinks, inscrutable.',
  'Somewhere, a star is thinking it over.',
  'The cosmos hums, but keeps its counsel.',
  'Wait for the helmet to fog, then decide.',
];

/* ---- Helpers ------------------------------------------------------------ */

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Pick a random fortune index, never the one we just showed. */
function pickFortune(exclude: number): number {
  if (FORTUNES.length <= 1) return 0;
  let next = Math.floor(Math.random() * FORTUNES.length);
  if (next === exclude) {
    // Nudge forward by a random non-zero step so the same one never repeats.
    next = (next + 1 + Math.floor(Math.random() * (FORTUNES.length - 1))) % FORTUNES.length;
  }
  return next;
}

/* ======================================================================== */

export default function Oracle() {
  const [question, setQuestion] = useState('');
  const [fortune, setFortune] = useState<string | null>(null);
  const [swirling, setSwirling] = useState(false);
  const lastIndexRef = useRef<number>(-1);
  const timerRef = useRef<number | null>(null);

  // Clear any pending reveal timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const reveal = useCallback(() => {
    const idx = pickFortune(lastIndexRef.current);
    lastIndexRef.current = idx;
    setFortune(FORTUNES[idx]);
    setSwirling(false);
  }, []);

  const consult = useCallback(() => {
    if (swirling) return;

    if (prefersReducedMotion()) {
      // No animation — reveal instantly.
      reveal();
      return;
    }

    setSwirling(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    // Brief swirl/shake, then the fortune drops in.
    timerRef.current = window.setTimeout(() => {
      reveal();
    }, 900);
  }, [reveal, swirling]);

  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      consult();
    },
    [consult],
  );

  const hasFortune = fortune !== null;
  const trimmed = question.trim();

  return (
    <div className="pg-oracle">
      <p className="pg-oracle-sr-only" aria-live="polite">
        {swirling
          ? 'The cosmos is thinking…'
          : hasFortune
            ? `The cosmos answers: ${fortune}`
            : ''}
      </p>

      {/* The cosmic orb — a tappable planet drawn with CSS + an SVG ring. */}
      <button
        type="button"
        className={`pg-oracle-orb${swirling ? ' is-swirling' : ''}`}
        onClick={consult}
        aria-label="Consult the cosmos"
        aria-busy={swirling}
      >
        <span className="pg-oracle-orb-glow" aria-hidden="true" />
        <span className="pg-oracle-orb-body" aria-hidden="true">
          <span className="pg-oracle-orb-swirl" />
          <span className="pg-oracle-orb-shine" />
        </span>
        <svg
          className="pg-oracle-orb-ring"
          viewBox="0 0 200 200"
          aria-hidden="true"
          focusable="false"
        >
          <ellipse
            cx="100"
            cy="100"
            rx="94"
            ry="34"
            fill="none"
            stroke="var(--rp-sunshine)"
            strokeWidth="4"
            transform="rotate(-18 100 100)"
          />
        </svg>
        {/* A tiny orbiting star for a little extra whimsy. */}
        <span className="pg-oracle-orb-star" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
            <path
              d="M12 1l2.5 6.5L21 10l-6.5 2.5L12 19l-2.5-6.5L3 10l6.5-2.5z"
              fill="var(--rp-sunshine)"
              stroke="var(--rp-border)"
              strokeWidth="1"
            />
          </svg>
        </span>
      </button>

      {/* The question + consult controls. */}
      <form className="pg-oracle-form" onSubmit={onSubmit}>
        <Input
          label="Ask a yes / no question"
          icon="star"
          value={question}
          maxLength={140}
          placeholder="Will the snacks arrive before the next flyby?"
          onChange={(e) => setQuestion(e.target.value)}
        />
        <Button type="submit" variant="primary" icon="sparkle" size="lg" disabled={swirling} block>
          {swirling ? 'Consulting the cosmos…' : 'Consult the cosmos'}
        </Button>
      </form>

      {/* The revealed fortune. */}
      {hasFortune && !swirling && (
        <div className="pg-oracle-result">
          <Card title="The cosmos answers" icon="sparkle" tone="violet">
            <div className="pg-oracle-answer">
              {trimmed && <p className="pg-oracle-question">“{trimmed}”</p>}
              <p className="pg-oracle-fortune">{fortune}</p>
              <div className="pg-oracle-again">
                <Button type="button" variant="secondary" icon="refresh" onClick={consult}>
                  Consult again
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {!hasFortune && !swirling && (
        <p className="pg-oracle-hint">
          Tap the orb (or the button) and the stars will weigh in. Answers are
          for entertainment only — the puggle is not a licensed astrologer.
        </p>
      )}
    </div>
  );
}
