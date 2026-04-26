import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExportBomCsvCommand } from '../ExportBomCsvCommand';
import { useAppStore } from '../../store/useAppStore';

describe('ExportBomCsvCommand', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeAssembly: {
        id: 'A', name: 'demo', units: 'mm', parameters: {},
        components: [
          { id: 'C1', partPath: 'parts/cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        ],
        constraints: [], groundedComponentIds: [],
        colors: {}, bomItemNumbers: {},
      },
    } as any);
  });

  it('writes the CSV through showSaveFilePicker when available', async () => {
    const writes: Uint8Array[] = [];
    const mockHandle = {
      createWritable: async () => ({
        write: async (b: Uint8Array) => { writes.push(b); },
        close: async () => {},
      }),
    };
    (globalThis as any).showSaveFilePicker = vi.fn(async (_opts: any) => mockHandle);
    try {
      await new ExportBomCsvCommand({ partNames: new Map([['parts/cube.zipt', 'cube']]) }).apply();
      expect(writes).toHaveLength(1);
      const csv = new TextDecoder().decode(writes[0]!);
      expect(csv).toContain('Item#,QTY,Part Name,Color,Part Path');
      expect(csv).toContain('1,1,cube,,parts/cube.zipt');
    } finally {
      delete (globalThis as any).showSaveFilePicker;
    }
  });

  it('silently no-ops when the user cancels the save dialog', async () => {
    (globalThis as any).showSaveFilePicker = vi.fn(async () => { throw new DOMException('cancelled', 'AbortError'); });
    try {
      await expect(new ExportBomCsvCommand({ partNames: new Map([['parts/cube.zipt', 'cube']]) }).apply()).resolves.toBeUndefined();
    } finally {
      delete (globalThis as any).showSaveFilePicker;
    }
  });
});
