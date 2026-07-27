'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Howl } from 'howler';

export type RoomSound =
  | 'page-turn'
  | 'activity-complete'
  | 'participant-join'
  | 'participant-leave'
  | 'time-warning';

const SOUND_FILES: Record<RoomSound, string> = {
  'page-turn': '/sounds/page-turn.wav',
  'activity-complete': '/sounds/activity-complete.wav',
  'participant-join': '/sounds/participant-join.wav',
  'participant-leave': '/sounds/participant-leave.wav',
  'time-warning': '/sounds/time-warning.wav',
};

/** Per-sound level. Page turns fire constantly, so they sit furthest back. */
const SOUND_VOLUME: Record<RoomSound, number> = {
  'page-turn': 0.35,
  'activity-complete': 0.5,
  'participant-join': 0.4,
  'participant-leave': 0.4,
  'time-warning': 0.45,
};

const MUTE_KEY = 'bb_room_sound_muted';

/**
 * Soft audio cues for the reading room.
 *
 * Sound is the cheapest way to make a room feel physical rather than
 * administrative — a page that whispers when it turns reads as a book. It is
 * also the easiest thing to get wrong in a session with a small child, so:
 *
 * - the preference is remembered across sessions,
 * - `prefers-reduced-motion` starts muted (people who suppress motion usually
 *   want the calmer experience overall),
 * - Howl instances load lazily on first play, so an always-muted user never
 *   downloads the files at all.
 */
export function useRoomSounds() {
  const [muted, setMuted] = useState(true);
  const howlsRef = useRef<Partial<Record<RoomSound, Howl>>>({});
  const ctorRef = useRef<typeof Howl | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(MUTE_KEY);
    if (stored !== null) {
      setMuted(stored === 'true');
      return;
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setMuted(reduced);
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      localStorage.setItem(MUTE_KEY, String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    // Release the decoded audio when the session ends.
    const howls = howlsRef.current;
    return () => {
      Object.values(howls).forEach((h) => h?.unload());
      howlsRef.current = {};
    };
  }, []);

  const play = useCallback(
    (sound: RoomSound) => {
      if (muted) return;
      void (async () => {
        try {
          if (!ctorRef.current) {
            ctorRef.current = (await import('howler')).Howl;
          }
          const Ctor = ctorRef.current;
          if (!Ctor) return;
          let howl = howlsRef.current[sound];
          if (!howl) {
            howl = new Ctor({
              src: [SOUND_FILES[sound]],
              volume: SOUND_VOLUME[sound],
              preload: true,
            });
            howlsRef.current[sound] = howl;
          }
          howl.play();
        } catch {
          // Audio is an enhancement — a blocked or failed load must never
          // interrupt the session.
        }
      })();
    },
    [muted],
  );

  return useMemo(() => ({ play, muted, toggleMuted }), [play, muted, toggleMuted]);
}

/**
 * Reports true once the reader has been still for `delayMs`, so surrounding
 * chrome can recede and leave the book alone. Any pointer, key, touch or scroll
 * activity brings it straight back.
 *
 * Disabled entirely under `prefers-reduced-motion`: content that fades in and
 * out of view is exactly what that preference is asking us not to do.
 */
export function useRoomIdle(delayMs = 5000) {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), delayMs);
    };

    const events: Array<keyof WindowEventMap> = [
      'pointermove',
      'pointerdown',
      'keydown',
      'wheel',
      'touchstart',
    ];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();

    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [delayMs]);

  return idle;
}
