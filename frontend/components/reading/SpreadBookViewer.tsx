'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import type { BookPageData } from '@/lib/api';

export type ReadingSpread = {
  left: BookPageData | null;
  right: BookPageData | null;
  leftPageNumber: number;
};

function BookPageImage({
  url,
  pageNumber,
  objectFit,
}: {
  url: string;
  pageNumber: number;
  objectFit: 'contain' | 'cover';
}) {
  // Track which URL has actually decoded. Keying the <img> on `url` and hiding
  // it until `onLoad` made every page turn flash blank paper, because the
  // outgoing page unmounts immediately while the incoming one starts at
  // opacity 0. Holding the last decoded URL keeps a page on screen throughout.
  const [shownUrl, setShownUrl] = useState<string | null>(null);
  const fit = objectFit === 'cover' ? 'object-cover' : 'object-contain';
  const isCurrent = shownUrl === url;

  // A cached image can finish decoding before React attaches the onLoad
  // handler, leaving it stuck at opacity 0. Reconcile against the element's own
  // `complete` flag on mount and whenever the URL changes.
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth > 0) setShownUrl(url);
  }, [url]);

  return (
    <div className="relative h-full w-full" style={{ background: 'var(--book-paper, #f6f2ea)' }}>
      {shownUrl && !isCurrent && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={shownUrl}
          alt=""
          aria-hidden
          className={`absolute inset-0 h-full w-full ${fit}`}
        />
      )}
      {!isCurrent && !shownUrl && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-12 w-12 animate-spin text-stone-300" />
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={url}
        alt={`Page ${pageNumber}`}
        className={`relative h-full w-full ${fit} transition-opacity duration-200 ${isCurrent ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setShownUrl(url)}
        onError={() => setShownUrl(url)}
      />
    </div>
  );
}

const SWIPE_PX = 48;
/** Keep in sync with `--dur-page` in room-tokens.css. */
const FLIP_MS = 460;

type SpreadBookViewerProps = {
  spread: ReadingSpread;
  width: number;
  height: number;
  /** Changes when the visible spread changes — drives the page-turn animation */
  transitionKey: number | string;
  className?: string;
  swipeEnabled?: boolean;
  onSwipePrev?: () => void;
  onSwipeNext?: () => void;
  /** Use object-cover for page images instead of letterboxed contain (trade-off: cropping). */
  coverPages?: boolean;
};

/**
 * Warms the browser cache for pages either side of the current spread. Without
 * this the incoming pages are still downloading while the turn animates, so the
 * new spread paints blank for a beat after every page turn.
 */
export function usePreloadSpreads(pages: BookPageData[], currentIndex: number, radius = 4) {
  useEffect(() => {
    if (typeof window === 'undefined' || !pages.length) return;
    const from = Math.max(0, currentIndex - radius);
    const to = Math.min(pages.length - 1, currentIndex + radius);
    for (let i = from; i <= to; i++) {
      const url = pages[i]?.image_url;
      if (!url) continue;
      const img = new window.Image();
      img.src = url;
    }
  }, [pages, currentIndex, radius]);
}

/** One half of the spread, including its page number caption. */
function SpreadHalf({
  page,
  pageNumber,
  objectFit,
  side,
  solo = false,
}: {
  page: BookPageData | null;
  pageNumber: number;
  objectFit: 'contain' | 'cover';
  side: 'left' | 'right';
  /** Rendered alone (odd page count) — keep it centred at page width. */
  solo?: boolean;
}) {
  return (
    <div
      className={`relative flex min-h-0 min-w-0 flex-1 flex-col ${
        side === 'right' ? 'border-l border-[#d9cfc2]/70' : ''
      } ${solo ? 'mx-auto max-w-[52%]' : ''}`}
    >
      {page ? (
        <BookPageImage url={page.image_url} pageNumber={pageNumber} objectFit={objectFit} />
      ) : (
        <div className="h-full w-full" style={{ background: 'var(--book-paper, #f6f2ea)' }} />
      )}
      {page && (
        <div
          className={`pointer-events-none absolute bottom-4 z-20 ${
            side === 'left' ? 'left-4' : 'right-4 text-right'
          }`}
        >
          <span className="font-karla text-[10px] text-stone-400">Page {pageNumber}</span>
        </div>
      )}
    </div>
  );
}

export function SpreadBookViewer({
  spread,
  width,
  height,
  transitionKey,
  className = '',
  swipeEnabled,
  onSwipePrev,
  onSwipeNext,
  coverPages = false,
}: SpreadBookViewerProps) {
  const swipeStartX = useRef<number | null>(null);
  const capturedPointer = useRef<number | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!swipeEnabled || (!onSwipePrev && !onSwipeNext)) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      swipeStartX.current = e.clientX;
      capturedPointer.current = e.pointerId;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [swipeEnabled, onSwipePrev, onSwipeNext],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (capturedPointer.current !== e.pointerId) return;
      capturedPointer.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ok */
      }
      const start = swipeStartX.current;
      swipeStartX.current = null;
      if (start == null) return;
      const dx = e.clientX - start;
      if (dx > SWIPE_PX && onSwipePrev) onSwipePrev();
      else if (dx < -SWIPE_PX && onSwipeNext) onSwipeNext();
    },
    [onSwipePrev, onSwipeNext],
  );

  const onPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capturedPointer.current === e.pointerId) {
      capturedPointer.current = null;
      swipeStartX.current = null;
    }
  }, []);

  const { left, right, leftPageNumber } = spread;
  const objectFit: 'contain' | 'cover' = coverPages ? 'cover' : 'contain';
  const shouldReduceMotion = useReducedMotion();

  // ── Page-turn animation ───────────────────────────────────────────────────
  // Page turns are host-driven and synced over LiveKit, and a Fabric annotation
  // canvas is positioned over the spread, so the viewer never owns navigation.
  // The spread therefore animates on arrival rather than driving the turn: each
  // new spread swings in from the side it came from. framer-motion keys the
  // animation off the spread index, which avoids hand-rolled timers and the
  // mount/unmount races that come with them.
  const prevPageRef = useRef<number>(spread.leftPageNumber);
  const goingForward = spread.leftPageNumber >= prevPageRef.current;
  useEffect(() => {
    prevPageRef.current = spread.leftPageNumber;
  }, [spread.leftPageNumber]);

  return (
    <div
      className={`touch-none ${className}`}
      style={{ width, height, perspective: `${Math.max(width, 900) * 1.6}px` }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <motion.div
        key={transitionKey}
        className="relative flex h-full w-full overflow-hidden"
        style={{
          background: 'var(--book-paper, #f6f2ea)',
          transformStyle: 'preserve-3d',
          transformPerspective: 2200,
          transformOrigin: goingForward ? 'left center' : 'right center',
        }}
        initial={
          shouldReduceMotion
            ? false
            : { rotateY: goingForward ? 22 : -22, x: goingForward ? '5%' : '-5%', opacity: 0.5 }
        }
        animate={{ rotateY: 0, x: 0, opacity: 1 }}
        transition={{ duration: FLIP_MS / 1000, ease: [0.22, 0.61, 0.36, 1] }}
      >
        <SpreadHalf
          page={left}
          pageNumber={leftPageNumber}
          objectFit={objectFit}
          side="left"
          solo={!right}
        />
        {/* A book with an odd page count (or a single page) would otherwise show
            an empty cream panel beside the content; render it as one centred
            page instead of a half-empty spread. */}
        {right && (
          <SpreadHalf
            page={right}
            pageNumber={leftPageNumber + 1}
            objectFit={objectFit}
            side="right"
          />
        )}

        {/* Centre gutter shadow — sells the two halves as one bound book. */}
        {right && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-1/2 z-10 w-10 -translate-x-1/2 room-book-gutter"
          />
        )}
      </motion.div>
    </div>
  );
}
