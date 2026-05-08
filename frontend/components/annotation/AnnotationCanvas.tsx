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

function applyToolToCanvas(
  canvas: FabricCanvas,
  tool: AnnotationTool,
  color: string,
  brushSize: number,
  emitSync: (c: FabricCanvas) => void,
  drawingEnabled: boolean,
) {
  canvas.off('mouse:down');
  canvas.off('mouse:move');

  if (!drawingEnabled) {
    canvas.isDrawingMode = false;
    canvas.defaultCursor = 'default';
    canvas.hoverCursor = 'default';
    (canvas as { freeDrawingCursor?: string }).freeDrawingCursor = 'default';
    const passthrough = canvas.upperCanvasEl as HTMLCanvasElement | undefined;
    if (passthrough) passthrough.style.cursor = 'default';
    return;
  }

  const brush = canvas.freeDrawingBrush;
  if (brush && typeof brush === 'object') {
    (brush as { strokeLineCap?: string }).strokeLineCap = 'round';
    (brush as { strokeLineJoin?: string }).strokeLineJoin = 'round';
  }

  if (tool === 'pen') {
    canvas.isDrawingMode = true;
    canvas.defaultCursor = 'crosshair';
    canvas.hoverCursor = 'crosshair';
    (canvas as { freeDrawingCursor?: string }).freeDrawingCursor = 'crosshair';
    canvas.freeDrawingBrush.color = color;
    canvas.freeDrawingBrush.width = brushSize;
  } else if (tool === 'highlighter') {
    canvas.isDrawingMode = true;
    canvas.defaultCursor = 'crosshair';
    canvas.hoverCursor = 'crosshair';
    (canvas as { freeDrawingCursor?: string }).freeDrawingCursor = 'crosshair';
    canvas.freeDrawingBrush.color = hexToRgba(color, 0.35);
    canvas.freeDrawingBrush.width = Math.max(brushSize, 20);
  } else if (tool === 'eraser') {
    canvas.isDrawingMode = false;
    canvas.defaultCursor = 'pointer';
    canvas.hoverCursor = 'pointer';
    canvas.on('mouse:down', (opt: any) => {
      const target = canvas.findTarget(opt.e, false);
      if (target) {
        canvas.remove(target);
        canvas.requestRenderAll();
        emitSync(canvas);
      }
    });
  }

  const upper = canvas.upperCanvasEl as HTMLCanvasElement | undefined;
  if (upper) {
    upper.style.cursor = tool === 'eraser' ? 'pointer' : 'crosshair';
  }
}

const AnnotationCanvas = forwardRef<AnnotationCanvasHandle, Props>(
  function AnnotationCanvas({ tool, color, brushSize, onSync, drawingEnabled }, ref) {
    const canvasElRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const fabricRef = useRef<FabricCanvas | null>(null);
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

      import('fabric').then(({ fabric }) => {
        canvas = new fabric.Canvas(canvasElRef.current!, {
          isDrawingMode: true,
          selection: false,
          renderOnAddRemove: true,
        });
        fabricRef.current = canvas;

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
        layoutResizeRef.current = null;
        resizeObs?.disconnect();
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        try { canvas?.dispose(); } catch { /* ignore */ }
        fabricRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Update brush / tool when props change ─────────────────────────────
    useEffect(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      applyToolToCanvas(canvas, tool, color, brushSize, emitSync, drawingEnabled);
    }, [tool, color, brushSize, drawingEnabled, emitSync]);

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
        },
      }),
      [emitSync, cancelPendingDebouncedSync, syncNow],
    );

    return (
      <div
        ref={containerRef}
        className={`absolute inset-0 z-10 ${drawingEnabled ? 'pointer-events-auto' : 'pointer-events-none'}`}
        style={{
          cursor: drawingEnabled ? (tool === 'eraser' ? 'cell' : 'crosshair') : 'default',
        }}
      >
        <canvas ref={canvasElRef} className="absolute inset-0" />
      </div>
    );
  },
);

export default AnnotationCanvas;
