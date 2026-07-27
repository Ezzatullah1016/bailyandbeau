'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { ActivityConfigData } from './types';

interface Props {
  role: 'host' | 'guest';
  activities: ActivityConfigData[];
  open: boolean;
  initialIndex?: number;
  initialStateByActivity?: Record<string, Record<string, unknown>>;
  onClose: () => void;
  onActivityStateSync?: (state: Record<string, unknown>) => void;
  /**
   * Presentation:
   * - 'modal' (default): centered popup overlay (reading-room in-book activities).
   * - 'stage': in-flow card that sits in the center stage (Activity Room); no
   *   overlay, no close button — the room framing (video, dock) stays visible.
   */
  variant?: 'modal' | 'stage';
  /** @deprecated use variant. `fullscreen` maps to 'stage'. */
  fullscreen?: boolean;
}

type Line = { points: number[]; color: string; width: number; eraser?: boolean };

function buildMsg(type: string, payload: Record<string, unknown>): Uint8Array {
  const json = JSON.stringify({ type, payload, ts: new Date().toISOString() });
  return new TextEncoder().encode(json);
}

export default function ActivityRoom({
  role,
  activities,
  open,
  initialIndex = 0,
  initialStateByActivity,
  onClose,
  onActivityStateSync,
  variant,
  fullscreen = false,
}: Props) {
  const room = useRoomContext();
  const isStage = variant === 'stage' || fullscreen;

  const [index, setIndex] = useState(initialIndex);
  const [stateByActivity, setStateByActivity] = useState<Record<string, Record<string, unknown>>>(
    initialStateByActivity ?? {},
  );

  useEffect(() => {
    setIndex(initialIndex);
  }, [initialIndex]);

  useEffect(() => {
    if (initialStateByActivity && Object.keys(initialStateByActivity).length > 0) {
      setStateByActivity(initialStateByActivity);
    }
  }, [initialStateByActivity]);

  const current = activities[index] ?? null;

  const currentState = useMemo(() => {
    if (!current) return {};
    return stateByActivity[current.id] ?? {};
  }, [current, stateByActivity]);

  const publishState = useCallback(
    (next: Record<string, Record<string, unknown>>) => {
      setStateByActivity(next);
      const activityState = {
        activity_open: true,
        activity_index: index,
        state_by_activity: next,
      };
      if (role === 'host') {
        onActivityStateSync?.(activityState);
      }
      // Guarded so the admin builder preview (no connected room) never crashes.
      try {
        room?.localParticipant?.publishData(
          buildMsg('ACTIVITY_SYNC', { activity_index: index, state_by_activity: next }),
          { reliable: true },
        );
      } catch {
        /* preview / disconnected room — no-op */
      }
    },
    [role, index, onActivityStateSync, room],
  );

  const patchCurrent = useCallback(
    (patch: Record<string, unknown>) => {
      if (!current) return;
      const next = {
        ...stateByActivity,
        [current.id]: { ...currentState, ...patch },
      };
      publishState(next);
    },
    [current, currentState, stateByActivity, publishState],
  );

  const goNext = () => {
    const next = Math.min(index + 1, activities.length - 1);
    if (next === index) return;
    if (role === 'host') {
      setIndex(next);
      publishState(stateByActivity);
      room.localParticipant.publishData(buildMsg('ACTIVITY_NAV', { index: next }), { reliable: true });
      onActivityStateSync?.({
        activity_open: true,
        activity_index: next,
        state_by_activity: stateByActivity,
      });
    }
  };

  const goPrev = () => {
    const next = Math.max(index - 1, 0);
    if (next === index) return;
    if (role === 'host') {
      setIndex(next);
      publishState(stateByActivity);
      room.localParticipant.publishData(buildMsg('ACTIVITY_NAV', { index: next }), { reliable: true });
      onActivityStateSync?.({
        activity_open: true,
        activity_index: next,
        state_by_activity: stateByActivity,
      });
    }
  };

  const resetCurrent = () => {
    if (!current || role !== 'host') return;
    const blank = defaultStateFor(current);
    const next = { ...stateByActivity, [current.id]: blank };
    publishState(next);
  };

  if (!open || activities.length === 0 || !current) return null;

  const ui = current.config.ui;
  const payload = current.config.payload;

  // Stage variant is an in-flow card that lives in the center stage (Activity
  // Room). Modal variant is the centered popup used inside the reading room.
  const CardInner = (
      <div
        className={
          isStage
            ? 'room-activity-card flex w-full max-w-5xl flex-col overflow-hidden min-h-[min(78vh,calc(100dvh-15rem))]'
            : 'room-activity-card flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden'
        }
      >
        {/* The activity header is a solid accent band — the reading room's
            chrome is deliberately translucent and recessive, so the two rooms
            read as different places rather than one skinned two ways. */}
        <header
          className="flex items-start justify-between gap-4 px-6 py-4"
          style={{ background: 'var(--room-accent)', color: 'var(--room-accent-contrast)' }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">
                Activity {index + 1} / {activities.length}
              </p>
              {activities.length > 1 && (
                <div className="flex items-center gap-1" aria-hidden>
                  {activities.map((a, i) => (
                    <span
                      key={a.id}
                      className={`h-1.5 rounded-full transition-all duration-200 ${
                        i === index ? 'w-4 bg-current' : 'w-1.5 bg-current/40'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
            <h2 className="font-headline truncate text-xl font-bold md:text-2xl">{ui.title || current.title}</h2>
            {ui.instructions ? (
              <p className="mt-1 max-w-xl text-sm opacity-90">{ui.instructions}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {role === 'host' && (
              <>
                <button
                  type="button"
                  onClick={resetCurrent}
                  className="flex min-h-11 cursor-pointer items-center gap-1 rounded-lg bg-white/15 px-3 py-2 text-xs font-bold transition-opacity hover:opacity-90"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </button>
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={index <= 0}
                  className="grid h-11 w-11 cursor-pointer place-items-center rounded-lg bg-white/15 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Previous activity"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={index >= activities.length - 1}
                  className="grid h-11 w-11 cursor-pointer place-items-center rounded-lg bg-white/15 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Next activity"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </>
            )}
            {role === 'host' && !isStage ? (
              <button
                type="button"
                onClick={() => {
                  room.localParticipant.publishData(buildMsg('ACTIVITY_CLOSE', {}), { reliable: true });
                  onClose();
                }}
                className="room-tap cursor-pointer rounded-lg bg-white/15 hover:opacity-90"
                aria-label="Close activities"
              >
                <X className="w-5 h-5" />
              </button>
            ) : null}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-6" style={{ background: 'var(--activity-paper)' }}>
          {/* keyed on index so switching activities fades in cleanly */}
          <div key={current.id} className="activity-in">
            <ActivityBody
              activity={current}
              payload={payload}
              role={role}
              state={currentState}
              patchCurrent={patchCurrent}
            />
          </div>
        </div>
      </div>
  );

  // Stage: card sits in the normal flow (center stage). Modal: centered overlay.
  if (isStage) return CardInner;
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-[#3d3b62]/95 backdrop-blur-md p-4">
      {CardInner}
    </div>
  );
}

function defaultStateFor(a: ActivityConfigData): Record<string, unknown> {
  switch (a.activity_type) {
    case 'drawing':
      return { lines: [] as Line[] };
    case 'quiz':
      return { selected: null as number | null, revealed: false };
    case 'drag_drop':
      return { assignments: {} as Record<string, string> };
    case 'hotspot':
      return { openId: null as string | null };
    default:
      return {};
  }
}

function ActivityBody({
  activity,
  payload,
  role,
  state,
  patchCurrent,
}: {
  activity: ActivityConfigData;
  payload: Record<string, unknown>;
  role: 'host' | 'guest';
  state: Record<string, unknown>;
  patchCurrent: (patch: Record<string, unknown>) => void;
}) {
  switch (activity.activity_type) {
    case 'drawing':
      return (
        <DrawingPane
          payload={payload}
          role={role}
          lines={(state.lines as Line[] | undefined) ?? []}
          setLines={(lines) => patchCurrent({ lines })}
        />
      );
    case 'quiz':
      return (
        <QuizPane
          payload={payload}
          role={role}
          state={state}
          patchCurrent={patchCurrent}
        />
      );
    case 'drag_drop':
      return (
        <DragDropPane
          payload={payload}
          role={role}
          assignments={(state.assignments as Record<string, string> | undefined) ?? {}}
          patchCurrent={patchCurrent}
        />
      );
    case 'hotspot':
      return (
        <HotspotPane
          payload={payload}
          role={role}
          openId={(state.openId as string | null | undefined) ?? null}
          patchCurrent={patchCurrent}
        />
      );
    default:
      return <p className="text-[#3d3b62]">Unsupported activity type.</p>;
  }
}

function DrawingPane({
  payload,
  role,
  lines,
  setLines,
}: {
  payload: Record<string, unknown>;
  role: 'host' | 'guest';
  lines: Line[];
  setLines: (lines: Line[]) => void;
}) {
  const palette = (payload.palette as string[]) ?? ['#222'];
  const brushSizes = (payload.brush_sizes as number[]) ?? [4];
  const allowEraser = Boolean(payload.allow_eraser);
  const backgroundUrl = typeof payload.background_url === 'string' ? payload.background_url : '';
  const allowSubmit = Boolean(payload.allow_submit);
  const [color, setColor] = useState(palette[0] ?? '#222');
  const [width, setWidth] = useState(brushSizes[0] ?? 4);
  const [eraser, setEraser] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const [bgLoaded, setBgLoaded] = useState(false);
  const drawing = useRef(false);
  const currentLine = useRef<number[]>([]);

  // Load the optional coloring-page background once.
  useEffect(() => {
    if (!backgroundUrl) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { bgImageRef.current = img; setBgLoaded(true); };
    img.onerror = () => { bgImageRef.current = null; setBgLoaded(false); };
    img.src = backgroundUrl;
  }, [backgroundUrl]);

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    // Draw the coloring-page background under the strokes when present.
    if (bgImageRef.current) {
      const img = bgImageRef.current;
      const scale = Math.min(c.width / img.width, c.height / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
    }
    for (const line of lines) {
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
    }
    ctx.globalCompositeOperation = 'source-over';
    // bgLoaded is intentionally a dep: redraw once the background image loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, bgLoaded]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  function submitArtwork() {
    const c = canvasRef.current;
    if (!c) return;
    // MVP: trigger a local download of the artwork and acknowledge. (A durable
    // server-side artwork store is future scope — see the Activity Room plan.)
    try {
      const dataUrl = c.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'my-artwork.png';
      a.click();
    } catch {
      // Tainted canvas from a cross-origin background — skip the download.
    }
    setSubmitted(true);
  }

  function pos(e: React.MouseEvent | React.TouchEvent) {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const scaleX = c.width / rect.width;
    const scaleY = c.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    drawing.current = true;
    const { x, y } = pos(e);
    currentLine.current = [x, y];
  }

  function moveDraw(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing.current) return;
    const { x, y } = pos(e);
    currentLine.current.push(x, y);
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const pts = currentLine.current;
    if (pts.length >= 4) {
      const i = pts.length - 4;
      ctx.beginPath();
      ctx.lineCap = 'round';
      ctx.lineWidth = width;
      if (eraser && allowEraser) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = color;
      }
      ctx.moveTo(pts[i], pts[i + 1]);
      ctx.lineTo(pts[i + 2], pts[i + 3]);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function endDraw() {
    if (!drawing.current) return;
    drawing.current = false;
    if (currentLine.current.length >= 4) {
      setLines([
        ...lines,
        {
          points: [...currentLine.current],
          color,
          width,
          eraser: eraser && allowEraser,
        },
      ]);
    }
    currentLine.current = [];
  }

  function clear() {
    setLines([]);
  }

  return (
    <div className="space-y-3">
      {(
        <div className="flex flex-wrap gap-2 items-center">
          {palette.map((p) => (
            <button
              key={p}
              type="button"
              style={{ backgroundColor: p }}
              className={`w-8 h-8 rounded-full border-2 ${color === p && !eraser ? 'border-[#3d3b62]' : 'border-transparent'}`}
              onClick={() => {
                setColor(p);
                setEraser(false);
              }}
              aria-label={`Color ${p}`}
            />
          ))}
          {brushSizes.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setWidth(s)}
              className={`px-2 py-1 rounded text-xs font-bold ${width === s ? 'bg-[#3d3b62] text-[#eccdca]' : 'bg-white border border-[#764f84]/30 text-[#3d3b62]'}`}
            >
              {s}px
            </button>
          ))}
          {allowEraser ? (
            <button
              type="button"
              onClick={() => setEraser(true)}
              className={`px-3 py-1 rounded text-xs font-bold ${eraser ? 'bg-[#764f84] text-[#eccdca]' : 'bg-white border border-[#764f84]/30'}`}
            >
              Eraser
            </button>
          ) : null}
          <button
            type="button"
            onClick={clear}
            className="ml-auto px-3 py-1 rounded bg-[#c84a71] text-white text-xs font-bold"
          >
            Clear
          </button>
        </div>
      )}
      <canvas
        ref={canvasRef}
        width={800}
        height={480}
        className="w-full max-h-[50vh] rounded-xl border border-[#764f84]/20 bg-white touch-none cursor-crosshair"
        onMouseDown={startDraw}
        onMouseMove={moveDraw}
        onMouseUp={endDraw}
        onMouseLeave={endDraw}
        onTouchStart={startDraw}
        onTouchMove={moveDraw}
        onTouchEnd={endDraw}
      />
      {allowSubmit ? (
        <div className="flex items-center justify-end gap-3">
          {submitted ? (
            <span className="font-karla text-sm font-bold text-[#3b85a6]">Artwork saved! 🎨</span>
          ) : null}
          <button
            type="button"
            onClick={submitArtwork}
            className="font-baloo px-5 py-2 rounded-lg bg-gradient-to-br from-[#f0c75e] to-[#c84a71] text-white text-sm font-bold shadow"
          >
            Submit Artwork ✓
          </button>
        </div>
      ) : null}
    </div>
  );
}

function QuizPane({
  payload,
  role: hostRole,
  state,
  patchCurrent,
}: {
  payload: Record<string, unknown>;
  role: 'host' | 'guest';
  state: Record<string, unknown>;
  patchCurrent: (patch: Record<string, unknown>) => void;
}) {
  const revealMode = String(payload.reveal_mode ?? 'instant');
  const questions = payload.questions as
    | { id: string; prompt: string; options: string[]; correct_index: number; image_url?: string; feedback_correct?: string; feedback_wrong?: string }[]
    | undefined;

  // ── 1.1: multi-question sequence ──────────────────────────────────────────
  if (Array.isArray(questions) && questions.length > 0) {
    const qs = questions;
    const qIndex = Math.min(Number(state.qIndex ?? 0), qs.length - 1);
    const answers = (state.answers as Record<string, number>) ?? {};
    const revealedMap = (state.revealed as Record<string, boolean>) ?? {};
    const q = qs[qIndex];
    const selected = answers[q.id];
    const revealed = Boolean(revealedMap[q.id]);
    const isLast = qIndex === qs.length - 1;

    function choose(i: number) {
      patchCurrent({
        answers: { ...answers, [q.id]: i },
        revealed: { ...revealedMap, [q.id]: revealMode === 'instant' ? true : revealed },
      });
    }
    function reveal() {
      if (hostRole !== 'host') return;
      patchCurrent({ revealed: { ...revealedMap, [q.id]: true } });
    }
    function go(delta: number) {
      if (hostRole !== 'host') return;
      const next = Math.min(Math.max(qIndex + delta, 0), qs.length - 1);
      patchCurrent({ qIndex: next });
    }

    const isCorrect = revealed && selected === q.correct_index;
    const isWrong = revealed && selected !== undefined && selected !== q.correct_index;

    return (
      <div className="space-y-4">
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2">
          {qs.map((qq, i) => (
            <span
              key={qq.id}
              className={`h-2 rounded-full transition-all ${i === qIndex ? 'w-6 bg-[#764f84]' : 'w-2 bg-[#764f84]/30'}`}
            />
          ))}
        </div>
        <p className="text-center text-xs font-bold uppercase tracking-wider text-[#764f84]">
          {qIndex + 1} of {qs.length}
        </p>

        {q.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={q.image_url} alt="" className="w-full max-h-[220px] object-contain rounded-xl border border-[#764f84]/20 bg-white" />
        ) : null}

        <p className="text-lg font-semibold text-[#3d3b62] text-center">{q.prompt}</p>

        <div className="grid gap-2">
          {q.options.map((opt, i) => {
            const isSel = selected === i;
            const showCorrect = revealed && i === q.correct_index;
            const showWrong = revealed && isSel && i !== q.correct_index;
            return (
              <button
                key={`${q.id}-${i}`}
                type="button"
                onClick={() => choose(i)}
                className={`text-left px-4 py-3 rounded-xl border-2 font-medium transition-all ${
                  showCorrect
                    ? 'border-[#3b85a6] bg-[#3b85a6]/15 text-[#3d3b62]'
                    : showWrong
                      ? 'border-[#c84a71] bg-[#c84a71]/10'
                      : isSel
                        ? 'border-[#764f84] bg-[#eccdca]/80 text-[#3d3b62]'
                        : 'border-[#764f84]/30 bg-white text-[#3d3b62] hover:border-[#764f84]'
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>

        {/* Feedback */}
        {isCorrect ? (
          <p className="text-center text-sm font-bold text-[#3b85a6]">{q.feedback_correct || 'Correct!'}</p>
        ) : isWrong ? (
          <p className="text-center text-sm font-bold text-[#c84a71]">{q.feedback_wrong || 'Not quite — try again!'}</p>
        ) : null}

        {revealMode === 'host_controlled' && hostRole === 'host' && !revealed ? (
          <button type="button" onClick={reveal} className="px-4 py-2 rounded-lg bg-[#f0c75e] text-[#3d3b62] font-bold text-sm">
            Reveal answer
          </button>
        ) : null}

        {/* Host navigation */}
        {hostRole === 'host' ? (
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => go(-1)}
              disabled={qIndex === 0}
              className="font-baloo px-4 py-2 rounded-lg border-2 border-[#764f84]/30 text-[#3d3b62] text-sm font-bold disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              disabled={isLast}
              className="font-baloo px-5 py-2 rounded-lg bg-[#764f84] text-white text-sm font-bold disabled:opacity-40"
            >
              {isLast ? 'Finished' : 'Next Question'}
            </button>
          </div>
        ) : (
          <p className="text-center text-xs text-[#764f84]">Your grown-up moves to the next question.</p>
        )}
      </div>
    );
  }

  // ── 1.0: single question ──────────────────────────────────────────────────
  const question = String(payload.question ?? '');
  const options = (payload.options as string[]) ?? [];
  const correct = payload.correct_index as number;
  const selected = (state.selected as number | null | undefined) ?? null;
  const revealed = Boolean(state.revealed);

  function choose(i: number) {
    patchCurrent({ selected: i, revealed: revealMode === 'instant' ? true : revealed });
  }
  function reveal() {
    if (hostRole !== 'host') return;
    patchCurrent({ revealed: true });
  }

  return (
    <div className="space-y-4">
      <p className="text-lg font-semibold text-[#3d3b62]">{question}</p>
      <div className="grid gap-2">
        {options.map((opt, i) => {
          const isSel = selected === i;
          const showCorrect = revealed && i === correct;
          const showWrong = revealed && isSel && i !== correct;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => choose(i)}
              className={`text-left px-4 py-3 rounded-xl border-2 font-medium transition-all ${
                showCorrect
                  ? 'border-[#3b85a6] bg-[#3b85a6]/15 text-[#3d3b62]'
                  : showWrong
                    ? 'border-[#c84a71] bg-[#c84a71]/10'
                    : isSel
                      ? 'border-[#764f84] bg-[#eccdca]/80 text-[#3d3b62]'
                      : 'border-[#764f84]/30 bg-white text-[#3d3b62] hover:border-[#764f84]'
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {revealMode === 'host_controlled' && hostRole === 'host' && !revealed ? (
        <button type="button" onClick={reveal} className="px-4 py-2 rounded-lg bg-[#f0c75e] text-[#3d3b62] font-bold text-sm">
          Reveal answer
        </button>
      ) : null}
      {revealMode === 'host_controlled' && hostRole === 'guest' && !revealed ? (
        <p className="text-sm text-[#764f84]">The host will reveal the answer when everyone is ready.</p>
      ) : null}
    </div>
  );
}

function DragDropPane({
  payload,
  role,
  assignments,
  patchCurrent,
}: {
  payload: Record<string, unknown>;
  role: 'host' | 'guest';
  assignments: Record<string, string>;
  patchCurrent: (patch: Record<string, unknown>) => void;
}) {
  const imageUrl = typeof payload.image_url === 'string' ? payload.image_url : '';
  const labels11 = payload.labels as { id: string; text: string }[] | undefined;

  // ── 1.1: image-anchored zones + draggable/tap-to-place labels ─────────────
  if (imageUrl && Array.isArray(labels11)) {
    const zones11 = (payload.drop_zones as { id: string; x: number; y: number; w: number; h: number; label?: string; accepts?: string }[]) ?? [];
    return (
      <ImageDragDrop
        imageUrl={imageUrl}
        labels={labels11}
        zones={zones11}
        assignments={assignments}
        onAssign={(next) => patchCurrent({ assignments: next })}
      />
    );
  }

  // ── 1.0: two-column tap-to-assign (flat string lists) ─────────────────────
  return <LegacyDragDrop payload={payload} assignments={assignments} patchCurrent={patchCurrent} />;
}

function LegacyDragDrop({
  payload,
  assignments,
  patchCurrent,
}: {
  payload: Record<string, unknown>;
  assignments: Record<string, string>;
  patchCurrent: (patch: Record<string, unknown>) => void;
}) {
  const items = (payload.items as string[]) ?? [];
  const zones = (payload.drop_zones as string[]) ?? [];
  const [picked, setPicked] = useState<string | null>(null);

  function assign(zone: string, item: string) {
    patchCurrent({ assignments: { ...assignments, [zone]: item } });
    setPicked(null);
  }

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div>
        <p className="text-xs font-bold uppercase text-[#764f84] mb-2">Items</p>
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setPicked(picked === item ? null : item)}
              className={`px-3 py-2 rounded-lg text-sm font-bold border-2 ${
                picked === item ? 'border-[#c84a71] bg-[#c84a71]/15' : 'border-[#764f84]/30 bg-white'
              }`}
            >
              {item}
            </button>
          ))}
        </div>
        <p className="text-xs text-[#764f84] mt-2">{picked ? `Tap a zone for “${picked}”.` : 'Tap an item, then a drop zone.'}</p>
      </div>
      <div>
        <p className="text-xs font-bold uppercase text-[#764f84] mb-2">Drop zones</p>
        <div className="space-y-2">
          {zones.map((zone) => (
            <button
              key={zone}
              type="button"
              disabled={!picked}
              onClick={() => picked && assign(zone, picked)}
              className="w-full px-4 py-6 rounded-xl border-2 border-dashed border-[#3b85a6]/50 bg-[#3b85a6]/5 text-left"
            >
              <span className="block text-xs font-bold text-[#3b85a6]">{zone}</span>
              <span className="block mt-1 text-[#3d3b62] font-semibold">{assignments[zone] ?? '—'}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 1.1 image-anchored drag & drop (dnd-kit + tap-to-place fallback) ─────────

function DraggableLabel({ id, text, disabled }: { id: string; text: string; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : undefined;
  return (
    <button
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      type="button"
      className={`px-3 py-2 rounded-full text-sm font-bold border-2 border-[#c84a71]/60 bg-white text-[#c84a71] shadow-sm touch-none ${
        isDragging ? 'opacity-70' : ''
      } ${disabled ? 'opacity-50' : 'cursor-grab active:cursor-grabbing'}`}
    >
      {text}
    </button>
  );
}

function DropZone({
  zone,
  assignedText,
  isTarget,
  onTap,
}: {
  zone: { id: string; x: number; y: number; w: number; h: number; label?: string };
  assignedText: string | null;
  isTarget: boolean;
  onTap: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: zone.id });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onTap}
      className={`absolute rounded-lg border-2 border-dashed flex items-center justify-center text-center transition-colors ${
        isOver || isTarget ? 'border-[#3b85a6] bg-[#3b85a6]/30' : 'border-[#3b85a6]/70 bg-[#3b85a6]/10'
      }`}
      style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.w}%`, height: `${zone.h}%` }}
      aria-label={zone.label ?? zone.id}
    >
      {assignedText ? (
        <span className="px-2 text-xs font-bold text-[#3d3b62] bg-white/90 rounded">{assignedText}</span>
      ) : null}
    </button>
  );
}

function ImageDragDrop({
  imageUrl,
  labels,
  zones,
  assignments,
  onAssign,
}: {
  imageUrl: string;
  labels: { id: string; text: string }[];
  zones: { id: string; x: number; y: number; w: number; h: number; label?: string; accepts?: string }[];
  assignments: Record<string, string>;
  onAssign: (next: Record<string, string>) => void;
}) {
  // Tap-to-place fallback for touch: tap a label, then tap a zone.
  const [picked, setPicked] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
  );

  // zoneId -> labelId
  const labelById = Object.fromEntries(labels.map((l) => [l.id, l.text]));
  const usedLabelIds = new Set(Object.values(assignments));
  const availableLabels = labels.filter((l) => !usedLabelIds.has(l.id));

  function place(zoneId: string, labelId: string) {
    // Remove this label from any other zone, then assign it here.
    const next: Record<string, string> = {};
    for (const [z, l] of Object.entries(assignments)) {
      if (l !== labelId && z !== zoneId) next[z] = l;
    }
    next[zoneId] = labelId;
    onAssign(next);
    setPicked(null);
  }

  function handleDragEnd(e: DragEndEvent) {
    const labelId = String(e.active.id);
    const zoneId = e.over ? String(e.over.id) : null;
    if (zoneId) place(zoneId, labelId);
  }

  function tapZone(zoneId: string) {
    if (picked) place(zoneId, picked);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="space-y-4">
        <div className="relative w-full rounded-xl overflow-hidden border border-[#764f84]/20 bg-[#eccdca]/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="w-full h-auto block max-h-[360px] object-contain mx-auto" />
          <div className="absolute inset-0">
            {zones.map((z) => (
              <DropZone
                key={z.id}
                zone={z}
                assignedText={assignments[z.id] ? labelById[assignments[z.id]] ?? null : null}
                isTarget={Boolean(picked)}
                onTap={() => tapZone(z.id)}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 justify-center">
          {availableLabels.map((l) => (
            <div key={l.id} onClick={() => setPicked(picked === l.id ? null : l.id)}>
              <div className={picked === l.id ? 'ring-2 ring-[#c84a71] rounded-full' : ''}>
                <DraggableLabel id={l.id} text={l.text} disabled={false} />
              </div>
            </div>
          ))}
          {availableLabels.length === 0 ? (
            <p className="text-sm font-bold text-[#3b85a6]">All placed! 🎉</p>
          ) : null}
        </div>
        <p className="text-center text-xs text-[#764f84]">
          {picked ? 'Now tap a box on the picture.' : 'Drag a word onto the picture — or tap a word, then a box.'}
        </p>
      </div>
    </DndContext>
  );
}

function HotspotPane({
  payload,
  role,
  openId,
  patchCurrent,
}: {
  payload: Record<string, unknown>;
  role: 'host' | 'guest';
  openId: string | null;
  patchCurrent: (patch: Record<string, unknown>) => void;
}) {
  const url = String(payload.image_url ?? '');
  const hotspots =
    (payload.hotspots as { id: string; x: number; y: number; w: number; h: number; content: string }[]) ?? [];
  const active = hotspots.find((h) => h.id === openId);
  // 1.1 adds a "popup" display mode; 1.0 rows (no display) keep the panel.
  const isPopup = payload.display === 'popup';

  return (
    <div className="relative">
      <div className="relative w-full rounded-xl overflow-hidden border border-[#764f84]/20 bg-[#eccdca]/30">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="w-full h-auto block max-h-[360px] object-contain mx-auto" />
        <div className="absolute inset-0">
          {hotspots.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => patchCurrent({ openId: h.id })}
              className="absolute border-2 border-[#f0c75e]/90 bg-[#f0c75e]/25 rounded-lg hover:bg-[#f0c75e]/40 transition-colors animate-pulse"
              style={{
                left: `${h.x}%`,
                top: `${h.y}%`,
                width: `${h.w}%`,
                height: `${h.h}%`,
              }}
              aria-label={`Hotspot ${h.id}`}
            />
          ))}
        </div>

        {/* Popup modal (1.1): overlay the active hotspot's text over the image. */}
        {isPopup && active ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 p-6">
            <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl text-[#3d3b62]">
              <button
                type="button"
                onClick={() => patchCurrent({ openId: null })}
                aria-label="Close"
                className="absolute right-3 top-3 h-7 w-7 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-100 flex items-center justify-center"
              >
                ×
              </button>
              <p className="text-sm font-semibold leading-relaxed pr-4">{active.content}</p>
              <button
                type="button"
                onClick={() => patchCurrent({ openId: null })}
                className="font-baloo mt-4 rounded-lg bg-[#3b85a6] px-4 py-2 text-sm font-bold text-white"
              >
                Got it! ✨
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Panel display (1.0 default). */}
      {!isPopup && (active ? (
        <div className="mt-4 p-4 rounded-xl bg-white border border-[#764f84]/20 text-[#3d3b62]">
          <p className="text-sm font-semibold">{active.content}</p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-[#764f84]">Tap a highlighted area.</p>
      ))}
      {isPopup && !active ? (
        <p className="mt-3 text-sm text-[#764f84]">Tap each glowing spot to learn something new.</p>
      ) : null}
    </div>
  );
}
