import { describe, it, expect, vi } from 'vitest';
import { ExportNestPdfCommand } from '../ExportNestPdfCommand';
import type { NestState } from '@zilventor/shared';
import type { MaterialRegistry } from '@zilventor/shared/src/material';

// jsdom doesn't implement URL.createObjectURL — stub it for the fallback path.
Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:stub'), writable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });

const nest: NestState = {
  params: { kerfMm: 3 },
  generatedAt: 0,
  inputFingerprint: 'x',
  sheets: [{
    materialId: 'm1',
    sheetIndex: 1,
    sheetLengthMm: 2440,
    sheetWidthMm: 1220,
    utilizationPct: 0,
    panels: [],
  }],
  excluded: [],
};

const materials: MaterialRegistry = [
  { id: 'm1', name: 'Birch', defaultThickness: 18, color: '#aabbcc', sheetLengthMm: 2440, sheetWidthMm: 1220 },
];

describe('ExportNestPdfCommand', () => {
  it('apply writes globalThis.__zilventorNestPdfBytes and starts with %PDF magic', async () => {
    delete (globalThis as Record<string, unknown>).showSaveFilePicker;
    const cmd = new ExportNestPdfCommand({ nest, materials, suggestedName: 'test.pdf' });
    await cmd.apply();
    const bytes = (globalThis as { __zilventorNestPdfBytes?: Uint8Array }).__zilventorNestPdfBytes;
    expect(bytes).toBeDefined();
    expect(bytes!.length).toBeGreaterThan(0);
    // First 4 bytes of any PDF: '%PDF'
    expect(String.fromCharCode(...bytes!.slice(0, 4))).toBe('%PDF');
  });
});
