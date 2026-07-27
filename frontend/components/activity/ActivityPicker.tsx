'use client';

import type { ActivityConfigData, ActivityType } from './types';

const TYPE_META: Record<ActivityType, { label: string; icon: string; blurb: string; accent: string }> = {
  quiz: {
    label: 'Story Quest',
    icon: '⭐',
    blurb: 'Answer fun questions about the story!',
    accent: '#764f84',
  },
  drag_drop: {
    label: 'Place & Play',
    icon: '🧩',
    blurb: 'Drag the pieces to the right place in the scene.',
    accent: '#3b85a6',
  },
  hotspot: {
    label: 'Discovery Spots',
    icon: '🔍',
    blurb: 'Tap the glowing spots to uncover hidden surprises!',
    accent: '#c84a71',
  },
  drawing: {
    label: 'Create Together',
    icon: '🎨',
    blurb: 'Draw, colour and bring your imagination to life!',
    accent: '#f0c75e',
  },
};

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

  // The picker scrolls on small screens, so the heading stays pinned (a child
  // scrolling the list should never lose the question) and the list clears the
  // floating media dock at the bottom.
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center px-4 pb-40 pt-4 text-center sm:pb-32">
      <div
        className="sticky top-0 z-10 -mx-4 mb-6 w-[calc(100%+2rem)] px-4 pb-3 pt-2 backdrop-blur-sm"
        style={{ background: 'linear-gradient(to bottom, var(--room-bg-1), transparent)' }}
      >
        <h2
          className="font-baloo text-2xl font-bold sm:text-4xl"
          style={{ color: 'var(--room-ink)' }}
        >
          Choose an Activity
        </h2>
        <p className="font-karla mt-1 text-sm" style={{ color: 'var(--room-ink-soft)' }}>
          {isHost ? 'Pick an activity to enjoy together!' : 'Your grown-up will choose an activity to start.'}
        </p>
      </div>

      <div className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {activities.map((activity, index) => {
          const meta = TYPE_META[activity.activity_type];
          const thumb = thumbUrl(activity);
          return (
            <button
              key={activity.id}
              type="button"
              disabled={!isHost}
              onClick={() => isHost && onPick(index)}
              className="room-activity-card group flex min-h-[11rem] cursor-pointer flex-col overflow-hidden text-left transition-transform duration-200 enabled:hover:-translate-y-1 disabled:cursor-default disabled:opacity-90"
              aria-label={`${meta.label}: ${activity.title}`}
            >
              <div
                className="h-28 w-full flex items-center justify-center overflow-hidden"
                style={{ backgroundColor: `${meta.accent}22` }}
              >
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-5xl" aria-hidden>{meta.icon}</span>
                )}
              </div>
              <div className="flex flex-1 flex-col p-4">
                <span
                  className="font-karla text-[11px] font-extrabold uppercase tracking-[0.15em] mb-1"
                  style={{ color: meta.accent }}
                >
                  {meta.label}
                </span>
                <span className="font-baloo text-lg font-bold leading-tight"
                  style={{ color: 'var(--room-ink)' }}>
                  {activity.title}
                </span>
                <span className="font-karla text-xs text-stone-500 mt-1 flex-1">{meta.blurb}</span>
                {isHost && (
                  <span
                    className="font-baloo mt-3 inline-block rounded-lg px-4 py-2 text-center text-sm font-bold text-white transition-colors"
                    style={{ backgroundColor: meta.accent }}
                  >
                    Play
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {activities.length === 0 && (
        <p className="font-karla text-white/70 mt-8">No activities are set up for this book yet.</p>
      )}
    </div>
  );
}
