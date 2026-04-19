'use client';

import { useEffect, useState } from 'react';
import type { BookPageData } from './api';

export function usePlaceholderPdf(pdfUrl: string): BookPageData[] {
  const [pages, setPages] = useState<BookPageData[]>([]);

  useEffect(() => {
    if (!pdfUrl) return;
    let cancelled = false;

    async function load() {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

      const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
      const result: BookPageData[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        if (cancelled) return;
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        result.push({ id: String(i), page_number: i, image_url: canvas.toDataURL('image/jpeg', 0.85) });
        if (!cancelled) setPages([...result]);
      }
    }

    load().catch(console.error);
    return () => { cancelled = true; };
  }, [pdfUrl]);

  return pages;
}
