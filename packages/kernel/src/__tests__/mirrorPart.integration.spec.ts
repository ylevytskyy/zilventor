import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createKernelApi } from '../api';
import { buildImportedPartDocument } from '../../../app/src/import/buildImportedPartDocument';
// NOTE: do NOT import stepFilenameBasename here — it is unused and will fail tsc/lint

const CUBE_STEP = resolve(
  __dirname,
  '../occt/__tests__/fixtures/step/cube-10mm.step',
);

describe('kernel.mirrorPart (real OCCT)', () => {
  it('mirrors an asymmetric solid: bbox xMax→-xMin, xMin→-xMax', async () => {
    const api = createKernelApi();
    await api.init();

    // 1. Import cube-10mm.step
    const stepRaw = readFileSync(CUBE_STEP);
    const stepBytes = stepRaw.buffer.slice(stepRaw.byteOffset, stepRaw.byteOffset + stepRaw.byteLength);
    const importResult = await api.importStep({ stepBytes, partName: 'cube-src' });
    const srcPart = buildImportedPartDocument('cube-src', importResult.brepBlobId, 'cube-10mm.step');
    await api.registerPart(srcPart);

    // 2. Get source bounding box driven from actual execute output — NOT a constant
    const srcExec = await api.execute(srcPart.id);
    expect(srcExec.ok).toBe(true);
    if (!srcExec.ok) throw new Error('source execute failed');

    // Use the importResult bbox (also real OCCT output) as the source reference
    const srcBbox = importResult.boundingBox; // [xMin, yMin, zMin, xMax, yMax, zMax]
    const [srcXMin, , , srcXMax] = srcBbox;

    // 3. Mirror the part
    const { partId: mirrorPartId } = await api.mirrorPart(srcPart.id);

    // 4. Execute the mirrored part
    const mirExec = await api.execute(mirrorPartId);
    expect(mirExec.ok).toBe(true);
    if (!mirExec.ok) throw new Error('mirrorPart execute failed');

    // 5. Get mirrored bounding box from the tessellated mesh (real OCCT output)
    // mirrorShape(oc, shape, 'yz') reflects X → new xMin = -srcXMax, new xMax = -srcXMin
    const mirBbox = mirExec.value.mesh.boundingBox;
    const [mxMin, , , mxMax] = mirBbox;
    expect(mxMin).toBeCloseTo(-srcXMax!, 4);
    expect(mxMax).toBeCloseTo(-srcXMin!, 4);
  });

  it('mirrorPart: new part id differs from source', async () => {
    const api = createKernelApi();
    await api.init();
    const stepRaw = readFileSync(CUBE_STEP);
    const stepBytes = stepRaw.buffer.slice(stepRaw.byteOffset, stepRaw.byteOffset + stepRaw.byteLength);
    const imp = await api.importStep({ stepBytes, partName: 'cube-src2' });
    const src = buildImportedPartDocument('cube-src2', imp.brepBlobId, 'cube-10mm.step');
    await api.registerPart(src);
    const { partId } = await api.mirrorPart(src.id);
    expect(partId).not.toBe(src.id);
  });

  it('throws if sourcePartId not registered', async () => {
    const api = createKernelApi();
    await api.init();
    await expect(api.mirrorPart('no-such-part')).rejects.toThrow();
  });
});
