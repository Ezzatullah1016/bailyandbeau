'use client';

import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { BookThemeData } from './api';

/**
 * Translates a book's theme into the CSS custom properties that
 * `app/room-tokens.css` reads. Returning inline style props (rather than
 * writing to :root) keeps the theme scoped to the room and lets React clean it
 * up automatically when the session ends.
 *
 * A null theme returns empty style, so the room keeps its default sky look.
 */
/** Fallbacks mirror the `.room-root` defaults in app/room-tokens.css. */
const DEFAULT_ACCENT = '#f0c75e';
const DEFAULT_BOOK_INK = '#f7eee4';

/**
 * Pick black or white text for a background colour.
 *
 * `--room-accent` is per-book but `--room-accent-contrast` was never set
 * alongside it, so anything painted on the accent always took the static white
 * from room-tokens.css. That happens to pass on the `sunset` preset's brown
 * (#8F4314) and fails outright on the `night` preset's pale gold (#F0C75E) —
 * white on pale gold. Deriving it means a new book theme cannot introduce an
 * unreadable combination.
 *
 * sRGB relative luminance, per WCAG 2.x.
 */
function contrastFor(hex: string): string {
  const s = hex.replace('#', '').trim();
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (full.length !== 6) return '#ffffff';
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return '#ffffff';
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const L =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  // Contrast against white is (1.05 / (L + 0.05)); against near-black it is
  // ((L + 0.05) / 0.05). They cross at L ≈ 0.179.
  return L > 0.179 ? '#12203a' : '#ffffff';
}

export function useRoomTheme(theme: BookThemeData | null | undefined) {
  return useMemo(() => {
    if (!theme) {
      return {
        style: {} as CSSProperties,
        backdrop: 'gradient',
        // `dark` is the room's own family now. This used to say `light`, which
        // stamped data-chrome="light" on every un-themed book and so opted them
        // all out of the default palette into the old Daylight sky.
        chrome: 'dark' as const,
        accent: DEFAULT_ACCENT,
        bookInk: DEFAULT_BOOK_INK,
      };
    }

    const style: Record<string, string> = {};

    if (theme.bg_color) style['--room-bg-1'] = theme.bg_color;
    if (theme.bg_color_2) style['--room-bg-2'] = theme.bg_color_2;
    if (theme.backdrop_kind === 'color' && theme.bg_color) {
      // A solid backdrop is a gradient with both stops the same, so the token
      // layer needs no separate code path.
      style['--room-bg-2'] = theme.bg_color;
    }
    style['--room-bg-angle'] = `${theme.gradient_angle}deg`;

    if (theme.backdrop_kind === 'image' && theme.bg_image_url) {
      style['--room-bg-image'] = `url("${theme.bg_image_url}")`;
    } else if (theme.backdrop_kind === 'video' && theme.bg_video_poster_url) {
      // The poster stands in until the video element is playing, and remains
      // the backdrop entirely when video is suppressed (reduced motion,
      // Save-Data, or a slow connection).
      style['--room-bg-image'] = `url("${theme.bg_video_poster_url}")`;
    }

    if (theme.accent) {
      style['--room-accent'] = theme.accent;
      style['--room-accent-contrast'] = contrastFor(theme.accent);
    }
    if (theme.ink) style['--room-ink'] = theme.ink;

    style['--book-tilt'] = `${theme.tilt_degrees}deg`;

    if (theme.book_shadow === 'none') {
      style['--book-shadow'] = 'none';
    } else if (theme.book_shadow === 'deep') {
      style['--book-shadow'] =
        '0 4px 10px rgba(23, 34, 51, 0.20), 0 42px 90px -20px rgba(23, 34, 51, 0.58)';
    }

    return {
      style: style as CSSProperties,
      backdrop: theme.backdrop_kind,
      chrome: theme.chrome_mode,
      // The 3D cover is drawn to a 2D canvas, which cannot resolve CSS custom
      // properties — it needs the resolved colours themselves. Cover lettering
      // sits on the accent board, so it takes the light paper ink rather than
      // `theme.ink`, which is tuned for text on the backdrop.
      accent: theme.accent || DEFAULT_ACCENT,
      bookInk: DEFAULT_BOOK_INK,
    };
  }, [theme]);
}
