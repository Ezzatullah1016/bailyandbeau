'use client';

import { Circle, Minus, Square } from 'lucide-react';

import type { AnnotationShape } from '@/components/annotation/types';

/** The reaction set. Content the child sends, not interface chrome. */
export const REACTION_EMOJI = ['❤️', '😂', '😮', '👏', '⭐', '🎉'];

const COLORS = ['#ef4444', '#f0c75e', '#5fd396', '#5fb3d4', '#764f84', '#2a1f3d'];
const BRUSHES = [4, 8, 14, 22];
const SHAPES: Array<{ id: AnnotationShape; label: string; Icon: typeof Square }> = [
  { id: 'rect', label: 'Rectangle', Icon: Square },
  { id: 'ellipse', label: 'Ellipse', Icon: Circle },
  { id: 'line', label: 'Line', Icon: Minus },
];

/**
 * The dock's popovers: colour and width for the pen and fill, a shape picker,
 * and the reaction tray.
 *
 * They open upward, anchored to the dock rather than floating loose in the
 * room, so the control and its options read as one thing. `absolute` here is
 * deliberate and local: a popover is by definition positioned against the
 * button that opened it.
 */
export function DockPopovers({
  open,
  color,
  brushSize,
  shape,
  onColorChange,
  onBrushSizeChange,
  onShapeChange,
  onReact,
  onClear,
}: {
  open: 'pen' | 'fill' | 'shapes' | 'reactions' | null;
  color: string;
  brushSize: number;
  shape: AnnotationShape;
  onColorChange: (c: string) => void;
  onBrushSizeChange: (n: number) => void;
  onShapeChange: (s: AnnotationShape) => void;
  onReact: (emoji: string) => void;
  onClear: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="room-bar absolute bottom-full left-4 z-30 mb-2 flex items-center gap-3 px-3 py-2.5"
      role="group"
      aria-label="Tool options"
    >
      {open === 'reactions' ? (
        REACTION_EMOJI.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact(emoji)}
            aria-label={`Send a ${emoji} reaction`}
            className="room-tap cursor-pointer rounded-full text-xl transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--room-accent)]"
          >
            {emoji}
          </button>
        ))
      ) : open === 'shapes' ? (
        SHAPES.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onShapeChange(id)}
            aria-label={label}
            title={label}
            aria-pressed={shape === id}
            className="room-tap cursor-pointer rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--room-accent)]"
            style={{
              background: shape === id ? 'var(--room-accent)' : 'rgba(255,255,255,0.06)',
              color: shape === id ? 'var(--room-accent-contrast)' : 'var(--room-ink)',
            }}
          >
            <Icon className="h-5 w-5" aria-hidden />
          </button>
        ))
      ) : (
        <>
          <div className="flex items-center gap-1.5" role="group" aria-label="Colour">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onColorChange(c)}
                aria-label={`Use the ${c} pen`}
                aria-pressed={color === c}
                className="h-8 w-8 cursor-pointer rounded-full transition-transform hover:scale-110 focus-visible:outline-none"
                style={{
                  background: c,
                  boxShadow:
                    color === c
                      ? '0 0 0 2px var(--room-chrome-strong), 0 0 0 4px var(--room-accent)'
                      : '0 0 0 1px rgba(255,255,255,0.22)',
                }}
              />
            ))}
          </div>

          {open === 'pen' && (
            <>
              <span
                aria-hidden
                className="h-8 w-px"
                style={{ background: 'var(--room-chrome-line)' }}
              />
              <div className="flex items-center gap-1.5" role="group" aria-label="Brush size">
                {BRUSHES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onBrushSizeChange(n)}
                    aria-label={`${n} pixel brush`}
                    aria-pressed={brushSize === n}
                    className="room-tap cursor-pointer rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--room-accent)]"
                    style={{
                      background:
                        brushSize === n ? 'rgba(240,199,94,0.18)' : 'rgba(255,255,255,0.06)',
                    }}
                  >
                    {/* The dot's diameter *is* the brush width, so the choice
                        needs no label to be understood. */}
                    <span
                      aria-hidden
                      className="block rounded-full"
                      style={{
                        width: n,
                        height: n,
                        background: brushSize === n ? 'var(--room-accent)' : 'var(--room-ink)',
                      }}
                    />
                  </button>
                ))}
              </div>

              <span
                aria-hidden
                className="h-8 w-px"
                style={{ background: 'var(--room-chrome-line)' }}
              />
              <button
                type="button"
                onClick={onClear}
                className="cursor-pointer whitespace-nowrap rounded-xl px-3 py-2 font-karla text-[13px] font-semibold transition-colors hover:bg-white/10"
                style={{ color: 'var(--c-pink)' }}
              >
                Clear page
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
