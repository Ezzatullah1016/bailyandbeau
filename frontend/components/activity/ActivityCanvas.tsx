'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useCallback } from 'react';

type FabricCanvas = any;

const DEBOUNCE_MS = 200;
const DEBOUNCE_THRESHOLD_BYTES = 50 * 1024;

export interface ActivityCanvasHandle {
  loadRemoteJSON(json: string): void;
  clearCanvas(local?: boolean): void;
  getJSON(): string;
}

interface Props {
  color: string;
  brushSize: number;
  tool: 'pen' | 'eraser';
  outlineImageUrl?: string;
  onSync: (json: string) => void;
}

const ActivityCanvas = forwardRef<ActivityCanvasHandle, Props>(
  function ActivityCanvas({ color, brushSize, tool, outlineImageUrl, onSync }, ref) {
    const canvasElRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const fabricRef = useRef<FabricCanvas | null>(null);
    const isRemoteLoadRef = useRef(false);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      });

      return () => {
        resizeObs?.disconnect();
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        try { canvas?.dispose(); } catch { /* ignore */ }
        fabricRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      if (tool === 'pen') {
        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush.color = color;
        canvas.freeDrawingBrush.width = brushSize;
        canvas.off('mouse:down');
      } else {
        canvas.isDrawingMode = false;
        canvas.off('mouse:down');
        canvas.on('mouse:down', (opt: any) => {
          const target = canvas.findTarget(opt.e, false);
          if (target) {
            canvas.remove(target);
            canvas.requestRenderAll();
          }
        });
      }
    }, [tool, color, brushSize]);

    useImperativeHandle(ref, () => ({
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
        if (local) emitSync(canvas);
      },
      getJSON() {
        const canvas = fabricRef.current;
        if (!canvas) return '{}';
        return JSON.stringify(canvas.toJSON());
      },
    }), [emitSync]);

    return (
      <div ref={containerRef} className="absolute inset-0 z-10 pointer-events-auto"
        style={{ cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}>
        {outlineImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={outlineImageUrl}
            alt="Coloring outline"
            className="absolute inset-0 w-full h-full object-contain pointer-events-none opacity-80"
          />
        )}
        <canvas ref={canvasElRef} className="absolute inset-0" />
      </div>
    );
  },
);

export default ActivityCanvas;
