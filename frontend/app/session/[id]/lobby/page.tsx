'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  getSession,
  joinViaInvite,
  readySessionWithToken,
  type SessionDetailData,
} from '@/lib/api';
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

// ─── Lobby page ────────────────────────────────────────────────────────────────

export default function LobbyPage() {
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

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Raw livekit Room instance — imported dynamically, no static type available
  const livekitRoomRef = useRef<any>(null);

  const storedParticipantId =
    typeof localStorage !== 'undefined' ? localStorage.getItem(`bb_participant_${id}`) : null;

  // ── Fetch session (host only) ─────────────────────────────────────────────
  useEffect(() => {
    if (isGuestMode) return;
    getSession(id)
      .then(setSessionData)
      .catch(() => {});
  }, [id, isGuestMode]);

  // ── Camera preview ────────────────────────────────────────────────────────
  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCamReady(true);
        setMicReady(true);
      })
      .catch(() => {
        setCamReady(false);
        setMicReady(false);
      });

    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ── Disconnect livekit on unmount ─────────────────────────────────────────
  useEffect(() => {
    return () => {
      livekitRoomRef.current?.disconnect();
    };
  }, []);

  // ── Connect to LiveKit lobby room and exchange PARTICIPANT_READY ───────────
  const connectToLobby = useCallback(
    async (token: string, url: string, participantId: string, role: 'host' | 'guest') => {
      const { Room, RoomEvent } = await import('livekit-client');
      const room = new Room();
      livekitRoomRef.current = room;

      room.on(RoomEvent.DataReceived, (data: Uint8Array) => {
        const msg = parseMsg(data);
        if (!msg) return;

        if (msg.type === 'PARTICIPANT_READY' && role === 'host') {
          setGuestReady(true);
          // Auto-start: host broadcasts SESSION_START and navigates
          room.localParticipant
            .publishData(buildMsg('SESSION_START', { initiator: participantId }), { reliable: true })
            .then(() => {
              setPhase('starting');
              setTimeout(() => router.push(`/session/${id}/reading-room`), 400);
            })
            .catch(() => {
              setPhase('starting');
              router.push(`/session/${id}/reading-room`);
            });
        }

        if (msg.type === 'SESSION_START' && role === 'guest') {
          const sessionId = (msg.payload.session_id as string) || id;
          setPhase('starting');
          setTimeout(() => router.push(`/session/${sessionId}/reading-room`), 400);
        }
      });

      await room.connect(url, token, { autoSubscribe: true });

      // Announce readiness
      await room.localParticipant.publishData(
        buildMsg('PARTICIPANT_READY', { participantId, role }),
        { reliable: true },
      );

      // If host is alone and no guest yet, they just wait (guestReady stays false)
    },
    [id, router],
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
      setPhase('waiting');
      await connectToLobby(data.realtime_token, data.livekit_url, storedParticipantId, 'host');
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
      localStorage.setItem(`bb_participant_${data.session_id}`, data.participant.id);
      setSession({
        sessionId: data.session_id,
        token: data.realtime_token,
        role: 'guest',
        roomName: data.room_name,
        livekitUrl: data.livekit_url,
        participantId: data.participant.id,
      });
      setPhase('waiting');
      await connectToLobby(data.realtime_token, data.livekit_url, data.participant.id, 'guest');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join session.');
      setPhase('check');
    }
  }

  // ── Host: manual "Start Session" if guest already confirmed ready ─────────
  async function handleHostStart() {
    if (!livekitRoomRef.current || !storedParticipantId) return;
    try {
      await livekitRoomRef.current.localParticipant.publishData(
        buildMsg('SESSION_START', { initiator: storedParticipantId }),
        { reliable: true },
      );
    } catch { /* non-fatal */ }
    setPhase('starting');
    router.push(`/session/${id}/reading-room`);
  }

  const bookTitle = sessionData?.book_title ?? 'Reading Session';
  const isLoading = phase === 'starting';

  return (
    <>

      <main className="flex h-screen w-full overflow-hidden font-body text-[#1d1b16] antialiased bg-[#fff9ee]">

        {/* ── LEFT COLUMN ──────────────────────────────────────────────────── */}
        <section className="w-1/2 bg-white p-12 flex flex-col justify-between overflow-y-auto">
          <div>
            <div className="mb-12">
              <span className="text-2xl font-bold text-[#2d5016] font-headline italic tracking-tight">
                Bailey &amp; Beau
              </span>
            </div>

            <div className="max-w-md mx-auto space-y-8">
              <h2 className="text-4xl font-headline font-bold text-[#173901] tracking-tight">
                Ready to Read Together?
              </h2>

              {/* Session info card */}
              <div className="bg-[#f3ede3] rounded-xl p-6">
                <div className="flex flex-col gap-1 mb-4">
                  <span className="uppercase tracking-widest text-[11px] font-bold text-[#835500]">
                    TODAY&apos;S BOOK
                  </span>
                  <h3 className="text-2xl font-headline font-bold text-[#173901]">{bookTitle}</h3>
                </div>
                <div className="flex items-center gap-4 text-[#43493d] text-sm mb-4">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-base">auto_stories</span>
                    <span>Reading Room</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-base">schedule</span>
                    <span>20 minutes</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#2d5016] flex items-center justify-center text-white font-bold text-sm">
                    {isGuestMode ? 'G' : 'H'}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-[#173901]">
                      {isGuestMode ? 'Guest' : 'You (Host)'}
                    </span>
                    <span className="text-[10px] bg-[#2d5016] text-white w-fit px-2 py-0.5 rounded-full uppercase tracking-tighter">
                      {isGuestMode ? 'Guest' : 'Host'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Guest display name input */}
              {isGuestMode && phase === 'check' && (
                <div className="space-y-2">
                  <label className="text-sm font-bold uppercase tracking-wider text-[#43493d]">
                    Your name
                  </label>
                  <input
                    className="w-full px-4 py-3 rounded-xl border border-[#c3c9b9] bg-white text-[#1d1b16] text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5016]"
                    placeholder="e.g. Grandma Rose"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleGuestReady(); }}
                  />
                </div>
              )}

              {/* Tech check */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-wider text-[#43493d]">
                  Check your camera &amp; microphone
                </h4>
                <div className="relative aspect-video bg-[#2d5016] rounded-xl overflow-hidden flex items-center justify-center">
                  {camReady ? (
                    <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center">
                      <span className="material-symbols-outlined text-white text-4xl mb-2">videocam_off</span>
                      <span className="text-white/70 text-xs font-medium tracking-wide">Camera Preview</span>
                    </div>
                  )}
                  <div className="absolute bottom-4 right-4 bg-black/50 backdrop-blur-md px-3 py-1 rounded-full text-[10px] text-white">
                    LIVE
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${micReady ? 'bg-[#a8d38a]' : 'bg-[#ba1a1a]'}`} />
                    <span className="text-sm text-[#43493d] font-medium">
                      Microphone: {micReady ? 'Ready' : 'Not available'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${camReady ? 'bg-[#a8d38a]' : 'bg-[#ba1a1a]'}`} />
                    <span className="text-sm text-[#43493d] font-medium">
                      Camera: {camReady ? 'Ready' : 'Not available'}
                    </span>
                  </div>
                </div>
              </div>

              {error && <p className="text-sm text-[#ba1a1a] font-medium">{error}</p>}

              {/* CTA */}
              {phase === 'check' && (
                <>
                  <button
                    onClick={isGuestMode ? handleGuestReady : handleHostReady}
                    disabled={isLoading}
                    className="w-full py-4 bg-[#173901] text-white rounded-lg font-bold text-lg transition-all hover:scale-[1.01] active:scale-95 shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isGuestMode ? "I'm Ready — Join Session" : "I'm Ready — Join Session"}
                  </button>
                  <p className="text-center text-xs text-[#43493d]/60 italic">
                    Both participants must be ready before the session starts.
                  </p>
                </>
              )}

              {phase === 'waiting' && (
                <div className="flex flex-col items-center gap-4 py-4">
                  <div className="w-8 h-8 border-4 border-[#2d5016] border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-[#43493d] font-medium">
                    {isGuestMode
                      ? 'Waiting for host to start the session…'
                      : guestReady
                      ? 'Starting session…'
                      : 'Waiting for the other participant to join…'}
                  </p>
                  {/* Host can manually start once guest is ready */}
                  {!isGuestMode && guestReady && (
                    <button
                      onClick={handleHostStart}
                      className="mt-2 px-8 py-3 bg-[#173901] text-white rounded-lg font-bold text-sm transition-all hover:scale-[1.01] active:scale-95"
                    >
                      Start Session
                    </button>
                  )}
                </div>
              )}

              {phase === 'starting' && (
                <div className="flex flex-col items-center gap-3 py-4">
                  <span className="material-symbols-outlined text-[#2d5016] text-4xl animate-pulse">
                    rocket_launch
                  </span>
                  <p className="text-sm text-[#173901] font-bold">Session starting…</p>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="text-[10px] text-[#43493d]/40 flex justify-center gap-4 mt-8">
            <span>© 2025 Bailey &amp; Beau</span>
            <span>Privacy Policy</span>
            <span>Help Center</span>
          </div>
        </section>

        {/* ── RIGHT COLUMN ─────────────────────────────────────────────────── */}
        <section className="w-1/2 bg-[#2d5016] p-12 relative flex items-center justify-center overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-[#173901] blur-[120px] rounded-full -mr-32 -mt-32" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-[#835500] blur-[120px] opacity-20 rounded-full -ml-32 -mb-32" />

          <div className="relative z-10 w-full max-w-sm flex flex-col items-center text-center">
            <div className="w-[240px] h-[320px] bg-white rounded-xl shadow-2xl overflow-hidden mb-10 transform -rotate-2 hover:rotate-0 transition-transform duration-500 cursor-pointer flex items-center justify-center">
              <span className="material-symbols-outlined text-[#2d5016] text-7xl">menu_book</span>
            </div>

            <h3 className="text-3xl font-headline font-bold text-white mb-4">{bookTitle}</h3>
            <p className="text-white/70 font-body leading-relaxed max-w-xs mb-8">
              A story about courage, friendship, and one very big surprise.
            </p>

            <div className="w-full h-px bg-white/20 mb-8" />

            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <div className={`w-4 h-4 rounded-full ${guestReady ? 'bg-[#a8d38a]' : 'bg-[#feae2c] pulse-amber'}`} />
              </div>
              <span className="text-white font-medium tracking-wide text-sm">
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

          <div className="absolute bottom-0 right-0 p-8">
            <span
              className="material-symbols-outlined text-white/5 select-none pointer-events-none"
              style={{ fontSize: '180px', fontVariationSettings: "'wght' 100" }}
            >
              auto_awesome
            </span>
          </div>
        </section>
      </main>
    </>
  );
}
