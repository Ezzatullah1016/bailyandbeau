'use client';

import dynamic from 'next/dynamic';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { MutableRefObject } from 'react';
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
import { ConnectionState, RoomEvent, Track, type Room } from 'livekit-client';
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
import { BrandLogo } from '@/components/brand/BrandLogo';
import type { ActivityConfigData } from '@/components/activity/types';
import { AnnotationToolbar, DockTip, type ReadingInteractionMode } from '@/components/annotation/AnnotationToolbar';
import type { AnnotationCanvasHandle } from '@/components/annotation/AnnotationCanvas';
import { SpreadBookViewer } from '@/components/reading/SpreadBookViewer';
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';
import {
  AlarmClock,
  BookMarked,
  BookOpen,
  ChevronLeft,
  ChevronRight,
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
  GripVertical,
  Phone,
  MoreHorizontal,
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

const ANNOTATION_SNAPSHOT_VERSION = 1 as const;

function buildAnnotationSnapshot(bySpread: Record<string, string>): Record<string, unknown> {
  return { v: ANNOTATION_SNAPSHOT_VERSION, bySpread: { ...bySpread } };
}

function mergeHydratedAnnotationIntoSpreadMap(
  spreadInkRef: MutableRefObject<Record<string, string>>,
  raw: unknown,
) {
  if (!raw || typeof raw !== 'object') return;
  const ann = raw as Record<string, unknown>;
  const bs = ann.bySpread;
  if (ann.v === ANNOTATION_SNAPSHOT_VERSION && bs && typeof bs === 'object' && !Array.isArray(bs)) {
    for (const [k, v] of Object.entries(bs as Record<string, unknown>)) {
      if (typeof v === 'string') spreadInkRef.current[k] = v;
    }
    return;
  }
  // Legacy: snapshot stored/fabric JSON object for a single canvas
  try {
    const keys = Object.keys(ann);
    if (keys.length > 0) spreadInkRef.current['0'] = JSON.stringify(ann);
  } catch {
    /* ignore */
  }
}

// ─── Timer helpers ────────────────────────────────────────────────────────────

const SESSION_DURATION_S = 20 * 60; // 20 minutes

function fmtTime(secs: number) {
  const m = Math.floor(Math.max(0, secs) / 60);
  const s = Math.max(0, secs) % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function roleFromParticipantMetadata(metadata: string | undefined): string {
  try {
    if (!metadata) return '';
    const o = JSON.parse(metadata) as { role?: unknown };
    return String(o.role ?? '').toLowerCase();
  } catch {
    return '';
  }
}

function resolveHostParticipantIdentity(room: Room, viewerRole: 'host' | 'guest'): string | undefined {
  if (viewerRole === 'host') return room.localParticipant.identity;
  for (const p of room.remoteParticipants.values()) {
    const r = roleFromParticipantMetadata(p.metadata);
    if (r.includes('host')) return p.identity;
  }
  return undefined;
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

/** Wraps AnnotationToolbar and injects LiveKit mic/camera state */
function UnifiedBar(props: Omit<Parameters<typeof AnnotationToolbar>[0], 'isMicEnabled' | 'isCameraEnabled' | 'onToggleMic' | 'onToggleCamera'>) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  return (
    <AnnotationToolbar
      {...props}
      isMicEnabled={isMicrophoneEnabled}
      isCameraEnabled={isCameraEnabled}
      onToggleMic={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
      onToggleCamera={() => localParticipant.setCameraEnabled(!isCameraEnabled)}
    />
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
            {timerActive ? 'remaining' : role === 'host' ? 'starts live' : 'waiting'}
          </span>
        </div>
      </div>
      <p className="text-center text-[10px] font-bold uppercase tracking-widest text-stone-500">
        {timerActive ? 'Reading' : 'Session'}
      </p>
    </div>
  );
}

// ─── Book spreads (two-up) ───────────────────────────────────────────────────

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
  const clampedSpreadIndex = useMemo(
    () => Math.min(Math.max(0, Math.floor(currentPage / 2)), Math.max(0, spreadItems.length - 1)),
    [currentPage, spreadItems.length],
  );
  const activeSpread = spreadItems[clampedSpreadIndex];
  const [activeTab, setActiveTab] = useState<'video' | 'tools' | 'participants' | 'chat' | 'settings'>('video');
  const [roomPanelOpen, setRoomPanelOpen] = useState(false);

  // ── Timer ─────────────────────────────────────────────────────────────────
  const [timerActive, setTimerActive] = useState(false);
  const [remaining, setRemaining] = useState(SESSION_DURATION_S);
  const remainingRef = useRef(remaining);
  remainingRef.current = remaining;
  const timerActiveRef = useRef(timerActive);
  timerActiveRef.current = timerActive;
  /** Host publishes TIMER_START automatically once after connect so guests stay in sync; manual start also sets this. */
  const hostTimerAutoKickRef = useRef(false);
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
  const spreadInkRef = useRef<Record<string, string>>({});
  const annotationPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [bookRect, setBookRect] = useState({ w: 720, h: 540 });
  const bookMeasureRef = useRef<HTMLDivElement>(null);
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
      const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
      const chromeReserve = 200;
      const rhCapByVh = Math.floor(Math.min(vh * 0.8, Math.max(0, vh - chromeReserve)));
      const rhByAspect = Math.floor((rw * 3) / 4);
      const rh = Math.max(240, Math.min(rhCapByVh, rhByAspect));
      setBookRect((prev) => (prev.w !== rw || prev.h !== rh ? { w: rw, h: rh } : prev));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loadingPages, spreadItems.length]);

  /** Page/zoom pill: anchored bottom-right; x increases `right` (moves bar left). */
  const bookHudStorageKey = `bb_reading_pagebar_${sessionId}`;
  const [bookHudOffset, setBookHudOffset] = useState({ x: 0, y: 0 });
  const bookHudOffsetRef = useRef(bookHudOffset);
  bookHudOffsetRef.current = bookHudOffset;
  const hudDragSessionRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(
    null,
  );
  const bookHudRestoredRef = useRef(false);

  /** Bottom AnnotationToolbar: anchored bottom-left; persisted via sessionStorage. */
  const dockHudStorageKey = `bb_reading_dock_${sessionId}`;
  const [dockHudOffset, setDockHudOffset] = useState({ x: 0, y: 0 });
  const dockHudOffsetRef = useRef(dockHudOffset);
  dockHudOffsetRef.current = dockHudOffset;
  const dockHudDragSessionRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const dockHudRestoredRef = useRef(false);
  const readingHudBoundsRef = useRef<HTMLDivElement>(null);
  const [readingHudSize, setReadingHudSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = readingHudBoundsRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setReadingHudSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clampBookHud = useCallback(
    (x: number, y: number) => {
      const W = readingHudSize.w;
      const H = readingHudSize.h;
      if (W < 64 || H < 64) {
        return { x, y };
      }
      const barReserve = 140;
      const maxRightOffset = Math.max(48, W - barReserve);
      const minRightOffset = -48;
      const maxYup = Math.max(56, H - 28);
      return {
        x: Math.min(maxRightOffset, Math.max(minRightOffset, x)),
        y: Math.min(maxYup, Math.max(-Math.min(100, H * 0.2), y)),
      };
    },
    [readingHudSize.w, readingHudSize.h],
  );

  const clampDockHud = useCallback((x: number, y: number) => {
    if (typeof window === 'undefined') return { x, y };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 10;
    return {
      x: Math.min(vw - pad - 64, Math.max(-vw * 0.4, x)),
      y: Math.min(vh - pad - 56, Math.max(-vh * 0.35, y)),
    };
  }, []);

  useEffect(() => {
    if (bookHudRestoredRef.current || readingHudSize.w < 80 || readingHudSize.h < 80) return;
    bookHudRestoredRef.current = true;
    try {
      const raw = sessionStorage.getItem(bookHudStorageKey);
      if (!raw) return;
      const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
      if (typeof p.x === 'number' && typeof p.y === 'number') {
        const next = clampBookHud(p.x, p.y);
        bookHudOffsetRef.current = next;
        setBookHudOffset(next);
      }
    } catch {
      /* ok */
    }
  }, [bookHudStorageKey, readingHudSize.w, readingHudSize.h, clampBookHud]);

  useEffect(() => {
    if (dockHudRestoredRef.current) return;
    dockHudRestoredRef.current = true;
    try {
      const raw = sessionStorage.getItem(dockHudStorageKey);
      if (!raw) return;
      const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
      if (typeof p.x === 'number' && typeof p.y === 'number') {
        const next = clampDockHud(p.x, p.y);
        dockHudOffsetRef.current = next;
        setDockHudOffset(next);
      }
    } catch {
      /* ok */
    }
  }, [dockHudStorageKey, clampDockHud]);

  useEffect(() => {
    setBookHudOffset((o) => {
      const c = clampBookHud(o.x, o.y);
      bookHudOffsetRef.current = c;
      return c;
    });
  }, [clampBookHud]);

  useEffect(() => {
    setDockHudOffset((o) => {
      const c = clampDockHud(o.x, o.y);
      dockHudOffsetRef.current = c;
      return c;
    });
  }, [clampDockHud]);

  const onBookHudGripDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const o = bookHudOffsetRef.current;
      hudDragSessionRef.current = { startX: e.clientX, startY: e.clientY, ox: o.x, oy: o.y };
      const move = (ev: PointerEvent) => {
        const s = hudDragSessionRef.current;
        if (!s) return;
        const dx = ev.clientX - s.startX;
        const dy = s.startY - ev.clientY;
        const next = clampBookHud(s.ox - dx, s.oy + dy);
        bookHudOffsetRef.current = next;
        setBookHudOffset(next);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        hudDragSessionRef.current = null;
        try {
          sessionStorage.setItem(bookHudStorageKey, JSON.stringify(bookHudOffsetRef.current));
        } catch {
          /* ok */
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    [bookHudStorageKey, clampBookHud],
  );

  const resetBookHudPosition = useCallback(() => {
    const z = { x: 0, y: 0 };
    bookHudOffsetRef.current = z;
    setBookHudOffset(z);
    try {
      sessionStorage.removeItem(bookHudStorageKey);
    } catch {
      /* ok */
    }
  }, [bookHudStorageKey]);

  const onDockHudGripDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const o = dockHudOffsetRef.current;
      dockHudDragSessionRef.current = { startX: e.clientX, startY: e.clientY, ox: o.x, oy: o.y };
      const move = (ev: PointerEvent) => {
        const s = dockHudDragSessionRef.current;
        if (!s) return;
        const dx = ev.clientX - s.startX;
        const dy = s.startY - ev.clientY;
        const next = clampDockHud(s.ox + dx, s.oy + dy);
        dockHudOffsetRef.current = next;
        setDockHudOffset(next);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        dockHudDragSessionRef.current = null;
        try {
          sessionStorage.setItem(dockHudStorageKey, JSON.stringify(dockHudOffsetRef.current));
        } catch {
          /* ok */
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    [dockHudStorageKey, clampDockHud],
  );

  const resetDockHudPosition = useCallback(() => {
    const z = { x: 0, y: 0 };
    dockHudOffsetRef.current = z;
    setDockHudOffset(z);
    try {
      sessionStorage.removeItem(dockHudStorageKey);
    } catch {
      /* ok */
    }
  }, [dockHudStorageKey]);

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
  const spreadCoverPrefsKey = `bb_spread_cover_${sessionId}`;
  const [spreadPageCover, setSpreadPageCover] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const v = localStorage.getItem(spreadCoverPrefsKey);
      setSpreadPageCover(v === '1');
    } catch {
      /* ok */
    }
  }, [spreadCoverPrefsKey]);

  const setSpreadPageCoverPersisted = useCallback(
    (v: boolean) => {
      setSpreadPageCover(v);
      try {
        localStorage.setItem(spreadCoverPrefsKey, v ? '1' : '0');
      } catch {
        /* ok */
      }
    },
    [spreadCoverPrefsKey],
  );

  const [activityOpen, setActivityOpen] = useState(false);
  const [activityIndex, setActivityIndex] = useState(0);
  const [activityStateByActivity, setActivityStateByActivity] = useState<Record<string, Record<string, unknown>>>(
    {},
  );
  const activitySnapshotRef = useRef<Record<string, unknown>>({});

  const flushCurrentSpreadInk = useCallback(() => {
    const fi = Math.floor(currentPageRef.current / 2);
    const c = canvasRef.current;
    if (!c) return;
    try {
      spreadInkRef.current[String(fi)] = c.getJSON();
    } catch {
      /* ok */
    }
  }, []);

  const scheduleAnnotationPersist = useCallback(() => {
    if (role !== 'host') return;
    if (annotationPersistTimerRef.current) clearTimeout(annotationPersistTimerRef.current);
    annotationPersistTimerRef.current = setTimeout(() => {
      annotationPersistTimerRef.current = null;
      flushCurrentSpreadInk();
      updateSnapshot(
        sessionId,
        participantId,
        currentPageRef.current + 1,
        { remaining_seconds: remainingRef.current },
        buildAnnotationSnapshot(spreadInkRef.current),
        activitySnapshotRef.current as object,
      ).catch(() => {});
    }, 400);
  }, [role, sessionId, participantId, flushCurrentSpreadInk]);

  useEffect(
    () => () => {
      if (annotationPersistTimerRef.current) clearTimeout(annotationPersistTimerRef.current);
    },
    [],
  );

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
        if (snap?.annotation_state) mergeHydratedAnnotationIntoSpreadMap(spreadInkRef, snap.annotation_state);
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

  /** Guests follow the host's page from the shared session snapshot as well as LiveKit PAGE_TURN.
   *  Polling covers cases where data packets are delayed or dropped, so spreads still advance. */
  useEffect(() => {
    if (role !== 'guest') return;
    let cancelled = false;
    const syncPageFromSession = () => {
      if (cancelled) return;
      getSnapshot(sessionId, participantId)
        .then((snap) => {
          if (cancelled || !snap || typeof snap.page_number !== 'number' || snap.page_number < 1) return;
          const serverIndex0 = snap.page_number - 1;
          if (serverIndex0 === currentPageRef.current) return;
          if (snap.annotation_state) mergeHydratedAnnotationIntoSpreadMap(spreadInkRef, snap.annotation_state);
          setCurrentPage(serverIndex0);
        })
        .catch(() => {});
    };
    syncPageFromSession();
    const id = window.setInterval(syncPageFromSession, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [role, sessionId, participantId]);

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
            const spreadCanvas =
              typeof msg.payload.spread_canvas === 'string'
                ? msg.payload.spread_canvas
                : spreadInkRef.current[String(fi)] ?? '{}';
            spreadInkRef.current[String(fi)] = spreadCanvas;
            setCurrentPage(left);
          }
          break;

        case 'CANVAS_SYNC': {
          const si =
            typeof msg.payload.spread_index === 'number' ? msg.payload.spread_index : undefined;
          const curFi = Math.floor(currentPageRef.current / 2);
          if (si !== undefined && si !== curFi) break;
          if (typeof msg.payload.json === 'string') {
            canvasRef.current?.loadRemoteJSON(msg.payload.json);
            if (si !== undefined) spreadInkRef.current[String(si)] = msg.payload.json;
          }
          break;
        }

        case 'CANVAS_CLEAR': {
          const si =
            typeof msg.payload.spread_index === 'number'
              ? msg.payload.spread_index
              : Math.floor(currentPageRef.current / 2);
          const curFi = Math.floor(currentPageRef.current / 2);
          if (si !== curFi) break;
          delete spreadInkRef.current[String(si)];
          canvasRef.current?.clearCanvas(false);
          break;
        }

        case 'TIMER_START': {
          const raw = msg.payload.started_at;
          const ts = typeof raw === 'number' && Number.isFinite(raw) ? raw : Date.now();
          timerStartedAtRef.current = ts;
          setTimerActive(true);
          const elapsed = Math.max(0, Math.floor((Date.now() - ts) / 1000));
          setRemaining(Math.max(0, SESSION_DURATION_S - elapsed));
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
    async (left: number, spreadCanvasForGuests: string) => {
      if (role !== 'host') return;
      const fi = Math.floor(left / 2);
      spreadInkRef.current[String(fi)] = spreadCanvasForGuests;
      room.localParticipant.publishData(
        buildMsg('PAGE_TURN', { page: left, spread_index: fi, spread_canvas: spreadCanvasForGuests }),
        { reliable: true },
      );
      try {
        await localParticipant.setMetadata(JSON.stringify({ page: left, role: 'host' }));
      } catch {
        /* ok */
      }
      updateSnapshot(sessionId, participantId, left + 1, undefined, buildAnnotationSnapshot(spreadInkRef.current)).catch(
        () => {},
      );
    },
    [role, room, localParticipant, sessionId, participantId],
  );

  const goToSpreadIndex = useCallback(
    (nextFi: number) => {
      const maxFi = Math.max(0, spreadItems.length - 1);
      const fi = Math.min(Math.max(0, nextFi), maxFi);
      const left = fi * 2;
      const prevFi = Math.floor(currentPageRef.current / 2);
      if (role === 'host' && canvasRef.current) {
        try {
          spreadInkRef.current[String(prevFi)] = canvasRef.current.getJSON();
        } catch {
          /* ok */
        }
      }
      setCurrentPage(left);
      if (role === 'host') {
        const loadJson = spreadInkRef.current[String(fi)] ?? '{}';
        broadcastPageTurn(left, loadJson);
      }
    },
    [role, spreadItems.length, broadcastPageTurn],
  );

  const hostFlipPrev = useCallback(() => {
    if (role !== 'host') return;
    const fi = Math.floor(currentPageRef.current / 2);
    if (fi <= 0) return;
    goToSpreadIndex(fi - 1);
  }, [role, goToSpreadIndex]);

  const hostFlipNext = useCallback(() => {
    if (role !== 'host') return;
    const maxFi = Math.max(0, spreadItems.length - 1);
    const fi = Math.floor(currentPageRef.current / 2);
    if (fi >= maxFi) return;
    goToSpreadIndex(fi + 1);
  }, [role, spreadItems.length, goToSpreadIndex]);

  useEffect(() => {
    if (loadingPages || spreadItems.length === 0) return;
    const fi = Math.min(Math.max(0, Math.floor(currentPage / 2)), spreadItems.length - 1);
    const json = spreadInkRef.current[String(fi)] ?? '{}';
    const id = requestAnimationFrame(() => {
      canvasRef.current?.loadRemoteJSON(json);
      scheduleCanvasRecalcAfterTransform();
    });
    return () => cancelAnimationFrame(id);
  }, [currentPage, spreadItems.length, loadingPages, scheduleCanvasRecalcAfterTransform]);

  // ── Annotation sync callback ──────────────────────────────────────────────
  const handleCanvasSync = useCallback(
    (json: string) => {
      const fi = Math.floor(currentPageRef.current / 2);
      spreadInkRef.current[String(fi)] = json;
      room.localParticipant.publishData(
        buildMsg('CANVAS_SYNC', { json, spread_index: fi }),
        { reliable: false },
      );
      if (role === 'host') scheduleAnnotationPersist();
    },
    [room, role, scheduleAnnotationPersist],
  );

  const handleClearCanvas = useCallback(() => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Erase all doodles on this page for everyone?')
    ) {
      return;
    }
    const fi = Math.floor(currentPageRef.current / 2);
    delete spreadInkRef.current[String(fi)];
    canvasRef.current?.clearCanvas(true);
    try {
      room.localParticipant.publishData(buildMsg('CANVAS_CLEAR', { spread_index: fi }), { reliable: true });
    } catch {
      /* ok */
    }
    if (role === 'host') scheduleAnnotationPersist();
  }, [room, role, scheduleAnnotationPersist]);

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

  const bumpLocalMediaTracks = useCallback(async () => {
    try {
      await localParticipant.setCameraEnabled(true);
      await localParticipant.setMicrophoneEnabled(true);
    } catch {
      /* hardware / permission — controls still usable */
    }
  }, [localParticipant]);

  const publishHostTimerKick = useCallback(() => {
    const now = Date.now();
    timerStartedAtRef.current = now;
    setTimerActive(true);
    setRemaining(SESSION_DURATION_S);
    void room.localParticipant.publishData(
      buildMsg('TIMER_START', { started_at: now }),
      { reliable: true },
    );
  }, [room]);

  useEffect(() => {
    function onConnected() {
      void bumpLocalMediaTracks();
      if (role !== 'host') return;
      if (timerActiveRef.current) {
        hostTimerAutoKickRef.current = true;
        return;
      }
      if (hostTimerAutoKickRef.current) return;
      hostTimerAutoKickRef.current = true;
      publishHostTimerKick();
    }

    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.Reconnected, bumpLocalMediaTracks);
    if (room.state === ConnectionState.Connected) {
      void onConnected();
    }
    return () => {
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.Reconnected, bumpLocalMediaTracks);
    };
  }, [room, role, bumpLocalMediaTracks, publishHostTimerKick]);

  // ── Host: start timer ─────────────────────────────────────────────────────
  const handleStartTimer = useCallback(() => {
    if (role !== 'host' || timerActive) return;
    hostTimerAutoKickRef.current = true;
    publishHostTimerKick();
  }, [role, timerActive, publishHostTimerKick]);

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

  const [hostIdentity, setHostIdentity] = useState<string | undefined>(() =>
    resolveHostParticipantIdentity(room, role),
  );
  useEffect(() => {
    function syncHostIdentity() {
      setHostIdentity((prev) => {
        const next = resolveHostParticipantIdentity(room, role);
        return prev !== next ? next : prev;
      });
    }
    syncHostIdentity();
    room.on(RoomEvent.ParticipantConnected, syncHostIdentity);
    room.on(RoomEvent.ParticipantDisconnected, syncHostIdentity);
    room.on(RoomEvent.Connected, syncHostIdentity);
    return () => {
      room.off(RoomEvent.ParticipantConnected, syncHostIdentity);
      room.off(RoomEvent.ParticipantDisconnected, syncHostIdentity);
      room.off(RoomEvent.Connected, syncHostIdentity);
    };
  }, [room, role]);

  /** Block left-drag pan + pinch on the book transform while annotating (avoids fighting the pen). Wheel zoom stays enabled. */
  const blockTransformPanPinchWhileDrawing = drawingEnabled;

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
            flushCurrentSpreadInk();
            updateSnapshot(
              sessionId,
              participantId,
              currentPage + 1,
              remaining,
              buildAnnotationSnapshot(spreadInkRef.current),
              closed,
            ).catch(() => {});
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
          flushCurrentSpreadInk();
          updateSnapshot(
            sessionId,
            participantId,
            currentPage + 1,
            remaining,
            buildAnnotationSnapshot(spreadInkRef.current),
            activityState,
          ).catch(() => {});
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

      <div className="relative isolate flex h-[100dvh] min-h-0 w-screen flex-col overflow-hidden bg-gradient-to-br from-[#3a3028] via-[#382f42] to-[#2c2636] pb-[env(safe-area-inset-bottom,0px)] text-[#e5e2e1]">
        {/* Warm ambient layers */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(255,219,164,0.12),transparent_55%)]"
        />
        <div aria-hidden className="pointer-events-none absolute inset-0 shadow-[inset_0_0_120px_rgba(10,8,14,0.55)]" />

        {/* ── Top nav — read-along style header ─────────────────────────────── */}
        <header className="fixed left-0 right-0 top-0 z-50 flex w-full items-center justify-between border-b border-white/5 bg-[#2a2838]/95 px-4 pb-2 pt-[max(8px,env(safe-area-inset-top))] shadow-lg backdrop-blur-xl sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-5">
            <BrandLogo variant="light" className="h-7 shrink-0 max-sm:max-w-[140px] sm:h-9" />
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
              title={
                role === 'host' && !timerActive
                  ? 'Session timer — starts automatically when connected; tap if you paused it.'
                  : undefined
              }
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

        <main className="relative flex h-full flex-1 overflow-hidden pt-[max(5rem,calc(4rem+env(safe-area-inset-top,0px)))]">

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
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-stone-800/35 px-3 py-3 text-sm text-stone-200 hover:bg-stone-800/50">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-stone-500 bg-stone-900 text-[#3b85a6] focus:ring-[#3b85a6]"
                        checked={spreadPageCover}
                        onChange={(e) => setSpreadPageCoverPersisted(e.target.checked)}
                      />
                      <span>
                        <span className="font-semibold text-stone-100">Fill spread to frame</span>
                        <span className="mt-1 block text-xs leading-relaxed text-stone-500">
                          Zooms pages to fill the spread area; margins may be cropped instead of showing letterboxing. Saved on this device only.
                        </span>
                      </span>
                    </label>
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
          <section className="relative ml-0 flex min-h-0 flex-1 flex-col overflow-hidden bg-[#171210]/95 pb-[calc(11rem+env(safe-area-inset-bottom,0px))] shadow-[inset_0_0_80px_rgba(0,0,0,0.35)] backdrop-blur-[1px] md:pb-[calc(12rem+env(safe-area-inset-bottom,0px))] md:pr-72">
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

            {/* Book viewer + on-book controls */}
            <div className="flex min-h-0 flex-1 flex-col">
              <div
                ref={readingHudBoundsRef}
                className="relative flex min-h-0 flex-1 items-center justify-center px-3 py-4 sm:px-5 sm:py-5"
              >
                <TransformWrapper
                  ref={transformRef}
                  initialScale={1}
                  minScale={0.85}
                  maxScale={2.5}
                  centerOnInit
                  wheel={{
                    step: 0.12,
                    smoothStep: 0.02,
                    disabled: false,
                  }}
                  pinch={{ disabled: blockTransformPanPinchWhileDrawing }}
                  panning={{ disabled: blockTransformPanPinchWhileDrawing }}
                  doubleClick={{ disabled: true }}
                  onTransformed={scheduleCanvasRecalcAfterTransform}
                  onInit={scheduleCanvasRecalcAfterTransform}
                >
                  <TransformComponent
                    wrapperClass="w-full max-w-5xl !overflow-visible"
                    contentClass="w-full"
                  >
                    <div
                      className={`group relative flex w-full max-w-5xl flex-col overflow-hidden rounded-[1.65rem] border border-black/50 bg-gradient-to-b from-[#e8dfd4] via-[#faf6ee] to-[#e6ded4] shadow-[0_52px_100px_-22px_rgba(5,5,12,0.88)] ${
                        loadingPages || pages.length === 0
                          ? 'min-h-[min(80vh,calc(100dvh-14rem))]'
                          : ''
                      }`}
                    >

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
                          className="relative box-border flex w-full shrink-0 justify-center overflow-hidden"
                          style={
                            bookRect.w < 64 || bookRect.h < 48
                              ? { minHeight: 240 }
                              : { height: bookRect.h, maxHeight: bookRect.h }
                          }
                        >
                          {bookRect.w < 64 || bookRect.h < 48 ? (
                            <div className="flex min-h-[240px] w-full flex-col items-center justify-center bg-white">
                              <Loader2 className="h-10 w-10 animate-spin text-stone-300" aria-hidden />
                              <span className="sr-only">Preparing book viewer…</span>
                            </div>
                          ) : activeSpread ? (
                            <>
                              <SpreadBookViewer
                                spread={activeSpread}
                                width={bookRect.w}
                                height={bookRect.h}
                                transitionKey={clampedSpreadIndex}
                                coverPages={spreadPageCover}
                                swipeEnabled={role === 'host' && interactionMode === 'book'}
                                onSwipePrev={hostFlipPrev}
                                onSwipeNext={hostFlipNext}
                              />
                              <div className="absolute inset-0 z-[15] opacity-100">
                                <AnnotationCanvas
                                  ref={canvasRef}
                                  tool={annTool}
                                  color={annColor}
                                  brushSize={annBrush}
                                  drawingEnabled={drawingEnabled}
                                  onSync={handleCanvasSync}
                                />
                              </div>
                              {role === 'host' && (
                                <>
                                  <button
                                    type="button"
                                    aria-label="Previous spread"
                                    onClick={hostFlipPrev}
                                    disabled={currentPage <= 0}
                                    className="pointer-events-auto absolute left-1.5 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-stone-400/50 bg-white/95 text-stone-800 shadow-md transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-35 sm:left-2 sm:h-10 sm:w-10"
                                  >
                                    <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label="Next spread"
                                    onClick={hostFlipNext}
                                    disabled={currentPage >= pageCount - 2}
                                    className="pointer-events-auto absolute right-1.5 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-stone-400/50 bg-white/95 text-stone-800 shadow-md transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-35 sm:right-2 sm:h-10 sm:w-10"
                                  >
                                    <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden />
                                  </button>
                                </>
                              )}
                            </>
                          ) : null}
                        </div>
                      )}

                      <div className="pointer-events-none absolute inset-y-0 left-1/2 z-[5] w-7 -translate-x-1/2 bg-gradient-to-r from-transparent via-black/45 to-transparent opacity-85" />

                    </div>
                  </TransformComponent>
                </TransformWrapper>

                {!loadingPages && pages.length > 0 && activeSpread && bookRect.w >= 64 && bookRect.h >= 48 ? (
                  <div
                    className="pointer-events-none absolute z-[30]"
                    style={{
                      right: `${12 + bookHudOffset.x}px`,
                      bottom: `${12 + bookHudOffset.y}px`,
                    }}
                  >
                    <div
                      className="pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-0.5 rounded-full border border-stone-400/55 bg-white/95 py-1 pl-1 pr-1.5 text-stone-800 shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur-sm sm:gap-1 sm:py-1.5 sm:pl-1.5 sm:pr-2.5"
                      role="toolbar"
                      aria-label="Book page and zoom controls"
                    >
                      <button
                        type="button"
                        aria-label="Drag to reposition toolbar. Double-click to reset position."
                        title="Drag to move · Double-click to reset position"
                        className="touch-none cursor-grab active:cursor-grabbing rounded-full p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700"
                        onPointerDown={onBookHudGripDown}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          resetBookHudPosition();
                        }}
                      >
                        <GripVertical className="h-4 w-4 sm:h-[18px] sm:w-[18px]" aria-hidden />
                      </button>
                      <span className="max-w-[min(46vw,200px)] truncate px-1 text-center font-karla text-[10px] font-semibold tabular-nums text-stone-600 sm:max-w-[240px] sm:px-1.5 sm:text-xs">
                        {pages[currentPage + 1]
                          ? `Pages ${currentPage + 1}–${currentPage + 2} of ${pageCount}`
                          : `Page ${currentPage + 1} of ${pageCount}`}
                      </span>
                      <div className="mx-0.5 h-5 w-px shrink-0 bg-stone-300/80 sm:mx-1" aria-hidden />
                      <button
                        type="button"
                        aria-label="Zoom out"
                        className="rounded-full p-1.5 text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 disabled:opacity-40"
                        onClick={() => transformRef.current?.zoomOut()}
                      >
                        <ZoomOut className="h-4 w-4 sm:h-[18px] sm:w-[18px]" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label="Fit book to view"
                        title="Fit to view"
                        className="rounded-full p-1.5 text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 disabled:opacity-40"
                        onClick={() => transformRef.current?.resetTransform(220)}
                      >
                        <LayoutGrid className="h-4 w-4 sm:h-[18px] sm:w-[18px]" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label="Zoom in"
                        className="rounded-full p-1.5 text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 disabled:opacity-40"
                        onClick={() => transformRef.current?.zoomIn()}
                      >
                        <ZoomIn className="h-4 w-4 sm:h-[18px] sm:w-[18px]" aria-hidden />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
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

        {/* Fixed bottom: unified controls — default bottom-left; drag handle persists position */}
        <div
          className="pointer-events-none fixed z-[95] max-w-[calc(100vw-0.75rem)]"
          style={{
            left: `calc(0.75rem + ${dockHudOffset.x}px)`,
            bottom: `calc(1.25rem + ${dockHudOffset.y}px)`,
          }}
        >
          <div className="pointer-events-auto flex items-end gap-2">
            <button
              type="button"
              aria-label="Drag toolbar. Double-click to reset position."
              title="Drag to move · Double-click to reset position"
              className="mb-1 shrink-0 touch-none cursor-grab rounded-full border border-white/15 bg-stone-950/92 p-2 text-stone-400 shadow-lg backdrop-blur-xl hover:bg-stone-900 hover:text-stone-200 active:cursor-grabbing sm:mb-1.5"
              onPointerDown={onDockHudGripDown}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                resetDockHudPosition();
              }}
            >
              <GripVertical className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden />
            </button>
            <div className="min-w-0 flex-1">
              <UnifiedBar
                className="items-start"
                interactionMode={interactionMode}
                onInteractionModeChange={setInteractionMode}
                color={annColor}
                brushSize={annBrush}
                onColorChange={setAnnColor}
                onBrushSizeChange={setAnnBrush}
                onClear={handleClearCanvas}
                onUndo={() => canvasRef.current?.undo()}
                onReaction={handleReaction}
                role={role}
                participantCount={participants.length}
                onOpenParticipants={() => { setRoomPanelOpen(true); setActiveTab('video'); }}
                onOpenActivities={role === 'host' ? () => router.push(`/session/${sessionId}/activity?bookId=${bookId}`) : undefined}
                onCopyInvite={role === 'host' && inviteToken ? handleCopyInviteLink : undefined}
                linkCopied={linkCopied}
                onEndSession={() => handleEndSession(false)}
              />
            </div>
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
