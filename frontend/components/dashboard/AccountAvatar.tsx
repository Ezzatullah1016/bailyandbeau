'use client';

import Link from 'next/link';

import { apiBaseUrl } from '@/lib/api';

/** Backend origin where `/media/` is served (strip `/api/v1` from API base). */
function apiMediaOrigin(): string {
  return apiBaseUrl.replace(/\/api\/v1\/?$/i, '');
}

/** Turn stored avatar paths into a browser-loadable URL */
export function resolveUserAvatarUrl(raw?: string | null): string | undefined {
  const u = (raw ?? '').trim();
  if (!u) return undefined;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('/')) return `${apiMediaOrigin()}${u}`;
  return u;
}

/** Subset of `/me/` user payload used for avatar display */
export type DashboardMe = {
  username: string;
  first_name: string;
  last_name: string;
  avatar_url?: string;
};

export function dashboardInitials(me: DashboardMe | null): string {
  if (!me) return '?';
  const pair = `${me.first_name?.[0] ?? ''}${me.last_name?.[0] ?? ''}`.trim().toUpperCase();
  return pair || (me.username?.[0]?.toUpperCase() ?? '?');
}

/** Bottom-of-sidebar avatar (dark panel) */
export function SidebarProfileAvatar({ me }: { me: DashboardMe | null }) {
  const initials = dashboardInitials(me);
  const url = resolveUserAvatarUrl(me?.avatar_url);
  return (
    <div className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 border border-white/20 overflow-hidden">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        initials
      )}image.png
    </div>
  );
}

/** Top header avatar — links to account settings */
export function HeaderProfileAvatar({ me }: { me: DashboardMe | null }) {
  const initials = dashboardInitials(me);
  const url = resolveUserAvatarUrl(me?.avatar_url);
  return (
    <Link
      href="/dashboard/settings"
      title="Account settings"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white overflow-hidden shadow-sm hover:ring-2 hover:ring-[#764f84]/25 transition-shadow"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="text-[11px] font-bold text-[#3d3b62]">{initials}</span>
      )}
    </Link>
  );
}
