'use client';

import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';

const COVER_W = 800;
const COVER_H = 1100;

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines;
}

function drawBoard(
  ctx: CanvasRenderingContext2D,
  accent: string,
  ink: string,
) {
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, COVER_W, COVER_H);

  // Vertical sheen, so the board is not a flat colour field under the scene
  // lights.
  const sheen = ctx.createLinearGradient(0, 0, COVER_W, 0);
  sheen.addColorStop(0, 'rgba(255,255,255,0.16)');
  sheen.addColorStop(0.18, 'rgba(255,255,255,0.03)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, COVER_W, COVER_H);

  // Inset keyline, the usual hardback treatment.
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 3;
  ctx.strokeRect(46, 46, COVER_W - 92, COVER_H - 92);
  ctx.globalAlpha = 1;
}

/**
 * Draws the front and back cover boards.
 *
 * `Book.cover_image` is empty for every seeded book, and where it is populated
 * it is a catalogue thumbnail sized for a 200px tile — upscaling that to a full
 * book front looks poor. Generating the cover from the title and the book's own
 * theme colours always looks deliberate and works for every book in the library
 * today, with no upload step and no backend change.
 */
export function useCoverTexture(
  title: string,
  accent: string,
  ink: string,
): { front: Texture | null; back: Texture | null } {
  const textures = useMemo(() => {
    if (typeof document === 'undefined') return { front: null, back: null };

    const make = (draw: (ctx: CanvasRenderingContext2D) => void) => {
      const canvas = document.createElement('canvas');
      canvas.width = COVER_W;
      canvas.height = COVER_H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      draw(ctx);
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      texture.generateMipmaps = false;
      return texture;
    };

    const front = make((ctx) => {
      drawBoard(ctx, accent, ink);

      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Step the size down until the title fits in three lines, so a long title
      // does not overflow the board.
      let size = 92;
      let lines: string[] = [];
      for (; size >= 46; size -= 6) {
        ctx.font = `700 ${size}px Fraunces, Georgia, serif`;
        lines = wrapLines(ctx, title, COVER_W - 190);
        if (lines.length <= 3) break;
      }

      const lineHeight = size * 1.22;
      const startY = COVER_H / 2 - ((lines.length - 1) * lineHeight) / 2;
      lines.forEach((line, i) => {
        ctx.fillText(line, COVER_W / 2, startY + i * lineHeight);
      });

      // Rule under the title.
      ctx.globalAlpha = 0.4;
      ctx.fillRect(COVER_W / 2 - 70, startY + lines.length * lineHeight + 18, 140, 3);
      ctx.globalAlpha = 1;
    });

    const back = make((ctx) => drawBoard(ctx, accent, ink));

    return { front, back };
  }, [title, accent, ink]);

  useEffect(
    () => () => {
      textures.front?.dispose();
      textures.back?.dispose();
    },
    [textures],
  );

  return textures;
}
