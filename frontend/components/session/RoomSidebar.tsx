'use client';

import type { ReactNode } from 'react';

import { RoleCard } from './RoleCard';
import { TimerRing, type TimerMode } from './TimerRing';
import type { SessionRole } from '@/lib/roles';

/**
 * The room's right-hand column: clock, faces, then who-does-what.
 *
 * This is a real grid column, not an overlay. The room previously floated its
 * participant tiles in the top-right corner with `position: fixed`, which meant
 * they reserved no space and sat on top of whatever the canvas put underneath —
 * the last activity card and its Play button, most often. Occupying a column
 * costs 352px and makes the collision impossible.
 *
 * It scrolls internally: a session with five participants is taller than the
 * viewport, and the role card must stay reachable rather than being clipped.
 */
export function RoomSidebar({
  remaining,
  totalSecs,
  timerActive,
  timerMode,
  role,
  onStartTimer,
  activityType,
  children,
}: {
  remaining: number;
  totalSecs: number;
  timerActive: boolean;
  timerMode: TimerMode;
  role: SessionRole;
  onStartTimer: () => void;
  /** Selects the role card's per-activity hint when inside an activity. */
  activityType?: string;
  /** The participant tiles. */
  children: ReactNode;
}) {
  return (
    <aside
      className="room-recede flex min-h-0 flex-col gap-4 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="Session details"
    >
      {/* The timer keeps its height. Without `shrink-0` flex compressed it first
          in a short column — on a tablet the ring and its own numerals were
          sliced off the top of the card while the space below stayed empty. */}
      <div className="shrink-0">
      <TimerRing
        remaining={remaining}
        totalSecs={totalSecs}
        timerActive={timerActive}
        mode={timerMode}
        isHost={role === 'host'}
        onStart={onStartTimer}
      />
      </div>

      {/* The participant list is what gives way: it can scroll, and a face
          half-visible still reads as a face. */}
      <div className="flex min-h-0 flex-col gap-2">
        <h2
          className="font-karla text-[12px] font-semibold leading-none"
          style={{ color: 'var(--room-ink-strong)' }}
        >
          Participant
        </h2>
        {children}
      </div>

      {/* Also fixed: this is the only text saying what each seat may do, so it
          must not be the thing that gets squeezed to nothing. */}
      <div className="shrink-0">
        <RoleCard
          role={role}
          variant={timerMode === 'activity' ? 'you' : 'legend'}
          activityType={activityType}
        />
      </div>
    </aside>
  );
}
