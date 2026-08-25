import type { LucideIcon } from 'lucide-react';

/**
 * Types shared between the activity shell and the four panes.
 *
 * These live outside `ActivityRoom.tsx` so a pane can be edited without opening
 * the shell, and so the panes cannot import the shell (which would be circular).
 */

/** One drawn stroke. Points are flat [x0,y0,x1,y1,…] in canvas pixel space. */
export type Line = { points: number[]; color: string; width: number; eraser?: boolean };

/**
 * A pane's primary action, surfaced by the room's dock.
 *
 * The pane describes the button; the room renders it. This keeps the most
 * important control on the screen in one predictable place across all four
 * activity types, instead of each pane growing its own footer.
 *
 * `icon` is a lucide component — never an emoji, which would not inherit the
 * button's colour and would be announced by its CLDR name mid-label.
 */
export type PaneCta = {
  label: string;
  tone: 'gold' | 'pink';
  icon?: LucideIcon;
  disabled?: boolean;
  /** Places the icon after the label, for "Next Question →". */
  iconTrailing?: boolean;
};

/** Props every pane receives from the shell's dispatch. */
export type PaneProps = {
  payload: Record<string, unknown>;
  role: 'host' | 'guest';
  state: Record<string, unknown>;
  patchCurrent: (patch: Record<string, unknown>) => void;
  /**
   * Publish (or clear) this pane's dock action. Panes call it from an effect, so
   * the descriptor must be stable enough not to loop — see the identity check in
   * SessionRoomPage's `handleActivityCta`.
   */
  onCtaChange?: (cta: (PaneCta & { run: () => void }) | null) => void;
  /**
   * Finish this activity for real.
   *
   * Panes used to signal completion by writing a key into their own state —
   * `completed: true` — which nothing anywhere read, so the button fired and the
   * screen did not move. This runs the room's actual completion path.
   */
  onComplete?: () => void;
};

export type QuizQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correct_index: number;
  image_url?: string;
  feedback_correct?: string;
  feedback_wrong?: string;
};

export type Hotspot = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  content: string;
};

export type DropZoneSpec = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  /** Label id this zone is the correct home for. Drives answer checking. */
  accepts?: string;
};

export type LabelSpec = { id: string; text: string };
