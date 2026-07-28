'use client';

import type { LucideIcon } from 'lucide-react';

export type RailItem = {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  hidden?: boolean;
};

/**
 * The room's only persistent control surface.
 *
 * Every icon is unlabelled and flat on the backdrop, with no panel behind it —
 * the previous room spread 26 controls across a header, a 288px aside, a
 * floating pill and a draggable dock, all of which competed with the book and
 * took space from it. Anything not on this rail lives behind "More".
 */
export function RoomRail({ items }: { items: RailItem[] }) {
  const visible = items.filter((item) => !item.hidden);

  return (
    <nav
      aria-label="Reading controls"
      className="room-recede pointer-events-auto absolute left-0 top-1/2 z-40 flex -translate-y-1/2 flex-col items-center gap-1 py-2 pl-1 sm:pl-2"
    >
      {visible.map(({ icon: Icon, label, onClick, active, disabled }) => (
        <button
          key={label}
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          title={label}
          aria-pressed={active}
          className="room-tap cursor-pointer rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-30"
          style={{
            color: active ? 'var(--room-accent-contrast)' : 'var(--room-ink)',
            background: active ? 'var(--room-accent)' : 'transparent',
          }}
        >
          <Icon className="h-[22px] w-[22px]" aria-hidden />
        </button>
      ))}
    </nav>
  );
}
