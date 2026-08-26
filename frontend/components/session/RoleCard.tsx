'use client';

import { Sparkles } from 'lucide-react';

import { ROLE_BLURB, ROLE_BLURB_ACTIVITY, ROLE_LABEL, type SessionRole } from '@/lib/roles';

/**
 * The sidebar's closing card, which explains the two seats.
 *
 * It has two jobs, and the client's screens use a different one per context. On
 * the reading and activity-list screens it is a *legend*: both roles described,
 * so a grandparent joining for the first time can see what each person does.
 * Inside an activity it becomes *personal* — "You are the Adventure Guide" plus
 * what that means for this particular activity — because by then the question is
 * no longer who is who but what you are meant to do next.
 */

/** Per-type guidance, shown once you are inside an activity. */
const ACTIVITY_HINT: Record<string, string> = {
  quiz: 'Put your knowledge to the test and earn some serious bragging rights.',
  drag_drop:
    'Drag each item to the character, object, or spot where it belongs. Work together to complete the scene.',
  hotspot:
    'Discover hidden surprises throughout the scene. Tap each glowing spot to uncover fun facts, story details, and magical discoveries.',
  drawing: 'Use your creativity to colour and bring the illustration to life.',
};

export function RoleCard({
  role,
  variant,
  activityType,
}: {
  role: SessionRole;
  /** `legend` describes both seats; `you` addresses the viewer's own. */
  variant: 'legend' | 'you';
  /** Selects the per-type hint in the `you` variant. */
  activityType?: string;
}) {
  const blurbs = variant === 'you' ? ROLE_BLURB_ACTIVITY : ROLE_BLURB;

  return (
    <section
      className="px-4 py-4"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid var(--room-chrome-line)',
        borderRadius: 'var(--r-md)',
      }}
      aria-label={variant === 'you' ? 'Your role' : 'Who does what'}
    >
      {variant === 'you' ? (
        <>
          <h2 className="flex items-center gap-2 font-baloo text-[15px] font-bold leading-tight">
            <Sparkles
              className="h-4 w-4 shrink-0"
              style={{ color: 'var(--room-accent)' }}
              aria-hidden
            />
            <span style={{ color: 'var(--room-accent)' }}>You are the {ROLE_LABEL[role]}</span>
          </h2>
          <p
            className="mt-2 font-karla text-[12.5px] leading-relaxed"
            style={{ color: 'var(--room-ink-strong)' }}
          >
            {(activityType && ACTIVITY_HINT[activityType]) || blurbs[role]}
          </p>
        </>
      ) : (
        <dl className="space-y-3">
          {(['host', 'guest'] as const).map((r) => (
            <div key={r}>
              <dt
                className="font-baloo text-[15px] font-bold leading-tight"
                style={{ color: 'var(--room-accent)' }}
              >
                {ROLE_LABEL[r]}
              </dt>
              <dd
                className="mt-1 font-karla text-[12.5px] leading-relaxed"
                style={{ color: 'var(--room-ink-strong)' }}
              >
                {blurbs[r]}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
