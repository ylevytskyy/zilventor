// packages/shared/src/drawing/deriveProjectedOrientation.ts
// Third-angle orthographic projection neighbour table (ANSI standard).
// Given a base view's orientation and the direction the user clicked relative
// to it, returns the orientation of the projected view.

type BaseOrient = 'front' | 'top' | 'right' | 'back' | 'bottom' | 'left';
type Direction = 'top' | 'bottom' | 'left' | 'right';
import type { ViewOrientation } from './viewMatrix';

const TABLE: Record<BaseOrient, Record<Direction, ViewOrientation>> = {
  front:  { top: 'top',    bottom: 'bottom', right: 'right', left: 'left'   },
  top:    { top: 'back',   bottom: 'front',  right: 'right', left: 'left'   },
  right:  { top: 'top',    bottom: 'bottom', right: 'back',  left: 'front'  },
  back:   { top: 'top',    bottom: 'bottom', right: 'left',  left: 'right'  },
  bottom: { top: 'front',  bottom: 'back',   right: 'right', left: 'left'   },
  left:   { top: 'top',    bottom: 'bottom', right: 'front', left: 'back'   },
};

/**
 * Derive the ViewOrientation of a projected view in third-angle (ANSI) projection.
 * @param baseOrientation - orientation of the parent base view
 * @param direction - position of projected view relative to base ('top'=above, etc.)
 * @returns the ViewOrientation to pass to projectView()
 */
export function deriveProjectedOrientation(
  baseOrientation: BaseOrient,
  direction: Direction,
): ViewOrientation {
  return TABLE[baseOrientation][direction];
}
