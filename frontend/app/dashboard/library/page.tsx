'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookOpen, Heart, Info, RefreshCw } from 'lucide-react';
import { apiRequest } from '@/lib/api';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { usePathname } from 'next/navigation';

interface Book {
  id: string; title: string; slug: string; description: string;
  room_type: string; age_band: string; cover_image: string;
  page_count: number; published: boolean;
}
interface MeData { id: number; username: string; first_name: string; last_name: string; }

const ROOM_LABELS: Record<string, string> = { reading: 'Reading Room', activity: 'Activity Room', hybrid: 'Both Rooms' };
const ROOM_COLORS: Record<string, string> = { reading: 'bg-purple-100 text-[#764f84]', activity: 'bg-amber-100 text-amber-800', hybrid: 'bg-blue-100 text-blue-700' };


export default function LibraryPage() {
  const router = useRouter();
  const pathname = usePathname();
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
    <div className="h-screen w-screen flex items-center justify-center bg-[#faf7f6]">
      <RefreshCw className="w-10 h-10 text-[#764f84] animate-spin" />
    </div>
  );

  return (
    <>
      <Sidebar me={me} currentPath={pathname} />
      <header className="flex justify-between items-center w-full px-8 h-16 ml-64 sticky top-0 z-40 bg-[#faf7f6]/80 backdrop-blur-xl shadow-sm border-b border-[#3d3b62]/10">
        <div className="font-baloo text-xl font-bold text-[#3d3b62]">Library</div>
      </header>
      <main className="ml-64 p-8 min-h-screen bg-[#faf7f6] font-karla text-[#1d1b16]">
        <div className="mb-8">
          <h2 className="font-baloo text-4xl text-[#3d3b62] font-bold mb-2">Book Library</h2>
          <p className="text-stone-500">{books.length} book{books.length !== 1 ? 's' : ''} available</p>
        </div>

        <div className="flex gap-3 mb-8 flex-wrap">
          {[{ val: 'all', label: 'All Books' }, { val: 'reading', label: 'Reading Room' }, { val: 'activity', label: 'Activity Room' }, { val: 'favorites', label: '♥ Favourites' }].map((f) => (
            <button key={f.val} onClick={() => setFilter(f.val)}
              className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${filter === f.val ? 'bg-[#3d3b62] text-white' : 'bg-white text-stone-500 hover:bg-[#eccdca]/30 border border-[#eccdca]'}`}>
              {f.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-24 text-stone-400">
            <BookOpen className="w-12 h-12" />
            <p className="font-medium">No books found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filtered.map((book) => (
              <div key={book.id} className="bg-white rounded-2xl shadow-sm border border-[#eccdca] overflow-hidden hover:shadow-md transition-shadow group">
                <div className="h-48 bg-[#3d3b62]/5 flex items-center justify-center relative overflow-hidden">
                  {book.cover_image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={book.cover_image} alt={book.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  ) : (
                    <BookOpen className="w-14 h-14 text-[#764f84]/30" />
                  )}
                  <button onClick={() => toggleFavorite(book.id)}
                    className="absolute top-3 right-3 h-8 w-8 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center shadow-sm hover:bg-white transition-all">
                    <Heart
                      className="w-4 h-4 transition-colors"
                      fill={favorites.has(book.id) ? '#c84a71' : 'none'}
                      color={favorites.has(book.id) ? '#c84a71' : '#9ca3af'}
                    />
                  </button>
                </div>
                <div className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${ROOM_COLORS[book.room_type] ?? 'bg-stone-100 text-stone-500'}`}>
                      {ROOM_LABELS[book.room_type] ?? book.room_type}
                    </span>
                    <span className="text-[10px] text-stone-400 font-medium">Ages {book.age_band}</span>
                  </div>
                  <h3 className="font-baloo text-lg font-bold text-[#3d3b62] mb-1 leading-tight">{book.title}</h3>
                  {book.description && <p className="text-stone-400 text-xs line-clamp-2 mb-4">{book.description}</p>}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-stone-400">{book.page_count} pages</span>
                    <Link href="/dashboard"
                      className="font-baloo px-4 py-2 bg-[#3d3b62] text-white text-xs font-bold rounded-lg hover:bg-[#764f84] transition-all">
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
