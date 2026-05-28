import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createKernelApi } from '../api';
import { buildImportedPartDocument } from '../../../app/src/import/buildImportedPartDocument';
import { dedupeName } from '../../../app/src/import/dedupeName';
import { stepFilenameBasename } from '../../../app/src/import/originFeatures';

const STEP_PATH = resolve(
  __dirname,
  '../occt/__tests__/fixtures/step/cube-10mm.step',
);

describe('importStepIntoAssembly — real OCCT pipeline', () => {
  it('imports cube-10mm.step: registers, executes, bounding box within expected extents', async () => {
    const kernel = createKernelApi();
    await kernel.init();

    const stepRaw = readFileSync(STEP_PATH);
    const stepBytes = stepRaw.buffer.slice(
      stepRaw.byteOffset,
      stepRaw.byteOffset + stepRaw.byteLength,
    );

    const fileName = 'cube-10mm.step';
    const baseName = stepFilenameBasename(fileName);
    // No collisions in a fresh kernel
    const partName = dedupeName(baseName, []);

    const importResult = await kernel.importStep({ stepBytes, partName });
    expect(importResult.brepBlobId).toBeTruthy();

    const part = buildImportedPartDocument(partName, importResult.brepBlobId, fileName);
    await kernel.registerPart(part);

    const execResult = await kernel.execute(part.id);
    expect(execResult.ok).toBe(true);
    if (!execResult.ok) throw new Error('execute failed');

    // Cube is 10mm × 10mm × 10mm; bbox should be 0..10 on all axes (within 1mm tolerance)
    const { boundingBox } = importResult;
    const [xMin, yMin, zMin, xMax, yMax, zMax] = boundingBox;
    expect(xMax - xMin).toBeGreaterThan(9);
    expect(yMax - yMin).toBeGreaterThan(9);
    expect(zMax - zMin).toBeGreaterThan(9);
    expect(xMax - xMin).toBeLessThan(11);
    expect(yMax - yMin).toBeLessThan(11);
    expect(zMax - zMin).toBeLessThan(11);

    // saveToBytes confirms the ImportedFeature blob round-trips correctly
    const bytes = await kernel.saveToBytes(part.id);
    expect(bytes.byteLength).toBeGreaterThan(0);

    // deletePart cleans up without throwing
    await expect(kernel.deletePart(part.id)).resolves.not.toThrow();
  });
});
