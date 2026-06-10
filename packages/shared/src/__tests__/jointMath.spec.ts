import { describe, it, expect } from 'vitest';
import {
  enumerateAutoJoints, inferManualJoint,
  type PanelInput,
} from '../jointMath';

const Tc = 18;

// A minimal carcass laid out so panels physically butt in WORLD space.
// leftSide: vertical wall at x∈[0,18], spanning y∈[0,500], z∈[0,800].
// bottom:   horizontal panel resting between the sides, x∈[18,582], z∈[0,18].
// We supply poses that translate the centered panel box into these world AABBs.
function side(x0: number, role: 'leftSide' | 'rightSide'): PanelInput {
  // side dims: length=H=800 (z), width=D=500 (y), thickness=18 (x)
  // centered box [-9,-250,0]..[9,250,18] (its own L=800 along... we author pose so
  // its world AABB = x∈[x0,x0+18], y∈[0,500], z∈[0,800]) — for the test we use an
  // axis-permuting quaternion-free convenience: pass dims so the box already spans
  // the wall, and a translation only (rotation identity). The function reads the
  // world AABB from dims+pose; identity rotation + dims chosen to match.
  return {
    dims: { length: 18, width: 500, thickness: 800 }, // x-thin wall (L=x,W=y,T=z) per pose
    pose: { translation: { x: x0 + 9, y: 250, z: 400 }, quaternion: [0, 0, 0, 1] },
    role,
  };
}
function bottom(): PanelInput {
  return {
    dims: { length: 564, width: 500, thickness: 18 }, // L=x, W=y, T=z
    pose: { translation: { x: 18 + 282, y: 250, z: 9 }, quaternion: [0, 0, 0, 1] },
    role: 'bottom',
  };
}

describe('inferManualJoint — world-AABB butt-joint inference', () => {
  it('left side (face at x=18) ↔ bottom (end at x=18) → a joint, A=side(face), B=bottom(end)', () => {
    const j = inferManualJoint(side(0, 'leftSide'), bottom());
    expect(j).not.toBeNull();
    // A is the FACE-drilled panel (the side, whose inner face x=18 is the joint plane)
    expect(j!.panelA.role).toBe('leftSide');
    expect(j!.panelB.role).toBe('bottom');
    // joint line runs along the contact edge (here in +Y, length ≈ 500 overlap)
    const len = Math.hypot(
      j!.line.p1.x - j!.line.p0.x, j!.line.p1.y - j!.line.p0.y, j!.line.p1.z - j!.line.p0.z);
    expect(len).toBeGreaterThan(0);
    // frames are attached
    expect(j!.frameA).toBeDefined();
    expect(j!.frameB).toBeDefined();
  });

  it('two coplanar but non-overlapping panels → null', () => {
    const far = bottom();
    far.pose = { translation: { x: 5000, y: 5000, z: 9 }, quaternion: [0, 0, 0, 1] };
    expect(inferManualJoint(side(0, 'leftSide'), far)).toBeNull();
  });

  it('two parallel face-to-face panels (no end butting a face) → null', () => {
    const s1 = side(0, 'leftSide');
    const s2 = side(0, 'leftSide'); // identical, fully overlapping faces, not a butt joint
    expect(inferManualJoint(s1, s2)).toBeNull();
  });
});

describe('enumerateAutoJoints — role-driven carcass joints', () => {
  const panels: PanelInput[] = [
    side(0, 'leftSide'),
    side(564, 'rightSide'),
    bottom(),
    { ...bottom(), role: 'top', pose: { translation: { x: 300, y: 250, z: 800 - 9 }, quaternion: [0, 0, 0, 1] } },
  ];

  it('produces side↔bottom and side↔top joints for BOTH sides (mirrored L/R)', () => {
    const joints = enumerateAutoJoints(panels);
    const pairs = joints.map((j) => [j.panelA.role, j.panelB.role].sort().join('+'));
    expect(pairs.filter((p) => p === 'bottom+leftSide')).toHaveLength(1);
    expect(pairs.filter((p) => p === 'bottom+rightSide')).toHaveLength(1);
    expect(pairs.filter((p) => p === 'leftSide+top')).toHaveLength(1);
    expect(pairs.filter((p) => p === 'rightSide+top')).toHaveLength(1);
  });

  it('every auto joint fixes A = side (face-drilled), B = bottom/top/shelf (end-drilled)', () => {
    const joints = enumerateAutoJoints(panels);
    for (const j of joints) {
      expect(['leftSide', 'rightSide']).toContain(j.panelA.role);
      expect(['bottom', 'top', 'shelf']).toContain(j.panelB.role);
    }
  });

  it('returns [] when no side panels are present', () => {
    expect(enumerateAutoJoints([bottom()])).toEqual([]);
  });
});
