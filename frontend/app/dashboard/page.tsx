'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight, Bell, BookOpen, BookMarked, CalendarDays, CheckSquare,
  CreditCard, DoorOpen, Lock, Medal, MoreHorizontal, Play, Settings,
  UserCircle, X,
} from 'lucide-react';
import { apiRequest, createSession, type UserBadgeData } from '@/lib/api';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardData {
  children_count: number;
  completed_sessions_count: number;
  active_sessions_count: number;
  badges_count: number;
  recent_sessions: {
    id: string;
    book_title: string;
    child_name: string;
    status: string;
    room_type: string;
    created_at: string;
    started_at: string | null;
    ended_at: string | null;
  }[];
}

interface MeData {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
}

interface ChildProfile {
  id: string;
  display_name: string;
  age_band: string;
}

interface Book {
  id: string;
  title: string;
  slug: string;
  description: string;
  room_type: string;
  age_band: string;
  cover_image: string;
  page_count: number;
}

interface EntitlementData {
  subscription_status: string;
  plan_code: string;
  sessions_remaining: number;
  pack_sessions_remaining: number;
  renewal_date: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusPill(status: string) {
  const map: Record<string, string> = {
    completed: 'bg-emerald-100 text-emerald-800',
    active:    'bg-amber-100 text-amber-800',
    pending:   'bg-stone-100 text-stone-600',
    lobby:     'bg-blue-100 text-blue-700',
    cancelled: 'bg-red-100 text-red-700',
  };
  return map[status] ?? 'bg-stone-100 text-stone-600';
}

const BADGE_ICONS: Record<string, string> = {
  'first-session': '⭐',
  'five-sessions': '🏆',
  'ten-sessions':  '🌟',
  'bookworm':      '📖',
  'brave-heart':   '🦁',
};


// ─── Start Session Modal ──────────────────────────────────────────────────────

function StartSessionModal({
  books,
  childProfiles,
  onClose,
  onStart,
}: {
  books: Book[];
  childProfiles: ChildProfile[];
  onClose: () => void;
  onStart: (sessionId: string, participantId: string) => void;
}) {
  const [bookId, setBookId] = useState(books[0]?.id ?? '');
  const [childId, setChildId] = useState(childProfiles[0]?.id ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleStart() {
    if (!bookId || !childId) { setError('Select a book and child profile.'); return; }
    setLoading(true);
    setError('');
    try {
      const data = await createSession(bookId, childId);
      localStorage.setItem(`bb_participant_${data.id}`, data.host_participant_id);
      onStart(data.id, data.host_participant_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create session.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="font-headline text-2xl text-[#173901] font-bold">Start a Session</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#43493d] mb-2">Book</label>
            <select
              value={bookId}
              onChange={(e) => setBookId(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-[#c3c9b9] bg-white text-[#1d1b16] text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5016]"
            >
              {books.map((b) => (
                <option key={b.id} value={b.id}>{b.title}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#43493d] mb-2">Reading with</label>
            <select
              value={childId}
              onChange={(e) => setChildId(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-[#c3c9b9] bg-white text-[#1d1b16] text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5016]"
            >
              {childProfiles.map((c) => (
                <option key={c.id} value={c.id}>{c.display_name} (age {c.age_band})</option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            onClick={handleStart}
            disabled={loading}
            className="w-full py-4 bg-[#173901] text-white rounded-xl font-bold text-sm transition-all hover:bg-[#2d5016] active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            <Play className="w-5 h-5" />
            {loading ? 'Creating session…' : 'Start Session'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const pathname = usePathname();

  const [me, setMe] = useState<MeData | null>(null);
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [entitlement, setEntitlement] = useState<EntitlementData | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [badges, setBadges] = useState<UserBadgeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('bb_access_token') : null;
    if (!token) { router.replace('/login'); return; }

    Promise.all([
      apiRequest<{ data: MeData }>('/me/').then((r) => setMe(r.data)),
      apiRequest<{ data: DashboardData }>('/dashboard/').then((r) => setDash(r.data)),
      apiRequest<{ data: EntitlementData }>('/billing/entitlement/').then((r) => setEntitlement(r.data)),
      apiRequest<{ data: Book[] }>('/books/').then((r) => setBooks(r.data)),
      apiRequest<{ data: ChildProfile[] }>('/children/').then((r) => setChildren(r.data)),
      apiRequest<{ data: UserBadgeData[] }>('/me/badges/').then((r) => setBadges(r.data)),
    ])
      .catch(() => router.replace('/login'))
      .finally(() => setLoading(false));
  }, [router]);

  function handleSessionStarted(sessionId: string) {
    setShowModal(false);
    router.push(`/session/${sessionId}/lobby`);
  }

  const firstName = me?.first_name || me?.username || 'there';
  const sessionsLeft = (entitlement?.sessions_remaining ?? 0) + (entitlement?.pack_sessions_remaining ?? 0);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#f0f9f0]">
        <div className="flex flex-col items-center gap-4">
          <Icon name="sync" className="w-10 h-10 text-[#2d5016] animate-spin" />
          <p className="text-sm text-[#2d5016] font-medium">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {showModal && (
        <StartSessionModal
          books={books}
          childProfiles={children}
          onClose={() => setShowModal(false)}
          onStart={handleSessionStarted}
        />
      )}

      <Sidebar me={me} currentPath={pathname} />

      <header className="flex justify-between items-center w-full px-8 h-16 ml-64 sticky top-0 z-40 bg-[#f0f9f0]/80 backdrop-blur-xl shadow-sm border-b border-[#2d5016]/10">
        <div className="font-headline text-xl font-bold text-[#173901]">Dashboard</div>
        <div className="flex items-center gap-4">
          <button className="relative group">
            <Bell className="w-5 h-5 text-stone-500 group-hover:text-[#173901] transition-colors" />
            <span className="absolute top-0 right-0 h-2 w-2 bg-red-500 rounded-full border-2 border-white" />
          </button>
          <UserCircle className="w-5 h-5 text-stone-500 cursor-pointer" />
        </div>
      </header>

      <main className="ml-64 p-8 min-h-screen bg-[#f7faf6] font-body text-[#1d1b16]">

        <section className="mb-10">
          <h2 className="font-headline text-4xl text-[#173901] font-bold mb-2">
            Welcome back, {firstName} 👋
          </h2>
          <p className="text-stone-500 font-medium">
            {dash?.active_sessions_count
              ? `You have ${dash.active_sessions_count} active session${dash.active_sessions_count > 1 ? 's' : ''} right now.`
              : 'Ready to start today\'s reading session?'}
          </p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <div className="bg-white p-6 rounded-xl shadow-sm flex flex-col border border-[#c3c9b9]/10">
            <span className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-4">Sessions Remaining</span>
            <div className="flex items-end justify-between">
              <span className="text-5xl font-headline font-bold text-[#173901]">{sessionsLeft}</span>
              <CalendarDays className="w-8 h-8 text-[#a8d38a]" />
            </div>
            {entitlement?.plan_code && (
              <span className="mt-3 text-xs text-stone-400 capitalize">{entitlement.plan_code.replace(/-/g, ' ')}</span>
            )}
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm flex flex-col border border-[#c3c9b9]/10">
            <span className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-4">Sessions Completed</span>
            <div className="flex items-end justify-between">
              <span className="text-5xl font-headline font-bold text-[#835500]">{dash?.completed_sessions_count ?? 0}</span>
              <CheckSquare className="w-8 h-8 text-[#feae2c]" />
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm flex flex-col border border-[#c3c9b9]/10">
            <span className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-4">Badges Earned</span>
            <div className="flex items-end justify-between">
              <span className="text-5xl font-headline font-bold text-[#5f1700]">{badges.length}</span>
              <Medal className="w-8 h-8 text-[#ffb59f]" />
            </div>
          </div>
        </section>

        <section className="bg-[#2d5016] rounded-3xl p-8 mb-10 overflow-hidden relative flex flex-col md:flex-row items-center gap-8 shadow-xl shadow-[#173901]/10">
          <div className="flex-1 z-10">
            <span className="inline-block px-4 py-1.5 bg-[#feae2c] text-[#291800] text-xs font-bold rounded-full mb-6">
              {books.length > 0 ? 'Start Reading' : 'No Books Yet'}
            </span>
            <h3 className="font-headline text-4xl text-white mb-4">
              {books[0]?.title ?? 'Choose a book'}
            </h3>
            <p className="text-emerald-100/80 text-lg mb-6">
              {books[0]?.description || 'Pick a book from the library and start a session with your child.'}
            </p>
            <div className="flex items-center gap-4 text-emerald-200/60 text-sm mb-8">
              <span className="flex items-center gap-1">
                <DoorOpen className="w-4 h-4" /> Reading Room
              </span>
              {books[0]?.age_band && (
                <>
                  <span className="h-1 w-1 rounded-full bg-emerald-700" />
                  <span>Ages {books[0].age_band}</span>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-4">
              <button
                onClick={() => setShowModal(true)}
                disabled={sessionsLeft === 0 || books.length === 0 || children.length === 0}
                className="px-8 py-3 bg-[#feae2c] hover:bg-amber-400 text-[#291800] font-bold rounded-lg transition-all flex items-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="w-5 h-5 transition-transform group-hover:scale-125" />
                Start Session
              </button>
              <Link
                href="/dashboard/library"
                className="px-8 py-3 border border-white/20 hover:bg-white/10 text-white font-bold rounded-lg transition-all"
              >
                Browse Library
              </Link>
            </div>
            {sessionsLeft === 0 && (
              <p className="mt-4 text-amber-300/80 text-sm">
                No sessions remaining.{' '}
                <Link href="/dashboard/billing" className="underline hover:text-amber-200">Upgrade your plan</Link>
              </p>
            )}
          </div>

          <div className="w-48 h-64 flex-shrink-0 bg-white rounded-xl shadow-2xl relative overflow-hidden transform rotate-3 hover:rotate-0 transition-transform duration-500 flex items-center justify-center">
            {books[0]?.cover_image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={books[0].cover_image} alt={books[0].title} className="w-full h-full object-cover" />
            ) : (
              <BookOpen className="w-12 h-12 text-[#2d5016]" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
          </div>

          <div className="absolute -bottom-20 -right-20 w-80 h-80 bg-emerald-400/10 rounded-full blur-3xl" />
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-10 gap-8">

          <div className="lg:col-span-6 bg-white rounded-2xl p-6 shadow-sm border border-[#c3c9b9]/10">
            <div className="flex justify-between items-center mb-6">
              <h4 className="font-headline text-2xl text-[#173901] font-bold">Recent Sessions</h4>
              <button className="text-sm font-bold text-[#835500] hover:underline">View All</button>
            </div>

            {(!dash?.recent_sessions || dash.recent_sessions.length === 0) ? (
              <div className="flex flex-col items-center gap-3 py-12 text-stone-400">
                <BookMarked className="w-10 h-10" />
                <p className="text-sm font-medium">No sessions yet</p>
                <button
                  onClick={() => setShowModal(true)}
                  className="mt-2 px-6 py-2 bg-[#173901] text-white rounded-lg text-sm font-bold hover:bg-[#2d5016] transition-all"
                >
                  Start your first session
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left border-b border-[#f3ede3]">
                      <th className="pb-4 text-xs font-bold text-stone-400 uppercase tracking-widest">Book</th>
                      <th className="pb-4 text-xs font-bold text-stone-400 uppercase tracking-widest">Child</th>
                      <th className="pb-4 text-xs font-bold text-stone-400 uppercase tracking-widest">Date</th>
                      <th className="pb-4 text-xs font-bold text-stone-400 uppercase tracking-widest">Status</th>
                      <th className="pb-4 text-xs font-bold text-stone-400 uppercase tracking-widest text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f3ede3]">
                    {dash.recent_sessions.map((s) => (
                      <tr key={s.id} className="group hover:bg-[#f9f3e9] transition-colors">
                        <td className="py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-6 bg-[#2d5016]/10 rounded flex items-center justify-center flex-shrink-0">
                              <BookOpen className="w-4 h-4 text-[#2d5016]" />
                            </div>
                            <span className="font-semibold text-[#1d1b16] text-sm truncate max-w-[160px]">{s.book_title}</span>
                          </div>
                        </td>
                        <td className="py-4 text-stone-500 text-sm">{s.child_name}</td>
                        <td className="py-4 text-stone-500 text-sm whitespace-nowrap">{fmtDate(s.created_at)}</td>
                        <td className="py-4">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold capitalize ${statusPill(s.status)}`}>
                            {s.status}
                          </span>
                        </td>
                        <td className="py-4 text-right">
                          {s.status === 'active' || s.status === 'lobby' ? (
                            <Link
                              href={`/session/${s.id}/lobby`}
                              className="text-xs font-bold text-[#2d5016] hover:underline"
                            >
                              Rejoin
                            </Link>
                          ) : (
                            <button className="text-stone-400 hover:text-[#173901] transition-colors">
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="lg:col-span-4 bg-white rounded-2xl p-6 shadow-sm border border-[#c3c9b9]/10">
            <div className="flex justify-between items-center mb-8">
              <h4 className="font-headline text-2xl text-[#173901] font-bold">Badge Collection</h4>
            </div>

            {badges.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-stone-400">
                <Medal className="w-10 h-10" />
                <p className="text-sm font-medium text-center">Complete sessions to earn badges!</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-y-8 gap-x-4 mb-10">
                {badges.map((ub) => (
                  <div key={ub.id} className="flex flex-col items-center gap-2">
                    <div className="h-16 w-16 rounded-full bg-[#ffddb4] flex items-center justify-center text-3xl shadow-lg border-2 border-white ring-2 ring-[#feae2c]/20">
                      {BADGE_ICONS[ub.badge_code] ?? '🏅'}
                    </div>
                    <span className="text-[10px] font-bold text-stone-500 uppercase tracking-tighter text-center leading-tight">
                      {ub.badge_name}
                    </span>
                  </div>
                ))}
                <div className="flex flex-col items-center gap-2 opacity-40">
                  <div className="h-16 w-16 rounded-full bg-stone-200 flex items-center justify-center text-stone-400 border-2 border-dashed border-stone-300">
                    <Lock className="w-6 h-6" />
                  </div>
                  <span className="text-[10px] font-bold text-stone-400 uppercase tracking-tighter">Next Milestone</span>
                </div>
              </div>
            )}

            <Link
              href="/dashboard/badges"
              className="flex items-center justify-center gap-2 w-full py-4 bg-[#f3ede3] text-[#173901] font-bold rounded-xl hover:bg-[#ede7dd] transition-all text-sm group"
            >
              View All Badges
              <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
