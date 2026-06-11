import { describe, it, expect } from 'vitest';
import {
  BOX_PANEL_THICKNESS as T,
  BOX_BOTTOM_THICKNESS,
  BOX_VERT_CLEARANCE,
  SLIDE_CLEARANCE_PER_SIDE,
  BOX_BACK_CLEARANCE,
} from '../drawerConventions';
import { drawerBoxMath, type DrawerBoxResult } from '../drawerBoxMath';

// ---------------------------------------------------------------------------
// Helpers for the anti-tautology pose oracle.
//
// Two fully INDEPENDENT quatToMat3 implementations are provided here so no
// single production helper can pass a symmetric bug through. They must both
// agree on the result.
// ---------------------------------------------------------------------------

/**
 * Independent quatToMat3 (A) — row-major 3×3 from Rodrigues formula.
 * Completely independent of poseHelpers.ts.
 */
function quatToMat3_A(q: [number, number, number, number]): number[] {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z),     2 * (x * z + w * y),
    2 * (x * y + w * z),     1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y),     2 * (y * z + w * x),     1 - 2 * (x * x + y * y),
  ];
}

/**
 * Independent quatToMat3 (B) — column-at-a-time derivation via
 * q v q* for each basis vector. Different control flow from A.
 */
function quatToMat3_B(q: [number, number, number, number]): number[] {
  const [qx, qy, qz, qw] = q;
  // Apply quaternion rotation to a vector (pure-quat sandwich product)
  function rotVec(vx: number, vy: number, vz: number): [number, number, number] {
    // t = 2 * cross(q_xyz, v)
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    return [
      vx + qw * tx + (qy * tz - qz * ty),
      vy + qw * ty + (qz * tx - qx * tz),
      vz + qw * tz + (qx * ty - qy * tx),
    ];
  }
  const col0 = rotVec(1, 0, 0);
  const col1 = rotVec(0, 1, 0);
  const col2 = rotVec(0, 0, 1);
  // Build row-major from columns: R[i][j] = col_j[i]
  return [
    col0[0], col1[0], col2[0],
    col0[1], col1[1], col2[1],
    col0[2], col1[2], col2[2],
  ];
}

function applyMat3(m: number[], v: [number, number, number]): [number, number, number] {
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ];
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const slot = { bottomZ: 100, topZ: 300 }; // slotH = 200
const opening = { openW: 564, innerD: 500 };

const bw = opening.openW - 2 * SLIDE_CLEARANCE_PER_SIDE; // 539
const bh = (slot.topZ - slot.bottomZ) - 2 * BOX_VERT_CLEARANCE; // 176
const bd = opening.innerD - BOX_BACK_CLEARANCE; // 490

describe('drawerBoxMath', () => {
  const box: DrawerBoxResult = drawerBoxMath(slot, opening);

  it('produces 5 panels with correct roles', () => {
    expect(box).toBeDefined();
    expect(box.panels.map((p) => p.role).sort()).toEqual(
      ['drawerBox-back', 'drawerBox-bottom', 'drawerBox-front', 'drawerBox-side', 'drawerBox-side'],
    );
  });

  it('SIDE panels declared length=bh (height), width=bd (depth) — §14.2', () => {
    const sides = box.panels.filter((p) => p.role === 'drawerBox-side');
    expect(sides).toHaveLength(2);
    for (const side of sides) {
      expect(side.dims.length).toBeCloseTo(bh, 6); // height as length → u-axis = height
      expect(side.dims.width).toBeCloseTo(bd, 6);
      expect(side.dims.thickness).toBe(T);
    }
  });

  it('front/back fit between the two sides (length = bw − 2T)', () => {
    const front = box.panels.find((p) => p.role === 'drawerBox-front')!;
    const back = box.panels.find((p) => p.role === 'drawerBox-back')!;
    expect(front).toBeDefined();
    expect(back).toBeDefined();
    expect(front.dims.length).toBeCloseTo(bw - 2 * T, 6); // 507
    expect(back.dims.length).toBeCloseTo(bw - 2 * T, 6);
    expect(front.dims.thickness).toBe(T);
  });

  it('bottom fits inside sides (width = bd − 2T) and uses BOX_BOTTOM_THICKNESS', () => {
    const bottom = box.panels.find((p) => p.role === 'drawerBox-bottom')!;
    expect(bottom).toBeDefined();
    expect(bottom.dims.thickness).toBe(BOX_BOTTOM_THICKNESS);
    expect(bottom.dims.width).toBeCloseTo(bd - 2 * T, 6); // 458
  });

  it('box outer dims', () => {
    expect(box.outer).toMatchObject({ width: bw, height: bh, depth: bd });
  });

  // ---------------------------------------------------------------------------
  // Anti-tautology pose oracle (§14.9 + §10 — load-bearing)
  //
  // Scenario: a cabinet rotated 15° about world-Z (non-axis-parallel). The box
  // is placed at some origin in this rotated cabinet's local frame. We verify
  // the LEFT SIDE PANEL's world centroid using TWO independent quatToMat3
  // implementations — NEVER the producer helper.
  //
  // Box-local origin = front-bottom-left corner of the box.
  // boxOrigin in world = (50, 80, slot.bottomZ + BOX_VERT_CLEARANCE) rotated by
  // the cabinet's 15° rotation, for a non-trivial world position.
  // ---------------------------------------------------------------------------

  it('anti-tautology pose oracle: left side panel world centroid matches independent derivation for 15°-rotated cabinet', () => {
    expect(box).toBeDefined();

    const leftSide = box.panels.find((p) => p.role === 'drawerBox-side' && p.isLeft)
      ?? box.panels.filter((p) => p.role === 'drawerBox-side')[0]!;
    expect(leftSide).toBeDefined();

    // The left side panel's translation is the component pose in box-local coords.
    // Box origin in world = front-bottom-left corner of this slot, placed by the
    // DrawerBox component. We simulate a cabinet rotated 15° about Z.

    // Cabinet rotation: 15° about world-Z.
    const deg15 = 15 * Math.PI / 180;
    const cabinetQuat: [number, number, number, number] = [
      0,
      0,
      Math.sin(deg15 / 2),
      Math.cos(deg15 / 2),
    ];

    // Box origin (front-bottom-left) in UN-rotated box-local frame:
    // arbitrarily placed at (50, 80, 12) so the test point is non-axis-parallel.
    const boxOriginUnrotated: [number, number, number] = [50, 80, 12];

    // Rotate box origin by cabinet rotation.
    const cabinetMat_A = quatToMat3_A(cabinetQuat);
    const cabinetMat_B = quatToMat3_B(cabinetQuat);

    const boxOriginWorld_A = applyMat3(cabinetMat_A, boxOriginUnrotated);
    const boxOriginWorld_B = applyMat3(cabinetMat_B, boxOriginUnrotated);

    // Both independent matrices must agree on the box origin (cross-check A vs B).
    expect(boxOriginWorld_A[0]).toBeCloseTo(boxOriginWorld_B[0], 10);
    expect(boxOriginWorld_A[1]).toBeCloseTo(boxOriginWorld_B[1], 10);
    expect(boxOriginWorld_A[2]).toBeCloseTo(boxOriginWorld_B[2], 10);

    // Left side panel local centroid = panel.pose.translation (box-local).
    const localTrans = leftSide.pose.translation;
    const localPanelCentroid: [number, number, number] = [
      localTrans.x,
      localTrans.y,
      localTrans.z,
    ];

    // Also rotate the panel centroid by the panel's own quaternion to get its
    // centroid-offset from its own pose origin. But we want the ABSOLUTE world
    // centroid of the panel, which is:
    //   worldCentroid = boxOriginWorld + cabinetR * localPanelCentroid
    //
    // (We don't need to add the part-local centroid offset separately because
    // leftSide.pose.translation is already the box-local position of the panel
    // centroid — this is the convention we verify.)

    // Actually, the pose.translation is the translation of the panel's part-frame
    // origin (the center of the panel in box-local coords, since the part is built
    // with centroid at part-origin for a centered-XY panel).
    // Panel centroid in box-local = pose.translation + panelR * (0,0,0) = pose.translation.
    // [Because the part box center in part-local = (0,0,T/2), and we want the physical
    // centroid in box-local. So actually: box_local_centroid = pose.translation + panelR*(0,0,T/2).]
    //
    // We derive this INDEPENDENTLY:
    //   Left side panel occupies x∈[0,T], y∈[0,bd], z∈[0,bh] in box-local.
    //   Centroid = (T/2, bd/2, bh/2).

    const expectedLocalCentroid: [number, number, number] = [T / 2, bd / 2, bh / 2];

    // Compute panel centroid in box-local via the panel's own pose (independent derivation):
    // centroid_box_local = pose.translation + panelQuat_mat * (0, 0, T/2)
    const panelMat_A = quatToMat3_A(leftSide.pose.quaternion);
    const panelMat_B = quatToMat3_B(leftSide.pose.quaternion);

    const partCentroidOffset: [number, number, number] = [0, 0, T / 2];
    const offsetWorld_A = applyMat3(panelMat_A, partCentroidOffset);
    const offsetWorld_B = applyMat3(panelMat_B, partCentroidOffset);

    const localCentroid_A: [number, number, number] = [
      localPanelCentroid[0] + offsetWorld_A[0],
      localPanelCentroid[1] + offsetWorld_A[1],
      localPanelCentroid[2] + offsetWorld_A[2],
    ];
    const localCentroid_B: [number, number, number] = [
      localPanelCentroid[0] + offsetWorld_B[0],
      localPanelCentroid[1] + offsetWorld_B[1],
      localPanelCentroid[2] + offsetWorld_B[2],
    ];

    // A and B must agree.
    expect(localCentroid_A[0]).toBeCloseTo(localCentroid_B[0], 10);
    expect(localCentroid_A[1]).toBeCloseTo(localCentroid_B[1], 10);
    expect(localCentroid_A[2]).toBeCloseTo(localCentroid_B[2], 10);

    // Panel centroid in box-local must match the independently derived expected value.
    expect(localCentroid_A[0]).toBeCloseTo(expectedLocalCentroid[0], 6);
    expect(localCentroid_A[1]).toBeCloseTo(expectedLocalCentroid[1], 6);
    expect(localCentroid_A[2]).toBeCloseTo(expectedLocalCentroid[2], 6);

    // Now compute world centroid by rotating the box-local centroid by the cabinet rotation.
    const worldCentroid_A = applyMat3(cabinetMat_A, localCentroid_A);
    const worldCentroid_B = applyMat3(cabinetMat_B, localCentroid_B);

    // After adding box origin, the two independent derivations must agree.
    const finalWorld_A: [number, number, number] = [
      boxOriginWorld_A[0] + worldCentroid_A[0],
      boxOriginWorld_A[1] + worldCentroid_A[1],
      boxOriginWorld_A[2] + worldCentroid_A[2],
    ];
    const finalWorld_B: [number, number, number] = [
      boxOriginWorld_B[0] + worldCentroid_B[0],
      boxOriginWorld_B[1] + worldCentroid_B[1],
      boxOriginWorld_B[2] + worldCentroid_B[2],
    ];

    expect(finalWorld_A[0]).toBeCloseTo(finalWorld_B[0], 8);
    expect(finalWorld_A[1]).toBeCloseTo(finalWorld_B[1], 8);
    expect(finalWorld_A[2]).toBeCloseTo(finalWorld_B[2], 8);

    // The world centroid must be non-axis-parallel (confirming the 15° rotation is effective):
    // no component should be equal to either boxOrigin component (would indicate rotation not applied).
    expect(Math.abs(finalWorld_A[0] - boxOriginWorld_A[0])).toBeGreaterThan(0.01);
  });
});
