'use client';

import {
  BookOpen,
  ChevronLeft,
  Link as LinkIcon,
  MoreHorizontal,
  Palette,
  Scissors,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';

import { Pill } from './Pill';
import { ROLE_LABEL, type SessionRole } from '@/lib/roles';

export interface RoomHeaderBarProps {
  bookTitle: string;
  /** `reading` labels the room gold; `activity` labels it pink. */
  kind: 'reading' | 'activity';
  /** The friendly activity-type name, e.g. "Story Quest". Activity rooms only. */
  activityLabel?: string;
  /** One line of guidance under the room label. Activity rooms only. */
  instruction?: string;
  /** Shown when inside an activity and the viewer can leave it. */
  onBack?: () => void;
  participantCount: number;
  role: SessionRole;
  onInvite: () => void;
  onOverflow: () => void;
  onEnd: () => void;
  /** Copy on the destructive pill: hosts end the session, guests only leave. */
  endLabel: string;
  /** Confirmation feedback for the Invite pill. */
  inviteCopied?: boolean;
}

/**
 * The room's top bar: who you are, where you are, and the way out.
 *
 * The room used to float a bare title top-left and an X top-right with no bar
 * behind either, so the participant count, the connection state and the way to
 * invite someone had nowhere to live — the invite handler existed but was
 * unreachable, and the role was never shown at all. The client's screens give
 * all of it one 80px bar, which is what this renders.
 */
export function RoomHeaderBar({
  bookTitle,
  kind,
  activityLabel,
  instruction,
  onBack,
  participantCount,
  role,
  onInvite,
  onOverflow,
  onEnd,
  endLabel,
  inviteCopied,
}: RoomHeaderBarProps) {
  const RoomIcon = kind === 'reading' ? BookOpen : Palette;

  return (
    <header
      className="room-recede room-bar flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5"
      style={{ minHeight: 'var(--room-header-h)' }}
    >
      {/* ── Identity ──────────────────────────────────────────────────────── */}
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to the activity list"
          title="Back to the activity list"
          className="room-tap shrink-0 cursor-pointer rounded-full transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--room-accent)]"
          style={{ color: 'var(--room-ink)' }}
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
      ) : (
        <span
          aria-hidden
          className="grid h-14 w-14 shrink-0 place-items-center rounded-full"
          style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid var(--room-chrome-line)' }}
        >
          <BookOpen className="h-6 w-6" style={{ color: 'var(--room-accent)' }} />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <h1
          className="truncate font-baloo text-[22px] font-bold leading-tight sm:text-[26px]"
          style={{ color: 'var(--room-ink)' }}
        >
          {bookTitle}
        </h1>

        <p className="mt-0.5 flex items-center gap-1.5 font-montserrat text-[13px] font-semibold uppercase leading-none tracking-[0.12em]">
          <RoomIcon
            className="h-[15px] w-[15px] shrink-0"
            style={{ color: kind === 'reading' ? 'var(--room-accent)' : 'var(--c-pink)' }}
            aria-hidden
          />
          <span style={{ color: kind === 'reading' ? 'var(--room-accent)' : 'var(--c-pink)' }}>
            {kind === 'reading' ? 'Reading Room' : 'Activity Room'}
          </span>
          {activityLabel && (
            <>
              <span aria-hidden style={{ color: 'var(--room-ink-soft)' }}>
                &bull;
              </span>
              <span className="truncate" style={{ color: 'var(--c-teal)' }}>
                {activityLabel}
              </span>
            </>
          )}
        </p>

        {instruction && (
          <p
            className="mt-1 hidden items-center gap-1.5 font-karla text-[13px] leading-snug sm:flex"
            style={{ color: 'rgba(245,239,247,0.72)' }}
          >
            <Sparkles
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: 'var(--room-accent)' }}
              aria-hidden
            />
            <span className="truncate">{instruction}</span>
          </p>
        )}
      </div>

      {/* ── Controls ──────────────────────────────────────────────────────────
          Progressive disclosure by width: the count and the role always show
          (they answer "who is here" and "what may I do"), Secure and Invite
          need a wider viewport, and the way out never hides. */}
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <Pill icon={Users} title={`${participantCount} in the room`} className="hidden sm:inline-flex">
          {participantCount}
        </Pill>

        <Pill
          icon={ShieldCheck}
          tone="outline"
          title="This session is private and end-to-end encrypted in transit"
          className="hidden lg:inline-flex"
        >
          Secure
        </Pill>

        <Pill tone="role" className="hidden md:inline-flex">
          {ROLE_LABEL[role]}
        </Pill>

        <Pill
          icon={LinkIcon}
          onClick={onInvite}
          label="Copy the invite link"
          className="hidden md:inline-flex"
        >
          {inviteCopied ? 'Copied' : 'Invite'}
        </Pill>

        <Pill icon={MoreHorizontal} onClick={onOverflow} label="More session options" />

        <Pill icon={Scissors} tone="danger" onClick={onEnd} label={endLabel}>
          <span className="hidden sm:inline">{endLabel}</span>
        </Pill>
      </div>
    </header>
  );
}
