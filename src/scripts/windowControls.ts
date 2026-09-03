/**
 * Make the Retropolis window caption buttons actually do something.
 *
 * The `<Window>` components are rendered as static HTML by Astro (no island
 * hydration), so their minimize / maximize / close buttons shipped inert. This
 * is a tiny progressive-enhancement layer that wires them up with plain DOM —
 * no framework, no per-page glue:
 *
 *   • Minimize (_)  → collapse the window to just its title bar (toggle).
 *   • Maximize (□)  → grow it to fill the page (toggle; Esc also restores).
 *   • Close (×)     → hide it and drop a chip into a little dock at the bottom
 *                     of the screen; clicking the chip brings the window back
 *                     (and scrolls to it). State is per-page — a refresh resets
 *                     everything, which is the expected MPA behavior.
 *
 * Windows added later by client islands (the guestbook, the contact form) are
 * picked up via a MutationObserver, so every `.rp-window` on the page gets
 * working controls exactly once.
 */

const ENHANCED = 'data-rp-enhanced';
const MIN = 'data-rp-min';
const MAX = 'data-rp-max';
const CLOSED = 'data-rp-closed';

let dock: HTMLDivElement | null = null;
let seq = 0;

function getDock(): HTMLDivElement {
  if (dock && dock.isConnected) return dock;
  dock = document.createElement('div');
  dock.id = 'rp-window-dock';
  dock.setAttribute('role', 'group');
  dock.setAttribute('aria-label', 'Reopen closed windows');
  document.body.appendChild(dock);
  return dock;
}

/** The caption buttons, resolved by aria-label with a positional fallback. */
function captionButtons(win: HTMLElement) {
  const caps = Array.from(win.querySelectorAll<HTMLButtonElement>('.rp-window__cap'));
  const byLabel = (label: string) =>
    caps.find((b) => (b.getAttribute('aria-label') || '').toLowerCase() === label);
  return {
    min: byLabel('minimize') ?? caps[0],
    max: byLabel('maximize') ?? caps[1],
    close: win.querySelector<HTMLButtonElement>('.rp-window__cap--close') ?? byLabel('close') ?? caps[2],
  };
}

function titleText(win: HTMLElement): string {
  return (win.querySelector('.rp-window__title')?.textContent || 'window').trim();
}

function setPressed(btn: HTMLButtonElement | undefined, on: boolean, offLabel: string, onLabel: string) {
  if (!btn) return;
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.setAttribute('aria-label', on ? onLabel : offLabel);
  btn.title = on ? onLabel : offLabel;
}

function enhance(win: HTMLElement): void {
  if (win.hasAttribute(ENHANCED)) return;
  win.setAttribute(ENHANCED, '');
  const id = `rp-win-${++seq}`;
  win.id = win.id || id;

  const { min, max, close } = captionButtons(win);

  const restoreDown = () => {
    win.removeAttribute(MAX);
    setPressed(max, false, 'Maximize', 'Restore down');
  };

  min?.addEventListener('click', () => {
    const nowMin = !win.hasAttribute(MIN);
    // Minimizing a maximized window just collapses it back to a bar in place.
    if (nowMin && win.hasAttribute(MAX)) restoreDown();
    win.toggleAttribute(MIN, nowMin);
    setPressed(min, nowMin, 'Minimize', 'Restore');
  });

  max?.addEventListener('click', () => {
    const nowMax = !win.hasAttribute(MAX);
    if (nowMax && win.hasAttribute(MIN)) {
      win.removeAttribute(MIN);
      setPressed(min, false, 'Minimize', 'Restore');
    }
    win.toggleAttribute(MAX, nowMax);
    setPressed(max, nowMax, 'Maximize', 'Restore down');
    if (nowMax) win.scrollIntoView({ block: 'nearest' });
  });

  close?.addEventListener('click', () => {
    win.removeAttribute(MAX);
    win.removeAttribute(MIN);
    setPressed(max, false, 'Maximize', 'Restore down');
    setPressed(min, false, 'Minimize', 'Restore');
    win.setAttribute(CLOSED, '');
    addDockChip(win);
  });
}

function addDockChip(win: HTMLElement): void {
  const d = getDock();
  if (d.querySelector(`[data-for="${win.id}"]`)) return;

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'rp-dock-chip rp-bevel-raised';
  chip.dataset.for = win.id;
  chip.setAttribute('aria-label', `Reopen ${titleText(win)}`);

  // Reuse the window's own title-bar icon if it has one.
  const icon = win.querySelector('.rp-window__bar > svg');
  if (icon) {
    const clone = icon.cloneNode(true) as SVGElement;
    clone.setAttribute('aria-hidden', 'true');
    chip.appendChild(clone);
  }
  const label = document.createElement('span');
  label.className = 'rp-dock-chip__label';
  label.textContent = titleText(win);
  chip.appendChild(label);

  chip.addEventListener('click', () => {
    win.removeAttribute(CLOSED);
    chip.remove();
    win.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  d.appendChild(chip);
}

function scanAll(): void {
  document.querySelectorAll<HTMLElement>('.rp-window').forEach(enhance);
}

function onEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  // Restore the first maximized window, if any (leaves other UI escapes alone).
  const maxed = document.querySelector<HTMLElement>(`.rp-window[${MAX}]`);
  if (maxed) {
    maxed.removeAttribute(MAX);
    const { max } = captionButtons(maxed);
    setPressed(max, false, 'Maximize', 'Restore down');
  }
}

function init(): void {
  scanAll();
  // Catch windows rendered later by client islands.
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches?.('.rp-window')) enhance(node);
        node.querySelectorAll?.<HTMLElement>('.rp-window').forEach(enhance);
      }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('keydown', onEscape);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
