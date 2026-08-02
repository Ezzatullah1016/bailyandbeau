'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Check, Sparkles, X } from 'lucide-react';

import { usePaneMotion } from './motion';
import type { Hotspot } from './shared';

/** Popup geometry, in percentages of the image box. */
const CARD_W = 46; // popup width as a % of the image width
const GAP = 2.5; // gap between the marker and the card
const EDGE = 2; // keep this far from the image edge

type Placement = { left: number; top: number; side: 'left' | 'right' | 'above' | 'below' };

/**
 * Place the card beside the hotspot, flipping when it would overflow.
 *
 * The old popup ignored the hotspot entirely and sat dead-centre over the
 * image, so nothing connected the text to the thing the child tapped. Working
 * in percentages (the same units the hotspots are authored in) keeps the maths
 * resolution-independent — no measuring, no layout thrash on resize.
 */
function placeCard(h: Hotspot): Placement {
  const cx = h.x + h.w / 2;
  const rightEdge = h.x + h.w;

  // Prefer the side with more room, so the card never covers the subject.
  if (100 - rightEdge >= CARD_W + GAP + EDGE) {
    return { left: rightEdge + GAP, top: clampTop(h.y + h.h / 2), side: 'right' };
  }
  if (h.x >= CARD_W + GAP + EDGE) {
    return { left: h.x - GAP - CARD_W, top: clampTop(h.y + h.h / 2), side: 'left' };
  }
  // Not enough width either side: go vertical, centred on the marker.
  const left = clamp(cx - CARD_W / 2, EDGE, 100 - CARD_W - EDGE);
  return h.y > 50
    ? { left, top: h.y - GAP, side: 'above' }
    : { left, top: h.y + h.h + GAP, side: 'below' };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(v, hi));
}
/** Vertical centre for a side-placed card, kept inside the frame. */
function clampTop(v: number) {
  return clamp(v, 18, 82);
}

export function HotspotPane({
  payload,
  openId,
  visitedIds,
  patchCurrent,
}: {
  payload: Record<string, unknown>;
  openId: string | null;
  visitedIds: string[];
  patchCurrent: (patch: Record<string, unknown>) => void;
}) {
  const m = usePaneMotion();
  const url = String(payload.image_url ?? '');
  const hotspots = (payload.hotspots as Hotspot[]) ?? [];
  const active = hotspots.find((h) => h.id === openId);
  // 1.1 adds a "popup" display mode; 1.0 rows (no display) keep the panel.
  const isPopup = payload.display === 'popup';

  const visited = new Set(visitedIds);
  const allFound = hotspots.length > 0 && hotspots.every((h) => visited.has(h.id));

  function open(h: Hotspot) {
    patchCurrent({
      openId: h.id,
      visitedIds: visited.has(h.id) ? visitedIds : [...visitedIds, h.id],
    });
  }

  const place = active && isPopup ? placeCard(active) : null;

  return (
    <div className="relative">
      <div className="relative w-full overflow-hidden rounded-2xl border border-brand-purple/20 bg-brand-blush/30">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="mx-auto block h-auto max-h-[400px] w-full object-contain" />

        <div className="absolute inset-0">
          {hotspots.map((h) => {
            const isVisited = visited.has(h.id);
            const isOpen = h.id === openId;
            return (
              <motion.button
                key={h.id}
                type="button"
                onClick={() => open(h)}
                className="absolute grid cursor-pointer place-items-center rounded-full"
                style={{
                  // Markers are discs centred on the authored box, not the box
                  // itself: a translucent rectangle over an illustration reads
                  // as damage, a glowing dot reads as an invitation.
                  left: `${h.x + h.w / 2}%`,
                  top: `${h.y + h.h / 2}%`,
                  // 44px hit area for a small visual disc: children have poor
                  // fine motor control, and the disc is deliberately modest so
                  // it does not cover the illustration it points at.
                  width: 44,
                  height: 44,
                  transform: 'translate(-50%, -50%)',
                }}
                whileHover={m.hover}
                whileTap={m.press}
                aria-label={isVisited ? `Discovery spot, already found` : `Discovery spot`}
                aria-pressed={isOpen}
              >
                {/* Halo. Only unvisited spots pulse — once found, a spot goes
                    quiet so what is left to explore stays obvious. */}
                {!isVisited && !m.reduced ? (
                  <motion.span
                    className="absolute h-6 w-6 rounded-full"
                    style={{ background: '#f0c75e', opacity: 0.35 }}
                    animate={{ scale: [1, 1.7], opacity: [0.45, 0] }}
                    transition={{ duration: 1.9, repeat: Infinity, ease: 'easeOut' }}
                    aria-hidden
                  />
                ) : null}
                {/* Literal colours, not room tokens: this disc sits on the
                    author's illustration, so it needs guaranteed contrast
                    rather than whatever the book theme happens to be. */}
                <span
                  className="relative grid h-6 w-6 place-items-center rounded-full shadow-lg ring-2 ring-white/90"
                  style={{ background: isVisited ? '#3b85a6' : '#f0c75e' }}
                >
                  {isVisited ? (
                    <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 text-brand-navy" />
                  )}
                </span>
              </motion.button>
            );
          })}
        </div>

        {/* Anchored popup (1.1). No scrim: dimming the illustration to read one
            sentence about the illustration is backwards. */}
        <AnimatePresence>
          {isPopup && active && place ? (
            <motion.div
              key={active.id}
              variants={m.popIn}
              initial="hidden"
              animate="show"
              exit="exit"
              className="absolute z-20"
              style={{
                left: `${place.left}%`,
                width: `${CARD_W}%`,
                top: `${place.top}%`,
                transform:
                  place.side === 'above'
                    ? 'translateY(-100%)'
                    : place.side === 'below'
                      ? 'none'
                      : 'translateY(-50%)',
                // Grow out of the marker rather than out of the card's middle.
                transformOrigin:
                  place.side === 'right'
                    ? 'left center'
                    : place.side === 'left'
                      ? 'right center'
                      : place.side === 'above'
                        ? 'center bottom'
                        : 'center top',
              }}
              role="dialog"
              aria-label="Discovery"
            >
              <div
                className="relative rounded-2xl p-4 shadow-2xl ring-1 ring-black/5"
                style={{ background: 'var(--activity-paper)', color: 'var(--room-ink)' }}
              >
                {/* Tail: the thing that makes it belong to the marker. */}
                <span
                  className="absolute h-3 w-3 rotate-45 ring-1 ring-black/5"
                  style={{
                    background: 'var(--activity-paper)',
                    ...(place.side === 'right' ? { left: -6, top: 'calc(50% - 6px)' } : {}),
                    ...(place.side === 'left' ? { right: -6, top: 'calc(50% - 6px)' } : {}),
                    ...(place.side === 'above' ? { bottom: -6, left: 'calc(50% - 6px)' } : {}),
                    ...(place.side === 'below' ? { top: -6, left: 'calc(50% - 6px)' } : {}),
                  }}
                  aria-hidden
                />
                <button
                  type="button"
                  onClick={() => patchCurrent({ openId: null })}
                  aria-label="Close"
                  className="absolute right-1 top-1 grid h-11 w-11 cursor-pointer place-items-center rounded-full opacity-50 transition-opacity hover:opacity-100"
                  style={{ color: 'var(--room-ink)' }}
                >
                  <X className="h-4 w-4" />
                </button>
                <p className="pr-9 text-sm font-semibold leading-relaxed">{active.content}</p>
                <button
                  type="button"
                  onClick={() => patchCurrent({ openId: null })}
                  className="font-baloo mt-3 min-h-11 w-full cursor-pointer rounded-xl px-4 text-sm font-bold transition-opacity hover:opacity-90"
                  style={{ background: 'var(--room-accent)', color: 'var(--room-accent-contrast)' }}
                >
                  Got it!
                </button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* Panel display (1.0 default). */}
      {!isPopup ? (
        active ? (
          <div
            className="mt-4 rounded-xl border border-brand-purple/20 p-4"
            style={{ background: 'var(--activity-paper)', color: 'var(--room-ink)' }}
          >
            <p className="text-sm font-semibold">{active.content}</p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-brand-purple">Tap a highlighted area.</p>
        )
      ) : null}

      {/* Progress. A child cannot tell how much is left from the picture alone. */}
      {isPopup && hotspots.length > 0 ? (
        <div className="mt-4 flex items-center justify-center gap-2">
          <AnimatePresence mode="wait">
            {allFound ? (
              <motion.p
                key="done"
                variants={m.riseIn}
                initial="hidden"
                animate="show"
                exit="exit"
                className="font-baloo text-sm font-bold text-brand-teal"
              >
                Every spot found — nice exploring!
              </motion.p>
            ) : (
              <motion.p
                key="progress"
                variants={m.riseIn}
                initial="hidden"
                animate="show"
                exit="exit"
                className="text-sm text-brand-purple"
              >
                {visited.size} of {hotspots.length} spots found
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      ) : null}
    </div>
  );
}
