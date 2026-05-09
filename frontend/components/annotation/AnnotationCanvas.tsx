'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useCallback,
} from 'react';
import type { AnnotationTool } from './AnnotationToolbar';

// Fabric.js is imported dynamically to avoid SSR issues — no static type available.
type FabricCanvas = any;

const DEBOUNCE_THRESHOLD_BYTES = 50 * 1024; // 50 KB
const DEBOUNCE_MS = 200;

export interface AnnotationCanvasHandle {
  loadRemoteJSON(json: string): void;
  clearCanvas(local?: boolean): void;
  getJSON(): string;
  undo(): void;
  /** After CSS transforms (e.g. zoom) change, refresh size + pointer mapping */
  recalcLayout(): void;
}

interface Props {
  tool: AnnotationTool;
  color: string;
  brushSize: number;
  onSync: (json: string) => void;
  /** When false, pointer events pass through so the flip book receives swipes/clicks */
  drawingEnabled: boolean;
}

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
  if (tool === 'eraser') return 'pointer';
  return 'crosshair';
}

function setFabricSurfaceCursors(canvas: FabricCanvas, cssCursor: string) {
  const upper = canvas.upperCanvasEl as HTMLCanvasElement | undefined;
  const lower = canvas.lowerCanvasEl as HTMLCanvasElement | undefined;
  if (upper) upper.style.cursor = cssCursor;
  if (lower) lower.style.cursor = cssCursor;
}

type FabricNS = { PencilBrush?: new (canvas: FabricCanvas) => unknown };

function ensureFreeDrawingBrush(canvas: FabricCanvas, fabricNS: FabricNS | null | undefined) {
  if (canvas.freeDrawingBrush || !fabricNS?.PencilBrush) return;
  try {
    canvas.freeDrawingBrush = new fabricNS.PencilBrush(canvas) as any;
  } catch {
    /* ignore */
  }
}

function applyToolToCanvas(
  canvas: FabricCanvas,
  tool: AnnotationTool,
  color: string,
  brushSize: number,
  emitSync: (c: FabricCanvas) => void,
  drawingEnabled: boolean,
  fabricNS?: FabricNS | null,
) {
  canvas.off('mouse:down');
  canvas.off('mouse:move');

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
  }

  setFabricSurfaceCursors(canvas, cursor);
}

const AnnotationCanvas = forwardRef<AnnotationCanvasHandle, Props>(
  function AnnotationCanvas({ tool, color, brushSize, onSync, drawingEnabled }, ref) {
    const canvasElRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const fabricRef = useRef<FabricCanvas | null>(null);
    const fabricLibRef = useRef<FabricNS | null>(null);
    const layoutResizeRef = useRef<(() => void) | null>(null);
    const annPropsRef = useRef({ tool, color, brushSize, drawingEnabled });
    annPropsRef.current = { tool, color, brushSize, drawingEnabled };
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
           * Window-level pan capture from react-zoom-pan-pinch is stopped on the
           * annotation container while drawing (see effect below).
           */
          enablePointerEvents: true,
          perPixelTargetFind: true,
          targetFindTolerance: 8,
        });
        fabricRef.current = canvas;

        /** Parent uses CSS transforms (zoom/pan). Refresh offset before Fabric handles the pointer. */
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

      applyToolToCanvas(canvas, tool, color, brushSize, emitSync, drawingEnabled, fabricLibRef.current);
    }, [tool, color, brushSize, drawingEnabled, emitSync]);

    /**
     * react-zoom-pan-pinch attaches `mousedown` on `window` for pan start. Even when
     * `panning.disabled` is true, `onPanningStart` still runs and can fight Fabric.
     * After Fabric handles the event on the upper canvas, stop bubbling at this wrapper.
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
      ref,
      () => ({
        loadRemoteJSON(json: string) {
          const canvas = fabricRef.current;
          if (!canvas) return;
          cancelPendingDebouncedSync();
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
            );
          });
        },

        clearCanvas(_local = false) {
          const canvas = fabricRef.current;
          if (!canvas) return;
          cancelPendingDebouncedSync();
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
            canvas.remove(objects[objects.length - 1]);
            canvas.requestRenderAll();
            emitSync(canvas);
          }
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
