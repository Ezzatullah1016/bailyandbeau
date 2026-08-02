'use client';

import { Eraser, Undo2 } from 'lucide-react';

const COLORS = ['#ef4444', '#f0c75e', '#22c55e', '#3b82f6', '#a855f7'];
const MIN_BRUSH = 2;
const MAX_BRUSH = 32;

export type ToolStripProps = {
  color: string;
  brushSize: number;
  onColorChange: (color: string) => void;
  onBrushSizeChange: (size: number) => void;
  onUndo: () => void;
  onClear: () => void;
};

/**
 * Drawing options, docked immediately beside the rail.
 *
 * These used to live in a "Tools" tab inside the session panel — three clicks
 * and a context switch away from the pen button that turns drawing on. Putting
 * them next to the rail means the control that opens them is adjacent to the
 * controls it reveals, and the book stays visible the whole time.
 */
export function ToolStrip({
  color,
  brushSize,
  onColorChange,
  onBrushSizeChange,
  onUndo,
  onClear,
}: ToolStripProps) {
  return (
    <div
      role="group"
      aria-label="Drawing tools"
      /* Top-aligned to the rail rather than centred on the viewport: a strip
         centred vertically opens level with the middle of the rail, which is
         nowhere near the pen button that opened it. */
      className="room-panel-strong pointer-events-auto absolute left-14 top-[18%] z-40 flex w-[76px] flex-col items-center gap-3 rounded-2xl px-2 py-3 sm:left-16"
    >
      <div className="flex flex-col items-center gap-1.5">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onColorChange(c)}
            aria-label={`Use this colour`}
            aria-pressed={color === c}
            className="h-7 w-7 shrink-0 cursor-pointer rounded-full transition-transform"
            style={{
              backgroundColor: c,
              transform: color === c ? 'scale(1.15)' : undefined,
              boxShadow: color === c ? '0 0 0 2px var(--room-ink)' : 'var(--elev-1)',
            }}
          />
        ))}
      </div>

      <div className="flex w-full flex-col items-center gap-1">
        <label className="sr-only" htmlFor="bb-brush-size">
          Brush size
        </label>
        {/* A native range input rather than the old click-to-position bar: that
            could not be dragged, and had no keyboard or screen-reader story. */}
        <input
          id="bb-brush-size"
          type="range"
          min={MIN_BRUSH}
          max={MAX_BRUSH}
          value={brushSize}
          onChange={(e) => onBrushSizeChange(Number(e.target.value))}
          className="w-full cursor-pointer accent-[var(--room-accent)]"
        />
        <span className="text-[10px] tabular-nums" style={{ color: 'var(--room-ink-soft)' }}>
          {brushSize}px
        </span>
      </div>

      <div
        className="flex w-full flex-col items-center gap-0.5 pt-1"
        style={{ borderTop: '1px solid var(--room-chrome-line)' }}
      >
        <button
          type="button"
          onClick={onUndo}
          aria-label="Undo last stroke"
          title="Undo"
          className="room-tap cursor-pointer rounded-xl"
          style={{ color: 'var(--room-ink)' }}
        >
          <Undo2 className="h-[18px] w-[18px]" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear all drawing"
          title="Clear"
          className="room-tap cursor-pointer rounded-xl"
          style={{ color: 'var(--room-ink)' }}
        >
          <Eraser className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </div>
    </div>
  );
}
