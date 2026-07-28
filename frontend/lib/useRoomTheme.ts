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
const DEFAULT_ACCENT = '#3d3b62';
const DEFAULT_BOOK_INK = '#fdfbf7';

export function useRoomTheme(theme: BookThemeData | null | undefined) {
  return useMemo(() => {
    if (!theme) {
      return {
        style: {} as CSSProperties,
        backdrop: 'gradient',
        chrome: 'light' as const,
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

    if (theme.accent) style['--room-accent'] = theme.accent;
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
