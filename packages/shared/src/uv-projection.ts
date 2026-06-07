import type { Vec3 } from './types';
import type { PanelFeature } from './panel-feature';

export type UvProjection =
  | { mode: 'planar'; origin: Vec3; uAxis: Vec3; vAxis: Vec3 }
  | { mode: 'box' };

/**
 * Compute a planar UV projection frame for a panel.
 *
 * Panel local axes (PanelOps convention): X = length, Y = width, Z = thickness (up),
 * panel origin = (0,0,0) in part-local coords.
 *   grain='length' → U along X (length), V along Y (width).
 *   grain='width'  → U along Y (width),  V along X (length). 90° swap.
 *   grain='none'   → same as 'length'.
 * UVs are emitted in millimeters; texture repeat is applied in the app layer.
 */
export function panelUvProjection(panel: PanelFeature): UvProjection {
  const origin: Vec3 = { x: 0, y: 0, z: 0 };
  if (panel.grain === 'width') {
    return { mode: 'planar', origin, uAxis: { x: 0, y: 1, z: 0 }, vAxis: { x: 1, y: 0, z: 0 } };
  }
  return { mode: 'planar', origin, uAxis: { x: 1, y: 0, z: 0 }, vAxis: { x: 0, y: 1, z: 0 } };
}
