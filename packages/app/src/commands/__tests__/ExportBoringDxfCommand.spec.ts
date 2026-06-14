import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExportBoringDxfCommand } from '../ExportBoringDxfCommand';

// jsdom doesn't implement URL.createObjectURL — stub it for the fallback path.
Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:stub'), writable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });
import type { BoringAggregateResult } from '../../assembly/walkers/aggregateBoresRecursive';

const result: BoringAggregateResult = {
  panels: [
    { partPath: 'side.zipt', partName: 'Side', qty: 1, componentPathKeys: ['k'],
      length: 500, width: 300, thickness: 18,
      bores: [{ id: 'b1', face: { featureId: 'panel', role: 'Front', instance: 0 },
        u: 30, v: 40, diameter: 5, depth: 34, role: 'confirmat-face',
        connectorId: 'c1', connectorKind: 'confirmat' }] },
  ],
};

describe('ExportBoringDxfCommand', () => {
  beforeEach(() => { globalThis.__zilventorBoringDxfBytes = undefined; });

  it('stashes the DXF bytes on globalThis for e2e capture', async () => {
    await new ExportBoringDxfCommand({ result, suggestedName: 'boring.dxf' }).apply();
    const bytes = globalThis.__zilventorBoringDxfBytes;
    expect(bytes?.constructor?.name).toBe('Uint8Array');
    const text = new TextDecoder().decode(bytes!);
    expect(text).toContain('CIRCLE');
    expect(text).toContain('D5_T34');
  });
});
