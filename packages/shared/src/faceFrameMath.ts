// packages/shared/src/faceFrameMath.ts
import { DOOR_POSE } from './prisadkaFaceConventions';

type Vec3 = { x: number; y: number; z: number };
type Quaternion = [number, number, number, number];

export interface FaceFrameParams {
  /** Cabinet outer width (X), mm. */
  width: number;
  /** Cabinet outer height (Z), mm. */
  height: number;
  /** Toekick height — z of the carcass box bottom, mm. */
  toekickHeight: number;
  /** Cabinet depth (Y) — the front plane is at y = depth, mm. */
  depth: number;
  /** Number of opening rows (≥ 1). */
  rows: number;
  /** Number of opening columns (≥ 1). */
  cols: number;
  stileWidth: number;
  railWidth: number;
  thickness: number;
}

export interface FrameMember {
  role: 'faceFrameStile' | 'faceFrameRail';
  /** Panel local dims. DOOR_POSE maps length→Z(up), width→X(across), thickness→Y(front). */
  dims: { length: number; width: number; thickness: number };
  pose: { translation: Vec3; quaternion: Quaternion };
}

/**
 * Lay out an equal R×C wood face frame on a cabinet front.
 * Stiles run continuous full height; rails butt between adjacent stiles. Butt joints (no joinery).
 * All members reuse DOOR_POSE.quaternion (flat boards on the front plane); only dims + translation differ.
 */
export function layoutFaceFrame(p: FaceFrameParams): FrameMember[] {
  const { width: W, height: H, toekickHeight: tkH, depth: D,
    rows, cols, stileWidth: sw, railWidth: rw, thickness: t } = p;
  if (rows < 1 || cols < 1) throw new Error('face frame: rows and cols must be ≥ 1');

  const frameW = W;
  const frameH = H - tkH;
  const ow = (frameW - (cols + 1) * sw) / cols;
  const oh = (frameH - (rows + 1) * rw) / rows;
  if (ow <= 0) throw new Error('face frame: opening collapses — too many columns for the cabinet width');
  if (oh <= 0) throw new Error('face frame: opening collapses — too many rows for the cabinet height');

  const q: Quaternion = DOOR_POSE.quaternion;
  const frontY = D + t / 2; // board sits fully proud of the carcass front
  const members: FrameMember[] = [];

  // Stiles: cols+1 continuous full-height verticals.
  for (let i = 0; i <= cols; i++) {
    const leftEdge = i * (sw + ow);
    members.push({
      role: 'faceFrameStile',
      dims: { length: frameH, width: sw, thickness: t },
      pose: {
        translation: { x: leftEdge + sw / 2, y: frontY, z: tkH + frameH / 2 },
        quaternion: q,
      },
    });
  }

  // Rails: per column, rows+1 horizontals butting between adjacent stiles.
  for (let c = 0; c < cols; c++) {
    const openLeft = c * (sw + ow) + sw;
    const cx = openLeft + ow / 2;
    for (let k = 0; k <= rows; k++) {
      const bottom = k * (rw + oh);
      members.push({
        role: 'faceFrameRail',
        dims: { length: rw, width: ow, thickness: t },
        pose: {
          translation: { x: cx, y: frontY, z: tkH + bottom + rw / 2 },
          quaternion: q,
        },
      });
    }
  }

  return members;
}
