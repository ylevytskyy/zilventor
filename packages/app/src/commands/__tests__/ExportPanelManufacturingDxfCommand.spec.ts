import { describe, it, expect, vi } from 'vitest';
import { buildManufacturingZipEntries, ExportPanelManufacturingDxfCommand } from '../ExportPanelManufacturingDxfCommand';
import type { PanelManufacturingInput } from '../../drawing/renderPanelManufacturingDxf';

// jsdom doesn't implement URL.createObjectURL — stub it for the fallback path.
Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:stub'), writable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });

const input = (n: number, name: string): PanelManufacturingInput => ({
  itemNumber: n, partName: name, materialName: 'White 18', qty: 1,
  spec: { length: 800, width: 600, thickness: 18, materialId: 'm', grain: 'length',
    edgeBands: { front: null, back: null, left: null, right: null } } as any,
  bores: [], grooves: [],
});

describe('buildManufacturingZipEntries', () => {
  it('produces one DXF entry per input with item-n-name.dxf filenames', () => {
    const entries = buildManufacturingZipEntries([input(1, 'Side'), input(2, 'Top Shelf')]);
    expect(Object.keys(entries)).toEqual(['item-1-Side.dxf', 'item-2-Top_Shelf.dxf']);
    expect(entries['item-1-Side.dxf']).toContain('OUTLINE');
  });
});

// R1: a panel that failed the panelPreflight check (missing name/material/
// non-manifold/split-required) must surface a user-facing toast at export
// time, not just a console.warn dropped upstream. Mirrors ExportBoringDxfCommand.
describe('ExportPanelManufacturingDxfCommand — R1 preflight diagnostics', () => {
  it('shows a toast for each collected preflight diagnostic', async () => {
    const toasts: string[] = [];
    await new ExportPanelManufacturingDxfCommand({
      inputs: [input(1, 'Side')],
      suggestedName: 'manufacturing.zip',
      diagnostics: [
        { partPath: 'ghost.zipt', reasonKey: 'panel.preflight.missingMaterial', params: { name: 'Ghost' } },
      ],
      showToast: (msg) => toasts.push(msg),
    }).apply();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatch(/Ghost/);
    expect(toasts[0]).toMatch(/material/i);
  });

  it('shows no toast when there are no diagnostics', async () => {
    const toasts: string[] = [];
    await new ExportPanelManufacturingDxfCommand({
      inputs: [input(1, 'Side')],
      suggestedName: 'manufacturing.zip',
      showToast: (msg) => toasts.push(msg),
    }).apply();
    expect(toasts).toHaveLength(0);
  });
});
