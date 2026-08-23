'use client';

import { BookOpen, Clock, Pencil } from 'lucide-react';

/** mm:ss, floored at zero so an overrun never renders "-0:03". */
function fmtTime(total: number): string {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export type TimerMode = 'reading' | 'activities' | 'activity';

const MODE: Record<TimerMode, { Icon: typeof BookOpen; label: string }> = {
  reading: { Icon: BookOpen, label: 'Reading Together' },
  activities: { Icon: Pencil, label: 'Creating Together' },
  activity: { Icon: Clock, label: 'Total Time' },
};

/**
 * The sidebar's session clock.
 *
 * Reworked from a `SessionTimerRing` that had been written and then never
 * rendered — the room shipped a text chip in the header instead, so the ring's
 * geometry was already correct but invisible. The ring maths are unchanged
 * (circumference-minus-progress on a rotated circle); what is new is the panel
 * around it and the mode line beneath, both measured from the client's screens.
 *
 * Three modes, because the screens label the same clock differently depending
 * on where you are: reading a book, choosing an activity, or inside one.
 */
export function TimerRing({
  remaining,
  totalSecs,
  timerActive,
  mode,
  isHost,
  onStart,
}: {
  remaining: number;
  totalSecs: number;
  timerActive: boolean;
  mode: TimerMode;
  isHost: boolean;
  onStart: () => void;
}) {
  // 140px box, 6px stroke, r=64 in a 140-unit viewBox.
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  const fraction =
    timerActive && totalSecs > 0 ? Math.min(1, Math.max(0, remaining / totalSecs)) : 0;
  const dashOffset = circumference * (1 - fraction);

  const { Icon, label } = MODE[mode];
  const elapsedPct = totalSecs > 0 ? Math.round(fraction * 100) : 0;
  const startable = isHost && !timerActive;

  return (
    <section
      className="flex flex-col items-center justify-center gap-4 px-5 py-6"
      style={{
        background: '#211c33',
        border: '1px solid var(--room-chrome-line)',
        borderRadius: 'var(--r-bar)',
      }}
      aria-label="Session timer"
    >
      <div
        className={`relative flex h-[140px] w-[140px] items-center justify-center ${startable ? 'cursor-pointer' : ''}`}
        onClick={startable ? onStart : undefined}
        onKeyDown={(e) => {
          if (startable && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onStart();
          }
        }}
        role={startable ? 'button' : undefined}
        tabIndex={startable ? 0 : undefined}
        title={startable ? 'Start session timer' : undefined}
      >
        {/* -rotate-90 puts the sweep's origin at 12 o'clock. */}
        <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 140 140" aria-hidden>
          <circle
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="6"
          />
          <circle
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke="var(--room-accent)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="transition-[stroke-dashoffset] duration-500"
          />
        </svg>

        <div className="relative z-10 flex flex-col items-center text-center">
          <span
            className="font-baloo text-[34px] font-bold leading-none tabular-nums"
            style={{ color: 'var(--room-ink)' }}
          >
            {fmtTime(remaining)}
          </span>
          <span
            className="mt-1 font-karla text-[13px] leading-none"
            style={{ color: 'rgba(245,239,247,0.6)' }}
          >
            {timerActive ? 'Remaining' : isHost ? 'Tap to start' : 'Waiting'}
          </span>
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 text-center">
        <p className="flex items-center gap-2 font-baloo text-[17px] font-bold leading-none">
          <Icon className="h-[18px] w-[18px] shrink-0" style={{ color: 'var(--room-accent)' }} aria-hidden />
          <span style={{ color: 'var(--room-accent)' }}>
            {mode === 'activity' ? `${fmtTime(totalSecs)} ${label}` : label}
          </span>
        </p>
        {mode !== 'activity' && (
          <p className="font-karla text-[12px] leading-none" style={{ color: 'var(--room-ink-soft)' }}>
            {timerActive
              ? `${elapsedPct}% of the ${mode === 'reading' ? 'story' : 'activity'} session left`
              : 'The timer starts when the session goes live'}
          </p>
        )}
      </div>
    </section>
  );
}
