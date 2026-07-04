import { describe, it, expect } from 'vitest';
import { renderCombinedManufacturingDxf } from '../renderPanelManufacturingDxf';
import type { PanelManufacturingInput } from '../renderPanelManufacturingDxf';
import type { BoreOp } from '@zilventor/shared';
import { parseDxf } from '@zilventor/shared';
import { layoutCombinedGrid } from '../layoutCombinedGrid';

const base: PanelManufacturingInput = {
  itemNumber: 1,
  partName: 'SidePanel',
  materialName: 'Egger White 18',
  qty: 2,
  spec: { length: 800, width: 600, thickness: 18, materialId: 'm1', grain: 'none',
    edgeBands: { front: null, back: null, left: null, right: null } } as any,
  bores: [],
  grooves: [],
};

function bore(role: string, u: number, v: number, diameter: number,
              depth: number | 'throughAll'): BoreOp {
  const face: BoreOp['face'] = { featureId: 'panel', role, instance: 0 };
  return { id: `b-${role}-${u}-${v}`, face, u, v, diameter, depth, role: 'shelfPin-system32' } as BoreOp;
}

/** Extract every LWPOLYLINE on the OUTLINE layer as { minX, minY, w, h }. */
function outlines(dxf: string): Array<{ minX: number; minY: number; w: number; h: number }> {
  const parsed = parseDxf(dxf);
  return parsed.entities
    .filter((e) => e.type === 'LWPOLYLINE' && e.layer === 'OUTLINE')
    .map((e) => {
      const verts = (e as { vertices: Array<{ x: number; y: number }> }).vertices;
      const xs = verts.map((v) => v.x);
      const ys = verts.map((v) => v.y);
      return { minX: Math.min(...xs), minY: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    });
}

/** Raw-text scan of just the TABLE LAYER section's group-2 names (NOT deduped, to test emission count). */
function layerTableNames(dxf: string): string[] {
  const lines = dxf.split('\n');
  const names: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '  0' && lines[i + 1] === 'LAYER') {
      for (let j = i + 2; j < lines.length; j++) {
        if (lines[j] === '  0') break;
        if (lines[j] === '  2') { names.push(lines[j + 1]!); break; }
      }
    }
  }
  return names;
}

describe('renderCombinedManufacturingDxf', () => {
  it('parses as one valid DXF document containing all panel entities', () => {
    const dxf = renderCombinedManufacturingDxf([base, { ...base, itemNumber: 2 }]);
    const parsed = parseDxf(dxf);
    expect(parsed.entities.length).toBeGreaterThan(0);
  });

  it('places N panel outlines at the exact layoutCombinedGrid offsets', () => {
    const inputs = [base, { ...base, itemNumber: 2 }, { ...base, itemNumber: 3, spec: { ...base.spec, length: 400, width: 300 } }];
    const dxf = renderCombinedManufacturingDxf(inputs);
    const expectedOffsets = layoutCombinedGrid(
      inputs.map((i) => ({ width: i.spec.length, height: i.spec.width })),
      50,
    );
    const outs = outlines(dxf);
    expect(outs).toHaveLength(3);
    inputs.forEach((input, i) => {
      const off = expectedOffsets[i]!;
      expect(outs).toContainEqual({ minX: off.x, minY: off.y, w: input.spec.length, h: input.spec.width });
    });
  });

  it('each unit keeps its own INFO label text', () => {
    const dxf = renderCombinedManufacturingDxf([base, { ...base, itemNumber: 7, partName: 'Shelf' }]);
    expect(dxf).toContain('#1 SidePanel');
    expect(dxf).toContain('#7 Shelf');
  });

  it('LAYER table is a deduped union of every layer the units need', () => {
    // base always needs OUTLINE, INFO, DIMENSIONS. withBore additionally needs BORES-FRONT-5MM + BORE-INFO.
    const withBore = { ...base, itemNumber: 2, bores: [bore('Top', 100, 50, 5, 12)] };
    const dxf = renderCombinedManufacturingDxf([base, withBore]);
    const names = layerTableNames(dxf);
    // every name appears exactly once in the LAYER table (real dedup, not just presence)
    expect(names.length).toBe(new Set(names).size);
    expect(names).toContain('OUTLINE');
    expect(names).toContain('INFO');
    expect(names).toContain('DIMENSIONS');
    expect(names).toContain('BORES-FRONT-5MM');
    expect(names).toContain('BORE-INFO');
  });

  it('a panel with a unique bore diameter contributes its layer exactly once even with repeats', () => {
    const withBore = { ...base, itemNumber: 2, bores: [bore('Top', 100, 50, 16, 12), bore('Top', 200, 50, 16, 12)] };
    const dxf = renderCombinedManufacturingDxf([withBore, { ...withBore, itemNumber: 3 }]);
    const names = layerTableNames(dxf);
    expect(names.filter((n) => n === 'BORES-FRONT-16MM')).toHaveLength(1);
  });

  it('does not add layers unrelated units do not need (no GRAIN layer when no unit has grain)', () => {
    const dxf = renderCombinedManufacturingDxf([base, { ...base, itemNumber: 2 }]);
    const names = layerTableNames(dxf);
    expect(names).not.toContain('GRAIN');
  });

  it('a bore presetLayerName is declared in the LAYER table union and carries its XDATA', () => {
    const withPreset = { ...base, itemNumber: 2,
      bores: [{ ...bore('Top', 100, 50, 5, 12), toolNumber: 3, speed: 12000, presetLayerName: 'CNC-TOOL-3' }] };
    const dxf = renderCombinedManufacturingDxf([base, withPreset]);
    const names = layerTableNames(dxf);
    expect(names).toContain('CNC-TOOL-3');
    expect(dxf).toContain('1000\nTOOL_NUMBER');
    expect(dxf).toContain('1000\nSPEED');
  });

  it('under abf scheme, the LAYER table declares ABF outline + bore names, not the stale native ones', () => {
    const withBore = { ...base, itemNumber: 2, bores: [{ ...bore('Top', 100, 50, 5, 12), sku: 'X123' }] };
    const dxf = renderCombinedManufacturingDxf([base, withBore], { layerScheme: 'abf' });
    const names = layerTableNames(dxf);
    expect(names).toContain('ABF_cuttingLines');
    expect(names).toContain('DEPTH12-ARTICLEX123');
    expect(names).not.toContain('OUTLINE');
    expect(names).not.toContain('BORES-FRONT-5MM');
  });
});
