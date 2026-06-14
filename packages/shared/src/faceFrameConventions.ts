// packages/shared/src/faceFrameConventions.ts
// Single source of truth for face-frame defaults. No re-declaration elsewhere (git-grep-gated).

/** Default stile (vertical member) width, mm. */
export const DEFAULT_STILE_WIDTH = 38;
/** Default rail (horizontal member) width, mm. */
export const DEFAULT_RAIL_WIDTH = 38;
/** Default face-frame board thickness, mm. */
export const DEFAULT_FRAME_THICKNESS = 19;
/**
 * Flush proud offset, mm. The face-frame member sits on the front face of the carcass;
 * its center y-translation = D + t/2 (no additional standoff).
 * Spec §10: "flush proud offset; member sits on the front face, front normal offset = t/2".
 */
export const FACE_FRAME_PROUD = 0;

// Role string constants — single source of truth (git-grep-gated zero re-declaration).
/** ComponentInstance role for a vertical face-frame member (stile). */
export const ROLE_FACE_FRAME_STILE = 'faceFrameStile' as const;
/** ComponentInstance role for a horizontal face-frame member (rail). */
export const ROLE_FACE_FRAME_RAIL = 'faceFrameRail' as const;

// Grain convention constants — single source of truth (git-grep-gated zero re-declaration).
/** Grain direction for stiles: board length runs vertically (along world Z). */
export const GRAIN_STILE = 'length' as const;
/** Grain direction for rails: board width runs horizontally (along world X). */
export const GRAIN_RAIL = 'width' as const;
