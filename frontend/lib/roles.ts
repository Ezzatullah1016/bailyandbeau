/**
 * Room roles have two names: the one the API speaks and the one a family reads.
 *
 * The backend stores `SessionParticipant.role` as `host` | `guest`, and every
 * permission check, LiveKit token and snapshot keeps using those values. The
 * UI never shows them: "Host" and "Guest" describe a video call, not a story,
 * and the client's screens name the two seats "Adventure Guide" and "Explorer".
 *
 * Import from here rather than writing the label inline, so a rename is one
 * edit and the room, lobby, dashboard and staff portal can never drift.
 */

export type SessionRole = 'host' | 'guest';

export const ROLE_LABEL: Record<SessionRole, string> = {
  host: 'Adventure Guide',
  guest: 'Explorer',
};

/** One line each, shown in the room's role card. */
export const ROLE_BLURB: Record<SessionRole, string> = {
  host: 'Leads the story, turns the pages, and sets the pace for the adventure.',
  guest: 'Follows along, joins the conversation, reacts, draws, and shares in every moment.',
};

/** The activity-room variant: same seats, described in terms of an activity. */
export const ROLE_BLURB_ACTIVITY: Record<SessionRole, string> = {
  host: 'Leads the activity, guides each step, and sets the pace for creating together.',
  guest: 'Follows along, shares ideas, draws, reacts, and joins in every part of the adventure.',
};

export function roleLabel(role: SessionRole | string | null | undefined): string {
  return role === 'host' || role === 'guest' ? ROLE_LABEL[role] : ROLE_LABEL.guest;
}
