'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlaceholderPdf } from '@/lib/usePlaceholderPdf';
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
  transferHost,
  updateSnapshot,
  type BookPageData,
  type UserBadgeData,
} from '@/lib/api';
import { AnnotationToolbar, type AnnotationTool } from '@/components/annotation/AnnotationToolbar';
import type { AnnotationCanvasHandle } from '@/components/annotation/AnnotationCanvas';
import {
  AlarmClock,
  BookMarked,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  Pencil,
  Rocket,
  Settings,
  SlidersHorizontal,
  Star,
  Timer,
  Trophy,
  User,
  Users,
  Video,
  VideoOff,
  WifiOff,
  X,
} from 'lucide-react';

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

  const map: Record<string, { bg: string; text: string; Icon: React.ElementType; label: string }> = {
    [ConnectionState.Connecting]:   { bg: 'bg-amber-900/80 border-amber-600/30', text: 'text-amber-200', Icon: Loader2,  label: 'Connecting…' },
    [ConnectionState.Reconnecting]: { bg: 'bg-amber-900/80 border-amber-600/30', text: 'text-amber-200', Icon: WifiOff,  label: 'Reconnecting…' },
    [ConnectionState.Disconnected]: { bg: 'bg-red-900/80 border-red-600/30',     text: 'text-red-200',   Icon: WifiOff,  label: 'Disconnected — trying to rejoin' },
  };
  const s = map[state] ?? map[ConnectionState.Disconnected];
  const BannerIcon = s.Icon;

  return (
    <div className={`mx-auto mt-4 w-[90%] max-w-4xl px-6 py-2.5 rounded-xl flex items-center justify-center gap-3 border animate-pulse ${s.bg}`}>
      <BannerIcon className={`w-5 h-5 ${s.text}`} />
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
          <User className="w-10 h-10 text-stone-600" />
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
        {isMicrophoneEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
      </button>
      <button
        onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled)}
        className={`w-10 h-10 flex items-center justify-center rounded-xl transition-colors ${isCameraEnabled ? 'bg-stone-800/50 text-stone-300 hover:bg-stone-700/50' : 'bg-red-900/50 text-red-300 hover:bg-red-800/50'}`}
        title={isCameraEnabled ? 'Stop camera' : 'Start camera'}
      >
        {isCameraEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
      </button>
    </div>
  );
}

// ─── Book page ────────────────────────────────────────────────────────────────

function BookPageImage({ url, pageNumber }: { url: string; pageNumber: number }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative w-full h-full bg-white">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-12 h-12 text-stone-300 animate-spin" />
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={url}
        src={url}
        alt={`Page ${pageNumber}`}
        className={`w-full h-full object-contain transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    </div>
  );
}

// ─── Session-complete overlay ─────────────────────────────────────────────────

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
    <div className="fixed inset-0 z-[200] bg-gradient-to-br from-[#3d3b62] to-[#764f84] flex items-center justify-center p-6 overflow-y-auto">
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.12) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
      <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-white/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-white/5 blur-[120px] rounded-full pointer-events-none" />

      <header className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-6 py-6 pointer-events-none">
        <div className="font-baloo text-2xl font-bold text-white pointer-events-auto">
          Bailey &amp; Beau
        </div>
        <button onClick={onDashboard} className="w-10 h-10 flex items-center justify-center text-white/80 hover:text-white pointer-events-auto transition-colors">
          <X className="w-7 h-7" />
        </button>
      </header>

      <main className="relative z-10 w-full max-w-[560px] flex flex-col items-center text-center mt-20">
        <div className="mb-8 flex flex-col items-center">
          <span className="text-[72px] leading-none mb-4" role="img" aria-label="Party Popper">🎉</span>
          <h1 className="font-baloo text-5xl text-white font-bold tracking-tight mb-3">Amazing Session!</h1>
          <p className="text-white/90 text-lg font-light max-w-[400px]">
            You read together for {mins} {mins === 1 ? 'minute' : 'minutes'}.
          </p>
        </div>

        <div className="w-full bg-white rounded-[2rem] p-10 shadow-[0_32px_64px_-12px_rgba(23,57,1,0.3)] mb-8">
          <div className="flex flex-col items-center">
            <span className="font-karla text-xs font-extrabold uppercase tracking-[0.2em] text-[#764f84] mb-10">
              {badge ? 'NEW BADGE EARNED' : 'SESSION COMPLETE'}
            </span>

            {badge ? (
              <>
                <div className="relative flex items-center justify-center mb-8">
                  <div className="absolute w-[200px] h-[200px] border border-[#eccdca]/30 rounded-full" />
                  <div className="absolute w-[160px] h-[160px] border border-[#eccdca]/60 rounded-full" />
                  <div className="relative w-[120px] h-[120px] bg-[#f0c75e] rounded-full flex items-center justify-center shadow-lg">
                    <Star className="w-12 h-12 text-white fill-white" />
                  </div>
                </div>
                <h2 className="font-baloo text-[32px] text-[#3d3b62] font-bold mb-2">{badge.badge_name}</h2>
                <p className="font-karla text-stone-500 text-base mb-8">{badge.badge_description}</p>
              </>
            ) : (
              <div className="flex items-center justify-center w-[120px] h-[120px] rounded-full bg-[#eccdca]/30 mb-8">
                <BookMarked className="w-14 h-14 text-[#764f84]" />
              </div>
            )}

            <div className="w-full h-px bg-[#c3c9b9]/20 mb-8" />

            <div className="grid grid-cols-2 gap-y-6 gap-x-4 w-full text-left">
              <div className="flex items-start gap-3">
                <BookOpen className="w-5 h-5 text-[#3d3b62] mt-0.5 shrink-0" />
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Book</span>
                  <span className="text-sm font-semibold text-[#3d3b62]">{bookTitle}</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-[#3d3b62] mt-0.5 shrink-0" />
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Duration</span>
                  <span className="text-sm font-semibold text-[#3d3b62]">{mins} minutes</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <FileText className="w-5 h-5 text-[#3d3b62] mt-0.5 shrink-0" />
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Pages Read</span>
                  <span className="text-sm font-semibold text-[#3d3b62]">{pagesRead} of {pageCount}</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Trophy className="w-5 h-5 text-[#3d3b62] mt-0.5 shrink-0" />
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Badges</span>
                  <span className="text-sm font-semibold text-[#3d3b62]">{badges.length} earned</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4 w-full mb-10">
          <button
            onClick={onDashboard}
            className="font-baloo w-full sm:flex-1 bg-gradient-to-br from-[#f0c75e] to-[#c84a71] text-white font-bold py-4 px-8 rounded-xl shadow-lg hover:brightness-105 active:scale-95 transition-all text-sm uppercase tracking-widest"
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
      <AlarmClock className="w-5 h-5 text-[#ffb955]" />
      <span className="text-sm font-medium tracking-tight text-[#ffb955]">
        {is2min ? '2 minutes remaining — finishing up!' : '5 minutes remaining — time to wrap up!'}
      </span>
    </div>
  );
}

// ─── Tab config ───────────────────────────────────────────────────────────────

const TAB_ICONS: Record<string, React.ElementType> = {
  video:        Video,
  tools:        Pencil,
  participants: Users,
  chat:         MessageCircle,
  settings:     SlidersHorizontal,
};

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
  const router = useRouter();

  // ── Pages ─────────────────────────────────────────────────────────────────
  const [backendPages, setBackendPages] = useState<BookPageData[]>([]);
  const [loadingPages, setLoadingPages] = useState(true);
  const placeholderPages = usePlaceholderPdf(
    loadingPages || backendPages.length > 0 ? '' : '/Book-lulu.pdf',
  );
  const pages = backendPages.length > 0 ? backendPages : placeholderPages;
  const [currentPage, setCurrentPage] = useState(0);
  const [activeTab, setActiveTab] = useState<'video' | 'tools' | 'participants' | 'chat' | 'settings'>('video');

  // ── Timer ─────────────────────────────────────────────────────────────────
  const [timerActive, setTimerActive] = useState(false);
  const [remaining, setRemaining] = useState(SESSION_DURATION_S);
  const timerStartedAtRef = useRef<number | null>(null);

  // ── Annotation ────────────────────────────────────────────────────────────
  const [annTool, setAnnTool] = useState<AnnotationTool>('pen');
  const [annColor, setAnnColor] = useState('#ef4444');
  const [annBrush, setAnnBrush] = useState(8);
  const [annStampEmoji, setAnnStampEmoji] = useState('⭐');
  const canvasRef = useRef<AnnotationCanvasHandle>(null);

  // ── Host transfer ─────────────────────────────────────────────────────────
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferring, setTransferring] = useState(false);

  // ── Completion ────────────────────────────────────────────────────────────
  const [showComplete, setShowComplete] = useState(false);
  const [badges, setBadges] = useState<UserBadgeData[]>([]);
  const [sessionDurationSecs, setSessionDurationSecs] = useState(0);

  const decoder = useRef(new TextDecoder()).current;

  // ── Fetch pages ───────────────────────────────────────────────────────────
  useEffect(() => {
    const guestPid = role === 'guest' ? participantId : undefined;
    getBookPages(bookId, guestPid)
      .then(setBackendPages)
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
            canvasRef.current?.clearCanvas(false);
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
      const annotationJson = canvasRef.current ? (() => { try { return JSON.parse(canvasRef.current.getJSON()); } catch { return {}; } })() : {};
      updateSnapshot(sessionId, participantId, index + 1, annotationJson).catch(() => {});
    },
    [role, room, localParticipant, sessionId, participantId],
  );

  const goToPage = useCallback(
    (index: number) => {
      if (role !== 'host') return;
      const clamped = Math.max(0, Math.min(index, pages.length - 1));
      // In spread mode, we always ensure index is even to keep alignment, 
      // unless it's the very last page of an odd-numbered book.
      const spreadIndex = clamped % 2 === 0 ? clamped : clamped - 1;
      setCurrentPage(spreadIndex);
      broadcastPageTurn(spreadIndex);
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
    // Navigate to the dedicated completion screen
    router.push(`/session/${sessionId}/complete`);
  }

  async function handleEndSession(fromTimer = false) {
    if (role === 'host') {
      const elapsed = timerStartedAtRef.current
        ? Math.floor((Date.now() - timerStartedAtRef.current) / 1000)
        : 0;
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

  // ── Host transfer ─────────────────────────────────────────────────────────
  const participants = useParticipants();

  async function handleTransferHost(newParticipantId: string) {
    setTransferring(true);
    try {
      await transferHost(sessionId, participantId, newParticipantId);
      room.localParticipant.publishData(
        buildMsg('HOST_TRANSFERRED', { new_host_participant_id: newParticipantId }),
        { reliable: true },
      );
      setShowTransferModal(false);
    } catch { /* ignore */ } finally {
      setTransferring(false);
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const pageCount = pages.length || 1;
  const progressPct = (Math.min(currentPage + 2, pageCount) / pageCount) * 100;

  const tabs = [
    { id: 'video',        label: 'Video' },
    { id: 'tools',        label: 'Tools' },
    { id: 'participants', label: 'Participants' },
    { id: 'chat',         label: 'Chat' },
    { id: 'settings',     label: 'Settings' },
  ] as const;

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

      <div className="h-screen w-screen flex flex-col bg-gradient-to-br from-[#3d3b62] to-[#764f84] text-[#e5e2e1] overflow-hidden">

        {/* ── Top nav ──────────────────────────────────────────────────────── */}
        <header className="fixed top-0 w-full z-50 flex justify-between items-center px-6 h-14 bg-[#3d3b62]/90 backdrop-blur-xl shadow-2xl shadow-[#3d3b62]/50">
          <div className="flex items-center gap-6">
            <span className="font-baloo text-2xl font-bold text-white">Bailey &amp; Beau</span>
            <div className="h-6 w-[1px] bg-white/10" />
            <h1 className="font-baloo text-xl tracking-tight text-[#e5e2e1] max-w-[280px] truncate">{bookTitle}</h1>
          </div>
          <div className="flex items-center gap-4">
            {/* Timer display */}
            <div
              className={`flex items-center gap-2 px-3 py-1 rounded-full border transition-all ${remaining <= 2 * 60 ? 'bg-red-900/60 border-red-600/30' : 'bg-[#644000]/40 border-[#ffb955]/20'}`}
              title={role === 'host' && !timerActive ? 'Click to start timer' : undefined}
              onClick={role === 'host' && !timerActive ? handleStartTimer : undefined}
              style={role === 'host' && !timerActive ? { cursor: 'pointer' } : undefined}
            >
              <Timer className="w-4 h-4 text-[#ffb955]" />
              <span className="text-[#ffb955] font-bold tracking-widest text-sm">{fmtTime(remaining)}</span>
              {role === 'host' && !timerActive && (
                <span className="text-[#ffb955]/60 text-[10px] ml-1">tap to start</span>
              )}
            </div>

            <span className={`font-karla px-3 py-0.5 text-xs font-bold rounded-full uppercase tracking-tighter ${role === 'host' ? 'bg-[#764f84] text-white' : 'bg-stone-800 text-stone-300'}`}>
              {role}
            </span>

            <div className="flex items-center gap-2 ml-4">
              {role === 'host' && (
                <button
                  onClick={() => setShowTransferModal(true)}
                  aria-label="Transfer host"
                  className="w-8 h-8 flex items-center justify-center text-stone-400 hover:text-stone-100 transition-colors"
                >
                  <Settings className="w-5 h-5" />
                </button>
              )}
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
              {tabs.map((tab) => {
                const TabIcon = TAB_ICONS[tab.id];
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-xl font-bold flex items-center gap-3 px-4 py-3 transition-all text-left ${activeTab === tab.id ? 'bg-lime-900/30 text-lime-300' : 'text-stone-400 hover:text-stone-100 hover:bg-stone-800/40'}`}
                  >
                    <TabIcon className="w-5 h-5" />
                    <span className="text-sm">{tab.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="mt-auto space-y-4">
              <ParticipantList hostIdentity={hostIdentity} />
              <div className="flex items-center justify-between pt-2">
                <LocalControls />
              </div>
              {role === 'host' && (
                <button
                  onClick={() => handleEndSession(false)}
                  className="font-baloo w-full py-3 bg-gradient-to-br from-[#3d3b62] to-[#764f84] text-white font-bold rounded-full text-sm shadow-xl active:scale-95 transition-all"
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
                      <Loader2 className="w-12 h-12 animate-spin" />
                      <span className="text-sm font-medium">Loading book…</span>
                    </div>
                  </div>
                ) : pages.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center bg-stone-50">
                    <div className="flex flex-col items-center gap-3 text-stone-400 p-12 text-center">
                      <Loader2 className="w-12 h-12 animate-spin" />
                      <p className="text-stone-500 font-medium">Loading placeholder book…</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex relative">
                    {/* Left Page */}
                    <div className="flex-1 relative bg-white">
                      {pages[currentPage] && (
                        <BookPageImage url={pages[currentPage].image_url} pageNumber={currentPage + 1} />
                      )}
                      <div className="absolute bottom-4 left-4 pointer-events-none z-20">
                        <span className="font-karla text-stone-400 text-[10px]">
                          Page {currentPage + 1}
                        </span>
                      </div>
                    </div>

                    {/* Right Page */}
                    <div className="flex-1 relative bg-white border-l border-stone-100">
                      {pages[currentPage + 1] && (
                        <BookPageImage url={pages[currentPage + 1].image_url} pageNumber={currentPage + 2} />
                      )}
                      {pages[currentPage + 1] && (
                        <div className="absolute bottom-4 right-4 pointer-events-none z-20 text-right">
                          <span className="font-karla text-stone-400 text-[10px]">
                            Page {currentPage + 2}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Annotation canvas — overlaid on top of both pages */}
                    <AnnotationCanvas
                      ref={canvasRef}
                      tool={annTool}
                      color={annColor}
                      brushSize={annBrush}
                      stampEmoji={annStampEmoji}
                      onSync={handleCanvasSync}
                    />
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
                selectedEmoji={annStampEmoji}
                onToolChange={setAnnTool}
                onColorChange={setAnnColor}
                onBrushSizeChange={setAnnBrush}
                onClear={handleClearCanvas}
                onUndo={() => canvasRef.current?.undo()}
                onStampEmoji={setAnnStampEmoji}
              />
            </div>

            {/* Page navigation */}
            <div className="absolute bottom-6 right-6 flex items-center gap-4 z-10">
              <div className="flex items-center gap-2 px-4 py-2 bg-stone-950/40 backdrop-blur-md rounded-full text-xs font-medium text-stone-400">
                {pages[currentPage + 1] ? (
                  <>Pages {currentPage + 1}-{currentPage + 2} of {pageCount}</>
                ) : (
                  <>Page {currentPage + 1} of {pageCount}</>
                )}
              </div>

              {role === 'host' && (
                <>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => goToPage(currentPage - 2)}
                      disabled={currentPage <= 0}
                      className="w-10 h-10 flex items-center justify-center bg-stone-800/80 rounded-full text-stone-200 hover:bg-stone-700 transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => goToPage(currentPage + 2)}
                      disabled={currentPage >= pageCount - 2}
                      className="w-10 h-10 flex items-center justify-center bg-stone-800/80 rounded-full text-stone-200 hover:bg-stone-700 transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Next page"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                  <button
                    onClick={() => router.push(`/session/${sessionId}/activity?bookId=${bookId}`)}
                    className="ml-4 px-6 py-2.5 bg-[#ffb955] text-[#291800] font-extrabold rounded-full text-sm flex items-center gap-2 hover:opacity-90 transition-all active:scale-95 shadow-xl shadow-[#ffb955]/10"
                  >
                    <Rocket className="w-5 h-5" />
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

        {/* Host transfer modal */}
        {showTransferModal && (
          <div className="fixed inset-0 bg-black/70 z-[200] flex items-center justify-center p-4" onClick={() => setShowTransferModal(false)}>
            <div className="bg-[#20201f] rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-baloo text-[#e5e2e1] text-xl">Transfer Host</h3>
                <button onClick={() => setShowTransferModal(false)} aria-label="Close" className="text-[#c3c9b9] hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-[#c3c9b9] text-sm mb-5">Select a participant to give host controls to:</p>
              <div className="flex flex-col gap-3">
                {participants
                  .filter((p) => p.identity !== String(participantId))
                  .map((p) => (
                    <button
                      key={p.identity}
                      onClick={() => handleTransferHost(p.identity)}
                      disabled={transferring}
                      className="flex items-center gap-3 p-3 rounded-xl bg-[#2a2a2a] hover:bg-[#764f84] text-[#e5e2e1] hover:text-white transition-all disabled:opacity-50"
                    >
                      <div className="w-8 h-8 rounded-full bg-[#353535] flex items-center justify-center text-sm font-bold">
                        {p.name?.[0]?.toUpperCase() ?? '?'}
                      </div>
                      <span className="font-medium">{p.name ?? p.identity}</span>
                      <Users className="w-4 h-4 ml-auto opacity-50" />
                    </button>
                  ))}
                {participants.filter((p) => p.identity !== String(participantId)).length === 0 && (
                  <p className="text-[#c3c9b9]/60 text-sm text-center py-4">No other participants in session.</p>
                )}
              </div>
            </div>
          </div>
        )}
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
          <Loader2 className="w-12 h-12 text-lime-400 animate-spin" />
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
