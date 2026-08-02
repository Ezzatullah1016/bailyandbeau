'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

import { useSession } from '@/contexts/SessionContext';
import { getSession } from '@/lib/api';
import { BrandLogo } from '@/components/brand/BrandLogo';

type RoomMode = 'reading' | 'activity';

function roomTypeToMode(rt: string | undefined): RoomMode {
  return rt === 'activity' ? 'activity' : 'reading';
}

// Copy for each room variant. No badges, medals, points, or confetti — a
// mission-focused "end of adventure" moment for Bailey & Beau Co.
const COPY: Record<RoomMode, {
  heading: string;
  tagline: string;
  message: string;
  subtitleIcon: string;
  subtitleLabel: string;
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel: string;
  secondaryHref: string;
}> = {
  reading: {
    heading: 'Another Adventure Shared',
    tagline: 'Read together. Imagine together. Grow together.',
    message:
      "Today you chose to spend time together—and that's something worth celebrating. " +
      'The stories may change, but the memories you create will last a lifetime.',
    subtitleIcon: '📖',
    subtitleLabel: "Today's Story",
    primaryLabel: 'Read Another Story',
    primaryHref: '/dashboard/library',
    secondaryLabel: 'Return to Dashboard',
    secondaryHref: '/dashboard',
  },
  activity: {
    heading: 'Another Adventure Created',
    tagline: 'Create together. Discover together. Grow together.',
    message:
      "Today you explored, imagined, and created something together—and that's something worth celebrating. " +
      'The activity may be finished, but the curiosity and connection you inspired can continue long after today.',
    subtitleIcon: '🎨',
    subtitleLabel: "Today's Activity",
    primaryLabel: 'Choose Another Activity',
    primaryHref: '/dashboard',
    secondaryLabel: 'Return to Dashboard',
    secondaryHref: '/dashboard',
  },
};

function CompletionInner() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { sessionId } = useSession();
  const sid = sessionId ?? id;

  // Param `mode` is authoritative (set at redirect from the room). On a refresh
  // the params are lost, so we fall back to the session's room_type.
  const paramMode = searchParams.get('mode');
  const paramActivity = searchParams.get('activity') ?? '';

  const [mode, setMode] = useState<RoomMode>(
    paramMode === 'activity' || paramMode === 'reading' ? paramMode : 'reading',
  );
  const [bookTitle, setBookTitle] = useState<string>('');
  const [activityTitle, setActivityTitle] = useState<string>('');
  const [showArt, setShowArt] = useState(true);

  useEffect(() => {
    if (!sid) return;
    getSession(sid)
      .then((session) => {
        setBookTitle(session.book_title ?? '');
        // Authoritative activity name recorded at completion — survives refresh.
        setActivityTitle(session.completed_activity_title ?? '');
        // Only let the session decide the mode when no explicit param was given.
        if (paramMode !== 'activity' && paramMode !== 'reading') {
          setMode(roomTypeToMode(session.room_type));
        }
      })
      .catch(() => {});
  }, [sid, paramMode]);

  const copy = COPY[mode];

  // Reading shows the book title. Activity prefers the backend-recorded title
  // (survives refresh), then the live query param, then the book title.
  const subject =
    mode === 'activity'
      ? activityTitle || paramActivity || bookTitle || "Today's Activity"
      : bookTitle || 'Your Story';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#3d3b62] to-[#764f84] font-karla text-[#1d1b16] p-6 overflow-x-hidden relative">
      {/* Soft background texture + glows */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.10) 1px, transparent 1px)', backgroundSize: '26px 26px' }}
      />
      <div className="fixed top-[-12%] left-[-10%] w-[45%] h-[45%] bg-white/5 blur-[130px] rounded-full pointer-events-none" />
      <div className="fixed bottom-[-12%] right-[-10%] w-[45%] h-[45%] bg-white/5 blur-[130px] rounded-full pointer-events-none" />

      {/* Header with brand mark */}
      <header className="fixed top-0 left-0 w-full z-50 flex justify-center items-center px-6 py-6 pointer-events-none">
        <div className="pointer-events-auto">
          <BrandLogo variant="light" className="h-8 w-auto" />
        </div>
      </header>

      <main className="relative z-10 w-full max-w-[600px] flex flex-col items-center text-center pt-20 pb-12">
        {/* End-of-adventure illustration */}
        {showArt && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/completion-illustration.png"
            alt=""
            onError={() => setShowArt(false)}
            className="w-[300px] max-w-[70%] h-auto mb-8 drop-shadow-[0_20px_40px_rgba(0,0,0,0.25)] select-none"
          />
        )}

        <h1 className="font-baloo text-4xl sm:text-5xl text-white font-bold tracking-tight mb-3">
          {copy.heading}
        </h1>
        <p className="font-baloo text-[#f0c75e] text-lg sm:text-xl font-semibold mb-8">
          {copy.tagline}
        </p>

        <div className="w-full bg-white rounded-[2rem] px-8 sm:px-10 py-10 shadow-[0_32px_64px_-12px_rgba(61,59,98,0.35)] mb-10">
          <p className="font-karla text-stone-600 text-base sm:text-lg leading-relaxed max-w-[440px] mx-auto mb-8">
            {copy.message}
          </p>

          <div className="w-full h-px bg-[#eccdca]/70 mb-8" />

          <span className="font-karla text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#764f84] flex items-center justify-center gap-2 mb-2">
            <span aria-hidden>{copy.subtitleIcon}</span>
            {copy.subtitleLabel}
          </span>
          <p className="font-baloo text-2xl text-[#3d3b62] font-bold">{subject}</p>
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full">
          <button
            onClick={() => router.push(copy.primaryHref)}
            className="font-baloo w-full sm:flex-1 bg-gradient-to-br from-[#f0c75e] to-[#c84a71] text-white font-bold py-4 px-8 rounded-xl shadow-lg hover:brightness-105 active:scale-95 transition-all text-sm uppercase tracking-widest"
          >
            {copy.primaryLabel}
          </button>
          <button
            onClick={() => router.push(copy.secondaryHref)}
            className="font-baloo w-full sm:flex-1 border-2 border-white/40 text-white font-bold py-4 px-8 rounded-xl hover:bg-white/10 active:scale-95 transition-all text-sm uppercase tracking-widest"
          >
            {copy.secondaryLabel}
          </button>
        </div>
      </main>
    </div>
  );
}

export default function SessionCompletePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gradient-to-br from-[#3d3b62] to-[#764f84]" />}>
      <CompletionInner />
    </Suspense>
  );
}
