import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createKernelApi } from '../api';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '../occt/__tests__/fixtures/step');

describe('splitImportedShape API (integration)', () => {
  let mixedBytes: ArrayBuffer;
  let cubeBytes: ArrayBuffer;

  beforeAll(() => {
    const mixed = readFileSync(resolve(FIXTURES, 'mixed-solid-surface.step'));
    mixedBytes = mixed.buffer.slice(mixed.byteOffset, mixed.byteOffset + mixed.byteLength);

    const cube = readFileSync(resolve(FIXTURES, 'cube-10mm.step'));
    cubeBytes = cube.buffer.slice(cube.byteOffset, cube.byteOffset + cube.byteLength);
  });

  it('mixed-solid-surface.step: importStep → splitImportedShape returns ≥1 solid + non-null surfaces', async () => {
    const kernel = createKernelApi();
    await kernel.init();

    // Import the whole compound.
    const imported = await kernel.importStep({ stepBytes: mixedBytes, partName: 'mix' });
    const { brepBlobId } = imported;

    // Split the cached compound into per-solid blobs + surfaces blob.
    const result = await kernel.splitImportedShape(brepBlobId);

    // Must produce at least one solid.
    expect(result.solids.length).toBeGreaterThanOrEqual(1);

    // Each solid blob must have a distinct brepBlobId (different from input)
    // and a 6-element bounding box.
    for (const solid of result.solids) {
      expect(solid.brepBlobId).not.toBe(brepBlobId);
      expect(solid.brepBlobId).toMatch(/^imp-/);
      expect(solid.boundingBox).toHaveLength(6);
    }

    // surfaces blob must be non-null for the mixed fixture.
    expect(result.surfaces).not.toBeNull();
    expect(result.surfaces!.brepBlobId).not.toBe(brepBlobId);
    expect(result.surfaces!.brepBlobId).toMatch(/^imp-/);
    expect(result.surfaces!.boundingBox).toHaveLength(6);

    // Prove registration: call splitImportedShape on a returned solid blob —
    // it should succeed (it's a single-solid compound, so produces 1 solid + null surfaces).
    const firstSolidId = result.solids[0]!.brepBlobId;
    const reResult = await kernel.splitImportedShape(firstSolidId);
    expect(reResult.solids.length).toBeGreaterThanOrEqual(1);
  });

  it('unknown brepBlobId rejects with a not-in-cache message', async () => {
    const kernel = createKernelApi();
    await kernel.init();

    await expect(
      kernel.splitImportedShape('imp-does-not-exist'),
    ).rejects.toThrow(/not in importedShapeCache/);
  });
});
