'use client';

import { Suspense, useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Room, RoomEvent } from 'livekit-client';
import { BookOpen, X } from 'lucide-react';

import { useSession } from '@/contexts/SessionContext';
import { getBookActivities, ActivityConfigData, completeSession, updateSnapshot, getSnapshot } from '@/lib/api';
import DrawingActivity from '@/components/activity/DrawingActivity';
import DragDropActivity, { DragDropState } from '@/components/activity/DragDropActivity';
import QuizActivity, { QuizState } from '@/components/activity/QuizActivity';
import HotspotActivity, { HotspotState } from '@/components/activity/HotspotActivity';

// ── Data channel message types ────────────────────────────────────────────────
type SyncMessage = { type: string; payload: Record<string, unknown> };
const decoder = new TextDecoder();
function buildMsg(type: string, payload: Record<string, unknown> = {}): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ type, payload }));
}

// ── Activity state union ──────────────────────────────────────────────────────
type AnyActivityState = string | DragDropState | QuizState | HotspotState | null;

export default function ActivityPage() {
  return (
    <Suspense
      fallback={(
        <div className="flex min-h-screen items-center justify-center bg-[#1a1a1c]">
          <BookOpen className="h-10 w-10 animate-pulse text-[#764f84]" aria-hidden />
        </div>
      )}
    >
      <ActivityPageContent />
    </Suspense>
  );
}

function ActivityPageContent() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { token, role, roomName, livekitUrl, participantId, sessionId } = useSession();

  const [activities, setActivities] = useState<ActivityConfigData[]>([]);
  const [activityIndex, setActivityIndex] = useState(0);
  const [remoteState, setRemoteState] = useState<AnyActivityState>(null);
  const [bookTitle, setBookTitle] = useState('Activity Room');
  const [loading, setLoading] = useState(true);

  const roomRef = useRef<Room | null>(null);
  const sid = sessionId ?? id;

  useEffect(() => {
    if (!token || !livekitUrl || !roomName) {
      router.push(`/session/${id}/reading-room`);
      return;
    }
    const room = new Room();
    roomRef.current = room;
    room.connect(livekitUrl, token).catch(() => {
      router.push(`/session/${id}/reading-room`);
    });
    return () => { room.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const bookId = searchParams.get('bookId');
    if (!bookId) { setLoading(false); return; }

    getBookActivities(bookId)
      .then((list) => { setActivities(list); setLoading(false); })
      .catch(() => setLoading(false));
  }, [searchParams]);

  useEffect(() => {
    if (!sid) return;
    getSnapshot(sid, participantId ?? undefined)
      .then((snap) => {
        if (snap?.activity_state && Object.keys(snap.activity_state).length) {
          setRemoteState(snap.activity_state as AnyActivityState);
        }
      })
      .catch(() => {});
  }, [sid, participantId]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;

    function onData(payload: Uint8Array) {
      let msg: SyncMessage;
      try { msg = JSON.parse(decoder.decode(payload)) as SyncMessage; } catch { return; }

      switch (msg.type) {
        case 'ACTIVITY_SYNC':
          setRemoteState(msg.payload.state as AnyActivityState);
          break;
        case 'ACTIVITY_NEXT':
          if (role === 'guest') {
            const idx = typeof msg.payload.index === 'number' ? msg.payload.index : activityIndex + 1;
            setActivityIndex(idx);
            setRemoteState(null);
          }
          break;
        case 'ACTIVITY_RESET':
          setRemoteState(null);
          break;
        case 'ACTIVITY_END':
          router.push(`/session/${id}/complete`);
          break;
      }
    }

    room.on(RoomEvent.DataReceived, onData);
    return () => { room.off(RoomEvent.DataReceived, onData); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, activityIndex]);

  const broadcast = useCallback((type: string, payload: Record<string, unknown> = {}) => {
    roomRef.current?.localParticipant.publishData(buildMsg(type, payload), { reliable: true });
  }, []);

  const handleSync = useCallback((state: AnyActivityState) => {
    broadcast('ACTIVITY_SYNC', { state });
    if (sid && participantId) {
      updateSnapshot(sid, participantId, 1, undefined, state as object).catch(() => {});
    }
  }, [broadcast, sid, participantId]);

  const handleNext = useCallback(() => {
    const nextIdx = activityIndex + 1;
    if (nextIdx < activities.length) {
      setActivityIndex(nextIdx);
      setRemoteState(null);
      broadcast('ACTIVITY_NEXT', { index: nextIdx });
    } else {
      if (role === 'host' && sid && participantId) {
        completeSession(sid, participantId).catch(() => {});
        broadcast('ACTIVITY_END', {});
      }
      router.push(`/session/${id}/complete`);
    }
  }, [activityIndex, activities.length, broadcast, role, sid, participantId, id, router]);

  const handleReset = useCallback(() => {
    broadcast('ACTIVITY_RESET', {});
  }, [broadcast]);

  const current = activities[activityIndex];
  const isHost = role === 'host';

  return (
    <div className="h-screen w-screen bg-gradient-to-br from-[#3d3b62] to-[#764f84] text-[#e5e2e1] flex flex-col overflow-hidden">
      {/* Top nav */}
      <header className="flex justify-between items-center px-6 py-4 bg-[#3d3b62]/90 border-b border-white/10 z-50 flex-shrink-0">
        <div className="flex items-center gap-4">
          <span className="font-baloo font-bold text-xl text-[#f0c75e]">{bookTitle}</span>
          <div className="h-5 w-px bg-white/20" />
          <span className="font-karla text-white/80 text-sm">{current?.title ?? 'Activity'}</span>
          {activities.length > 1 && (
            <span className="font-karla text-xs text-white/50">
              {activityIndex + 1} / {activities.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="font-baloo text-[#f0c75e] text-lg tracking-widest">
            <BookOpen className="w-5 h-5 inline mr-2" />
            Activity Room
          </div>
          <button
            onClick={() => router.push(`/session/${id}/reading-room`)}
            aria-label="Back to reading room"
            className="font-karla flex items-center gap-2 text-white/70 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/10 transition-all text-sm"
          >
            <X className="w-4 h-4" />
            Exit
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 rounded-full border-2 border-[#f0c75e] border-t-transparent animate-spin" />
          </div>
        ) : !current ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <p className="font-karla text-white/70">No activities configured for this book.</p>
            <button onClick={() => router.push(`/session/${id}/reading-room`)} className="font-karla text-[#f0c75e] underline text-sm">
              Back to Reading Room
            </button>
          </div>
        ) : current.activity_type === 'drawing' ? (
          <DrawingActivity
            config={current.config as any}
            isHost={isHost}
            onSync={(json) => handleSync(json)}
            remoteState={typeof remoteState === 'string' ? remoteState : undefined}
            onNext={handleNext}
            onReset={handleReset}
          />
        ) : current.activity_type === 'drag_drop' ? (
          <DragDropActivity
            config={current.config as any}
            isHost={isHost}
            remoteState={remoteState as DragDropState | undefined}
            onSync={handleSync}
            onNext={handleNext}
            onReset={handleReset}
          />
        ) : current.activity_type === 'quiz' ? (
          <QuizActivity
            config={current.config as any}
            isHost={isHost}
            remoteState={remoteState as QuizState | undefined}
            onSync={handleSync}
            onNext={handleNext}
            onReset={handleReset}
          />
        ) : current.activity_type === 'hotspot' ? (
          <HotspotActivity
            config={current.config as any}
            isHost={isHost}
            remoteState={remoteState as HotspotState | undefined}
            onSync={handleSync}
            onNext={handleNext}
            onReset={handleReset}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="font-karla text-white/60">Unknown activity type: {current.activity_type}</p>
          </div>
        )}
      </main>
    </div>
  );
}
