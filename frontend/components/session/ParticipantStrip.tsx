'use client';

import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

/**
 * Floats the participant bubbles over the backdrop instead of reserving layout
 * space for them.
 *
 * The room previously gave video a fixed 288px aside, which took a quarter of
 * the stage away from the book on every desktop session. Overlaying the tiles
 * costs nothing: the book gets the full stage, and the faces stay visible.
 * They can be dragged if they ever sit over something the reader wants to see.
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
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset({
      x: drag.ox + (e.clientX - drag.x),
      y: drag.oy + (e.clientY - drag.y),
    });
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
  };

  return (
    <div
      /* `fixed`, not `absolute`: the strip renders inside <main>, which carries
         ~80px of top padding for the header, so an absolute `top: 50px` would
         land ~130px down the viewport. Fixed measures against the viewport, so
         the offsets below mean what they say. */
      className="room-recede pointer-events-auto fixed z-40 flex cursor-grab touch-none flex-wrap items-start justify-end gap-2 active:cursor-grabbing"
      style={{
        // Docked top-right: 20px in from the right edge, 50px down from the top.
        right: '20px',
        top: '50px',
        transform: `translate(${offset.x}px, ${offset.y}px)`,
        // Tiles are 1:1 squares sized by their container, so the strip supplies
        // the width. The vw ceilings keep the strip off the opposite edge on
        // narrow screens, so they scale with the px values rather than clamping
        // them back down.
        width: compact
          ? 'min(56vw, 300px)'
          : count <= 1
            ? 'min(80vw, 490px)'
            : 'min(92vw, 1000px)',
        // Never taller than the space below the 50px offset.
        maxHeight: 'calc(100dvh - 70px)',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => setOffset({ x: 0, y: 0 })}
      title="Drag to move · Double-click to reset"
    >
      {children}
    </div>
  );
}
