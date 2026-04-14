'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  LiveKitRoom,
  VideoTrack,
  useLocalParticipant,
  useRoomContext,
  useTracks,
  useParticipants,
} from '@livekit/components-react';
import { ConnectionState, Track } from 'livekit-client';
import { useSession } from '@/contexts/SessionContext';
import {
  completeSession,
  getBookPages,
  getGuestToken,
  getSession,
  getSnapshot,
  getUserBadges,
  updateSnapshot,
  type BookPageData,
  type UserBadgeData,
} from '@/lib/api';
import { AnnotationToolbar, type AnnotationTool } from '@/components/annotation/AnnotationToolbar';
import type { AnnotationCanvasHandle } from '@/components/annotation/AnnotationCanvas';

// Dynamic import for Fabric canvas (SSR-unsafe)
const AnnotationCanvas = dynamic(
  () => import('@/components/annotation/AnnotationCanvas'),
  { ssr: false },
);

// ─── Sync message format ──────────────────────────────────────────────────────

interface SyncMessage {
  type: string;
  payload: Record<string, unknown>;
  ts: string;
}

function buildMsg(type: string, payload: Record<string, unknown>): Uint8Array {
  const json = JSON.stringify({ type, payload, ts: new Date().toISOString() } satisfies SyncMessage);
  return new TextEncoder().encode(json);
}

// ─── Timer helpers ────────────────────────────────────────────────────────────

const SESSION_DURATION_S = 20 * 60; // 20 minutes

function fmtTime(secs: number) {
  const m = Math.floor(Math.max(0, secs) / 60);
  const s = Math.max(0, secs) % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── Connection banner ────────────────────────────────────────────────────────

function ConnectionBanner() {
  const room = useRoomContext();
  const [state, setState] = useState<ConnectionState>(ConnectionState.Disconnected);

  useEffect(() => {
    setState(room.state);
    const h = () => setState(room.state);
    room.on('connectionStateChanged', h);
    return () => { room.off('connectionStateChanged', h); };
  }, [room]);

  if (state === ConnectionState.Connected) return null;

  const map: Record<string, { bg: string; text: string; icon: string; label: string }> = {
    [ConnectionState.Connecting]:   { bg: 'bg-amber-900/80 border-amber-600/30', text: 'text-amber-200', icon: 'sync',               label: 'Connecting…' },
    [ConnectionState.Reconnecting]: { bg: 'bg-amber-900/80 border-amber-600/30', text: 'text-amber-200', icon: 'sync_problem',        label: 'Reconnecting…' },
    [ConnectionState.Disconnected]: { bg: 'bg-red-900/80 border-red-600/30',     text: 'text-red-200',   icon: 'signal_disconnected', label: 'Disconnected — trying to rejoin' },
  };
  const s = map[state] ?? map[ConnectionState.Disconnected];

  return (
    <div className={`mx-auto mt-4 w-[90%] max-w-4xl px-6 py-2.5 rounded-xl flex items-center justify-center gap-3 border animate-pulse ${s.bg}`}>
      <span className={`material-symbols-outlined text-lg ${s.text}`}>{s.icon}</span>
      <span className={`text-sm font-medium tracking-tight ${s.text}`}>{s.label}</span>
    </div>
  );
}

// ─── Participant tile ─────────────────────────────────────────────────────────

function ParticipantTile({ identity, label, isHost }: { identity: string; label: string; isHost: boolean }) {
  const tracks = useTracks([Track.Source.Camera]);
  const track = tracks.find((t) => t.participant.identity === identity);

  return (
    <div className="relative group aspect-video bg-stone-950 rounded-xl overflow-hidden ring-1 ring-white/10">
      {track ? (
        <VideoTrack trackRef={track} className="w-full h-full object-cover opacity-80" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <span className="material-symbols-outlined text-stone-600 text-4xl">person</span>
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
        <span className="px-2 py-0.5 bg-stone-900/80 backdrop-blur-md rounded-md text-[10px] font-bold text-white">
          {label}
        </span>
        {isHost && (
          <span className="px-1.5 py-0.5 bg-[#3c4b30] text-[#a9bb99] rounded-md text-[9px] font-bold uppercase">
            Host
          </span>
        )}
      </div>
    </div>
  );
}

function ParticipantList({ hostIdentity }: { hostIdentity?: string }) {
  const participants = useParticipants();
  return (
    <div className="space-y-3">
      {participants.map((p) => (
        <ParticipantTile
          key={p.identity}
          identity={p.identity}
          label={p.name || p.identity}
          isHost={p.identity === hostIdentity}
        />
      ))}
    </div>
  );
}

// ─── Local controls ───────────────────────────────────────────────────────────

function LocalControls() {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
        className={`w-10 h-10 flex items-center justify-center rounded-xl transition-colors ${isMicrophoneEnabled ? 'bg-stone-800/50 text-stone-300 hover:bg-stone-700/50' : 'bg-red-900/50 text-red-300 hover:bg-red-800/50'}`}
        title={isMicrophoneEnabled ? 'Mute' : 'Unmute'}
      >
        <span className="material-symbols-outlined text-sm">{isMicrophoneEnabled ? 'mic' : 'mic_off'}</span>
      </button>
      <button
        onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled)}
        className={`w-10 h-10 flex items-center justify-center rounded-xl transition-colors ${isCameraEnabled ? 'bg-stone-800/50 text-stone-300 hover:bg-stone-700/50' : 'bg-red-900/50 text-red-300 hover:bg-red-800/50'}`}
        title={isCameraEnabled ? 'Stop camera' : 'Start camera'}
      >
        <span className="material-symbols-outlined text-sm">{isCameraEnabled ? 'videocam' : 'videocam_off'}</span>
      </button>
    </div>
  );
}

// ─── Book page ────────────────────────────────────────────────────────────────

function BookPageImage({ url, pageNumber }: { url: string; pageNumber: number }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative w-full h-full flex items-center justify-center bg-white">
      {!loaded && (
        <span className="absolute material-symbols-outlined text-stone-300 text-5xl animate-pulse">hourglass_top</span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={url}
        src={url}
        alt={`Page ${pageNumber}`}
        className={`max-w-full max-h-full object-contain transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    </div>
  );
}

// ─── Session-complete overlay (from Session-Completion.html) ──────────────────

function CompletionOverlay({
  bookTitle,
  pagesRead,
  pageCount,
  durationSecs,
  badges,
  onDashboard,
}: {
  bookTitle: string;
  pagesRead: number;
  pageCount: number;
  durationSecs: number;
  badges: UserBadgeData[];
  onDashboard: () => void;
}) {
  const mins = Math.round(durationSecs / 60);
  const badge = badges[0] ?? null;

  return (
    <div className="fixed inset-0 z-[200] bg-[#2d5016] flex items-center justify-center p-6 overflow-y-auto">
      {/* Background decoration */}
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.15) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
      <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#173901] opacity-20 blur-[120px] rounded-full pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[#835500] opacity-20 blur-[120px] rounded-full pointer-events-none" />

      {/* Header */}
      <header className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-6 py-6 pointer-events-none">
        <div className="text-2xl font-bold text-white italic font-headline pointer-events-auto">
          Bailey &amp; Beau
        </div>
        <button onClick={onDashboard} className="w-10 h-10 flex items-center justify-center text-white/80 hover:text-white pointer-events-auto transition-colors">
          <span className="material-symbols-outlined text-3xl">close</span>
        </button>
      </header>

      <main className="relative z-10 w-full max-w-[560px] flex flex-col items-center text-center mt-20">
        {/* Celebration */}
        <div className="mb-8 flex flex-col items-center">
          <span className="text-[72px] leading-none mb-4" role="img" aria-label="Party Popper">🎉</span>
          <h1 className="font-headline text-5xl text-white italic tracking-tight mb-3">Amazing Session!</h1>
          <p className="text-white/90 text-lg font-light max-w-[400px]">
            You read together for {mins} {mins === 1 ? 'minute' : 'minutes'}.
          </p>
        </div>

        {/* Badge reveal */}
        <div className="w-full bg-white rounded-[2rem] p-10 shadow-[0_32px_64px_-12px_rgba(23,57,1,0.3)] mb-8">
          <div className="flex flex-col items-center">
            <span className="text-xs font-extrabold uppercase tracking-[0.2em] text-[#835500] mb-10">
              {badge ? 'NEW BADGE EARNED' : 'SESSION COMPLETE'}
            </span>

            {badge ? (
              <>
                <div className="relative flex items-center justify-center mb-8">
                  <div className="absolute w-[200px] h-[200px] border border-[#835500]/10 rounded-full" />
                  <div className="absolute w-[160px] h-[160px] border border-[#835500]/30 rounded-full" />
                  <div className="relative w-[120px] h-[120px] bg-[#feae2c] rounded-full flex items-center justify-center shadow-lg">
                    <span className="material-symbols-outlined text-white text-5xl" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                  </div>
                </div>
                <h2 className="font-headline text-[32px] text-[#173901] italic mb-2">{badge.badge_name}</h2>
                <p className="text-[#43493d] text-base mb-8">{badge.badge_description}</p>
              </>
            ) : (
              <div className="flex items-center justify-center w-[120px] h-[120px] rounded-full bg-[#f3ede3] mb-8">
                <span className="material-symbols-outlined text-[#2d5016] text-5xl" style={{ fontVariationSettings: "'FILL' 1" }}>menu_book</span>
              </div>
            )}

            <div className="w-full h-px bg-[#c3c9b9]/20 mb-8" />

            {/* Session summary grid */}
            <div className="grid grid-cols-2 gap-y-6 gap-x-4 w-full text-left">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[#173901] text-xl">auto_stories</span>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-[#43493d] uppercase tracking-wider">Book</span>
                  <span className="text-sm font-semibold text-[#173901]">{bookTitle}</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[#173901] text-xl">schedule</span>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-[#43493d] uppercase tracking-wider">Duration</span>
                  <span className="text-sm font-semibold text-[#173901]">{mins} minutes</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[#173901] text-xl">description</span>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-[#43493d] uppercase tracking-wider">Pages Read</span>
                  <span className="text-sm font-semibold text-[#173901]">{pagesRead} of {pageCount}</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[#173901] text-xl">emoji_events</span>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-[#43493d] uppercase tracking-wider">Badges</span>
                  <span className="text-sm font-semibold text-[#173901]">{badges.length} earned</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full mb-10">
          <button
            onClick={onDashboard}
            className="w-full sm:flex-1 bg-gradient-to-br from-[#feae2c] to-[#835500] text-[#6b4500] font-bold py-4 px-8 rounded-xl shadow-lg hover:brightness-105 active:scale-95 transition-all text-sm uppercase tracking-widest"
          >
            Go to Dashboard
          </button>
        </div>
      </main>
    </div>
  );
}

// ─── Timer warning banner ─────────────────────────────────────────────────────

function TimerWarning({ remaining }: { remaining: number }) {
  if (remaining > 5 * 60) return null;
  const is2min = remaining <= 2 * 60;
  return (
    <div className={`mx-auto mt-4 w-[90%] max-w-4xl px-6 py-2.5 rounded-xl flex items-center justify-center gap-3 border animate-pulse ${is2min ? 'bg-red-900/70 border-red-600/30' : 'bg-[#644000] border-[#ffb955]/20'}`}>
      <span className="material-symbols-outlined text-lg text-[#ffb955]">alarm_on</span>
      <span className="text-sm font-medium tracking-tight text-[#ffb955]">
        {is2min ? '2 minutes remaining — finishing up!' : '5 minutes remaining — time to wrap up!'}
      </span>
    </div>
  );
}

// ─── Room content ─────────────────────────────────────────────────────────────

function RoomContent({
  role,
  sessionId,
  participantId,
  bookId,
  bookTitle,
  onEnd,
}: {
  role: 'host' | 'guest';
  sessionId: string;
  participantId: string;
  bookId: string;
  bookTitle: string;
  onEnd: () => void;
}) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();

  // ── Pages ─────────────────────────────────────────────────────────────────
  const [pages, setPages] = useState<BookPageData[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [loadingPages, setLoadingPages] = useState(true);
  const [activeTab, setActiveTab] = useState<'video' | 'tools' | 'participants' | 'chat' | 'settings'>('video');

  // ── Timer ─────────────────────────────────────────────────────────────────
  const [timerActive, setTimerActive] = useState(false);
  const [remaining, setRemaining] = useState(SESSION_DURATION_S);
  const timerStartedAtRef = useRef<number | null>(null); // epoch ms when TIMER_START received

  // ── Annotation ────────────────────────────────────────────────────────────
  const [annTool, setAnnTool] = useState<AnnotationTool>('pen');
  const [annColor, setAnnColor] = useState('#ef4444');
  const [annBrush, setAnnBrush] = useState(8);
  const canvasRef = useRef<AnnotationCanvasHandle>(null);

  // ── Completion ────────────────────────────────────────────────────────────
  const [showComplete, setShowComplete] = useState(false);
  const [badges, setBadges] = useState<UserBadgeData[]>([]);
  const [sessionDurationSecs, setSessionDurationSecs] = useState(0);

  const decoder = useRef(new TextDecoder()).current;

  // ── Fetch pages ───────────────────────────────────────────────────────────
  useEffect(() => {
    const guestPid = role === 'guest' ? participantId : undefined;
    getBookPages(bookId, guestPid)
      .then(setPages)
      .catch(() => {})
      .finally(() => setLoadingPages(false));
  }, [bookId, participantId, role]);

  // ── Restore snapshot ──────────────────────────────────────────────────────
  useEffect(() => {
    getSnapshot(sessionId, participantId)
      .then((snap) => {
        if (snap && typeof snap.page_number === 'number' && snap.page_number > 0) {
          setCurrentPage(snap.page_number - 1);
        }
        if (snap?.timer_state && typeof (snap.timer_state as Record<string,unknown>).remaining_seconds === 'number') {
          const rem = (snap.timer_state as Record<string,unknown>).remaining_seconds as number;
          if (rem > 0 && rem < SESSION_DURATION_S) {
            setRemaining(rem);
            setTimerActive(true);
            timerStartedAtRef.current = Date.now() - (SESSION_DURATION_S - rem) * 1000;
          }
        }
      })
      .catch(() => {});
  }, [sessionId, participantId]);

  // ── Timer countdown ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!timerActive) return;
    const interval = setInterval(() => {
      if (timerStartedAtRef.current === null) return;
      const elapsed = Math.floor((Date.now() - timerStartedAtRef.current) / 1000);
      const rem = Math.max(0, SESSION_DURATION_S - elapsed);
      setRemaining(rem);
      if (rem === 0) {
        clearInterval(interval);
        // Auto-complete when timer hits 0 (host only)
        if (role === 'host') {
          handleEndSession(true);
        }
      }
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerActive, role]);

  // ── Data channel listener ─────────────────────────────────────────────────
  useEffect(() => {
    function onData(payload: Uint8Array) {
      let msg: SyncMessage;
      try { msg = JSON.parse(decoder.decode(payload)) as SyncMessage; } catch { return; }

      switch (msg.type) {
        case 'PAGE_TURN':
          if (role === 'guest' && typeof msg.payload.page === 'number') {
            setCurrentPage(msg.payload.page);
          }
          break;

        case 'CANVAS_SYNC':
          if (typeof msg.payload.json === 'string') {
            canvasRef.current?.loadRemoteJSON(msg.payload.json);
          }
          break;

        case 'CANVAS_CLEAR':
          canvasRef.current?.clearCanvas(false);
          break;

        case 'TIMER_START': {
          const ts = msg.payload.started_at as number ?? Date.now();
          timerStartedAtRef.current = ts;
          setTimerActive(true);
          setRemaining(SESSION_DURATION_S);
          break;
        }

        case 'SESSION_COMPLETE':
          if (role === 'guest') {
            fetchBadgesAndShow(
              typeof msg.payload.duration === 'number' ? msg.payload.duration : 0,
            );
          }
          break;
      }
    }
    room.on('dataReceived', onData);
    return () => { room.off('dataReceived', onData); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, role]);

  // ── Broadcast page turn ───────────────────────────────────────────────────
  const broadcastPageTurn = useCallback(
    async (index: number) => {
      if (role !== 'host') return;
      room.localParticipant.publishData(buildMsg('PAGE_TURN', { page: index }), { reliable: true });
      try { await localParticipant.setMetadata(JSON.stringify({ page: index, role: 'host' })); } catch { /* ok */ }
      updateSnapshot(sessionId, participantId, index + 1).catch(() => {});
    },
    [role, room, localParticipant, sessionId, participantId],
  );

  const goToPage = useCallback(
    (index: number) => {
      if (role !== 'host') return;
      const clamped = Math.max(0, Math.min(index, pages.length - 1));
      setCurrentPage(clamped);
      broadcastPageTurn(clamped);
      // Clear canvas on page turn
      canvasRef.current?.clearCanvas(false);
      room.localParticipant.publishData(buildMsg('CANVAS_CLEAR', {}), { reliable: true });
    },
    [role, pages.length, broadcastPageTurn, room],
  );

  // ── Annotation sync callback ──────────────────────────────────────────────
  const handleCanvasSync = useCallback(
    (json: string) => {
      room.localParticipant.publishData(
        buildMsg('CANVAS_SYNC', { json }),
        { reliable: false },
      );
    },
    [room],
  );

  const handleClearCanvas = useCallback(() => {
    canvasRef.current?.clearCanvas(true);
    room.localParticipant.publishData(buildMsg('CANVAS_CLEAR', {}), { reliable: true });
  }, [room]);

  // ── Host: start timer ─────────────────────────────────────────────────────
  const handleStartTimer = useCallback(() => {
    if (role !== 'host' || timerActive) return;
    const now = Date.now();
    timerStartedAtRef.current = now;
    setTimerActive(true);
    setRemaining(SESSION_DURATION_S);
    room.localParticipant.publishData(
      buildMsg('TIMER_START', { started_at: now }),
      { reliable: true },
    );
  }, [role, timerActive, room]);

  // ── End / complete session ────────────────────────────────────────────────
  async function fetchBadgesAndShow(durationSecs: number) {
    setSessionDurationSecs(durationSecs);
    try {
      const earned = await getUserBadges();
      setBadges(earned);
    } catch { /* ok */ }
    setShowComplete(true);
  }

  async function handleEndSession(fromTimer = false) {
    if (role === 'host') {
      const elapsed = timerStartedAtRef.current
        ? Math.floor((Date.now() - timerStartedAtRef.current) / 1000)
        : 0;
      // Broadcast to guests
      room.localParticipant.publishData(
        buildMsg('SESSION_COMPLETE', { duration: elapsed }),
        { reliable: true },
      );
      try { await completeSession(sessionId, participantId); } catch { /* ok */ }
      await fetchBadgesAndShow(elapsed);
    } else {
      room.disconnect();
      onEnd();
    }
  }

  const handleDashboard = () => {
    room.disconnect();
    onEnd();
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const pageCount = pages.length || 1;
  const currentPageData = pages[currentPage] ?? null;
  const progressPct = ((currentPage + 1) / pageCount) * 100;

  const tabs = [
    { id: 'video',        icon: 'videocam',    label: 'Video' },
    { id: 'tools',        icon: 'draw',        label: 'Tools' },
    { id: 'participants', icon: 'group',        label: 'Participants' },
    { id: 'chat',         icon: 'chat_bubble', label: 'Chat' },
    { id: 'settings',     icon: 'tune',        label: 'Settings' },
  ] as const;

  // Host identity: the local participant is host when role === 'host'
  const hostIdentity = role === 'host' ? room.localParticipant.identity : undefined;

  return (
    <>
      {showComplete && (
        <CompletionOverlay
          bookTitle={bookTitle}
          pagesRead={currentPage + 1}
          pageCount={pageCount}
          durationSecs={sessionDurationSecs}
          badges={badges}
          onDashboard={handleDashboard}
        />
      )}

      <div className="h-screen w-screen flex flex-col bg-[#131313] text-[#e5e2e1] overflow-hidden">

        {/* ── Top nav ──────────────────────────────────────────────────────── */}
        <header className="fixed top-0 w-full z-50 flex justify-between items-center px-6 h-14 bg-stone-950/60 backdrop-blur-xl shadow-2xl shadow-stone-950/50">
          <div className="flex items-center gap-6">
            <span className="text-2xl font-headline italic text-lime-200">Bailey &amp; Beau</span>
            <div className="h-6 w-[1px] bg-white/10" />
            <h1 className="font-headline text-xl tracking-tight text-[#e5e2e1] max-w-[280px] truncate">{bookTitle}</h1>
          </div>
          <div className="flex items-center gap-4">
            {/* Timer display */}
            <div
              className={`flex items-center gap-2 px-3 py-1 rounded-full border transition-all ${remaining <= 2 * 60 ? 'bg-red-900/60 border-red-600/30' : 'bg-[#644000]/40 border-[#ffb955]/20'}`}
              title={role === 'host' && !timerActive ? 'Click to start timer' : undefined}
              onClick={role === 'host' && !timerActive ? handleStartTimer : undefined}
              style={role === 'host' && !timerActive ? { cursor: 'pointer' } : undefined}
            >
              <span className="material-symbols-outlined text-[#ffb955] text-sm">timer</span>
              <span className="text-[#ffb955] font-bold tracking-widest text-sm">{fmtTime(remaining)}</span>
              {role === 'host' && !timerActive && (
                <span className="text-[#ffb955]/60 text-[10px] ml-1">tap to start</span>
              )}
            </div>

            <span className={`px-3 py-0.5 text-xs font-bold rounded-full uppercase tracking-tighter ${role === 'host' ? 'bg-[#3c4b30] text-[#a9bb99]' : 'bg-stone-800 text-stone-300'}`}>
              {role}
            </span>

            <div className="flex items-center gap-2 ml-4">
              <button className="material-symbols-outlined text-stone-400 hover:text-stone-100 transition-colors">settings</button>
              {role === 'host' ? (
                <button
                  onClick={() => handleEndSession(false)}
                  className="bg-[#93000a] hover:bg-[#93000a]/80 text-[#ffdad6] px-4 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95"
                >
                  End Session
                </button>
              ) : (
                <button
                  onClick={() => handleEndSession(false)}
                  className="bg-stone-800 hover:bg-stone-700 text-stone-200 px-4 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95"
                >
                  Leave
                </button>
              )}
            </div>
          </div>
        </header>

        <main className="flex flex-1 pt-14 h-full overflow-hidden">

          {/* ── Left sidebar ────────────────────────────────────────────────── */}
          <aside className="fixed left-0 top-0 h-full z-40 flex flex-col p-4 pt-20 bg-stone-900/80 backdrop-blur-2xl w-72 rounded-r-2xl shadow-[10px_0_30px_-15px_rgba(0,0,0,0.5)]">
            <div className="mb-6">
              <h3 className="text-lg font-bold text-stone-100">Reading Session</h3>
              <p className="text-xs text-stone-400">Live</p>
            </div>

            <nav className="flex flex-col gap-1 mb-6">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-xl font-bold flex items-center gap-3 px-4 py-3 transition-all text-left ${activeTab === tab.id ? 'bg-lime-900/30 text-lime-300' : 'text-stone-400 hover:text-stone-100 hover:bg-stone-800/40'}`}
                >
                  <span className="material-symbols-outlined">{tab.icon}</span>
                  <span className="text-sm">{tab.label}</span>
                </button>
              ))}
            </nav>

            <div className="mt-auto space-y-4">
              <ParticipantList hostIdentity={hostIdentity} />
              <div className="flex items-center justify-between pt-2">
                <LocalControls />
              </div>
              {role === 'host' && (
                <button
                  onClick={() => handleEndSession(false)}
                  className="w-full py-3 bg-gradient-to-br from-[#a8d38a] to-[#2d5016] text-[#163801] font-bold rounded-full text-sm shadow-xl active:scale-95 transition-all"
                >
                  End Session
                </button>
              )}
            </div>
          </aside>

          {/* ── Main area ────────────────────────────────────────────────────── */}
          <section className="flex-1 ml-72 flex flex-col bg-[#0F0F0F] relative overflow-hidden">
            <ConnectionBanner />
            <TimerWarning remaining={remaining} />

            {/* Book viewer + annotation canvas */}
            <div className="flex-1 flex items-center justify-center p-8 relative">
              <div className="w-full max-w-5xl aspect-[4/3] flex bg-white rounded-2xl shadow-[0_50px_100px_-20px_rgba(0,0,0,0.7)] overflow-hidden relative group">

                {loadingPages ? (
                  <div className="flex-1 flex items-center justify-center bg-stone-100">
                    <div className="flex flex-col items-center gap-3 text-stone-400">
                      <span className="material-symbols-outlined text-5xl animate-spin">sync</span>
                      <span className="text-sm font-medium">Loading book…</span>
                    </div>
                  </div>
                ) : pages.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center bg-stone-50">
                    <div className="flex flex-col items-center gap-3 text-stone-400 p-12 text-center">
                      <span className="material-symbols-outlined text-6xl">menu_book</span>
                      <p className="text-stone-500 font-medium">No pages available yet.</p>
                      <p className="text-xs text-stone-400">Upload pages via the admin panel.</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 relative">
                    {currentPageData && (
                      <BookPageImage url={currentPageData.image_url} pageNumber={currentPage + 1} />
                    )}
                    {/* Annotation canvas — overlaid on top of book page */}
                    <AnnotationCanvas
                      ref={canvasRef}
                      tool={annTool}
                      color={annColor}
                      brushSize={annBrush}
                      onSync={handleCanvasSync}
                    />
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none z-20">
                      <span className="font-headline text-stone-400 text-sm italic">
                        Page {currentPage + 1}
                      </span>
                    </div>
                  </div>
                )}

                {/* Central fold shadow */}
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-6 bg-gradient-to-r from-stone-900/5 via-stone-900/12 to-stone-900/5 pointer-events-none" />
              </div>

              {/* Floating annotation toolbar */}
              <AnnotationToolbar
                tool={annTool}
                color={annColor}
                brushSize={annBrush}
                onToolChange={setAnnTool}
                onColorChange={setAnnColor}
                onBrushSizeChange={setAnnBrush}
                onClear={handleClearCanvas}
              />
            </div>

            {/* Page navigation */}
            <div className="absolute bottom-6 right-6 flex items-center gap-4 z-10">
              <div className="flex items-center gap-2 px-4 py-2 bg-stone-950/40 backdrop-blur-md rounded-full text-xs font-medium text-stone-400">
                Page {currentPage + 1} of {pageCount}
              </div>

              {role === 'host' && (
                <>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={currentPage === 0}
                      className="w-10 h-10 flex items-center justify-center bg-stone-800/80 rounded-full text-stone-200 hover:bg-stone-700 transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Previous page"
                    >
                      <span className="material-symbols-outlined">chevron_left</span>
                    </button>
                    <button
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={currentPage >= pageCount - 1}
                      className="w-10 h-10 flex items-center justify-center bg-stone-800/80 rounded-full text-stone-200 hover:bg-stone-700 transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Next page"
                    >
                      <span className="material-symbols-outlined">chevron_right</span>
                    </button>
                  </div>
                  <button className="ml-4 px-6 py-2.5 bg-[#ffb955] text-[#291800] font-extrabold rounded-full text-sm flex items-center gap-2 hover:opacity-90 transition-all active:scale-95 shadow-xl shadow-[#ffb955]/10">
                    <span className="material-symbols-outlined text-lg">rocket_launch</span>
                    Start Activity
                  </button>
                </>
              )}
            </div>
          </section>
        </main>

        {/* Reading progress bar */}
        <div className="fixed bottom-0 left-0 w-full h-1 bg-[#353535] z-[60]">
          <div
            className="h-full bg-[#ffb955] shadow-[0_0_10px_#ffb955] transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
    </>
  );
}

// ─── Page wrapper ─────────────────────────────────────────────────────────────

export default function ReadingRoomPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token, role, roomName, livekitUrl, participantId, sessionId, setSession } = useSession();

  const [bookId, setBookId] = useState<string | null>(null);
  const [bookTitle, setBookTitle] = useState('Reading Room');

  // Apply dark body style for reading room, clean up on unmount
  useEffect(() => {
    document.body.classList.add('reading-room');
    return () => document.body.classList.remove('reading-room');
  }, []);

  useEffect(() => {
    const sid = sessionId ?? id;
    if (!sid) return;
    getSession(sid)
      .then((s) => {
        setBookId(s.book);
        setBookTitle(s.book_title ?? 'Reading Room');
      })
      .catch(() => {});
  }, [sessionId, id]);

  // Guest token refresh on page reload
  useEffect(() => {
    if (token) return;
    const sid = sessionId ?? id;
    if (!sid) return;
    const storedId = typeof localStorage !== 'undefined' ? localStorage.getItem(`bb_participant_${sid}`) : null;
    if (!storedId) { router.replace('/'); return; }
    getGuestToken(sid, storedId).then((data) => {
      setSession({
        sessionId: data.session_id,
        token: data.realtime_token,
        role: data.role as 'host' | 'guest',
        roomName: data.room_name,
        livekitUrl: data.livekit_url,
        participantId: storedId,
      });
    }).catch(() => router.replace('/'));
  }, [token, sessionId, id, router, setSession]);

  if (!token || !roomName || !livekitUrl || !bookId) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#131313] text-[#e5e2e1]">
        <div className="flex flex-col items-center gap-4">
          <span className="material-symbols-outlined text-5xl text-lime-400 animate-spin">sync</span>
          <p className="text-sm text-stone-400">Loading session…</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <LiveKitRoom serverUrl={livekitUrl} token={token} connect video audio style={{ height: '100vh' }}>
        <RoomContent
          role={role!}
          sessionId={sessionId ?? id}
          participantId={participantId!}
          bookId={bookId}
          bookTitle={bookTitle}
          onEnd={() => router.push('/dashboard')}
        />
      </LiveKitRoom>
    </>
  );
}
