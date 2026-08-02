'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen, Check, Copy, Eraser, Gamepad2, Highlighter,
  Mic, MicOff, Pencil, Phone, Trash2, Undo2, Users, Video, VideoOff,
} from 'lucide-react';

export type AnnotationTool = 'pen' | 'eraser' | 'highlighter';
export type ReadingInteractionMode = 'book' | AnnotationTool;

const COLORS = [
  { value: '#ef4444', cls: 'bg-red-500',    label: 'Red'    },
  { value: '#f0c75e', cls: 'bg-yellow-400', label: 'Yellow' },
  { value: '#22c55e', cls: 'bg-green-500',  label: 'Green'  },
  { value: '#3b82f6', cls: 'bg-blue-500',   label: 'Blue'   },
  { value: '#a855f7', cls: 'bg-purple-500', label: 'Purple' },
] as const;

const REACTIONS = ['⭐', '❤️', '🎉', '👏', '😂', '🐾', '😊', '👍'] as const;

const MIN_BRUSH = 2;
const MAX_BRUSH = 32;

interface AnnotationToolbarProps {
  // Annotation
  interactionMode: ReadingInteractionMode;
  onInteractionModeChange: (m: ReadingInteractionMode) => void;
  color: string;
  brushSize: number;
  onColorChange: (c: string) => void;
  onBrushSizeChange: (s: number) => void;
  onClear: () => void;
  onUndo: () => void;
  onReaction?: (emoji: string) => void;
  // Media dock
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onCopyInvite?: () => void;
  linkCopied?: boolean;
  onOpenParticipants: () => void;
  onOpenActivities?: () => void;
  onEndSession: () => void;
  role: 'host' | 'guest';
  participantCount: number;
  /** Merged onto the root wrapper (e.g. `items-start` for left-aligned stacks). */
  className?: string;
  /** Hide book/pen/highlighter/eraser toggles and the draw sub-panel (incl. Clear). Used in activity mode. */
  hideAnnotationTools?: boolean;
}

/**
 * Fixed tooltip portaled to document.body (above the trigger) so it does not
 * expand scrollable overflow from ancestors (e.g. toolbar row uses
 * overflow-x-auto, which forces overflow-y to compute to auto).
 */
export function DockTip({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const measure = useCallback(() => {
    const root = wrapRef.current;
    if (!root) return;
    const el = root.querySelector('button, [role="slider"]') ?? root;
    setRect((el as HTMLElement).getBoundingClientRect());
  }, []);

  const show = useCallback(() => {
    setOpen(true);
    measure();
  }, [measure]);

  const hide = useCallback(() => {
    setOpen(false);
    setRect(null);
  }, []);

  const onBlurWrap = useCallback(() => {
    requestAnimationFrame(() => {
      const root = wrapRef.current;
      if (!root?.contains(document.activeElement)) hide();
    });
  }, [hide]);

  useEffect(() => {
    if (!open) return;
    measure();
    const onScrollOrResize = () => measure();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, measure]);

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={onBlurWrap}
    >
      {children}
      {open && rect && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="pointer-events-none rounded-md bg-stone-950 px-2 py-1 text-[10px] font-semibold whitespace-nowrap text-white shadow-lg"
              style={{
                position: 'fixed',
                left: rect.left + rect.width / 2,
                top: rect.top - 8,
                transform: 'translate(-50%, -100%)',
                zIndex: 10000,
              }}
            >
              <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-stone-950" aria-hidden />
              {label}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

const btnBase = 'cursor-pointer touch-manipulation select-none flex shrink-0 items-center justify-center rounded-full border-2 transition-all active:scale-95';
const btnSm = 'h-12 w-12 sm:h-14 sm:w-14';
const btnMd = 'h-14 w-14 sm:h-16 sm:w-16';

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
  isMicEnabled,
  isCameraEnabled,
  onToggleMic,
  onToggleCamera,
  onCopyInvite,
  linkCopied,
  onOpenParticipants,
  onOpenActivities,
  onEndSession,
  role,
  participantCount,
  className,
  hideAnnotationTools = false,
}: AnnotationToolbarProps) {
  const drawing = interactionMode !== 'book';
  const brushPct = ((brushSize - MIN_BRUSH) / (MAX_BRUSH - MIN_BRUSH)) * 100;
  const brushTrackRef = useRef<HTMLDivElement>(null);

  // sub-panel: null | 'draw' | 'react'
  const [subPanel, setSubPanel] = useState<null | 'draw' | 'react'>(null);

  // Close sub-panel on Escape
  useEffect(() => {
    if (!subPanel) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setSubPanel(null); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [subPanel]);

  // Sync subPanel with interactionMode
  useEffect(() => {
    if (interactionMode === 'book') {
      setSubPanel(null);
    } else if (subPanel === 'react') {
      setSubPanel('draw');
    } else if (subPanel === null) {
      setSubPanel('draw');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactionMode]);

  const setBrushFromClientX = useCallback((clientX: number) => {
    const el = brushTrackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onBrushSizeChange(Math.round(MIN_BRUSH + pct * (MAX_BRUSH - MIN_BRUSH)));
  }, [onBrushSizeChange]);

  const onBrushPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setBrushFromClientX(e.clientX);
  }, [setBrushFromClientX]);

  const onBrushPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    setBrushFromClientX(e.clientX);
  }, [setBrushFromClientX]);

  const onBrushPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  function handleToolClick(mode: ReadingInteractionMode) {
    if (mode === 'book') {
      onInteractionModeChange('book');
      setSubPanel(null);
    } else {
      const already = interactionMode === mode;
      onInteractionModeChange(mode);
      setSubPanel(already && subPanel === 'draw' ? null : 'draw');
    }
  }

  function handleReactClick() {
    const already = subPanel === 'react';
    setSubPanel(already ? null : 'react');
  }

  // Active styles
  const ringBook = interactionMode === 'book'
    ? 'border-[#3b85a6] bg-[#3b85a6]/25 text-white shadow-[0_0_20px_rgba(59,133,166,0.35)]'
    : 'border-white/10 text-stone-400 hover:bg-white/10 hover:text-white';

  const ringTool = (t: AnnotationTool) => interactionMode === t
    ? 'border-[#764f84] bg-[#764f84]/40 text-white shadow-[0_0_20px_rgba(118,79,132,0.4)]'
    : 'border-white/10 text-stone-400 hover:bg-white/10 hover:text-white';

  const ringReact = subPanel === 'react'
    ? 'border-[#f0c75e] bg-[#f0c75e]/20 text-[#f0c75e]'
    : 'border-white/10 text-stone-400 hover:bg-white/10 hover:text-white';

  return (
    <div
      className={`pointer-events-auto relative flex flex-col items-center gap-3 overflow-visible ${className ?? ''}`}
    >
      {/* ── Sub-panel (above the main bar) ─────────────────────────── */}
      {!hideAnnotationTools && subPanel === 'draw' && (
        <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/10 bg-[#2b2a3f]/92 px-4 py-3 shadow-2xl backdrop-blur-xl">
          {/* Colors */}
          <div className="flex items-center gap-1.5">
            {COLORS.map((c) => (
              <DockTip key={c.value} label={c.label}>
                <button
                  type="button"
                  aria-label={`${c.label} colour${color === c.value ? ' (selected)' : ''}`}
                  aria-pressed={color === c.value}
                  onClick={() => onColorChange(c.value)}
                  className={`h-8 w-8 cursor-pointer rounded-full ${c.cls} transition-all touch-manipulation select-none ${color === c.value ? 'ring-2 ring-white/70 scale-110' : 'ring-2 ring-transparent opacity-70 hover:opacity-100'}`}
                />
              </DockTip>
            ))}
          </div>

          {/* Divider */}
          <div className="h-8 w-px shrink-0 bg-white/10" aria-hidden />

          {/* Brush size */}
          <div className="flex flex-col gap-1 min-w-[100px] max-w-[130px]">
            <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-stone-500">
              <label htmlFor="brush-size-unified">Brush</label>
              <span aria-live="polite" className="tabular-nums">{brushSize}px</span>
            </div>
            <div
              ref={brushTrackRef}
              id="brush-size-unified"
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
                if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onBrushSizeChange(Math.min(MAX_BRUSH, brushSize + 1)); }
                if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onBrushSizeChange(Math.max(MIN_BRUSH, brushSize - 1)); }
              }}
            >
              <div className="pointer-events-none h-full rounded-full bg-[#f0c75e]" style={{ width: `${brushPct}%` }} />
            </div>
          </div>

          {/* Divider */}
          <div className="h-8 w-px shrink-0 bg-white/10" aria-hidden />

          {/* Undo */}
          <DockTip label="Undo">
            <button
              type="button"
              aria-label="Undo last stroke"
              onClick={onUndo}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-stone-400 transition-colors hover:bg-white/10 hover:text-white touch-manipulation select-none"
            >
              <Undo2 className="h-5 w-5" aria-hidden />
            </button>
          </DockTip>

          {/* Clear */}
          <DockTip label="Clear">
            <button
              type="button"
              aria-label="Clear canvas"
              onClick={onClear}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-stone-400 transition-colors hover:bg-red-900/30 hover:text-red-400 touch-manipulation select-none"
            >
              <Trash2 className="h-5 w-5" aria-hidden />
            </button>
          </DockTip>
        </div>
      )}

      {subPanel === 'react' && (
        <div className="flex flex-wrap items-center justify-center gap-1 rounded-2xl border border-white/10 bg-[#2b2a3f]/92 px-4 py-3 shadow-2xl backdrop-blur-xl sm:gap-2">
          {REACTIONS.map((e) => (
            <DockTip key={e} label={e}>
              <button
                type="button"
                aria-label={`Send reaction ${e}`}
                onClick={() => { onReaction?.(e); setSubPanel(null); }}
                className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-lg transition-all hover:bg-stone-800/50 active:scale-90 touch-manipulation select-none"
              >
                {e}
              </button>
            </DockTip>
          ))}
        </div>
      )}

      {/* ── Main circular button row ────────────────────────────────── */}
      <div
        role="toolbar"
        aria-label="Reading and session controls"
        className="flex max-w-full items-center gap-1.5 overflow-x-auto overflow-y-hidden rounded-full border border-white/10 bg-[#2b2a3f]/92 px-3 py-2.5 shadow-2xl backdrop-blur-xl sm:gap-2 sm:px-5 sm:py-3"
      >
        {/* Book mode */}
        {!hideAnnotationTools && (
          <DockTip label="Book">
            <button type="button" aria-label="Book mode — flip pages" aria-pressed={interactionMode === 'book'}
              onClick={() => handleToolClick('book')}
              className={`${btnBase} ${btnMd} ${ringBook}`}>
              <BookOpen className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden />
            </button>
          </DockTip>
        )}

        {/* Pen */}
        {!hideAnnotationTools && (
          <DockTip label="Pen">
            <button type="button" aria-label="Pen tool" aria-pressed={interactionMode === 'pen'}
              onClick={() => handleToolClick('pen')}
              className={`${btnBase} ${btnMd} ${ringTool('pen')}`}>
              <Pencil className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden />
            </button>
          </DockTip>
        )}

        {/* Highlighter */}
        {!hideAnnotationTools && (
          <DockTip label="Highlight">
            <button type="button" aria-label="Highlighter tool" aria-pressed={interactionMode === 'highlighter'}
              onClick={() => handleToolClick('highlighter')}
              className={`${btnBase} ${btnMd} ${ringTool('highlighter')}`}>
              <Highlighter className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden />
            </button>
          </DockTip>
        )}

        {/* Eraser */}
        {!hideAnnotationTools && (
          <DockTip label="Eraser">
            <button type="button" aria-label="Eraser tool" aria-pressed={interactionMode === 'eraser'}
              onClick={() => handleToolClick('eraser')}
              className={`${btnBase} ${btnMd} ${ringTool('eraser')}`}>
              <Eraser className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden />
            </button>
          </DockTip>
        )}

        {/* Reactions */}
        <DockTip label="React">
          <button type="button" aria-label="Send a reaction" aria-pressed={subPanel === 'react'}
            onClick={handleReactClick}
            className={`${btnBase} ${btnMd} ${ringReact}`}>
            <span className="text-xl" aria-hidden>😊</span>
          </button>
        </DockTip>

        {/* Divider */}
        <div className="mx-0.5 h-10 w-px shrink-0 bg-white/10 sm:mx-1.5" aria-hidden />

        {/* Mic */}
        <DockTip label={isMicEnabled ? 'Mute' : 'Unmute'}>
          <button type="button"
            aria-label={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
            aria-pressed={!isMicEnabled}
            onClick={onToggleMic}
            className={`${btnBase} ${btnMd} ${isMicEnabled ? 'border-[#3b85a6] bg-[#3b85a6]/25 text-white shadow-[0_0_20px_rgba(59,133,166,0.35)]' : 'border-red-500/60 bg-red-950/40 text-red-200'}`}>
            {isMicEnabled ? <Mic className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden /> : <MicOff className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden />}
          </button>
        </DockTip>

        {/* Camera */}
        <DockTip label={isCameraEnabled ? 'Camera off' : 'Camera on'}>
          <button type="button"
            aria-label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
            aria-pressed={!isCameraEnabled}
            onClick={onToggleCamera}
            className={`${btnBase} ${btnMd} ${isCameraEnabled ? 'border-[#3b85a6] bg-[#3b85a6]/25 text-white shadow-[0_0_20px_rgba(59,133,166,0.35)]' : 'border-red-500/60 bg-red-950/40 text-red-200'}`}>
            {isCameraEnabled ? <Video className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden /> : <VideoOff className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden />}
          </button>
        </DockTip>

        {/* Divider */}
        <div className="mx-0.5 h-10 w-px shrink-0 bg-white/10 sm:mx-1.5" aria-hidden />

        {/* Copy invite (host only) */}
        {onCopyInvite && (
          <DockTip label={linkCopied ? 'Copied!' : 'Copy invite'}>
            <button type="button" aria-label="Copy invite link" onClick={onCopyInvite}
              className={`${btnBase} ${btnSm} border-teal-500/40 bg-teal-950/40 text-teal-200 hover:bg-teal-900/50`}>
              {linkCopied ? <Check className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden /> : <Copy className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden />}
            </button>
          </DockTip>
        )}

        {/* Participants */}
        <DockTip label="People">
          <button type="button" aria-label="Open participants and video" onClick={onOpenParticipants}
            className={`${btnBase} ${btnSm} relative border-orange-400/45 bg-orange-950/35 text-orange-200 hover:bg-orange-900/45`}>
            <Users className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden />
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-400 px-1 text-[9px] font-bold text-stone-900">
              {participantCount}
            </span>
          </button>
        </DockTip>

        {/* Activities (host only) */}
        {onOpenActivities && (
          <DockTip label="Activities">
            <button type="button" aria-label="Open activities" onClick={onOpenActivities}
              className={`${btnBase} ${btnSm} border-pink-400/45 bg-pink-950/35 text-pink-200 hover:bg-pink-900/40`}>
              <Gamepad2 className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden />
            </button>
          </DockTip>
        )}

        {/* End / Leave session */}
        <DockTip label={role === 'host' ? 'End session' : 'Leave'}>
          <button type="button"
            aria-label={role === 'host' ? 'End session' : 'Leave session'}
            onClick={onEndSession}
            className={`${btnBase} ${btnSm} border-red-500/50 bg-red-950/50 text-red-200 hover:bg-red-900/60`}>
            <Phone className="h-5 w-5 sm:h-6 sm:w-6 rotate-[135deg]" aria-hidden />
          </button>
        </DockTip>
      </div>
    </div>
  );
}
