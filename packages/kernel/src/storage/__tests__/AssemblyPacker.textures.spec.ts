import { describe, it, expect } from 'vitest';
import { packAssembly, unpackAssemblyWithTextures } from '../AssemblyPacker';
import type { AssemblyDocument } from '@zilventor/shared';

const baseDoc: AssemblyDocument = {
  id: 'a',
  name: 'A',
  units: 'mm',
  parameters: {},
  components: [],
  constraints: [],
  groundedComponentPaths: [],
  colors: {},
  bomItemNumbers: {},
  cutListItemNumbers: {},
  colorOverrides: {},
  properties: {},
  materials: [],
  hardware: [],
  customTextures: [
    {
      id: 'custom-1',
      name: 'X',
      physicalWidthMm: 1000,
      physicalHeightMm: 1000,
      albedoBlobId: 'tex-a',
    },
  ],
};

describe('AssemblyPacker — custom texture blobs', () => {
  it('packAssembly writes + unpackAssemblyWithTextures returns custom-texture bytes', async () => {
    const bytes = await packAssembly(baseDoc, new Uint8Array(), { 'tex-a': new Uint8Array([5, 6]) });
    const { doc, textures } = await unpackAssemblyWithTextures(bytes);
    expect(doc.customTextures?.[0]?.albedoBlobId).toBe('tex-a');
    expect(Array.from(textures['tex-a']!)).toEqual([5, 6]);
  });

  it('omits textures when none supplied (back-compat)', async () => {
    const noTexDoc: AssemblyDocument = { ...baseDoc, customTextures: [] };
    const bytes = await packAssembly(noTexDoc, new Uint8Array());
    const { textures } = await unpackAssemblyWithTextures(bytes);
    expect(textures).toEqual({});
  });

  it('round-trips multiple texture blob ids (albedo + normal)', async () => {
    const multiDoc: AssemblyDocument = {
      ...baseDoc,
      customTextures: [
        {
          id: 'custom-2',
          name: 'Y',
          physicalWidthMm: 500,
          physicalHeightMm: 500,
          albedoBlobId: 'tex-alb',
          normalBlobId: 'tex-nrm',
        },
      ],
    };
    const albedo = new Uint8Array([0xff, 0xd8, 0xff]);
    const normal = new Uint8Array([1, 2, 3, 4]);
    const bytes = await packAssembly(multiDoc, new Uint8Array(), {
      'tex-alb': albedo,
      'tex-nrm': normal,
    });
    const { doc, textures } = await unpackAssemblyWithTextures(bytes);
    expect(doc.customTextures?.[0]?.normalBlobId).toBe('tex-nrm');
    expect(Array.from(textures['tex-alb']!)).toEqual([0xff, 0xd8, 0xff]);
    expect(Array.from(textures['tex-nrm']!)).toEqual([1, 2, 3, 4]);
  });
});
