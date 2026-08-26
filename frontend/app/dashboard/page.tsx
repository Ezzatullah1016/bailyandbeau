'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BookOpen, BookMarked, CalendarDays, CheckSquare,
  CreditCard, DoorOpen, Play, RefreshCw, Settings,
  X,
} from 'lucide-react';
import { apiRequest, createSession, listActivityGroups } from '@/lib/api';
import type { ActivityGroupData } from '@/lib/api';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { HeaderProfileAvatar } from '@/components/dashboard/AccountAvatar';
import { NotificationBell, type NotificationItem } from '@/components/dashboard/NotificationBell';
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
  is_staff?: boolean;
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

// ─── Start Session Modal ──────────────────────────────────────────────────────

function StartSessionModal({
  books,
  adventures,
  childProfiles,
  initialBookId,
  initialGroupId,
  onClose,
  onStart,
}: {
  books: Book[];
  adventures: ActivityGroupData[];
  childProfiles: ChildProfile[];
  initialBookId?: string | null;
  initialGroupId?: string | null;
  onClose: () => void;
  onStart: (sessionId: string, participantId: string) => void;
}) {
  // One selector for both kinds of target, prefixed so the value says which it
  // is — the same shape the staff portal's owner selector uses.
  const [target, setTarget] = useState(books[0] ? `book:${books[0].id}` : '');
  const bookId = target.startsWith('book:') ? target.slice(5) : '';
  const groupId = target.startsWith('group:') ? target.slice(6) : '';
  const [childId, setChildId] = useState(childProfiles[0]?.id ?? '');
  const [roomType, setRoomType] = useState<'reading' | 'activity'>('reading');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Which room types the selected book supports. 'hybrid' books offer both;
  // 'reading'/'activity' books lock to that one. An adventure is always the
  // activity room — there is nothing to read — so the toggle is hidden for it.
  const selectedBook = books.find((b) => b.id === bookId);
  const bookRoom = selectedBook?.room_type ?? 'reading';
  const canReading = !groupId && (bookRoom === 'reading' || bookRoom === 'hybrid');
  const canActivity = !groupId && (bookRoom === 'activity' || bookRoom === 'hybrid');

  // Keep the chosen room type valid for the selected book.
  useEffect(() => {
    if (groupId) return;
    if (roomType === 'reading' && !canReading) setRoomType('activity');
    else if (roomType === 'activity' && !canActivity) setRoomType('reading');
  }, [bookId, groupId, canReading, canActivity, roomType]);

  useEffect(() => {
    if (initialBookId && books.some((b) => b.id === initialBookId)) {
      setTarget(`book:${initialBookId}`);
    } else if (initialGroupId && adventures.some((g) => g.id === initialGroupId)) {
      setTarget(`group:${initialGroupId}`);
    }
  }, [initialBookId, initialGroupId, books, adventures]);

  async function handleStart() {
    if ((!bookId && !groupId) || !childId) {
      setError('Select something to play and a child profile.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await createSession(
        groupId
          ? { activityGroupId: groupId, childProfileId: childId }
          : { bookId, childProfileId: childId, roomType },
      );
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
          <h2 className="font-baloo text-2xl text-[#3d3b62] font-bold">Start a Session</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#43493d] mb-2">What shall we do?</label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={books.length === 0 && adventures.length === 0}
              className="font-karla w-full px-4 py-3 rounded-xl border border-[#eccdca] bg-white text-[#1d1b16] text-sm focus:outline-none focus:ring-2 focus:ring-[#3b85a6]"
            >
              {books.length === 0 && adventures.length === 0 && <option value="">Nothing available</option>}
              {books.length > 0 && (
                <optgroup label="Books">
                  {books.map((b) => (
                    <option key={b.id} value={`book:${b.id}`}>{b.title}</option>
                  ))}
                </optgroup>
              )}
              {adventures.length > 0 && (
                <optgroup label="Adventures">
                  {adventures.map((g) => (
                    <option key={g.id} value={`group:${g.id}`}>
                      {g.title} · {g.activity_count} activities
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#764f84] mb-2">Reading with</label>
            <select
              value={childId}
              onChange={(e) => setChildId(e.target.value)}
              disabled={childProfiles.length === 0}
              className="font-karla w-full px-4 py-3 rounded-xl border border-[#eccdca] bg-white text-[#1d1b16] text-sm focus:outline-none focus:ring-2 focus:ring-[#3b85a6]"
            >
              {childProfiles.length === 0 && <option value="">No child profiles found</option>}
              {childProfiles.map((c) => (
                <option key={c.id} value={c.id}>{c.display_name} (age {c.age_band})</option>
              ))}
            </select>
            {childProfiles.length === 0 && (
              <p className="mt-2 text-xs text-[#764f84]">
                Add a child profile first to start a reading session.{' '}
                <Link href="/onboarding/child" className="font-semibold underline">
                  Create child profile
                </Link>
              </p>
            )}
          </div>

          {(canReading && canActivity) && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#3b85a6] mb-2">Room</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRoomType('reading')}
                  className={`font-karla py-3 rounded-xl text-sm font-bold transition-all ${roomType === 'reading' ? 'bg-[#3d3b62] text-white' : 'bg-white border border-[#eccdca] text-[#3d3b62]'}`}
                >
                  Reading Room
                </button>
                <button
                  type="button"
                  onClick={() => setRoomType('activity')}
                  className={`font-karla py-3 rounded-xl text-sm font-bold transition-all ${roomType === 'activity' ? 'bg-[#764f84] text-white' : 'bg-white border border-[#eccdca] text-[#764f84]'}`}
                >
                  Activity Room
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            onClick={handleStart}
            disabled={loading || books.length === 0 || childProfiles.length === 0}
            className="font-baloo w-full py-4 bg-[#f0c75e] hover:bg-[#e6b84d] text-[#3d3b62] rounded-xl font-bold text-sm transition-all active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2"
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

function DashboardInner() {
  const router = useRouter();
  const pathname = usePathname();
  const [startBook, setStartBook] = useState<string | null>(null);
  const [startGroup, setStartGroup] = useState<string | null>(null);
  const [adventures, setAdventures] = useState<ActivityGroupData[]>([]);
  const [me, setMe] = useState<MeData | null>(null);
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [entitlement, setEntitlement] = useState<EntitlementData | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    setStartBook(q.get('startBook'));
    setStartGroup(q.get('startGroup'));
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('bb_access_token') : null;
    if (!token) {
      router.replace('/login');
      setLoading(false);
      return;
    }

    setLoadError(null);
    setLoading(true);

    const safetyMs = 75000;
    const safetyId = typeof window !== 'undefined' ? window.setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, safetyMs) : null;

    Promise.all([
      apiRequest<{ data: MeData }>('/me/').then((r) => { if (!cancelled) setMe(r.data); }),
      apiRequest<{ data: DashboardData }>('/dashboard/').then((r) => { if (!cancelled) setDash(r.data); }),
      apiRequest<{ data: EntitlementData }>('/billing/entitlement/').then((r) => { if (!cancelled) setEntitlement(r.data); }),
      apiRequest<{ data: Book[] }>('/books/').then((r) => { if (!cancelled) setBooks(r.data); }),
      listActivityGroups().then((g) => { if (!cancelled) setAdventures(g); }).catch(() => {}),
      apiRequest<{ data: ChildProfile[] }>('/children/').then((r) => { if (!cancelled) setChildren(r.data); }),
    ])
      .catch((e) => {
        if (cancelled) return;
        console.error('[Dashboard] load failed', e);
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('Session expired') || msg.includes('sign in again')) {
          router.replace('/login');
          return;
        }
        setLoadError(
          'Could not load your dashboard. The API may be offline or unreachable. If you use Laragon, start Django (often port 8000) and ensure NEXT_PUBLIC_API_BASE_URL matches your API base.',
        );
      })
      .finally(() => {
        if (safetyId) clearTimeout(safetyId);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (safetyId) clearTimeout(safetyId);
    };
  }, [router, reloadKey]);

  useEffect(() => {
    if (children.length === 0) return;
    if (startBook && books.some((b) => b.id === startBook)) setShowModal(true);
    else if (startGroup && adventures.some((g) => g.id === startGroup)) setShowModal(true);
  }, [startBook, startGroup, books, adventures, children]);

  function handleSessionStarted(sessionId: string) {
    setShowModal(false);
    router.push(`/session/${sessionId}/lobby`);
  }

  const firstName = me?.first_name || me?.username || 'there';
  const sessionsLeft = (entitlement?.sessions_remaining ?? 0) + (entitlement?.pack_sessions_remaining ?? 0);

  const notifications: NotificationItem[] = [
    ...(dash?.recent_sessions ?? [])
      .filter((s) => s.status === 'completed' && s.ended_at)
      .map((s) => ({
        id: `session-${s.id}`,
        kind: 'session' as const,
        title: 'Reading session completed',
        detail: `${s.child_name} finished “${s.book_title}”`,
        at: s.ended_at as string,
      })),
  ];

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#faf7f6]">
        <div className="flex flex-col items-center gap-4">
          <Icon name="sync" className="w-10 h-10 text-[#3d3b62] animate-spin" />
          <p className="font-karla text-sm text-[#3d3b62] font-medium">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#faf7f6] p-6">
        <div className="max-w-md rounded-2xl border border-[#eccdca] bg-white p-8 text-center shadow-lg">
          <p className="font-karla text-sm text-[#764f84]">{loadError}</p>
          <p className="mt-3 font-karla text-xs text-stone-500">
            API tried: check the browser Network tab for requests to{' '}
            <code className="rounded bg-stone-100 px-1 py-0.5 text-[11px]">/api/v1/</code> on your Django host.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => {
                setReloadKey((k) => k + 1);
              }}
              className="font-baloo inline-flex items-center justify-center gap-2 rounded-xl bg-[#3d3b62] px-6 py-3 text-sm font-bold text-white transition-all hover:bg-[#764f84]"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </button>
            <Link
              href="/login"
              className="font-baloo inline-flex items-center justify-center rounded-xl border border-[#eccdca] px-6 py-3 text-sm font-bold text-[#3d3b62] hover:bg-stone-50"
            >
              Back to login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {showModal && (
        <StartSessionModal
          books={books}
          adventures={adventures}
          childProfiles={children}
          initialBookId={startBook}
          initialGroupId={startGroup}
          onClose={() => setShowModal(false)}
          onStart={handleSessionStarted}
        />
      )}

      <Sidebar me={me} currentPath={pathname} />

      <div className="ml-0 md:ml-64 flex-1 min-w-0 overflow-x-hidden flex flex-col">
      <header className="flex justify-between items-center w-full pl-16 pr-8 md:px-8 h-16 sticky top-0 z-40 bg-[#faf7f6]/80 backdrop-blur-xl shadow-sm border-b border-[#3d3b62]/10">
        <div className="font-baloo text-xl font-bold text-[#3d3b62]">Dashboard</div>
        <div className="flex items-center gap-4">
          <NotificationBell items={notifications} />
          <HeaderProfileAvatar me={me} />
        </div>
      </header>

      <main className="p-8 min-h-screen bg-[#faf7f6] font-karla text-[#1d1b16]">

        <section className="mb-10">
          <h2 className="font-baloo text-4xl text-[#3d3b62] font-bold mb-2">
            Welcome back, {firstName} 👋
          </h2>
          <p className="font-karla text-stone-500 font-medium">
            {dash?.active_sessions_count
              ? `You have ${dash.active_sessions_count} active session${dash.active_sessions_count > 1 ? 's' : ''} right now.`
              : 'Ready to start today\'s reading session?'}
          </p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
          <div className="bg-white p-6 rounded-xl shadow-[0_6px_18px_rgba(0,0,0,0.08)] flex flex-col border border-[#eccdca]">
            <span className="font-karla text-xs font-bold uppercase tracking-wider text-stone-400 mb-4">Sessions Remaining</span>
            <div className="flex items-end justify-between">
              <span className="font-baloo text-5xl font-bold text-[#3d3b62]">{sessionsLeft}</span>
              <CalendarDays className="w-8 h-8 text-[#764f84]" />
            </div>
            {entitlement?.plan_code && (
              <span className="font-karla mt-3 text-xs text-stone-400 capitalize">{entitlement.plan_code.replace(/-/g, ' ')}</span>
            )}
          </div>

          <div className="bg-white p-6 rounded-xl shadow-[0_6px_18px_rgba(0,0,0,0.08)] flex flex-col border border-[#eccdca]">
            <span className="font-karla text-xs font-bold uppercase tracking-wider text-stone-400 mb-4">Sessions Completed</span>
            <div className="flex items-end justify-between">
              <span className="font-baloo text-5xl font-bold text-[#3d3b62]">{dash?.completed_sessions_count ?? 0}</span>
              <CheckSquare className="w-8 h-8 text-[#f0c75e]" />
            </div>
          </div>
        </section>

        <section className="bg-gradient-to-br from-[#3d3b62] to-[#764f84] rounded-3xl p-8 mb-10 overflow-hidden relative flex flex-col md:flex-row items-center gap-8 shadow-xl shadow-[#3d3b62]/20">
          <div className="flex-1 z-10">
            <span className="inline-block px-4 py-1.5 bg-[#f0c75e] text-[#3d3b62] font-karla text-xs font-bold rounded-full mb-6">
              {books.length > 0 ? 'Start Reading' : 'No Books Yet'}
            </span>
            <h3 className="font-baloo text-4xl text-white mb-4">
              {books[0]?.title ?? 'Choose a book'}
            </h3>
            <p className="font-karla text-white/80 text-lg mb-6">
              {books[0]?.description || 'Pick a book from the library and start a session with your child.'}
            </p>
            <div className="font-karla flex items-center gap-4 text-white/60 text-sm mb-8">
              <span className="flex items-center gap-1">
                <DoorOpen className="w-4 h-4" /> Reading Room
              </span>
              {books[0]?.age_band && (
                <>
                  <span className="h-1 w-1 rounded-full bg-white/30" />
                  <span>Ages {books[0].age_band}</span>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-4">
              <button
                onClick={() => setShowModal(true)}
                disabled={sessionsLeft === 0 || books.length === 0 || children.length === 0}
                className="font-baloo px-8 py-3 bg-[#f0c75e] hover:bg-[#e6b84d] text-[#3d3b62] font-bold rounded-lg transition-all flex items-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="w-5 h-5 transition-transform group-hover:scale-125" />
                Start Session
              </button>
              <Link
                href="/dashboard/library"
                className="font-baloo px-8 py-3 border border-white bg-transparent hover:bg-white/10 text-white font-bold rounded-lg transition-all"
              >
                Browse Library
              </Link>
            </div>
            {sessionsLeft === 0 && (
              <p className="font-karla mt-4 text-[#f0c75e]/80 text-sm">
                No sessions remaining.{' '}
                <Link href="/dashboard/billing" className="underline hover:text-[#f0c75e]">Upgrade your plan</Link>
              </p>
            )}
          </div>

          <div className="w-48 h-64 flex-shrink-0 bg-white rounded-xl shadow-2xl relative overflow-hidden transform rotate-3 hover:rotate-0 transition-transform duration-500 flex items-center justify-center">
            {books[0]?.cover_image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={books[0].cover_image} alt={books[0].title} className="w-full h-full object-cover" />
            ) : (
              <BookOpen className="w-12 h-12 text-[#3d3b62]" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
          </div>

          <div className="absolute -bottom-20 -right-20 w-80 h-80 bg-white/5 rounded-full blur-3xl" />
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-10 gap-8">

          <div className="lg:col-span-10 bg-white rounded-2xl p-6 shadow-[0_6px_18px_rgba(0,0,0,0.08)] border border-[#eccdca]">
            <div className="flex justify-between items-center mb-6">
              <h4 className="font-baloo text-2xl text-[#3d3b62] font-bold">Recent Sessions</h4>
              <Link href="/dashboard/sessions" className="font-karla text-sm font-bold text-[#764f84] hover:underline">View All</Link>
            </div>

            {(!dash?.recent_sessions || dash.recent_sessions.length === 0) ? (
              <div className="flex flex-col items-center gap-3 py-12 text-stone-400">
                <BookMarked className="w-10 h-10" />
                <p className="text-sm font-medium">No sessions yet</p>
                <button
                  onClick={() => setShowModal(true)}
                  className="font-baloo mt-2 px-6 py-2 bg-[#3d3b62] text-white rounded-lg text-sm font-bold hover:bg-[#764f84] transition-all"
                  disabled={books.length === 0 || children.length === 0}
                >
                  Start your first session
                </button>
                {children.length === 0 && (
                  <Link href="/onboarding/child" className="text-xs font-semibold text-[#764f84] underline">
                    Add child profile to continue
                  </Link>
                )}
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
                            <div className="h-8 w-6 bg-[#3d3b62]/10 rounded flex items-center justify-center flex-shrink-0">
                              <BookOpen className="w-4 h-4 text-[#764f84]" />
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
                              className="text-xs font-bold text-[#764f84] hover:underline"
                            >
                              Rejoin
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
      </div>
    </>
  );
}

export default function DashboardPage() {
  return <DashboardInner />;
}
