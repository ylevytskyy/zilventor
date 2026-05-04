import { describe, it, expect, vi } from 'vitest';

// Mock renderNestSheetPng to return a Blob-like with PNG magic bytes.
// We need .arrayBuffer() to work; use a plain object with the method so we don't
// depend on jsdom Blob.prototype.arrayBuffer (not implemented in jsdom 25).
// NOTE: vi.mock factory is hoisted — no top-level variables allowed inside.
vi.mock('../../nesting/renderNestSheetPng', () => ({
  renderNestSheetPng: vi.fn().mockResolvedValue({
    type: 'image/png',
    size: 8,
    arrayBuffer: () =>
      Promise.resolve(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer,
      ),
  }),
}));

// Mock triggerDownload so no DOM/filesystem side-effects occur.
vi.mock('../../nesting/triggerDownload', () => ({
  triggerDownload: vi.fn().mockResolvedValue(undefined),
}));

import { ExportNestPngCommand } from '../ExportNestPngCommand';
import type { NestSheet } from '@zilventor/shared';
import type { MaterialRegistry } from '@zilventor/shared/src/material';

const sheet: NestSheet = {
  materialId: 'm1',
  sheetIndex: 1,
  sheetLengthMm: 2440,
  sheetWidthMm: 1220,
  utilizationPct: 75.0,
  panels: [],
};

const materials: MaterialRegistry = [
  { id: 'm1', name: 'Birch', defaultThickness: 18, color: '#aabbcc', sheetLengthMm: 2440, sheetWidthMm: 1220 },
];

describe('ExportNestPngCommand', () => {
  it('apply writes globalThis.__zilventorNestPngBytes starting with PNG magic \\x89PNG', async () => {
    delete (globalThis as Record<string, unknown>).__zilventorNestPngBytes;
    const cmd = new ExportNestPngCommand({ sheet, materials });
    await cmd.apply();
    const bytes = (globalThis as { __zilventorNestPngBytes?: Uint8Array }).__zilventorNestPngBytes;
    expect(bytes).toBeDefined();
    expect(bytes!.length).toBeGreaterThan(0);
    // PNG magic: 0x89, 'P', 'N', 'G'
    expect(Array.from(bytes!.slice(0, 4))).toEqual([137, 80, 78, 71]);
  });
});
