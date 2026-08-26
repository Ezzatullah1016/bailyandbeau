'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The header bar's control vocabulary: one 40px rounded pill, optionally with a
 * leading icon.
 *
 * Measured from the client's screens — every pill in the header is the same
 * height (40px) and radius (20px), differing only in fill and label, so they
 * share one component rather than six hand-rolled buttons that drift apart.
 *
 * `tone` picks the fill:
 *  - `chrome`  translucent white over the room (count, Invite, overflow)
 *  - `outline` chrome plus a coloured hairline (the Secure badge)
 *  - `role`    the glowing mauve role pill
 *  - `danger`  the solid pink End Session pill
 */
export type PillTone = 'chrome' | 'outline' | 'role' | 'danger';

interface PillProps {
  icon?: LucideIcon;
  children?: ReactNode;
  tone?: PillTone;
  /** Renders a <button>; omit for a non-interactive badge. */
  onClick?: () => void;
  /** Required when the pill has no visible text (the overflow "…" button). */
  label?: string;
  title?: string;
  disabled?: boolean;
  /** Tints the label and icon independently of the fill (Secure's green). */
  accent?: string;
  className?: string;
}

const TONE_STYLE: Record<PillTone, React.CSSProperties> = {
  chrome: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid var(--room-chrome-line)',
    color: 'var(--room-ink)',
  },
  outline: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(95,211,150,0.35)',
    color: 'var(--c-green)',
  },
  role: {
    background: 'var(--c-role)',
    border: '1px solid rgba(255,255,255,0.18)',
    // The screens give this pill a soft outer halo, which is what marks it as
    // status rather than another button.
    boxShadow: '0 0 0 3px rgba(147,108,150,0.28)',
    color: '#ffffff',
  },
  danger: {
    background: 'var(--c-pink)',
    border: '1px solid rgba(255,255,255,0.16)',
    color: '#ffffff',
  },
};

export function Pill({
  icon: Icon,
  children,
  tone = 'chrome',
  onClick,
  label,
  title,
  disabled,
  accent,
  className = '',
}: PillProps) {
  const style: React.CSSProperties = { ...TONE_STYLE[tone], minHeight: 40, borderRadius: 20 };
  if (accent) style.color = accent;

  const content = (
    <>
      {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden />}
      {children != null && (
        <span className="font-baloo whitespace-nowrap text-[15px] font-semibold leading-none">
          {children}
        </span>
      )}
    </>
  );

  const shared = `inline-flex items-center justify-center gap-2 px-4 ${className}`;

  if (!onClick) {
    return (
      <span className={shared} style={style} title={title}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      className={`${shared} cursor-pointer transition-[filter,transform] duration-150 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--room-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--room-bg-2)] disabled:cursor-not-allowed disabled:opacity-50`}
      style={style}
    >
      {content}
    </button>
  );
}
