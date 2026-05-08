'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, Medal, RefreshCw } from 'lucide-react';
import { apiRequest } from '@/lib/api';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { usePathname } from 'next/navigation';

interface Badge { id: string; name: string; code: string; description: string; icon: string; }
interface UserBadge { id: string; badge_code: string; badge_name: string; earned_at: string; }
interface MeData { id: number; username: string; first_name: string; last_name: string; }

const BADGE_ICONS: Record<string, string> = {
  'first-session': '⭐', 'five-sessions': '🏆', 'ten-sessions': '🌟',
  'bookworm': '📖', 'brave-heart': '🦁',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}


function BadgesPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [me, setMe] = useState<MeData | null>(null);
  const [allBadges, setAllBadges] = useState<Badge[]>([]);
  const [earned, setEarned] = useState<UserBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const newBadgeCodes = useRef<Set<string>>(new Set());
  const newBadgeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = localStorage.getItem('bb_access_token');
    if (!token) { router.replace('/login'); return; }
    Promise.all([
      apiRequest<{ data: MeData }>('/me/').then((r) => setMe(r.data)),
      apiRequest<{ data: Badge[] }>('/badges/').then((r) => setAllBadges(r.data)).catch(() => {}),
      apiRequest<{ data: UserBadge[] }>('/me/badges/').then((r) => setEarned(r.data)),
    ]).catch(() => router.replace('/login')).finally(() => setLoading(false));
  }, [router]);

  // Pick up new badge codes passed via ?new=code1,code2 from session completion redirect
  useEffect(() => {
    const raw = searchParams.get('new');
    if (raw) {
      raw.split(',').forEach((c) => newBadgeCodes.current.add(c.trim()));
      // Scroll to earned section after load
      setTimeout(() => newBadgeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
    }
  }, [searchParams]);

  const earnedCodes = new Set(earned.map((b) => b.badge_code));

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
        <div className="font-baloo text-xl font-bold text-[#3d3b62]">Badges</div>
      </header>
      <main className="p-8 min-h-screen bg-[#faf7f6] font-karla text-[#1d1b16]">
        <div className="mb-8">
          <h2 className="font-baloo text-4xl text-[#3d3b62] font-bold mb-2">Badge Collection</h2>
          <p className="text-stone-500">{earned.length} of {allBadges.length || '?'} badges earned</p>
          <p className="mt-2 text-xs text-stone-500 max-w-xl">
            Your family&apos;s badges are private to this account — they aren&apos;t shown on a public profile or to session guests.
          </p>
        </div>

        {allBadges.length > 0 && (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-[#eccdca] mb-8">
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-bold text-[#3d3b62]">Collection Progress</span>
              <span className="text-sm text-stone-500">{earned.length}/{allBadges.length}</span>
            </div>
            <div className="h-3 bg-stone-100 rounded-full overflow-hidden">
              <div className="h-full bg-[#f0c75e] rounded-full transition-all" style={{ width: `${(earned.length / allBadges.length) * 100}%` }} />
            </div>
          </div>
        )}

        {earned.length > 0 && (
          <section className="mb-10">
            <h3 className="font-baloo text-2xl text-[#3d3b62] font-bold mb-6">Earned Badges</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {earned.map((ub) => {
                const isNew = newBadgeCodes.current.has(ub.badge_code);
                return (
                <div
                  key={ub.id}
                  ref={isNew ? newBadgeRef : undefined}
                  className={`bg-white rounded-2xl p-6 shadow-sm border flex flex-col items-center gap-3 text-center ${isNew ? 'border-[#f0c75e] ring-2 ring-[#f0c75e]/40' : 'border-[#eccdca]'}`}
                >
                  <div className={`h-20 w-20 rounded-full bg-[#f0c75e]/30 flex items-center justify-center text-4xl shadow-lg border-4 border-white ring-2 ring-[#f0c75e]/40 ${isNew ? 'badge-reveal' : ''}`}>
                    {BADGE_ICONS[ub.badge_code] ?? '🏅'}
                  </div>
                  <div>
                    <p className="font-baloo font-bold text-[#3d3b62] text-sm">{ub.badge_name}</p>
                    <p className="text-[10px] text-stone-400 mt-1">Earned {fmtDate(ub.earned_at)}</p>
                  </div>
                </div>
                );
              })}
            </div>
          </section>
        )}

        {allBadges.length > 0 && (
          <section>
            <h3 className="font-baloo text-2xl text-[#3d3b62] font-bold mb-6">All Badges</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {allBadges.map((badge) => {
                const isEarned = earnedCodes.has(badge.code);
                return (
                  <div key={badge.id} className={`bg-white rounded-2xl p-6 shadow-sm border border-[#eccdca] flex flex-col items-center gap-3 text-center transition-all ${!isEarned ? 'opacity-50 grayscale' : ''}`}>
                    <div className={`h-20 w-20 rounded-full flex items-center justify-center text-4xl shadow-lg border-4 border-white ${isEarned ? 'bg-[#f0c75e]/30 ring-2 ring-[#f0c75e]/40' : 'bg-stone-100 border-dashed border-stone-300'}`}>
                      {isEarned ? (BADGE_ICONS[badge.code] ?? '🏅') : (
                        <Lock className="w-8 h-8 text-stone-400" />
                      )}
                    </div>
                    <div>
                      <p className="font-baloo font-bold text-[#3d3b62] text-sm">{badge.name}</p>
                      {badge.description && <p className="text-[10px] text-stone-400 mt-1">{badge.description}</p>}
                      {!isEarned && <p className="text-[10px] text-stone-400 mt-1 italic">Not yet earned</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {earned.length === 0 && allBadges.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-24 text-stone-400">
            <Medal className="w-12 h-12" />
            <p className="font-medium">Complete sessions to earn badges!</p>
            <Link href="/dashboard" className="font-baloo px-6 py-2 bg-[#3d3b62] text-white rounded-lg text-sm font-bold hover:bg-[#764f84] transition-all">
              Start a Session
            </Link>
          </div>
        )}
      </main>
      </div>
    </>
  );
}

export default function BadgesPage() {
  return (
    <Suspense
      fallback={(
        <div className="flex h-screen w-screen items-center justify-center bg-[#faf7f6]">
          <RefreshCw className="h-10 w-10 animate-spin text-[#764f84]" />
        </div>
      )}
    >
      <BadgesPageContent />
    </Suspense>
  );
}
