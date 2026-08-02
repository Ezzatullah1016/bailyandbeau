'use client';

import type { ReactNode } from 'react';

/**
 * Floats the participant bubbles over the backdrop instead of reserving layout
 * space for them.
 *
 * The room previously gave video a fixed 288px aside, which took a quarter of
 * the stage away from the book on every desktop session. Overlaying the tiles
 * costs nothing: the book gets the full stage, and the faces stay visible.
 *
 * Docked, not draggable. Dragging was there so a tile could be moved off
 * something it covered, but it made the strip easy to knock out of place by
 * accident and the offset persisted across renders — a tile nudged during one
 * activity stayed skewed for the rest of the session. A fixed corner is
 * predictable, and the panes below are laid out to leave it room.
 */
export function ParticipantStrip({
  children,
  count = 1,
  compact = false,
}: {
  children: ReactNode;
  /** Drives the strip width so one face is not blown up to the size of two. */
  count?: number;
  /**
   * Shrinks the strip where the stage content reaches the edges — the activity
   * carousel runs the full width, and a full-size tile lands on top of the last
   * card and its Play button.
   */
  compact?: boolean;
}) {
  return (
    <div
      className="room-recede pointer-events-auto fixed z-40 flex flex-wrap items-start justify-end gap-2"
      style={{
        // Docked top-right: 20px in from the right edge, 50px down from the top.
        right: '20px',
        top: '50px',
        // Tiles are 1:1 squares sized by their container, so the strip supplies
        // the width. The vw ceilings keep the strip off the opposite edge on
        // narrow screens.
        width: compact
          ? 'min(28vw, 150px)'
          : count <= 1
            ? 'min(40vw, 245px)'
            : // Two-up is a 2-column grid, so this width is halved per tile. The
              // vw ceiling is deliberately looser than the solo case: at 46vw a
              // phone gave ~86px faces, too small to read expression on.
              'min(80vw, 500px)',
        // Never taller than the space below the 50px offset.
        maxHeight: 'calc(100dvh - 70px)',
      }}
    >
      {children}
    </div>
  );
}
