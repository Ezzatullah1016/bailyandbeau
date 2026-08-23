'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-react';
import type { PaneCta } from './panes/shared';
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
  /**
   * Lets the active pane put its primary action in the room's dock, where the
   * client's screens place it — "Next Question", "How Did We Do?", "Complete
   * Activity". Panes used to render their own footer button inside the card,
   * which meant the most important control on the screen sat in a different
   * place for every activity type.
   *
   * Called with `null` when the pane has no action to offer.
   */
  onCtaChange?: (cta: (PaneCta & { run: () => void }) | null) => void;
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
  onCtaChange,
}: Props) {
  const room = useRoomContext();
  const isStage = variant === 'stage' || fullscreen;

  useEffect(() => () => onCtaChange?.(null), [onCtaChange]);

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
  // On the stage, moving between activities is the breadcrumb's and the
  // picker's job, so only Reset survives here; in the modal the arrows are the
  // only way through a multi-activity set.
  const hostControls = role === 'host' ? (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={resetCurrent}
        className="flex min-h-11 cursor-pointer items-center gap-1 rounded-xl px-3 text-xs font-bold transition-colors hover:bg-brand-purple/10"
        style={{ color: 'var(--room-ink-soft)' }}
      >
        <RotateCcw className="h-4 w-4" />
        Reset
      </button>
      {!isStage && activities.length > 1 ? (
        <>
          <button
            type="button"
            onClick={goPrev}
            disabled={index <= 0}
            className="grid h-11 w-11 cursor-pointer place-items-center rounded-xl transition-colors hover:bg-brand-purple/10 disabled:cursor-not-allowed disabled:opacity-30"
            style={{ color: 'var(--room-ink-soft)' }}
            aria-label="Previous activity"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={index >= activities.length - 1}
            className="grid h-11 w-11 cursor-pointer place-items-center rounded-xl transition-colors hover:bg-brand-purple/10 disabled:cursor-not-allowed disabled:opacity-30"
            style={{ color: 'var(--room-ink-soft)' }}
            aria-label="Next activity"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      ) : null}
      {!isStage ? (
        <button
          type="button"
          onClick={() => {
            room.localParticipant.publishData(buildMsg('ACTIVITY_CLOSE', {}), { reliable: true });
            onClose();
          }}
          className="grid h-11 w-11 cursor-pointer place-items-center rounded-xl transition-colors hover:bg-brand-purple/10"
          style={{ color: 'var(--room-ink-soft)' }}
          aria-label="Close activities"
        >
          <X className="h-5 w-5" />
        </button>
      ) : null}
    </div>
  ) : null;

  const header = (
    <header className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        {/* The multi-activity counter is a *modal* affordance: in the reading
            room the popup is the only place to move between activities. On the
            stage the room's header breadcrumb and the picker do that job, and
            the screens show the pane's own progress here instead — two progress
            rows on one screen invite counting the wrong one. */}
        {!isStage && activities.length > 1 ? (
          <div className="mb-1.5 flex items-center gap-2">
            <p
              className="text-[10px] font-bold uppercase tracking-widest"
              style={{ color: 'var(--room-ink-soft)' }}
            >
              {index + 1} / {activities.length}
            </p>
            <div className="flex items-center gap-1" aria-hidden>
              {activities.map((a, i) => (
                <span
                  key={a.id}
                  className="h-1.5 rounded-full transition-all duration-200"
                  style={{
                    width: i === index ? 16 : 6,
                    background: i === index ? 'var(--room-accent)' : 'var(--room-chrome-line)',
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}
        {/* On the stage the room's header bar already carries the title and the
            instruction, so repeating them here would print each twice on the
            same screen. The modal has no such bar and keeps them. */}
        {!isStage && (
          <>
            <h2
              className="font-baloo truncate text-2xl font-bold md:text-3xl"
              style={{ color: 'var(--room-ink)' }}
            >
              {ui.title || current.title}
            </h2>
            {ui.instructions ? (
              <p className="mt-0.5 max-w-2xl text-sm" style={{ color: 'var(--room-ink-soft)' }}>
                {ui.instructions}
              </p>
            ) : null}
          </>
        )}
      </div>
      {hostControls}
    </header>
  );

  const body = (
    // keyed on index so switching activities fades in cleanly
    <div key={current.id} className="activity-in">
      <ActivityBody
        onCtaChange={onCtaChange}
        activity={current}
        payload={payload}
        role={role}
        state={currentState}
        patchCurrent={patchCurrent}
      />
    </div>
  );

  /*
   * Stage: no card at all.
   *
   * Removing the coloured header band was not enough — an opaque panel with a
   * border and a drop shadow, centred on the stage, still reads as a dialog
   * that opened on top of the room. The activity *is* the room in activity
   * mode, so it gets no container of its own: title and content sit straight on
   * the backdrop, and only the genuinely interactive pieces (option buttons,
   * drop zones, the drawing canvas) carry a surface.
   *
   * Modal keeps its panel: inside the reading room it really is a popup over
   * the book, and there it should look like one.
   */
  if (isStage) {
    // No `pr` dodge any more: participants occupy their own grid column, so
    // nothing overlaps the host controls, and no card of its own — the room's
    // canvas card is already the surface underneath.
    return (
      <div className="mx-auto w-full max-w-6xl">
        {header}
        {body}
      </div>
    );
  }

  const CardInner = (
    <div
      className="room-activity-card flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden"
      style={{ background: 'var(--activity-paper)' }}
    >
      <div className="px-5 pt-4 md:px-6">{header}</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 md:px-6">{body}</div>
    </div>
  );

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
  onCtaChange,
}: {
  activity: ActivityConfigData;
  payload: Record<string, unknown>;
  role: 'host' | 'guest';
  state: Record<string, unknown>;
  patchCurrent: (patch: Record<string, unknown>) => void;
  onCtaChange?: (cta: (PaneCta & { run: () => void }) | null) => void;
}) {
  switch (activity.activity_type) {
    case 'drawing':
      return (
        <DrawingPane
          payload={payload}
          lines={(state.lines as Line[] | undefined) ?? []}
          setLines={(lines) => patchCurrent({ lines })}
          onCtaChange={onCtaChange}
        />
      );
    case 'quiz':
      return (
        <QuizPane
          payload={payload}
          role={role}
          state={state}
          patchCurrent={patchCurrent}
          onCtaChange={onCtaChange}
        />
      );
    case 'drag_drop':
      return (
        <DragDropPane
          payload={payload}
          assignments={(state.assignments as Record<string, string> | undefined) ?? {}}
          patchCurrent={patchCurrent}
          onCtaChange={onCtaChange}
        />
      );
    case 'hotspot':
      return (
        <HotspotPane
          payload={payload}
          openId={(state.openId as string | null | undefined) ?? null}
          visitedIds={(state.visitedIds as string[] | undefined) ?? []}
          patchCurrent={patchCurrent}
          onCtaChange={onCtaChange}
        />
      );
    default:
      return <p className="text-brand-navy">Unsupported activity type.</p>;
  }
}
