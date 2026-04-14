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
  /** Load remote canvas JSON (suppresses re-broadcast). */
  loadRemoteJSON(json: string): void;
  /** Clear all objects on the canvas (broadcasts clear if local=true). */
  clearCanvas(local?: boolean): void;
}

interface Props {
  tool: AnnotationTool;
  color: string;
  brushSize: number;
  /** Called whenever the local canvas changes; passes serialized JSON. */
  onSync: (json: string) => void;
}

const AnnotationCanvas = forwardRef<AnnotationCanvasHandle, Props>(
  function AnnotationCanvas({ tool, color, brushSize, onSync }, ref) {
    const canvasElRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const fabricRef = useRef<FabricCanvas | null>(null);
    // When loading remote JSON we set this flag to prevent echoing back.
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

        // Resize to container
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

        // Sync after drawing ends
        canvas.on('path:created', () => {
          if (isRemoteLoadRef.current) return;
          emitSync(canvas);
        });

        canvas.on('object:removed', () => {
          if (isRemoteLoadRef.current) return;
          emitSync(canvas);
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

    // ── Update brush when tool/color/size changes ─────────────────────────
    useEffect(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      if (tool === 'pen') {
        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush.color = color;
        canvas.freeDrawingBrush.width = brushSize;

        // Remove any eraser mouse handlers previously set
        canvas.off('mouse:down');
        canvas.off('mouse:move');
      } else {
        // Eraser: disable drawing mode, use mouse:down to delete clicked object
        canvas.isDrawingMode = false;
        canvas.off('mouse:down');
        canvas.on('mouse:down', (opt: any) => { // any: Fabric.js event type
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
          if (!local) isRemoteLoadRef.current = true;
          canvas.clear();
          canvas.renderAll();
          isRemoteLoadRef.current = false;
          if (local) {
            // emit clear state
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
        style={{ cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}
      >
        <canvas ref={canvasElRef} className="absolute inset-0" />
      </div>
    );
  },
);

export default AnnotationCanvas;
