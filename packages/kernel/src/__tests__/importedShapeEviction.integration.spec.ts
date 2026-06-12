/**
 * K3: importedShapeCache OCCT-safety tests.
 *
 * Documents and tests the safe ownership contract for importedShapeCache:
 *   - deletePart() does NOT evict importedShapeCache (preserves undo/redo for
 *     ImportStepAsComponentCommand / ExplodeIntoAssemblyCommand).
 *   - A bodyRef shared between two parts: deleting one part does NOT break
 *     the other — geometry-invariance oracle confirms the surviving part still
 *     produces correct geometry.
 *   - Clean session: a fresh archive round-trip (save → loadFromBytes) always
 *     succeeds regardless of prior deletions.
 *
 * The intentional non-eviction is documented in api.ts deletePart() with the
 * rationale (undo/redo contract). A future releaseImportedShape() API would
 * provide explicit safe eviction.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKernelApi } from '../api';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '../occt/__tests__/fixtures/step');

describe('K3: importedShapeCache OCCT-safety after deletePart', () => {
  let api: ReturnType<typeof createKernelApi>;
  let cubeBytes: ArrayBuffer;

  beforeAll(async () => {
    api = createKernelApi();
    await api.init();
    const buf = readFileSync(resolve(FIXTURES, 'cube-10mm.step'));
    cubeBytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }, 120_000);

  it('K3-a: after deletePart, loadFromBytes from the same archive succeeds (round-trip integrity)', async () => {
    // Import a STEP, create a part, save it, delete the part, then re-load.
    // The archived .zipt embeds the brep blob — loadFromBytes re-populates the
    // cache from the archive, so execute() must succeed on the re-loaded part.
    const imp = await api.importStep({ stepBytes: cubeBytes, partName: 'Cube-K3a' });
    const partId = await api.createPart('Cube-K3a');
    await api.addFeature(partId, {
      kind: 'imported', id: 'imp-1', sourceStep: 'cube-10mm.step', bodyRef: imp.brepBlobId,
    });
    // Save before deletion so we have bytes to verify round-trip.
    const savedBytes = await api.saveToBytes(partId);

    // Delete the part. Cache entry is intentionally preserved (undo/redo contract).
    await api.deletePart(partId);

    // Load into a fresh API — verifies archive self-sufficiency.
    const api2 = createKernelApi();
    await api2.init();
    const reloadedId = await api2.loadFromBytes(savedBytes);
    const exec = await api2.execute(reloadedId);
    expect(exec.ok).toBe(true);
    if (!exec.ok) throw new Error(`execute after reload failed: ${JSON.stringify(exec.error)}`);
    // cube-10mm.step: bounding box max ≈ 10mm on all axes.
    expect(exec.value.mesh.boundingBox[3]).toBeCloseTo(10, 1);
    expect(exec.value.mesh.boundingBox[4]).toBeCloseTo(10, 1);
    expect(exec.value.mesh.boundingBox[5]).toBeCloseTo(10, 1);
  }, 120_000);

  it('K3-b: deleting one part that shares a bodyRef does NOT corrupt the other part — geometry-invariance oracle', async () => {
    // Two parts share the same brepBlobId (same imported shape).
    // Deleting part A must leave part B fully functional.
    // This is the OCCT-safety invariant: no use-after-free.
    const imp = await api.importStep({ stepBytes: cubeBytes, partName: 'Cube-K3b' });
    const sharedBlobId = imp.brepBlobId;

    const partA = await api.createPart('Cube-K3b-A');
    await api.addFeature(partA, {
      kind: 'imported', id: 'imp-A', sourceStep: 'cube-10mm.step', bodyRef: sharedBlobId,
    });

    const partB = await api.createPart('Cube-K3b-B');
    await api.addFeature(partB, {
      kind: 'imported', id: 'imp-B', sourceStep: 'cube-10mm.step', bodyRef: sharedBlobId,
    });

    // Delete part A — the sharedBlobId must remain alive for part B.
    // (deletePart does NOT evict importedShapeCache regardless of ref-count.)
    await api.deletePart(partA);

    // Geometry-invariance oracle: executing partB must still return a valid 10mm³ cube mesh.
    const exec = await api.execute(partB);
    expect(exec.ok).toBe(true);
    if (!exec.ok) throw new Error(`K3-b: execute on surviving part failed: ${JSON.stringify(exec.error)}`);
    // cube-10mm.step: bounding box max ≈ 10mm on all axes.
    expect(exec.value.mesh.boundingBox[3]).toBeCloseTo(10, 1);
    expect(exec.value.mesh.boundingBox[4]).toBeCloseTo(10, 1);
    expect(exec.value.mesh.boundingBox[5]).toBeCloseTo(10, 1);
    // face count: a cube has 6 faces.
    expect(exec.value.faceNames?.length).toBe(6);
  }, 120_000);

  it('K3-c: full lifecycle (import → part → delete → re-import) produces correct geometry without cross-contamination', async () => {
    // Verify that multiple import/delete cycles in the same API instance don't produce
    // stale geometry on new imports (cache entries are keyed by UUID, never re-used).
    const imp1 = await api.importStep({ stepBytes: cubeBytes, partName: 'Cube-K3c-1' });
    const partC = await api.createPart('Cube-K3c-1');
    await api.addFeature(partC, {
      kind: 'imported', id: 'imp-C', sourceStep: 'cube-10mm.step', bodyRef: imp1.brepBlobId,
    });
    // Execute before deletion to confirm the shape is valid.
    const execBefore = await api.execute(partC);
    expect(execBefore.ok).toBe(true);

    // Delete the sole owner.
    await api.deletePart(partC);

    // Import again (new UUID brepBlobId — no collision with the prior entry).
    const imp2 = await api.importStep({ stepBytes: cubeBytes, partName: 'Cube-K3c-2' });
    expect(imp2.brepBlobId).not.toBe(imp1.brepBlobId); // always distinct UUIDs

    const partD = await api.createPart('Cube-K3c-2');
    await api.addFeature(partD, {
      kind: 'imported', id: 'imp-D', sourceStep: 'cube-10mm.step', bodyRef: imp2.brepBlobId,
    });
    const execFresh = await api.execute(partD);
    expect(execFresh.ok).toBe(true);
    if (!execFresh.ok) throw new Error(`K3-c: fresh execute failed`);
    expect(execFresh.value.mesh.boundingBox[3]).toBeCloseTo(10, 1);
  }, 120_000);
});
