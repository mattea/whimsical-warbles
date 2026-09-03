import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, IconButton } from '@retropolis/ui';
import '../styles/doodle.css';

/**
 * DoodlePad — a chunky MS-Paint-style pixel pad for the Pugglenaut site.
 *
 * Art is drawn to a tiny low-resolution backing canvas (GRID_W × GRID_H) that
 * is the single source of truth for every pixel. A larger on-screen canvas just
 * blits that backing store scaled up with image smoothing OFF, so the pixels
 * stay crisp and chunky (and it's DPR-aware, so they stay crisp on retina too).
 *
 * The backing canvas doubles as our persistence + export format: it serializes
 * to a small PNG data URL, which we debounce-save to localStorage
 * (`pugglenaut-doodle`) and hand to a real <a download> for "Download PNG".
 *
 * Mounted as a client:load island by /doodle; takes no props.
 */

/* Low-res backing grid — chunky pixels scaled up to the display. */
const GRID_W = 80;
const GRID_H = 60;

/* Fixed paper color for the drawing surface (theme-independent art). */
const PAPER = '#fdf6e3';

const STORAGE_KEY = 'pugglenaut-doodle';
const SAVE_DEBOUNCE_MS = 400;

/* Scale factor for the exported PNG so a saved doodle isn't a postage stamp. */
const EXPORT_SCALE = 10;

type Tool = 'pen' | 'eraser' | 'stamp';

/** Base retro palette — fixed hexes so saved art is stable across themes. */
const BASE_PALETTE = [
  '#12121a', // near-black ink
  '#ffffff', // white
  '#e43b44', // red
  '#f77622', // orange
  '#feae34', // yellow
  '#63c74d', // green
  '#0099db', // blue
  '#b55088', // magenta
  '#2ce8f5', // cyan
  '#8b5a2b', // brown
] as const;

/**
 * A few extra swatches pulled live from the Retropolis `--rp-*` tokens, read
 * from the document at mount. Purely additive garnish on the palette; if the
 * tokens can't be resolved we just skip them.
 */
const TOKEN_SWATCHES = ['--rp-violet-500', '--rp-teal', '--rp-magenta', '--rp-lime'];

/** A tiny 7×7 star sprite for the stamp tool (1 = paint the current color). */
// prettier-ignore
const STAR_SPRITE = [
  [0, 0, 0, 1, 0, 0, 0],
  [0, 0, 0, 1, 0, 0, 0],
  [0, 0, 1, 1, 1, 0, 0],
  [1, 1, 1, 1, 1, 1, 1],
  [0, 0, 1, 1, 1, 0, 0],
  [0, 1, 1, 0, 1, 1, 0],
  [1, 0, 0, 0, 0, 0, 1],
];

function resolveTokenColor(token: string): string | null {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    return v || null;
  } catch {
    return null;
  }
}

export default function DoodlePad() {
  const viewRef = useRef<HTMLCanvasElement | null>(null);
  // The low-res backing store (source of truth for all pixels).
  const lowRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastCellRef = useRef<{ x: number; y: number } | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const [palette, setPalette] = useState<string[]>([...BASE_PALETTE]);
  const [color, setColor] = useState<string>(BASE_PALETTE[0]);
  const [tool, setTool] = useState<Tool>('pen');
  const [brush, setBrush] = useState<number>(2);
  const [pngHref, setPngHref] = useState<string>('');

  // Keep the latest tool settings in refs so the pointer handlers (attached
  // once) always read current values without re-subscribing.
  const colorRef = useRef(color);
  const toolRef = useRef(tool);
  const brushRef = useRef(brush);
  colorRef.current = color;
  toolRef.current = tool;
  brushRef.current = brush;

  /* -------- backing-store helpers --------------------------------------- */

  const getLow = useCallback((): CanvasRenderingContext2D | null => {
    let low = lowRef.current;
    if (!low) {
      low = document.createElement('canvas');
      low.width = GRID_W;
      low.height = GRID_H;
      lowRef.current = low;
    }
    return low.getContext('2d');
  }, []);

  /** Blit the low-res backing store onto the visible canvas, scaled + crisp. */
  const repaint = useCallback(() => {
    const view = viewRef.current;
    const low = lowRef.current;
    if (!view || !low) return;
    const ctx = view.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = view.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (view.width !== w || view.height !== h) {
      view.width = w;
      view.height = h;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.drawImage(low, 0, 0, GRID_W, GRID_H, 0, 0, view.width, view.height);
  }, []);

  /** Serialize the backing store to a scaled PNG, save it, and update export. */
  const persist = useCallback(() => {
    const low = lowRef.current;
    if (!low) return;
    // Export at a comfortable size with smoothing off (chunky pixels preserved).
    let href = '';
    try {
      const out = document.createElement('canvas');
      out.width = GRID_W * EXPORT_SCALE;
      out.height = GRID_H * EXPORT_SCALE;
      const octx = out.getContext('2d');
      if (octx) {
        octx.imageSmoothingEnabled = false;
        // Paint the paper color first so transparent cells export as paper.
        octx.fillStyle = PAPER;
        octx.fillRect(0, 0, out.width, out.height);
        octx.drawImage(low, 0, 0, out.width, out.height);
        href = out.toDataURL('image/png');
      }
    } catch {
      /* toDataURL can throw if tainted — never happens here, but stay safe. */
    }
    if (href) setPngHref(href);
    try {
      // Store the compact low-res PNG (tiny) for round-tripping the art.
      localStorage.setItem(STORAGE_KEY, low.toDataURL('image/png'));
    } catch {
      /* storage unavailable (private mode) — drawing still works this session */
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(persist, SAVE_DEBOUNCE_MS);
  }, [persist]);

  /* -------- drawing primitives ------------------------------------------ */

  /** Fill a square of grid cells centered on (cx, cy) with the given color. */
  const paintCell = useCallback(
    (cx: number, cy: number, fill: string, size: number) => {
      const ctx = getLow();
      if (!ctx) return;
      const half = Math.floor(size / 2);
      const x = cx - half;
      const y = cy - half;
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, size, size);
    },
    [getLow],
  );

  /** Stamp the star sprite centered on a grid cell. */
  const stampAt = useCallback(
    (cx: number, cy: number, fill: string) => {
      const ctx = getLow();
      if (!ctx) return;
      ctx.fillStyle = fill;
      const rows = STAR_SPRITE.length;
      const cols = STAR_SPRITE[0].length;
      const ox = cx - Math.floor(cols / 2);
      const oy = cy - Math.floor(rows / 2);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (STAR_SPRITE[r][c]) ctx.fillRect(ox + c, oy + r, 1, 1);
        }
      }
    },
    [getLow],
  );

  /** Bresenham line between two cells so fast drags leave no gaps. */
  const paintLine = useCallback(
    (x0: number, y0: number, x1: number, y1: number, fill: string, size: number) => {
      let dx = Math.abs(x1 - x0);
      let dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      let x = x0;
      let y = y0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        paintCell(x, y, fill, size);
        if (x === x1 && y === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          x += sx;
        }
        if (e2 <= dx) {
          err += dx;
          y += sy;
        }
      }
    },
    [paintCell],
  );

  /** Map a pointer event to an integer grid cell. */
  const cellFromEvent = useCallback((e: PointerEvent): { x: number; y: number } | null => {
    const view = viewRef.current;
    if (!view) return null;
    const rect = view.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * GRID_W);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * GRID_H);
    return { x: Math.max(0, Math.min(GRID_W - 1, x)), y: Math.max(0, Math.min(GRID_H - 1, y)) };
  }, []);

  /* -------- pointer wiring (attached once) ------------------------------ */

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const applyAt = (cell: { x: number; y: number }, fromDrag: boolean) => {
      const t = toolRef.current;
      if (t === 'stamp') {
        stampAt(cell.x, cell.y, colorRef.current);
        repaint();
        return;
      }
      const fill = t === 'eraser' ? PAPER : colorRef.current;
      const size = brushRef.current;
      const last = lastCellRef.current;
      if (fromDrag && last) {
        paintLine(last.x, last.y, cell.x, cell.y, fill, size);
      } else {
        paintCell(cell.x, cell.y, fill, size);
      }
      repaint();
    };

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      const cell = cellFromEvent(e);
      if (!cell) return;
      drawingRef.current = true;
      lastCellRef.current = cell;
      try {
        view.setPointerCapture(e.pointerId);
      } catch {
        /* not all pointers support capture */
      }
      applyAt(cell, false);
      // A stamp is a single tap; don't keep painting sprites as the finger moves.
      if (toolRef.current === 'stamp') drawingRef.current = false;
    };

    const onMove = (e: PointerEvent) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      const cell = cellFromEvent(e);
      if (!cell) return;
      applyAt(cell, true);
      lastCellRef.current = cell;
    };

    const onUp = (e: PointerEvent) => {
      if (!drawingRef.current && lastCellRef.current == null) return;
      drawingRef.current = false;
      lastCellRef.current = null;
      try {
        view.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      scheduleSave();
    };

    view.addEventListener('pointerdown', onDown);
    view.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    return () => {
      view.removeEventListener('pointerdown', onDown);
      view.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [cellFromEvent, paintCell, paintLine, stampAt, repaint, scheduleSave]);

  /* -------- mount: init backing store, restore, wire resize ------------- */

  useEffect(() => {
    const ctx = getLow();
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      // Start from a clean paper sheet.
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, GRID_W, GRID_H);
    }

    // Add a few live theme-token swatches to the palette (best-effort).
    const extra: string[] = [];
    for (const tok of TOKEN_SWATCHES) {
      const c = resolveTokenColor(tok);
      if (c && !BASE_PALETTE.includes(c as (typeof BASE_PALETTE)[number]) && !extra.includes(c)) {
        extra.push(c);
      }
    }
    if (extra.length) setPalette([...BASE_PALETTE, ...extra]);

    // Restore a saved doodle, then paint the view (and refresh the export href).
    let restored = false;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const img = new Image();
        img.onload = () => {
          const c = getLow();
          if (c) {
            c.imageSmoothingEnabled = false;
            c.clearRect(0, 0, GRID_W, GRID_H);
            c.drawImage(img, 0, 0, GRID_W, GRID_H);
          }
          repaint();
          persist(); // regenerate the download href from restored art
        };
        img.src = saved;
        restored = true;
      }
    } catch {
      /* ignore */
    }

    repaint();
    if (!restored) persist();

    const onResize = () => repaint();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    };
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------- toolbar actions --------------------------------------------- */

  const handleClear = useCallback(() => {
    if (!window.confirm('Clear the whole doodle? This can’t be undone.')) return;
    const ctx = getLow();
    if (ctx) {
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, GRID_W, GRID_H);
    }
    repaint();
    persist();
  }, [getLow, repaint, persist]);

  const pickColor = (c: string) => {
    setColor(c);
    setTool('pen');
  };

  /* -------- render ------------------------------------------------------- */

  return (
    <div className="pg-doodle-shell">
      <div className="pg-doodle-toolbar" role="toolbar" aria-label="Doodle tools">
        <div className="pg-doodle-group" role="group" aria-label="Color palette">
          <span className="pg-doodle-label" aria-hidden="true">
            Color
          </span>
          <div className="pg-doodle-swatches">
            {palette.map((c) => {
              const active = tool === 'pen' && color === c;
              return (
                <button
                  key={c}
                  type="button"
                  className="pg-doodle-swatch"
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                  aria-pressed={active}
                  title={c}
                  onClick={() => pickColor(c)}
                />
              );
            })}
          </div>
        </div>

        <div className="pg-doodle-group" role="group" aria-label="Brush size">
          <span className="pg-doodle-label" aria-hidden="true">
            Brush
          </span>
          {[
            { size: 1, label: 'Fine brush (1 pixel)', text: 'S' },
            { size: 2, label: 'Medium brush (2 pixels)', text: 'M' },
            { size: 4, label: 'Chunky brush (4 pixels)', text: 'L' },
          ].map((b) => (
            <Button
              key={b.size}
              size="sm"
              variant={tool === 'pen' && brush === b.size ? 'primary' : 'secondary'}
              aria-pressed={tool === 'pen' && brush === b.size}
              aria-label={b.label}
              onClick={() => {
                setBrush(b.size);
                setTool('pen');
              }}
            >
              {b.text}
            </Button>
          ))}
        </div>

        <div className="pg-doodle-group" role="group" aria-label="Tools">
          <IconButton
            icon="star"
            label="Star stamp"
            variant={tool === 'stamp' ? 'sunshine' : 'secondary'}
            aria-pressed={tool === 'stamp'}
            onClick={() => setTool('stamp')}
          />
          <IconButton
            icon="close"
            label="Eraser"
            variant={tool === 'eraser' ? 'primary' : 'secondary'}
            aria-pressed={tool === 'eraser'}
            onClick={() => setTool('eraser')}
          />
        </div>

        <div className="pg-doodle-group" role="group" aria-label="Canvas actions">
          <Button size="sm" variant="danger" icon="trash" onClick={handleClear}>
            Clear
          </Button>
          <a
            className="pg-doodle-download"
            href={pngHref || undefined}
            download="pugglenaut-doodle.png"
            aria-label="Download your doodle as a PNG"
          >
            <Button size="sm" variant="secondary" icon="download" aria-hidden="true" tabIndex={-1}>
              Download PNG
            </Button>
          </a>
        </div>
      </div>

      <div className="pg-doodle-stage">
        <canvas
          ref={viewRef}
          className={`pg-doodle-canvas${tool === 'eraser' ? ' is-eraser' : ''}`}
          role="img"
          aria-label="Pixel doodle canvas — draw with the mouse or your finger"
        />
      </div>

      <p className="pg-doodle-note">
        <span aria-hidden="true">💾</span>{' '}
        Saved locally in this browser (<code>pugglenaut-doodle</code>) — your doodle survives a
        refresh. It never leaves your device.
      </p>
    </div>
  );
}
