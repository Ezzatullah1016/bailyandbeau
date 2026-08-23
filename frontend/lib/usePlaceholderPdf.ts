'use client';

import { useEffect, useState } from 'react';
import type { BookPageData } from './api';

export interface PlaceholderPdfResult {
  pages: BookPageData[];
  /** true once the load attempt has finished (success OR failure) */
  settled: boolean;
}

// Guard: never try to rasterise a placeholder larger than this (a broken/huge
// asset must not hang the reading room). ~8 MB is plenty for a sample book.
const MAX_PDF_BYTES = 8 * 1024 * 1024;

/** Matches `--book-paper` in app/room-tokens.css. */
const PAPER = '#f7eee4';

export function usePlaceholderPdf(pdfUrl: string): PlaceholderPdfResult {
  const [pages, setPages] = useState<BookPageData[]>([]);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    // Reset whenever the source changes.
    setPages([]);
    setSettled(false);

    if (!pdfUrl) {
      // No source requested → nothing to load, treat as settled-empty.
      setSettled(true);
      return;
    }

    let cancelled = false;

    async function load() {
      // Fetch the bytes ourselves so we can sanity-check the response before
      // handing it to pdf.js (avoids hanging on 0-byte/204 or oversized files).
      const resp = await fetch(pdfUrl, { cache: 'force-cache' });
      if (!resp.ok || resp.status === 204) {
        throw new Error(`placeholder pdf not available (status ${resp.status})`);
      }
      const buf = await resp.arrayBuffer();
      if (buf.byteLength === 0) throw new Error('placeholder pdf is empty');
      if (buf.byteLength > MAX_PDF_BYTES) {
        throw new Error(`placeholder pdf too large (${buf.byteLength} bytes)`);
      }

      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      const result: BookPageData[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        if (cancelled) return;
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        // pdf.js paints only what the page draws, leaving the rest of the canvas
        // transparent — which a JPEG then flattens to grey. The result read as
        // cold grey paper in a room whose pages should be cream, so lay the
        // paper down first and let the PDF draw on top of it.
        ctx.fillStyle = PAPER;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        result.push({
          id: String(i),
          page_number: i,
          image_url: canvas.toDataURL('image/jpeg', 0.85),
        });
        if (!cancelled) setPages([...result]);
      }
    }

    load()
      .catch((err) => {
        // Never leave the UI stuck on a spinner — log and fall through to the
        // empty state by marking the attempt settled with zero pages.
        console.error('[usePlaceholderPdf]', err);
      })
      .finally(() => {
        if (!cancelled) setSettled(true);
      });

    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  return { pages, settled };
}
