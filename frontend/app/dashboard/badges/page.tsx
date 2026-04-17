'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/api';

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
          { href: '/dashboard',          icon: 'dashboard',    label: 'Dashboard', active: false },
          { href: '/dashboard/library',  icon: 'auto_stories', label: 'Library',   active: false },
          { href: '/dashboard/sessions', icon: 'history_edu',  label: 'Sessions',  active: false },
          { href: '/dashboard/badges',   icon: 'military_tech',label: 'Badges',    active: true  },
          { href: '/dashboard/billing',  icon: 'payments',     label: 'Billing',   active: false },
          { href: '/dashboard/settings', icon: 'settings',     label: 'Settings',  active: false },
        ].map((item) => (
          <Link key={item.href} href={item.href}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${item.active ? 'bg-emerald-900/50 text-[#feae2c] font-bold' : 'text-[#a8d38a]/70 hover:text-white hover:bg-emerald-900/40'}`}>
            <span className="material-symbols-outlined" style={item.active ? { fontVariationSettings: "'FILL' 1" } : undefined}>{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="px-4 mt-auto pt-8 border-t border-white/5">
        <div className="flex items-center gap-3 p-2 rounded-xl bg-white/5">
          <div className="h-10 w-10 rounded-full bg-[#feae2c] flex items-center justify-center text-[#2d5016] font-bold text-sm flex-shrink-0">{initials}</div>
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

export default function BadgesPage() {
  const router = useRouter();
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
    <div className="h-screen w-screen flex items-center justify-center bg-[#fff9ee]">
      <span className="material-symbols-outlined text-5xl text-[#2d5016] animate-spin">sync</span>
    </div>
  );

  return (
    <>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,200..800;1,6..72,200..800&family=Plus+Jakarta+Sans:wght@200..800&display=swap" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" />
      <style>{`.material-symbols-outlined{font-variation-settings:'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24}.font-headline{font-family:'Newsreader',serif}.font-body{font-family:'Plus Jakarta Sans',sans-serif}body{background-color:#fff9ee;font-family:'Plus Jakarta Sans',sans-serif}`}</style>
      <Sidebar me={me} />
      <header className="flex justify-between items-center w-full px-8 h-16 ml-64 sticky top-0 z-40 bg-[#fff9ee]/80 backdrop-blur-xl shadow-sm border-b border-[#c3c9b9]/20">
        <div className="font-headline text-xl font-bold text-[#173901]">Badges</div>
      </header>
      <main className="ml-64 p-8 min-h-screen bg-[#f9f3e9] font-body text-[#1d1b16]">
        <div className="mb-8">
          <h2 className="font-headline text-4xl text-[#173901] font-bold mb-2">Badge Collection</h2>
          <p className="text-stone-500">{earned.length} of {allBadges.length || '?'} badges earned</p>
        </div>

        {/* Progress bar */}
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

        {/* Earned badges */}
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

        {/* All badges / locked */}
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
                        <span className="material-symbols-outlined text-stone-400" style={{ fontVariationSettings: "'FILL' 1" }}>lock</span>
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
            <span className="material-symbols-outlined text-6xl">military_tech</span>
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
