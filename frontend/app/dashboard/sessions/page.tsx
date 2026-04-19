'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookMarked, BookOpen, Link2, Plus, RefreshCw } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { apiRequest } from '@/lib/api';

interface Session {
  id: string; book_title: string; child_name: string; status: string;
  room_type: string; created_at: string; started_at: string | null;
  ended_at: string | null; invite_token?: string;
}
interface MeData { id: number; username: string; first_name: string; last_name: string; }

const STATUS_PILL: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-800',
  active:    'bg-amber-100 text-amber-800',
  pending:   'bg-stone-100 text-stone-600',
  lobby:     'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDuration(start: string | null, end: string | null) {
  if (!start || !end) return '—';
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  return `${mins} min${mins !== 1 ? 's' : ''}`;
}

function Sidebar({ me }: { me: MeData | null }) {
  const initials = me ? (`${me.first_name?.[0] ?? ''}${me.last_name?.[0] ?? ''}`).toUpperCase() || me.username[0].toUpperCase() : '?';
  const displayName = me ? (me.first_name ? `${me.first_name} ${me.last_name}`.trim() : me.username) : '';
  return (
    <aside className="h-screen w-64 fixed left-0 top-0 overflow-y-auto bg-[#2d5016] flex flex-col py-8 z-50">
      <div className="px-6 mb-10">
        <h1 className="font-headline text-2xl italic text-[#feae2c]">Bailey &amp; Beau</h1>
        <p className="text-[10px] uppercase tracking-widest text-[#a8d38a]/60 font-bold mt-1">The Living Storybook</p>
      </div>
      <nav className="flex-1 space-y-1 px-2">
        {[
          { href: '/dashboard',          icon: 'dashboard',    label: 'Dashboard',  active: false },
          { href: '/dashboard/library',  icon: 'auto_stories', label: 'Library',    active: false },
          { href: '/dashboard/sessions', icon: 'history_edu',  label: 'Sessions',   active: true  },
          { href: '/dashboard/badges',   icon: 'military_tech',label: 'Badges',     active: false },
          { href: '/dashboard/billing',  icon: 'payments',     label: 'Billing',    active: false },
          { href: '/dashboard/settings', icon: 'settings',     label: 'Settings',   active: false },
        ].map((item) => (
          <Link key={item.href} href={item.href}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${item.active ? 'bg-emerald-900/50 text-[#feae2c] font-bold' : 'text-[#a8d38a]/70 hover:text-white hover:bg-emerald-900/40'}`}>
            <Icon name={item.icon} className="w-5 h-5" />
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="px-4 mt-auto pt-8 border-t border-white/5">
        <div className="flex items-center gap-3 p-2 rounded-xl bg-white/5">
          <div className="h-10 w-10 rounded-full bg-[#feae2c] flex items-center justify-center text-[#2d5016] font-bold text-sm shrink-0">{initials}</div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{displayName}</p>
            <button onClick={() => { localStorage.removeItem('bb_access_token'); localStorage.removeItem('bb_refresh_token'); window.location.href = '/login'; }}
              className="text-xs text-[#a8d38a]/50 hover:text-[#a8d38a] transition-colors">Sign Out</button>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default function SessionsPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeData | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('bb_access_token');
    if (!token) { router.replace('/login'); return; }
    Promise.all([
      apiRequest<{ data: MeData }>('/me/').then((r) => setMe(r.data)),
      apiRequest<{ data: Session[] }>('/sessions/').then((r) => setSessions(r.data)),
    ]).catch(() => router.replace('/login')).finally(() => setLoading(false));
  }, [router]);

  const filtered = filter === 'all' ? sessions : sessions.filter((s) => s.status === filter);

  async function copyInviteLink(sessionId: string) {
    const data = await apiRequest<{ data: { invite_url: string } }>(`/sessions/${sessionId}/invite/`).catch(() => null);
    if (data?.data?.invite_url) {
      await navigator.clipboard.writeText(data.data.invite_url).catch(() => {});
    }
  }

  if (loading) return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#fff9ee]">
      <RefreshCw className="w-10 h-10 text-[#2d5016] animate-spin" />
    </div>
  );

  return (
    <>
      <Sidebar me={me} />
      <header className="flex justify-between items-center w-full px-8 h-16 ml-64 sticky top-0 z-40 bg-[#fff9ee]/80 backdrop-blur-xl shadow-sm border-b border-[#c3c9b9]/20">
        <div className="font-headline text-xl font-bold text-[#173901]">Sessions</div>
        <Link href="/dashboard" className="px-4 py-2 bg-[#173901] text-white text-sm font-bold rounded-lg hover:bg-[#2d5016] transition-all flex items-center gap-2">
          <Plus className="w-4 h-4" /> New Session
        </Link>
      </header>
      <main className="ml-64 p-8 min-h-screen bg-[#f9f3e9] font-body text-[#1d1b16]">
        <div className="mb-8">
          <h2 className="font-headline text-4xl text-[#173901] font-bold mb-2">Session History</h2>
          <p className="text-stone-500">{sessions.length} session{sessions.length !== 1 ? 's' : ''} total</p>
        </div>

        <div className="flex gap-3 mb-8 flex-wrap">
          {['all', 'completed', 'active', 'lobby', 'pending', 'cancelled'].map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-full text-sm font-bold capitalize transition-all ${filter === f ? 'bg-[#2d5016] text-white' : 'bg-white text-stone-500 hover:bg-[#e8f0df] border border-[#c3c9b9]/40'}`}>
              {f === 'all' ? 'All' : f}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-[#c3c9b9]/10 overflow-hidden">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-24 text-stone-400">
              <BookMarked className="w-12 h-12" />
              <p className="font-medium">No sessions found</p>
              <Link href="/dashboard" className="px-6 py-2 bg-[#173901] text-white rounded-lg text-sm font-bold hover:bg-[#2d5016] transition-all">
                Start a Session
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-[#f3ede3]">
                  <tr>
                    {['Book', 'Child', 'Date', 'Duration', 'Status', 'Actions'].map((h) => (
                      <th key={h} className="px-6 py-4 text-left text-xs font-bold text-stone-400 uppercase tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f3ede3]">
                  {filtered.map((s) => (
                    <tr key={s.id} className="hover:bg-[#f9f3e9] transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-6 bg-[#2d5016]/10 rounded flex items-center justify-center shrink-0">
                            <BookOpen className="w-4 h-4 text-[#2d5016]" />
                          </div>
                          <span className="font-semibold text-[#1d1b16] text-sm truncate max-w-[180px]">{s.book_title}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-stone-500 text-sm">{s.child_name}</td>
                      <td className="px-6 py-4 text-stone-500 text-sm whitespace-nowrap">{fmtDate(s.created_at)}</td>
                      <td className="px-6 py-4 text-stone-500 text-sm">{fmtDuration(s.started_at, s.ended_at)}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold capitalize ${STATUS_PILL[s.status] ?? 'bg-stone-100 text-stone-600'}`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {(s.status === 'active' || s.status === 'lobby') && (
                            <Link href={`/session/${s.id}/lobby`} className="text-xs font-bold text-[#2d5016] hover:underline">Rejoin</Link>
                          )}
                          {(s.status === 'pending' || s.status === 'lobby' || s.status === 'active') && (
                            <button onClick={() => copyInviteLink(s.id)}
                              className="text-xs font-bold text-[#835500] hover:underline flex items-center gap-1">
                              <Link2 className="w-3 h-3" /> Copy Invite
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
