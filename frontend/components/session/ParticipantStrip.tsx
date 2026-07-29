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
}: {
  children: ReactNode;
  /** Drives the strip width so one face is not blown up to the size of two. */
  count?: number;
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
      className="room-recede pointer-events-auto absolute z-40 flex cursor-grab touch-none flex-wrap items-end justify-end gap-2 active:cursor-grabbing"
      style={{
        right: '1rem',
        bottom: '2rem',
        transform: `translate(${offset.x}px, ${offset.y}px)`,
        // Tiles are 1:1 squares sized by their container, so the strip supplies
        // the width. At 168px a two-column grid gave ~80px faces — too small to
        // read expression on, which is most of the point of having video in a
        // reading session at all. These give ~245px tiles either way: 3x.
        width: count <= 1 ? 'min(46vw, 245px)' : 'min(72vw, 500px)',
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
