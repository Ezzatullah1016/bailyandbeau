'use client';

import { Star, User } from 'lucide-react';

import { ROLE_LABEL, type SessionRole } from '@/lib/roles';

/**
 * The small role badge that sits inside a participant tile.
 *
 * Purple with a star for the Adventure Guide, teal with a person for the
 * Explorer — the pairing is from the client's screens, and it carries an icon
 * as well as a colour so the two seats are still distinguishable to anyone who
 * cannot separate the hues.
 */
export function RoleChip({ role, className = '' }: { role: SessionRole; className?: string }) {
  const isHost = role === 'host';
  const Icon = isHost ? Star : User;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-karla text-[11px] font-semibold leading-none text-white ${className}`}
      style={{ background: isHost ? '#7c5a9e' : '#3b85a6' }}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {ROLE_LABEL[role]}
    </span>
  );
}

/**
 * The green "Host" marker in the opposite corner of the tile. It answers a
 * different question from RoleChip — not "what can this person do" but "who is
 * driving right now" — which is why the screens show both on the same tile.
 */
export function HostChip({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-lg px-2 py-1 font-karla text-[11px] font-semibold leading-none ${className}`}
      style={{ background: 'var(--c-green)', color: '#12301f' }}
    >
      Host
    </span>
  );
}
