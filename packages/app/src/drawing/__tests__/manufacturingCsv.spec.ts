import { describe, it, expect } from 'vitest';
import { buildManufacturingCsv } from '../manufacturingCsv';
import type { PanelManufacturingInput } from '../renderPanelManufacturingDxf';
import type { BoreOp, GrooveFeature, TenonMortiseFeature, KeyholeSlotFeature } from '@zilventor/shared';

const base: PanelManufacturingInput = {
  itemNumber: 1,
  partName: 'SidePanel',
  materialName: 'Egger White 18',
  qty: 2,
  spec: { length: 800, width: 600, thickness: 18, materialId: 'm1', grain: 'length',
    edgeBands: { front: null, back: null, left: null, right: null } } as any,
  bores: [],
  grooves: [],
};

function bore(
  faceRole: string, role: string, u: number, v: number, diameter: number,
  depth: number | 'throughAll', extra: Partial<BoreOp> = {},
): BoreOp {
  const face: BoreOp['face'] = { featureId: 'panel', role: faceRole, instance: 0 };
  return { id: `b-${faceRole}-${u}-${v}`, face, u, v, diameter, depth, role, connectorId: 'c1',
    connectorKind: 'confirmat', ...extra } as unknown as BoreOp;
}

// W7 (docs/superpowers/plans/2026-07-02-p3-machining-presets-cam-metadata.md, D2/S1):
// sidecar CSV — one row per machining operation (bore/groove), reusing the same
// default-layer derivation renderPanelManufacturingDxf.ts uses for the DXF itself.
describe('buildManufacturingCsv', () => {
  it('emits the header row', () => {
    const csv = buildManufacturingCsv([base]);
    expect(csv.split('\n')[0]).toBe('partName,opType,diameter,depth,layer,toolNumber,speed');
  });

  it('emits one row per bore with full CAM fields (toolNumber+speed)', () => {
    const b = bore('Top', 'confirmat-face', 100, 50, 5, 12, { toolNumber: 3, speed: 12000 });
    const csv = buildManufacturingCsv([{ ...base, bores: [b] }]);
    expect(csv).toContain('SidePanel,confirmat-face,5,12,BORES-FRONT-5MM,3,12000');
  });

  it('leaves toolNumber/speed cells empty when absent on a bore', () => {
    const b = bore('Top', 'confirmat-face', 100, 50, 5, 12);
    const csv = buildManufacturingCsv([{ ...base, bores: [b] }]);
    expect(csv).toContain('SidePanel,confirmat-face,5,12,BORES-FRONT-5MM,,');
  });

  it('formats a throughAll bore depth as THROUGH (matches buildBoringCsv convention)', () => {
    const b = bore('Bottom', 'dowel-face', 100, 50, 8, 'throughAll');
    const csv = buildManufacturingCsv([{ ...base, bores: [b] }]);
    expect(csv).toContain('SidePanel,dowel-face,8,THROUGH,BORES-BACK-8MM,,');
  });

  it('emits a groove row with an empty diameter column and depth from the groove', () => {
    const g: GrooveFeature = { kind: 'groove', id: 'g1', faceRole: 'Top', axis: 'u', position: 10, width: 6, depth: 9 };
    const csv = buildManufacturingCsv([{ ...base, grooves: [g] }]);
    expect(csv).toContain('SidePanel,groove,,9,GROOVES,,');
  });

  it('emits a groove row with CAM fields populated', () => {
    const g: GrooveFeature = { kind: 'groove', id: 'g1', faceRole: 'Top', axis: 'u', position: 10, width: 6, depth: 9, toolNumber: 7, speed: 18000 };
    const csv = buildManufacturingCsv([{ ...base, grooves: [g] }]);
    expect(csv).toContain('SidePanel,groove,,9,GROOVES,7,18000');
  });

  it('routes to presetLayerName when set, on both bore and groove', () => {
    const b = bore('Top', 'confirmat-face', 100, 50, 5, 12, { presetLayerName: 'CNC-TOOL-3' });
    const g: GrooveFeature = { kind: 'groove', id: 'g1', faceRole: 'Top', axis: 'u', position: 10, width: 6, depth: 9, presetLayerName: 'CNC-GROOVE-1' };
    const csv = buildManufacturingCsv([{ ...base, bores: [b], grooves: [g] }]);
    expect(csv).toContain('SidePanel,confirmat-face,5,12,CNC-TOOL-3,,');
    expect(csv).toContain('SidePanel,groove,,9,CNC-GROOVE-1,,');
    expect(csv).not.toContain('BORES-FRONT-5MM');
  });

  it('skips a bore whose face role has no flat mapping (matches boreToFlat rejection — absent from the DXF too)', () => {
    const b = bore('Unknown', 'confirmat-face', 100, 50, 5, 12);
    const csv = buildManufacturingCsv([{ ...base, bores: [b] }]);
    expect(csv.trim().split('\n')).toEqual(['partName,opType,diameter,depth,layer,toolNumber,speed']);
  });

  it('skips a groove whose face role is not Top/Bottom (matches grooveRect rejection — absent from the DXF too)', () => {
    const g: GrooveFeature = { kind: 'groove', id: 'g1', faceRole: 'Left', axis: 'u', position: 10, width: 6, depth: 9 };
    const csv = buildManufacturingCsv([{ ...base, grooves: [g] }]);
    expect(csv.trim().split('\n')).toEqual(['partName,opType,diameter,depth,layer,toolNumber,speed']);
  });

  it('quotes a partName containing a comma per RFC 4180 (does not strip Unicode/punctuation like the ASCII DXF-filename sanitizer)', () => {
    const b = bore('Top', 'confirmat-face', 100, 50, 5, 12);
    const csv = buildManufacturingCsv([{ ...base, partName: 'Side, Left', bores: [b] }]);
    expect(csv).toContain('"Side, Left",confirmat-face');
  });

  it('preserves Unicode letters in partName unescaped (no comma/quote/newline present)', () => {
    const b = bore('Top', 'confirmat-face', 100, 50, 5, 12);
    const csv = buildManufacturingCsv([{ ...base, partName: 'Полка', bores: [b] }]);
    expect(csv).toContain('Полка,confirmat-face');
  });

  it('emits a mortise row with an empty diameter column, depth from the feature, and the MORTISES layer', () => {
    const m: TenonMortiseFeature = { kind: 'tenonMortise', id: 'tm1', pairId: 'p1', role: 'mortise',
      faceRole: 'Top', axis: 'u', position: 10, width: 6, depth: 9, count: 1, spacing: 0, fitClearance: 1 };
    const csv = buildManufacturingCsv([{ ...base, tenonMortises: [m] }]);
    expect(csv).toContain('SidePanel,mortise,,9,MORTISES,,');
  });

  it('emits a tenon row with the TENONS layer and CAM fields populated', () => {
    const t: TenonMortiseFeature = { kind: 'tenonMortise', id: 'tm2', pairId: 'p1', role: 'tenon',
      faceRole: 'Right', axis: 'v', position: 100, width: 10, depth: 8, count: 1, spacing: 0,
      fitClearance: 1, toolNumber: 4, speed: 15000 };
    const csv = buildManufacturingCsv([{ ...base, tenonMortises: [t] }]);
    expect(csv).toContain('SidePanel,tenon,,8,TENONS,4,15000');
  });

  it('routes a tenonMortise to presetLayerName when set', () => {
    const m: TenonMortiseFeature = { kind: 'tenonMortise', id: 'tm3', pairId: 'p1', role: 'mortise',
      faceRole: 'Top', axis: 'u', position: 10, width: 6, depth: 9, count: 1, spacing: 0,
      fitClearance: 1, presetLayerName: 'CNC-TENON-1' };
    const csv = buildManufacturingCsv([{ ...base, tenonMortises: [m] }]);
    expect(csv).toContain('SidePanel,mortise,,9,CNC-TENON-1,,');
    expect(csv).not.toContain('MORTISES');
  });

  // P15 Task A: layoutTenonsAlongJoint (AddTenonMortiseCommand.ts) resolves auto-layout to
  // one TenonMortiseFeature carrying a literal count, not N separate features. The DXF
  // renderer already draws one polyline per physical tab (tenonMortiseRects returns one
  // rect per tab); the CSV must emit one row per tab too, not one row per feature.
  it('emits one row per physical tab when count > 1, not one row per feature', () => {
    const t: TenonMortiseFeature = { kind: 'tenonMortise', id: 'tm5', pairId: 'p1', role: 'tenon',
      faceRole: 'Top', axis: 'u', position: 100, width: 10, depth: 8, count: 3, spacing: 30,
      fitClearance: 1 };
    const csv = buildManufacturingCsv([{ ...base, tenonMortises: [t] }]);
    const rows = csv.trim().split('\n').slice(1);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toBe('SidePanel,tenon,,8,TENONS,,');
    }
  });

  it('emits exactly one row for count:1 (regression — no over-counting for the common case)', () => {
    const t: TenonMortiseFeature = { kind: 'tenonMortise', id: 'tm6', pairId: 'p1', role: 'tenon',
      faceRole: 'Top', axis: 'u', position: 100, width: 10, depth: 8, count: 1, spacing: 0,
      fitClearance: 1 };
    const csv = buildManufacturingCsv([{ ...base, tenonMortises: [t] }]);
    const rows = csv.trim().split('\n').slice(1);
    expect(rows).toHaveLength(1);
  });

  it('skips a tenonMortise whose face role is not representable (matches tenonMortiseRects rejection — absent from the DXF too)', () => {
    const m = { kind: 'tenonMortise', id: 'tm4', pairId: 'p1', role: 'mortise',
      faceRole: 'Unknown', axis: 'u', position: 10, width: 6, depth: 9, count: 1, spacing: 0,
      fitClearance: 1 } as unknown as TenonMortiseFeature;
    const csv = buildManufacturingCsv([{ ...base, tenonMortises: [m] }]);
    expect(csv.trim().split('\n')).toEqual(['partName,opType,diameter,depth,layer,toolNumber,speed']);
  });

  // P16: diameter column for opType:'keyholeSlot' is the ENTRY hole's diameter
  // (entryDiameter), not slotWidth — mirrors a bore's diameter column semantics
  // (the round feature you'd tool-select by).
  it('emits a keyholeSlot row with diameter=entryDiameter and depth from the feature', () => {
    const ks: KeyholeSlotFeature = { kind: 'keyholeSlot', id: 'ks1', faceRole: 'Top',
      u: 200, v: 150, axis: 'u', direction: 1, entryDiameter: 15, slotWidth: 10, slotLength: 25, depth: 6 };
    const csv = buildManufacturingCsv([{ ...base, keyholeSlots: [ks] }]);
    expect(csv).toContain('SidePanel,keyholeSlot,15,6,KEYHOLE-SLOTS,,');
  });

  it('emits a keyholeSlot row with CAM fields populated', () => {
    const ks: KeyholeSlotFeature = { kind: 'keyholeSlot', id: 'ks2', faceRole: 'Top',
      u: 200, v: 150, axis: 'u', direction: 1, entryDiameter: 15, slotWidth: 10, slotLength: 25, depth: 6,
      toolNumber: 4, speed: 15000 };
    const csv = buildManufacturingCsv([{ ...base, keyholeSlots: [ks] }]);
    expect(csv).toContain('SidePanel,keyholeSlot,15,6,KEYHOLE-SLOTS,4,15000');
  });

  it('routes a keyholeSlot to presetLayerName when set', () => {
    const ks: KeyholeSlotFeature = { kind: 'keyholeSlot', id: 'ks3', faceRole: 'Top',
      u: 200, v: 150, axis: 'u', direction: 1, entryDiameter: 15, slotWidth: 10, slotLength: 25, depth: 6,
      presetLayerName: 'CNC-KEYHOLE-1' };
    const csv = buildManufacturingCsv([{ ...base, keyholeSlots: [ks] }]);
    expect(csv).toContain('SidePanel,keyholeSlot,15,6,CNC-KEYHOLE-1,,');
    expect(csv).not.toContain('KEYHOLE-SLOTS');
  });

  it('skips a keyholeSlot whose face role is not Top/Bottom (matches keyholeSlotFlat rejection — absent from the DXF too)', () => {
    const ks: KeyholeSlotFeature = { kind: 'keyholeSlot', id: 'ks4', faceRole: 'Left',
      u: 9, v: 150, axis: 'v', direction: 1, entryDiameter: 15, slotWidth: 10, slotLength: 25, depth: 6 };
    const csv = buildManufacturingCsv([{ ...base, keyholeSlots: [ks] }]);
    expect(csv.trim().split('\n')).toEqual(['partName,opType,diameter,depth,layer,toolNumber,speed']);
  });

  // Gap analysis (.vp-native/GAP-ANALYSIS.md §5): PanelSpec.edgeBands already carries
  // {materialId, thickness} per side but machining.csv had no edgeband row at all — the
  // material/thickness ViyarPro's `edges.{side}` kromka object carries was silently dropped.
  it('emits an edgeband row for a banded side with side, materialId, and thickness', () => {
    const banded = { ...base, spec: { ...(base.spec as any), edgeBands: {
      front: { materialId: 'm1', thickness: 0.8 }, back: null, left: null, right: null,
    } } };
    const csv = buildManufacturingCsv([banded as any]);
    expect(csv).toContain('SidePanel,edgeband,front,m1,0.8,,');
  });

  it('emits no edgeband row for a side with no band', () => {
    const banded = { ...base, spec: { ...(base.spec as any), edgeBands: {
      front: { materialId: 'm1', thickness: 0.8 }, back: null, left: null, right: null,
    } } };
    const csv = buildManufacturingCsv([banded as any]);
    const rows = csv.trim().split('\n').slice(1);
    expect(rows).toHaveLength(1); // only the 'front' row — none for back/left/right
  });

  it('covers every panel in the input collection, in order', () => {
    const b1 = bore('Top', 'confirmat-face', 100, 50, 5, 12);
    const b2 = bore('Top', 'confirmat-face', 100, 50, 5, 12);
    const csv = buildManufacturingCsv([
      { ...base, partName: 'PanelA', bores: [b1] },
      { ...base, partName: 'PanelB', bores: [b2] },
    ]);
    const rows = csv.trim().split('\n');
    expect(rows).toHaveLength(3); // header + 2 rows
    expect(rows[1]).toMatch(/^PanelA,/);
    expect(rows[2]).toMatch(/^PanelB,/);
  });
});
