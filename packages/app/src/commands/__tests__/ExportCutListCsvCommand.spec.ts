import { describe, expect, it, vi } from 'vitest';
import { ExportCutListCsvCommand } from '../ExportCutListCsvCommand';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';

const empty: CutListResult = { rows: [], bandTotals: [], excluded: { componentCount: 0, partCount: 0 } };

// jsdom doesn't implement URL.createObjectURL — stub it for the fallback path.
Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:stub'), writable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });

describe('ExportCutListCsvCommand', () => {
  it('captures CSV bytes via __zilventorCutListCsvBytes', async () => {
    // showSaveFilePicker not present in jsdom; falls back to <a download> path.
    const cmd = new ExportCutListCsvCommand({ result: empty, suggestedName: 'a-cutlist.csv' });
    await cmd.apply();
    const bytes = (globalThis as { __zilventorCutListCsvBytes?: Uint8Array }).__zilventorCutListCsvBytes;
    expect(bytes?.constructor?.name).toBe('Uint8Array');
    expect(new TextDecoder().decode(bytes!)).toContain('Item#,QTY,Material');
  });

  it('silent no-op when user cancels showSaveFilePicker', async () => {
    const aborted = Object.assign(new Error('AbortError'), { name: 'AbortError' });
    (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = vi.fn().mockRejectedValue(aborted);
    const cmd = new ExportCutListCsvCommand({ result: empty, suggestedName: 'a-cutlist.csv' });
    await expect(cmd.apply()).resolves.toBeUndefined();
    delete (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
});
