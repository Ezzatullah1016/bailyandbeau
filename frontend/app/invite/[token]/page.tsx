'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { BookOpen, Sparkles } from 'lucide-react';
import { joinViaInvite } from '@/lib/api';
import { useSession } from '@/contexts/SessionContext';

export default function InviteJoinPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { setSession } = useSession();

  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleJoin() {
    if (!displayName.trim()) {
      setError('Please enter your name to continue.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await joinViaInvite(token, displayName.trim());
      localStorage.setItem(`bb_participant_${data.session_id}`, data.participant.id);
      setSession({
        sessionId: data.session_id,
        token: data.realtime_token,
        role: 'guest',
        roomName: data.room_name,
        livekitUrl: data.livekit_url,
        participantId: data.participant.id,
      });
      router.push(`/session/${data.session_id}/reading-room`);
    } catch (e) {
      setError(
        e instanceof Error && e.message.includes('invite_expired')
          ? 'This invite link has expired or already been used.'
          : 'Could not join the session. Please check the link and try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className="flex h-screen w-full overflow-hidden antialiased"
      style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", background: '#fff9ee', color: '#1d1b16' }}
    >
      {/* ── LEFT: join form ────────────────────────────────────────────── */}
      <section className="w-1/2 bg-white p-12 flex flex-col justify-between overflow-y-auto">
        <div>
          <div className="mb-12">
            <span
              className="text-2xl font-bold text-[#2d5016] italic tracking-tight"
              style={{ fontFamily: "'Newsreader', serif" }}
            >
              Bailey &amp; Beau
            </span>
          </div>

          <div className="max-w-md mx-auto space-y-8">
            <h2
              className="text-4xl font-bold text-[#173901] tracking-tight"
              style={{ fontFamily: "'Newsreader', serif" }}
            >
              You&apos;ve been invited to read together!
            </h2>

            <div className="bg-[#f3ede3] rounded-xl p-6">
              <div className="flex items-center gap-2 mb-2">
                <BookOpen className="w-5 h-5 text-[#835500]" />
                <span className="text-sm font-semibold text-[#835500]">Reading Session</span>
              </div>
              <p className="text-sm text-[#43493d]">
                Someone has invited you to join a live reading session. No account needed — just
                enter your name and join!
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold uppercase tracking-wider text-[#43493d]">
                Your name
              </label>
              <input
                className="w-full px-4 py-3 rounded-xl border border-[#c3c9b9] bg-white text-[#1d1b16] text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5016]"
                placeholder="e.g. Grandma Rose"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                autoFocus
              />
            </div>

            {error && <p className="text-sm text-[#ba1a1a] font-medium">{error}</p>}

            <button
              onClick={handleJoin}
              disabled={loading}
              className="w-full py-4 bg-[#173901] text-white rounded-lg font-bold text-lg transition-all hover:scale-[1.01] active:scale-95 shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? 'Joining…' : 'Join the Session'}
            </button>

            <p className="text-center text-xs text-[#43493d]/60 italic">
              No account required. This link is single-use.
            </p>
          </div>
        </div>

        <div className="text-[10px] text-[#43493d]/40 flex justify-center gap-4 mt-8">
          <span>© 2025 Bailey &amp; Beau</span>
          <span>Privacy Policy</span>
          <span>Help Center</span>
        </div>
      </section>

      {/* ── RIGHT: decorative ──────────────────────────────────────────── */}
      <section className="w-1/2 bg-[#2d5016] p-12 relative flex items-center justify-center overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#173901] blur-[120px] rounded-full -mr-32 -mt-32" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-[#835500] blur-[120px] opacity-20 rounded-full -ml-32 -mb-32" />

        <div className="relative z-10 w-full max-w-sm flex flex-col items-center text-center">
          <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center mb-8">
            <BookOpen className="w-10 h-10 text-white" />
          </div>
          <h3
            className="text-3xl font-bold text-white mb-4"
            style={{ fontFamily: "'Newsreader', serif" }}
          >
            Read Together, Anywhere
          </h3>
          <p className="text-white/70 leading-relaxed max-w-xs">
            Connect with family and friends for a shared live reading experience.
          </p>

          <div className="w-full h-px bg-white/20 my-8" />

          <div className="flex flex-col items-center gap-4">
            <div className="w-4 h-4 bg-[#feae2c] rounded-full pulse-amber" />
            <span className="text-white font-medium tracking-wide text-sm">
              Waiting for you to join…
            </span>
          </div>
        </div>

        <div className="absolute bottom-0 right-0 p-8 opacity-5 select-none pointer-events-none">
          <Sparkles className="w-40 h-40 text-white" />
        </div>
      </section>
    </main>
  );
}
