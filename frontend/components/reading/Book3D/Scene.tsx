'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Loader2 } from 'lucide-react';

import type { BookPageData } from '@/lib/api';
import { Book } from './Book';

export type Book3DProps = {
  pages: BookPageData[];
  /** Leaf index. 0 = closed on the cover. */
  page: number;
  instant?: boolean;
  title: string;
  accent?: string;
  ink?: string;
  onTurnStateChange?: (turning: boolean) => void;
  /** Camera dolly, driven by the zoom controls on the rail. */
  zoom?: number;
  className?: string;
};

/** Detects WebGL support once, before mounting the canvas. */
function detectWebGL(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      canvas.getContext('webgl2') ??
        canvas.getContext('webgl') ??
        canvas.getContext('experimental-webgl'),
    );
  } catch {
    return false;
  }
}

/**
 * Static fallback shown when WebGL is unavailable.
 *
 * 3D is the only book renderer — there is no parallel 2D book being maintained.
 * But a session on a device with a blacklisted GPU driver or a locked-down
 * browser should degrade to a readable page rather than an empty stage, because
 * the alternative is a family sitting in front of a blank screen with no way to
 * continue.
 */
function StaticBook({ pages, page }: { pages: BookPageData[]; page: number }) {
  const leftIndex = Math.max(0, page * 2 - 1);
  const left = pages[leftIndex];
  const right = pages[leftIndex + 1];

  return (
    <div className="flex h-full w-full items-center justify-center gap-1 p-4">
      {[left, right].map((p, i) =>
        p ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={p.id ?? i}
            src={p.image_url}
            alt={`Page ${p.page_number}`}
            crossOrigin="anonymous"
            className="h-full max-h-full w-auto rounded-sm object-contain shadow-lg"
          />
        ) : null,
      )}
    </div>
  );
}

export default function Book3DScene({
  pages,
  page,
  instant = false,
  title,
  accent = '#3d3b62',
  ink = '#fdfbf7',
  onTurnStateChange,
  zoom = 1,
  className,
}: Book3DProps) {
  const [webglOk, setWebglOk] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(1.6);

  useEffect(() => setWebglOk(detectWebGL()), []);

  // The camera distance is derived from the container aspect so the open book
  // fills the stage without being cropped at any viewport. This replaces the
  // fixed pixel sizing the 2D viewer used.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setAspect(width / height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleCreated = useCallback(() => setFailed(false), []);

  // Frame the open book. Measured world bounds of the rendered book are about
  // 2.21 wide x 1.78 tall (the fanned leaves make it wider than two flat pages
  // and shorter than one, so deriving this from PAGE_WIDTH/HEIGHT alone
  // under-frames it and crops the edges).
  //
  // fov/2 in radians is the half-angle, so required distance is
  // halfExtent / tan(halfAngle): vertically direct, horizontally after
  // dividing by the viewport aspect.
  const FOV = 45;
  const halfAngle = (FOV * Math.PI) / 360;
  const BOOK_HALF_W = 1.15;
  const BOOK_HALF_H = 0.95;

  const distanceForHeight = BOOK_HALF_H / Math.tan(halfAngle);
  const distanceForWidth = BOOK_HALF_W / (Math.tan(halfAngle) * Math.max(aspect, 0.3));
  // 1.15 leaves a breathing margin so the book never touches the stage edges.
  const distance =
    (Math.max(distanceForHeight, distanceForWidth) * 1.15) / Math.max(0.5, zoom);

  if (webglOk === null) {
    return (
      <div ref={containerRef} className={className}>
        <div className="flex h-full w-full items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin" style={{ color: 'var(--room-ink-soft)' }} />
        </div>
      </div>
    );
  }

  if (!webglOk || failed) {
    return (
      <div ref={containerRef} className={className}>
        <StaticBook pages={pages} page={page} />
      </div>
    );
  }

  return (
    <div ref={containerRef} className={className}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 0, distance], fov: 45 }}
        onCreated={handleCreated}
        // A context that dies mid-session (GPU reset, tab backgrounded too
        // long) drops to the static book rather than leaving a black canvas.
        onError={() => setFailed(true)}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false }}
      >
        {/*
          Local lights rather than drei's <Environment preset>, which fetches an
          HDRI from a remote CDN — a network dependency that fails under CSP and
          adds a cold-start stall to every session.
        */}
        <ambientLight intensity={1.1} />
        <directionalLight
          position={[2, 4, 6]}
          intensity={1.6}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <directionalLight position={[-3, 2, 4]} intensity={0.5} />

        {/* No tilt on this group. The book's own group is already turned 90° on
            Y to face the camera, so an outer rotation-x tips it about the wrong
            axis and swings the spread back to edge-on. Measured world bounds
            confirm the book is 2.21 x 1.78 x 0.95 as rendered. */}
        <group>
          <Book
            pages={pages}
            page={page}
            instant={instant}
            title={title}
            accent={accent}
            ink={ink}
            onTurnStateChange={onTurnStateChange}
          />
        </group>
      </Canvas>
    </div>
  );
}
