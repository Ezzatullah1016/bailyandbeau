'use client';

import { useCallback, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { BookPageData } from '@/lib/api';

export type ReadingSpread = {
  left: BookPageData | null;
  right: BookPageData | null;
  leftPageNumber: number;
};

function BookPageImage({ url, pageNumber }: { url: string; pageNumber: number }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative h-full w-full bg-white">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-12 w-12 animate-spin text-stone-300" />
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={url}
        src={url}
        alt={`Page ${pageNumber}`}
        className={`h-full w-full object-contain transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    </div>
  );
}

const SWIPE_PX = 48;

type SpreadBookViewerProps = {
  spread: ReadingSpread;
  width: number;
  height: number;
  /** Changes when the visible spread changes — drives enter transition */
  transitionKey: number | string;
  className?: string;
  swipeEnabled?: boolean;
  onSwipePrev?: () => void;
  onSwipeNext?: () => void;
};

export function SpreadBookViewer({
  spread,
  width,
  height,
  transitionKey,
  className = '',
  swipeEnabled,
  onSwipePrev,
  onSwipeNext,
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

  return (
    <div
      className={`touch-none ${className}`}
      style={{ width, height }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div
        key={transitionKey}
        className="flex h-full w-full overflow-hidden bg-white transition-opacity duration-200 motion-reduce:transition-none"
      >
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {left ? (
            <BookPageImage url={left.image_url} pageNumber={leftPageNumber} />
          ) : (
            <div className="h-full w-full bg-white" />
          )}
          {left && (
            <div className="pointer-events-none absolute bottom-4 left-4 z-20">
              <span className="font-karla text-[10px] text-stone-400">Page {leftPageNumber}</span>
            </div>
          )}
        </div>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col border-l border-stone-100">
          {right ? (
            <BookPageImage url={right.image_url} pageNumber={leftPageNumber + 1} />
          ) : (
            <div className="h-full w-full bg-white" />
          )}
          {right && (
            <div className="pointer-events-none absolute bottom-4 right-4 z-20 text-right">
              <span className="font-karla text-[10px] text-stone-400">Page {leftPageNumber + 1}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
