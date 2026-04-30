'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-react';
import type { ActivityConfigData } from './types';

interface Props {
  role: 'host' | 'guest';
  activities: ActivityConfigData[];
  open: boolean;
  initialIndex?: number;
  initialStateByActivity?: Record<string, Record<string, unknown>>;
  onClose: () => void;
  onActivityStateSync?: (state: Record<string, unknown>) => void;
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
}: Props) {
  const room = useRoomContext();

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
      room.localParticipant.publishData(
        buildMsg('ACTIVITY_SYNC', { activity_index: index, state_by_activity: next }),
        { reliable: true },
      );
    },
    [role, index, onActivityStateSync, room.localParticipant],
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

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-[#3d3b62]/95 backdrop-blur-md p-4">
      <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl bg-[#eccdca] shadow-2xl flex flex-col border border-[#764f84]/40">
        <header className="flex items-start justify-between gap-4 px-6 py-4 bg-[#3d3b62] text-[#eccdca]">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#eccdca]/70">
              Activity {index + 1} / {activities.length}
            </p>
            <h2 className="font-headline text-xl md:text-2xl font-bold text-[#eccdca]">{ui.title || current.title}</h2>
            {ui.instructions ? (
              <p className="text-sm text-[#eccdca]/90 mt-1 max-w-xl">{ui.instructions}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {role === 'host' && (
              <>
                <button
                  type="button"
                  onClick={resetCurrent}
                  className="flex items-center gap-1 px-3 py-2 rounded-lg bg-[#764f84] text-[#eccdca] text-xs font-bold hover:opacity-90"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </button>
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={index <= 0}
                  className="p-2 rounded-lg bg-[#3b85a6] text-white disabled:opacity-40"
                  aria-label="Previous activity"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={index >= activities.length - 1}
                  className="p-2 rounded-lg bg-[#3b85a6] text-white disabled:opacity-40"
                  aria-label="Next activity"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </>
            )}
            {role === 'host' ? (
              <button
                type="button"
                onClick={() => {
                  room.localParticipant.publishData(buildMsg('ACTIVITY_CLOSE', {}), { reliable: true });
                  onClose();
                }}
                className="p-2 rounded-lg bg-[#c84a71] text-white hover:opacity-90"
                aria-label="Close activities"
              >
                <X className="w-5 h-5" />
              </button>
            ) : null}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#faf6f5]">
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
          selected={(state.selected as number | null | undefined) ?? null}
          revealed={Boolean(state.revealed)}
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
  const [color, setColor] = useState(palette[0] ?? '#222');
  const [width, setWidth] = useState(brushSizes[0] ?? 4);
  const [eraser, setEraser] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const currentLine = useRef<number[]>([]);

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
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
  }, [lines]);

  useEffect(() => {
    redraw();
  }, [redraw]);

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
    if (role !== 'host') return;
    drawing.current = true;
    const { x, y } = pos(e);
    currentLine.current = [x, y];
  }

  function moveDraw(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing.current || role !== 'host') return;
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
    if (!drawing.current || role !== 'host') return;
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
    if (role !== 'host') return;
    setLines([]);
  }

  return (
    <div className="space-y-3">
      {role === 'host' ? (
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
      ) : (
        <p className="text-xs text-[#764f84] font-medium">Watch the host draw — your canvas updates live.</p>
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
    </div>
  );
}

function QuizPane({
  payload,
  role: hostRole,
  selected,
  revealed,
  patchCurrent,
}: {
  payload: Record<string, unknown>;
  role: 'host' | 'guest';
  selected: number | null;
  revealed: boolean;
  patchCurrent: (patch: Record<string, unknown>) => void;
}) {
  const question = String(payload.question ?? '');
  const options = (payload.options as string[]) ?? [];
  const correct = payload.correct_index as number;
  const revealMode = String(payload.reveal_mode ?? 'instant');

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
        <button
          type="button"
          onClick={reveal}
          className="px-4 py-2 rounded-lg bg-[#f0c75e] text-[#3d3b62] font-bold text-sm"
        >
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
  const items = (payload.items as string[]) ?? [];
  const zones = (payload.drop_zones as string[]) ?? [];
  const [picked, setPicked] = useState<string | null>(null);

  function assign(zone: string, item: string) {
    if (role !== 'host') return;
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
              disabled={role !== 'host'}
              onClick={() => role === 'host' && setPicked(picked === item ? null : item)}
              className={`px-3 py-2 rounded-lg text-sm font-bold border-2 ${
                picked === item ? 'border-[#c84a71] bg-[#c84a71]/15' : 'border-[#764f84]/30 bg-white'
              }`}
            >
              {item}
            </button>
          ))}
        </div>
        {role === 'host' ? (
          <p className="text-xs text-[#764f84] mt-2">{picked ? `Tap a zone for “${picked}”.` : 'Tap an item, then a drop zone.'}</p>
        ) : null}
      </div>
      <div>
        <p className="text-xs font-bold uppercase text-[#764f84] mb-2">Drop zones</p>
        <div className="space-y-2">
          {zones.map((zone) => (
            <button
              key={zone}
              type="button"
              disabled={role !== 'host' || !picked}
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
              disabled={role !== 'host'}
              onClick={() => role === 'host' && patchCurrent({ openId: h.id })}
              className="absolute border-2 border-[#f0c75e]/90 bg-[#f0c75e]/25 rounded-lg hover:bg-[#f0c75e]/40 transition-colors"
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
      </div>
      {active ? (
        <div className="mt-4 p-4 rounded-xl bg-white border border-[#764f84]/20 text-[#3d3b62]">
          <p className="text-sm font-semibold">{active.content}</p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-[#764f84]">{role === 'host' ? 'Tap a highlighted area.' : 'The host may open hotspots for you.'}</p>
      )}
    </div>
  );
}
