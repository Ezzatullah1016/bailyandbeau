'use client';

import type { ReactNode } from 'react';

/**
 * The room's layout: header, body, dock — and the body is canvas plus sidebar.
 *
 * The room was previously assembled out of `position: fixed` pieces: a floating
 * header, a rail pinned to the left edge, a participant strip pinned 20px from
 * the right. Nothing reserved space, so every region overlapped the canvas and
 * the canvas had to be padded by hand to dodge them (`pl-14`, `pt-[5rem]`,
 * `lg:pr-[190px]` inside the panes). Those paddings had to be kept in step with
 * chrome they knew nothing about, and they drifted.
 *
 * Here each region is a grid cell. Nothing overlaps, nothing needs a dodge, and
 * the canvas gets exactly what is left. The grid is declared in
 * `app/room-tokens.css` (`.room-shell` / `.room-shell-body`) so the measurements
 * live with the other room tokens.
 */
export function RoomShell({
  header,
  sidebar,
  dock,
  children,
}: {
  header: ReactNode;
  sidebar: ReactNode;
  dock: ReactNode;
  /** The canvas: the book, the activity picker, or an activity. */
  children: ReactNode;
}) {
  return (
    <div className="room-shell">
      {header}

      <div className="room-shell-body">
        {/* min-h-0 is load-bearing: without it a tall canvas (a drawing pane, a
            long option list) pushes the grid past the viewport and the dock
            scrolls off the bottom of the screen. */}
        <main className="relative flex min-h-0 min-w-0 flex-col">{children}</main>
        {sidebar}
      </div>

      {dock}
    </div>
  );
}
