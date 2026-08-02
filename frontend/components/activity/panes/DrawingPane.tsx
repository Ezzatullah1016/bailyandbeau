'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Eraser, PaintBucket, Pencil, Redo2, Trash2, Undo2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { usePaneMotion } from './motion';
import type { Line } from './shared';

const CANVAS_W = 800;
const CANVAS_H = 480;

type Tool = 'pen' | 'eraser' | 'fill';

/** One tool in the left rail: icon over label, with an animated active pill. */
function RailTool({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const m = usePaneMotion();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : m.press}
      aria-pressed={active}
      className={`relative flex w-full min-h-11 cursor-pointer flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-[10px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
        active ? 'text-white' : 'text-brand-navy hover:bg-brand-purple/10'
      }`}
    >
      {active ? (
        <motion.span
          layoutId="draw-tool-pill"
          className="absolute inset-0 rounded-xl bg-brand-purple"
          transition={m.springSnappy}
        />
      ) : null}
      <Icon className="relative h-4.5 w-4.5" />
      <span className="relative">{label}</span>
    </motion.button>
  );
}

export function DrawingPane({
  payload,
  lines,
  setLines,
}: {
  payload: Record<string, unknown>;
  lines: Line[];
  setLines: (lines: Line[]) => void;
}) {
  const m = usePaneMotion();
  const palette = (payload.palette as string[]) ?? ['#222'];
  const brushSizes = (payload.brush_sizes as number[]) ?? [4];
  const allowEraser = Boolean(payload.allow_eraser);
  const allowFill = payload.allow_fill !== false;
  const backgroundUrl = typeof payload.background_url === 'string' ? payload.background_url : '';
  const allowSubmit = Boolean(payload.allow_submit);

  const [color, setColor] = useState(palette[0] ?? '#222');
  const [width, setWidth] = useState(brushSizes[0] ?? 4);
  const [tool, setTool] = useState<Tool>('pen');
  const [submitted, setSubmitted] = useState(false);
  /**
   * Strokes popped by undo, newest last. Kept local rather than synced: redo is
   * a private "I changed my mind", and `lines` remains the single shared truth.
   * Any new stroke clears it, which is what every drawing tool does.
   */
  const [redoStack, setRedoStack] = useState<Line[]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const [bgLoaded, setBgLoaded] = useState(false);
  const drawing = useRef(false);
  const currentLine = useRef<number[]>([]);

  const eraser = tool === 'eraser' && allowEraser;

  useEffect(() => {
    if (!backgroundUrl) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      bgImageRef.current = img;
      setBgLoaded(true);
    };
    img.onerror = () => {
      bgImageRef.current = null;
      setBgLoaded(false);
    };
    img.src = backgroundUrl;
  }, [backgroundUrl]);

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    if (bgImageRef.current) {
      const img = bgImageRef.current;
      const scale = Math.min(c.width / img.width, c.height / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
    }
    for (const line of lines) {
      // A fill is stored as a stroke with a single point, so undo/redo and the
      // sync protocol treat paint and strokes identically.
      if (line.points.length === 2) {
        floodFill(ctx, c, line.points[0], line.points[1], line.color);
        continue;
      }
      if (line.points.length < 4) continue;
      ctx.beginPath();
      ctx.lineWidth = line.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (line.eraser) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = line.color;
      }
      ctx.moveTo(line.points[0], line.points[1]);
      for (let i = 2; i < line.points.length; i += 2) {
        ctx.lineTo(line.points[i], line.points[i + 1]);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    // bgLoaded is intentionally a dep: redraw once the background image loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, bgLoaded]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  function commit(next: Line[]) {
    setLines(next);
    setRedoStack([]);
  }

  function undo() {
    if (lines.length === 0) return;
    const last = lines[lines.length - 1];
    setRedoStack((r) => [...r, last]);
    // Publish the truncated list, not a "delete" event — the wire protocol
    // carries whole-state patches, so host and guest cannot diverge.
    setLines(lines.slice(0, -1));
  }

  function redo() {
    if (redoStack.length === 0) return;
    const last = redoStack[redoStack.length - 1];
    setRedoStack((r) => r.slice(0, -1));
    setLines([...lines, last]);
  }

  function submitArtwork() {
    const c = canvasRef.current;
    if (!c) return;
    try {
      const dataUrl = c.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'my-artwork.png';
      a.click();
    } catch {
      // Tainted canvas from a cross-origin background — skip the download.
    }
    setSubmitted(true);
  }

  function pos(e: React.MouseEvent | React.TouchEvent) {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    return {
      x: (clientX - rect.left) * (c.width / rect.width),
      y: (clientY - rect.top) * (c.height / rect.height),
    };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    const { x, y } = pos(e);
    if (tool === 'fill') {
      commit([...lines, { points: [x, y], color, width: 0 }]);
      return;
    }
    drawing.current = true;
    currentLine.current = [x, y];
  }

  function moveDraw(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing.current) return;
    const { x, y } = pos(e);
    currentLine.current.push(x, y);
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const pts = currentLine.current;
    if (pts.length >= 4) {
      const i = pts.length - 4;
      ctx.beginPath();
      ctx.lineCap = 'round';
      ctx.lineWidth = width;
      if (eraser) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = color;
      }
      ctx.moveTo(pts[i], pts[i + 1]);
      ctx.lineTo(pts[i + 2], pts[i + 3]);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function endDraw() {
    if (!drawing.current) return;
    drawing.current = false;
    if (currentLine.current.length >= 4) {
      commit([...lines, { points: [...currentLine.current], color, width, eraser }]);
    }
    currentLine.current = [];
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        {/* Left rail, per the mockup. The old toolbar was one wrapping row above
            the canvas, which pushed the drawing area down and put colours,
            sizes and destructive actions on the same visual level. */}
        <div
          className="flex w-17 shrink-0 flex-col gap-1 self-start rounded-2xl border border-brand-purple/15 p-1.5"
          style={{ background: 'var(--activity-paper)' }}
          role="toolbar"
          aria-label="Drawing tools"
        >
          <RailTool icon={Pencil} label="Pen" active={tool === 'pen'} onClick={() => setTool('pen')} />
          {allowEraser ? (
            <RailTool
              icon={Eraser}
              label="Eraser"
              active={tool === 'eraser'}
              onClick={() => setTool('eraser')}
            />
          ) : null}
          {allowFill ? (
            <RailTool icon={PaintBucket} label="Fill" active={tool === 'fill'} onClick={() => setTool('fill')} />
          ) : null}
          <span className="my-0.5 h-px bg-brand-purple/15" />
          <RailTool icon={Undo2} label="Undo" disabled={lines.length === 0} onClick={undo} />
          <RailTool icon={Redo2} label="Redo" disabled={redoStack.length === 0} onClick={redo} />
          <RailTool
            icon={Trash2}
            label="Clear"
            disabled={lines.length === 0}
            onClick={() => commit([])}
          />
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            className="w-full max-h-[50vh] touch-none rounded-2xl border border-brand-purple/20 bg-white"
            style={{ cursor: tool === 'fill' ? 'copy' : 'crosshair' }}
            onMouseDown={startDraw}
            onMouseMove={moveDraw}
            onMouseUp={endDraw}
            onMouseLeave={endDraw}
            onTouchStart={startDraw}
            onTouchMove={moveDraw}
            onTouchEnd={endDraw}
          />

          {/* Colours sit under the canvas, close to the artwork they affect.
              Swatches and brush sizes are separated into their own rows: as one
              wrapping row of same-sized circles they were indistinguishable,
              and the sizes read as "more colours". */}
          <div className="flex flex-wrap items-center gap-2">
            {palette.map((p) => {
              const on = color === p && tool !== 'eraser';
              return (
                <motion.button
                  key={p}
                  type="button"
                  whileTap={m.press}
                  whileHover={m.hover}
                  onClick={() => {
                    setColor(p);
                    if (tool === 'eraser') setTool('pen');
                  }}
                  className="grid h-9 w-9 cursor-pointer place-items-center rounded-full transition-shadow"
                  style={{
                    backgroundColor: p,
                    boxShadow: on
                      ? '0 0 0 2px var(--activity-paper), 0 0 0 4px var(--room-accent)'
                      : '0 0 0 1px rgba(0,0,0,0.12)',
                  }}
                  aria-label={`Colour ${p}`}
                  aria-pressed={on}
                >
                  {on ? <Check className="h-4 w-4 text-white mix-blend-difference" strokeWidth={3} /> : null}
                </motion.button>
              );
            })}

          </div>

          {/* Brush sizes: a squared-off pill row, so the control cannot be
              mistaken for another set of colours. */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-brand-purple">
              Size
            </span>
            <div className="flex items-center gap-1 rounded-xl bg-brand-purple/8 p-1">
              {brushSizes.map((s) => (
                <motion.button
                  key={s}
                  type="button"
                  whileTap={m.press}
                  onClick={() => setWidth(s)}
                  className={`grid h-9 w-9 cursor-pointer place-items-center rounded-lg transition-colors ${
                    width === s ? 'bg-brand-purple' : 'hover:bg-brand-purple/15'
                  }`}
                  aria-label={`Brush ${s} pixels`}
                  aria-pressed={width === s}
                >
                  {/* The dot is the size — a "12px" text chip made the child read. */}
                  <span
                    className={`block rounded-full ${width === s ? 'bg-white' : 'bg-brand-purple'}`}
                    style={{ width: Math.min(s + 3, 18), height: Math.min(s + 3, 18) }}
                  />
                </motion.button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {allowSubmit ? (
        <div className="flex items-center justify-end gap-3">
          {submitted ? (
            <motion.span
              variants={m.riseIn}
              initial="hidden"
              animate="show"
              className="font-karla text-sm font-bold text-brand-teal"
            >
              Artwork saved!
            </motion.span>
          ) : null}
          <motion.button
            type="button"
            whileTap={m.press}
            onClick={submitArtwork}
            className="font-baloo flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-brand-pink px-5 text-sm font-bold text-white shadow transition-opacity hover:opacity-90"
          >
            Submit Artwork
            <Check className="h-4 w-4" strokeWidth={3} />
          </motion.button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Scanline flood fill.
 *
 * Row-at-a-time rather than per-pixel recursion: a 800x480 canvas is 384k
 * pixels, and a naive stack-of-pixels fill both blows the JS stack and takes
 * long enough to drop frames on a tablet.
 */
function floodFill(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  sx: number,
  sy: number,
  hex: string,
) {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const { width: w, height: h } = canvas;
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return;

  let img: ImageData;
  try {
    img = ctx.getImageData(0, 0, w, h);
  } catch {
    // Tainted canvas (cross-origin background) — reading pixels is blocked.
    return;
  }
  const d = img.data;
  const at = (x: number, y: number) => (y * w + x) * 4;

  const start = at(x0, y0);
  const target = [d[start], d[start + 1], d[start + 2], d[start + 3]];
  const fill = hexToRgb(hex);
  if (!fill) return;
  // Already this colour — nothing to do, and skipping avoids a full scan.
  if (target[0] === fill[0] && target[1] === fill[1] && target[2] === fill[2] && target[3] === 255) {
    return;
  }

  // Tolerance absorbs the anti-aliased edges of drawn lines, so a fill stops at
  // an outline instead of leaking through its soft pixels.
  const TOL = 32;
  const matches = (i: number) =>
    Math.abs(d[i] - target[0]) <= TOL &&
    Math.abs(d[i + 1] - target[1]) <= TOL &&
    Math.abs(d[i + 2] - target[2]) <= TOL &&
    Math.abs(d[i + 3] - target[3]) <= TOL;

  const stack: [number, number][] = [[x0, y0]];
  while (stack.length) {
    const [px, py] = stack.pop()!;
    let x = px;
    while (x >= 0 && matches(at(x, py))) x--;
    x++;
    let spanUp = false;
    let spanDown = false;
    while (x < w && matches(at(x, py))) {
      const i = at(x, py);
      d[i] = fill[0];
      d[i + 1] = fill[1];
      d[i + 2] = fill[2];
      d[i + 3] = 255;

      if (py > 0) {
        const up = matches(at(x, py - 1));
        if (up && !spanUp) {
          stack.push([x, py - 1]);
          spanUp = true;
        } else if (!up) spanUp = false;
      }
      if (py < h - 1) {
        const dn = matches(at(x, py + 1));
        if (dn && !spanDown) {
          stack.push([x, py + 1]);
          spanDown = true;
        } else if (!dn) spanDown = false;
      }
      x++;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function hexToRgb(hex: string): [number, number, number] | null {
  let s = hex.replace('#', '').trim();
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (s.length !== 6) return null;
  const n = Number.parseInt(s, 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
