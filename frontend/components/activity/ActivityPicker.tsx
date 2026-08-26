'use client';

import { useMemo, useState } from 'react';
import { Heart } from 'lucide-react';

import { TYPE_META, TYPE_ORDER } from './typeMeta';
import type { ActivityConfigData, ActivityType } from './types';

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
 * A four-up grid of full-colour cards, per the client's screens. It was briefly
 * a horizontal snap carousel, which put everything past the second card behind
 * a scroll gesture and a pair of chevrons; with four types there is no need to
 * hide any of them. The colour and the illustration do the identifying, so a
 * child who cannot read fluently can still tell a drawing activity from a quiz.
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

  // Only offer filters for types this book actually has — a chip that always
  // yields an empty grid is worse than no chip.
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

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col">
      <header>
        <h2
          className="font-baloo text-[26px] font-bold leading-tight sm:text-[30px]"
          style={{ color: 'var(--room-ink)' }}
        >
          Choose Your Adventure
        </h2>
        <p className="mt-1 font-karla text-[15px]" style={{ color: 'var(--room-ink-soft)' }}>
          {isHost
            ? 'Every activity is a new way to create, imagine, and connect together.'
            : 'Your grown-up will choose an activity to start.'}
        </p>
      </header>

      {availableTypes.length > 1 && (
        <div
          role="group"
          aria-label="Filter activities by type"
          className="mt-5 flex flex-wrap gap-2"
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
                className="cursor-pointer whitespace-nowrap rounded-full px-4 font-karla text-[14px] font-semibold transition-colors"
                style={{
                  minHeight: 40,
                  background: active ? 'var(--room-accent)' : 'rgba(255,255,255,0.06)',
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

      <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
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
              className="group flex flex-col overflow-hidden rounded-[20px] text-left transition-transform duration-200 enabled:cursor-pointer enabled:hover:-translate-y-1 disabled:cursor-default disabled:opacity-90"
              style={{
                background: `linear-gradient(160deg, ${meta.accentSoft} 0%, ${meta.accent} 100%)`,
                boxShadow: 'var(--elev-2)',
              }}
            >
              <div className="flex items-center gap-2 px-4 pt-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/20">
                  <Icon className="h-5 w-5 text-white" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 truncate font-baloo text-[17px] font-bold text-white">
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
                <span className="font-karla flex-1 text-[14px] leading-relaxed text-white/90">
                  {meta.blurb}
                </span>
                <span
                  className="mt-4 rounded-xl px-4 py-2.5 text-center font-baloo text-[16px] font-bold transition-colors"
                  style={
                    isHost
                      ? { background: 'var(--room-accent)', color: meta.onAccent }
                      : { background: 'rgba(255,255,255,0.16)', color: '#ffffff' }
                  }
                >
                  {isHost ? 'Play' : 'Your grown-up picks'}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {activities.length === 0 && (
        <p className="mt-8 text-center font-karla" style={{ color: 'var(--room-ink-soft)' }}>
          No activities are set up for this book yet.
        </p>
      )}

      {visible.length > 0 && (
        <p
          className="mt-5 flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-center font-karla text-[14px]"
          style={{
            border: '1px dashed rgba(228,87,126,0.45)',
            color: 'var(--room-ink-soft)',
          }}
        >
          <Heart className="h-4 w-4 shrink-0" style={{ color: 'var(--c-pink)' }} aria-hidden />
          The best adventures don&apos;t end with the last page. Choose an activity and keep
          exploring together.
        </p>
      )}
    </div>
  );
}
