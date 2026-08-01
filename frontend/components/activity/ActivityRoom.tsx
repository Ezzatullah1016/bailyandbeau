'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-react';
import type { ActivityConfigData } from './types';
import { DragDropPane } from './panes/DragDropPane';
import { DrawingPane } from './panes/DrawingPane';
import { HotspotPane } from './panes/HotspotPane';
import { QuizPane } from './panes/QuizPane';
import type { Line } from './panes/shared';

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
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-brand-navy/95 backdrop-blur-md p-4">
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
      return { openId: null as string | null, visitedIds: [] as string[] };
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
          assignments={(state.assignments as Record<string, string> | undefined) ?? {}}
          patchCurrent={patchCurrent}
        />
      );
    case 'hotspot':
      return (
        <HotspotPane
          payload={payload}
          openId={(state.openId as string | null | undefined) ?? null}
          visitedIds={(state.visitedIds as string[] | undefined) ?? []}
          patchCurrent={patchCurrent}
        />
      );
    default:
      return <p className="text-brand-navy">Unsupported activity type.</p>;
  }
}
