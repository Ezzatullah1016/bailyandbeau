import type { ActivityType } from '@/components/activity/types';

/**
 * Which tools the dock offers on each screen.
 *
 * Transcribed from the client's six mockups, which disagree with each other on
 * purpose: the toolset is a property of the *screen*, not of the room. Drag &
 * drop has Undo and Redo but no ink, because there is nothing to draw on; a quiz
 * has Pen and Eraser but no Fill; reading has Mic and Participants and none of
 * the editing tools. Encoding that here rather than as a chain of conditions in
 * `SessionRoomPage` means the mockups can be checked against one table.
 *
 * This is deliberately *not* in `activity/typeMeta.ts`. That file is a type's
 * family-facing identity — its label, blurb and accent — read by the picker and
 * the library chips. What the room's chrome can do is a different axis with a
 * different consumer, and merging them would make the picker's cards depend on
 * the dock's tool vocabulary.
 */

/** Every control the dock can render. */
export type DockTool =
  | 'library'
  | 'select'
  | 'pen'
  | 'highlight'
  | 'eraser'
  | 'reactions'
  | 'fill'
  | 'shapes'
  | 'undo'
  | 'redo'
  | 'mic'
  | 'camera'
  | 'participants'
  | 'chat'
  | 'activities'
  | 'sound'
  | 'zoomIn'
  | 'zoomOut'
  | 'fit'
  | 'settings';

/**
 * Which screen the room is showing.
 *
 * `reading` is the book; `picker` is the "Choose Your Adventure" grid; the four
 * activity types are the entered-activity screens.
 */
export type DockScreen = 'reading' | 'picker' | ActivityType;

/**
 * The tools each mockup shows, plus the ones that live behind "More".
 *
 * The first entries of each set are what the mockup shows inline. Reading and
 * the picker keep a long tail (chat, sound, zoom, settings) which the mockup
 * puts behind "More"; no activity screen shows a "More" button at all, so those
 * sets are exactly what is rendered.
 */
export const DOCK_TOOLSET: Record<DockScreen, ReadonlySet<DockTool>> = {
  // Mockups: reading-room-figma-screnshot.png, activity-room-list.png.
  // Inline: Library, Pen, Eraser, Reactions, Mic, Participants, More.
  reading: new Set<DockTool>([
    'library',
    'pen',
    'highlight',
    'eraser',
    'reactions',
    'mic',
    'participants',
    // Behind "More" in the mockup.
    'camera',
    'chat',
    'activities',
    'sound',
    'zoomIn',
    'zoomOut',
    'fit',
    'settings',
  ]),
  picker: new Set<DockTool>([
    'library',
    'pen',
    'highlight',
    'eraser',
    'reactions',
    'mic',
    'participants',
    'camera',
    'chat',
    'sound',
    'settings',
  ]),

  // image-quiz-desing.png — Select, Pen, Eraser, Reactions, Shapes, Undo, Redo.
  // No Fill: there are no closed regions to flood on a question card.
  quiz: new Set<DockTool>([
    'select',
    'pen',
    'eraser',
    'reactions',
    'shapes',
    'undo',
    'redo',
    'mic',
    'camera',
    'chat',
    'settings',
  ]),

  // match-the-feelings.png — Select, Reactions, Undo, Redo. No ink at all: the
  // activity is moving chips, and Undo/Redo step through placements.
  drag_drop: new Set<DockTool>([
    'select',
    'reactions',
    'undo',
    'redo',
    'mic',
    'camera',
    'chat',
    'settings',
  ]),

  // hotspot-activity.png and drawing-activity.png — the full set.
  hotspot: new Set<DockTool>([
    'select',
    'pen',
    'eraser',
    'reactions',
    'fill',
    'shapes',
    'undo',
    'redo',
    'mic',
    'camera',
    'chat',
    'settings',
  ]),
  drawing: new Set<DockTool>([
    'select',
    'pen',
    'eraser',
    'reactions',
    'fill',
    'shapes',
    'undo',
    'redo',
    'mic',
    'camera',
    'chat',
    'settings',
  ]),
};

/** What the live drawing surface can actually service. */
export type SurfaceCaps = {
  pen: boolean;
  eraser: boolean;
  fill: boolean;
  shapes: boolean;
  undoRedo: boolean;
};

/** Nothing is drawable — the safe default before a surface registers. */
export const NO_CAPS: SurfaceCaps = {
  pen: false,
  eraser: false,
  fill: false,
  shapes: false,
  undoRedo: false,
};

/** Which tools depend on a live drawing surface to do anything. */
const SURFACE_TOOLS: Record<string, keyof SurfaceCaps> = {
  pen: 'pen',
  highlight: 'pen',
  eraser: 'eraser',
  fill: 'fill',
  shapes: 'shapes',
  undo: 'undoRedo',
  redo: 'undoRedo',
};

/**
 * The tools to render for an activity: what the mockup shows, intersected with
 * what the pane can actually do.
 *
 * The mockup is the ceiling and the surface's capabilities are the floor. An
 * author who turned the eraser off, or a pane with no canvas at all, loses the
 * button rather than getting a dead one — a control that looks live and does
 * nothing is the exact failure this whole pass exists to remove.
 *
 * `caps` comes from the pane, not from here: the authored defaults
 * (`allow_fill` defaults true, `allow_eraser` defaults false) already live in
 * `DrawingPane`, and re-deriving them would put them in two places.
 */
export function activityToolset(
  type: ActivityType | undefined,
  caps: SurfaceCaps = NO_CAPS,
): ReadonlySet<DockTool> {
  // An unrecognised type (the API can grow a fifth) falls back to the picker's
  // set rather than crashing on an undefined lookup.
  const base = (type && DOCK_TOOLSET[type]) || DOCK_TOOLSET.picker;
  const out = new Set<DockTool>();
  for (const tool of base) {
    const needs = SURFACE_TOOLS[tool];
    if (needs && !caps[needs]) continue;
    out.add(tool);
  }
  return out;
}
