'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useCallback,
} from 'react';
import type { Ref } from 'react';
import type { AnnotationShape, AnnotationTool } from './types';

// Fabric.js is imported dynamically to avoid SSR issues — no static type available.
type FabricCanvas = any;

const DEBOUNCE_THRESHOLD_BYTES = 50 * 1024; // 50 KB
const DEBOUNCE_MS = 200;

export interface AnnotationCanvasHandle {
  loadRemoteJSON(json: string): void;
  clearCanvas(local?: boolean): void;
  getJSON(): string;
  undo(): void;
  redo(): void;
  /** True when there is an undone object waiting to be restored. */
  canRedo(): boolean;
  /** After CSS transforms (e.g. zoom) change, refresh size + pointer mapping */
  recalcLayout(): void;
}

export interface AnnotationCanvasProps {
  tool: AnnotationTool;
  /** Which shape the `shape` tool draws. Ignored by every other tool. */
  shape?: AnnotationShape;
  color: string;
  brushSize: number;
  onSync: (json: string) => void;
  /** When false, pointer events pass through so the flip book receives swipes/clicks */
  drawingEnabled: boolean;
  /**
   * `next/dynamic` cannot forward a real `ref`, so callers that lazy-load this
   * component pass the handle through as a normal prop instead.
   */
  forwardedRef?: Ref<AnnotationCanvasHandle>;
}

type Props = AnnotationCanvasProps;

/** Convert a hex color to rgba() string with the given alpha (0–1). */
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Cursor shown over the book while annotating (Fabric + wrapper). */
function cursorForTool(tool: AnnotationTool, drawingEnabled: boolean): string {
  if (!drawingEnabled) return 'default';
  if (tool === 'eraser' || tool === 'fill') return 'pointer';
  return 'crosshair';
}

function setFabricSurfaceCursors(canvas: FabricCanvas, cssCursor: string) {
  const upper = canvas.upperCanvasEl as HTMLCanvasElement | undefined;
  const lower = canvas.lowerCanvasEl as HTMLCanvasElement | undefined;
  if (upper) upper.style.cursor = cssCursor;
  if (lower) lower.style.cursor = cssCursor;
}

type FabricCtor = new (...args: any[]) => any;
type FabricNS = {
  PencilBrush?: new (canvas: FabricCanvas) => unknown;
  Rect?: FabricCtor;
  Ellipse?: FabricCtor;
  Line?: FabricCtor;
};

function ensureFreeDrawingBrush(canvas: FabricCanvas, fabricNS: FabricNS | null | undefined) {
  if (canvas.freeDrawingBrush || !fabricNS?.PencilBrush) return;
  try {
    canvas.freeDrawingBrush = new fabricNS.PencilBrush(canvas) as any;
  } catch {
    /* ignore */
  }
}

/**
 * Drag-to-draw for the shape tool.
 *
 * A shape is created on pointer-down and resized live on move, so the child
 * sees the rectangle they are dragging out rather than only its result. It is
 * added to the canvas immediately, which means `object:added` fires once — the
 * sync happens on pointer-up, after the size is final, rather than on every
 * mouse-move frame (which would flood the data channel).
 */
function bindShapeTool(
  canvas: FabricCanvas,
  shape: AnnotationShape,
  color: string,
  brushSize: number,
  emitSync: (c: FabricCanvas) => void,
  fabricNS?: FabricNS | null,
) {
  let active: any = null;
  let originX = 0;
  let originY = 0;

  canvas.on('mouse:down', (opt: any) => {
    const p = canvas.getPointer(opt.e);
    originX = p.x;
    originY = p.y;

    const common = {
      left: originX,
      top: originY,
      stroke: color,
      strokeWidth: Math.max(2, brushSize),
      fill: 'transparent',
      selectable: false,
      evented: false,
      // Strokes must not scale with the object, or a thin line dragged wide
      // ends up with a hairline on one axis and a slab on the other.
      strokeUniform: true,
      originX: 'left' as const,
      originY: 'top' as const,
    };

    if (shape === 'rect' && fabricNS?.Rect) {
      active = new fabricNS.Rect({ ...common, width: 0, height: 0 });
    } else if (shape === 'ellipse' && fabricNS?.Ellipse) {
      active = new fabricNS.Ellipse({ ...common, rx: 0, ry: 0 });
    } else if (shape === 'line' && fabricNS?.Line) {
      active = new fabricNS.Line([originX, originY, originX, originY], {
        stroke: color,
        strokeWidth: Math.max(2, brushSize),
        selectable: false,
        evented: false,
        strokeUniform: true,
      });
    }
    if (active) canvas.add(active);
  });

  canvas.on('mouse:move', (opt: any) => {
    if (!active) return;
    const p = canvas.getPointer(opt.e);

    if (shape === 'line') {
      active.set({ x2: p.x, y2: p.y });
    } else {
      // Dragging up or left gives a negative extent; move the origin instead of
      // rendering a zero-size shape.
      const width = Math.abs(p.x - originX);
      const height = Math.abs(p.y - originY);
      active.set({
        left: Math.min(originX, p.x),
        top: Math.min(originY, p.y),
        ...(shape === 'rect' ? { width, height } : { rx: width / 2, ry: height / 2 }),
      });
    }
    canvas.requestRenderAll();
  });

  const finish = () => {
    if (!active) return;
    // A tap with no drag leaves a zero-size artefact that cannot be seen but
    // still serialises and syncs. Drop it.
    const tiny =
      shape === 'line'
        ? Math.hypot(active.x2 - active.x1, active.y2 - active.y1) < 4
        : shape === 'rect'
          ? active.width < 4 || active.height < 4
          : active.rx < 2 || active.ry < 2;
    if (tiny) {
      canvas.remove(active);
      active = null;
      canvas.requestRenderAll();
      return;
    }
    active.setCoords?.();
    active = null;
    canvas.requestRenderAll();
    emitSync(canvas);
  };

  canvas.on('mouse:up', finish);
}

function applyToolToCanvas(
  canvas: FabricCanvas,
  tool: AnnotationTool,
  color: string,
  brushSize: number,
  emitSync: (c: FabricCanvas) => void,
  drawingEnabled: boolean,
  fabricNS?: FabricNS | null,
  shape: AnnotationShape = 'rect',
) {
  canvas.off('mouse:down');
  canvas.off('mouse:move');
  canvas.off('mouse:up');

  if (!drawingEnabled) {
    canvas.isDrawingMode = false;
    canvas.defaultCursor = 'default';
    canvas.hoverCursor = 'default';
    (canvas as { freeDrawingCursor?: string }).freeDrawingCursor = 'default';
    setFabricSurfaceCursors(canvas, 'default');
    return;
  }

  const cursor = cursorForTool(tool, true);
  if (tool === 'pen' || tool === 'highlighter') {
    ensureFreeDrawingBrush(canvas, fabricNS);
  }
  const brush = canvas.freeDrawingBrush;

  if (tool === 'pen') {
    if (!brush) return;
    (brush as { strokeLineCap?: string }).strokeLineCap = 'round';
    (brush as { strokeLineJoin?: string }).strokeLineJoin = 'round';
    canvas.isDrawingMode = true;
    canvas.defaultCursor = cursor;
    canvas.hoverCursor = cursor;
    (canvas as { freeDrawingCursor?: string }).freeDrawingCursor = cursor;
    brush.color = color;
    brush.width = brushSize;
  } else if (tool === 'highlighter') {
    if (!brush) return;
    (brush as { strokeLineCap?: string }).strokeLineCap = 'round';
    (brush as { strokeLineJoin?: string }).strokeLineJoin = 'round';
    canvas.isDrawingMode = true;
    canvas.defaultCursor = cursor;
    canvas.hoverCursor = cursor;
    (canvas as { freeDrawingCursor?: string }).freeDrawingCursor = cursor;
    brush.color = hexToRgba(color, 0.35);
    brush.width = Math.max(brushSize, 20);
  } else if (tool === 'eraser') {
    canvas.isDrawingMode = false;
    canvas.defaultCursor = 'pointer';
    canvas.hoverCursor = 'pointer';
    (canvas as { freeDrawingCursor?: string }).freeDrawingCursor = 'default';
    canvas.skipTargetFind = false;
    canvas.on('mouse:down', (opt: any) => {
      const target = canvas.findTarget(opt.e, false);
      if (target) {
        canvas.remove(target);
        canvas.requestRenderAll();
        emitSync(canvas);
      }
    });
  } else if (tool === 'shape') {
    canvas.isDrawingMode = false;
    canvas.defaultCursor = cursor;
    canvas.hoverCursor = cursor;
    // Target-finding would let a drag start on an existing shape and move it
    // instead of drawing a new one.
    canvas.skipTargetFind = true;
    bindShapeTool(canvas, shape, color, brushSize, emitSync, fabricNS);
  } else if (tool === 'fill') {
    canvas.isDrawingMode = false;
    canvas.defaultCursor = 'pointer';
    canvas.hoverCursor = 'pointer';
    canvas.skipTargetFind = false;
    // Fill recolours a shape rather than flood-filling raster pixels: the layer
    // is vector, and the page underneath is a WebGL texture this canvas cannot
    // read. Tapping a shape's interior fills it; tapping bare page does nothing.
    canvas.on('mouse:down', (opt: any) => {
      const target = canvas.findTarget(opt.e, false);
      if (target && typeof target.set === 'function') {
        target.set({ fill: color });
        canvas.requestRenderAll();
        emitSync(canvas);
      }
    });
  }

  setFabricSurfaceCursors(canvas, cursor);
}

const AnnotationCanvas = forwardRef<AnnotationCanvasHandle, Props>(
  function AnnotationCanvas(
    { tool, shape = 'rect', color, brushSize, onSync, drawingEnabled, forwardedRef },
    ref,
  ) {
    // Lazy-loaded callers supply the handle via `forwardedRef` (see the shim in
    // SessionRoomPage); direct callers use the real `ref`.
    const handleRef = forwardedRef ?? ref;
    const canvasElRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const fabricRef = useRef<FabricCanvas | null>(null);
    const fabricLibRef = useRef<FabricNS | null>(null);
    const layoutResizeRef = useRef<(() => void) | null>(null);
    const annPropsRef = useRef({ tool, shape, color, brushSize, drawingEnabled });
    annPropsRef.current = { tool, shape, color, brushSize, drawingEnabled };
    /**
     * Objects removed by `undo()`, newest last, so `redo()` can put them back.
     *
     * Cleared whenever the canvas is replaced wholesale — a remote load or a
     * clear means the stack refers to objects that are no longer part of this
     * drawing's history, and restoring one would resurrect a stroke from a page
     * the reader has already left.
     */
    const redoStackRef = useRef<any[]>([]);
    const isRemoteLoadRef = useRef(false);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const cancelPendingDebouncedSync = useCallback(() => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    }, []);

    // ── Emit serialized canvas (debounced for large payloads) ──────────────
    const emitSync = useCallback(
      (canvas: FabricCanvas) => {
        const json = JSON.stringify(canvas.toJSON());
        cancelPendingDebouncedSync();
        if (json.length >= DEBOUNCE_THRESHOLD_BYTES) {
          debounceTimerRef.current = setTimeout(() => onSync(json), DEBOUNCE_MS);
        } else {
          onSync(json);
        }
      },
      [onSync, cancelPendingDebouncedSync],
    );

    /** Push current canvas state immediately (no debounce). Used after clear / remote replace. */
    const syncNow = useCallback(
      (canvas: FabricCanvas) => {
        cancelPendingDebouncedSync();
        onSync(JSON.stringify(canvas.toJSON()));
      },
      [onSync, cancelPendingDebouncedSync],
    );

    // ── Initialise Fabric canvas ───────────────────────────────────────────
    useEffect(() => {
      if (!canvasElRef.current) return;

      let canvas: FabricCanvas;
      let resizeObs: ResizeObserver | null = null;
      let removeOffsetSync: (() => void) | null = null;

      import('fabric').then(({ fabric }) => {
        fabricLibRef.current = fabric as FabricNS;
        canvas = new fabric.Canvas(canvasElRef.current!, {
          isDrawingMode: true,
          selection: false,
          renderOnAddRemove: true,
          /**
           * Must be true for stylus / pen: Fabric listens on pointer*; with false it only
           * uses mouse* and many pens never drive free-drawing reliably.
           */
          enablePointerEvents: true,
          perPixelTargetFind: true,
          targetFindTolerance: 8,
        });
        fabricRef.current = canvas;

        /** The stage can be resized or re-laid-out under us. Refresh offset before Fabric handles the pointer. */
        const syncOffset = () => {
          if (typeof canvas.calcOffset === 'function') canvas.calcOffset();
        };
        const upper = canvas.upperCanvasEl as HTMLCanvasElement | undefined;
        upper?.addEventListener('pointerdown', syncOffset, true);
        removeOffsetSync = () => upper?.removeEventListener('pointerdown', syncOffset, true);

        const resize = () => {
          if (!containerRef.current) return;
          const { width, height } = containerRef.current.getBoundingClientRect();
          canvas.setWidth(width);
          canvas.setHeight(height);
          canvas.renderAll();
        };
        layoutResizeRef.current = resize;
        resize();
        applyToolToCanvas(
          canvas,
          annPropsRef.current.tool,
          annPropsRef.current.color,
          annPropsRef.current.brushSize,
          emitSync,
          annPropsRef.current.drawingEnabled,
          fabricLibRef.current,
          annPropsRef.current.shape,
        );

        resizeObs = new ResizeObserver(resize);
        if (containerRef.current) resizeObs.observe(containerRef.current);

        canvas.on('path:created', () => {
          if (isRemoteLoadRef.current) return;
          emitSync(canvas);
        });

        canvas.on('object:removed', () => {
          if (isRemoteLoadRef.current) return;
          emitSync(canvas);
        });

        canvas.on('object:added', () => {
          if (isRemoteLoadRef.current) return;
          // Emit after stamp or other object adds
        });
      });

      return () => {
        removeOffsetSync?.();
        removeOffsetSync = null;
        layoutResizeRef.current = null;
        resizeObs?.disconnect();
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        try { canvas?.dispose(); } catch { /* ignore */ }
        fabricRef.current = null;
        fabricLibRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Update brush / tool when props change ─────────────────────────────
    useEffect(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      applyToolToCanvas(
        canvas,
        tool,
        color,
        brushSize,
        emitSync,
        drawingEnabled,
        fabricLibRef.current,
        shape,
      );
    }, [tool, shape, color, brushSize, drawingEnabled, emitSync]);

    /**
     * The 3D book sits directly beneath this overlay and registers its own
     * pointer handlers on its canvas. Once Fabric has handled an event on the
     * upper canvas, stop it bubbling so a stroke never doubles as an
     * interaction with the scene behind it.
     */
    useEffect(() => {
      const el = containerRef.current;
      if (!el || !drawingEnabled) return;
      const isolate = (ev: Event) => {
        ev.stopPropagation();
      };
      el.addEventListener('mousedown', isolate);
      el.addEventListener('pointerdown', isolate);
      el.addEventListener('touchstart', isolate, { passive: true });
      return () => {
        el.removeEventListener('mousedown', isolate);
        el.removeEventListener('pointerdown', isolate);
        el.removeEventListener('touchstart', isolate);
      };
    }, [drawingEnabled]);

    // ── Expose imperative handles ─────────────────────────────────────────
    useImperativeHandle(
      handleRef,
      () => ({
        loadRemoteJSON(json: string) {
          const canvas = fabricRef.current;
          if (!canvas) return;
          cancelPendingDebouncedSync();
          redoStackRef.current = [];
          isRemoteLoadRef.current = true;
          canvas.loadFromJSON(json, () => {
            canvas.renderAll();
            isRemoteLoadRef.current = false;
            applyToolToCanvas(
              canvas,
              annPropsRef.current.tool,
              annPropsRef.current.color,
              annPropsRef.current.brushSize,
              emitSync,
              annPropsRef.current.drawingEnabled,
              fabricLibRef.current,
              annPropsRef.current.shape,
            );
          });
        },

        clearCanvas(_local = false) {
          const canvas = fabricRef.current;
          if (!canvas) return;
          cancelPendingDebouncedSync();
          redoStackRef.current = [];
          isRemoteLoadRef.current = true;
          canvas.clear();
          canvas.setBackgroundColor('white', () => {
            canvas.renderAll();
            isRemoteLoadRef.current = false;
            syncNow(canvas);
            applyToolToCanvas(
              canvas,
              annPropsRef.current.tool,
              annPropsRef.current.color,
              annPropsRef.current.brushSize,
              emitSync,
              annPropsRef.current.drawingEnabled,
              fabricLibRef.current,
              annPropsRef.current.shape,
            );
          });
        },

        getJSON() {
          const canvas = fabricRef.current;
          if (!canvas) return '{}';
          return JSON.stringify(canvas.toJSON());
        },

        undo() {
          const canvas = fabricRef.current;
          if (!canvas) return;
          const objects = canvas.getObjects();
          if (objects.length > 0) {
            const removed = objects[objects.length - 1];
            canvas.remove(removed);
            // Keep the object itself rather than a serialised copy: re-adding
            // the same instance restores it exactly, with no round-trip through
            // Fabric's JSON revivers.
            redoStackRef.current.push(removed);
            canvas.requestRenderAll();
            emitSync(canvas);
          }
        },

        redo() {
          const canvas = fabricRef.current;
          if (!canvas) return;
          const restored = redoStackRef.current.pop();
          if (!restored) return;
          canvas.add(restored);
          canvas.requestRenderAll();
          emitSync(canvas);
        },

        canRedo() {
          return redoStackRef.current.length > 0;
        },

        recalcLayout() {
          layoutResizeRef.current?.();
          const canvas = fabricRef.current;
          if (!canvas) return;
          if (typeof canvas.calcOffset === 'function') canvas.calcOffset();
          canvas.requestRenderAll();
          applyToolToCanvas(
            canvas,
            annPropsRef.current.tool,
            annPropsRef.current.color,
            annPropsRef.current.brushSize,
            emitSync,
            annPropsRef.current.drawingEnabled,
            fabricLibRef.current,
            annPropsRef.current.shape,
          );
        },
      }),
      [emitSync, cancelPendingDebouncedSync, syncNow],
    );

    return (
      <div
        ref={containerRef}
        className={`absolute inset-0 z-10 ${drawingEnabled ? 'pointer-events-auto' : 'pointer-events-none'}`}
        style={{
          cursor: cursorForTool(tool, drawingEnabled),
          touchAction: drawingEnabled ? 'none' : 'auto',
        }}
      >
        <canvas ref={canvasElRef} className="absolute inset-0" />
      </div>
    );
  },
);

export default AnnotationCanvas;
