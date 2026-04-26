import { describe, it, expect } from 'vitest';
import { packAssembly, unpackAssembly } from '../AssemblyPacker';
import { packProject } from '../ProjectPacker';
import type { AssemblyDocument } from '@zilventor/shared';

describe('AssemblyPacker', () => {
  const doc: AssemblyDocument = {
    id: 'A1',
    name: 'cabinet',
    units: 'mm',
    parameters: {},
    components: [
      {
        id: 'C1',
        partPath: 'leg.zipt',
        position: { x: 0, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      },
    ],
    constraints: [],
    groundedComponentIds: [],
    colors: {},
    bomItemNumbers: {},
  };
  const thumb = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  it('round-trips an AssemblyDocument', async () => {
    const bytes = await packAssembly(doc, thumb);
    const out = await unpackAssembly(bytes);
    expect(out).toEqual(doc);
  });

  it('round-trips colors palette, bomItemNumbers, and per-component color', async () => {
    const richDoc: AssemblyDocument = {
      id: 'A2',
      name: 'cabinet',
      units: 'mm',
      parameters: {},
      components: [
        {
          id: 'C1', partPath: 'parts/cube.zipt',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true,
          color: { kind: 'palette', name: 'Maple' },
        },
        {
          id: 'C2', partPath: 'parts/cube.zipt',
          position: { x: 1, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true,
          color: { kind: 'hex', hex: '#cc8866' },
        },
      ],
      constraints: [],
      groundedComponentIds: ['C1'],
      colors: { Maple: '#d4a574' },
      bomItemNumbers: {
        'parts/cube.zipt::palette:Maple': 1,
        'parts/cube.zipt::hex:#cc8866': 2,
      },
    };
    const bytes = await packAssembly(richDoc, thumb);
    const out = await unpackAssembly(bytes);
    expect(out.colors).toEqual({ Maple: '#d4a574' });
    expect(out.bomItemNumbers['parts/cube.zipt::palette:Maple']).toBe(1);
    expect(out.bomItemNumbers['parts/cube.zipt::hex:#cc8866']).toBe(2);
    expect(out.components[0]!.color).toEqual({ kind: 'palette', name: 'Maple' });
    expect(out.components[1]!.color).toEqual({ kind: 'hex', hex: '#cc8866' });
  });


  it('rejects an archive whose manifest has kind: part', async () => {
    // Build a part archive using packProject with kind: 'part' in manifest
    const partBytes = await packProject({
      manifest: { formatVersion: 7, kind: 'part', document: {} },
      blobs: {},
      thumbnail: thumb,
    });
    await expect(unpackAssembly(partBytes)).rejects.toThrow(/kind/i);
  });

  it('reports a structured error on malformed data', async () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02]);
    await expect(unpackAssembly(garbage)).rejects.toThrow();
  });
});
