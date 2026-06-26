/**
 * TDD test suite for buildDiagonalCornerCabinet (Task 5 — M4 Slice E).
 *
 * All numeric values are DERIVED FROM SPEC §4 of
 * docs/superpowers/specs/2026-06-26-m4-sliceE-blind-diagonal-corner-cabinets-design.md
 *
 * DISCREPANCY NOTE: The task-5-brief.md uses W1=W2=600, D1=D2=560 which produces
 * diagLen≈56.57mm — invalid with stileWidth=50 (doorW<0). The spec §4.3 formula
 * gives the correct diagLen. Corrected params: W1=W2=900, D1=D2=560 → diagLen=340√2≈480.83mm.
 *
 * PHASE-0 WORLD-SPACE ALIGNMENT — proves that cup and plate bores share the same
 * world-Z (height) to within 0.1mm. Requires the upright rotation
 * {rx:−90, ry:arcsin(dY)*180/π, rz:−90} on both door and stile.
 */
import { describe, it, expect } from 'vitest';
import type { MaterialEntry } from '../../material';
import { buildDiagonalCornerCabinet } from '../diagonalCornerCabinet';
import type { DiagonalCornerCabinetParams } from '../types';
import { hingeCountForHeight, CUP_SETBACK } from '../../hingeMath';
import { DEFAULT_DOOR_THICKNESS, DEFAULT_REVEAL } from '../../doorMath';
import { face2DFrame } from '../../bore';

const carcass: MaterialEntry = { id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' };
const back: MaterialEntry = { id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' };
const REGISTRY: ReadonlyArray<MaterialEntry> = [carcass, back];

// Symmetric case: W1=W2=900, D1=D2=560 → diagLen = 340√2 ≈ 480.83mm, θ = 135°
// doorW = 480.83 − 2×50 − 2×2 = 376.83mm > MIN_DOOR_WIDTH(100) ✓
const P: DiagonalCornerCabinetParams = {
  name: 'Diag 1',
  wallWidth1: 900, wallWidth2: 900,
  returnDepth1: 560, returnDepth2: 560,
  height: 720, toekickHeight: 100, toekickSetback: 60,
  stileWidth: 50,
  carcassMaterialId: 'm-birch-18',
  backMaterialId: 'm-hb-6',
  bandMaterialId: null,
};

const { wallWidth1: W1, wallWidth2: W2, returnDepth1: D1, returnDepth2: D2, height: H, stileWidth } = P;
// spec §4.3 formula
const diagLen = Math.sqrt((W1 - D2) ** 2 + (D1 - W2) ** 2); // 340√2 ≈ 480.833
const Tc = 18;
const Td = DEFAULT_DOOR_THICKNESS; // 18
const r = DEFAULT_REVEAL;          // 2

// spec §4.5
const doorW = diagLen - 2 * stileWidth - 2 * r;    // ≈ 376.833
const doorH = H - 2 * r;                           // 716

// spec §4.3 — diagonal direction unit vector
const dX = (D2 - W1) / diagLen; // −1/√2
const dY = (W2 - D1) / diagLen; // +1/√2

// spec §4.6 — stile plate-bore v setback
const frontSetback = Td + (CUP_SETBACK['full'] - Tc / 2); // 18 + (21 − 9) = 30

// ─── Inline quat helpers (kernel not in shared deps) ────────────────────────

type Quat = [number, number, number, number];
type Vec3 = { x: number; y: number; z: number };

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

/** Bore (u,v) on face → world 3D using component pose. */
function boreWorldPos(
  bore: { u: number; v: number },
  panelDims: { length: number; width: number; thickness: number },
  faceName: 'Top' | 'Bottom',
  component: { position: { x: number; y: number; z: number }; rotation: { rx: number; ry: number; rz: number } },
): Vec3 {
  const frame = face2DFrame(panelDims, faceName);
  const local: Vec3 = {
    x: frame.origin.x + bore.u * frame.uDir.x + bore.v * frame.vDir.x,
    y: frame.origin.y + bore.u * frame.uDir.y + bore.v * frame.vDir.y,
    z: frame.origin.z + bore.u * frame.uDir.z + bore.v * frame.vDir.z,
  };
  const q = quatFromEulerXYZ(component.rotation.rx, component.rotation.ry, component.rotation.rz);
  const rotated = quatRotateVec(q, local);
  return {
    x: rotated.x + component.position.x,
    y: rotated.y + component.position.y,
    z: rotated.z + component.position.z,
  };
}

// ─── panels ─────────────────────────────────────────────────────────────────

describe('buildDiagonalCornerCabinet — panels', () => {
  it('emits exactly 11 panels: 2 outline + 2 backs + 2 sides + 2 toekicks + 2 stiles + 1 door', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    expect(out.panels).toHaveLength(11);
  });

  it('bottom panel has 5-vertex pentagon outline matching spec §4.4 vertices', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const bottom = out.panels.find(p => p.role === 'bottom')!;
    expect(bottom).toBeDefined();
    expect(bottom.panel.outline).toHaveLength(5);
    expect(bottom.panel.outline![0]).toEqual({ x: 0,  y: 0  });   // V0
    expect(bottom.panel.outline![1]).toEqual({ x: W1, y: 0  });   // V1
    expect(bottom.panel.outline![2]).toEqual({ x: W1, y: D1 });   // V2
    expect(bottom.panel.outline![3]).toEqual({ x: D2, y: W2 });   // V3
    expect(bottom.panel.outline![4]).toEqual({ x: 0,  y: W2 });   // V4
  });

  it('top panel also has the same pentagon outline', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const top = out.panels.find(p => p.role === 'top')!;
    expect(top.panel.outline).toHaveLength(5);
    expect(top.panel.outline![2]).toEqual({ x: W1, y: D1 });
    expect(top.panel.outline![3]).toEqual({ x: D2, y: W2 });
  });

  it('bottom AABB extents equal W1 × W2 (cut-list conservative sheet stock, spec §4.4)', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const bottom = out.panels.find(p => p.role === 'bottom')!;
    expect((bottom.panel.length as { value: number }).value).toBe(W1);
    expect((bottom.panel.width as { value: number }).value).toBe(W2);
  });

  it('emits exactly 2 frontStile panels', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const stiles = out.panels.filter(p => p.role === 'frontStile');
    expect(stiles).toHaveLength(2);
    expect(stiles[0]!.fileNameSuffix).toBe('Front Stile 1');
    expect(stiles[1]!.fileNameSuffix).toBe('Front Stile 2');
  });

  it('door width = diagonalLength − 2×stileWidth − 2×reveal (spec §4.5)', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const door = out.panels.find(p => p.role === 'door')!;
    expect((door.panel.width as { value: number }).value).toBeCloseTo(doorW, 1);
  });

  it('door height = height − 2×reveal (spec §4.5)', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const door = out.panels.find(p => p.role === 'door')!;
    expect((door.panel.length as { value: number }).value).toBeCloseTo(doorH, 1);
  });

  it('non-outline panels have no outline field', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const nonOutline = out.panels.filter(p => p.role !== 'bottom' && p.role !== 'top');
    nonOutline.forEach(pd => expect(pd.panel.outline).toBeUndefined());
  });
});

// ─── layout rotations ───────────────────────────────────────────────────────

describe('buildDiagonalCornerCabinet — layout rotations', () => {
  // BLOCKER B — Phase-0 door Euler derivation test (replaces vacuous rz≠0 check).
  //
  // The door and stile use intrinsic XYZ Euler (rx=−90, ry=arcsin(dY)*180/π, rz=−90)
  // which produces R = [[0,−dX,dY],[0,−dY,−dX],[1,0,0]]. Asserts:
  //   part+X → world+Z (door stands upright, height along world Z)
  //   part+Z → outward normal (dY,−dX,0) (door faces diagonal opening)
  // Covers symmetric (dY=1/√2) AND a representative asymmetric case.
  it('BLOCKER B: door rotation (rx=−90, ry=arcsin(dY)*180/π, rz=−90) maps part+X→world+Z for symmetric case', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const doorComp = out.layout.find(c => c.fileNameSuffix === 'Door')!;
    expect(doorComp).toBeDefined();
    const { rx, ry, rz } = doorComp.rotation;
    const q = quatFromEulerXYZ(rx, ry, rz);

    // part+X must map to world+Z (door length = doorH stands vertical)
    const worldX = quatRotateVec(q, { x: 1, y: 0, z: 0 });
    expect(worldX.x).toBeCloseTo(0, 9);
    expect(worldX.y).toBeCloseTo(0, 9);
    expect(worldX.z).toBeCloseTo(1, 9);

    // part+Z must map to outward normal (dY,−dX,0) for symmetric: (1/√2, 1/√2, 0)
    const worldZ = quatRotateVec(q, { x: 0, y: 0, z: 1 });
    expect(worldZ.x).toBeCloseTo(dY, 6);   // nX = dY = 1/√2
    expect(worldZ.y).toBeCloseTo(-dX, 6);  // nY = −dX = 1/√2
    expect(worldZ.z).toBeCloseTo(0, 9);
  });

  it('BLOCKER B: door rotation maps part+X→world+Z and part+Z→outward normal for ASYMMETRIC case', () => {
    // Asymmetric: W1=1000, W2=600, D1=480, D2=350 → dX≈−0.983, dY≈0.182, diagLen≈661mm
    const PA: DiagonalCornerCabinetParams = {
      ...P,
      wallWidth1: 1000, wallWidth2: 600,
      returnDepth1: 480, returnDepth2: 350,
    };
    const out = buildDiagonalCornerCabinet(PA, REGISTRY);
    const doorComp = out.layout.find(c => c.fileNameSuffix === 'Door')!;
    const { rx, ry, rz } = doorComp.rotation;
    const q = quatFromEulerXYZ(rx, ry, rz);

    const dL = Math.sqrt((1000-350)**2 + (480-600)**2);
    const adX = (350-1000)/dL, adY = (600-480)/dL;

    const worldX = quatRotateVec(q, { x: 1, y: 0, z: 0 });
    expect(worldX.x).toBeCloseTo(0, 6);
    expect(worldX.y).toBeCloseTo(0, 6);
    expect(worldX.z).toBeCloseTo(1, 6);

    const worldZ = quatRotateVec(q, { x: 0, y: 0, z: 1 });
    expect(worldZ.x).toBeCloseTo(adY, 6);
    expect(worldZ.y).toBeCloseTo(-adX, 6);
    expect(worldZ.z).toBeCloseTo(0, 6);
  });

  it('stile 1 has upright rotation (rx=−90, ry=arcsin(dY)*180/π, rz=−90) (spec §4.4)', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const stile1 = out.layout.find(c => c.fileNameSuffix === 'Front Stile 1')!;
    expect(stile1).toBeDefined();
    expect(stile1.rotation.rx).toBeCloseTo(-90, 6);
    expect(stile1.rotation.ry).toBeCloseTo(Math.asin(dY) * 180 / Math.PI, 6); // 45° symmetric
    expect(stile1.rotation.rz).toBeCloseTo(-90, 6);
  });

  it('stile 2 has the same upright rotation as stile 1', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const stile2 = out.layout.find(c => c.fileNameSuffix === 'Front Stile 2')!;
    expect(stile2.rotation.rx).toBeCloseTo(-90, 6);
    expect(stile2.rotation.ry).toBeCloseTo(Math.asin(dY) * 180 / Math.PI, 6);
    expect(stile2.rotation.rz).toBeCloseTo(-90, 6);
  });

  it('door center position equals diagonal midpoint ((W1+D2)/2, (D1+W2)/2) (spec §4.4)', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const doorComp = out.layout.find(c => c.fileNameSuffix === 'Door')!;
    expect(doorComp.position.x).toBeCloseTo((W1 + D2) / 2, 1); // 730
    expect(doorComp.position.y).toBeCloseTo((D1 + W2) / 2, 1); // 730
  });

  it('stile 1 X center = W1 + (stileWidth/2)*dX (spec §4.4)', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const stile1 = out.layout.find(c => c.fileNameSuffix === 'Front Stile 1')!;
    const expectedX = W1 + (stileWidth / 2) * dX;
    expect(stile1.position.x).toBeCloseTo(expectedX, 1);
  });
});

// ─── hinge boring ───────────────────────────────────────────────────────────

describe('buildDiagonalCornerCabinet — hinge boring', () => {
  it('doorBores defined, targets Door suffix, count = hingeCountForHeight(doorH)', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    expect(out.doorBores).toBeDefined();
    expect(out.doorBores!).toHaveLength(1);
    expect(out.doorBores![0]!.doorSuffix).toBe('Door');
    expect(out.doorBores![0]!.cupBores).toHaveLength(hingeCountForHeight(doorH));
  });

  it('plateBores defined, targets Front Stile 1 (hinge stile, spec §4.6)', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    expect(out.plateBores).toBeDefined();
    expect(out.plateBores!).toHaveLength(1);
    expect(out.plateBores![0]!.panelSuffix).toBe('Front Stile 1');
  });

  it('plateBores count = 2 per hinge (System-32 pair, spec §4.6)', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const hingeCount = hingeCountForHeight(doorH);
    expect(out.plateBores![0]!.plateBores).toHaveLength(hingeCount * 2);
  });

  it('plate bore pairs are centered on cup U positions (hinge alignment, spec §4.6)', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const cupBores = out.doorBores![0]!.cupBores;
    const plateBores = out.plateBores![0]!.plateBores;
    const hingeCount = cupBores.length;

    const cupUs = cupBores.map(b => b.u).sort((a, b) => a - b);
    const sortedPlateUs = plateBores.map(b => b.u).sort((a, b) => a - b);

    for (let i = 0; i < hingeCount; i++) {
      const lo = sortedPlateUs[i * 2]!;
      const hi = sortedPlateUs[i * 2 + 1]!;
      expect((lo + hi) / 2).toBeCloseTo(cupUs[i]!, 1); // midpoint aligns with cup u
      expect(hi - lo).toBeCloseTo(32, 1);               // 32mm System-32 PLATE_PAIR_SPACING
    }
  });

  it('all plate bores at v = Td + (CUP_SETBACK[full] − Tc/2) = 30mm (spec §4.6)', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const plateBores = out.plateBores![0]!.plateBores;
    plateBores.forEach(b => expect(b.v).toBeCloseTo(frontSetback, 1)); // 30mm
  });

  // ─── BLOCKER A — Phase-0 world-space hinge alignment ─────────────────────────
  //
  // Maps each cup/plate bore (face,u,v) → part-local 3D via face2DFrame, applies
  // the component's Euler pose → world point. Asserts cup center and plate-pair
  // midpoint share the SAME world-Z to within 0.1mm. Proves the upright rotation
  // and stile length=doorH (not H) are correct (spec §4.4 / §4.6 / §11 Risk 2).

  it('BLOCKER A: cup bore and plate-pair midpoint share world-Z within 0.1mm — SYMMETRIC', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);

    const doorComp = out.layout.find(c => c.fileNameSuffix === 'Door')!;
    const stileComp = out.layout.find(c => c.fileNameSuffix === 'Front Stile 1')!;
    const doorPanel = out.panels.find(p => p.fileNameSuffix === 'Door')!;
    const stilePanel = out.panels.find(p => p.fileNameSuffix === 'Front Stile 1')!;

    const doorDims = {
      length: (doorPanel.panel.length as { value: number }).value,
      width:  (doorPanel.panel.width  as { value: number }).value,
      thickness: (doorPanel.panel.thickness as { value: number }).value,
    };
    const stileDims = {
      length: (stilePanel.panel.length as { value: number }).value,
      width:  (stilePanel.panel.width  as { value: number }).value,
      thickness: (stilePanel.panel.thickness as { value: number }).value,
    };

    const cupBores   = out.doorBores![0]!.cupBores;
    const plateBores = out.plateBores![0]!.plateBores;
    const hingeCount = cupBores.length;

    for (let i = 0; i < hingeCount; i++) {
      const cup = cupBores[i]!;
      const p0 = plateBores[i * 2]!;
      const p1 = plateBores[i * 2 + 1]!;

      const cupWorld  = boreWorldPos(cup, doorDims, 'Bottom', doorComp);
      const midpointU = (p0.u + p1.u) / 2;
      const midpointV = (p0.v + p1.v) / 2;
      const plateMid  = boreWorldPos({ u: midpointU, v: midpointV }, stileDims, 'Top', stileComp);

      expect(Math.abs(cupWorld.z - plateMid.z)).toBeLessThan(0.1);
    }
  });

  it('BLOCKER A: cup bore and plate-pair midpoint share world-Z within 0.1mm — ASYMMETRIC', () => {
    // W1=1000, W2=600, D1=480, D2=350 → dX≈−0.983, dY≈0.182
    const PA: DiagonalCornerCabinetParams = {
      ...P,
      wallWidth1: 1000, wallWidth2: 600,
      returnDepth1: 480, returnDepth2: 350,
    };
    const out = buildDiagonalCornerCabinet(PA, REGISTRY);

    const doorComp  = out.layout.find(c => c.fileNameSuffix === 'Door')!;
    const stileComp = out.layout.find(c => c.fileNameSuffix === 'Front Stile 1')!;
    const doorPanel  = out.panels.find(p => p.fileNameSuffix === 'Door')!;
    const stilePanel = out.panels.find(p => p.fileNameSuffix === 'Front Stile 1')!;

    const doorDims = {
      length:    (doorPanel.panel.length    as { value: number }).value,
      width:     (doorPanel.panel.width     as { value: number }).value,
      thickness: (doorPanel.panel.thickness as { value: number }).value,
    };
    const stileDims = {
      length:    (stilePanel.panel.length    as { value: number }).value,
      width:     (stilePanel.panel.width     as { value: number }).value,
      thickness: (stilePanel.panel.thickness as { value: number }).value,
    };

    const cupBores   = out.doorBores![0]!.cupBores;
    const plateBores = out.plateBores![0]!.plateBores;
    const hingeCount = cupBores.length;

    for (let i = 0; i < hingeCount; i++) {
      const cup = cupBores[i]!;
      const p0  = plateBores[i * 2]!;
      const p1  = plateBores[i * 2 + 1]!;

      const cupWorld = boreWorldPos(cup, doorDims, 'Bottom', doorComp);
      const midW     = boreWorldPos({ u: (p0.u+p1.u)/2, v: (p0.v+p1.v)/2 }, stileDims, 'Top', stileComp);

      expect(Math.abs(cupWorld.z - midW.z)).toBeLessThan(0.1);
    }
  });
});

// ─── hardware ───────────────────────────────────────────────────────────────

describe('buildDiagonalCornerCabinet — hardware', () => {
  it('emits hinge-35mm-cup-full with hingeCountForHeight(doorH) units (spec §4.7)', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    expect(out.hardware).toEqual([
      { skuId: 'hinge-35mm-cup-full', count: hingeCountForHeight(doorH) },
    ]);
  });
});

// ─── validation ─────────────────────────────────────────────────────────────

describe('buildDiagonalCornerCabinet — validation', () => {
  it('rejects stileWidth <= 0 with stileWidthInvalid (spec §4.2)', () => {
    expect(() => buildDiagonalCornerCabinet({ ...P, stileWidth: 0 }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'stileWidthInvalid' }));
  });

  it('rejects diagonal door too narrow: stileWidth=200 → doorW=76.83 < MIN_DOOR_WIDTH(100) (spec §4.2)', () => {
    // diagLen≈480.83, stileWidth=200 → doorW=480.83−400−4=76.83<100 → throws
    expect(() => buildDiagonalCornerCabinet({ ...P, stileWidth: 200 }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'diagonalDoorTooNarrow' }));
  });

  it('MINOR D: rejects degenerate pentagon (diagLen=0) with diagonalDoorTooNarrow', () => {
    // W1=D2=900, D1=W2=560 → V2=(900,560) coincides with V3=(560,900)?
    // diagLen = sqrt((900−560)²+(560−900)²) ≠ 0. Need W1=D2 AND D1=W2:
    // wallWidth2=560, returnDepth2=900 → D2=900=W1, D1=560=W2 ✓ → diagLen=0
    expect(() => buildDiagonalCornerCabinet(
      { ...P, wallWidth2: 560, returnDepth2: 900 },
      REGISTRY,
    )).toThrow(expect.objectContaining({ kind: 'diagonalDoorTooNarrow' }));
  });

  it('rejects missing carcass material with carcassMaterialMissing', () => {
    expect(() => buildDiagonalCornerCabinet({ ...P, carcassMaterialId: 'nope' }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'carcassMaterialMissing' }));
  });

  it('rejects missing back material with backMaterialMissing', () => {
    expect(() => buildDiagonalCornerCabinet({ ...P, backMaterialId: 'nope' }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'backMaterialMissing' }));
  });
});
