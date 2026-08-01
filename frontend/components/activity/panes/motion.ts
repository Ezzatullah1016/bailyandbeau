/**
 * One motion vocabulary for all four activity panes.
 *
 * The panes were built at different times and each invented its own feedback,
 * so a correct answer, a placed label and an opened hotspot all behaved
 * differently. Sharing these tokens is what makes the four read as one product.
 *
 * Every export here is a plain object or a hook — nothing renders — so a pane
 * can pull in only the pieces it needs.
 */

import { useReducedMotion } from 'framer-motion';
import type { Transition, Variants } from 'framer-motion';

/**
 * Default transition. A spring rather than a duration: springs settle in
 * proportion to how far they travel, so a small chip and a large card feel
 * like the same physics instead of the same stopwatch.
 */
export const spring: Transition = { type: 'spring', stiffness: 320, damping: 26 };

/** Quicker spring for things that must not feel laggy under the finger. */
export const springSnappy: Transition = { type: 'spring', stiffness: 520, damping: 30 };

/** Short tween for pure fades, where a spring would overshoot opacity. */
export const fade: Transition = { duration: 0.18, ease: 'easeOut' };

/** Appear: grow slightly into place. Used by popups, cards and badges. */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  show: { opacity: 1, scale: 1, transition: spring },
  exit: { opacity: 0, scale: 0.95, transition: fade },
};

/** Appear from below. Used by feedback rows and summary lines. */
export const riseIn: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: spring },
  exit: { opacity: 0, y: -6, transition: fade },
};

/** "Not quite" — a short lateral shake. Never a colour change alone. */
export const nudge = {
  x: [0, -7, 6, -4, 3, 0],
  transition: { duration: 0.4, ease: 'easeInOut' as const },
};

/** A correct answer settling: a single confident overshoot. */
export const celebrate = {
  scale: [1, 1.06, 1],
  transition: { duration: 0.42, ease: 'easeOut' as const },
};

/** Parent of a staggered list (quiz options, label chips). */
export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.02 } },
};

/**
 * Motion tokens with reduced-motion already applied.
 *
 * Rather than sprinkling `if (reduced)` through the panes, this returns the
 * same shape with movement stripped out: opacity still carries the state
 * change, so nothing becomes invisible or unreachable — it just stops moving.
 * Mirrors the existing `prefers-reduced-motion` rule in globals.css.
 */
export function usePaneMotion() {
  const reduced = useReducedMotion();

  if (reduced) {
    const instant: Transition = { duration: 0.12 };
    const fadeOnly: Variants = {
      hidden: { opacity: 0 },
      show: { opacity: 1, transition: instant },
      exit: { opacity: 0, transition: instant },
    };
    return {
      reduced: true as const,
      spring: instant,
      springSnappy: instant,
      popIn: fadeOnly,
      riseIn: fadeOnly,
      stagger: { hidden: {}, show: {} } as Variants,
      nudge: {},
      celebrate: {},
      /** Multiplier for inline `whileTap`/`whileHover` scales. */
      press: {},
      hover: {},
    };
  }

  return {
    reduced: false as const,
    spring,
    springSnappy,
    popIn,
    riseIn,
    stagger,
    nudge,
    celebrate,
    press: { scale: 0.97 },
    hover: { scale: 1.02 },
  };
}
