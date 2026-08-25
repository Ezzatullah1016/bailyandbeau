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
  getGroupActivities,
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
import { ACTIVITY_TYPE_LABEL } from '@/components/activity/typeMeta';
import type { PaneCta } from '@/components/activity/panes/shared';
import type { ActivityConfigData } from '@/components/activity/types';
import type {
  AnnotationShape,
  ReadingInteractionMode,
} from '@/components/annotation/types';
import type {
  AnnotationCanvasHandle,
  AnnotationCanvasProps,
} from '@/components/annotation/AnnotationCanvas';
import { ChatPopup } from '@/components/session/ChatPopup';
import { DockPopovers } from '@/components/session/DockPopovers';
import { ParticipantList } from '@/components/session/ParticipantTile';
import { RoomDock, type DockCta, type DockItem } from '@/components/session/RoomDock';
import { RoomHeaderBar } from '@/components/session/RoomHeaderBar';
import { RoomShell } from '@/components/session/RoomShell';
import { RoomSidebar } from '@/components/session/RoomSidebar';
import { useToast } from '@/components/ui/Toast';
import { ROLE_LABEL } from '@/lib/roles';
import type { Book3DProps } from '@/components/reading/Book3D/Scene';
import { useRoomTheme } from '@/lib/useRoomTheme';
import { useRoomIdle, useRoomSounds } from '@/lib/useRoomSounds';
import type { BookThemeData } from '@/lib/api';
import {
  AlarmClock,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Gamepad2,
  Highlighter,
  LayoutGrid,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  MousePointer2,
  PaintBucket,
  Pen,
  Redo2,
  Scissors,
  Shapes,
  SlidersHorizontal,
  Smile,
  Star,
  Undo2,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  WifiOff,
  X,
  ZoomIn,
  ZoomOut,
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
  activityGroupId,
  bookTitle,
  inviteToken,
  onEnd,
  onRoleChange,
  mode = 'reading',
}: {
  role: 'host' | 'guest';
  sessionId: string;
  participantId: string;
  /** Null when the session targets a themed adventure instead of a book. */
  bookId: string | null;
  activityGroupId: string | null;
  bookTitle: string;
  inviteToken: string | null;
  onEnd: () => void;
  /**
   * Called when control changes hands, so the session record — the thing every
   * `role === 'host'` check reads — actually changes. Without it the host
   * published HOST_TRANSFERRED into the void and neither side moved.
   */
  onRoleChange: (next: 'host' | 'guest') => void;
  mode?: 'reading' | 'activity';
}) {
  const room = useRoomContext();
  const toast = useToast();
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
  // The hook returns { pages, settled } — `settled` distinguishes "still
  // rasterising" from "failed", so the room can stop waiting either way.
  const { pages: placeholderPages, settled: placeholderSettled } = usePlaceholderPdf(pdfToRender);
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
  /**
   * Which dock popover is open, if any. One at a time: two open popovers over a
   * 104px dock overlap each other.
   */
  const [toolPopover, setToolPopover] = useState<'pen' | 'fill' | 'shapes' | 'reactions' | null>(
    null,
  );
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  /**
   * The primary action the current activity wants in the dock, and the callback
   * behind it.
   *
   * Split in two on purpose: the descriptor is state, so a label or disabled
   * change re-renders the dock, while the handler is a ref, so a pane that
   * rebuilds its closure every render does not re-render the dock with it.
   */
  const [activityCta, setActivityCta] = useState<DockCta | null>(null);
  const activityCtaRef = useRef<(() => void) | null>(null);
  const handleActivityCta = useCallback((cta: (PaneCta & { run: () => void }) | null) => {
    activityCtaRef.current = cta?.run ?? null;
    setActivityCta((prev) => {
      if (!cta) return prev === null ? prev : null;
      // Only re-render when something visible actually changed — panes publish
      // their CTA on every state change, and an unconditional setState here
      // would loop with the pane's own render.
      if (
        prev &&
        prev.label === cta.label &&
        prev.tone === cta.tone &&
        prev.disabled === cta.disabled &&
        prev.icon === cta.icon &&
        prev.iconTrailing === cta.iconTrailing
      ) {
        return prev;
      }
      return {
        label: cta.label,
        tone: cta.tone,
        icon: cta.icon,
        disabled: cta.disabled,
        iconTrailing: cta.iconTrailing,
        onClick: () => activityCtaRef.current?.(),
      };
    });
  }, []);

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
  /**
   * Undo/redo depth, mirrored into state so the dock can disable those two
   * buttons. The canvas exposes it through an imperative handle (a ref), which
   * render cannot observe — so it is sampled after every sync, which is exactly
   * when the stacks can have changed.
   */
  const [annotationDepth, setAnnotationDepth] = useState({ undo: 0, redo: 0 });

  /** See the HOST_TRANSFERRED case: the data-channel effect never re-subscribes. */
  const onRoleChangeRef = useRef(onRoleChange);
  useEffect(() => {
    onRoleChangeRef.current = onRoleChange;
  }, [onRoleChange]);
  const drawingEnabled = interactionMode !== 'book';
  const [annColor, setAnnColor] = useState('#ef4444');
  const [annBrush, setAnnBrush] = useState(8);
  const [annShape, setAnnShape] = useState<AnnotationShape>('rect');
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
    // An adventure has no pages; skip the fetch rather than 404 on a null id.
    if (!bookId) { setLoadingPages(false); return; }
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
    const load = activityGroupId
      ? getGroupActivities(activityGroupId, guestPid)
      : bookId
        ? getBookActivities(bookId, guestPid)
        : Promise.resolve([]);
    load.then(setActivities).catch(() => setActivities([]));
  }, [bookId, activityGroupId, participantId, role]);

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

        case 'HOST_TRANSFERRED': {
          /*
           * The host published this and nothing listened for it, so a transfer
           * completed on the server and neither client changed: the new host
           * still saw a guest's read-only room, and the old host kept the
           * controls until a reload sorted it out.
           */
          const newHost = msg.payload.new_host_participant_id;
          if (typeof newHost !== 'string') break;
          // Through a ref: this effect deliberately does not re-subscribe on
          // every render, so calling the prop directly would pin the first
          // render's closure.
          if (newHost === participantId) {
            if (role !== 'host') onRoleChangeRef.current('host');
          } else if (role === 'host') {
            // Someone else now holds the pen; step down without waiting for a
            // reload to reveal it.
            onRoleChangeRef.current('guest');
          }
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
      setAnnotationDepth(canvasRef.current?.depth() ?? { undo: 0, redo: 0 });
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
    // `clearCanvas` does not route through `onSync`, so the dock's undo/redo
    // depth has to be resampled here or both buttons stay enabled over an empty
    // canvas.
    setAnnotationDepth(canvasRef.current?.depth() ?? { undo: 0, redo: 0 });
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
      try {
        room.localParticipant.publishData(
          buildMsg('HOST_TRANSFERRED', { new_host_participant_id: newParticipantId }),
          { reliable: true },
        );
      } catch {
        // The server has already recorded the handover, so a dropped data
        // channel is not a failed transfer — the other client picks it up on
        // its next snapshot.
      }
      setShowTransferModal(false);
      // The old host steps down locally too, so the controls move immediately
      // rather than lingering until a reload.
      onRoleChangeRef.current('guest');
    } catch (err) {
      // Previously swallowed, which left the modal open and the row merely
      // un-dimmed — indistinguishable from a button that does nothing.
      toast.error('Could not hand over the Adventure Guide role.', err);
    } finally {
      setTransferring(false);
    }
  }

  /* Escape dismisses the transfer dialog, as it does the settings sheet. */
  useEffect(() => {
    if (!showTransferModal) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowTransferModal(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showTransferModal]);

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

  /**
   * The dock's tool set, which differs by screen.
   *
   * Reading gets the library, the pen and eraser, reactions, the mic, who is
   * here, and the way out. An activity swaps the reading tools for the drawing
   * ones the client's screens show over each pane — select, pen, eraser,
   * reactions, fill, shapes, undo, redo — because during an activity the canvas
   * is the activity, not a book to turn pages in.
   *
   * `hidden` rather than a conditional array so a tool keeps a stable position
   * across modes: a control that moves when the mode changes has to be found
   * again every time.
   */
  // Inside an activity the dock carries drawing tools; the picker is still a
  // "choose something" screen and keeps the room-level set, as the screens show.
  const inActivity = isActivityMode && activityEntered;

  /*
   * The dock's ink tools drive `canvasRef` — the AnnotationCanvas layered over
   * the book — and that canvas only mounts in the reading branch below. They used
   * to be gated on `inActivity`, which is exactly backwards: they were shown in
   * activities, where `canvasRef.current` is always null and every one of them
   * was a guaranteed no-op (Clear page even asked for confirmation first), and
   * hidden while reading, which is the only place they work.
   *
   * An entered activity draws on the pane's own canvas instead, whose tools come
   * from the authored payload — which palette, which brush sizes, whether the
   * eraser and fill are allowed at all — so they belong to the pane that knows
   * those answers, not to the room-level dock.
   */
  const inkTools = !inActivity;

  /*
   * Undo/redo depth, so those two buttons can be honestly disabled rather than
   * looking live and doing nothing at the ends of the stack. `AnnotationCanvas`
   * already exposed `canRedo()` and nothing had ever called it.
   *
   * Read from a state counter bumped on every canvas change: the imperative
   * handle is a ref, so reading it during render would not re-run when the
   * stacks change.
   */
  const canUndo = inkTools && annotationDepth.undo > 0;
  const canRedo = inkTools && annotationDepth.redo > 0;

  const dockItems: DockItem[] = useMemo(
    () => [
      // ── Reading ──────────────────────────────────────────────────────────
      {
        icon: BookOpen,
        label: 'Library',
        hidden: inActivity,
        onClick: () => router.push('/dashboard/library'),
      },

      // ── Activity: pointer mode, which is "not drawing" ───────────────────
      {
        icon: MousePointer2,
        label: 'Select',
        hidden: !inkTools,
        active: !drawingEnabled,
        onClick: () => {
          setInteractionMode('book');
          setToolPopover(null);
        },
      },

      // ── Ink ──────────────────────────────────────────────────────────────
      {
        icon: Pen,
        label: 'Pen',
        hidden: !inkTools,
        active: interactionMode === 'pen',
        separatorBefore: true,
        onClick: () => {
          // One button, one mental model: the pen turns drawing on and reveals
          // its colour and width options together.
          const on = interactionMode !== 'pen';
          setInteractionMode(on ? 'pen' : 'book');
          setToolPopover(on ? 'pen' : null);
        },
      },
      {
        /*
         * The canvas has always had a working highlighter — translucent ink,
         * minimum 20px width — and no control anywhere set that mode, so the
         * whole branch was unreachable. It is a genuinely useful tool for
         * marking a word in a sentence without hiding it, so it gets a button
         * rather than being deleted.
         */
        icon: Highlighter,
        label: 'Highlight',
        hidden: !inkTools,
        active: interactionMode === 'highlighter',
        onClick: () => {
          const on = interactionMode !== 'highlighter';
          setInteractionMode(on ? 'highlighter' : 'book');
          setToolPopover(on ? 'pen' : null);
        },
      },
      {
        icon: Eraser,
        label: 'Eraser',
        hidden: !inkTools,
        active: interactionMode === 'eraser',
        onClick: () => {
          setInteractionMode(interactionMode === 'eraser' ? 'book' : 'eraser');
          setToolPopover(null);
        },
      },
      {
        icon: Smile,
        label: 'Reactions',
        active: toolPopover === 'reactions',
        onClick: () => setToolPopover((v) => (v === 'reactions' ? null : 'reactions')),
      },
      {
        icon: PaintBucket,
        label: 'Fill',
        hidden: !inkTools,
        active: interactionMode === 'fill',
        onClick: () => {
          const on = interactionMode !== 'fill';
          setInteractionMode(on ? 'fill' : 'book');
          setToolPopover(on ? 'fill' : null);
        },
      },
      {
        icon: Shapes,
        label: 'Shapes',
        hidden: !inkTools,
        active: interactionMode === 'shape',
        onClick: () => {
          const on = interactionMode !== 'shape';
          setInteractionMode(on ? 'shape' : 'book');
          setToolPopover(on ? 'shapes' : null);
        },
      },
      {
        icon: Undo2,
        label: 'Undo',
        hidden: !inkTools,
        disabled: !canUndo,
        onClick: () => canvasRef.current?.undo(),
      },
      {
        icon: Redo2,
        label: 'Redo',
        hidden: !inkTools,
        disabled: !canRedo,
        onClick: () => canvasRef.current?.redo(),
      },

      // ── Presence ─────────────────────────────────────────────────────────
      {
        icon: isMicrophoneEnabled ? Mic : MicOff,
        label: isMicrophoneEnabled ? 'Mic' : 'Muted',
        active: !isMicrophoneEnabled,
        separatorBefore: true,
        onClick: () => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled),
      },
      {
        icon: isCameraEnabled ? Video : VideoOff,
        label: isCameraEnabled ? 'Camera' : 'No cam',
        active: !isCameraEnabled,
        onClick: () => localParticipant.setCameraEnabled(!isCameraEnabled),
      },
      {
        icon: Users,
        label: 'Participants',
        badge: participants.length,
        onClick: () => setShowTransferModal(true),
      },
      {
        icon: MessageCircle,
        label: 'Chat',
        active: chatOpen,
        onClick: () => setChatOpen((v) => !v),
      },

      // ── Room ─────────────────────────────────────────────────────────────
      {
        icon: Gamepad2,
        label: 'Activities',
        hidden: isActivityMode || role !== 'host' || activities.length === 0,
        separatorBefore: true,
        onClick: () => openActivitiesRef.current(),
      },
      {
        icon: sounds.muted ? VolumeX : Volume2,
        label: sounds.muted ? 'Sound off' : 'Sound',
        onClick: sounds.toggleMuted,
      },
      {
        icon: ZoomIn,
        label: 'Zoom in',
        hidden: inActivity,
        onClick: () => setBookZoom((z) => Math.min(2.5, z + 0.2)),
      },
      {
        icon: ZoomOut,
        label: 'Zoom out',
        hidden: inActivity,
        onClick: () => setBookZoom((z) => Math.max(0.6, z - 0.2)),
      },
      {
        icon: LayoutGrid,
        label: 'Fit',
        hidden: inActivity,
        onClick: () => setBookZoom(1),
      },
      {
        icon: SlidersHorizontal,
        label: 'Settings',
        active: settingsOpen,
        onClick: () => setSettingsOpen(true),
      },
    ],
    // `openActivitiesRef` is a ref for a reason: the handler it holds is
    // redefined on every render, so depending on it directly would rebuild the
    // whole dock each time and defeat this useMemo.
    [
      interactionMode,
      drawingEnabled,
      toolPopover,
      inActivity,
      // Without these the dock never rebuilt as the undo/redo stacks changed,
      // so both buttons kept whatever disabled state they had at mount.
      inkTools,
      canUndo,
      canRedo,
      router,
      sounds.muted,
      sounds.toggleMuted,
      isActivityMode,
      isMicrophoneEnabled,
      isCameraEnabled,
      localParticipant,
      participants.length,
      role,
      activities.length,
      chatOpen,
      settingsOpen,
    ],
  );

  /** The dock's popovers, anchored above it. */
  const dockPopovers = (
    <DockPopovers
      open={toolPopover}
      color={annColor}
      brushSize={annBrush}
      shape={annShape}
      onColorChange={setAnnColor}
      onBrushSizeChange={setAnnBrush}
      onShapeChange={setAnnShape}
      onReact={handleReaction}
      onClear={handleClearCanvas}
      canClear={canUndo}
    />
  );

  /**
   * The dock's primary action.
   *
   * Reading ends the session. Inside an activity the pane owns it — "Next
   * Question", "How Did We Do?", "Complete Activity" — published up through
   * `onCtaChange` so the button lives in the dock where the screens put it
   * rather than being repeated inside every pane's footer.
   */
  const dockCta: DockCta | undefined = useMemo(() => {
    if (isActivityMode && activityEntered && activityCta) {
      return { ...activityCta, onClick: () => activityCtaRef.current?.() };
    }
    return {
      label: role === 'host' ? 'End Session' : 'Leave',
      icon: Scissors,
      tone: 'pink',
      onClick: () => endSessionRef.current(false),
    };
  }, [isActivityMode, activityEntered, activityCta, role]);

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

  // Drives the header. Prefers the authored `ui.title` (what the child is
  // shown) over the admin-facing record title.
  const currentActivityTitle =
    activities[activityIndex]?.config?.ui?.title || activities[activityIndex]?.title || '';

  /**
   * The header's room label and guidance line.
   *
   * The label is the activity *type* in the family's words ("Story Quest"), not
   * the activity's own title — the screens read "ACTIVITY ROOM • STORY QUEST",
   * which tells you what kind of thing you are doing. The authored title and
   * instructions belong to the pane, and the instruction is lifted up here
   * because the screens put it in the header rather than repeating it above
   * every canvas.
   */
  const currentActivityLabel =
    ACTIVITY_TYPE_LABEL[activities[activityIndex]?.activity_type ?? ''] || currentActivityTitle;

  const currentActivityInstruction = activities[activityIndex]?.config?.ui?.instructions || '';

  // One activity element, rendered either as the reading-mode popup (modal) or,
  // in activity mode, in-flow on the stage canvas.
  const activityElement = (activities.length > 0) ? (
      <ActivityRoom
        role={role}
        onCtaChange={handleActivityCta}
        /*
         * A pane's "Complete Activity" now ends the session for real and moves
         * to the completion screen, which already records the activity that was
         * open. The panes used to write a `completed` flag into their own state
         * that nothing read, so the button fired and nothing happened.
         */
        onComplete={() => {
          // Only the Adventure Guide can complete a session server-side, so an
          // Explorer's button asks rather than half-ending it: `handleEndSession`
          // would otherwise just disconnect them with nothing recorded.
          if (role === 'host') {
            handleEndSession();
          } else {
            toast.success('Let your Adventure Guide know you have finished!');
          }
        }}
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
        <div
          className="pointer-events-none fixed inset-0 overflow-hidden"
          style={{ zIndex: 'var(--z-reaction)' }}
        >
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
        className="room-root room-sky relative isolate h-[100dvh] min-h-0 w-screen overflow-hidden"
        data-backdrop={roomTheme.backdrop}
        data-chrome={roomTheme.chrome}
        data-idle={!isActivityMode && readerIdle ? 'true' : 'false'}
        style={roomTheme.style}
      >
        <RoomShell
          header={
            <RoomHeaderBar
              bookTitle={bookTitle}
              kind={isActivityMode ? 'activity' : 'reading'}
              activityLabel={
                isActivityMode && activityEntered ? currentActivityLabel : undefined
              }
              instruction={
                isActivityMode && activityEntered ? currentActivityInstruction : undefined
              }
              /* Navigation is synced, so a guest pressing back would move the
                 host. They see where they are without the control. */
              onBack={
                isActivityMode && activityEntered && role === 'host'
                  ? handleBackToPicker
                  : undefined
              }
              participantCount={participants.length}
              role={role}
              onInvite={handleCopyInviteLink}
              inviteCopied={linkCopied}
              onOverflow={() => setSettingsOpen(true)}
              onEnd={() => handleEndSession(false)}
              endLabel={role === 'host' ? 'End Session' : 'Leave'}
            />
          }
          sidebar={
            <RoomSidebar
              remaining={remaining}
              totalSecs={SESSION_DURATION_S}
              timerActive={timerActive}
              timerMode={
                !isActivityMode ? 'reading' : activityEntered ? 'activity' : 'activities'
              }
              role={role}
              onStartTimer={handleStartTimer}
              activityType={
                isActivityMode && activityEntered
                  ? activities[activityIndex]?.activity_type
                  : undefined
              }
            >
              <ParticipantList hostIdentity={hostIdentity} viewerRole={role} />
            </RoomSidebar>
          }
          dock={<RoomDock items={dockItems} cta={dockCta}>{dockPopovers}</RoomDock>}
        >
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
                className="fixed inset-0 bg-black/40"
                style={{ zIndex: 'calc(var(--z-sheet) - 1)' }}
                onClick={() => setSettingsOpen(false)}
              />
              <div
                role="dialog"
                aria-label="Session settings"
                className="room-panel-strong fixed bottom-0 left-0 right-0 flex max-h-[min(80dvh,560px)] flex-col overflow-hidden rounded-t-3xl sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(100vw-2rem,400px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
                style={{ zIndex: 'var(--z-sheet)' }}
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
                      <AlarmClock className="h-4 w-4" aria-hidden />
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

          {/* ── Main area ──────────────────────────────────────────────────────
              A grid cell now, not a padded stage. The rail gutter (`pl-14`) and
              the dock allowance (`pb-12`) are gone: the shell gives each region
              its own cell, so the canvas no longer pads itself to dodge chrome
              positioned on top of it. */}
          <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <ConnectionBanner />
            <TimerWarning remaining={remaining} />

            {/* ── Timer end-state modal (host only) ─────────────────────────── */}
            {showExtendModal && role === 'host' && (
              <div
                className="fixed inset-0 flex items-center justify-center bg-black/60"
                style={{ zIndex: 'var(--z-modal)' }}
                role="dialog"
                aria-modal="true"
                aria-label="Session time is up"
              >
                <div className="bg-white rounded-2xl p-8 shadow-2xl max-w-sm w-full mx-4 text-center space-y-4">
                  <AlarmClock className="mx-auto h-10 w-10 text-[#c84a71]" aria-hidden />
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
                  <p className="text-xs font-medium text-stone-500">Auto-ending in 15 seconds if no action is taken</p>
                </div>
              </div>
            )}

            {/* The canvas card: one surface holding the book, the activity
                picker or an activity.
                Reading takes the paper surface, because in the client's reading
                screen the card and the book pages are the same cream — the
                spread *is* the card. The activity screens keep the dark
                workspace, which their coloured cards and option rows sit on. */}
            <div
              className="room-card relative flex min-h-0 flex-1 flex-col overflow-hidden"
              data-surface={isActivityMode ? undefined : 'paper'}
            >
              {/* Reading progress: a hairline along the bottom of the card it
                  measures. It used to span the whole room and ran underneath the
                  dock, where it read as a stray sliver of chrome. */}
              {!isActivityMode && pages.length > 0 && (
                <div
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-1"
                  style={{ background: 'rgba(0,0,0,0.25)' }}
                  role="progressbar"
                  aria-label="Reading progress"
                  aria-valuenow={Math.round(progressPct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full transition-all duration-500"
                    style={{ width: `${progressPct}%`, background: 'var(--room-accent)' }}
                  />
                </div>
              )}
              <div
                /* An entered activity is top-aligned so it reads as page
                   content on the canvas; the book and the picker stay centred.
                   Reading gets no padding: the spread runs to the card's edges
                   in the screens, and an inset here drew a thick frame around
                   the paper that the mock does not have. */
                className={`relative flex min-h-0 flex-1 justify-center ${
                  isActivityMode ? 'px-4 py-4 sm:px-8 sm:py-7' : ''
                } ${isActivityMode && activityEntered ? 'items-stretch' : 'items-center'}`}
              >
                {isActivityMode ? (
                  activityEntered ? (
                    // Scrollable: a tall activity (drawing, drag & drop) must be
                    // able to run past the fold rather than being squeezed into
                    // the card's middle. Back-to-picker lives in the header.
                    <div className="h-full w-full overflow-y-auto">
                      {activityElement}
                    </div>
                  ) : (
                    <div className="h-full w-full overflow-y-auto">
                      <ActivityPicker
                        activities={activities}
                        role={role}
                        onPick={handlePickActivity}
                      />
                    </div>
                  )
                ) : (
                <div ref={bookMeasureRef} className="relative flex h-full w-full items-center justify-center">
                  {/* Stop spinning once the placeholder load has settled, even if
                      it failed — otherwise a broken PDF spins "Loading book…"
                      forever with no way to tell it is never coming. */}
                  {loadingPages || (pages.length === 0 && !placeholderSettled) ? (
                    <div className="flex flex-col items-center gap-3" style={{ color: 'var(--room-ink-soft)' }}>
                      <Loader2 className="h-12 w-12 animate-spin" />
                      <span className="text-sm font-medium">Loading book…</span>
                    </div>
                  ) : pages.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 text-center" style={{ color: 'var(--room-ink-soft)' }}>
                      <BookOpen className="h-10 w-10 opacity-60" />
                      <span className="text-sm font-medium">This book has no pages yet.</span>
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
                          shape={annShape}
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
                                /* Literal, not the card's chrome: these sit on
                                   cream paper, where the paper card's white
                                   chrome would make them invisible. The screens
                                   show dark aubergine discs with a white
                                   glyph. */
                                background: '#332a5c',
                                color: '#ffffff',
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
                                /* Literal, not the card's chrome: these sit on
                                   cream paper, where the paper card's white
                                   chrome would make them invisible. The screens
                                   show dark aubergine discs with a white
                                   glyph. */
                                background: '#332a5c',
                                color: '#ffffff',
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
        </RoomShell>

        {/* Host transfer modal */}
        {showTransferModal && (
          <div
            className="fixed inset-0 flex items-center justify-center bg-black/70 p-4"
            style={{ zIndex: 'var(--z-modal)' }}
          >
            {/* A real button, so the backdrop is reachable by keyboard and
                announced — it used to be a bare div with a click handler, which
                left no way to dismiss this modal without a mouse. */}
            <button
              type="button"
              aria-label="Close"
              onClick={() => setShowTransferModal(false)}
              className="absolute inset-0 h-full w-full cursor-default"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="transfer-guide-title"
              className="relative w-full max-w-sm rounded-2xl bg-[#20201f] p-6 shadow-2xl"
            >
              <div className="mb-5 flex items-center justify-between gap-3">
                <h3 id="transfer-guide-title" className="font-baloo text-xl text-[#e5e2e1]">
                  Pass the {ROLE_LABEL.host} role
                </h3>
                <button
                  type="button"
                  onClick={() => setShowTransferModal(false)}
                  aria-label="Close"
                  className="shrink-0 cursor-pointer text-[#c3c9b9] hover:text-white"
                >
                  <X className="h-5 w-5" aria-hidden />
                </button>
              </div>
              <p className="mb-5 text-sm text-[#c3c9b9]">
                Choose who leads from here. They get the page turns and the tools; you become an{' '}
                {ROLE_LABEL.guest}.
              </p>
              <div className="flex flex-col gap-3">
                {participants
                  .filter((p) => p.identity !== String(participantId))
                  .map((p) => (
                    <button
                      key={p.identity}
                      type="button"
                      onClick={() => handleTransferHost(p.identity)}
                      disabled={transferring}
                      className="flex cursor-pointer items-center gap-3 rounded-xl bg-[#2a2a2a] p-3 text-[#e5e2e1] transition-all hover:bg-[#764f84] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#353535] text-sm font-bold">
                        {p.name?.[0]?.toUpperCase() ?? '?'}
                      </div>
                      <span className="min-w-0 flex-1 truncate text-left font-medium">
                        {p.name ?? p.identity}
                      </span>
                      {transferring ? (
                        <Loader2 className="ml-auto h-4 w-4 shrink-0 animate-spin" aria-hidden />
                      ) : (
                        <Users className="ml-auto h-4 w-4 shrink-0 opacity-50" aria-hidden />
                      )}
                    </button>
                  ))}
                {participants.filter((p) => p.identity !== String(participantId)).length === 0 && (
                  <p className="py-4 text-center text-sm text-[#c3c9b9]/60">
                    Nobody else has joined yet.
                  </p>
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
  // A session targets a book OR a themed adventure; exactly one is set.
  const [activityGroupId, setActivityGroupId] = useState<string | null>(null);
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
        setActivityGroupId(s.activity_group ?? null);
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

  // An adventure session has no book, so gating on bookId alone left it stuck
  // on "Loading session…" forever.
  if (!connectToken || !roomName || !livekitUrl || (!bookId && !activityGroupId)) {
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
          activityGroupId={activityGroupId}
          bookTitle={bookTitle}
          inviteToken={inviteToken}
          mode={mode}
          onRoleChange={(next) =>
            setSession({
              sessionId: sessionId ?? id,
              token: connectToken,
              role: next,
              roomName,
              livekitUrl,
              participantId: participantId!,
            })
          }
          onEnd={() => router.push('/dashboard')}
        />
      </LiveKitRoom>
    </>
  );
}

export default SessionRoomPage;
