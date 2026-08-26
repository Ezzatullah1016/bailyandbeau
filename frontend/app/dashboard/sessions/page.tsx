'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookMarked, BookOpen, Link2, Plus, RefreshCw } from 'lucide-react';
import { apiRequest } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { usePathname } from 'next/navigation';

interface Session {
  id: string; book_title: string; child_name: string; status: string;
  room_type: string; created_at: string; started_at: string | null;
  ended_at: string | null; invite_token?: string;
  reading_duration_seconds?: number;
}
interface MeData { id: number; username: string; first_name: string; last_name: string; is_staff?: boolean; }

const STATUS_PILL: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-800',
  active:    'bg-amber-100 text-amber-800',
  pending:   'bg-stone-100 text-stone-600',
  lobby:     'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
  expired:   'bg-stone-200 text-stone-400',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDuration(start: string | null, end: string | null) {
  if (!start || !end) return '—';
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  return `${mins} min${mins !== 1 ? 's' : ''}`;
}


export default function SessionsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [me, setMe] = useState<MeData | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [copyingInviteId, setCopyingInviteId] = useState<string | null>(null);
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

  /**
   * Copy an invite link.
   *
   * Both halves of this used to be swallowed — the fetch and the clipboard write
   * — and nothing confirmed success either, so the button was indistinguishable
   * from a dead one whether it worked or not. Copying is the one action with no
   * visible result of its own, so it *needs* the acknowledgement.
   */
  async function copyInviteLink(sessionId: string) {
    if (copyingInviteId) return;
    setCopyingInviteId(sessionId);
    try {
      const data = await apiRequest<{ data: { invite_url: string } }>(
        `/sessions/${sessionId}/invite/`,
      );
      const url = data?.data?.invite_url;
      if (!url) throw new Error('No invite URL in response');
      await navigator.clipboard.writeText(url);
      toast.success('Invite link copied.');
    } catch (err) {
      // Clipboard writes also fail on a denied permission or a non-secure
      // origin, which is not the caller's fault but is still worth saying.
      toast.error('Could not copy the invite link.', err);
    } finally {
      setCopyingInviteId(null);
    }
  }

  if (loading) return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#faf7f6]">
      <RefreshCw className="w-10 h-10 text-[#764f84] animate-spin" />
    </div>
  );

  return (
    <>
      <Sidebar me={me} currentPath={pathname} />
      <div className="ml-0 md:ml-64 flex-1 min-w-0 overflow-x-hidden flex flex-col">
      <header className="flex justify-between items-center w-full pl-16 pr-8 md:px-8 h-16 sticky top-0 z-40 bg-[#faf7f6]/80 backdrop-blur-xl shadow-sm border-b border-[#3d3b62]/10">
        <div className="font-baloo text-xl font-bold text-[#3d3b62]">Sessions</div>
        <Link href="/dashboard" className="font-baloo px-4 py-2 bg-[#3d3b62] text-white text-sm font-bold rounded-lg hover:bg-[#764f84] transition-all flex items-center gap-2">
          <Plus className="w-4 h-4" /> New Session
        </Link>
      </header>
      <main className="p-8 min-h-screen bg-[#faf7f6] font-karla text-[#1d1b16]">
        <div className="mb-8">
          <h2 className="font-baloo text-4xl text-[#3d3b62] font-bold mb-2">Session History</h2>
          <p className="text-stone-500">{sessions.length} session{sessions.length !== 1 ? 's' : ''} total</p>
        </div>

        <div className="flex gap-3 mb-8 flex-wrap">
          {['all', 'completed', 'active', 'lobby', 'pending', 'cancelled', 'expired'].map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-full text-sm font-bold capitalize transition-all ${filter === f ? 'bg-[#3d3b62] text-white' : 'bg-white text-stone-500 hover:bg-[#eccdca]/30 border border-[#eccdca]'}`}>
              {f === 'all' ? 'All' : f}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-[#eccdca] overflow-hidden">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-24 text-stone-400">
              <BookMarked className="w-12 h-12" />
              <p className="font-medium">No sessions found</p>
              <Link href="/dashboard" className="font-baloo px-6 py-2 bg-[#3d3b62] text-white rounded-lg text-sm font-bold hover:bg-[#764f84] transition-all">
                Start a Session
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-[#eccdca]/40">
                  <tr>
                    {['Book', 'Child', 'Date', 'Duration', 'Status', 'Actions'].map((h) => (
                      <th key={h} className="px-6 py-4 text-left text-xs font-bold text-stone-400 uppercase tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eccdca]/30">
                  {filtered.map((s) => (
                    <tr key={s.id} className="hover:bg-[#faf7f6] transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-6 bg-[#3d3b62]/10 rounded flex items-center justify-center shrink-0">
                            <BookOpen className="w-4 h-4 text-[#764f84]" />
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
                            <Link href={`/session/${s.id}/lobby`} className="text-xs font-bold text-[#764f84] hover:underline">Rejoin</Link>
                          )}
                          {(s.status === 'pending' || s.status === 'lobby' || s.status === 'active') && (
                            <button
                              type="button"
                              onClick={() => copyInviteLink(s.id)}
                              disabled={copyingInviteId === s.id}
                              className="text-xs font-bold text-[#c84a71] hover:underline flex items-center gap-1 cursor-pointer disabled:cursor-wait disabled:opacity-60">
                              {copyingInviteId === s.id ? (
                                <RefreshCw className="w-3 h-3 animate-spin" aria-hidden />
                              ) : (
                                <Link2 className="w-3 h-3" aria-hidden />
                              )}
                              {copyingInviteId === s.id ? 'Copying…' : 'Copy Invite'}
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
      </div>
    </>
  );
}
