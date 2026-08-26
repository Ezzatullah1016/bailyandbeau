'use client';

import { useEffect, useRef, useState } from 'react';
import { SRGBColorSpace, Texture, TextureLoader } from 'three';

import { TEXTURE_WINDOW } from './constants';

/**
 * Loads page textures for a window around the current leaf, disposing anything
 * that falls outside it.
 *
 * The reference implementation calls `useTexture.preload` for every page at
 * module scope. That is fine for a six-page demo and untenable here: a forty
 * page picture book at 800x1100 is roughly 140MB of VRAM once uploaded, which
 * will fail outright on the modest tablets a grandparent is likely to join
 * from. Holding a small window and disposing the rest keeps usage flat
 * regardless of book length.
 *
 * Textures are cached by URL, so paging back and forth across the window
 * boundary re-uses the decoded image rather than re-fetching it.
 */
export function useBookTextures(urls: (string | null)[], currentPage: number) {
  const [, forceRender] = useState(0);
  const cacheRef = useRef<Map<string, Texture>>(new Map());
  const loaderRef = useRef<TextureLoader | null>(null);
  const pendingRef = useRef<Set<string>>(new Set());
  /**
   * The URLs currently inside the window.
   *
   * Read by the load callbacks, which routinely outlive the effect that started
   * them — a texture must be judged against the window as it is when the image
   * lands, not against a boolean captured when the request went out.
   */
  const wantedRef = useRef<Set<string>>(new Set());

  if (!loaderRef.current) {
    loaderRef.current = new TextureLoader();
    // Page images are S3 presigned in production, so cross-origin. The bucket
    // already sends Access-Control-Allow-Origin for GET; without this flag the
    // texture upload taints the context and fails.
    loaderRef.current.setCrossOrigin('anonymous');
  }

  useEffect(() => {
    const loader = loaderRef.current;
    if (!loader) return;

    const cache = cacheRef.current;
    const pending = pendingRef.current;

    // A leaf shows two pages, so the page window is twice the leaf window.
    const from = Math.max(0, (currentPage - TEXTURE_WINDOW) * 2);
    const to = Math.min(urls.length - 1, (currentPage + TEXTURE_WINDOW) * 2 + 1);

    const wanted = new Set<string>();
    for (let i = from; i <= to; i++) {
      const url = urls[i];
      if (url) wanted.add(url);
    }
    wantedRef.current = wanted;

    // Drop anything that has left the window. Disposing releases the GPU
    // allocation; without this the map grows for the whole session.
    cache.forEach((texture, url) => {
      if (!wanted.has(url)) {
        texture.dispose();
        cache.delete(url);
      }
    });

    wanted.forEach((url) => {
      if (cache.has(url) || pending.has(url)) return;
      pending.add(url);
      loader.load(
        url,
        (texture) => {
          pending.delete(url);
          /*
           * Keep it if it is still wanted, judged when the load lands rather
           * than by a flag captured when the load started.
           *
           * This effect re-runs whenever the current page changes, and the old
           * cleanup set `cancelled = true` on *every* re-run — so a texture that
           * arrived after any page change was disposed on the spot. Since the
           * URL had already been removed from `pending`, the next pass saw it as
           * neither cached nor in flight and started again: pages were fetched
           * repeatedly and the mesh never received one, which is why the book
           * rendered as blank grey paper with the geometry working perfectly.
           */
          if (!wantedRef.current.has(url)) {
            texture.dispose();
            return;
          }
          texture.colorSpace = SRGBColorSpace;
          // Page art is viewed near head-on; skipping mipmaps saves a third of
          // the memory per texture and costs nothing visually here.
          texture.generateMipmaps = false;
          cache.set(url, texture);
          forceRender((n) => n + 1);
        },
        undefined,
        () => {
          // A failed page renders as blank paper rather than breaking the book.
          // Presigned URLs expire after an hour, so this is reachable in a long
          // session.
          pending.delete(url);
        },
      );
    });
  }, [urls, currentPage]);

  // Release everything when the room unmounts.
  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      cache.forEach((texture) => texture.dispose());
      cache.clear();
    };
  }, []);

  return (url: string | null): Texture | null => (url ? cacheRef.current.get(url) ?? null : null);
}
