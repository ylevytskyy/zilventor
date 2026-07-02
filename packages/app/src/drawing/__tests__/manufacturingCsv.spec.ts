import { describe, it, expect } from 'vitest';
import { buildManufacturingCsv } from '../manufacturingCsv';
import type { PanelManufacturingInput } from '../renderPanelManufacturingDxf';
import type { BoreOp, GrooveFeature } from '@zilventor/shared';

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
