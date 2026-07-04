import { describe, it, expect } from 'vitest';
import type { MaterialEntry } from '../../material';
import { buildBaseCabinet } from '../baseCabinet';
import type { BaseCabinetParams, CabinetBuildOutput } from '../types';

/**
 * Locking tests for cabinet-pose-fix Slices 3-5 (baseCabinet). Per plan §3,
 * `pose` is an ADDITIVE field: stored `position`/`rotation` numbers must not
 * change. This spec is the numeric arbiter for the per-role rotation
 * hypotheses in the plan's §3.4 table — it asserts the resulting WORLD AABB
 * of each panel (via pose.translation + pose.quaternion applied to
 * buildPanelBox's local box: X∈[-L/2,L/2], Y∈[-W/2,W/2], Z∈[0,T]), not the
 * rotation numbers themselves. A rotation sign that produces the wrong AABB
 * is wrong, regardless of what the plan hypothesized.
 */

const carcass: MaterialEntry = {
  id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896',
};
const back: MaterialEntry = {
  id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47',
};
const REGISTRY: ReadonlyArray<MaterialEntry> = [carcass, back];

// Fixture: W=600 D=560 H=720 Tc=18 Tb=6, toekickHeight=100, toekickSetback=50
// (same numeric fixture as baseCabinet.spec.ts).
const DEFAULT_PARAMS: BaseCabinetParams = {
  name: 'Base Cabinet 1',
  width: 600, depth: 560, height: 720,
  toekickHeight: 100, toekickSetback: 50,
  shelfCount: 1,
  carcassMaterialId: 'm-birch-18',
  backMaterialId: 'm-hb-6',
  bandMaterialId: null,
};

type Quat = readonly [number, number, number, number];
type Vec3 = { x: number; y: number; z: number };

// Local re-implementation of kernel/src/assembly/quat.ts's quatRotateVec.
// `packages/shared` cannot depend on `@zilventor/kernel` (kernel depends on
// shared), so this test independently rotates world-AABB corners by the
// pose.quaternion the template actually emits — an oracle over the physical
// placement, not a re-derivation of how the quaternion was produced.
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

describe('buildBaseCabinet — pose (Slice 3: leftSide/rightSide)', () => {
  it('leftSide world AABB stands vertically at the left wall', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Left Side'), { x: [0, 18], y: [0, 560], z: [0, 720] });
  });

  it('rightSide world AABB stands vertically at the right wall', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Right Side'), { x: [582, 600], y: [0, 560], z: [0, 720] });
  });
});

describe('buildBaseCabinet — pose (Slice 4: back/toekick/hangingRail)', () => {
  it('back world AABB stands vertically flush against the back wall', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    // Tb=6: back panel's own thickness occupies Y∈[0,6] (position.y=0 stored).
    expectAabb(aabbOfRole(out, 'Back'), { x: [0, 600], y: [0, 6], z: [0, 720] });
  });

  it('toekick world AABB stands vertically at the kickboard position', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    // position.y = D - toekickSetback - Tc = 560-50-18 = 492; thickness Tc=18 → y:[492,510].
    // width tkH=100 spans z:[0,100] (floor to toekick height); x inset by Tc each side.
    expectAabb(aabbOfRole(out, 'Toekick'), { x: [18, 582], y: [492, 510], z: [0, 100] });
  });

  it('hangingRail world AABB stands vertically at the top-back (wall cabinet)', () => {
    const out = buildBaseCabinet({ ...DEFAULT_PARAMS, cabinetType: 'wall' }, REGISTRY);
    // position = {x:Tc, y:Tb, z:H-Tc-80} = {18, 6, 720-18-80=622}; thickness Tc=18 → y:[6,24].
    // width=80 spans z:[622,702]; x inset by Tc each side, same span as toekick.
    expectAabb(aabbOfRole(out, 'Hanging Rail'), { x: [18, 582], y: [6, 24], z: [622, 702] });
  });
});

describe('buildBaseCabinet — pose (Slice 5: bottom/top/shelf, translation-only)', () => {
  it('bottom world AABB sits horizontally at the toekick height', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    // position = {x:Tc,y:Tb,z:tkH} = {18,6,100}; length=W-2Tc=564, width=D-Tb=554.
    expectAabb(aabbOfRole(out, 'Bottom'), { x: [18, 582], y: [6, 560], z: [100, 118] });
  });

  it('top world AABB sits horizontally just under the cabinet ceiling', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    // position = {x:Tc,y:Tb,z:H-Tc} = {18,6,702}; same length/width as bottom.
    expectAabb(aabbOfRole(out, 'Top'), { x: [18, 582], y: [6, 560], z: [702, 720] });
  });

  it('shelf world AABB sits horizontally at its computed Z, shrunk in depth', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    // shelfCount=1: innerBottom=118, innerTop=702, span=584, step=292, z=410.
    // width = D-Tb-20 = 534 (SHELF_DEPTH_SHRINK_MM).
    expectAabb(aabbOfRole(out, 'Shelf 1'), { x: [18, 582], y: [6, 540], z: [410, 428] });
  });
});
