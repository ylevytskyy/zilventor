import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExportViyarProFlattenDxfCommand } from '../ExportViyarProFlattenDxfCommand';
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

describe('ExportViyarProFlattenDxfCommand', () => {
  beforeEach(() => { globalThis.__zilventorViyarProDxfBytes = undefined; });

  it('renders the given inputs via renderViyarProFlattenDxf and stashes the bytes on globalThis for e2e capture', async () => {
    await new ExportViyarProFlattenDxfCommand({
      inputs: [input(1, 'Side')],
      suggestedName: 'cabinet-viyarpro.dxf',
    }).apply();
    const bytes = globalThis.__zilventorViyarProDxfBytes;
    expect(bytes?.constructor?.name).toBe('Uint8Array');
    const text = new TextDecoder().decode(bytes!);
    expect(text).toContain('ABF_Flatten');
    expect(text).toContain('Skp_ComponentInstanceName');
  });

  it('delivers a single .dxf via showSaveFilePicker with the given suggestedName', async () => {
    let seenSuggestedName = '';
    let seenTypes: Array<{ accept: Record<string, string[]> }> = [];
    const stub = async (opts: { suggestedName: string; types: Array<{ accept: Record<string, string[]> }> }) => {
      seenSuggestedName = opts.suggestedName;
      seenTypes = opts.types;
      return { createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
    };
    (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = stub;
    try {
      await new ExportViyarProFlattenDxfCommand({
        inputs: [input(1, 'Side')],
        suggestedName: 'cabinet-viyarpro.dxf',
      }).apply();
    } finally {
      delete (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    }
    expect(seenSuggestedName).toBe('cabinet-viyarpro.dxf');
    expect(seenTypes).toEqual([{ description: 'DXF', accept: { 'application/dxf': ['.dxf'] } }]);
  });

  it('falls back to an <a download> click when showSaveFilePicker is unavailable', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await new ExportViyarProFlattenDxfCommand({
      inputs: [input(1, 'Side')],
      suggestedName: 'cabinet-viyarpro.dxf',
    }).apply();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
    const bytes = globalThis.__zilventorViyarProDxfBytes;
    expect(bytes?.constructor?.name).toBe('Uint8Array');
  });
});
