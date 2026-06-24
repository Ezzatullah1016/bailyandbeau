'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Medal, CheckCircle2, BellOff } from 'lucide-react';

export interface NotificationItem {
  id: string;
  kind: 'badge' | 'session';
  title: string;
  detail: string;
  at: string; // ISO timestamp
}

const SEEN_KEY = 'bb_notifs_seen_at';

function timeAgo(iso: string) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function NotificationBell({ items }: { items: NotificationItem[] }) {
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState<number>(0);
  const ref = useRef<HTMLDivElement>(null);

  const sorted = useMemo(
    () => [...items].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 12),
    [items],
  );

  useEffect(() => {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SEEN_KEY) : null;
    setSeenAt(raw ? Number(raw) : 0);
  }, []);

  const unreadCount = sorted.filter((n) => new Date(n.at).getTime() > seenAt).length;

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && sorted.length > 0) {
      const newest = new Date(sorted[0].at).getTime();
      localStorage.setItem(SEEN_KEY, String(newest));
      setSeenAt(newest);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        className="relative group"
      >
        <Bell className="w-5 h-5 text-stone-500 group-hover:text-[#3d3b62] transition-colors" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full border-2 border-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-white rounded-2xl shadow-2xl border border-[#eccdca] overflow-hidden z-[120]"
        >
          <div className="px-4 py-3 border-b border-[#3d3b62]/10 bg-[#faf7f6]">
            <p className="font-baloo text-sm font-bold text-[#3d3b62]">Notifications</p>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {sorted.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-stone-400">
                <BellOff className="w-7 h-7" />
                <p className="text-sm font-medium">You&apos;re all caught up</p>
              </div>
            ) : (
              sorted.map((n) => (
                <div key={n.id} className="flex gap-3 px-4 py-3 hover:bg-[#faf7f6] border-b border-[#3d3b62]/5 last:border-0">
                  <div className={`mt-0.5 shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${n.kind === 'badge' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {n.kind === 'badge' ? <Medal className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#3d3b62] leading-tight">{n.title}</p>
                    <p className="text-xs text-stone-500 truncate">{n.detail}</p>
                    <p className="text-[10px] text-stone-400 mt-0.5">{timeAgo(n.at)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
