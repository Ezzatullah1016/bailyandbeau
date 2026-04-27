'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Lock, Medal, RefreshCw } from 'lucide-react';
import { apiRequest } from '@/lib/api';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { usePathname } from 'next/navigation';

interface Badge { id: string; name: string; code: string; description: string; icon_url: string; trigger_type: string; }
interface UserBadge { id: string; badge_code: string; badge_name: string; awarded_at: string; }
interface MeData { id: number; username: string; first_name: string; last_name: string; }

const BADGE_ICONS: Record<string, string> = {
  'first-session': '⭐', 'five-sessions': '🏆', 'ten-sessions': '🌟',
  'bookworm': '📖', 'brave-heart': '🦁',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}


export default function BadgesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<MeData | null>(null);
  const [allBadges, setAllBadges] = useState<Badge[]>([]);
  const [earned, setEarned] = useState<UserBadge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('bb_access_token');
    if (!token) { router.replace('/login'); return; }
    Promise.all([
      apiRequest<{ data: MeData }>('/me/').then((r) => setMe(r.data)),
      apiRequest<{ data: Badge[] }>('/badges/').then((r) => setAllBadges(r.data)).catch(() => {}),
      apiRequest<{ data: UserBadge[] }>('/me/badges/').then((r) => setEarned(r.data)),
    ]).catch(() => router.replace('/login')).finally(() => setLoading(false));
  }, [router]);

  const earnedCodes = new Set(earned.map((b) => b.badge_code));

  if (loading) return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#f0f9f0]">
      <RefreshCw className="w-10 h-10 text-[#2d5016] animate-spin" />
    </div>
  );

  return (
    <>
      <Sidebar me={me} currentPath={pathname} />
      <header className="flex justify-between items-center w-full px-8 h-16 ml-64 sticky top-0 z-40 bg-[#f0f9f0]/80 backdrop-blur-xl shadow-sm border-b border-[#2d5016]/10">
        <div className="font-headline text-xl font-bold text-[#173901]">Badges</div>
      </header>
      <main className="ml-64 p-8 min-h-screen bg-[#f7faf6] font-body text-[#1d1b16]">
        <div className="mb-8">
          <h2 className="font-headline text-4xl text-[#173901] font-bold mb-2">Badge Collection</h2>
          <p className="text-stone-500">{earned.length} of {allBadges.length || '?'} badges earned</p>
        </div>

        {allBadges.length > 0 && (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-[#c3c9b9]/10 mb-8">
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-bold text-[#173901]">Collection Progress</span>
              <span className="text-sm text-stone-500">{earned.length}/{allBadges.length}</span>
            </div>
            <div className="h-3 bg-stone-100 rounded-full overflow-hidden">
              <div className="h-full bg-[#feae2c] rounded-full transition-all" style={{ width: `${(earned.length / allBadges.length) * 100}%` }} />
            </div>
          </div>
        )}

        {earned.length > 0 && (
          <section className="mb-10">
            <h3 className="font-headline text-2xl text-[#173901] font-bold mb-6">Earned Badges</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {earned.map((ub) => (
                <div key={ub.id} className="bg-white rounded-2xl p-6 shadow-sm border border-[#c3c9b9]/10 flex flex-col items-center gap-3 text-center">
                  <div className="h-20 w-20 rounded-full bg-[#ffddb4] flex items-center justify-center text-4xl shadow-lg border-4 border-white ring-2 ring-[#feae2c]/30">
                    {BADGE_ICONS[ub.badge_code] ?? '🏅'}
                  </div>
                  <div>
                    <p className="font-bold text-[#173901] text-sm">{ub.badge_name}</p>
                    <p className="text-[10px] text-stone-400 mt-1">Earned {fmtDate(ub.awarded_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {allBadges.length > 0 && (
          <section>
            <h3 className="font-headline text-2xl text-[#173901] font-bold mb-6">All Badges</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {allBadges.map((badge) => {
                const isEarned = earnedCodes.has(badge.code);
                return (
                  <div key={badge.id} className={`bg-white rounded-2xl p-6 shadow-sm border border-[#c3c9b9]/10 flex flex-col items-center gap-3 text-center transition-all ${!isEarned ? 'opacity-50 grayscale' : ''}`}>
                    <div className={`h-20 w-20 rounded-full flex items-center justify-center text-4xl shadow-lg border-4 border-white ${isEarned ? 'bg-[#ffddb4] ring-2 ring-[#feae2c]/30' : 'bg-stone-100 border-dashed border-stone-300'}`}>
                      {isEarned ? (BADGE_ICONS[badge.code] ?? '🏅') : (
                        <Lock className="w-8 h-8 text-stone-400" />
                      )}
                    </div>
                    <div>
                      <p className="font-bold text-[#173901] text-sm">{badge.name}</p>
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
            <Link href="/dashboard" className="px-6 py-2 bg-[#173901] text-white rounded-lg text-sm font-bold hover:bg-[#2d5016] transition-all">
              Start a Session
            </Link>
          </div>
        )}
      </main>
    </>
  );
}
