'use client';

import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Heart, Palette, Puzzle, Search, Star } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { ActivityConfigData, ActivityType } from './types';

const TYPE_META: Record<
  ActivityType,
  { label: string; Icon: LucideIcon; blurb: string; accent: string; accentSoft: string }
> = {
  quiz: {
    label: 'Story Quest',
    Icon: Star,
    blurb: 'Answer fun questions about the story!',
    accent: '#5b3b8c',
    accentSoft: '#7d5bb5',
  },
  drag_drop: {
    label: 'Place & Play',
    Icon: Puzzle,
    blurb: 'Drag the pieces to the right place in the scene.',
    accent: '#1f6f8b',
    accentSoft: '#3b9dbd',
  },
  hotspot: {
    label: 'Discovery Spots',
    Icon: Search,
    blurb: 'Tap the glowing spots to uncover hidden surprises!',
    accent: '#b03a63',
    accentSoft: '#d1608a',
  },
  drawing: {
    label: 'Create Together',
    Icon: Palette,
    blurb: 'Draw, colour and bring your imagination to life!',
    // Darker than the other accents on purpose: this card's text is white, and
    // a bright yellow behind white lettering is unreadable.
    accent: '#8a5a00',
    accentSoft: '#c98f10',
  },
};

const TYPE_ORDER: ActivityType[] = ['quiz', 'drag_drop', 'hotspot', 'drawing'];

function thumbUrl(activity: ActivityConfigData): string | null {
  const payload = activity.config?.payload as Record<string, unknown> | undefined;
  if (!payload) return null;
  if (typeof payload.image_url === 'string') return payload.image_url;
  if (typeof payload.background_url === 'string') return payload.background_url;
  const questions = payload.questions as Array<{ image_url?: string }> | undefined;
  if (Array.isArray(questions)) {
    const withImg = questions.find((q) => typeof q?.image_url === 'string');
    if (withImg?.image_url) return withImg.image_url;
  }
  return null;
}

/**
 * Choose-an-activity screen.
 *
 * This was a three-column grid of white cards that scrolled the page: with nine
 * activities a child had to scroll past the fold to see most of them, and every
 * card looked the same until you read its label. It is now a horizontal
 * carousel of full-bleed colour cards, one row, with type filters — the colour
 * and the illustration do the identifying, so a child who cannot read fluently
 * can still tell a drawing activity from a quiz.
 */
export function ActivityPicker({
  activities,
  role,
  onPick,
}: {
  activities: ActivityConfigData[];
  role: 'host' | 'guest';
  onPick: (index: number) => void;
}) {
  const isHost = role === 'host';
  const [filter, setFilter] = useState<ActivityType | 'all'>('all');
  const trackRef = useRef<HTMLDivElement>(null);

  // Only offer filters for types this book actually has — a chip that always
  // yields an empty row is worse than no chip.
  const availableTypes = useMemo(() => {
    const present = new Set(activities.map((a) => a.activity_type));
    return TYPE_ORDER.filter((t) => present.has(t));
  }, [activities]);

  // Keep the original index: `onPick` addresses the unfiltered list, so
  // filtering must not renumber what gets opened.
  const visible = useMemo(
    () =>
      activities
        .map((activity, index) => ({ activity, index }))
        .filter(({ activity }) => filter === 'all' || activity.activity_type === filter),
    [activities, filter],
  );

  const scrollBy = (direction: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    // One card plus its gap, so a click always lands on a card boundary.
    el.scrollBy({ left: direction * (el.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col px-4 pb-10 pt-4">
      <div className="mb-4 text-center">
        <h2
          className="font-baloo text-2xl font-bold sm:text-4xl"
          style={{ color: 'var(--room-ink)' }}
        >
          Choose an Activity
        </h2>
        <p className="font-karla mt-1 text-sm" style={{ color: 'var(--room-ink-soft)' }}>
          {isHost
            ? 'Pick an activity to enjoy together!'
            : 'Your grown-up will choose an activity to start.'}
        </p>
      </div>

      {availableTypes.length > 1 && (
        <div
          role="group"
          aria-label="Filter activities by type"
          className="mb-5 flex flex-wrap justify-center gap-2"
        >
          {(['all', ...availableTypes] as const).map((type) => {
            const active = filter === type;
            const label = type === 'all' ? 'All Activities' : TYPE_META[type].label;
            return (
              <button
                key={type}
                type="button"
                onClick={() => setFilter(type)}
                aria-pressed={active}
                className="font-karla cursor-pointer rounded-full px-4 py-1.5 text-xs font-bold transition-colors"
                style={{
                  background: active ? 'var(--room-accent)' : 'var(--room-chrome)',
                  color: active ? 'var(--room-accent-contrast)' : 'var(--room-ink)',
                  border: '1px solid var(--room-chrome-line)',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      <div className="relative">
        {visible.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => scrollBy(-1)}
              aria-label="Previous activities"
              className="room-tap absolute -left-2 top-1/2 z-10 hidden -translate-y-1/2 cursor-pointer rounded-full sm:grid"
              style={{
                background: 'var(--room-chrome-strong)',
                color: 'var(--room-ink)',
                boxShadow: 'var(--elev-1)',
              }}
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => scrollBy(1)}
              aria-label="More activities"
              className="room-tap absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 cursor-pointer rounded-full sm:grid"
              style={{
                background: 'var(--room-chrome-strong)',
                color: 'var(--room-ink)',
                boxShadow: 'var(--elev-1)',
              }}
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
          </>
        )}

        {/* Horizontal rail with snap points. `scrollbar-width: none` hides the
            bar itself — the arrows and the partially-visible next card already
            say it scrolls. */}
        <div
          ref={trackRef}
          className="flex snap-x snap-mandatory gap-4 overflow-x-auto overflow-y-hidden pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {visible.map(({ activity, index }) => {
            const meta = TYPE_META[activity.activity_type];
            const thumb = thumbUrl(activity);
            const { Icon } = meta;

            return (
              <button
                key={activity.id}
                type="button"
                disabled={!isHost}
                onClick={() => isHost && onPick(index)}
                aria-label={`${meta.label}: ${activity.title}`}
                className="group flex w-[240px] shrink-0 snap-start cursor-pointer flex-col overflow-hidden rounded-3xl text-left transition-transform duration-200 enabled:hover:-translate-y-1 disabled:cursor-default disabled:opacity-90 sm:w-[260px]"
                style={{
                  background: `linear-gradient(160deg, ${meta.accentSoft} 0%, ${meta.accent} 100%)`,
                  boxShadow: 'var(--elev-2)',
                }}
              >
                <div className="flex items-center gap-2 px-4 pt-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/20">
                    <Icon className="h-5 w-5 text-white" aria-hidden />
                  </span>
                  <span className="font-baloo min-w-0 flex-1 truncate text-base font-bold text-white">
                    {meta.label}
                  </span>
                </div>

                <div className="mx-4 mt-3 aspect-[4/3] overflow-hidden rounded-2xl bg-white/15">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="grid h-full w-full place-items-center">
                      <Icon className="h-12 w-12 text-white/70" aria-hidden />
                    </span>
                  )}
                </div>

                <div className="flex flex-1 flex-col px-4 pb-4 pt-3">
                  <span className="font-baloo text-sm font-bold leading-tight text-white">
                    {activity.title}
                  </span>
                  <span className="font-karla mt-1 flex-1 text-xs leading-relaxed text-white/85">
                    {meta.blurb}
                  </span>
                  {isHost && (
                    <span className="font-baloo mt-3 rounded-xl bg-white/95 px-4 py-2 text-center text-sm font-bold transition-colors group-hover:bg-white"
                      style={{ color: meta.accent }}
                    >
                      Play
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {activities.length === 0 && (
        <p className="font-karla mt-8 text-center" style={{ color: 'var(--room-ink-soft)' }}>
          No activities are set up for this book yet.
        </p>
      )}

      {visible.length > 0 && (
        <p
          className="font-karla mt-5 flex items-center justify-center gap-2 text-center text-xs"
          style={{ color: 'var(--room-ink-soft)' }}
        >
          <Heart className="h-4 w-4 shrink-0" style={{ color: 'var(--room-accent)' }} aria-hidden />
          One adventure. So many ways to play.
        </p>
      )}
    </div>
  );
}
