'use client';

import dynamic from 'next/dynamic';
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ComponentType, PropsWithChildren, RefAttributes } from 'react';
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
  getBookActivities,
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
import { MAX_LIVEKIT_ROOM_PARTICIPANTS } from '@/lib/sessionLimits';
import ActivityRoom from '@/components/activity/ActivityRoom';
import type { ActivityConfigData } from '@/components/activity/types';
import { AnnotationToolbar, type ReadingInteractionMode } from '@/components/annotation/AnnotationToolbar';
import type { AnnotationCanvasHandle } from '@/components/annotation/AnnotationCanvas';
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';
import {
  AlarmClock,
  BookMarked,
  BookOpen,
  Check,
  Clock,
  Copy,
  FileText,
  Loader2,
  Link2,
  MessageCircle,
  Mic,
  MicOff,
  Pencil,
  Rocket,
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
  ZoomIn,
  ZoomOut,
  LayoutGrid,
  ShieldCheck,
  Gamepad2,
  Phone,
  MoreHorizontal,
} from 'lucide-react';

type PageFlipController = {
  turnToPage?: (n: number) => void;
  flipNext?: (c: 'top' | 'bottom') => void;
  flipPrev?: (c: 'top' | 'bottom') => void;
  getCurrentPageIndex?: () => number;
};

type FlipBookImperativeHandle = {
  pageFlip: () => PageFlipController | undefined;
};

// Dynamic import for Fabric canvas (SSR-unsafe)
const AnnotationCanvas = dynamic(
  () => import('@/components/annotation/AnnotationCanvas'),
  { ssr: false },
);

const HTMLFlipBook = dynamic(
  () => import('react-pageflip').then((m) => m.default),
  { ssr: false },
) as unknown as ComponentType<
  PropsWithChildren<Record<string, unknown>> & RefAttributes<FlipBookImperativeHandle>
>;

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
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`mx-auto mt-4 w-[90%] max-w-4xl px-6 py-2.5 rounded-xl flex items-center justify-center gap-3 border animate-pulse ${s.bg}`}
    >
      <BannerIcon className={`w-5 h-5 ${s.text}`} aria-hidden="true" />
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

function ParticipantRoster({ hostIdentity }: { hostIdentity?: string }) {
  const participants = useParticipants();
  return (
    <div className="space-y-2">
      {participants.map((p) => (
        <div key={p.identity} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-stone-800/40">
          <div className="w-8 h-8 rounded-full bg-[#764f84]/40 flex items-center justify-center">
            <User className="w-4 h-4 text-white/80" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-stone-100 truncate">{p.name || p.identity}</p>
            {p.identity === hostIdentity && (
              <p className="text-[10px] text-[#f0c75e] uppercase tracking-wider">Host</p>
            )}
          </div>
        </div>
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
        aria-label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
        aria-pressed={!isMicrophoneEnabled}
        className={`w-10 h-10 flex items-center justify-center rounded-xl transition-colors ${isMicrophoneEnabled ? 'bg-stone-800/50 text-stone-300 hover:bg-stone-700/50' : 'bg-red-900/50 text-red-300 hover:bg-red-800/50'}`}
      >
        {isMicrophoneEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
      </button>
      <button
        onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled)}
        aria-label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
        aria-pressed={!isCameraEnabled}
        className={`w-10 h-10 flex items-center justify-center rounded-xl transition-colors ${isCameraEnabled ? 'bg-stone-800/50 text-stone-300 hover:bg-stone-700/50' : 'bg-red-900/50 text-red-300 hover:bg-red-800/50'}`}
      >
        {isCameraEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
      </button>
    </div>
  );
}

/** Large circular mic / camera controls for bottom dock */
function SessionMediaDock() {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const pill =
    'flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 transition-all active:scale-95 sm:h-16 sm:w-16';
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <button
        type="button"
        onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
        aria-label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
        aria-pressed={!isMicrophoneEnabled}
        className={`${pill} ${isMicrophoneEnabled ? 'border-[#3b85a6] bg-[#3b85a6]/25 text-white shadow-[0_0_20px_rgba(59,133,166,0.35)]' : 'border-red-500/60 bg-red-950/40 text-red-200'}`}
      >
        {isMicrophoneEnabled ? <Mic className="h-6 w-6 sm:h-7 sm:w-7" /> : <MicOff className="h-6 w-6 sm:h-7 sm:w-7" />}
      </button>
      <button
        type="button"
        onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled)}
        aria-label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
        aria-pressed={!isCameraEnabled}
        className={`${pill} ${isCameraEnabled ? 'border-[#3b85a6] bg-[#3b85a6]/25 text-white shadow-[0_0_20px_rgba(59,133,166,0.35)]' : 'border-red-500/60 bg-red-950/40 text-red-200'}`}
      >
        {isCameraEnabled ? <Video className="h-6 w-6 sm:h-7 sm:w-7" /> : <VideoOff className="h-6 w-6 sm:h-7 sm:w-7" />}
      </button>
    </div>
  );
}

function SessionTimerRing({
  remaining,
  totalSecs,
  timerActive,
  role,
  onStart,
}: {
  remaining: number;
  totalSecs: number;
  timerActive: boolean;
  role: 'host' | 'guest';
  onStart: () => void;
}) {
  const radius = 34;
  const c = 2 * Math.PI * radius;
  const pct = timerActive && totalSecs > 0 ? Math.min(1, Math.max(0, remaining / totalSecs)) : 0;
  const dash = c * (1 - pct);

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`relative flex h-[124px] w-[124px] items-center justify-center ${role === 'host' && !timerActive ? 'cursor-pointer' : ''}`}
        onClick={role === 'host' && !timerActive ? onStart : undefined}
        onKeyDown={(e) => {
          if (role === 'host' && !timerActive && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onStart();
          }
        }}
        role={role === 'host' && !timerActive ? 'button' : undefined}
        tabIndex={role === 'host' && !timerActive ? 0 : undefined}
        title={role === 'host' && !timerActive ? 'Start session timer' : undefined}
      >
        <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 88 88" aria-hidden>
          <circle cx="44" cy="44" r={radius} fill="none" className="text-stone-700/80" stroke="currentColor" strokeWidth="5" />
          <circle
            cx="44"
            cy="44"
            r={radius}
            fill="none"
            stroke="#ffb955"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={dash}
            className="transition-[stroke-dashoffset] duration-500"
          />
        </svg>
        <div className="relative z-10 flex flex-col items-center text-center">
          <span className="font-baloo text-xl font-bold tabular-nums text-white">{fmtTime(remaining)}</span>
          <span className="text-[9px] font-semibold uppercase tracking-wider text-stone-400">
            {timerActive ? 'remaining' : role === 'host' ? 'tap to start' : 'waiting'}
          </span>
        </div>
      </div>
      <p className="text-center text-[10px] font-bold uppercase tracking-widest text-stone-500">
        {timerActive ? 'Reading' : 'Session'}
      </p>
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

/** One StPageFlip leaf per two-up spread (forwardRef required by react-pageflip). */
const FlipBookSpreadPage = forwardRef<
  HTMLDivElement,
  { left: BookPageData | null; right: BookPageData | null; leftPageNumber: number }
>(function FlipBookSpreadPage({ left, right, leftPageNumber }, ref) {
  return (
    <div ref={ref} className="flex h-full w-full overflow-hidden bg-white">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {left ? (
          <BookPageImage url={left.image_url} pageNumber={leftPageNumber} />
        ) : (
          <div className="h-full w-full bg-white" />
        )}
        {left && (
          <div className="pointer-events-none absolute bottom-4 left-4 z-20">
            <span className="font-karla text-[10px] text-stone-400">Page {leftPageNumber}</span>
          </div>
        )}
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col border-l border-stone-100">
        {right ? (
          <BookPageImage url={right.image_url} pageNumber={leftPageNumber + 1} />
        ) : (
          <div className="h-full w-full bg-white" />
        )}
        {right && (
          <div className="pointer-events-none absolute bottom-4 right-4 z-20 text-right">
            <span className="font-karla text-[10px] text-stone-400">Page {leftPageNumber + 1}</span>
          </div>
        )}
      </div>
    </div>
  );
});

function bookSpreadItems(pages: BookPageData[]) {
  const items: { left: BookPageData | null; right: BookPageData | null; leftPageNumber: number }[] = [];
  for (let i = 0; i < pages.length; i += 2) {
    items.push({
      left: pages[i] ?? null,
      right: pages[i + 1] ?? null,
      leftPageNumber: i + 1,
    });
  }
  return items;
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
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className={`mx-auto mt-4 w-[90%] max-w-4xl px-6 py-2.5 rounded-xl flex items-center justify-center gap-3 border animate-pulse ${is2min ? 'bg-red-900/70 border-red-600/30' : 'bg-[#644000] border-[#ffb955]/20'}`}
    >
      <AlarmClock className="w-5 h-5 text-[#ffb955]" aria-hidden="true" />
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
  inviteToken,
  onEnd,
}: {
  role: 'host' | 'guest';
  sessionId: string;
  participantId: string;
  bookId: string;
  bookTitle: string;
  inviteToken: string | null;
  onEnd: () => void;
}) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const router = useRouter();

  const [linkCopied, setLinkCopied] = useState(false);
  const linkCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopyInviteLink = useCallback(() => {
    if (!inviteToken || typeof window === 'undefined') return;
    const url = `${window.location.origin}/session/${sessionId}/lobby?invite=${inviteToken}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setLinkCopied(true);
        if (linkCopiedTimerRef.current) clearTimeout(linkCopiedTimerRef.current);
        linkCopiedTimerRef.current = setTimeout(() => setLinkCopied(false), 2500);
      })
      .catch(() => {});
  }, [inviteToken, sessionId]);

  useEffect(
    () => () => {
      if (linkCopiedTimerRef.current) clearTimeout(linkCopiedTimerRef.current);
    },
    [],
  );

  // ── Pages ─────────────────────────────────────────────────────────────────
  const [backendPages, setBackendPages] = useState<BookPageData[]>([]);
  const [loadingPages, setLoadingPages] = useState(true);
  const placeholderPages = usePlaceholderPdf(
    loadingPages || backendPages.length > 0 ? '' : '/Book-lulu.pdf',
  );
  const pages = backendPages.length > 0 ? backendPages : placeholderPages;
  const spreadItems = useMemo(() => bookSpreadItems(pages), [pages]);
  const [currentPage, setCurrentPage] = useState(0);
  const [activeTab, setActiveTab] = useState<'video' | 'tools' | 'participants' | 'chat' | 'settings'>('video');
  const [roomPanelOpen, setRoomPanelOpen] = useState(false);

  // ── Timer ─────────────────────────────────────────────────────────────────
  const [timerActive, setTimerActive] = useState(false);
  const [remaining, setRemaining] = useState(SESSION_DURATION_S);
  const timerStartedAtRef = useRef<number | null>(null);
  const [showExtendModal, setShowExtendModal] = useState(false);
  const extendCountdownRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Annotation ────────────────────────────────────────────────────────────
  const [interactionMode, setInteractionMode] = useState<ReadingInteractionMode>('book');
  const annTool = interactionMode === 'book' ? 'pen' : interactionMode;
  const drawingEnabled = interactionMode !== 'book';
  const [annColor, setAnnColor] = useState('#ef4444');
  const [annBrush, setAnnBrush] = useState(8);
  const canvasRef = useRef<AnnotationCanvasHandle>(null);
  const transformRef = useRef<ReactZoomPanPinchContentRef | null>(null);
  const transformRecalcTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPageRef = useRef(0);
  currentPageRef.current = currentPage;

  const [bookRect, setBookRect] = useState({ w: 720, h: 540 });
  const bookMeasureRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<FlipBookImperativeHandle | null>(null);
  const suppressFlipSideEffectsRef = useRef(false);
  const [bookFlipVisualState, setBookFlipVisualState] = useState('read');
  /** Defer mounting StPageFlip until after hydration — avoids ref/DOM races with next/dynamic + strict mode */
  const [flipBookClientReady, setFlipBookClientReady] = useState(false);
  useEffect(() => {
    setFlipBookClientReady(true);
  }, []);

  const scheduleCanvasRecalcAfterTransform = useCallback(() => {
    if (transformRecalcTimerRef.current) clearTimeout(transformRecalcTimerRef.current);
    transformRecalcTimerRef.current = setTimeout(() => {
      canvasRef.current?.recalcLayout();
      transformRecalcTimerRef.current = null;
    }, 80);
  }, []);

  useEffect(
    () => () => {
      if (transformRecalcTimerRef.current) clearTimeout(transformRecalcTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const el = bookMeasureRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const rw = Math.max(280, Math.floor(Math.min(r.width, 1200)));
      const rh = Math.floor((rw * 3) / 4);
      setBookRect((prev) => (prev.w !== rw || prev.h !== rh ? { w: rw, h: rh } : prev));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loadingPages, spreadItems.length]);

  // ── Reactions overlay ─────────────────────────────────────────────────────
  const [reactions, setReactions] = useState<{ id: number; emoji: string; x: number }[]>([]);
  const reactionCounterRef = useRef(0);

  const spawnReaction = useCallback((emoji: string) => {
    const id = ++reactionCounterRef.current;
    const x = 10 + Math.random() * 80; // random % across screen
    setReactions((prev) => [...prev, { id, emoji, x }]);
    setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 2000);
  }, []);

  // ── Host transfer ─────────────────────────────────────────────────────────
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferring, setTransferring] = useState(false);

  // ── Chat ──────────────────────────────────────────────────────────────────
  const [chatMessages, setChatMessages] = useState<{ id: number; from: string; text: string; self: boolean }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const chatCounterRef = useRef(0);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Completion ────────────────────────────────────────────────────────────
  const [showComplete, setShowComplete] = useState(false);
  const [badges, setBadges] = useState<UserBadgeData[]>([]);
  const [sessionDurationSecs, setSessionDurationSecs] = useState(0);

  const [activities, setActivities] = useState<ActivityConfigData[]>([]);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityIndex, setActivityIndex] = useState(0);
  const [activityStateByActivity, setActivityStateByActivity] = useState<Record<string, Record<string, unknown>>>(
    {},
  );
  const activitySnapshotRef = useRef<Record<string, unknown>>({});

  const decoder = useRef(new TextDecoder()).current;

  // ── Fetch pages ───────────────────────────────────────────────────────────
  useEffect(() => {
    const guestPid = role === 'guest' ? participantId : undefined;
    getBookPages(bookId, guestPid)
      .then(setBackendPages)
      .catch(() => {})
      .finally(() => setLoadingPages(false));
  }, [bookId, participantId, role]);

  useEffect(() => {
    const guestPid = role === 'guest' ? participantId : undefined;
    getBookActivities(bookId, guestPid)
      .then(setActivities)
      .catch(() => setActivities([]));
  }, [bookId, participantId, role]);

  // ── Restore snapshot ──────────────────────────────────────────────────────
  useEffect(() => {
    getSnapshot(sessionId, participantId)
      .then((snap) => {
        if (snap && typeof snap.page_number === 'number' && snap.page_number > 0) {
          setCurrentPage(snap.page_number - 1);
        }
        if (snap?.timer_state && typeof (snap.timer_state as Record<string, unknown>).remaining_seconds === 'number') {
          const rem = (snap.timer_state as Record<string, unknown>).remaining_seconds as number;
          if (rem > 0 && rem < SESSION_DURATION_S) {
            setRemaining(rem);
            setTimerActive(true);
            timerStartedAtRef.current = Date.now() - (SESSION_DURATION_S - rem) * 1000;
          }
        }
        if (snap?.activity_state && typeof snap.activity_state === 'object') {
          const state = snap.activity_state as Record<string, unknown>;
          activitySnapshotRef.current = state;
          const open = Boolean(state.activity_open);
          const idx = typeof state.activity_index === 'number' ? state.activity_index : 0;
          const stateBy =
            state.state_by_activity && typeof state.state_by_activity === 'object'
              ? (state.state_by_activity as Record<string, Record<string, unknown>>)
              : {};
          setActivityOpen(open);
          setActivityIndex(idx);
          setActivityStateByActivity(stateBy);
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
          // Show extend modal — auto-end after 15 seconds if host doesn't act
          setShowExtendModal(true);
          extendCountdownRef.current = setTimeout(() => {
            setShowExtendModal(false);
            handleEndSession(true);
          }, 15000);
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
            const left = msg.payload.page;
            const maxFi = Math.max(0, Math.ceil(pages.length / 2) - 1);
            const fi = Math.min(Math.max(0, Math.floor(left / 2)), maxFi);
            setCurrentPage(left);
            canvasRef.current?.clearCanvas(false);
            suppressFlipSideEffectsRef.current = true;
            requestAnimationFrame(() => {
              try {
                flipRef.current?.pageFlip()?.turnToPage?.(fi);
              } catch {
                /* ok */
              }
              requestAnimationFrame(() => {
                suppressFlipSideEffectsRef.current = false;
              });
            });
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

        case 'ACTIVITY_OPEN':
          if (role === 'guest') {
            setActivityOpen(Boolean(msg.payload.activity_open ?? true));
            const idx = typeof msg.payload.activity_index === 'number' ? msg.payload.activity_index : 0;
            if (typeof msg.payload.activity_index === 'number') {
              setActivityIndex(msg.payload.activity_index);
            }
            const sb =
              msg.payload.state_by_activity && typeof msg.payload.state_by_activity === 'object'
                ? (msg.payload.state_by_activity as Record<string, Record<string, unknown>>)
                : {};
            if (msg.payload.state_by_activity && typeof msg.payload.state_by_activity === 'object') {
              setActivityStateByActivity(sb);
            }
            activitySnapshotRef.current = {
              activity_open: true,
              activity_index: idx,
              state_by_activity: sb,
            };
          }
          break;

        case 'ACTIVITY_CLOSE':
          if (role === 'guest') {
            setActivityOpen(false);
            activitySnapshotRef.current = {
              activity_open: false,
              activity_index: 0,
              state_by_activity: {},
            };
          }
          break;

        case 'ACTIVITY_SYNC': {
          const idx = typeof msg.payload.activity_index === 'number' ? msg.payload.activity_index : undefined;
          if (idx !== undefined) setActivityIndex(idx);
          const sb =
            msg.payload.state_by_activity && typeof msg.payload.state_by_activity === 'object'
              ? (msg.payload.state_by_activity as Record<string, Record<string, unknown>>)
              : undefined;
          if (sb) setActivityStateByActivity(sb);
          const prev = activitySnapshotRef.current;
          activitySnapshotRef.current = {
            activity_open: true,
            activity_index: idx ?? (typeof prev.activity_index === 'number' ? prev.activity_index : 0),
            state_by_activity: sb ?? (prev.state_by_activity as Record<string, unknown>) ?? {},
          };
          break;
        }

        case 'ACTIVITY_NAV':
          if (role === 'guest' && typeof msg.payload.index === 'number') {
            setActivityIndex(msg.payload.index);
          }
          break;

        case 'REACTION':
          if (typeof msg.payload.emoji === 'string') {
            spawnReaction(msg.payload.emoji);
          }
          break;

        case 'CHAT':
          if (typeof msg.payload.text === 'string') {
            const from = typeof msg.payload.from === 'string' ? msg.payload.from : 'Guest';
            setChatMessages((prev) => [...prev, { id: ++chatCounterRef.current, from, text: msg.payload.text as string, self: false }]);
          }
          break;
      }
    }
    room.on('dataReceived', onData);
    return () => { room.off('dataReceived', onData); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, role, pages.length]);

  // ── Broadcast page turn ───────────────────────────────────────────────────
  const broadcastPageTurn = useCallback(
    async (index: number) => {
      if (role !== 'host') return;
      room.localParticipant.publishData(buildMsg('PAGE_TURN', { page: index }), { reliable: true });
      try { await localParticipant.setMetadata(JSON.stringify({ page: index, role: 'host' })); } catch { /* ok */ }
      const annotationJson = canvasRef.current ? (() => { try { return JSON.parse(canvasRef.current.getJSON()); } catch { return {}; } })() : {};
      updateSnapshot(sessionId, participantId, index + 1, undefined, annotationJson).catch(() => {});
    },
    [role, room, localParticipant, sessionId, participantId],
  );

  const onBookFlip = useCallback(
    (e: unknown) => {
      if (suppressFlipSideEffectsRef.current) return;
      const raw =
        typeof e === 'number'
          ? e
          : e &&
              typeof e === 'object' &&
              e !== null &&
              'data' in e &&
              (e as { data: unknown }).data !== undefined
            ? (e as { data: unknown }).data
            : undefined;
      const fi = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
      if (Number.isNaN(fi)) return;
      const left = Math.max(0, fi * 2);
      setCurrentPage(left);
      if (role !== 'host') return;
      broadcastPageTurn(left);
      canvasRef.current?.clearCanvas(false);
      try {
        room.localParticipant.publishData(buildMsg('CANVAS_CLEAR', {}), { reliable: true });
      } catch {
        /* e.g. disconnecting */
      }
    },
    [role, broadcastPageTurn, room],
  );

  const onBookInit = useCallback(() => {
    const maxIdx = Math.max(0, spreadItems.length - 1);
    const fi = Math.min(Math.max(0, Math.floor(currentPageRef.current / 2)), maxIdx);
    suppressFlipSideEffectsRef.current = true;
    try {
      flipRef.current?.pageFlip()?.turnToPage?.(fi);
    } catch {
      /* ignore */
    }
    requestAnimationFrame(() => {
      suppressFlipSideEffectsRef.current = false;
    });
  }, [spreadItems.length]);

  const onBookChangeState = useCallback(
    (e: unknown) => {
      const raw =
        typeof e === 'string'
          ? e
          : e &&
              typeof e === 'object' &&
              e !== null &&
              'data' in e &&
              (e as { data: unknown }).data !== undefined
            ? (e as { data: unknown }).data
            : undefined;
      const d = typeof raw === 'string' ? raw : raw != null ? String(raw) : 'read';
      const allowed = ['flipping', 'read', 'user_fold', 'fold_corner'];
      setBookFlipVisualState(allowed.includes(d) ? d : 'read');
      if (d === 'read') {
        scheduleCanvasRecalcAfterTransform();
      }
    },
    [scheduleCanvasRecalcAfterTransform],
  );

  const hostFlipPrev = useCallback(() => {
    if (role !== 'host') return;
    flipRef.current?.pageFlip()?.flipPrev?.('top');
  }, [role]);

  const hostFlipNext = useCallback(() => {
    if (role !== 'host') return;
    flipRef.current?.pageFlip()?.flipNext?.('top');
  }, [role]);

  useEffect(() => {
    if (loadingPages || spreadItems.length === 0) return;
    if (bookFlipVisualState === 'flipping') return;
    const id = requestAnimationFrame(() => {
      const api = flipRef.current?.pageFlip?.();
      if (!api?.getCurrentPageIndex) return;
      const fi = Math.min(Math.max(0, Math.floor(currentPage / 2)), spreadItems.length - 1);
      let cur: number;
      try {
        cur = api.getCurrentPageIndex();
      } catch {
        return;
      }
      if (cur === fi) return;
      suppressFlipSideEffectsRef.current = true;
      try {
        api.turnToPage?.(fi);
      } catch {
        /* ok */
      }
      requestAnimationFrame(() => {
        suppressFlipSideEffectsRef.current = false;
      });
    });
    return () => cancelAnimationFrame(id);
  }, [currentPage, spreadItems.length, loadingPages, bookFlipVisualState]);

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
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Erase all doodles on this page for everyone?')
    ) {
      return;
    }
    canvasRef.current?.clearCanvas(true);
    room.localParticipant.publishData(buildMsg('CANVAS_CLEAR', {}), { reliable: true });
  }, [room]);

  const handleReaction = useCallback((emoji: string) => {
    spawnReaction(emoji);
    room.localParticipant.publishData(buildMsg('REACTION', { emoji }), { reliable: true });
  }, [room, spawnReaction]);

  const sendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    const from = room.localParticipant.name || room.localParticipant.identity || 'Me';
    room.localParticipant.publishData(buildMsg('CHAT', { text, from }), { reliable: true });
    setChatMessages((prev) => [...prev, { id: ++chatCounterRef.current, from: 'Me', text, self: true }]);
    setChatInput('');
  }, [chatInput, room]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

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
  const coverUrl = pages[0]?.image_url;
  const progressPct = (Math.min(currentPage + 2, pageCount) / pageCount) * 100;

  const tabs = [
    { id: 'video' as const, label: 'Video', hint: 'Cameras' },
    { id: 'tools' as const, label: 'Tools', hint: 'Draw' },
    { id: 'participants' as const, label: 'People', hint: 'Who is here' },
    { id: 'chat' as const, label: 'Chat', hint: 'Messages' },
    { id: 'settings' as const, label: 'Settings', hint: 'Timer & host' },
  ];

  const hostIdentity = role === 'host' ? room.localParticipant.identity : undefined;
  const blockZoomGesturesWhileDrawing =
    drawingEnabled && (interactionMode === 'pen' || interactionMode === 'highlighter');

  return (
    <>
      <ActivityRoom
        role={role}
        activities={activities}
        open={activityOpen}
        initialIndex={activityIndex}
        initialStateByActivity={activityStateByActivity}
        onClose={() => {
          setActivityOpen(false);
          const closed = { activity_open: false, activity_index: 0, state_by_activity: {} };
          activitySnapshotRef.current = closed;
          if (role === 'host') {
            room.localParticipant.publishData(buildMsg('ACTIVITY_CLOSE', {}), { reliable: true });
            updateSnapshot(sessionId, participantId, currentPage + 1, remaining, {}, closed).catch(() => {});
          }
        }}
        onActivityStateSync={(activityState) => {
          activitySnapshotRef.current = activityState;
          const idx =
            typeof activityState.activity_index === 'number' ? activityState.activity_index : activityIndex;
          const stateBy =
            activityState.state_by_activity && typeof activityState.state_by_activity === 'object'
              ? (activityState.state_by_activity as Record<string, Record<string, unknown>>)
              : activityStateByActivity;
          setActivityIndex(idx);
          setActivityStateByActivity(stateBy);
          updateSnapshot(sessionId, participantId, currentPage + 1, remaining, {}, activityState).catch(() => {});
        }}
      />

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

      {/* Reaction overlay — floats above everything */}
      {reactions.length > 0 && (
        <div className="fixed inset-0 z-[200] pointer-events-none overflow-hidden">
          {reactions.map((r) => (
            <span
              key={r.id}
              className="reaction-float"
              style={{ left: `${r.x}%`, bottom: '10%' }}
            >
              {r.emoji}
            </span>
          ))}
        </div>
      )}

      <div className="h-screen w-screen flex flex-col bg-gradient-to-br from-[#3d3b62] to-[#764f84] text-[#e5e2e1] overflow-hidden">

        {/* ── Top nav — read-along style header ─────────────────────────────── */}
        <header className="fixed top-0 z-50 flex h-16 w-full items-center justify-between border-b border-white/5 bg-[#2a2838]/95 px-4 shadow-lg backdrop-blur-xl sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-5">
            <div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#764f84] to-[#3d3b62] shadow-md sm:flex">
              <BookOpen className="h-6 w-6 text-white" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="font-baloo truncate text-lg font-bold leading-tight text-white sm:text-xl">Bailey &amp; Beau</p>
              <p className="font-karla hidden truncate text-[11px] text-stone-400 sm:block">Reading together, growing together</p>
            </div>
            <div className="mx-1 hidden h-9 w-px shrink-0 bg-white/10 sm:block" aria-hidden />
            <div className="flex min-w-0 max-w-[min(40vw,280px)] items-center gap-3 sm:max-w-[320px]">
              {!loadingPages && coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={coverUrl}
                  alt=""
                  className="h-11 w-9 shrink-0 rounded-lg object-cover shadow-md ring-1 ring-white/15"
                />
              ) : (
                <div className="flex h-11 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-800 ring-1 ring-white/10">
                  <BookMarked className="h-5 w-5 text-stone-500" aria-hidden />
                </div>
              )}
              <div className="min-w-0">
                <h1 className="font-baloo truncate text-sm font-semibold tracking-tight text-[#e5e2e1] sm:text-base">{bookTitle}</h1>
                <p className="font-karla truncate text-[11px] text-[#ffb955]/90">
                  {pages[currentPage + 1]
                    ? `Pages ${currentPage + 1}–${currentPage + 2} of ${pageCount}`
                    : `Page ${currentPage + 1} of ${pageCount}`}
                </p>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 lg:flex">
              <Users className="h-3.5 w-3.5 text-[#7ec8e8]" aria-hidden />
              <span className="text-[11px] font-bold tabular-nums text-stone-200">{participants.length}</span>
            </div>
            <div className="flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-950/30 px-2 py-1">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
              <span className="hidden text-[10px] font-bold uppercase tracking-wide text-emerald-200/90 sm:inline">Secure</span>
            </div>

            {/* Timer chip — mobile / when right panel hidden */}
            <div
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-all lg:hidden ${remaining <= 2 * 60 ? 'border-red-500/30 bg-red-950/40' : 'border-[#ffb955]/25 bg-[#644000]/35'}`}
              title={role === 'host' && !timerActive ? 'Tap to start timer' : undefined}
              onClick={role === 'host' && !timerActive ? handleStartTimer : undefined}
              style={role === 'host' && !timerActive ? { cursor: 'pointer' } : undefined}
            >
              <Timer className="h-3.5 w-3.5 text-[#ffb955]" />
              <span className="font-bold tabular-nums text-xs text-[#ffb955]">{fmtTime(remaining)}</span>
            </div>

            <span className={`hidden px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight rounded-full sm:inline-block ${role === 'host' ? 'bg-[#764f84] text-white' : 'bg-stone-800 text-stone-300'}`}>
              {role}
            </span>

            {role === 'host' && inviteToken && (
              <button
                type="button"
                onClick={handleCopyInviteLink}
                title="Copy invite link"
                className="hidden items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-[#e5e2e1] transition-colors hover:border-[#ffb955]/40 hover:bg-white/10 sm:flex"
              >
                {linkCopied ? <Check className="h-3.5 w-3.5 text-[#7fd89a]" /> : <Link2 className="h-3.5 w-3.5 text-[#ffb955]" />}
                <span className="hidden md:inline">{linkCopied ? 'Copied' : 'Invite'}</span>
              </button>
            )}

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setRoomPanelOpen(true)}
                aria-label="Room panel — video, chat, settings"
                className="flex h-9 w-9 items-center justify-center text-stone-400 transition-colors hover:text-white sm:hidden"
              >
                <SlidersHorizontal className="h-5 w-5" />
              </button>
              {role === 'host' && (
                <button
                  type="button"
                  onClick={() => setShowTransferModal(true)}
                  aria-label="Session menu"
                  className="hidden h-9 w-9 items-center justify-center text-stone-400 transition-colors hover:text-white sm:flex"
                >
                  <MoreHorizontal className="h-5 w-5" />
                </button>
              )}
              {role === 'host' ? (
                <button
                  type="button"
                  onClick={() => handleEndSession(false)}
                  className="rounded-full bg-[#93000a] px-3 py-1.5 text-[11px] font-bold text-[#ffdad6] transition-all hover:bg-[#93000a]/80 active:scale-95"
                >
                  End
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleEndSession(false)}
                  className="rounded-full bg-stone-800 px-3 py-1.5 text-[11px] font-bold text-stone-200 transition-all hover:bg-stone-700 active:scale-95"
                >
                  Leave
                </button>
              )}
            </div>
          </div>
        </header>

        <main className="relative flex h-full flex-1 overflow-hidden pt-16">

          {roomPanelOpen && (
            <button
              type="button"
              aria-label="Close room panel"
              className="fixed inset-0 z-[65] bg-black/50 backdrop-blur-[2px]"
              onClick={() => setRoomPanelOpen(false)}
            />
          )}

          {roomPanelOpen && (
            <div
              className="fixed bottom-0 left-0 right-0 z-[70] flex max-h-[min(88dvh,640px)] flex-col rounded-t-3xl border border-white/10 bg-stone-900/98 shadow-[0_-20px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:left-auto sm:right-4 sm:top-24 sm:bottom-auto sm:max-h-[calc(100vh-7rem)] sm:w-[min(100vw-2rem,380px)] sm:rounded-3xl"
              role="dialog"
              aria-label="Reading session room"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
                <div>
                  <h3 className="text-base font-bold text-stone-100">Session</h3>
                  <p className="text-[11px] text-stone-400">Video, chat &amp; settings</p>
                </div>
                <button
                  type="button"
                  onClick={() => setRoomPanelOpen(false)}
                  aria-label="Close"
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-stone-400 transition-colors hover:bg-stone-800 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/5 px-3 py-2">
                {tabs.map((tab) => {
                  const TabIcon = TAB_ICONS[tab.id];
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex min-w-0 shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold transition-all ${activeTab === tab.id ? 'bg-[#764f84]/45 text-white ring-1 ring-[#ffb955]/35' : 'text-stone-400 hover:bg-stone-800/50 hover:text-stone-200'}`}
                    >
                      <TabIcon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="truncate">{tab.label}</span>
                    </button>
                  );
                })}
              </nav>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {activeTab === 'video' && <ParticipantList hostIdentity={hostIdentity} />}

                {activeTab === 'participants' && <ParticipantRoster hostIdentity={hostIdentity} />}

                {activeTab === 'tools' && (
                  <div className="space-y-4 px-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-stone-400">Drawing</p>
                    <p className="text-xs leading-relaxed text-stone-500">
                      Use the toolbar under the book. <span className="font-semibold text-stone-300">Book</span> is the default for page turns; choose{' '}
                      <span className="font-semibold text-stone-300">Pen</span> to draw.
                    </p>
                    <div className="space-y-3">
                      <div>
                        <p className="mb-2 text-[10px] uppercase tracking-widest text-stone-500">Brush size</p>
                        <div
                          className="h-2 cursor-pointer overflow-hidden rounded-full bg-stone-800"
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
                            setAnnBrush(Math.round(2 + pct * 30));
                          }}
                        >
                          <div
                            className="h-full rounded-full bg-[#f0c75e]"
                            style={{ width: `${((annBrush - 2) / 30) * 100}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[10px] text-stone-500">{annBrush}px</p>
                      </div>
                      <div>
                        <p className="mb-2 text-[10px] uppercase tracking-widest text-stone-500">Color</p>
                        <div className="flex flex-wrap gap-2">
                          {['#ef4444', '#f0c75e', '#22c55e', '#3b82f6', '#a855f7'].map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => setAnnColor(c)}
                              className={`h-7 w-7 rounded-full transition-all ${annColor === c ? 'scale-110 ring-2 ring-white/60' : ''}`}
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'chat' && (
                  <div className="flex h-full flex-col" style={{ minHeight: '200px' }}>
                    <div className="mb-3 flex-1 space-y-2 overflow-y-auto pr-1">
                      {chatMessages.length === 0 && (
                        <p className="pt-4 text-center text-xs text-stone-500">No messages yet. Say hi!</p>
                      )}
                      {chatMessages.map((m) => (
                        <div key={m.id} className={`flex flex-col ${m.self ? 'items-end' : 'items-start'}`}>
                          <span className="mb-0.5 px-1 text-[10px] text-stone-500">{m.from}</span>
                          <div
                            className={`max-w-[90%] break-words rounded-2xl px-3 py-2 text-sm ${m.self ? 'rounded-br-sm bg-[#764f84] text-white' : 'rounded-bl-sm bg-stone-800 text-stone-100'}`}
                          >
                            {m.text}
                          </div>
                        </div>
                      ))}
                      <div ref={chatEndRef} />
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') sendChat();
                        }}
                        placeholder="Type a message…"
                        className="flex-1 rounded-xl bg-stone-800 px-3 py-2 text-sm text-stone-100 outline-none placeholder-stone-600 focus:ring-1 focus:ring-[#764f84]"
                      />
                      <button
                        type="button"
                        onClick={sendChat}
                        className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#764f84] text-white transition-colors hover:bg-[#9b6cb0]"
                      >
                        <Rocket className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}

                {activeTab === 'settings' && (
                  <div className="space-y-3 px-1">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-stone-400">Session settings</p>
                    <p className="text-xs leading-relaxed text-stone-500">
                      Up to {MAX_LIVEKIT_ROOM_PARTICIPANTS} people can be in this live room at once (including the host).
                    </p>
                    {role === 'host' && !timerActive && (
                      <button
                        type="button"
                        onClick={handleStartTimer}
                        className="flex w-full items-center gap-3 rounded-xl bg-stone-800/50 px-4 py-3 text-sm font-semibold text-stone-200 transition-colors hover:bg-stone-700/50"
                      >
                        <Timer className="h-4 w-4 text-[#f0c75e]" />
                        Start session timer
                      </button>
                    )}
                    {role === 'host' && (
                      <button
                        type="button"
                        onClick={() => setShowTransferModal(true)}
                        className="flex w-full items-center gap-3 rounded-xl bg-stone-800/50 px-4 py-3 text-sm font-semibold text-stone-200 transition-colors hover:bg-stone-700/50"
                      >
                        <Users className="h-4 w-4 text-[#3b85a6]" />
                        Transfer host
                      </button>
                    )}
                    {role === 'host' && (
                      <button
                        type="button"
                        onClick={() => router.push(`/session/${sessionId}/activity?bookId=${bookId}`)}
                        className="flex w-full items-center gap-3 rounded-xl bg-stone-800/50 px-4 py-3 text-sm font-semibold text-stone-200 transition-colors hover:bg-stone-700/50"
                      >
                        <Star className="h-4 w-4 text-[#c84a71]" />
                        Open activity
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="shrink-0 space-y-3 border-t border-stone-700/50 p-4">
                <div className="flex items-center justify-between">
                  <LocalControls />
                </div>
                {role === 'host' && (
                  <button
                    type="button"
                    onClick={() => handleEndSession(false)}
                    className="font-baloo w-full rounded-full bg-gradient-to-br from-[#3d3b62] to-[#764f84] py-3 text-sm font-bold text-white shadow-xl transition-all active:scale-95"
                  >
                    End session
                  </button>
                )}
              </div>
            </div>
          )}
          {/* ── Main area ────────────────────────────────────────────────────── */}
          <section className="relative ml-0 flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0F0F0F] pb-40 md:pb-44 md:pr-72">
            <ConnectionBanner />
            <TimerWarning remaining={remaining} />

            {/* ── Timer end-state modal (host only) ─────────────────────────── */}
            {showExtendModal && role === 'host' && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
                <div className="bg-white rounded-2xl p-8 shadow-2xl max-w-sm w-full mx-4 text-center space-y-4">
                  <div className="text-4xl">⏰</div>
                  <h2 className="font-baloo text-xl font-bold text-[#3d3b62]">Time&apos;s up!</h2>
                  <p className="text-stone-500 text-sm">The 20-minute session has ended. Would you like to add 5 more minutes or end the session now?</p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        if (extendCountdownRef.current) clearTimeout(extendCountdownRef.current);
                        setShowExtendModal(false);
                        // Extend by 5 minutes
                        timerStartedAtRef.current = Date.now() - (SESSION_DURATION_S - 5 * 60) * 1000;
                        setRemaining(5 * 60);
                        setTimerActive(true);
                      }}
                      className="flex-1 font-baloo py-2.5 bg-[#3d3b62] text-white font-bold text-sm rounded-xl hover:bg-[#764f84] transition-all"
                    >
                      +5 min
                    </button>
                    <button
                      onClick={() => {
                        if (extendCountdownRef.current) clearTimeout(extendCountdownRef.current);
                        setShowExtendModal(false);
                        handleEndSession(true);
                      }}
                      className="flex-1 font-baloo py-2.5 bg-red-50 text-red-700 font-bold text-sm rounded-xl border border-red-200 hover:bg-red-100 transition-all"
                    >
                      End session
                    </button>
                  </div>
                  <p className="text-[10px] text-stone-400">Auto-ending in 15 seconds if no action taken</p>
                </div>
              </div>
            )}

            {/* Book viewer + bottom navigation (read-along layout) */}
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 py-4 sm:px-5 sm:py-5">
                <TransformWrapper
                  ref={transformRef}
                  initialScale={1}
                  minScale={0.85}
                  maxScale={2.5}
                  centerOnInit
                  wheel={{
                    step: 0.12,
                    smoothStep: 0.02,
                    disabled: blockZoomGesturesWhileDrawing,
                  }}
                  pinch={{ disabled: blockZoomGesturesWhileDrawing }}
                  panning={{ disabled: blockZoomGesturesWhileDrawing }}
                  doubleClick={{ disabled: true }}
                  onTransformed={scheduleCanvasRecalcAfterTransform}
                  onInit={scheduleCanvasRecalcAfterTransform}
                >
                  <TransformComponent
                    wrapperClass="w-full max-w-5xl !overflow-visible"
                    contentClass="w-full"
                  >
                    <div className="group relative flex aspect-[4/3] w-full overflow-hidden rounded-2xl bg-white shadow-[0_50px_100px_-20px_rgba(0,0,0,0.7)]">

                      {loadingPages ? (
                        <div className="flex flex-1 items-center justify-center bg-stone-100">
                          <div className="flex flex-col items-center gap-3 text-stone-400">
                            <Loader2 className="h-12 w-12 animate-spin" />
                            <span className="text-sm font-medium">Loading book…</span>
                          </div>
                        </div>
                      ) : pages.length === 0 ? (
                        <div className="flex flex-1 items-center justify-center bg-stone-50">
                          <div className="flex flex-col items-center gap-3 p-12 text-center text-stone-400">
                            <Loader2 className="h-12 w-12 animate-spin" />
                            <p className="font-medium text-stone-500">Loading placeholder book…</p>
                          </div>
                        </div>
                      ) : (
                        <div
                          ref={bookMeasureRef}
                          className="relative flex min-h-0 w-full flex-1 items-stretch justify-center overflow-hidden"
                        >
                          {!flipBookClientReady || bookRect.w < 64 || bookRect.h < 48 ? (
                            <div className="flex min-h-[240px] w-full flex-1 items-center justify-center bg-white">
                              <Loader2 className="h-10 w-10 animate-spin text-stone-300" aria-hidden />
                              <span className="sr-only">Preparing book viewer…</span>
                            </div>
                          ) : (
                            <>
                              <HTMLFlipBook
                                ref={flipRef}
                                className="touch-none"
                                style={{}}
                                width={bookRect.w}
                                height={bookRect.h}
                                size="fixed"
                                minWidth={bookRect.w}
                                maxWidth={bookRect.w}
                                minHeight={bookRect.h}
                                maxHeight={bookRect.h}
                                startPage={0}
                                drawShadow
                                flippingTime={650}
                                usePortrait={false}
                                startZIndex={0}
                                autoSize={false}
                                maxShadowOpacity={0.42}
                                showCover={false}
                                mobileScrollSupport={false}
                                clickEventForward
                                useMouseEvents={role === 'host'}
                                swipeDistance={30}
                                showPageCorners={role === 'host'}
                                disableFlipByClick={false}
                                onFlip={onBookFlip}
                                onInit={onBookInit}
                                onChangeState={onBookChangeState}
                              >
                                {spreadItems.map((sp) => (
                                  <FlipBookSpreadPage
                                    key={sp.leftPageNumber}
                                    left={sp.left}
                                    right={sp.right}
                                    leftPageNumber={sp.leftPageNumber}
                                  />
                                ))}
                              </HTMLFlipBook>
                              <div
                                className={`absolute inset-0 z-[15] transition-opacity duration-150 ${
                                  bookFlipVisualState === 'flipping'
                                    ? 'pointer-events-none opacity-0'
                                    : 'opacity-100'
                                }`}
                              >
                                <AnnotationCanvas
                                  ref={canvasRef}
                                  tool={annTool}
                                  color={annColor}
                                  brushSize={annBrush}
                                  drawingEnabled={drawingEnabled}
                                  onSync={handleCanvasSync}
                                />
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      <div className="pointer-events-none absolute inset-y-0 left-1/2 z-[5] w-6 -translate-x-1/2 bg-gradient-to-r from-stone-900/5 via-stone-900/12 to-stone-900/5" />
                    </div>
                  </TransformComponent>
                </TransformWrapper>
              </div>

              <nav
                aria-label="Book navigation"
                className="shrink-0 border-t border-white/5 bg-gradient-to-t from-[#0c0c0c] to-[#141414] px-3 py-3 sm:px-5"
              >
                <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    {role === 'host' ? (
                      <button
                        type="button"
                        onClick={hostFlipPrev}
                        disabled={currentPage <= 0}
                        className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-bold text-stone-200 transition-all hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        Previous
                      </button>
                    ) : (
                      <span className="text-[11px] font-medium text-stone-500">Host turns pages</span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <div className="rounded-full border border-stone-700/80 bg-stone-950/50 px-4 py-2 text-xs font-semibold text-stone-300">
                      {pages[currentPage + 1] ? (
                        <>Pages {currentPage + 1}–{currentPage + 2} of {pageCount}</>
                      ) : (
                        <>Page {currentPage + 1} of {pageCount}</>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label="Fit page to view"
                      onClick={() => {
                        transformRef.current?.resetTransform(200);
                        setTimeout(() => scheduleCanvasRecalcAfterTransform(), 220);
                      }}
                      className="flex h-10 w-10 items-center justify-center rounded-full border border-stone-700/80 bg-stone-900/60 text-stone-300 transition-colors hover:bg-stone-800 hover:text-white"
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <div className="flex items-center gap-0.5 rounded-full border border-stone-800/80 bg-stone-950/60 p-1">
                      <button
                        type="button"
                        aria-label="Zoom out"
                        onClick={() => transformRef.current?.zoomOut(0.15, 200)}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
                      >
                        <ZoomOut className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Zoom in"
                        onClick={() => transformRef.current?.zoomIn(0.15, 200)}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
                      >
                        <ZoomIn className="h-4 w-4" />
                      </button>
                    </div>
                    {role === 'host' && (
                      <button
                        type="button"
                        onClick={hostFlipNext}
                        disabled={currentPage >= pageCount - 2}
                        className="rounded-full bg-[#764f84] px-6 py-2.5 text-xs font-extrabold uppercase tracking-wide text-white shadow-lg shadow-[#764f84]/25 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        Next
                      </button>
                    )}
                  </div>
                </div>
              </nav>
            </div>
          </section>

          {/* Right panel — timer + participants + status (desktop) */}
          <aside
            className="fixed right-0 top-16 z-30 hidden w-72 flex-col gap-4 border-l border-white/5 bg-[#121018]/92 p-4 pb-24 backdrop-blur-xl md:flex"
            style={{ height: 'calc(100vh - 4rem)' }}
          >
            <SessionTimerRing
              remaining={remaining}
              totalSecs={SESSION_DURATION_S}
              timerActive={timerActive}
              role={role}
              onStart={handleStartTimer}
            />
            {remaining <= 5 * 60 && timerActive && (
              <p className="text-center text-[11px] font-semibold text-[#ffb955]">
                {remaining <= 2 * 60 ? 'Wrapping up soon' : 'Five minutes left'}
              </p>
            )}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <p className="mb-2 shrink-0 text-[10px] font-bold uppercase tracking-widest text-stone-500">Participants</p>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <ParticipantList hostIdentity={hostIdentity} />
              </div>
            </div>
            <div className="shrink-0 rounded-2xl border border-[#3b85a6]/35 bg-gradient-to-br from-[#3b85a6]/25 to-[#764f84]/20 p-4 shadow-lg">
              <p className="text-xs font-bold text-[#9dd4f0]">
                You are the {role === 'host' ? 'host' : 'guest'}
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-stone-300">
                {role === 'host'
                  ? 'You control page turns and the session timer. Guests follow along; they can use Pen mode to draw on the spread.'
                  : 'Follow the host’s page turns. Use Book mode to focus on the page; tap Pen when you want to doodle.'}
              </p>
              {activities.length > 0 && role === 'host' && (
                <button
                  type="button"
                  onClick={() => router.push(`/session/${sessionId}/activity?bookId=${bookId}`)}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 py-2.5 text-[11px] font-bold text-white transition-colors hover:bg-white/15"
                >
                  <Gamepad2 className="h-4 w-4" />
                  Activities
                </button>
              )}
            </div>
          </aside>
        </main>

        {/* Fixed bottom: annotation tools + session dock (pointer-events-none on shell so the book stays clickable between rows) */}
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-[58] flex w-full max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-col items-stretch gap-2">
          <div className="pointer-events-auto w-full min-w-0 px-0 sm:px-0">
            <AnnotationToolbar
              interactionMode={interactionMode}
              onInteractionModeChange={setInteractionMode}
              color={annColor}
              brushSize={annBrush}
              onColorChange={setAnnColor}
              onBrushSizeChange={setAnnBrush}
              onClear={handleClearCanvas}
              onUndo={() => canvasRef.current?.undo()}
              onReaction={handleReaction}
              tooltipPlacement="below"
              className="w-full min-w-0"
            />
          </div>
          <div className="pointer-events-auto flex max-w-full items-center justify-center gap-2 self-center rounded-full border border-white/10 bg-stone-950/90 px-2 py-2.5 shadow-2xl backdrop-blur-xl sm:gap-4 sm:px-5 sm:py-3">
            <SessionMediaDock />
            <div className="mx-1 h-10 w-px shrink-0 bg-white/10 sm:mx-2" aria-hidden />
            {role === 'host' && inviteToken && (
              <button
                type="button"
                onClick={handleCopyInviteLink}
                aria-label="Copy invite link"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-teal-500/40 bg-teal-950/40 text-teal-200 transition-all hover:bg-teal-900/50 sm:h-14 sm:w-14"
              >
                {linkCopied ? <Check className="h-5 w-5 sm:h-6 sm:w-6" /> : <Copy className="h-5 w-5 sm:h-6 sm:w-6" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setRoomPanelOpen(true);
                setActiveTab('video');
              }}
              aria-label="Open participants and video"
              className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-orange-400/45 bg-orange-950/35 text-orange-200 transition-all hover:bg-orange-900/45 sm:h-14 sm:w-14"
            >
              <Users className="h-5 w-5 sm:h-6 sm:w-6" />
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-400 px-1 text-[9px] font-bold text-stone-900">
                {participants.length}
              </span>
            </button>
            {role === 'host' && (
              <button
                type="button"
                onClick={() => router.push(`/session/${sessionId}/activity?bookId=${bookId}`)}
                aria-label="Open activities"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-pink-400/45 bg-pink-950/35 text-pink-200 transition-all hover:bg-pink-900/40 sm:h-14 sm:w-14"
              >
                <Gamepad2 className="h-5 w-5 sm:h-6 sm:w-6" />
              </button>
            )}
            <button
              type="button"
              onClick={() => handleEndSession(false)}
              aria-label={role === 'host' ? 'End session' : 'Leave session'}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-red-500/50 bg-red-950/50 text-red-200 transition-all hover:bg-red-900/60 sm:h-14 sm:w-14"
            >
              <Phone className="h-5 w-5 sm:h-6 sm:w-6 rotate-[135deg]" />
            </button>
          </div>
        </div>

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
  const [inviteToken, setInviteToken] = useState<string | null>(null);

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
        setInviteToken(s.invite_token ?? null);
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
          inviteToken={inviteToken}
          onEnd={() => router.push('/dashboard')}
        />
      </LiveKitRoom>
    </>
  );
}
