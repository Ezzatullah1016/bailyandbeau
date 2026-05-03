'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { BookOpen, Clock, FileText, Zap, Mail, Link, X } from 'lucide-react';

import { useSession } from '@/contexts/SessionContext';
import { getSession, apiRequest } from '@/lib/api';

interface BadgeData {
  id: string;
  name: string;
  description: string;
  icon: string;
  session?: { id: string };
}

interface CompletionData {
  bookTitle: string;
  duration: number;
  pagesRead: number;
  activitiesDone: number;
  badge: BadgeData | null;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  return m > 0 ? `${m} min${m !== 1 ? 's' : ''}` : `${seconds}s`;
}

export default function SessionCompletePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { sessionId } = useSession();
  const sid = sessionId ?? id;

  const [data, setData] = useState<CompletionData>({
    bookTitle: 'Your Book',
    duration: 1200,
    pagesRead: 0,
    activitiesDone: 0,
    badge: null,
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!sid) return;

    getSession(sid)
      .then((session) => {
        setData((prev) => ({
          ...prev,
          bookTitle: (session as any).book_title ?? 'Your Book',
          duration: (session as any).duration_seconds ?? 1200,
        }));
      })
      .catch(() => {});

    apiRequest<{ data: BadgeData[] }>('/me/badges/')
      .then((res) => {
        const latest = res.data?.[0] ?? null;
        if (latest) setData((prev) => ({ ...prev, badge: latest }));
      })
      .catch(() => {});
  }, [sid]);

  const handleShare = async () => {
    const text = `🎉 We just finished reading "${data.bookTitle}" together on Bailey & Beau!`;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ text }); } catch { /* cancelled */ }
    } else {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleEmail = () => {
    const subject = encodeURIComponent('We read together on Bailey & Beau!');
    const body = encodeURIComponent(`We just finished reading "${data.bookTitle}" together. 🎉`);
    window.open(`mailto:?subject=${subject}&body=${body}`);
  };

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(window.location.origin + '/dashboard');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#3d3b62] to-[#764f84] font-karla text-[#1d1b16] p-6 overflow-x-hidden relative">
      {/* Background decoration */}
      <div className="fixed inset-0 pointer-events-none"
        style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.12) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
      <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-white/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-white/5 blur-[120px] rounded-full pointer-events-none" />

      {/* Top bar */}
      <header className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-6 py-5 pointer-events-none">
        <div className="font-baloo text-2xl font-bold text-white pointer-events-auto">Bailey &amp; Beau</div>
        <button
          onClick={() => router.push('/dashboard')}
          aria-label="Close"
          className="w-10 h-10 flex items-center justify-center text-white/70 hover:text-white pointer-events-auto transition-colors"
        >
          <X className="w-6 h-6" />
        </button>
      </header>

      {/* Main content */}
      <main className="relative z-10 w-full max-w-[560px] flex flex-col items-center text-center pt-16">
        {/* Celebration header */}
        <div className="mb-8 flex flex-col items-center">
          <span role="img" aria-label="Party Popper" className="text-[72px] leading-none mb-4">🎉</span>
          <h1 className="font-baloo text-5xl text-white font-bold tracking-tight mb-3">Amazing Session!</h1>
          <p className="font-karla text-white/90 text-lg font-light max-w-[400px]">
            You read together for {formatDuration(data.duration)} and completed all the activities.
          </p>
        </div>

        {/* Badge card */}
        <div className="w-full bg-white rounded-[2rem] p-10 shadow-[0_32px_64px_-12px_rgba(61,59,98,0.3)] mb-8">
          <div className="flex flex-col items-center">
            <span className="font-karla text-xs font-extrabold uppercase tracking-[0.2em] text-[#764f84] mb-8">
              {data.badge ? 'New Badge Earned' : 'Session Complete'}
            </span>

            {/* Badge icon */}
            <div className="relative flex items-center justify-center mb-7">
              <div className="absolute w-[200px] h-[200px] border border-[#eccdca]/30 rounded-full" />
              <div className="absolute w-[160px] h-[160px] border border-[#eccdca]/60 rounded-full" />
              <div className="w-[120px] h-[120px] bg-[#f0c75e] rounded-full flex items-center justify-center shadow-lg">
                <span className="text-5xl">{data.badge?.icon ?? '⭐'}</span>
              </div>
            </div>

            <h2 className="font-baloo text-[30px] text-[#3d3b62] font-bold mb-2">
              {data.badge?.name ?? 'Star Reader'}
            </h2>
            <p className="font-karla text-stone-500 text-base mb-7">
              {data.badge?.description ?? 'Awarded for completing a reading session.'}
            </p>

            <div className="w-full h-px bg-[#eccdca]/60 mb-7" />

            {/* Summary grid */}
            <div className="grid grid-cols-2 gap-y-5 gap-x-4 w-full text-left">
              <div className="flex items-start gap-3">
                <BookOpen className="w-5 h-5 text-[#3d3b62] mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-karla text-[10px] font-bold text-stone-400 uppercase tracking-wider block">Book</span>
                  <span className="font-karla text-sm font-semibold text-[#3d3b62]">{data.bookTitle}</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-[#3d3b62] mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-karla text-[10px] font-bold text-stone-400 uppercase tracking-wider block">Duration</span>
                  <span className="font-karla text-sm font-semibold text-[#3d3b62]">{formatDuration(data.duration)}</span>
                </div>
              </div>
              {data.pagesRead > 0 && (
                <div className="flex items-start gap-3">
                  <FileText className="w-5 h-5 text-[#3d3b62] mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-karla text-[10px] font-bold text-stone-400 uppercase tracking-wider block">Pages Read</span>
                    <span className="font-karla text-sm font-semibold text-[#3d3b62]">{data.pagesRead}</span>
                  </div>
                </div>
              )}
              {data.activitiesDone > 0 && (
                <div className="flex items-start gap-3">
                  <Zap className="w-5 h-5 text-[#3d3b62] mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-karla text-[10px] font-bold text-stone-400 uppercase tracking-wider block">Activities</span>
                    <span className="font-karla text-sm font-semibold text-[#3d3b62]">{data.activitiesDone} completed</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* CTA buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full mb-10">
          <button
            onClick={() => router.push('/dashboard/library')}
            className="font-baloo w-full sm:flex-1 bg-gradient-to-br from-[#f0c75e] to-[#c84a71] text-white font-bold py-4 px-8 rounded-xl shadow-lg hover:brightness-105 active:scale-95 transition-all text-sm uppercase tracking-widest"
          >
            Read Another Book
          </button>
          <button
            onClick={() => router.push('/dashboard')}
            className="font-baloo w-full sm:flex-1 border-2 border-white/30 text-white font-bold py-4 px-8 rounded-xl hover:bg-white/10 active:scale-95 transition-all text-sm uppercase tracking-widest"
          >
            Go to Dashboard
          </button>
        </div>

        {/* Share row */}
        <div className="flex flex-col items-center gap-4 pb-10">
          <span className="font-karla text-white/60 text-xs font-medium uppercase tracking-[0.1em]">Share this achievement:</span>
          <div className="flex gap-4">
            <button
              onClick={handleShare}
              aria-label="Share via WhatsApp or native share"
              className="w-12 h-12 flex items-center justify-center rounded-full border border-white/20 text-white hover:bg-white/10 transition-colors"
            >
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M12.012 2c-5.508 0-9.987 4.479-9.987 9.987 0 1.763.462 3.426 1.262 4.876l-1.341 4.89 5.004-1.314c1.406.766 3.013 1.204 4.719 1.204 5.507 0 9.988-4.479 9.988-9.987 0-5.508-4.481-9.987-9.988-9.987zm6.37 14.5c-.267.753-1.332 1.378-1.854 1.458-.466.071-1.072.128-1.725-.084-2.614-.85-4.298-3.491-4.428-3.664-.131-.173-1.066-1.421-1.066-2.709s.672-1.921.91-2.184c.241-.262.525-.328.7-.328.175 0 .35 0 .504.009.16.008.374-.061.583.447.214.521.733 1.789.797 1.921.064.13.107.284.02.457-.086.173-.131.282-.261.433-.129.151-.274.337-.392.454-.131.13-.267.271-.115.534.151.262.673 1.112 1.445 1.801.996.888 1.838 1.163 2.099 1.294.262.131.415.11.568-.066.154-.176.657-.766.833-1.028.175-.262.35-.219.591-.131s1.531.722 1.794.853c.262.131.437.197.502.307.066.11.066.634-.201 1.387z" />
              </svg>
            </button>
            <button
              onClick={handleEmail}
              aria-label="Share via email"
              className="w-12 h-12 flex items-center justify-center rounded-full border border-white/20 text-white hover:bg-white/10 transition-colors"
            >
              <Mail className="w-5 h-5" />
            </button>
            <button
              onClick={handleCopyLink}
              aria-label={copied ? 'Copied!' : 'Copy link'}
              className="w-12 h-12 flex items-center justify-center rounded-full border border-white/20 text-white hover:bg-white/10 transition-colors relative"
            >
              <Link className="w-5 h-5" />
              {copied && (
                <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded whitespace-nowrap">
                  Copied!
                </span>
              )}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
