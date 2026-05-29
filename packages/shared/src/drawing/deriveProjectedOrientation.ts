// packages/shared/src/drawing/deriveProjectedOrientation.ts
// First-angle orthographic projection neighbour table (ISO standard).
// Given a base view's orientation and the direction the user clicked relative
// to it, returns the orientation of the projected view.

type BaseOrient = 'front' | 'top' | 'right' | 'back' | 'bottom' | 'left';
type Direction = 'top' | 'bottom' | 'left' | 'right';
import type { ViewOrientation } from './viewMatrix';

const TABLE: Record<BaseOrient, Record<Direction, ViewOrientation>> = {
  front:  { top: 'bottom', bottom: 'top',   right: 'left',  left: 'right'  },
  top:    { top: 'front',  bottom: 'back',  right: 'left',  left: 'right'  },
  right:  { top: 'bottom', bottom: 'top',   right: 'front', left: 'back'   },
  back:   { top: 'bottom', bottom: 'top',   right: 'right', left: 'left'   },
  bottom: { top: 'back',   bottom: 'front', right: 'left',  left: 'right'  },
  left:   { top: 'bottom', bottom: 'top',   right: 'back',  left: 'front'  },
};

/**
 * Derive the ViewOrientation of a projected view in first-angle (ISO) projection.
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
