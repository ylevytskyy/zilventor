import { describe, expect, it, vi } from 'vitest';
import { ImportFromInventorCommand } from '../ImportFromInventorCommand';

describe('ImportFromInventorCommand', () => {
  it('apply() runs the importer with the picked input/target and stores the summary', async () => {
    const inputHandle = { kind: 'directory' } as any;
    const targetHandle = { kind: 'directory' } as any;
    const summary = { partsImported: 1, assembliesImported: 0, skipped: 0, errors: [] };
    const runImport = vi.fn(async () => summary);
    const cmd = new ImportFromInventorCommand({
      pickInput: async () => inputHandle,
      pickTarget: async () => targetHandle,
      conflict: 'skip',
      kernel: {} as any,
      runImport,
    });
    await cmd.apply();
    expect(runImport).toHaveBeenCalledTimes(1);
    expect(runImport).toHaveBeenCalledWith(expect.objectContaining({
      input: inputHandle, target: targetHandle, conflict: 'skip',
    }));
    expect(cmd.summary).toEqual(summary);
  });

  it('apply() throws when the input picker is cancelled and never calls the target picker', async () => {
    const pickTarget = vi.fn(async () => ({ kind: 'directory' } as any));
    const cmd = new ImportFromInventorCommand({
      pickInput: async () => { throw new DOMException('aborted', 'AbortError'); },
      pickTarget,
      conflict: 'skip',
      kernel: {} as any,
      runImport: async () => ({ partsImported: 0, assembliesImported: 0, skipped: 0, errors: [] }),
    });
    await expect(cmd.apply()).rejects.toThrow(/abort/i);
    expect(pickTarget).not.toHaveBeenCalled();
  });

  it('apply() forwards onProgress when supplied', async () => {
    const events: { current: number; total: number; path: string }[] = [];
    const runImport = vi.fn(async (args: any) => {
      args.onProgress?.({ current: 1, total: 1, path: 'x.ipt.json' });
      return { partsImported: 1, assembliesImported: 0, skipped: 0, errors: [] };
    });
    const cmd = new ImportFromInventorCommand({
      pickInput: async () => ({ kind: 'directory' } as any),
      pickTarget: async () => ({ kind: 'directory' } as any),
      conflict: 'overwrite',
      kernel: {} as any,
      runImport,
      onProgress: (p) => events.push(p),
    });
    await cmd.apply();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ current: 1, total: 1, path: 'x.ipt.json' });
  });

  it('revert() is a no-op (bulk OPFS writes are non-undoable)', async () => {
    const cmd = new ImportFromInventorCommand({
      pickInput: async () => ({ kind: 'directory' } as any),
      pickTarget: async () => ({ kind: 'directory' } as any),
      conflict: 'skip',
      kernel: {} as any,
      runImport: async () => ({ partsImported: 0, assembliesImported: 0, skipped: 0, errors: [] }),
    });
    // No-throw is the contract.
    await expect(cmd.revert()).resolves.toBeUndefined();
  });

  it('exposes name = "ImportFromInventor"', () => {
    const cmd = new ImportFromInventorCommand({
      pickInput: async () => ({ kind: 'directory' } as any),
      pickTarget: async () => ({ kind: 'directory' } as any),
      conflict: 'skip',
      kernel: {} as any,
      runImport: async () => ({ partsImported: 0, assembliesImported: 0, skipped: 0, errors: [] }),
    });
    expect(cmd.name).toBe('ImportFromInventor');
  });
});
