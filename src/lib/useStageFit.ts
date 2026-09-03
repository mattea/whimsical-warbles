import { useEffect, type RefObject } from 'react';

/**
 * Keep a game "stage" landscape for play, but let it grow to fully show its
 * overlay card on short / narrow viewports (phones).
 *
 * Both arcade cabinets draw into a fixed-aspect stage (`aspect-ratio` in CSS)
 * with an absolutely-positioned overlay card for the start / game-over screens.
 * On a tall, skinny phone that landscape box is short, so the card — especially
 * game-over with its leaderboard form — overflowed and had to be scrolled inside
 * an easy-to-miss inner scroll area.
 *
 * This hook measures the overlay's natural height while an overlay is showing
 * and, when it needs more room than the native aspect-ratio gives, sets an
 * explicit stage height so the whole card fits with no inner scroll. The moment
 * play starts (`active` goes false) it clears the override, snapping the stage
 * back to its landscape play area; the canvas's own ResizeObserver then rescales
 * to match.
 *
 * @param stageRef   the fixed-aspect stage element
 * @param overlayRef the currently-mounted overlay (start or game-over)
 * @param active     true while an overlay is up (i.e. not actively playing)
 */
export function useStageFit(
  stageRef: RefObject<HTMLElement | null>,
  overlayRef: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    // Playing: hand the stage back to its CSS aspect-ratio.
    if (!active) {
      stage.style.height = '';
      return;
    }

    const fit = () => {
      const overlay = overlayRef.current;
      const card = overlay?.firstElementChild as HTMLElement | null;
      if (!overlay || !card) {
        stage.style.height = '';
        return;
      }
      // Measure at the native aspect-ratio height first…
      stage.style.height = '';
      const base = stage.clientHeight;
      // Measure the CARD directly (plus the overlay's vertical padding). The
      // overlay centers its card, so an overflowing card spills above the top
      // edge where scrollHeight can't see it — the card's own box height is the
      // honest figure.
      const cs = getComputedStyle(overlay);
      const padY = parseFloat(cs.paddingTop || '0') + parseFloat(cs.paddingBottom || '0');
      const needed = card.offsetHeight + padY;
      // …then grow only if the card genuinely needs more room.
      if (needed > base + 1) stage.style.height = `${needed}px`;
    };

    fit();

    // Observe the CARD (the overlay's child) for size changes. Its height is a
    // function of the content and the stage WIDTH — never the stage height we
    // set here — so this catches font-load reflow and width changes without
    // feeding back into a resize loop.
    const overlay = overlayRef.current;
    const card = overlay?.firstElementChild ?? overlay ?? null;
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => fit()) : null;
    if (card) ro?.observe(card);

    // Refit when the overlay's contents change (leaderboard loads, submit
    // state flips) in a way that swaps nodes rather than resizing them.
    const mo = overlay ? new MutationObserver(() => fit()) : null;
    if (overlay) mo?.observe(overlay, { childList: true, subtree: true, characterData: true });

    window.addEventListener('resize', fit);
    return () => {
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [stageRef, overlayRef, active]);
}
