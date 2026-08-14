import { useEffect, useState } from 'react';
import { Button } from '@retropolis/ui';

type Theme = 'light' | 'crt';

const STORAGE_KEY = 'pugglenaut-theme';

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'crt') root.setAttribute('data-rp-theme', 'crt');
  else root.removeAttribute('data-rp-theme');
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage may be unavailable (private mode); the toggle still works for the session */
  }
}

/**
 * Switches between the light "Paper" theme and the dark "CRT" phosphor theme by
 * toggling `data-rp-theme` on <html> (which the Retropolis stylesheet reads).
 * The initial theme is applied pre-paint by the inline script in Base.astro;
 * this control reflects and updates it. `light` is the render default on both
 * server and first client paint, so hydration matches; the effect then syncs to
 * whatever the pre-paint script actually set.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const current =
      document.documentElement.getAttribute('data-rp-theme') === 'crt' ? 'crt' : 'light';
    setTheme(current);
  }, []);

  function choose(next: Theme) {
    apply(next);
    setTheme(next);
  }

  return (
    <div className="cluster" role="group" aria-label="Color theme" style={{ gap: 6 }}>
      <Button
        size="sm"
        icon="sun"
        variant={theme === 'light' ? 'primary' : 'ghost'}
        aria-pressed={theme === 'light'}
        onClick={() => choose('light')}
      >
        Paper
      </Button>
      <Button
        size="sm"
        icon="moon"
        variant={theme === 'crt' ? 'primary' : 'ghost'}
        aria-pressed={theme === 'crt'}
        onClick={() => choose('crt')}
      >
        CRT
      </Button>
    </div>
  );
}
