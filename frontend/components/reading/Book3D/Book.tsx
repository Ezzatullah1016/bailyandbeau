'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { easing } from 'maath';
import type { Group, Texture } from 'three';

import type { BookPageData } from '@/lib/api';
import { Page } from './Page';
import { PAGE_WIDTH } from './constants';
import { useBookTextures } from './useBookTextures';
import { useCoverTexture } from './useCoverTexture';

/** Time between leaves when a multi-page jump is animated as a sequence. */
const STEP_FAST_MS = 60;
const STEP_SLOW_MS = 150;
/** Beyond this many leaves, step faster so a long jump does not crawl. */
const FAST_JUMP_LEAVES = 2;

export type BookProps = {
  pages: BookPageData[];
  /** Target leaf index. 0 = closed on the front cover. */
  page: number;
  /** Skip the turn sequence and land immediately — used by remote participants. */
  instant?: boolean;
  title: string;
  accent: string;
  ink: string;
  onTurnStateChange?: (turning: boolean) => void;
};

type Leaf = {
  frontUrl: string | null;
  backUrl: string | null;
  isCover: boolean;
};

/**
 * Groups the flat page list into physical leaves.
 *
 * A leaf is one sheet of paper carrying two pages: the recto you see on the
 * right of the open book, and the verso that becomes the left page once turned.
 * The first and last leaves are the covers, which have no page art on their
 * outer face — that is drawn from the generated cover texture instead.
 */
function buildLeaves(pages: BookPageData[]): Leaf[] {
  const leaves: Leaf[] = [{ frontUrl: null, backUrl: pages[0]?.image_url ?? null, isCover: true }];

  for (let i = 1; i < pages.length; i += 2) {
    leaves.push({
      frontUrl: pages[i]?.image_url ?? null,
      backUrl: pages[i + 1]?.image_url ?? null,
      isCover: false,
    });
  }

  leaves.push({ frontUrl: null, backUrl: null, isCover: true });
  return leaves;
}

export function Book({
  pages,
  page,
  instant = false,
  title,
  accent,
  ink,
  onTurnStateChange,
}: BookProps) {
  /** Carries the fixed orientation that faces the spread at the camera. */
  const groupRef = useRef<Group>(null);
  /** Carries the animated open/closed swing, kept off the orientation node. */
  const swingRef = useRef<Group>(null);
  const leaves = useMemo(() => buildLeaves(pages), [pages]);

  // The visible leaf lags the requested one, stepping toward it so a jump of
  // several pages animates as a run of turns rather than a snap. Remote
  // participants skip the sequence entirely and land on the host's page.
  const [delayedPage, setDelayedPage] = useState(page);
  const delayedRef = useRef(delayedPage);
  delayedRef.current = delayedPage;

  useEffect(() => {
    if (instant) {
      setDelayedPage(page);
      return;
    }

    let timeout: ReturnType<typeof setTimeout>;

    const step = () => {
      const current = delayedRef.current;
      if (current === page) return;

      const distance = Math.abs(page - current);
      const delay = distance > FAST_JUMP_LEAVES ? STEP_FAST_MS : STEP_SLOW_MS;

      timeout = setTimeout(() => {
        setDelayedPage((prev) => {
          if (prev === page) return prev;
          return prev + Math.sign(page - prev);
        });
        step();
      }, delay);
    };

    step();
    return () => clearTimeout(timeout);
  }, [page, instant]);

  // Report turning state so the annotation overlay can hide while paper moves.
  const settledRef = useRef(true);
  useEffect(() => {
    const turning = delayedPage !== page;
    if (turning === !settledRef.current) return;
    settledRef.current = !turning;
    onTurnStateChange?.(turning);
  }, [delayedPage, page, onTurnStateChange]);

  const pageUrls = useMemo(() => pages.map((p) => p.image_url ?? null), [pages]);
  const getTexture = useBookTextures(pageUrls, delayedPage);
  const cover = useCoverTexture(title, accent, ink);

  // Ease the book square-on as it opens: a closed book sits turned slightly
  // away, like a book resting on a table, and straightens for reading.
  //
  // This animates the INNER group. Orientation and animation must live on
  // separate nodes — damping `rotation.y` on the same group that carries the
  // orientation prop overwrites it every frame, which silently cancels the
  // quarter turn below and leaves the book rendering edge-on.
  useFrame((_, delta) => {
    const group = swingRef.current;
    if (!group) return;
    const closed = delayedPage === 0 || delayedPage === leaves.length;
    easing.dampAngle(group.rotation, 'y', closed ? -0.18 : 0, 0.5, delta);
  });

  // `rotation-y={-PI/2}` is load-bearing, not decorative: a page's faces
  // naturally lie in the YZ plane extending along +X, i.e. edge-on to a camera
  // on +Z. This quarter turn is what points the spread at the viewer and stands
  // the spine vertically down the middle.
  //
  // The full ±90° of a turned leaf comes from the accumulated rotations along
  // the 31-bone parent chain — no single node is ever rotated 90° while the
  // book is open, so a near-flat group rotation here is correct.
  return (
    <group ref={groupRef} rotation-y={-Math.PI / 2}>
    <group ref={swingRef}>
      {leaves.map((leaf, index) => {
        const isFrontCover = index === 0;
        const isBackCover = index === leaves.length - 1;

        const front: Texture | null = isFrontCover
          ? cover.front
          : getTexture(leaf.frontUrl);
        const back: Texture | null = isBackCover
          ? cover.back
          : getTexture(leaf.backUrl);

        return (
          <Page
            key={index}
            number={index}
            opened={delayedPage > index}
            bookClosed={delayedPage === 0 || delayedPage === leaves.length}
            front={front}
            back={back}
            pageCount={leaves.length}
            currentPage={delayedPage}
          />
        );
      })}
    </group>
    </group>
  );
}

/** Number of leaves a book of `pageCount` pages will have, covers included. */
export function leafCount(pageCount: number): number {
  return Math.ceil(Math.max(0, pageCount - 1) / 2) + 2;
}
