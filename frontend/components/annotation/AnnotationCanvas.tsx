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
}

interface Props {
  tool: AnnotationTool;
  color: string;
  brushSize: number;
  onSync: (json: string) => void;
}

/** Convert a hex color to rgba() string with the given alpha (0–1). */
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const AnnotationCanvas = forwardRef<AnnotationCanvasHandle, Props>(
  function AnnotationCanvas({ tool, color, brushSize, onSync }, ref) {
    const canvasElRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const fabricRef = useRef<FabricCanvas | null>(null);
    const isRemoteLoadRef = useRef(false);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Emit serialized canvas (debounced for large payloads) ──────────────
    const emitSync = useCallback(
      (canvas: FabricCanvas) => {
        const json = JSON.stringify(canvas.toJSON());
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        if (json.length >= DEBOUNCE_THRESHOLD_BYTES) {
          debounceTimerRef.current = setTimeout(() => onSync(json), DEBOUNCE_MS);
        } else {
          onSync(json);
        }
      },
      [onSync],
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
        resize();

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

      // Always remove previous mouse handlers before setting new ones
      canvas.off('mouse:down');
      canvas.off('mouse:move');

      if (tool === 'pen') {
        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush.color = color;
        canvas.freeDrawingBrush.width = brushSize;
      } else if (tool === 'highlighter') {
        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush.color = hexToRgba(color, 0.35);
        canvas.freeDrawingBrush.width = Math.max(brushSize, 20);
      } else if (tool === 'eraser') {
        canvas.isDrawingMode = false;
        canvas.on('mouse:down', (opt: any) => {
          const target = canvas.findTarget(opt.e, false);
          if (target) {
            canvas.remove(target);
            canvas.requestRenderAll();
          }
        });
      }
    }, [tool, color, brushSize]);

    // ── Expose imperative handles ─────────────────────────────────────────
    useImperativeHandle(
      ref,
      () => ({
        loadRemoteJSON(json: string) {
          const canvas = fabricRef.current;
          if (!canvas) return;
          isRemoteLoadRef.current = true;
          canvas.loadFromJSON(json, () => {
            canvas.renderAll();
            isRemoteLoadRef.current = false;
          });
        },

        clearCanvas(local = false) {
          const canvas = fabricRef.current;
          if (!canvas) return;
          isRemoteLoadRef.current = true;
          canvas.clear();
          canvas.setBackgroundColor('white', () => {
            canvas.renderAll();
            isRemoteLoadRef.current = false;
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
      }),
      [emitSync],
    );

    return (
      <div
        ref={containerRef}
        className="absolute inset-0 z-10 pointer-events-auto"
        style={{ cursor: tool === 'eraser' ? 'cell' : tool === 'stamp' ? 'copy' : 'crosshair' }}
      >
        <canvas ref={canvasElRef} className="absolute inset-0" />
      </div>
    );
  },
);

export default AnnotationCanvas;
