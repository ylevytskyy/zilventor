/**
 * TDD test suite for buildDiagonalCornerCabinet (Task 5 — M4 Slice E).
 *
 * All numeric values are DERIVED FROM SPEC §4 of
 * docs/superpowers/specs/2026-06-26-m4-sliceE-blind-diagonal-corner-cabinets-design.md
 *
 * DISCREPANCY NOTE: The task-5-brief.md uses W1=W2=600, D1=D2=560 which produces
 * diagLen≈56.57mm — invalid with stileWidth=50 (doorW<0). The spec §4.3 formula
 * gives the correct diagLen. Corrected params: W1=W2=900, D1=D2=560 → diagLen=340√2≈480.83mm.
 */
import { describe, it, expect } from 'vitest';
import type { MaterialEntry } from '../../material';
import { buildDiagonalCornerCabinet } from '../diagonalCornerCabinet';
import type { DiagonalCornerCabinetParams } from '../types';
import { hingeCountForHeight, CUP_SETBACK } from '../../hingeMath';
import { DEFAULT_DOOR_THICKNESS, DEFAULT_REVEAL } from '../../doorMath';

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
const thetaDeg = Math.atan2(dY, dX) * 180 / Math.PI; // 135°

// spec §4.6 — stile plate-bore v setback
const frontSetback = Td + (CUP_SETBACK['full'] - Tc / 2); // 18 + (21 − 9) = 30

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
  it('stile 1 rz = θ ≈ 135° for symmetric params (spec §4.3 + §4.4)', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const stile1 = out.layout.find(c => c.fileNameSuffix === 'Front Stile 1')!;
    expect(stile1).toBeDefined();
    expect(stile1.rotation.rz).toBeCloseTo(thetaDeg, 1); // 135°
  });

  it('stile 2 also has rz = θ', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const stile2 = out.layout.find(c => c.fileNameSuffix === 'Front Stile 2')!;
    expect(stile2.rotation.rz).toBeCloseTo(thetaDeg, 1);
  });

  it('door layout entry has non-zero rz encoding the diagonal angle (spec §4.4)', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const doorComp = out.layout.find(c => c.fileNameSuffix === 'Door')!;
    expect(doorComp).toBeDefined();
    expect(doorComp.rotation.rz).not.toBe(0);
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

  it('rejects missing carcass material with carcassMaterialMissing', () => {
    expect(() => buildDiagonalCornerCabinet({ ...P, carcassMaterialId: 'nope' }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'carcassMaterialMissing' }));
  });

  it('rejects missing back material with backMaterialMissing', () => {
    expect(() => buildDiagonalCornerCabinet({ ...P, backMaterialId: 'nope' }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'backMaterialMissing' }));
  });
});
