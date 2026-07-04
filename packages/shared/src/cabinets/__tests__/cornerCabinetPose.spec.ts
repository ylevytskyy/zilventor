import { describe, it, expect } from 'vitest';
import type { MaterialEntry } from '../../material';
import { buildCornerCabinet } from '../cornerCabinet';
import type { CornerCabinetParams, CabinetBuildOutput } from '../types';

/**
 * Locking tests for cabinet-pose-fix Slice 6 (cornerCabinet). Per plan §3,
 * `pose` is an ADDITIVE field: stored `position`/`rotation` numbers must not
 * change. This spec is the numeric arbiter for the per-role rotation
 * hypotheses derived by physical reasoning about the L-shaped carcass — it
 * asserts the resulting WORLD AABB of each panel (via pose.translation +
 * pose.quaternion applied to buildPanelBox's local box: X∈[-L/2,L/2],
 * Y∈[-W/2,W/2], Z∈[0,T]), not the rotation numbers themselves. A rotation
 * sign that produces the wrong AABB is wrong, regardless of hypothesis.
 */

const carcass: MaterialEntry = {
  id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896',
};
const back: MaterialEntry = {
  id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47',
};
const REGISTRY: ReadonlyArray<MaterialEntry> = [carcass, back];

// Same fixture as cornerCabinet.spec.ts and GenerateCarcassBoresCommand.corner.spec.ts:
// leg 1 runs along +X (length width1=900, depth depth1=350 into the room on Y);
// leg 2 runs along +Y (length width2=600, depth depth2=350 into the room on X).
const DEFAULT_PARAMS: CornerCabinetParams = {
  name: 'Corner 1',
  width1: 900, depth1: 350,
  width2: 600, depth2: 350,
  height: 720,
  carcassMaterialId: 'm-birch-18',
  backMaterialId: 'm-hb-6',
  bandMaterialId: null,
};

type Quat = readonly [number, number, number, number];
type Vec3 = { x: number; y: number; z: number };

// Local re-implementation of kernel/src/assembly/quat.ts's quatRotateVec (same
// oracle used by baseCabinetPose.spec.ts — packages/shared cannot depend on
// @zilventor/kernel).
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

function aabbOfRole(out: CabinetBuildOutput, fileNameSuffix: string): WorldAabb {
  const layoutEntry = out.layout.find((c) => c.fileNameSuffix === fileNameSuffix);
  const panelEntry = out.panels.find((p) => p.fileNameSuffix === fileNameSuffix);
  if (!layoutEntry || !panelEntry) throw new Error(`role ${fileNameSuffix} not found`);
  if (!layoutEntry.pose) throw new Error(`role ${fileNameSuffix} has no pose`);
  const lit = (v: { kind: string; value?: number }): number => {
    if (v.kind !== 'literal') throw new Error('expected literal dim');
    return v.value!;
  };
  const dims = {
    length: lit(panelEntry.panel.length),
    width: lit(panelEntry.panel.width),
    thickness: lit(panelEntry.panel.thickness),
  };
  return worldAabb(dims, layoutEntry.pose);
}

function expectAabb(
  aabb: WorldAabb,
  expected: { x: [number, number]; y: [number, number]; z: [number, number] },
): void {
  expect(aabb.xMin).toBeCloseTo(expected.x[0], 6);
  expect(aabb.xMax).toBeCloseTo(expected.x[1], 6);
  expect(aabb.yMin).toBeCloseTo(expected.y[0], 6);
  expect(aabb.yMax).toBeCloseTo(expected.y[1], 6);
  expect(aabb.zMin).toBeCloseTo(expected.z[0], 6);
  expect(aabb.zMax).toBeCloseTo(expected.z[1], 6);
}

describe('buildCornerCabinet — pose (Slice 6)', () => {
  it('Leg 1 End world AABB stands vertically at the far +X wall of leg 1', () => {
    // position={x:W1-Tc=882,y:0,z:0}; dims (H=720,D1=350,Tc=18); side-panel
    // family (rotation ry=90, like baseCabinet leftSide/rightSide).
    const out = buildCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Leg 1 End'), { x: [882, 900], y: [0, 350], z: [0, 720] });
  });

  it('Leg 2 End world AABB stands vertically at the far +Y wall of leg 2', () => {
    // position={x:0,y:W2-Tc=582,z:0}; dims (H=720,D2=350,Tc=18). Leg 2 runs
    // along Y so its width (D2, depth-into-room-on-X) maps to world X and its
    // thickness maps to world Y — a different axis permutation than Leg 1 End.
    const out = buildCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Leg 2 End'), { x: [0, 350], y: [582, 600], z: [0, 720] });
  });

  it('Back 1 world AABB stands vertically flush against the leg-1 wall (Y=0)', () => {
    // position={0,0,0}; dims (W1=900,H=720,Tb=6); back family (rotation
    // rx=90), same as baseCabinet back — length W1 spans world X.
    const out = buildCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Back 1'), { x: [0, 900], y: [0, 6], z: [0, 720] });
  });

  it('Back 2 world AABB stands vertically flush against the leg-2 wall (X=0)', () => {
    // position={0,0,0}; dims (W2=600,H=720,Tb=6). Leg 2 runs along Y so this
    // back's length W2 spans world Y (not X like Back 1) — a different axis
    // permutation than Back 1.
    const out = buildCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Back 2'), { x: [0, 6], y: [0, 600], z: [0, 720] });
  });

  it('Bottom 1 world AABB sits horizontally under the full leg-1 footprint', () => {
    // position={0,0,0}; dims (W1=900,D1=350,Tc=18); translation-only family
    // (rotation identity), same as baseCabinet bottom/top.
    const out = buildCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Bottom 1'), { x: [0, 900], y: [0, 350], z: [0, 18] });
  });

  it('Bottom 2 world AABB sits horizontally under the leg-2 strip beyond the corner zone', () => {
    // position={x:0,y:D1=350,z:0}; dims (D2=350,W2-D1=250,Tc=18).
    const out = buildCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Bottom 2'), { x: [0, 350], y: [350, 600], z: [0, 18] });
  });

  it('Top 1 world AABB sits horizontally just under the leg-1 ceiling', () => {
    // position={x:0,y:0,z:H-Tc=702}; dims (W1=900,D1=350,Tc=18).
    const out = buildCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Top 1'), { x: [0, 900], y: [0, 350], z: [702, 720] });
  });

  it('Top 2 world AABB sits horizontally just under the leg-2 strip ceiling', () => {
    // position={x:0,y:D1=350,z:H-Tc=702}; dims (D2=350,W2-D1=250,Tc=18).
    const out = buildCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Top 2'), { x: [0, 350], y: [350, 600], z: [702, 720] });
  });

  it('Corner Post world AABB stands vertically flush against the reentrant inner corner', () => {
    // position={x:D2-Tc=332,y:D1-Tc=332,z:0}; dims (H=720,Tc=18,Tc=18) — a
    // square post, side-panel family (rotation ry=90, same as leftSide/
    // rightSide/cornerPost per plan §3.2's "translation = position +
    // (0, Tc/2, H/2)" hint).
    const out = buildCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Corner Post'), { x: [332, 350], y: [332, 350], z: [0, 720] });
  });
});
