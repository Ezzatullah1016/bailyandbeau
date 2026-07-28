/**
 * Geometry and motion constants for the 3D book.
 *
 * The curve strengths come from the reference implementation
 * (github.com/wass08/r3f-animated-book-slider-final) but are retuned here for
 * our page proportions: seeded pages render at 800x1100 (8:11 portrait), where
 * the reference used a squarer page. A taller page shows more of the bend, so
 * the inside curve is eased back slightly to stop the spine looking creased.
 */

/** Page aspect: 800x1100 from seed_book_pages.py. Width is the unit. */
export const PAGE_WIDTH = 1.28;
export const PAGE_HEIGHT = (PAGE_WIDTH * 1100) / 800;
export const PAGE_DEPTH = 0.003;

/**
 * Bone count is SEGMENTS + 1. Thirty segments is the reference value and is the
 * floor for a smooth bend — fewer and the curve visibly facets along the spine.
 */
export const PAGE_SEGMENTS = 30;
export const SEGMENT_WIDTH = PAGE_WIDTH / PAGE_SEGMENTS;

/** Bones nearer the spine than this index take the inside curve. */
export const SPINE_BONES = 8;

export const EASING_FACTOR = 0.5;
export const EASING_FACTOR_FOLD = 0.3;
export const INSIDE_CURVE_STRENGTH = 0.18;
export const OUTSIDE_CURVE_STRENGTH = 0.05;
export const TURNING_CURVE_STRENGTH = 0.09;

/** Window over which the transient flex bulge rises and falls, in ms. */
export const TURN_WINDOW_MS = 400;

/**
 * How many pages either side of the current spread keep a resident texture.
 * The reference preloads every page at module scope, which is fine for a
 * six-page demo and untenable for a real book — see useBookTextures.
 */
export const TEXTURE_WINDOW = 2;
