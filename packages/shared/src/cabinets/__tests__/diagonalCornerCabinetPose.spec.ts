import { describe, it, expect } from 'vitest';
import type { MaterialEntry } from '../../material';
import { buildDiagonalCornerCabinet } from '../diagonalCornerCabinet';
import type { DiagonalCornerCabinetParams, CabinetBuildOutput, CabinetComponentDef } from '../types';

/**
 * Locking tests for cabinet-pose-fix Slice 8 (diagonalCornerCabinet — remaining
 * flat/carcass panels). Per plan §3, `pose` is an ADDITIVE field: stored
 * `position`/`rotation` numbers must not change. This spec is the numeric
 * arbiter for the per-role rotation hypotheses — it asserts the resulting
 * WORLD AABB of each panel (via pose.translation + pose.quaternion applied to
 * buildPanelBox's local box: X∈[-L/2,L/2], Y∈[-W/2,W/2], Z∈[0,T] — outline
 * panels [Bottom/Top] are re-centered to the SAME convention by
 * buildOutlinePrism, PanelOps.ts:182-184, so the same worldAabb oracle
 * applies), not the rotation numbers themselves.
 *
 * Front Stile 1/2 and Door are intentionally EXCLUDED from `pose` — per plan
 * §3.5 they already reach the mesh correctly via componentLocalPose's Euler
 * fallback (position IS the panel center; rotation is `uprightRot`). The
 * second describe block below locks THAT path (position/rotation used as-is,
 * no pose correction) so a future change doesn't silently add a pose and
 * double-correct them.
 */

const carcass: MaterialEntry = {
  id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896',
};
const back: MaterialEntry = {
  id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47',
};
const REGISTRY: ReadonlyArray<MaterialEntry> = [carcass, back];

// Same fixture as diagonalCornerCabinet.spec.ts's P (symmetric case):
// W1=W2=900, D1=D2=560 -> diagLen=340√2≈480.833mm, dX=-1/√2, dY=1/√2, ry=45°.
const DEFAULT_PARAMS: DiagonalCornerCabinetParams = {
  name: 'Diag 1',
  wallWidth1: 900, wallWidth2: 900,
  returnDepth1: 560, returnDepth2: 560,
  height: 720, toekickHeight: 100, toekickSetback: 60,
  stileWidth: 50,
  carcassMaterialId: 'm-birch-18',
  backMaterialId: 'm-hb-6',
  bandMaterialId: null,
};

type Quat = readonly [number, number, number, number];
type Vec3 = { x: number; y: number; z: number };

// Local re-implementation of kernel/src/assembly/quat.ts's quatFromEulerXYZ/
// quatRotateVec (same oracle used by baseCabinetPose.spec.ts/
// cornerCabinetPose.spec.ts — packages/shared cannot depend on @zilventor/kernel).
function quatFromEulerXYZ(rxDeg: number, ryDeg: number, rzDeg: number): Quat {
  const rx = (rxDeg * Math.PI) / 180;
  const ry = (ryDeg * Math.PI) / 180;
  const rz = (rzDeg * Math.PI) / 180;
  const cx = Math.cos(rx / 2), sx = Math.sin(rx / 2);
  const cy = Math.cos(ry / 2), sy = Math.sin(ry / 2);
  const cz = Math.cos(rz / 2), sz = Math.sin(rz / 2);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

function quatRotateVec(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const cx = y * v.z - z * v.y + w * v.x;
  const cy = z * v.x - x * v.z + w * v.y;
  const cz = x * v.y - y * v.x + w * v.z;
  return {
    x: v.x + 2 * (y * cz - z * cy),
    y: v.y + 2 * (z * cx - x * cz),
    z: v.z + 2 * (x * cy - y * cx),
  };
}

interface WorldAabb {
  xMin: number; xMax: number;
  yMin: number; yMax: number;
  zMin: number; zMax: number;
}

function worldAabb(
  dims: { length: number; width: number; thickness: number },
  pose: { translation: Vec3; quaternion: Quat },
): WorldAabb {
  const { length: L, width: W, thickness: T } = dims;
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (const lx of [-L / 2, L / 2]) {
    for (const ly of [-W / 2, W / 2]) {
      for (const lz of [0, T]) {
        const r = quatRotateVec(pose.quaternion, { x: lx, y: ly, z: lz });
        xs.push(r.x + pose.translation.x);
        ys.push(r.y + pose.translation.y);
        zs.push(r.z + pose.translation.z);
      }
    }
  }
  return {
    xMin: Math.min(...xs), xMax: Math.max(...xs),
    yMin: Math.min(...ys), yMax: Math.max(...ys),
    zMin: Math.min(...zs), zMax: Math.max(...zs),
  };
}

function dimsOf(out: CabinetBuildOutput, fileNameSuffix: string): { length: number; width: number; thickness: number } {
  const panelEntry = out.panels.find((p) => p.fileNameSuffix === fileNameSuffix);
  if (!panelEntry) throw new Error(`role ${fileNameSuffix} not found`);
  const lit = (v: { kind: string; value?: number }): number => {
    if (v.kind !== 'literal') throw new Error('expected literal dim');
    return v.value!;
  };
  return {
    length: lit(panelEntry.panel.length),
    width: lit(panelEntry.panel.width),
    thickness: lit(panelEntry.panel.thickness),
  };
}

function layoutOf(out: CabinetBuildOutput, fileNameSuffix: string): CabinetComponentDef {
  const layoutEntry = out.layout.find((c) => c.fileNameSuffix === fileNameSuffix);
  if (!layoutEntry) throw new Error(`role ${fileNameSuffix} not found`);
  return layoutEntry;
}

function aabbOfRole(out: CabinetBuildOutput, fileNameSuffix: string): WorldAabb {
  const layoutEntry = layoutOf(out, fileNameSuffix);
  if (!layoutEntry.pose) throw new Error(`role ${fileNameSuffix} has no pose`);
  return worldAabb(dimsOf(out, fileNameSuffix), layoutEntry.pose);
}

function expectAabb(
  aabb: WorldAabb,
  expected: { x: [number, number]; y: [number, number]; z: [number, number] },
  precision = 6,
): void {
  expect(aabb.xMin).toBeCloseTo(expected.x[0], precision);
  expect(aabb.xMax).toBeCloseTo(expected.x[1], precision);
  expect(aabb.yMin).toBeCloseTo(expected.y[0], precision);
  expect(aabb.yMax).toBeCloseTo(expected.y[1], precision);
  expect(aabb.zMin).toBeCloseTo(expected.z[0], precision);
  expect(aabb.zMax).toBeCloseTo(expected.z[1], precision);
}

describe('buildDiagonalCornerCabinet — pose (Slice 8: bottom/top/back/side/toekick)', () => {
  it('Bottom world AABB sits horizontally under the full pentagon footprint', () => {
    // position={0,0,0}; dims (W1=900,W2=900,Tc=18); outline panel, but
    // buildOutlinePrism re-centers to buildPanelBox's convention (PanelOps.ts
    // :182-184) so the translation-only family (identity rotation) applies
    // exactly like baseCabinet/cornerCabinet bottom.
    const out = buildDiagonalCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Bottom'), { x: [0, 900], y: [0, 900], z: [0, 18] });
  });

  it('Top world AABB sits horizontally just under the ceiling', () => {
    // position={0,0,H-Tc=702}; same dims/family as Bottom.
    const out = buildDiagonalCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Top'), { x: [0, 900], y: [0, 900], z: [702, 720] });
  });

  it('Back 1 world AABB stands vertically flush against the wall-1 wall (Y near 0), raised above Bottom', () => {
    // position={0,0,Tc=18}; dims (W1=900,H=720,Tb=6); back family (rx=90),
    // same as baseCabinet/cornerCabinet back — length W1 spans world X.
    // Stored position.z=Tc (not 0, unlike cornerCabinet's Back) so the AABB
    // is raised by Tc above the floor — reflects the template's own stored
    // numbers verbatim (Option B never changes them).
    const out = buildDiagonalCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Back 1'), { x: [0, 900], y: [0, 6], z: [18, 738] });
  });

  it('Back 2 world AABB stands vertically flush against the wall-2 wall (X near 0), same Z band as Back 1', () => {
    // position={0,0,Tc=18}; dims (W2=900,H=720,Tb=6). Wall 2 runs along Y so
    // this back's length W2 spans world Y (not X) — same axis permutation as
    // cornerCabinet's Back 2 (rotation rx=0,ry=90,rz=90).
    const out = buildDiagonalCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Back 2'), { x: [0, 6], y: [0, 900], z: [18, 738] });
  });

  it('Return Side 1 world AABB stands vertically at the far +X end of the wall-1 return', () => {
    // position={x:W1-Tc=882,y:0,z:0}; dims (H=720,D1=560,Tc=18); side-panel
    // family (ry=90), same as cornerCabinet Leg 1 End (identical dims/position).
    const out = buildDiagonalCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Return Side 1'), { x: [882, 900], y: [0, 560], z: [0, 720] });
  });

  it('Return Side 2 world AABB stands vertically at the far +Y end of the wall-2 return', () => {
    // position={x:0,y:W2-Tc=882,z:0}; dims (H=720,D2=560,Tc=18). Wall 2 runs
    // along Y so its width (D2) maps to world X and thickness maps to world Y
    // — same permutation as cornerCabinet Leg 2 End (identical dims/position).
    const out = buildDiagonalCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Return Side 2'), { x: [0, 560], y: [882, 900], z: [0, 720] });
  });

  it('Toekick 1 world AABB stands vertically at the wall-1 kickboard position, inset by Tc each side', () => {
    // position={x:Tc=18,y:0,z:0}; dims (W1-2Tc=864, tkH=100, Tc=18); toekick
    // family (rx=-90), same as baseCabinet toekick. Note: toekickSetback is
    // NOT threaded through this template (pre-existing gap, out of scope) —
    // the toekick sits flush at y=0 per the stored position, not set back
    // from a front edge.
    const out = buildDiagonalCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Toekick 1'), { x: [18, 882], y: [0, 18], z: [0, 100] });
  });

  it('Toekick 2 world AABB stands vertically at the wall-2 kickboard position, inset by Tc each side', () => {
    // position={x:0,y:Tc=18,z:0}; dims (W2-2Tc=864, tkH=100, Tc=18). Wall 2
    // permutation: length maps to world Y, thickness to world X — same
    // rotation family as Back 2 (rx=0,ry=90,rz=90).
    const out = buildDiagonalCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Toekick 2'), { x: [0, 18], y: [18, 882], z: [0, 100] });
  });
});

describe('buildDiagonalCornerCabinet — pose (Slice 8: Front Stile 1/2 + Door stay on the Euler fallback)', () => {
  // These three roles get NO pose field — componentLocalPose's fallback
  // (position used as-is for translation, rotation Euler converted straight
  // to a quaternion) already reaches the correct world placement because
  // `position` is stored as the panel's CENTER (not a min-corner) and
  // `uprightRot` is the full 3D rotation needed (not a partial/broken hint).
  // This locks that fallback path as the regression guard: if pose is added
  // to these roles later, the panel would be double-corrected and drift.
  const uprightRotRy = 45; // ry = arcsin(dY)*180/π for the symmetric fixture

  function fallbackAabb(out: CabinetBuildOutput, fileNameSuffix: string): WorldAabb {
    const comp = layoutOf(out, fileNameSuffix);
    expect(comp.pose).toBeUndefined();
    const q = quatFromEulerXYZ(comp.rotation.rx, comp.rotation.ry, comp.rotation.rz);
    return worldAabb(dimsOf(out, fileNameSuffix), { translation: comp.position, quaternion: q });
  }

  function expectUprightRot(comp: CabinetComponentDef): void {
    expect(comp.rotation.rx).toBeCloseTo(-90, 6);
    expect(comp.rotation.ry).toBeCloseTo(uprightRotRy, 6);
    expect(comp.rotation.rz).toBeCloseTo(-90, 6);
  }

  it('Front Stile 1 has no pose and its Euler-fallback world AABB is centered on stile1X/Y', () => {
    const out = buildDiagonalCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    const comp = layoutOf(out, 'Front Stile 1');
    expectUprightRot(comp);
    expectAabb(fallbackAabb(out, 'Front Stile 1'), {
      x: [864.6446609406726, 912.727922061358],
      y: [559.9999999999999, 608.0832611206854],
      z: [2, 718],
    }, 3);
  });

  it('Front Stile 2 has no pose and its Euler-fallback world AABB is centered on stile2X/Y', () => {
    const out = buildDiagonalCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    const comp = layoutOf(out, 'Front Stile 2');
    expectUprightRot(comp);
    expectAabb(fallbackAabb(out, 'Front Stile 2'), {
      x: [560, 608.0832611206854],
      y: [864.6446609406725, 912.727922061358],
      z: [2, 718],
    }, 3);
  });

  it('Door has no pose and its Euler-fallback world AABB is centered on the diagonal midpoint', () => {
    const out = buildDiagonalCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    const comp = layoutOf(out, 'Door');
    expectUprightRot(comp);
    expectAabb(fallbackAabb(out, 'Door'), {
      x: [596.7695526217004, 875.9583694396574],
      y: [596.7695526217003, 875.9583694396575],
      z: [2, 718],
    }, 3);
  });
});
