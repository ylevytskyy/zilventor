import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ExportBoringCsvCommand } from '../ExportBoringCsvCommand';
import type { BoringAggregateResult } from '../../assembly/walkers/aggregateBoresRecursive';

// jsdom doesn't implement URL.createObjectURL — stub it for the fallback path.
Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:stub'), writable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });

const result: BoringAggregateResult = {
  panels: [{
    partPath: 'p.zipt', partName: 'Side', qty: 1, componentPathKeys: [],
    length: 600, width: 400, thickness: 18,
    bores: [{
      id: 'b1', face: { featureId: 'panel', role: 'Top', instance: 0 }, u: 100, v: 50, diameter: 5, depth: 34,
      role: 'confirmat-face', connectorId: 'k1', connectorKind: 'confirmat',
    }],
  }],
};

describe('ExportBoringCsvCommand', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__zilventorBoringCsvBytes = undefined;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).showSaveFilePicker;
  });

  it('stashes encoded CSV bytes on globalThis for e2e', async () => {
    await new ExportBoringCsvCommand({ result, suggestedName: 'cab-boring.csv' }).apply();
    const bytes = (globalThis as Record<string, unknown>).__zilventorBoringCsvBytes as Uint8Array;
    expect(bytes?.constructor?.name).toBe('Uint8Array');
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('Panel,Length,Width,Thickness,Tag,Face,X,Y,Ø,Depth,Type');
    expect(text).toContain('Side,600,400,18,b1,Top,100,50,5,34,confirmat');
  });

  it('writes via showSaveFilePicker when available', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    const picker = vi.fn().mockResolvedValue({ createWritable });
    (globalThis as Record<string, unknown>).showSaveFilePicker = picker;
    await new ExportBoringCsvCommand({ result, suggestedName: 'cab-boring.csv' }).apply();
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'cab-boring.csv' }));
    expect(write).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('swallows AbortError when the user cancels the picker', async () => {
    const picker = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }));
    (globalThis as Record<string, unknown>).showSaveFilePicker = picker;
    await expect(
      new ExportBoringCsvCommand({ result, suggestedName: 'cab-boring.csv' }).apply(),
    ).resolves.toBeUndefined();
  });
});
