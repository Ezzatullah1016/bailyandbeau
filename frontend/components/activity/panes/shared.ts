/**
 * Types shared between the activity shell and the four panes.
 *
 * These live outside `ActivityRoom.tsx` so a pane can be edited without opening
 * the shell, and so the panes cannot import the shell (which would be circular).
 */

/** One drawn stroke. Points are flat [x0,y0,x1,y1,…] in canvas pixel space. */
export type Line = { points: number[]; color: string; width: number; eraser?: boolean };

/** Props every pane receives from the shell's dispatch. */
export type PaneProps = {
  payload: Record<string, unknown>;
  role: 'host' | 'guest';
  state: Record<string, unknown>;
  patchCurrent: (patch: Record<string, unknown>) => void;
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
