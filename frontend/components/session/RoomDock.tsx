'use client';

import { MoreHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type DockItem = {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  /** Renders a hairline before this item, grouping the dock into sections. */
  separatorBefore?: boolean;
  /** Small count badge, e.g. the number of people in the room. */
  badge?: number;
  /** Tints the icon — used for destructive actions. */
  danger?: boolean;
};

export type DockCta = {
  label: string;
  icon?: LucideIcon;
  /** `gold` advances the activity; `pink` ends or scores it. */
  tone: 'gold' | 'pink';
  onClick: () => void;
  disabled?: boolean;
  /** Puts the icon after the label, for "Next Question →". */
  iconTrailing?: boolean;
};

/** Past this many tools the overflow menu takes the remainder. */
const MAX_INLINE = 8;

/**
 * The room's control surface: labelled tools on the left, one primary action on
 * the right.
 *
 * This replaces a vertical rail of unlabelled icons. The rail was compact, but
 * every tool needed a hover to identify — unusable on the touch screens most of
 * these sessions run on, and it left no room for the per-activity primary action
 * the client's screens put at the end of the row ("Next Question", "How Did We
 * Do?", "Complete Activity"). Labels are 10px, which is small but legible, and
 * they mean a five-year-old can find the eraser without exploring.
 *
 * The CTA never collapses. When the tools outrun the width, the tail moves into
 * an overflow menu instead — losing "Complete Activity" off the right edge would
 * strand a child at the end of an activity with no way to finish it.
 */
export function RoomDock({
  items,
  cta,
  /** Rendered above the dock, anchored to it: the reactions and tool popovers. */
  children,
}: {
  items: DockItem[];
  cta?: DockCta;
  children?: React.ReactNode;
}) {
  const visible = items.filter((i) => !i.hidden);
  const inline = visible.slice(0, MAX_INLINE);
  const overflow = visible.slice(MAX_INLINE);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the overflow menu on an outside click or Escape. Without this it stays
  // open behind the next thing the child taps.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Overflowing while the menu is open would leave it open over a different set.
  useEffect(() => {
    if (overflow.length === 0) setMenuOpen(false);
  }, [overflow.length]);

  return (
    <div className="relative">
      {children}

      <div
        className="room-recede room-bar flex items-center gap-2 px-3 sm:gap-3 sm:px-5"
        style={{ minHeight: 'var(--room-dock-h)' }}
      >
        <div
          role="toolbar"
          aria-label="Session tools"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] sm:gap-2 [&::-webkit-scrollbar]:hidden"
        >
          {inline.map((item) => (
            <DockButton key={item.label} item={item} />
          ))}

          {overflow.length > 0 && (
            <div ref={menuRef} className="relative shrink-0">
              <DockButton
                item={{
                  icon: MoreHorizontal,
                  label: 'More',
                  active: menuOpen,
                  onClick: () => setMenuOpen((v) => !v),
                }}
                expanded={menuOpen}
              />
              {menuOpen && (
                <div
                  className="room-bar absolute bottom-full left-0 mb-2 flex w-max max-w-[70vw] flex-wrap gap-1 p-2"
                  style={{ zIndex: 'var(--z-dock-menu)' }}
                  role="group"
                  aria-label="More tools"
                >
                  {overflow.map((item) => (
                    <DockButton
                      key={item.label}
                      item={{
                        ...item,
                        /*
                         * A disabled item keeps the menu open. It used to close
                         * it either way, so a tool that early-returns — Undo on
                         * an empty page, Activities with none authored — looked
                         * like it had acted: the menu dismissed and nothing
                         * else happened.
                         */
                        onClick: () => {
                          if (item.disabled) return;
                          item.onClick();
                          setMenuOpen(false);
                        },
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {cta && <DockCtaButton cta={cta} />}
      </div>
    </div>
  );
}

function DockButton({ item, expanded }: { item: DockItem; expanded?: boolean }) {
  const { icon: Icon, label, onClick, active, disabled, separatorBefore, badge, danger } = item;

  return (
    <>
      {separatorBefore && (
        <span
          aria-hidden
          className="mx-1 h-9 w-px shrink-0"
          style={{ background: 'var(--room-chrome-line)' }}
        />
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={expanded === undefined ? active : undefined}
        aria-expanded={expanded}
        className="group flex shrink-0 cursor-pointer flex-col items-center gap-1 rounded-xl px-1.5 py-1 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--room-accent)] disabled:cursor-not-allowed disabled:opacity-35"
      >
        <span
          className="relative grid place-items-center rounded-full transition-[box-shadow,background-color]"
          style={{
            width: 'var(--tap-min)',
            height: 'var(--tap-min)',
            background: 'rgba(255,255,255,0.06)',
            // The active tool is ringed rather than filled: a filled circle at
            // this size swallowed the glyph inside it.
            boxShadow: active ? '0 0 0 2px var(--room-accent)' : 'none',
            color: danger
              ? 'var(--c-pink)'
              : active
                ? 'var(--room-accent)'
                : 'var(--room-ink)',
          }}
        >
          <Icon className="h-[22px] w-[22px]" aria-hidden />
          {badge != null && badge > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 font-karla text-[10px] font-bold leading-none"
              style={{ background: 'var(--c-role)', color: '#ffffff' }}
            >
              {badge}
            </span>
          )}
        </span>
        <span
          className="max-w-[72px] truncate font-montserrat text-[11px] font-semibold uppercase leading-none tracking-wide"
          style={{ color: active ? 'var(--room-accent)' : 'var(--room-ink-strong)' }}
        >
          {label}
        </span>
      </button>
    </>
  );
}

function DockCtaButton({ cta }: { cta: DockCta }) {
  const { label, icon: Icon, tone, onClick, disabled, iconTrailing } = cta;
  const gold = tone === 'gold';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex shrink-0 cursor-pointer items-center justify-center gap-2 px-6 font-baloo text-[17px] font-bold transition-[filter] hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-45 sm:text-[18px]"
      style={{
        minHeight: 56,
        borderRadius: 28,
        background: gold ? 'var(--room-accent)' : 'var(--c-pink)',
        color: gold ? 'var(--room-accent-contrast)' : '#ffffff',
        boxShadow: 'var(--elev-1)',
      }}
    >
      {Icon && !iconTrailing && <Icon className="h-5 w-5 shrink-0" aria-hidden />}
      <span className="whitespace-nowrap">{label}</span>
      {Icon && iconTrailing && <Icon className="h-5 w-5 shrink-0" aria-hidden />}
    </button>
  );
}
