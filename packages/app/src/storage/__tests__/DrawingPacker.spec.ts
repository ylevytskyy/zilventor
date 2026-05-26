// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { packDrawing, unpackDrawing } from '../DrawingPacker';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import type { DrawingDocument } from '@zilventor/shared';

const baseDoc: DrawingDocument = {
  id: 'd1',
  name: 'Cabinet — Drawing',
  units: 'mm',
  source: { partPath: 'parts/cabinet.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [
    {
      id: 's1',
      name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [],
      dimensions: [],
      dimensionGroups: [],
      annotations: [],
      titleBlock: {},
    },
  ],
  activeSheetId: 's1',
};

describe('packDrawing / unpackDrawing', () => {
  it('round-trips a DrawingDocument (pack → unpack recovers equal doc)', async () => {
    const bytes = await packDrawing(baseDoc);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    const recovered = await unpackDrawing(bytes);
    expect(recovered).toEqual(baseDoc);
  });

  it('unpackDrawing rejects an archive with kind !== drawing', async () => {
    // Build a fake archive with kind: 'assembly'
    const manifest = {
      formatVersion: 19,
      kind: 'assembly',
      document: baseDoc,
    };
    const bytes = await writeTarGz([
      { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) },
    ]);
    await expect(unpackDrawing(bytes)).rejects.toThrow(/kind/i);
  });

  it('unpackDrawing rejects a newer formatVersion (future file)', async () => {
    const manifest = {
      formatVersion: 9999,
      kind: 'drawing',
      document: baseDoc,
    };
    const bytes = await writeTarGz([
      { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) },
    ]);
    await expect(unpackDrawing(bytes)).rejects.toThrow(/newer/i);
  });

  it('unpackDrawing rejects garbage bytes', async () => {
    await expect(unpackDrawing(new Uint8Array([0x00, 0x01, 0x02]))).rejects.toThrow();
  });

  it('unpackDrawing rejects archive missing manifest.json', async () => {
    const bytes = await writeTarGz([
      { name: 'not-manifest.txt', data: new TextEncoder().encode('hello') },
    ]);
    await expect(unpackDrawing(bytes)).rejects.toThrow(/manifest/i);
  });
});
