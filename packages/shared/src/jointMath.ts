import type { Vec3 } from './types';
import type { PanelRole } from './cabinets/types';
import { face2DFrame, type PanelFaceRole } from './bore';

export interface Pose { translation: Vec3; quaternion: [number, number, number, number] }
export interface PanelInput {
  dims: { length: number; width: number; thickness: number };
  pose: Pose;
  role?: PanelRole;
}

export interface Joint {
  line: { p0: Vec3; p1: Vec3 };
  panelA: PanelInput;
  panelB: PanelInput;
  faceA: PanelFaceRole;
  endB: PanelFaceRole;
  frameA: ReturnType<typeof face2DFrame>;
  frameB: ReturnType<typeof face2DFrame>;
}

type AABB = { min: Vec3; max: Vec3 };

/** Rotate a vector by a quaternion [x,y,z,w]. */
function rotate(v: Vec3, q: [number, number, number, number]): Vec3 {
  const [x, y, z, w] = q;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (y * v.z - z * v.y);
  const ty = 2 * (z * v.x - x * v.z);
  const tz = 2 * (x * v.y - y * v.x);
  // v + w*t + cross(q.xyz, t)
  return {
    x: v.x + w * tx + (y * tz - z * ty),
    y: v.y + w * ty + (z * tx - x * tz),
    z: v.z + w * tz + (x * ty - y * tx),
  };
}

/** World-space axis-aligned bounding box of a panel's centered box under its pose.
 * pose.translation is the center of the panel in world space (assembly convention).
 * The panel-local box is fully centered: [-hL,-hW,-hT]..[hL,hW,+hT].
 */
function worldAABB(p: PanelInput): AABB {
  const { length: L, width: W, thickness: T } = p.dims;
  const hL = L / 2, hW = W / 2, hT = T / 2;
  // panel-local centered box corners
  const corners: Vec3[] = [];
  for (const cx of [-hL, hL]) for (const cy of [-hW, hW]) for (const cz of [-hT, hT]) {
    const r = rotate({ x: cx, y: cy, z: cz }, p.pose.quaternion);
    corners.push({ x: r.x + p.pose.translation.x, y: r.y + p.pose.translation.y, z: r.z + p.pose.translation.z });
  }
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const c of corners) {
    min.x = Math.min(min.x, c.x); min.y = Math.min(min.y, c.y); min.z = Math.min(min.z, c.z);
    max.x = Math.max(max.x, c.x); max.y = Math.max(max.y, c.y); max.z = Math.max(max.z, c.z);
  }
  return { min, max };
}

function overlap1D(a0: number, a1: number, b0: number, b1: number): [number, number] | null {
  const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
  return hi > lo ? [lo, hi] : null;
}

const AXES = ['x', 'y', 'z'] as const;
type Axis = (typeof AXES)[number];
function span(bb: AABB, ax: Axis): number { return bb.max[ax] - bb.min[ax]; }

/** The thinnest axis of an AABB — the panel's thickness direction in world space. */
function thinAxis(bb: AABB): Axis {
  let best: Axis = 'x', bestSpan = Infinity;
  for (const ax of AXES) { const s = span(bb, ax); if (s < bestSpan) { bestSpan = s; best = ax; } }
  return best;
}

/**
 * Infer a butt joint between two posed panels. A = the panel presenting a FACE in the
 * contact plane (its broad face), B = the panel whose END (thin edge) butts that face.
 * Returns null if the AABBs don't form a coplanar-adjacent face↔end pair with overlap.
 */
export function inferManualJoint(a: PanelInput, b: PanelInput, eps = 1.0): Joint | null {
  const ba = worldAABB(a), bb = worldAABB(b);
  // For each world axis, check whether one panel's slab face meets the other panel's end.
  for (const ax of AXES) {
    // candidate contact plane: a's max[ax] ≈ b's min[ax] (a is on the - side) or vice versa
    const others = AXES.filter((o) => o !== ax) as Axis[];
    const touchPairs: Array<{ plane: number; faceOwner: 'a' | 'b' }> = [
      { plane: ba.max[ax], faceOwner: 'a' }, // a's +ax face touches b's -ax end
      { plane: ba.min[ax], faceOwner: 'a' },
    ];
    for (const tp of touchPairs) {
      const bMatch = Math.abs(tp.plane - bb.min[ax]) < eps || Math.abs(tp.plane - bb.max[ax]) < eps;
      if (!bMatch) continue;
      // require overlap in BOTH other axes
      const o1 = overlap1D(ba.min[others[0]!], ba.max[others[0]!], bb.min[others[0]!], bb.max[others[0]!]);
      const o2 = overlap1D(ba.min[others[1]!], ba.max[others[1]!], bb.min[others[1]!], bb.max[others[1]!]);
      if (!o1 || !o2) continue;
      // Determine which panel presents a FACE (broad) vs an END (thin) along `ax`.
      // The panel whose THIN axis is `ax` presents its FACE in this plane → it is A.
      const aThin = thinAxis(ba) === ax;
      const bThin = thinAxis(bb) === ax;
      // A valid butt joint = exactly one panel is thin along `ax` (face) and the other
      // butts with its end. If both thin (two coplanar sheets) → not a butt joint.
      if (aThin === bThin) continue;
      const A = aThin ? a : b;
      const B = aThin ? b : a;
      const Abb = aThin ? ba : bb;
      const Bbb = aThin ? bb : ba;
      // joint line: along the LONGER of the two overlapping axes
      const len1 = o1[1] - o1[0], len2 = o2[1] - o2[0];
      const lineAxis = len1 >= len2 ? others[0]! : others[1]!;
      const fixed = ax, fixedVal = tp.plane;
      const otherAx = lineAxis === others[0]! ? others[1]! : others[0]!;
      const ov = lineAxis === others[0]! ? o1 : o2;
      const otherOv = lineAxis === others[0]! ? o2 : o1;
      const mid = (otherOv[0] + otherOv[1]) / 2;
      const p0: Vec3 = { x: 0, y: 0, z: 0 }, p1: Vec3 = { x: 0, y: 0, z: 0 };
      (p0 as Record<string, number>)[fixed] = fixedVal; (p1 as Record<string, number>)[fixed] = fixedVal;
      (p0 as Record<string, number>)[lineAxis] = ov[0]; (p1 as Record<string, number>)[lineAxis] = ov[1];
      (p0 as Record<string, number>)[otherAx] = mid; (p1 as Record<string, number>)[otherAx] = mid;

      // Infer which named face of A presents to the contact plane, and which face of B is
      // the end (the face at fixedVal on axis ax). The face role depends on whether fixedVal
      // is at the panel's min or max on that axis (panel-local ≡ world for identity rotation).
      // Min side: x→Left, y→Back, z→Bottom. Max side: x→Right, y→Front, z→Top.
      const minFace: Record<Axis, PanelFaceRole> = { x: 'Left', y: 'Back', z: 'Bottom' };
      const maxFace: Record<Axis, PanelFaceRole> = { x: 'Right', y: 'Front', z: 'Top' };
      const faceA: PanelFaceRole = Math.abs(fixedVal - Abb.max[ax]) < eps ? maxFace[ax] : minFace[ax];
      const endB: PanelFaceRole = Math.abs(fixedVal - Bbb.max[ax]) < eps ? maxFace[ax] : minFace[ax];

      return {
        line: { p0, p1 }, panelA: A, panelB: B,
        faceA, endB,
        frameA: face2DFrame(A.dims, faceA),
        frameB: face2DFrame(B.dims, endB),
      };
    }
  }
  return null;
}

/**
 * Enumerate standard carcass joints from persisted roles+poses+dims. Each side panel
 * (leftSide/rightSide) is joined to every bottom/top/shelf panel that physically butts
 * it (verified via inferManualJoint over world AABBs). Right-side joints mirror left.
 * No geometric contact test beyond the AABB butt check inside inferManualJoint.
 */
export function enumerateAutoJoints(panels: ReadonlyArray<PanelInput>): Joint[] {
  const sides = panels.filter((p) => p.role === 'leftSide' || p.role === 'rightSide');
  const ends = panels.filter((p) => p.role === 'bottom' || p.role === 'top' || p.role === 'shelf');
  const joints: Joint[] = [];
  for (const s of sides) {
    for (const e of ends) {
      const j = inferManualJoint(s, e);
      if (!j) continue;
      // force A = side, B = end (role-deterministic, overriding the geometric A/B).
      // When swapping panelA/panelB, also swap faceA/endB and recompute frames.
      const sideIsA = j.panelA.role === s.role;
      if (sideIsA) {
        joints.push(j);
      } else {
        // inferManualJoint assigned A=end, B=side; swap them and swap face roles too.
        const { faceA: inferredFaceA, endB: inferredEndB } = j;
        joints.push({
          ...j,
          panelA: s, panelB: e,
          faceA: inferredEndB,   // the face that was B's end is now A's face
          endB: inferredFaceA,   // the face that was A's face is now B's end
          frameA: face2DFrame(s.dims, inferredEndB),
          frameB: face2DFrame(e.dims, inferredFaceA),
        });
      }
    }
  }
  return joints;
}
