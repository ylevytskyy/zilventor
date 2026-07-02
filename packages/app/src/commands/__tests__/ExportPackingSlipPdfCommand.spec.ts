import { describe, it, expect, vi } from 'vitest';
import { ExportPackingSlipPdfCommand } from '../ExportPackingSlipPdfCommand';
import type { PackingSlipRow } from '../../production/buildPackingSlipRows';

// jsdom doesn't implement URL.createObjectURL — stub it for the fallback path.
Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:stub'), writable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });

const rows: PackingSlipRow[] = [{
  itemNumber: 1,
  partName: 'Side Panel',
  materialName: 'Birch',
  length: 600,
  width: 300,
  thickness: 18,
  qty: 5,
  producedCount: 2,
  remainingCount: 3,
}];

describe('ExportPackingSlipPdfCommand', () => {
  it('apply writes globalThis.__zilventorPackingSlipPdfBytes and starts with %PDF magic', async () => {
    delete (globalThis as Record<string, unknown>).showSaveFilePicker;
    const cmd = new ExportPackingSlipPdfCommand({ rows, suggestedName: 'test.pdf' });
    await cmd.apply();
    const bytes = (globalThis as { __zilventorPackingSlipPdfBytes?: Uint8Array }).__zilventorPackingSlipPdfBytes;
    expect(bytes).toBeDefined();
    expect(bytes!.length).toBeGreaterThan(0);
    expect(String.fromCharCode(...bytes!.slice(0, 4))).toBe('%PDF');
  });
});
