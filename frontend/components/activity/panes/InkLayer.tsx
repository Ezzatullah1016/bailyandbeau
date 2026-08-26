'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useRegisterDrawingSurface, type SurfaceTool } from '@/components/session/DrawingSurface';
import { markKind, type Line } from './shared';

/**
 * A transparent ink overlay for panes whose content is not itself a canvas.
 *
 * The client's quiz and hotspot mockups both put Pen, Eraser, Undo and Redo in
 * the dock, over a pane that is an image with buttons on it. This is what those
 * tools draw on: a canvas sized to its container, painting nothing of its own,
 * sitting above the illustration and below nothing.
 *
 * It shares `Line[]` with `DrawingPane` deliberately — same shape, same
 * whole-state patches, so the sync protocol and the undo semantics are identical
 * and a stroke means the same thing everywhere.
 *
 * The one rule that makes it usable: **while the tool is `select` the overlay is
 * transparent to pointer events.** Otherwise it would swallow every tap meant
 * for a quiz option or a hotspot marker. That is what Select is *for* in these
 * mockups — it is the escape hatch back to the pane, which is why it appears in
 * all four activity docks and in none of the reading ones.
 */
export function InkLayer({
  lines,
  setLines,
  color,
  brushSizes,
}: {
  lines: Line[];
  setLines: (next: Line[]) => void;
  /** Ink colour. Fixed per pane: these overlays have no palette of their own. */
  color?: string;
  brushSizes?: number[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const currentLine = useRef<number[]>([]);

  const toolRef = useRef<SurfaceTool>('select');
  const widthRef = useRef<number>(brushSizes?.[0] ?? 6);
  const redoRef = useRef<Line[]>([]);
  const shapeRef = useRef<'rect' | 'ellipse' | 'line'>('rect');
  /*
   * Tool and width live in refs so the pointer handlers never close over a stale
   * value, and this counter re-renders when they change — the registered surface
   * and the overlay's own `pointer-events` both have to follow.
   */
  const [rev, setRev] = useState(0);
  const force = useCallback(() => setRev((v) => v + 1), []);

  const ink = color ?? '#ef4444';

  /** Repaint every committed stroke. Transparent — the pane shows through. */
  const redraw = useCallback(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const line of lines) {
      if (markKind(line) === 'shape') {
        drawShape(ctx, line);
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
      ctx.globalCompositeOperation = 'source-over';
    }
  }, [lines]);

  /*
   * The canvas is sized in device pixels to match its rendered box, so a stroke
   * lands under the cursor rather than being scaled on one axis — the bug that
   * bit the drawing pane's fixed 800×480 backing store.
   */
  useEffect(() => {
    const wrap = wrapRef.current;
    const c = canvasRef.current;
    if (!wrap || !c) return;
    const fit = () => {
      const r = wrap.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      c.width = Math.round(r.width);
      c.height = Math.round(r.height);
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [redraw]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const commit = useCallback(
    (next: Line[]) => {
      redoRef.current = [];
      setLines(next);
    },
    [setLines],
  );

  useRegisterDrawingSurface(
    () => ({
      /*
       * Fill here means "recolour the shape under the pointer", not a raster
       * flood: an illustration has no closed region for a flood to stop at, so
       * it would run to the overlay's edges. The hotspot mockup shows Fill
       * beside Shapes, which is what it is for.
       */
      caps: { pen: true, eraser: true, fill: true, shapes: true, undoRedo: true },
      tool: toolRef.current,
      setTool: (next) => {
        toolRef.current =
          next === 'eraser' || next === 'select' || next === 'shapes' || next === 'fill'
            ? next
            : 'pen';
        force();
      },
      shape: shapeRef.current,
      setShape: (next) => {
        shapeRef.current = next;
        force();
      },
      undo: () => {
        if (lines.length === 0) return;
        redoRef.current = [...redoRef.current, lines[lines.length - 1]];
        setLines(lines.slice(0, -1));
      },
      redo: () => {
        const last = redoRef.current[redoRef.current.length - 1];
        if (!last) return;
        redoRef.current = redoRef.current.slice(0, -1);
        setLines([...lines, last]);
      },
      clear: () => commit([]),
      depth: { undo: lines.length, redo: redoRef.current.length },
      brush: brushSizes?.length
        ? {
            sizes: brushSizes,
            value: widthRef.current,
            set: (n) => {
              widthRef.current = n;
              force();
            },
          }
        : undefined,
    }),
    [lines, commit, brushSizes, rev],
  );

  const drawable =
    toolRef.current === 'pen' ||
    toolRef.current === 'eraser' ||
    toolRef.current === 'shapes' ||
    toolRef.current === 'fill';

  function at(e: React.PointerEvent) {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (c.width / r.width),
      y: (e.clientY - r.top) * (c.height / r.height),
    };
  }

  /** Index of the topmost shape whose box contains this point, or -1. */
  function shapeAt(x: number, y: number): number {
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (markKind(l) !== 'shape') continue;
      const [x0, y0, x1, y1] = l.points;
      if (x1 === undefined || y1 === undefined) continue;
      if (
        x >= Math.min(x0, x1) &&
        x <= Math.max(x0, x1) &&
        y >= Math.min(y0, y1) &&
        y <= Math.max(y0, y1)
      ) {
        return i;
      }
    }
    return -1;
  }

  function start(e: React.PointerEvent) {
    if (!drawable) return;
    if (toolRef.current === 'fill') {
      // Recolour the shape under the pointer rather than flooding pixels: this
      // canvas sits over an illustration with no region boundaries to stop at.
      const { x, y } = at(e);
      const i = shapeAt(x, y);
      if (i < 0) return;
      const next = lines.slice();
      next[i] = { ...next[i], color: ink };
      commit(next);
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const { x, y } = at(e);
    drawing.current = true;
    currentLine.current = [x, y];
  }

  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const { x, y } = at(e);
    currentLine.current.push(x, y);
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const pts = currentLine.current;
    if (pts.length < 4) return;
    if (toolRef.current === 'shapes') {
      // Rubber-band preview: repaint what is committed, then the shape being
      // dragged out, so the child sees it before releasing.
      redraw();
      drawShape(ctx, {
        points: [pts[0], pts[1], x, y],
        color: ink,
        width: widthRef.current,
        kind: 'shape',
        shape: shapeRef.current,
      });
      return;
    }
    const i = pts.length - 4;
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineWidth = widthRef.current;
    if (toolRef.current === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = ink;
    }
    ctx.moveTo(pts[i], pts[i + 1]);
    ctx.lineTo(pts[i + 2], pts[i + 3]);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    const pts = currentLine.current;
    if (toolRef.current === 'shapes' && pts.length >= 4) {
      const x1 = pts[pts.length - 2];
      const y1 = pts[pts.length - 1];
      if (Math.abs(x1 - pts[0]) >= 4 || Math.abs(y1 - pts[1]) >= 4) {
        commit([
          ...lines,
          {
            points: [pts[0], pts[1], x1, y1],
            color: ink,
            width: widthRef.current,
            kind: 'shape',
            shape: shapeRef.current,
          },
        ]);
      } else {
        redraw();
      }
    } else if (pts.length >= 4) {
      commit([
        ...lines,
        {
          points: [...pts],
          color: ink,
          width: widthRef.current,
          eraser: toolRef.current === 'eraser',
          kind: 'stroke',
        },
      ]);
    }
    currentLine.current = [];
  }

  return (
    <div ref={wrapRef} className="absolute inset-0" style={{ pointerEvents: 'none' }}>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="h-full w-full touch-none"
        style={{
          // The load-bearing line: in Select mode every tap belongs to the pane
          // underneath, so the overlay steps out of the way entirely.
          pointerEvents: drawable ? 'auto' : 'none',
          cursor: drawable ? 'crosshair' : 'default',
        }}
      />
    </div>
  );
}

/** Draw a shape from its drag endpoints. Mirrors `DrawingPane`'s renderer. */
function drawShape(ctx: CanvasRenderingContext2D, line: Line) {
  const [x0, y0, x1, y1] = line.points;
  if (x1 === undefined || y1 === undefined) return;
  ctx.save();
  ctx.beginPath();
  ctx.lineWidth = Math.max(2, line.width);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = line.color;
  const w = x1 - x0;
  const h = y1 - y0;
  if (line.shape === 'ellipse') {
    ctx.ellipse(x0 + w / 2, y0 + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
  } else if (line.shape === 'line') {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  } else {
    ctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(w), Math.abs(h));
  }
  ctx.stroke();
  ctx.restore();
}
