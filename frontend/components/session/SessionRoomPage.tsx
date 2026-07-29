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
import type { ComponentType, MutableRefObject, Ref } from 'react';
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
  getBookPagesWithMeta,
  getGuestToken,
  getSession,
  getSnapshot,
  transferHost,
  updateSnapshot,
  type BookPageData,
} from '@/lib/api';
import { MAX_LIVEKIT_ROOM_PARTICIPANTS } from '@/lib/sessionLimits';
import ActivityRoom from '@/components/activity/ActivityRoom';
import { ActivityPicker } from '@/components/activity/ActivityPicker';
import { BrandLogo } from '@/components/brand/BrandLogo';
import type { ActivityConfigData } from '@/components/activity/types';
import { AnnotationToolbar, DockTip, type ReadingInteractionMode } from '@/components/annotation/AnnotationToolbar';
import type {
  AnnotationCanvasHandle,
  AnnotationCanvasProps,
} from '@/components/annotation/AnnotationCanvas';
import { RoomRail, type RailItem } from '@/components/reading/RoomRail';
import { ToolStrip } from '@/components/reading/ToolStrip';
import { ChatPopup } from '@/components/session/ChatPopup';
import { ParticipantStrip } from '@/components/session/ParticipantStrip';
import type { Book3DProps } from '@/components/reading/Book3D/Scene';
import { useRoomTheme } from '@/lib/useRoomTheme';
import { useRoomIdle, useRoomSounds } from '@/lib/useRoomSounds';
import type { BookThemeData } from '@/lib/api';
import {
  AlarmClock,
  BookMarked,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Check,
  Copy,
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
  Volume2,
  VolumeX,
} from 'lucide-react';

// Dynamic import for Fabric canvas (SSR-unsafe).
// `next/dynamic` returns a plain function component, so a `ref` passed to it is
// dropped with "Function components cannot be given refs" and every imperative
// call (undo, clear, remote ink sync) silently no-ops. Forward it explicitly.
const AnnotationCanvasLazy = dynamic(
  () => import('@/components/annotation/AnnotationCanvas'),
  { ssr: false },
) as unknown as ComponentType<
  AnnotationCanvasProps & { forwardedRef?: Ref<AnnotationCanvasHandle> }
>;

const AnnotationCanvas = forwardRef<AnnotationCanvasHandle, AnnotationCanvasProps>(
  function AnnotationCanvas(props, ref) {
    return <AnnotationCanvasLazy {...props} forwardedRef={ref} />;
  },
);

// The 3D book carries three.js with it, so it is split out of the main bundle
// and loaded only on this route. `ssr: false` is required — three touches
// `window` at module scope and would break the server render.
const Book3D = dynamic(() => import('@/components/reading/Book3D/Scene'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <Loader2 className="h-10 w-10 animate-spin" style={{ color: 'var(--room-ink-soft)' }} aria-hidden />
      <span className="sr-only">Loading book…</span>
    </div>
  ),
}) as ComponentType<Book3DProps>;

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

/** Initials from a display name, for the placeholder when video is off. */
function participantInitials(label: string): string {
  const parts = label.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * A 1:1 rounded square, sized by its container.
 *
 * This was a fixed-size round bubble with the name revealed only on hover. In a
 * grid that wasted space (a circle inscribed in its cell loses ~21% of it) and
 * cropped faces tightly, and a name you must hover to read is no use on a touch
 * screen. A square fills its cell, and the name sits on a gradient strip over
 * the video so it is always legible without a separate row.
 *
 * With the camera off it shows initials on the room accent rather than a
 * generic person glyph, so several people with cameras off are still tellable
 * apart. A muted badge sits in the corner, because whether someone can hear you
 * is the thing people check most often in a call.
 */
function ParticipantTile({ identity, label, isHost }: { identity: string; label: string; isHost: boolean }) {
  const cameraTracks = useTracks([Track.Source.Camera]);
  const micTracks = useTracks([Track.Source.Microphone]);

  const track = cameraTracks.find((t) => t.participant.identity === identity);
  const cameraOn = Boolean(track && !track.publication?.isMuted);

  const micPub = micTracks.find((t) => t.participant.identity === identity);
  // No publication at all also means no audio reaching anyone, so it reads as
  // muted rather than as unknown.
  const micOn = Boolean(micPub && !micPub.publication?.isMuted);

  return (
    <div
      className="relative aspect-square w-full min-w-0 overflow-hidden rounded-2xl"
      style={{
        background: 'var(--room-chrome-strong)',
        border: '1px solid var(--room-chrome-line)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      {cameraOn && track ? (
        <VideoTrack trackRef={track} className="h-full w-full object-cover" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center"
          style={{ background: 'var(--room-accent)' }}
        >
          <span
            className="text-2xl font-bold tracking-wide"
            style={{ color: 'var(--room-accent-contrast)' }}
            aria-hidden
          >
            {participantInitials(label)}
          </span>
        </div>
      )}

      <div
        className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full"
        style={{
          background: micOn ? 'rgba(0,0,0,0.45)' : '#c0392b',
          color: '#ffffff',
        }}
        title={micOn ? `${label} is unmuted` : `${label} is muted`}
      >
        {micOn ? (
          <Mic className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <MicOff className="h-3.5 w-3.5" aria-hidden />
        )}
        <span className="sr-only">{micOn ? 'Microphone on' : 'Microphone muted'}</span>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4">
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-white">
          {label}
        </span>
        {isHost && (
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-white/85">
            Host
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Two per row, which is what fits legibly at the panel's width. `min-w-0` on the
 * children is load-bearing: without it a long participant name forces the grid
 * wider than its container and the panel grows a horizontal scrollbar.
 */
function ParticipantList({ hostIdentity }: { hostIdentity?: string }) {
  const participants = useParticipants();
  // A lone participant gets the full width rather than half of a two-column
  // grid with an empty cell beside them.
  const columns = participants.length <= 1 ? 'grid-cols-1' : 'grid-cols-2';
  return (
    <div className={`grid w-full gap-2 ${columns}`}>
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
          <circle
            cx="44"
            cy="44"
            r={radius}
            fill="none"
            stroke="var(--room-chrome-line)"
            strokeWidth="5"
          />
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
          <span
            className="font-baloo text-xl font-bold tabular-nums"
            style={{ color: 'var(--room-ink)' }}
          >
            {fmtTime(remaining)}
          </span>
          <span
            className="text-[9px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--room-ink-soft)' }}
          >
            {timerActive ? 'remaining' : role === 'host' ? 'starts live' : 'waiting'}
          </span>
        </div>
      </div>
      <p
        className="text-center text-[10px] font-bold uppercase tracking-widest"
        style={{ color: 'var(--room-ink-soft)' }}
      >
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


// ─── Room content ─────────────────────────────────────────────────────────────

function RoomContent({
  role,
  sessionId,
  participantId,
  bookId,
  bookTitle,
  inviteToken,
  onEnd,
  mode = 'reading',
}: {
  role: 'host' | 'guest';
  sessionId: string;
  participantId: string;
  bookId: string;
  bookTitle: string;
  inviteToken: string | null;
  onEnd: () => void;
  mode?: 'reading' | 'activity';
}) {
  const room = useRoomContext();
  // Mic and camera state feed the rail directly now that it is the room's only
  // control surface.
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const router = useRouter();

  const isActivityMode = mode === 'activity';

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
  const [bookPdfUrl, setBookPdfUrl] = useState('');
  const [bookTheme, setBookTheme] = useState<BookThemeData | null>(null);
  const roomTheme = useRoomTheme(bookTheme);
  const [loadingPages, setLoadingPages] = useState(true);
  // When the book has no pre-rendered image pages, render its own PDF client-side.
  // Fall back to the bundled sample only if the book has no PDF either.
  const pdfToRender =
    loadingPages || backendPages.length > 0 ? '' : bookPdfUrl || '/Book-lulu.pdf';
  const placeholderPages = usePlaceholderPdf(pdfToRender);
  const pages = backendPages.length > 0 ? backendPages : placeholderPages;
  const spreadItems = useMemo(() => bookSpreadItems(pages), [pages]);
  const [currentPage, setCurrentPage] = useState(0);
  const clampedSpreadIndex = useMemo(
    () => Math.min(Math.max(0, Math.floor(currentPage / 2)), Math.max(0, spreadItems.length - 1)),
    [currentPage, spreadItems.length],
  );
  const activeSpread = spreadItems[clampedSpreadIndex];

  // Leaf index for the 3D book. Leaf 0 is the front cover, so the spread at
  // index N sits on leaf N+1 — mixing these two spaces up desynchronises host
  // and guest by exactly one page, which is why they are converted in one place
  // only.
  const leafIndex = clampedSpreadIndex + 1;

  /** True while paper is in motion, so the ink overlay can stand aside. */
  const [turning, setTurning] = useState(false);
  /** Camera dolly for the rail zoom controls. */
  const [bookZoom, setBookZoom] = useState(1);

  const sounds = useRoomSounds();
  // Let the chrome recede while reading so the book is the only thing asking
  // for attention. Activities need their controls, so idle only applies to
  // reading mode.
  const readerIdle = useRoomIdle();

  // Cue the page turn from the spread index rather than the host's click, so
  // guests following along hear it too.
  const soundedSpreadRef = useRef(clampedSpreadIndex);
  useEffect(() => {
    if (soundedSpreadRef.current === clampedSpreadIndex) return;
    soundedSpreadRef.current = clampedSpreadIndex;
    sounds.play('page-turn');
  }, [clampedSpreadIndex, sounds]);
  // Each rail control owns its own surface. The single tabbed "Session" panel
  // that used to hold all of these meant opening chat also covered the
  // participants and the settings, and the drawing options sat three clicks
  // away from the pen button that turns drawing on.
  const [drawOpen, setDrawOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
  const transformRecalcTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPageRef = useRef(0);
  currentPageRef.current = currentPage;
  const spreadInkRef = useRef<Record<string, string>>({});
  const annotationPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The book element is measured only so the ink overlay can re-register after
  // a resize. The 3D scene fits itself to its container, so there is no longer
  // any pixel geometry to compute here.
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

  /** Bottom AnnotationToolbar: anchored bottom-left; persisted via sessionStorage. */
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
  // Activity mode: false = show the "Choose an Activity" picker; true = an
  // activity is entered. Host-controlled, synced to guests via ACTIVITY_PICK.
  const [activityEntered, setActivityEntered] = useState(false);
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
    getBookPagesWithMeta(bookId, guestPid)
      .then(({ pages, pdfViewUrl, theme }) => {
        setBackendPages(pages);
        setBookPdfUrl(pdfViewUrl);
        setBookTheme(theme);
      })
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
            goToCompletion();
          }
          break;

        case 'ACTIVITY_PICK':
          if (role === 'guest') {
            const picked = typeof msg.payload.index === 'number' ? msg.payload.index : 0;
            setActivityIndex(picked);
            setActivityEntered(msg.payload.entered !== false);
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
  // Navigate to the mission-focused completion screen. `mode` is authoritative;
  // in activity mode we also pass the current activity's title (client-only).
  function goToCompletion() {
    const q = new URLSearchParams({ mode });
    if (isActivityMode && activityEntered) {
      const activityTitle = activities[activityIndex]?.title ?? '';
      if (activityTitle) q.set('activity', activityTitle);
    }
    router.push(`/session/${sessionId}/complete?${q.toString()}`);
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
      const completedActivityId = isActivityMode && activityEntered ? (activities[activityIndex]?.id ?? null) : null;
      try { await completeSession(sessionId, participantId, completedActivityId); } catch { /* ok */ }
      goToCompletion();
    } else {
      room.disconnect();
      onEnd();
    }
  }

  // ── Host transfer ─────────────────────────────────────────────────────────
  const participants = useParticipants();

  // Someone arriving or leaving is worth hearing when your eyes are on the book.
  const participantCountRef = useRef(participants.length);
  useEffect(() => {
    const previous = participantCountRef.current;
    participantCountRef.current = participants.length;
    if (participants.length > previous) sounds.play('participant-join');
    else if (participants.length < previous) sounds.play('participant-leave');
  }, [participants.length, sounds]);

  // One gentle nudge as the session nears its end — not a countdown.
  const warnedRef = useRef(false);
  useEffect(() => {
    if (!timerActive || remaining > 2 * 60 || remaining <= 0) return;
    if (warnedRef.current) return;
    warnedRef.current = true;
    sounds.play('time-warning');
  }, [timerActive, remaining, sounds]);

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

  /**
   * The reading room's entire persistent control surface.
   *
   * Everything not here lives behind "More". The room previously showed 26
   * controls to a host across four separate regions, which is what made it read
   * as a meeting tool rather than a book.
   */

  /** Open the in-room activity modal (reuses the live LiveKit connection — no navigation, no timer reset).
   *  Host broadcasts ACTIVITY_OPEN so guests follow, and persists the open state to the session snapshot. */
  // Stable handles for the rail. Both handlers close over state that changes
  // constantly, so they are redefined every render; the refs let the memoised
  // rail call the current version without listing them as dependencies.
  const endSessionRef = useRef(handleEndSession);
  endSessionRef.current = handleEndSession;

  const handleOpenActivities = () => {
    if (activities.length === 0) return;
    setActivityOpen(true);
    const openState = {
      activity_open: true,
      activity_index: activityIndex,
      state_by_activity: activityStateByActivity,
    };
    activitySnapshotRef.current = openState;
    if (role === 'host') {
      room.localParticipant.publishData(buildMsg('ACTIVITY_OPEN', openState), { reliable: true });
      flushCurrentSpreadInk();
      updateSnapshot(
        sessionId,
        participantId,
        currentPage + 1,
        remaining,
        buildAnnotationSnapshot(spreadInkRef.current),
        openState,
      ).catch(() => {});
    }
  };

  const openActivitiesRef = useRef(handleOpenActivities);
  openActivitiesRef.current = handleOpenActivities;

  const railItems: RailItem[] = useMemo(
    () => [
      {
        icon: BookOpen,
        label: 'Back to library',
        onClick: () => router.push('/dashboard/library'),
      },

      // Reading tools. Hidden during an activity, which has its own canvas.
      {
        icon: Pencil,
        label: drawingEnabled ? 'Stop drawing' : 'Draw on the page',
        active: drawingEnabled,
        hidden: isActivityMode,
        separatorBefore: true,
        // One button, one mental model: the pen turns drawing on and reveals its
        // options together, rather than the options living somewhere else.
        onClick: () => {
          const next = !drawingEnabled;
          setInteractionMode(next ? 'pen' : 'book');
          setDrawOpen(next);
        },
      },
      {
        icon: ZoomIn,
        label: 'Zoom in',
        hidden: isActivityMode,
        onClick: () => setBookZoom((z) => Math.min(2.5, z + 0.2)),
      },
      {
        icon: ZoomOut,
        label: 'Zoom out',
        hidden: isActivityMode,
        onClick: () => setBookZoom((z) => Math.max(0.6, z - 0.2)),
      },
      {
        icon: LayoutGrid,
        label: 'Fit book to view',
        hidden: isActivityMode,
        onClick: () => setBookZoom(1),
      },

      // Presence: your own mic and camera, then who else is here.
      {
        icon: isMicrophoneEnabled ? Mic : MicOff,
        label: isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone',
        active: !isMicrophoneEnabled,
        separatorBefore: true,
        onClick: () => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled),
      },
      {
        icon: isCameraEnabled ? Video : VideoOff,
        label: isCameraEnabled ? 'Turn camera off' : 'Turn camera on',
        active: !isCameraEnabled,
        onClick: () => localParticipant.setCameraEnabled(!isCameraEnabled),
      },
      {
        icon: MessageCircle,
        label: chatOpen ? 'Close chat' : 'Open chat',
        active: chatOpen,
        onClick: () => setChatOpen((v) => !v),
      },

      // Room-level actions.
      {
        icon: Gamepad2,
        label: 'Activities',
        hidden: isActivityMode || role !== 'host' || activities.length === 0,
        separatorBefore: true,
        onClick: () => openActivitiesRef.current(),
      },
      {
        icon: sounds.muted ? VolumeX : Volume2,
        label: sounds.muted ? 'Turn sound on' : 'Turn sound off',
        separatorBefore: isActivityMode || role !== 'host' || activities.length === 0,
        onClick: sounds.toggleMuted,
      },
      {
        icon: SlidersHorizontal,
        label: 'Settings',
        active: settingsOpen,
        onClick: () => setSettingsOpen(true),
      },
      {
        icon: Phone,
        label: role === 'host' ? 'End session' : 'Leave session',
        danger: true,
        separatorBefore: true,
        onClick: () => endSessionRef.current(false),
      },
    ],
    // The two handlers are reached through refs: both are redefined on every
    // render, so depending on them directly would rebuild the whole rail each
    // time and defeat this useMemo.
    [
      drawingEnabled,
      router,
      sounds.muted,
      sounds.toggleMuted,
      isActivityMode,
      isMicrophoneEnabled,
      isCameraEnabled,
      localParticipant,
      role,
      activities.length,
      chatOpen,
      settingsOpen,
    ],
  );

  // Activity-mode picker: host chooses an activity; broadcast to guests.
  const handlePickActivity = (pickIndex: number) => {
    if (role !== 'host') return;
    setActivityIndex(pickIndex);
    setActivityEntered(true);
    room.localParticipant.publishData(
      buildMsg('ACTIVITY_PICK', { index: pickIndex, entered: true }),
      { reliable: true },
    );
  };

  const handleBackToPicker = () => {
    if (role !== 'host') return;
    setActivityEntered(false);
    room.localParticipant.publishData(
      buildMsg('ACTIVITY_PICK', { index: activityIndex, entered: false }),
      { reliable: true },
    );
  };

  // One activity element, rendered either as the reading-mode popup (modal) or,
  // in activity mode, as the in-flow card that sits in the center stage.
  const activityElement = (activities.length > 0) ? (
      <ActivityRoom
        role={role}
        activities={activities}
        open={isActivityMode ? true : activityOpen}
        variant={isActivityMode ? 'stage' : 'modal'}
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
  ) : null;

  return (
    <>
      {/* Reading mode: activities are an optional popup. Activity mode renders the
          activity in the center stage (below), not here. */}
      {!isActivityMode && activityElement}

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

      <div
        className="room-root room-sky relative isolate flex h-[100dvh] min-h-0 w-screen flex-col overflow-hidden pb-[env(safe-area-inset-bottom,0px)]"
        data-backdrop={roomTheme.backdrop}
        data-chrome={roomTheme.chrome}
        data-idle={!isActivityMode && readerIdle ? 'true' : 'false'}
        style={roomTheme.style}
      >

        {/* ── Header ────────────────────────────────────────────────────────
            No bar, no panel, no backdrop blur: the title floats top-left and
            the way out floats top-right, so the sky runs unbroken behind the
            book. The old header was a full-width frosted strip carrying a
            duplicate sound toggle and a third copy of the page counter. */}
        <header className="room-recede pointer-events-none fixed left-0 right-0 top-0 z-50 flex w-full items-start justify-between px-4 pt-[max(10px,env(safe-area-inset-top))] sm:px-6">
          <div className="pointer-events-auto flex min-w-0 items-center gap-3">
            <BrandLogo variant="dark" className="h-7 shrink-0 sm:h-8" />
            <h1
              className="font-baloo min-w-0 truncate text-sm font-semibold tracking-tight sm:text-base"
              style={{ color: 'var(--room-ink)' }}
            >
              {bookTitle}
            </h1>
          </div>

          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            <div
              className={`room-tap flex items-center gap-1.5 rounded-full px-3 text-xs font-bold tabular-nums transition-colors ${
                remaining <= 2 * 60 ? 'text-red-700' : ''
              }`}
              title={
                role === 'host' && !timerActive
                  ? 'Session timer — starts automatically when connected; tap if you paused it.'
                  : undefined
              }
              onClick={role === 'host' && !timerActive ? handleStartTimer : undefined}
              style={{
                background: 'var(--room-chrome-strong)',
                color: remaining <= 2 * 60 ? undefined : 'var(--room-ink)',
                cursor: role === 'host' && !timerActive ? 'pointer' : undefined,
              }}
            >
              <Timer className="h-3.5 w-3.5" aria-hidden />
              {fmtTime(remaining)}
            </div>

            <button
              type="button"
              onClick={() => handleEndSession(false)}
              className="room-tap cursor-pointer gap-1.5 rounded-full px-4 text-[11px] font-bold transition-all active:scale-95"
              style={{
                background: 'var(--room-chrome-strong)',
                color: 'var(--room-ink)',
              }}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              {role === 'host' ? 'End session' : 'Leave'}
            </button>
          </div>
        </header>

        <main className="relative flex h-full flex-1 overflow-hidden pt-[max(5rem,calc(4rem+env(safe-area-inset-top,0px)))]">

          {/* Drawing options, docked beside the rail's pen button. */}
          {drawOpen && !isActivityMode && (
            <ToolStrip
              color={annColor}
              brushSize={annBrush}
              onColorChange={setAnnColor}
              onBrushSizeChange={setAnnBrush}
              onUndo={() => canvasRef.current?.undo()}
              onClear={handleClearCanvas}
            />
          )}

          {chatOpen && (
            <ChatPopup
              messages={chatMessages}
              input={chatInput}
              onInputChange={setChatInput}
              onSend={sendChat}
              onClose={() => setChatOpen(false)}
            />
          )}

          {settingsOpen && (
            <>
              <button
                type="button"
                aria-label="Close settings"
                className="fixed inset-0 z-[65] bg-black/40"
                onClick={() => setSettingsOpen(false)}
              />
              <div
                role="dialog"
                aria-label="Session settings"
                className="room-panel-strong fixed bottom-0 left-0 right-0 z-[70] flex max-h-[min(80dvh,560px)] flex-col overflow-hidden rounded-t-3xl sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(100vw-2rem,400px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
              >
                <div
                  className="flex shrink-0 items-center justify-between px-4 py-3"
                  style={{ borderBottom: '1px solid var(--room-chrome-line)' }}
                >
                  <h3 className="text-base font-bold" style={{ color: 'var(--room-ink)' }}>
                    Settings
                  </h3>
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(false)}
                    aria-label="Close"
                    className="room-tap cursor-pointer rounded-xl"
                    style={{ color: 'var(--room-ink-soft)' }}
                  >
                    <X className="h-5 w-5" aria-hidden />
                  </button>
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden p-4">
                  <label
                    className="flex cursor-pointer items-start gap-3 rounded-xl px-3 py-3 text-sm"
                    style={{ background: 'var(--room-chrome)', color: 'var(--room-ink)' }}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 rounded"
                      checked={spreadPageCover}
                      onChange={(e) => setSpreadPageCoverPersisted(e.target.checked)}
                    />
                    <span>
                      <span className="font-semibold">Fill spread to frame</span>
                      <span
                        className="mt-1 block text-xs leading-relaxed"
                        style={{ color: 'var(--room-ink-soft)' }}
                      >
                        Zooms pages to fill the spread area; margins may be cropped instead of
                        showing letterboxing. Saved on this device only.
                      </span>
                    </span>
                  </label>

                  <p className="text-xs leading-relaxed" style={{ color: 'var(--room-ink-soft)' }}>
                    Up to {MAX_LIVEKIT_ROOM_PARTICIPANTS} people can be in this live room at once
                    (including the host).
                  </p>

                  {role === 'host' && !timerActive && (
                    <button
                      type="button"
                      onClick={() => {
                        handleStartTimer();
                        setSettingsOpen(false);
                      }}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold"
                      style={{ background: 'var(--room-chrome)', color: 'var(--room-ink)' }}
                    >
                      <Timer className="h-4 w-4" aria-hidden />
                      Start session timer
                    </button>
                  )}
                  {role === 'host' && (
                    <button
                      type="button"
                      onClick={() => {
                        setSettingsOpen(false);
                        setShowTransferModal(true);
                      }}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold"
                      style={{ background: 'var(--room-chrome)', color: 'var(--room-ink)' }}
                    >
                      <Users className="h-4 w-4" aria-hidden />
                      Transfer host
                    </button>
                  )}
                  {role === 'host' && !isActivityMode && (
                    <button
                      type="button"
                      onClick={() =>
                        router.push(`/session/${sessionId}/activity?bookId=${bookId}`)
                      }
                      className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold"
                      style={{ background: 'var(--room-chrome)', color: 'var(--room-ink)' }}
                    >
                      <Star className="h-4 w-4" aria-hidden />
                      Open activity
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── Main area ────────────────────────────────────────────────────── */}
          {/* The book now gets the whole stage. The old layout reserved 288px
              on the right for the participant aside and up to 192px at the
              bottom for the control dock, which together took roughly a third
              of the room away from the thing people came to look at. */}
          <section className="relative ml-0 flex min-h-0 flex-1 flex-col overflow-hidden pb-[calc(3rem+env(safe-area-inset-bottom,0px))] pl-14 sm:pl-16">
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
                {isActivityMode ? (
                  activityEntered ? (
                    <div className="w-full flex flex-col items-center">
                      {role === 'host' && activities.length > 1 && (
                        <button
                          type="button"
                          onClick={handleBackToPicker}
                          className="room-tap font-karla mb-2 flex cursor-pointer items-center gap-1 self-start rounded-full px-3 text-xs font-bold"
                          style={{ color: 'var(--room-ink-soft)' }}
                        >
                          ← Choose another activity
                        </button>
                      )}
                      {activityElement}
                    </div>
                  ) : (
                    // The picker is a single carousel row now, so it no longer
                    // needs its own vertical scroller — one would also fight the
                    // horizontal rail inside it.
                    <div className="flex w-full items-center justify-center">
                      <ActivityPicker
                        activities={activities}
                        role={role}
                        onPick={handlePickActivity}
                      />
                    </div>
                  )
                ) : (
                <div ref={bookMeasureRef} className="relative flex h-full w-full items-center justify-center">
                  {loadingPages || pages.length === 0 ? (
                    <div className="flex flex-col items-center gap-3" style={{ color: 'var(--room-ink-soft)' }}>
                      <Loader2 className="h-12 w-12 animate-spin" />
                      <span className="text-sm font-medium">Loading book…</span>
                    </div>
                  ) : (
                    <>
                      <Book3D
                        pages={pages}
                        page={leafIndex}
                        instant={role !== 'host'}
                        title={bookTitle}
                        accent={roomTheme.accent}
                        ink={roomTheme.bookInk}
                        zoom={bookZoom}
                        onTurnStateChange={setTurning}
                        className="h-full w-full"
                      />
                      {/* The ink layer stays a flat 2D overlay above the canvas
                          rather than a texture on the page mesh: annotations are
                          stored in pixel space and synced verbatim to other
                          clients, so projecting them onto bending geometry would
                          change the wire format for everyone. It hides while
                          paper is moving. */}
                      <div
                        className="absolute inset-0 z-[15] transition-opacity duration-200"
                        style={{
                          opacity: turning ? 0 : 1,
                          pointerEvents: turning ? 'none' : 'auto',
                        }}
                      >
                        <AnnotationCanvas
                          ref={canvasRef}
                          tool={annTool}
                          color={annColor}
                          brushSize={annBrush}
                          drawingEnabled={drawingEnabled && !turning}
                          onSync={handleCanvasSync}
                        />
                      </div>
                      {role === 'host' && (
                        <>
                          <button
                            type="button"
                            aria-label="Previous page"
                            onClick={hostFlipPrev}
                            disabled={currentPage <= 0}
                            className="room-recede group absolute left-2 top-1/2 z-20 flex -translate-y-1/2 cursor-pointer items-center justify-center transition-opacity disabled:cursor-not-allowed disabled:opacity-0 sm:left-4"
                          >
                            <span
                              className="room-tap grid place-items-center rounded-full transition-transform group-hover:scale-105"
                              style={{
                                background: 'var(--room-chrome-strong)',
                                color: 'var(--room-ink)',
                                boxShadow: 'var(--elev-1)',
                              }}
                            >
                              <ChevronLeft className="h-6 w-6" aria-hidden />
                            </span>
                          </button>
                          <button
                            type="button"
                            aria-label="Next page"
                            onClick={hostFlipNext}
                            disabled={currentPage >= pageCount - 2}
                            className="room-recede group absolute right-2 top-1/2 z-20 flex -translate-y-1/2 cursor-pointer items-center justify-center transition-opacity disabled:cursor-not-allowed disabled:opacity-0 sm:right-4"
                          >
                            <span
                              className="room-tap grid place-items-center rounded-full transition-transform group-hover:scale-105"
                              style={{
                                background: 'var(--room-chrome-strong)',
                                color: 'var(--room-ink)',
                                boxShadow: 'var(--elev-1)',
                              }}
                            >
                              <ChevronRight className="h-6 w-6" aria-hidden />
                            </span>
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
                )}

              </div>
            </div>
          </section>

          {/* Activities keep their tool dock — the tools are the point of that
              screen — so their rail carries only the room-level controls. */}
          <RoomRail items={railItems} />

          {/* Participants float over the backdrop instead of taking a fixed
              288px column away from the book on every desktop session. */}
          <ParticipantStrip count={participants.length} compact={isActivityMode}>
            <ParticipantList hostIdentity={hostIdentity} />
          </ParticipantStrip>
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

export function SessionRoomPage({ mode = 'reading' }: { mode?: 'reading' | 'activity' }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token, role, roomName, livekitUrl, participantId, sessionId, setSession } = useSession();

  const [bookId, setBookId] = useState<string | null>(null);
  const [bookTitle, setBookTitle] = useState('Reading Room');
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  // LiveKit negotiates asynchronously; handing <LiveKitRoom> a new token value
  // mid-negotiation tears the engine down and the retry lands on a closed engine
  // ("NegotiationError: cannot negotiate on closed engine"). Pin the first token
  // we receive so later refreshes don't remount the room.
  const pinnedTokenRef = useRef<string | null>(null);
  if (token && !pinnedTokenRef.current) pinnedTokenRef.current = token;
  const connectToken = pinnedTokenRef.current;

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
    // Send them somewhere they can act, not to the root redirect.
    if (!storedId) { router.replace('/dashboard'); return; }
    getGuestToken(sid, storedId).then((data) => {
      setSession({
        sessionId: data.session_id,
        token: data.realtime_token,
        role: data.role as 'host' | 'guest',
        roomName: data.room_name,
        livekitUrl: data.livekit_url,
        participantId: storedId,
      });
    }).catch(() => router.replace('/dashboard'));
  }, [token, sessionId, id, router, setSession]);

  if (!connectToken || !roomName || !livekitUrl || !bookId) {
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
      <LiveKitRoom
        key={roomName}
        serverUrl={livekitUrl}
        token={connectToken}
        connect
        video
        audio
        style={{ height: '100dvh' }}
      >
        <RoomContent
          role={role!}
          sessionId={sessionId ?? id}
          participantId={participantId!}
          bookId={bookId}
          bookTitle={bookTitle}
          inviteToken={inviteToken}
          mode={mode}
          onEnd={() => router.push('/dashboard')}
        />
      </LiveKitRoom>
    </>
  );
}

export default SessionRoomPage;
