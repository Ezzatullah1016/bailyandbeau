'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/api';

interface Book {
  id: string;
  title: string;
  slug: string;
  description: string;
  room_type: string;
  age_band: string;
  cover_image: string;
  page_count: number;
  published: boolean;
}

interface MeData { id: number; username: string; first_name: string; last_name: string; }

const ROOM_LABELS: Record<string, string> = { reading: 'Reading Room', activity: 'Activity Room', hybrid: 'Both Rooms' };
const ROOM_COLORS: Record<string, string> = { reading: 'bg-emerald-100 text-emerald-800', activity: 'bg-amber-100 text-amber-800', hybrid: 'bg-blue-100 text-blue-700' };

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
          { href: '/dashboard/library',  icon: 'auto_stories', label: 'Library',    active: true  },
          { href: '/dashboard/sessions', icon: 'history_edu',  label: 'Sessions',   active: false },
          { href: '/dashboard/badges',   icon: 'military_tech',label: 'Badges',     active: false },
          { href: '/dashboard/billing',  icon: 'payments',     label: 'Billing',    active: false },
          { href: '/dashboard/settings', icon: 'settings',     label: 'Settings',   active: false },
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

export default function LibraryPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeData | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('bb_access_token');
    if (!token) { router.replace('/login'); return; }
    Promise.all([
      apiRequest<{ data: MeData }>('/me/').then((r) => setMe(r.data)),
      apiRequest<{ data: Book[] }>('/books/').then((r) => setBooks(r.data)),
      apiRequest<{ data: { book: string }[] }>('/library/favorites/').then((r) => setFavorites(new Set(r.data.map((f) => f.book)))).catch(() => {}),
    ]).catch(() => router.replace('/login')).finally(() => setLoading(false));
  }, [router]);

  async function toggleFavorite(bookId: string) {
    if (favorites.has(bookId)) {
      await apiRequest(`/library/favorites/${bookId}/`, { method: 'DELETE' }).catch(() => {});
      setFavorites((prev) => { const s = new Set(prev); s.delete(bookId); return s; });
    } else {
      await apiRequest('/library/favorites/', { method: 'POST', body: JSON.stringify({ book: bookId }) }).catch(() => {});
      setFavorites((prev) => new Set([...prev, bookId]));
    }
  }

  const filtered = filter === 'all' ? books : filter === 'favorites' ? books.filter((b) => favorites.has(b.id)) : books.filter((b) => b.room_type === filter);

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
        <div className="font-headline text-xl font-bold text-[#173901]">Library</div>
      </header>
      <main className="ml-64 p-8 min-h-screen bg-[#f9f3e9] font-body text-[#1d1b16]">
        <div className="mb-8">
          <h2 className="font-headline text-4xl text-[#173901] font-bold mb-2">Book Library</h2>
          <p className="text-stone-500">{books.length} book{books.length !== 1 ? 's' : ''} available</p>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-8 flex-wrap">
          {[{ val: 'all', label: 'All Books' }, { val: 'reading', label: 'Reading Room' }, { val: 'activity', label: 'Activity Room' }, { val: 'favorites', label: '♥ Favourites' }].map((f) => (
            <button key={f.val} onClick={() => setFilter(f.val)}
              className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${filter === f.val ? 'bg-[#2d5016] text-white' : 'bg-white text-stone-500 hover:bg-[#e8f0df] border border-[#c3c9b9]/40'}`}>
              {f.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-24 text-stone-400">
            <span className="material-symbols-outlined text-6xl">menu_book</span>
            <p className="font-medium">No books found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filtered.map((book) => (
              <div key={book.id} className="bg-white rounded-2xl shadow-sm border border-[#c3c9b9]/10 overflow-hidden hover:shadow-md transition-shadow group">
                <div className="h-48 bg-[#2d5016]/5 flex items-center justify-center relative overflow-hidden">
                  {book.cover_image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={book.cover_image} alt={book.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  ) : (
                    <span className="material-symbols-outlined text-[#2d5016]/30 text-7xl">auto_stories</span>
                  )}
                  <button onClick={() => toggleFavorite(book.id)}
                    className="absolute top-3 right-3 h-8 w-8 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center shadow-sm hover:bg-white transition-all">
                    <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: favorites.has(book.id) ? "'FILL' 1" : "'FILL' 0", color: favorites.has(book.id) ? '#e63946' : '#9ca3af' }}>favorite</span>
                  </button>
                </div>
                <div className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${ROOM_COLORS[book.room_type] ?? 'bg-stone-100 text-stone-500'}`}>
                      {ROOM_LABELS[book.room_type] ?? book.room_type}
                    </span>
                    <span className="text-[10px] text-stone-400 font-medium">Ages {book.age_band}</span>
                  </div>
                  <h3 className="font-headline text-lg font-bold text-[#173901] mb-1 leading-tight">{book.title}</h3>
                  {book.description && <p className="text-stone-400 text-xs line-clamp-2 mb-4">{book.description}</p>}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-stone-400">{book.page_count} pages</span>
                    <Link href="/dashboard"
                      className="px-4 py-2 bg-[#173901] text-white text-xs font-bold rounded-lg hover:bg-[#2d5016] transition-all">
                      Start Session
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
