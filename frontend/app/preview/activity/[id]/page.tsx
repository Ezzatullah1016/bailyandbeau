'use client';

/**
 * Staff preview of a single activity, mounting the **real** runtime component.
 *
 * The staff portal is server-rendered Django, so it cannot host the React
 * activity panes directly. This route exists to be iframed from
 * `/staff/activities/`: because it renders `ActivityRoom` itself rather than a
 * mock-up, the preview cannot drift from what the child actually sees.
 *
 * Staff-only: it reads a draft activity through the admin API, which is
 * `IsAdminUser`. A non-staff visitor gets the error state, not the content.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { RoomContext } from '@livekit/components-react';
import { Room } from 'livekit-client';
import ActivityRoom from '@/components/activity/ActivityRoom';
import { adminListActivities, type ActivityConfigData } from '@/lib/api';

export default function ActivityPreviewPage() {
  // Next 14: `params` is a plain object, not a promise, and every other dynamic
  // route here reads it through useParams.
  const { id } = useParams<{ id: string }>();
  const [activity, setActivity] = useState<ActivityConfigData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A detached Room satisfies ActivityRoom's useRoomContext without connecting
  // to LiveKit — the same trick the old builder preview used.
  const [room] = useState(() => new Room());

  useEffect(() => {
    // The admin list is the only endpoint that returns drafts; previewing an
    // unpublished activity is the entire point.
    adminListActivities()
      .then((all) => {
        const found = all.find((a) => a.id === id);
        if (found) setActivity(found);
        else setError('That activity could not be found.');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the activity.'));
  }, [id]);

  // Disconnecting a Room that never connected throws; the preview only needs
  // the context object, so guard it.
  useEffect(() => () => { try { void room.disconnect(); } catch { /* never connected */ } }, [room]);

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#faf7f6] p-8 text-center">
        <div>
          <p className="font-baloo text-lg font-bold text-brand-navy">Preview unavailable</p>
          <p className="font-karla mt-1 text-sm text-stone-500">{error}</p>
          <p className="font-karla mt-1 text-xs text-stone-400">
            Sign in to the app as a staff user, then reload.
          </p>
        </div>
      </div>
    );
  }

  if (!activity) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#faf7f6]">
        <p className="font-karla text-sm text-stone-500">Loading preview…</p>
      </div>
    );
  }

  return (
    <div className="room-root min-h-screen bg-[#faf7f6] p-4" data-chrome="light">
      <RoomContext.Provider value={room}>
        <ActivityRoom
          role="host"
          activities={[activity]}
          open
          variant="stage"
          initialIndex={0}
          /* Intentionally inert: this renders inside an iframe in the staff
             builder, where there is no room to return to. The close control is
             the surrounding page's, not this preview's. */
          /* Intentionally inert: this renders inside an iframe in the staff
             portal's activity builder, so there is no room to return to. */
          onClose={() => {}}
        />
      </RoomContext.Provider>
    </div>
  );
}
