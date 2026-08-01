'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { BookOpen, Clock, Rocket, BookMarked, Sparkles, VideoOff, Copy, Check } from 'lucide-react';
import {
  getSession,
  joinViaInvite,
  readySessionWithToken,
  type SessionDetailData,
} from '@/lib/api';
import { MAX_LIVEKIT_ROOM_PARTICIPANTS } from '@/lib/sessionLimits';
import { useSession } from '@/contexts/SessionContext';

// ─── Data channel message types ───────────────────────────────────────────────
type LobbyMsgType = 'PARTICIPANT_READY' | 'SESSION_START';

interface LobbyMsg {
  type: LobbyMsgType;
  payload: Record<string, unknown>;
  ts: string;
}

function buildMsg(type: LobbyMsgType, payload: Record<string, unknown>): Uint8Array {
  const json = JSON.stringify({ type, payload, ts: new Date().toISOString() } satisfies LobbyMsg);
  return new TextEncoder().encode(json);
}

function parseMsg(data: Uint8Array): LobbyMsg | null {
  try {
    return JSON.parse(new TextDecoder().decode(data)) as LobbyMsg;
  } catch {
    return null;
  }
}

function isValidLiveKitUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
  } catch {
    return false;
  }
}

function parseParticipantMetadata(metadata: string | undefined): { role?: string } {
  try {
    if (!metadata) return {};
    return JSON.parse(metadata) as { role?: string };
  } catch {
    return {};
  }
}

function participantLooksLikeHost(metadata: string | undefined): boolean {
  const r = (parseParticipantMetadata(metadata).role ?? '').toString().toLowerCase();
  return r.includes('host');
}

// ─── Lobby page ────────────────────────────────────────────────────────────────

function LobbyPageContent() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { setSession } = useSession();

  const inviteToken = searchParams.get('invite');
  const isGuestMode = Boolean(inviteToken);

  const [sessionData, setSessionData] = useState<SessionDetailData | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [micReady, setMicReady] = useState(false);
  const [camReady, setCamReady] = useState(false);
  const [phase, setPhase] = useState<'check' | 'waiting' | 'starting'>('check');
  const [guestReady, setGuestReady] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const livekitRoomRef = useRef<any>(null);
  const connectingRef = useRef(false);
  // Set just before navigating into the session so the unmount cleanup knows
  // not to tear down a LiveKit connection the room page is about to reuse.
  const enteringRoomRef = useRef(false);

  const storedParticipantId =
    typeof localStorage !== 'undefined' ? localStorage.getItem(`bb_participant_${id}`) : null;

  // ── Fetch session (host only) ─────────────────────────────────────────────
  useEffect(() => {
    if (isGuestMode) return;
    getSession(id)
      .then(setSessionData)
      .catch(() => {});
  }, [id, isGuestMode]);

  // Room type for guests (host learns it from getSession → sessionData; guests
  // get it from the invite-join response).
  const [guestRoomType, setGuestRoomType] = useState<string | null>(null);

  // Destination room slug: activity sessions go to the Activity Room, everything
  // else to the Reading Room. Falls back to reading until session data loads.
  const effectiveRoomType = sessionData?.room_type ?? guestRoomType ?? 'reading';
  const roomSlug = effectiveRoomType === 'activity' ? 'activity' : 'reading-room';

  // ── Camera preview ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamReady(false);
      setMicReady(false);
      setMediaError('This browser cannot access camera or microphone.');
      return;
    }
    setMediaError(null);
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          void v.play().catch(() => {
            /* autoplay quirks — stream still attaches */
          });
        }
        setCamReady(true);
        setMicReady(true);
      })
      .catch((err: unknown) => {
        streamRef.current = null;
        setCamReady(false);
        setMicReady(false);
        const name =
          err && typeof err === 'object' && 'name' in err ? String((err as DOMException).name) : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setMediaError('Camera and microphone permission was denied. Allow access in browser settings and refresh this page to preview your setup.');
        } else if (name === 'NotFoundError') {
          setMediaError('No camera or microphone was found on this device.');
        } else {
          setMediaError('Could not start camera preview. Joining may still work from the reading room.');
        }
      });

    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Warm the room route's JS while the user is still in the lobby. Without
  // this the navigation starts downloading the room chunk and the page unloads
  // mid-download, which surfaces as ChunkLoadError -> full browser navigation
  // -> the LiveKit engine torn down mid-negotiation.
  // Both room routes are warmed because the session's room type arrives
  // asynchronously; prefetching only the current guess leaves the other route
  // cold and the navigation aborts its chunk mid-download.
  useEffect(() => {
    if (!id) return;
    router.prefetch(`/session/${id}/reading-room`);
    router.prefetch(`/session/${id}/activity`);
  }, [id, router]);

  // ── Release the lobby's LiveKit room ──────────────────────────────────────
  // Disconnect only when the user is leaving for good (back, close). When they
  // are heading into the session, the room page is already opening its own
  // connection to the same LiveKit room, and tearing this one down at that
  // moment aborts the in-flight negotiation — the "cannot negotiate on closed
  // engine" error. `enteringRoomRef` marks that case.
  useEffect(() => {
    return () => {
      if (!enteringRoomRef.current) livekitRoomRef.current?.disconnect();
    };
  }, []);

  // ── Connect to LiveKit lobby room and exchange PARTICIPANT_READY ───────────
  const connectToLobby = useCallback(
    async (token: string, url: string, participantId: string, role: 'host' | 'guest', sessionIdForNav: string) => {
      // Re-entry (double click, StrictMode) would orphan the first Room and
      // leave negotiation running against a discarded engine.
      if (connectingRef.current || livekitRoomRef.current) return;
      connectingRef.current = true;
      const { Room, RoomEvent } = await import('livekit-client');
      const room = new Room();
      livekitRoomRef.current = room;

      let navigatedAway = false;
      let sessionStartCommitted = false;

      const goReadingRoom = () => {
        if (navigatedAway) return;
        navigatedAway = true;
        setPhase('starting');
        enteringRoomRef.current = true;
        setTimeout(() => router.push(`/session/${sessionIdForNav}/${roomSlug}`), 400);
      };

      const publishSessionStartAndGo = async () => {
        if (sessionStartCommitted || navigatedAway || role !== 'host') return;
        sessionStartCommitted = true;
        setGuestReady(true);
        try {
          await room.localParticipant.publishData(
            buildMsg('SESSION_START', {
              initiator: participantId,
              session_id: sessionIdForNav,
            }),
            { reliable: true },
          );
        } catch {
          /* still transition so host is not stranded */
        }
        goReadingRoom();
      };

      const hostReconcileRemotes = async () => {
        if (role !== 'host' || navigatedAway) return;
        if (room.remoteParticipants.size < 1) return;
        await publishSessionStartAndGo();
      };

      const guestReconcileRemotes = () => {
        if (role !== 'guest' || navigatedAway) return;
        for (const rp of room.remoteParticipants.values()) {
          if (participantLooksLikeHost(rp.metadata)) {
            goReadingRoom();
            return;
          }
        }
      };

      room.on(RoomEvent.DataReceived, (data: Uint8Array) => {
        const msg = parseMsg(data);
        if (!msg) return;

        if (msg.type === 'PARTICIPANT_READY' && role === 'host') {
          const prRole =
            typeof msg.payload.role === 'string' ? msg.payload.role.toLowerCase() : '';
          if (prRole !== 'guest') return;
          void publishSessionStartAndGo();
          return;
        }

        if (msg.type === 'SESSION_START' && role === 'guest') {
          const sid = (typeof msg.payload.session_id === 'string' && msg.payload.session_id) || sessionIdForNav;
          if (navigatedAway) return;
          navigatedAway = true;
          setPhase('starting');
          enteringRoomRef.current = true;
          setTimeout(() => router.push(`/session/${sid}/${roomSlug}`), 400);
        }
      });

      room.on(RoomEvent.ParticipantConnected, (remote) => {
        if (role === 'host') {
          void hostReconcileRemotes();
        } else if (role === 'guest' && participantLooksLikeHost(remote.metadata)) {
          goReadingRoom();
        }
      });

      try {
        await room.connect(url, token, { autoSubscribe: true });

        await room.localParticipant.publishData(
          buildMsg('PARTICIPANT_READY', { participantId, role }),
          { reliable: true },
        );
      } catch (e) {
        // Release the guard so the user can retry instead of being stuck with
        // a dead ref and a Start button that does nothing.
        livekitRoomRef.current = null;
        connectingRef.current = false;
        throw e;
      }

      connectingRef.current = false;
      if (role === 'host') void hostReconcileRemotes();
      else guestReconcileRemotes();
    },
    [router],
  );

  // ── Host: ready → get token → connect to lobby ────────────────────────────
  async function handleHostReady() {
    if (!storedParticipantId) {
      setError('Session participant not found. Please recreate the session.');
      return;
    }
    setError('');
    try {
      const data = await readySessionWithToken(id, storedParticipantId);
      setSession({
        sessionId: data.session_id,
        token: data.realtime_token,
        role: 'host',
        roomName: data.room_name,
        livekitUrl: data.livekit_url,
        participantId: storedParticipantId,
      });
      const canUseLiveKit = isValidLiveKitUrl(data.livekit_url);
      if (!canUseLiveKit) {
        // Local fallback: allow development flow to continue without realtime transport.
        setPhase('starting');
        enteringRoomRef.current = true;
        router.push(`/session/${id}/${roomSlug}`);
        return;
      }

      setPhase('waiting');
      await connectToLobby(data.realtime_token, data.livekit_url, storedParticipantId, 'host', String(data.session_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get ready.');
      setPhase('check');
    }
  }

  // ── Guest: join via invite → get token → connect to lobby ────────────────
  async function handleGuestReady() {
    if (!inviteToken || !displayName.trim()) {
      setError('Please enter your name.');
      return;
    }
    setError('');
    try {
      const data = await joinViaInvite(inviteToken, displayName.trim());
      if (data.room_type) setGuestRoomType(data.room_type);
      localStorage.setItem(`bb_participant_${data.session_id}`, data.participant.id);
      setSession({
        sessionId: data.session_id,
        token: data.realtime_token,
        role: 'guest',
        roomName: data.room_name,
        livekitUrl: data.livekit_url,
        participantId: data.participant.id,
      });
      const canUseLiveKit = isValidLiveKitUrl(data.livekit_url);
      if (!canUseLiveKit) {
        // Local fallback: allow development flow to continue without realtime transport.
        setPhase('starting');
        enteringRoomRef.current = true;
        router.push(`/session/${data.session_id}/${roomSlug}`);
        return;
      }

      setPhase('waiting');
      await connectToLobby(data.realtime_token, data.livekit_url, data.participant.id, 'guest', String(data.session_id));
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      const soft = /expired|invalid|invite/i.test(msg);
      setError(
        soft
          ? 'This invite is no longer valid or has hit its use limit. Ask the host to copy a fresh link from the reading room (Copy link).'
          : msg || 'Failed to join session.',
      );
      setPhase('check');
    }
  }

  // ── Host: manual "Start Session" ─────────────────────────────────────────
  async function handleHostStart() {
    if (!storedParticipantId) {
      setError('Session participant not found. Please recreate the session.');
      return;
    }
    // Announcing the start is best-effort — the host must never be stranded on
    // the lobby with a button that silently does nothing.
    //
    // Only publish once the room is actually connected. Solo hosts routinely
    // press Start before the lobby socket is up, and publishing then makes
    // livekit-client log "NegotiationError: cannot negotiate on closed engine"
    // before it rejects, so a try/catch cannot suppress it. Guests are told to
    // enter by ParticipantConnected regardless, so skipping the publish here
    // costs nothing.
    try {
      const lobbyRoom = livekitRoomRef.current;
      if (lobbyRoom?.state === 'connected') {
        await lobbyRoom.localParticipant.publishData(
          buildMsg('SESSION_START', { initiator: storedParticipantId, session_id: id }),
          { reliable: true },
        );
      }
    } catch { /* non-fatal — guests also reconcile on ParticipantConnected */ }
    setPhase('starting');
    enteringRoomRef.current = true;
    router.push(`/session/${id}/${roomSlug}`);
  }

  // ── Copy invite link ──────────────────────────────────────────────────────
  const inviteUrl = !isGuestMode && sessionData?.invite_token
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/session/${id}/lobby?invite=${sessionData.invite_token}`
    : null;

  function handleCopyInvite() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const bookTitle = sessionData?.book_title ?? 'Reading Session';
  const isLoading = phase === 'starting';

  return (
    <>
      <main className="flex flex-col md:flex-row h-[100dvh] min-h-0 w-full overflow-hidden font-karla text-[#1d1b16] antialiased pb-[env(safe-area-inset-bottom,0px)]">

        {/* ── LEFT COLUMN ──────────────────────────────────────────────────── */}
        <section className="flex min-h-0 w-full flex-col justify-between overflow-y-auto bg-[#faf7f6] px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] sm:px-8 md:w-1/2 md:p-12">
          <div>
            <div className="mb-12">
              <span className="font-baloo text-2xl font-bold text-[#3d3b62] tracking-tight">
                Bailey &amp; Beau
              </span>
            </div>

            <div className="max-w-md mx-auto flex flex-col gap-8">
              {/* A session can target a themed adventure rather than a book,
                  and an adventure has nothing to read. */}
              <h2 className="order-10 font-baloo text-4xl font-bold text-[#3d3b62] tracking-tight">
                {effectiveRoomType === 'activity' ? 'Ready to Play Together?' : 'Ready to Read Together?'}
              </h2>

              {/* Session info / Today's Book card */}
              <div className="order-30 rounded-xl md:order-20 bg-white p-6 border border-[#eccdca] shadow-[0_6px_18px_rgba(0,0,0,0.08)]">
                <div className="flex flex-col gap-1 mb-4">
                  <span className="font-karla uppercase tracking-widest text-[11px] font-bold text-[#764f84]">
                    {effectiveRoomType === 'activity' ? "TODAY'S ADVENTURE" : "TODAY'S BOOK"}
                  </span>
                  <h3 className="font-baloo text-2xl font-bold text-[#3d3b62]">{bookTitle}</h3>
                </div>
                <div className="font-karla flex items-center gap-4 text-[#43493d] text-sm mb-4">
                  <div className="flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4" />
                    <span>{effectiveRoomType === 'activity' ? 'Activity Room' : 'Reading Room'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4" />
                    <span>20 minutes</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#3d3b62] flex items-center justify-center text-white font-bold text-sm">
                    {isGuestMode ? 'G' : 'H'}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-karla text-sm font-semibold text-[#3d3b62]">
                      {isGuestMode ? 'Guest' : 'You (Host)'}
                    </span>
                    <span className="font-karla text-[10px] bg-[#3d3b62] text-white w-fit px-2 py-0.5 rounded-full uppercase tracking-tighter">
                      {isGuestMode ? 'Guest' : 'Host'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Invite link (host only) */}
              {inviteUrl && (
                <div className="order-40 rounded-xl md:order-30 bg-white p-4 border border-[#eccdca] shadow-[0_6px_18px_rgba(0,0,0,0.08)]">
                  <span className="font-karla block text-[11px] font-bold uppercase tracking-widest text-[#764f84] mb-2">
                    Invite Link
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={inviteUrl}
                      className="font-karla flex-1 text-xs bg-[#faf7f6] border border-[#eccdca] rounded-lg px-3 py-2 text-[#43493d] truncate outline-none"
                    />
                    <button
                      onClick={handleCopyInvite}
                      className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-[#3d3b62] hover:bg-[#764f84] text-white transition-colors"
                      title="Copy invite link"
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="font-karla text-[10px] text-[#43493d]/60 mt-1">
                    Share this link with your reading partners. Up to {MAX_LIVEKIT_ROOM_PARTICIPANTS} people can be in the live room at once.
                  </p>
                </div>
              )}

              {/* Guest display name input */}
              {isGuestMode && phase === 'check' && (
                <div className="order-50 md:order-40 space-y-2">
                  <label className="font-karla text-sm font-bold uppercase tracking-wider text-[#43493d]">
                    Your name
                  </label>
                  <input
                    className="font-karla w-full px-4 py-3 rounded-xl border border-[#eccdca] bg-white text-[#1d1b16] text-sm focus:outline-none focus:ring-2 focus:ring-[#3b85a6] focus:border-[#3b85a6]"
                    placeholder="e.g. Grandma Rose"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleGuestReady(); }}
                  />
                </div>
              )}

              {/* Tech check — bumped before the session card on small screens so preview is visible without scrolling */}
              <div className="order-20 space-y-4 md:order-50">
                <h4 className="font-karla text-sm font-bold uppercase tracking-wider text-[#43493d]">
                  Check your camera &amp; microphone
                </h4>
                <div className="relative aspect-video max-h-[40vh] bg-[#3d3b62] rounded-[12px] overflow-hidden flex items-center justify-center sm:max-h-none">
                  {camReady ? (
                    <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center px-4 text-center">
                      <VideoOff className="w-10 h-10 text-white mb-2" />
                      <span className="font-karla text-white/70 text-xs font-medium tracking-wide">Camera Preview</span>
                      {mediaError ? (
                        <span className="font-karla mt-3 text-[11px] leading-snug text-amber-200/95">{mediaError}</span>
                      ) : (
                        <span className="font-karla mt-2 text-[10px] text-white/55">Connecting to hardware…</span>
                      )}
                    </div>
                  )}
                  <div className="absolute bottom-4 right-4 bg-[#c84a71] px-3 py-1 rounded-full text-[10px] text-white font-karla font-bold">
                    LIVE
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${micReady ? 'bg-[#3b85a6]' : 'bg-[#ba1a1a]'}`} />
                    <span className="font-karla text-sm text-[#43493d] font-medium">
                      Microphone: {micReady ? 'Ready' : 'Not available'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${camReady ? 'bg-[#3b85a6]' : 'bg-[#ba1a1a]'}`} />
                    <span className="font-karla text-sm text-[#43493d] font-medium">
                      Camera: {camReady ? 'Ready' : 'Not available'}
                    </span>
                  </div>
                </div>
              </div>

              {error && <p className="order-[34] font-karla text-sm text-[#ba1a1a] font-medium">{error}</p>}

              {/* CTA — ordered above the camera-check block (order-50). The
                  preview is tall enough that on a 900px-high viewport the join
                  button fell below the fold, so the lobby looked like it had no
                  action at all. */}
              {phase === 'check' && (
                <div className="order-[35] flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={isGuestMode ? handleGuestReady : handleHostReady}
                    disabled={isLoading}
                    className="font-baloo w-full rounded-lg bg-[#3d3b62] py-4 text-lg font-bold text-white shadow-lg transition-all hover:scale-[1.01] hover:bg-[#764f84] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isGuestMode ? "I'm Ready — Join Session" : "I'm Ready — Join Session"}
                  </button>
                  <p className="text-center font-karla text-xs italic text-[#43493d]/60">
                    Both participants must be ready before the session starts.
                  </p>
                </div>
              )}

              {phase === 'waiting' && (
                <div className="order-[35] flex flex-col items-center gap-4 py-4">
                  <div className="w-8 h-8 border-4 border-[#764f84] border-t-transparent rounded-full animate-spin" />
                  <p className="font-karla text-sm text-[#43493d] font-medium">
                    {isGuestMode
                      ? 'Waiting for host to start the session…'
                      : guestReady
                      ? 'Starting session…'
                      : 'Waiting for the other participant to join… or start solo below.'}
                  </p>
                  {!isGuestMode && guestReady && (
                    <button
                      onClick={handleHostStart}
                      className="font-baloo mt-2 px-8 py-3 bg-[#f0c75e] hover:bg-[#e6b84d] text-[#3d3b62] rounded-lg font-bold text-sm transition-all hover:scale-[1.01] active:scale-95"
                    >
                      Start Session
                    </button>
                  )}
                  {!isGuestMode && !guestReady && (
                    <button
                      onClick={handleHostStart}
                      className="font-baloo mt-2 px-8 py-3 bg-[#f0c75e] hover:bg-[#e6b84d] text-[#3d3b62] rounded-lg font-bold text-sm transition-all hover:scale-[1.01] active:scale-95"
                    >
                      Start Solo Session
                    </button>
                  )}
                </div>
              )}

              {phase === 'starting' && (
                <div className="order-[35] flex flex-col items-center gap-3 py-4">
                  <Rocket className="w-10 h-10 text-[#764f84] animate-pulse" />
                  <p className="font-karla text-sm text-[#3d3b62] font-bold">Session starting…</p>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="font-karla text-[10px] text-[#764f84] flex justify-center gap-4 mt-8">
            <span>© 2025 Bailey &amp; Beau</span>
            <span>Privacy Policy</span>
            <span>Help Center</span>
          </div>
        </section>

        {/* ── RIGHT COLUMN ─────────────────────────────────────────────────── */}
        <section className="relative hidden min-h-0 items-center justify-center overflow-hidden bg-gradient-to-b from-[#3d3b62] to-[#764f84] p-12 pb-[max(3rem,env(safe-area-inset-bottom))] md:flex md:h-[100dvh] md:w-1/2">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 blur-[120px] rounded-full -mr-32 -mt-32" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/5 blur-[120px] rounded-full -ml-32 -mb-32" />

          <div className="relative z-10 w-full max-w-sm flex flex-col items-center text-center">
            <div className="w-[240px] h-[320px] bg-white rounded-[8px] overflow-hidden mb-10 transform -rotate-2 hover:rotate-0 transition-transform duration-500 cursor-pointer flex items-center justify-center shadow-[0px_12px_40px_rgba(0,0,0,0.25)]">
              <BookMarked className="w-20 h-20 text-[#3d3b62]" />
            </div>

            <h3 className="font-baloo text-3xl font-bold text-white mb-4">{bookTitle}</h3>
            <p className="font-karla text-[#eccdca] leading-relaxed max-w-xs mb-8">
              A story about courage, friendship, and one very big surprise.
            </p>

            <div className="w-full h-px bg-white/20 mb-8" />

            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <div className={`w-4 h-4 rounded-full ${guestReady ? 'bg-[#3b85a6]' : 'bg-[#f0c75e] pulse-amber'}`} />
              </div>
              <span className="font-karla text-white font-medium tracking-wide text-sm">
                {phase === 'check'
                  ? isGuestMode
                    ? 'Enter your name and click Ready'
                    : 'Click Ready when your camera is set up'
                  : phase === 'waiting'
                  ? isGuestMode
                    ? 'Waiting for host to start…'
                    : guestReady
                    ? 'Guest is ready!'
                    : 'Waiting for other participants…'
                  : 'Starting…'}
              </span>
            </div>
          </div>

          <div className="absolute bottom-0 right-0 p-8 opacity-[0.12] select-none pointer-events-none">
            <Sparkles className="w-40 h-40 text-white" />
          </div>
        </section>
      </main>
    </>
  );
}

export default function LobbyPage() {
  return (
    <Suspense
      fallback={(
        <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-[#3d3b62] to-[#764f84] px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
          <BookOpen className="h-12 w-12 animate-pulse text-white/80" aria-hidden />
        </div>
      )}
    >
      <LobbyPageContent />
    </Suspense>
  );
}
