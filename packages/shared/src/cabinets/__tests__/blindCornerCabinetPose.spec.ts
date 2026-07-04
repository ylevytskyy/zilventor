import { describe, it, expect } from 'vitest';
import type { MaterialEntry } from '../../material';
import { buildBlindCornerCabinet } from '../blindCornerCabinet';
import type { BlindCornerCabinetParams, CabinetBuildOutput } from '../types';
import { DOOR_POSE } from '../../prisadkaFaceConventions';

/**
 * Locking tests for cabinet-pose-fix Slice 7 (blindCornerCabinet). Per plan §3,
 * `pose` is an ADDITIVE field: stored `position`/`rotation` numbers must not
 * change. This spec is the numeric arbiter for the per-role rotation
 * hypotheses derived by role-analogy to baseCabinet/cornerCabinet (plan §3.2
 * table + §3.5 blindFiller note) — it asserts the resulting WORLD AABB of
 * each panel (via pose.translation + pose.quaternion applied to
 * buildPanelBox's local box: X∈[-L/2,L/2], Y∈[-W/2,W/2], Z∈[0,T]), not the
 * rotation numbers themselves. A rotation sign that produces the wrong AABB
 * is wrong, regardless of hypothesis.
 *
 * Door: separately locks the currently-dropped DOOR_POSE.quaternion (the
 * template routes the door's layout entry through `makeLayout`, which
 * hardcodes rotation {0,0,0} and has no `pose` field at all — the quaternion
 * computed by doorMath/DOOR_POSE never reaches the layout entry).
 */

const carcass: MaterialEntry = { id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' };
const back: MaterialEntry = { id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' };
const REGISTRY: ReadonlyArray<MaterialEntry> = [carcass, back];

// Same fixture as blindCornerCabinet.spec.ts: W=900 D=560 H=720 Tc=18 Tb=6,
// toekickHeight=100, toekickSetback=60, openingWidth=450, blindSide='left'.
const DEFAULT_PARAMS: BlindCornerCabinetParams = {
  name: 'Blind 1',
  width: 900, depth: 560, height: 720,
  toekickHeight: 100, toekickSetback: 60,
  openingWidth: 450, blindSide: 'left',
  shelfCount: 0,
  carcassMaterialId: 'm-birch-18',
  backMaterialId: 'm-hb-6',
  bandMaterialId: null,
};

type Quat = readonly [number, number, number, number];
type Vec3 = { x: number; y: number; z: number };

// Local re-implementation of kernel/src/assembly/quat.ts's quatRotateVec (same
// oracle used by baseCabinetPose.spec.ts / cornerCabinetPose.spec.ts —
// packages/shared cannot depend on @zilventor/kernel).
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

describe('buildBlindCornerCabinet — pose (Slice 7)', () => {
  it('Left Side world AABB stands vertically at the left wall', () => {
    // position={0,0,0}; dims (H=720,D=560,Tc=18); side-panel family (rotation
    // ry=90), same as baseCabinet leftSide.
    const out = buildBlindCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Left Side'), { x: [0, 18], y: [0, 560], z: [0, 720] });
  });

  it('Right Side world AABB stands vertically at the right wall', () => {
    // position={x:W-Tc=882,y:0,z:0}; dims (H=720,D=560,Tc=18).
    const out = buildBlindCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Right Side'), { x: [882, 900], y: [0, 560], z: [0, 720] });
  });

  it('Bottom world AABB sits horizontally at the toekick height', () => {
    // position={x:Tc,y:Tb,z:tkH}={18,6,100}; length=W-2Tc=864, width=D-Tb=554.
    const out = buildBlindCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Bottom'), { x: [18, 882], y: [6, 560], z: [100, 118] });
  });

  it('Top world AABB sits horizontally just under the cabinet ceiling', () => {
    // position={x:Tc,y:Tb,z:H-Tc}={18,6,702}; same length/width as Bottom.
    const out = buildBlindCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Top'), { x: [18, 882], y: [6, 560], z: [702, 720] });
  });

  it('Back world AABB stands vertically flush against the back wall', () => {
    // position={x:Tc,y:0,z:Tc}={18,0,18}; length=W-2Tc=864, width=H-2Tc=684,
    // thickness=Tb=6; back family (rotation rx=90), same as baseCabinet back.
    const out = buildBlindCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Back'), { x: [18, 882], y: [0, 6], z: [18, 702] });
  });

  it('Toekick world AABB stands vertically at the kickboard position', () => {
    // position={x:Tc,y:D-tkS-Tc,z:0}={18,482,0}; length=W-2Tc=864, width=tkH=100,
    // thickness=Tc=18; toekick family (rotation rx=-90), same as baseCabinet toekick.
    const out = buildBlindCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Toekick'), { x: [18, 882], y: [482, 500], z: [0, 100] });
  });

  it('Blind Filler (blindSide=left) world AABB stands vertically in the dead-zone divider', () => {
    // position={x:Tc,y:D-blindFillerW,z:Tc}={18,128,18}; length=H-2Tc=684,
    // width=blindFillerW=432, thickness=Tc=18; side-panel family (rotation
    // ry=90) per plan §3.5 — thickness maps to the horizontal X axis exactly
    // like leftSide/rightSide/cornerPost.
    const out = buildBlindCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    expectAabb(aabbOfRole(out, 'Blind Filler'), { x: [18, 36], y: [128, 560], z: [18, 702] });
  });

  it('Blind Filler (blindSide=right) world AABB stands vertically in the dead-zone divider', () => {
    // position={x:W-Tc-blindFillerW,y:D-blindFillerW,z:Tc}={450,128,18}; same dims/family.
    const out = buildBlindCornerCabinet({ ...DEFAULT_PARAMS, blindSide: 'right' }, REGISTRY);
    expectAabb(aabbOfRole(out, 'Blind Filler'), { x: [450, 468], y: [128, 560], z: [18, 702] });
  });

  it('Shelf world AABB sits horizontally at its computed Z', () => {
    // shelfCount=1: innerBottom=118, innerTop=702, span=584, step=292, z=410.
    // Same translation-only family as Bottom/Top.
    const out = buildBlindCornerCabinet({ ...DEFAULT_PARAMS, shelfCount: 1 }, REGISTRY);
    expectAabb(aabbOfRole(out, 'Shelf 1'), { x: [18, 882], y: [6, 560], z: [410, 428] });
  });

  it('Door layout entry carries the DOOR_POSE quaternion (currently dropped by makeLayout)', () => {
    const out = buildBlindCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    const doorComp = out.layout.find((c) => c.fileNameSuffix === 'Door');
    expect(doorComp).toBeDefined();
    expect(doorComp!.pose).toBeDefined();
    expect(doorComp!.pose!.quaternion).toEqual(DOOR_POSE.quaternion);
  });

  it('Door pose.translation matches the stored position (additive, not a divergent value)', () => {
    const out = buildBlindCornerCabinet(DEFAULT_PARAMS, REGISTRY);
    const doorComp = out.layout.find((c) => c.fileNameSuffix === 'Door')!;
    expect(doorComp.pose!.translation).toEqual(doorComp.position);
  });
});
