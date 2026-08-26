/**
 * Annotation tool vocabulary.
 *
 * These lived in `AnnotationToolbar`, the room's original bottom dock. That
 * component was orphaned when the room moved to a rail and then to the current
 * dock, but the types it declared were still imported from it — so a deleted
 * toolbar was holding the type definitions for a live canvas. They live here
 * now, with no component attached.
 */

/** What a pointer stroke does on the annotation layer. */
export type AnnotationTool =
  | 'pen'
  | 'highlighter'
  | 'eraser'
  /** Drag to draw a rectangle, ellipse or line — see `AnnotationShape`. */
  | 'shape'
  /** Tap to flood-fill the region under the pointer. */
  | 'fill';

/** Which shape the `shape` tool draws. */
export type AnnotationShape = 'rect' | 'ellipse' | 'line';

/**
 * The reading canvas' mode, including "not annotating at all" — in `book` mode
 * pointer events pass through to the page-turn gestures underneath.
 */
export type ReadingInteractionMode = 'book' | AnnotationTool;
