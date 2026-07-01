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

// R1: a bored panel that failed the panelPreflight check (missing name/material/
// non-manifold/split-required) must surface a user-facing toast at export time,
// not just a console.warn dropped by the walker.
describe('ExportBoringDxfCommand — R1 preflight diagnostics', () => {
  it('shows a toast for each collected preflight diagnostic', async () => {
    const resultWithDiagnostics: BoringAggregateResult = {
      ...result,
      diagnostics: [
        { partPath: 'side.zipt', reasonKey: 'panel.preflight.missingMaterial', params: { name: 'Side' } },
      ],
    };
    const toasts: string[] = [];
    await new ExportBoringDxfCommand({
      result: resultWithDiagnostics,
      suggestedName: 'boring.dxf',
      showToast: (msg) => toasts.push(msg),
    }).apply();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatch(/Side/);
    expect(toasts[0]).toMatch(/material/i);
  });

  it('shows no toast when the result has no diagnostics', async () => {
    const toasts: string[] = [];
    await new ExportBoringDxfCommand({
      result,
      suggestedName: 'boring.dxf',
      showToast: (msg) => toasts.push(msg),
    }).apply();
    expect(toasts).toHaveLength(0);
  });
});
