'use client';

import { useCallback, useRef } from 'react';
import { BookOpen, Eraser, Highlighter, Pencil, Trash2, Undo2 } from 'lucide-react';

export type AnnotationTool = 'pen' | 'eraser' | 'highlighter';
export type ReadingInteractionMode = 'book' | AnnotationTool;

const COLORS = [
  { value: '#ef4444', cls: 'bg-red-500', label: 'Red' },
  { value: '#f0c75e', cls: 'bg-yellow-400', label: 'Yellow' },
  { value: '#22c55e', cls: 'bg-green-500', label: 'Green' },
  { value: '#3b82f6', cls: 'bg-blue-500', label: 'Blue' },
  { value: '#a855f7', cls: 'bg-purple-500', label: 'Purple' },
] as const;

const REACTIONS = ['⭐', '❤️', '🎉', '👏', '😂', '🐾', '😊', '👍'] as const;

interface AnnotationToolbarProps {
  interactionMode: ReadingInteractionMode;
  onInteractionModeChange: (m: ReadingInteractionMode) => void;
  color: string;
  brushSize: number;
  onColorChange: (c: string) => void;
  onBrushSizeChange: (s: number) => void;
  onClear: () => void;
  onUndo: () => void;
  onReaction?: (emoji: string) => void;
  /** Tooltips above controls (default) or below — use below when the bar is fixed at the bottom */
  tooltipPlacement?: 'above' | 'below';
  className?: string;
}

const MIN_BRUSH = 2;
const MAX_BRUSH = 32;

function TipAbove({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-[60] mb-2 -translate-x-1/2 rounded-md bg-stone-950 px-2 py-1 text-[10px] font-semibold whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      {children}
      <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-stone-950" />
    </div>
  );
}

function TipBelow({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute top-full left-1/2 z-[60] mt-2 -translate-x-1/2 rounded-md bg-stone-950 px-2 py-1 text-[10px] font-semibold whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <div className="absolute left-1/2 bottom-full -translate-x-1/2 border-4 border-transparent border-b-stone-950" />
      {children}
    </div>
  );
}

export function AnnotationToolbar({
  interactionMode,
  onInteractionModeChange,
  color,
  brushSize,
  onColorChange,
  onBrushSizeChange,
  onClear,
  onUndo,
  onReaction,
  tooltipPlacement = 'above',
  className: classNameProp,
}: AnnotationToolbarProps) {
  const Tip = tooltipPlacement === 'below' ? TipBelow : TipAbove;
  const brushTrackRef = useRef<HTMLDivElement>(null);
  const brushPct = ((brushSize - MIN_BRUSH) / (MAX_BRUSH - MIN_BRUSH)) * 100;
  const drawing = interactionMode !== 'book';
  const tool = interactionMode === 'book' ? 'pen' : interactionMode;

  const setBrushFromClientX = useCallback(
    (clientX: number) => {
      const el = brushTrackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      onBrushSizeChange(Math.round(MIN_BRUSH + pct * (MAX_BRUSH - MIN_BRUSH)));
    },
    [onBrushSizeChange],
  );

  const onBrushPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setBrushFromClientX(e.clientX);
    },
    [setBrushFromClientX],
  );

  const onBrushPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      setBrushFromClientX(e.clientX);
    },
    [setBrushFromClientX],
  );

  const onBrushPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const btnClass = 'cursor-pointer touch-manipulation select-none';

  const ringBook =
    interactionMode === 'book'
      ? 'bg-[#3b85a6]/35 text-white shadow-[0_0_0_2px_rgba(59,133,166,0.5)]'
      : 'text-stone-400 hover:bg-white/10 hover:text-white';

  const ringTool = (t: AnnotationTool) =>
    interactionMode === t
      ? 'bg-[#764f84] text-white shadow-[0_0_0_2px_rgba(168,85,247,0.45)]'
      : 'text-stone-400 hover:bg-white/10 hover:text-white';

  return (
    <div
      role="toolbar"
      aria-label="Reading and annotation tools"
      className={`flex max-w-full items-center gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.07] px-3 py-2 shadow-2xl backdrop-blur-xl sm:gap-3 sm:px-4 ${classNameProp ?? ''}`}
    >
      <div role="group" aria-label="Interaction mode" className="flex shrink-0 items-center gap-1 border-r border-white/10 pr-2 sm:pr-3">
        <div className="group relative">
          <button
            type="button"
            aria-label="Turn pages — swipe, corners, or use Next"
            aria-pressed={interactionMode === 'book'}
            onClick={() => onInteractionModeChange('book')}
            className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${btnClass} ${ringBook}`}
          >
            <BookOpen className="h-[22px] w-[22px]" />
          </button>
          <Tip>Book · flip pages</Tip>
        </div>
        <div className="group relative">
          <button
            type="button"
            aria-label="Pen tool"
            aria-pressed={tool === 'pen' && drawing}
            onClick={() => onInteractionModeChange('pen')}
            className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${btnClass} ${ringTool('pen')}`}
          >
            <Pencil className="h-[22px] w-[22px]" />
          </button>
          <Tip>Pen</Tip>
        </div>
        <div className="group relative">
          <button
            type="button"
            aria-label="Highlighter tool"
            aria-pressed={tool === 'highlighter' && drawing}
            onClick={() => onInteractionModeChange('highlighter')}
            className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${btnClass} ${ringTool('highlighter')}`}
          >
            <Highlighter className="h-[22px] w-[22px]" />
          </button>
          <Tip>Highlighter</Tip>
        </div>
        <div className="group relative">
          <button
            type="button"
            aria-label="Eraser tool"
            aria-pressed={tool === 'eraser' && drawing}
            onClick={() => onInteractionModeChange('eraser')}
            className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${btnClass} ${ringTool('eraser')}`}
          >
            <Eraser className="h-[22px] w-[22px]" />
          </button>
          <Tip>Eraser</Tip>
        </div>
        <div className="group relative">
          <button
            type="button"
            aria-label="Undo last stroke"
            onClick={onUndo}
            disabled={!drawing}
            className={`flex h-10 w-10 items-center justify-center rounded-xl text-stone-400 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30 ${btnClass}`}
          >
            <Undo2 className="h-[22px] w-[22px]" />
          </button>
          <Tip>Undo</Tip>
        </div>
      </div>

      <div role="group" aria-label="Reactions" className="flex shrink-0 items-center gap-0.5 border-r border-white/10 pr-2 sm:gap-1 sm:pr-3">
        {REACTIONS.map((e) => (
          <div key={e} className="group relative">
            <button
              type="button"
              aria-label={`Send reaction ${e}`}
              onClick={() => onReaction?.(e)}
              className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm transition-all hover:bg-stone-800/50 active:scale-90 sm:h-10 sm:w-10 sm:text-base ${btnClass}`}
            >
              {e}
            </button>
            <Tip>{e}</Tip>
          </div>
        ))}
      </div>

      {drawing && (
        <div role="group" aria-label="Brush colour" className="flex shrink-0 items-center gap-1 border-r border-white/10 pr-2 sm:gap-1.5 sm:pr-3">
          {COLORS.map((c) => (
            <div key={c.value} className="group relative">
              <button
                type="button"
                aria-label={`${c.label} colour${color === c.value ? ' (selected)' : ''}`}
                aria-pressed={color === c.value}
                onClick={() => onColorChange(c.value)}
                className={`h-7 w-7 rounded-full ${c.cls} transition-all ${btnClass} ${color === c.value ? 'ring-2 ring-white/60' : 'ring-2 ring-transparent'}`}
              />
              <Tip>{c.label}</Tip>
            </div>
          ))}
        </div>
      )}

      {drawing && (
        <div className="group relative flex min-w-[100px] max-w-[140px] shrink flex-col gap-1 sm:min-w-[120px] sm:max-w-[160px]">
          <div className="flex items-center justify-between gap-1 text-[9px] font-bold tracking-wider text-stone-500 uppercase">
            <label htmlFor="brush-size-track-rr" className="truncate">
              Brush
            </label>
            <span aria-live="polite" className="shrink-0 tabular-nums">
              {brushSize}px
            </span>
          </div>
          <div
            ref={brushTrackRef}
            id="brush-size-track-rr"
            role="slider"
            aria-label="Brush size"
            aria-valuemin={MIN_BRUSH}
            aria-valuemax={MAX_BRUSH}
            aria-valuenow={brushSize}
            tabIndex={0}
            className="relative h-2 w-full cursor-pointer touch-none overflow-hidden rounded-full bg-stone-800"
            onPointerDown={onBrushPointerDown}
            onPointerMove={onBrushPointerMove}
            onPointerUp={onBrushPointerUp}
            onPointerCancel={onBrushPointerUp}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                e.preventDefault();
                onBrushSizeChange(Math.min(MAX_BRUSH, brushSize + 1));
              }
              if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                e.preventDefault();
                onBrushSizeChange(Math.max(MIN_BRUSH, brushSize - 1));
              }
            }}
          >
            <div className="pointer-events-none h-full rounded-full bg-[#f0c75e]" style={{ width: `${brushPct}%` }} />
          </div>
          <Tip>Brush size</Tip>
        </div>
      )}

      <div className="group relative shrink-0">
        <button
          aria-label="Clear canvas"
          type="button"
          onClick={onClear}
          disabled={!drawing}
          className={`flex h-10 w-10 items-center justify-center rounded-xl text-stone-400 transition-colors hover:bg-red-900/20 hover:text-red-400 disabled:pointer-events-none disabled:opacity-30 ${btnClass}`}
        >
          <Trash2 className="h-[22px] w-[22px]" />
        </button>
        <Tip>Clear canvas</Tip>
      </div>
    </div>
  );
}
