// packages/kernel/src/__tests__/api.customTextures.spec.ts
import { describe, it, expect } from 'vitest';
import { createKernelApi } from '../api';
import { unpackProject } from '../storage/ProjectPacker';

// Bootstrap helper: create a kernel with a simple part that has a valid solid.
async function setupPartWithSolid() {
  const api = createKernelApi();
  await api.init();
  const partId = await api.createPart('TestPart');

  // Minimal sketch + extrude so saveToBytes has a valid solid.
  await api.setParameter(partId, { name: 'd1', expression: '10', value: 10, unit: 'mm' });
  await api.addFeature(partId, {
    kind: 'sketch', id: 's1',
    plane: { source: 'workPlane', featureId: 'origin.XY' },
    primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 }],
    constraints: [],
  });
  await api.addFeature(partId, {
    kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1',
    direction: 'forward', operation: 'new',
  });
  await api.execute(partId);

  return { api, partId };
}

describe('KernelApi.customTextures', () => {
  it('saveToBytes embeds registered custom-texture bytes + customTextures metadata', async () => {
    const { api, partId } = await setupPartWithSolid();

    await api.registerCustomTexture('tex-a', new Uint8Array([7, 7, 7]));
    await api.setCustomTextures(partId, [{
      id: 'custom-1', name: 'Mine', physicalWidthMm: 1000, physicalHeightMm: 1000,
      albedoBlobId: 'tex-a',
    }]);

    const bytes = await api.saveToBytes(partId);
    const { manifest, textures } = await unpackProject(bytes);
    expect((manifest as any).document.customTextures[0].id).toBe('custom-1');
    expect(Array.from(textures!['tex-a']!)).toEqual([7, 7, 7]);
  }, 60_000);

  it('loadFromBytes restores custom-texture bytes into the registry (round-trip)', async () => {
    const { api, partId } = await setupPartWithSolid();

    // Register a texture with 2 maps.
    const albedoBytes = new Uint8Array([0xff, 0xd8, 0x01, 0x02]);
    const normalBytes = new Uint8Array([0x10, 0x20, 0x30]);
    await api.registerCustomTexture('tex-alb', albedoBytes);
    await api.registerCustomTexture('tex-nrm', normalBytes);
    await api.setCustomTextures(partId, [{
      id: 'custom-rt', name: 'RoundTrip', physicalWidthMm: 800, physicalHeightMm: 600,
      albedoBlobId: 'tex-alb', normalBlobId: 'tex-nrm',
    }]);

    // Save to bytes.
    const savedBytes = await api.saveToBytes(partId);

    // Load into a FRESH kernel instance.
    const api2 = createKernelApi();
    await api2.init();
    const loadedId = await api2.loadFromBytes(savedBytes);

    // Save again from the fresh instance — texture bytes must survive the reload.
    const savedAgain = await api2.saveToBytes(loadedId);
    const { manifest, textures } = await unpackProject(savedAgain);

    // Metadata survived.
    const doc = (manifest as any).document;
    expect(doc.customTextures).toHaveLength(1);
    expect(doc.customTextures[0].id).toBe('custom-rt');
    expect(doc.customTextures[0].normalBlobId).toBe('tex-nrm');

    // Bytes survived byte-identically through the reload cycle.
    expect(Array.from(textures!['tex-alb']!)).toEqual(Array.from(albedoBytes));
    expect(Array.from(textures!['tex-nrm']!)).toEqual(Array.from(normalBytes));
  }, 60_000);

  it('registerCustomTexture throws on unknown partId', async () => {
    const api = createKernelApi();
    await api.init();
    await expect(
      api.setCustomTextures('nonexistent', [])
    ).rejects.toThrow(/setCustomTextures: unknown partId/);
  });

  it('saveToBytes throws when a referenced texture blob is not in registry', async () => {
    const { api, partId } = await setupPartWithSolid();

    // Set customTextures referencing a blob that was never registered.
    await api.setCustomTextures(partId, [{
      id: 'custom-x', name: 'X', physicalWidthMm: 1000, physicalHeightMm: 1000,
      albedoBlobId: 'missing-blob',
    }]);

    await expect(api.saveToBytes(partId)).rejects.toThrow(/saveToBytes: custom texture blob missing-blob not in registry/);
  }, 60_000);
});
