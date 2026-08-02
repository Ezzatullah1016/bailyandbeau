'use client';

import type { LucideIcon } from 'lucide-react';

export type RailItem = {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  /** Renders a hairline above this item, grouping the rail into sections. */
  separatorBefore?: boolean;
  /** Small count badge, e.g. the number of people in the room. */
  badge?: number;
  /** Tints the icon — used for the destructive "leave" action. */
  danger?: boolean;
};

/**
 * The room's only control surface.
 *
 * Every icon is unlabelled and flat on the backdrop, with no panel behind it.
 * The room previously spread 26 controls across a header, a 288px aside, a
 * floating pill and a draggable dock, all of which competed with the book and
 * took space from it. Two surfaces is one too many: everything a reader needs
 * lives here, and nothing else persists on screen.
 */
export function RoomRail({ items }: { items: RailItem[] }) {
  const visible = items.filter((item) => !item.hidden);

  return (
    <nav
      aria-label="Session controls"
      /* A host sees ~12 items, which at the 44px minimum tap size is ~550px of
         rail. That fits a 900px viewport but not a 640px laptop, so the rail
         scrolls rather than clipping its last item — which would be the way out
         of the session. The scrollbar itself is hidden; it would read as chrome
         on chrome. */
      className="room-recede pointer-events-auto absolute left-0 top-1/2 z-40 flex max-h-[calc(100dvh-5rem)] -translate-y-1/2 flex-col items-center gap-0.5 overflow-y-auto overflow-x-hidden py-2 pl-1 [scrollbar-width:none] sm:pl-2 [&::-webkit-scrollbar]:hidden"
    >
      {visible.map(
        ({ icon: Icon, label, onClick, active, disabled, separatorBefore, badge, danger }) => (
          <div key={label} className="contents">
            {separatorBefore && (
              <span
                aria-hidden
                className="my-1 h-px w-6 shrink-0"
                style={{ background: 'var(--room-chrome-line)' }}
              />
            )}
            <button
              type="button"
              onClick={onClick}
              disabled={disabled}
              aria-label={label}
              title={label}
              aria-pressed={active}
              className="room-tap relative cursor-pointer rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-30"
              style={{
                color: active
                  ? 'var(--room-accent-contrast)'
                  : danger
                    ? '#e2726a'
                    : 'var(--room-ink)',
                background: active ? 'var(--room-accent)' : 'transparent',
              }}
            >
              <Icon className="h-[22px] w-[22px]" aria-hidden />
              {typeof badge === 'number' && badge > 0 && (
                <span
                  className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold tabular-nums"
                  style={{
                    background: 'var(--room-accent)',
                    color: 'var(--room-accent-contrast)',
                  }}
                >
                  {badge}
                </span>
              )}
            </button>
          </div>
        ),
      )}
    </nav>
  );
}
