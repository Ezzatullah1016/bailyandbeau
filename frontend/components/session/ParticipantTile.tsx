'use client';

import { Mic, MicOff } from 'lucide-react';
import { useLocalParticipant, useParticipants, useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';

import { HostChip, RoleChip } from './RoleChip';

/** Initials from a display name, for the placeholder when video is off. */
function participantInitials(label: string): string {
  const parts = label.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * A 16:9 video tile, sized by the sidebar column.
 *
 * Previously a 1:1 square, because the tiles floated over the book in a corner
 * and a square packed that corner best. They now live in a real sidebar column,
 * and webcams are 16:9 — a square cropped a third of every frame away.
 *
 * With the camera off it shows initials on the room accent rather than a generic
 * person glyph, so several people with cameras off are still tellable apart. The
 * name and mic state sit on a gradient strip over the video so they are always
 * legible without a separate row, and the two corner chips answer the two
 * questions a family actually asks: what may this person do (role), and who is
 * driving right now (host).
 */
export function ParticipantTile({
  identity,
  label,
  isHost,
}: {
  identity: string;
  label: string;
  isHost: boolean;
}) {
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
      className="relative aspect-video w-full min-w-0 overflow-hidden"
      style={{
        background: 'var(--room-chrome-strong)',
        border: '1px solid var(--room-chrome-line)',
        borderRadius: 'var(--r-md)',
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
            className="font-baloo text-2xl font-bold tracking-wide"
            style={{ color: 'var(--room-accent-contrast)' }}
            aria-hidden
          >
            {participantInitials(label)}
          </span>
        </div>
      )}

      {/* The chips and name strip overlay the video deliberately — they label
          the frame they sit on, and the screens place them inside it. */}
      <RoleChip role={isHost ? 'host' : 'guest'} className="absolute left-2 top-2" />
      {isHost && <HostChip className="absolute right-2 top-2" />}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/72 to-transparent px-3 pb-2 pt-6">
        <span className="min-w-0 flex-1 truncate font-karla text-[13px] font-semibold text-white">
          {label}
        </span>
        <span
          className="shrink-0 text-white"
          title={micOn ? `${label} is unmuted` : `${label} is muted`}
        >
          {micOn ? (
            <Mic className="h-4 w-4" aria-hidden />
          ) : (
            <MicOff className="h-4 w-4" aria-hidden />
          )}
          <span className="sr-only">{micOn ? 'Microphone on' : 'Microphone muted'}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * The sidebar's tile stack. One column: the column is 352px wide, and a 16:9
 * tile halved by a two-up grid gives a ~166px-wide face — too small to read an
 * expression on, which is the whole point of the video.
 */
export function ParticipantList({
  hostIdentity,
  viewerRole,
}: {
  hostIdentity?: string;
  /**
   * The viewer's own role, from the session record.
   *
   * `hostIdentity` comes from LiveKit, and before the socket connects the local
   * participant's identity is the empty string — so an Adventure Guide watched
   * their own tile claim they were an Explorer for the first second of every
   * session. The session already knows which seat this browser holds, so the
   * local tile uses that and never has to guess.
   */
  viewerRole?: 'host' | 'guest';
}) {
  const participants = useParticipants();
  const localIdentity = useLocalParticipant().localParticipant?.identity;

  return (
    <div className="flex w-full flex-col gap-3">
      {participants.map((p) => {
        const isSelf = Boolean(localIdentity) && p.identity === localIdentity;
        return (
          <ParticipantTile
            key={p.identity}
            identity={p.identity}
            label={p.name || p.identity}
            isHost={isSelf && viewerRole ? viewerRole === 'host' : p.identity === hostIdentity}
          />
        );
      })}
    </div>
  );
}
