import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PartDocument } from '@zilventor/shared';
import { createKernelApi } from '../api';

const ORIGIN_FEATURES: PartDocument['featureTree'] = [
  { kind: 'workAxis',  id: 'origin.X',  visible: false, source: { mode: 'origin', axis: 'X' } },
  { kind: 'workAxis',  id: 'origin.Y',  visible: false, source: { mode: 'origin', axis: 'Y' } },
  { kind: 'workAxis',  id: 'origin.Z',  visible: false, source: { mode: 'origin', axis: 'Z' } },
  { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
  { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } },
  { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } },
  { kind: 'workPoint', id: 'origin.O',  visible: false, source: { mode: 'origin' } },
];

describe('kernel.registerPart (integration)', () => {
  it('makes a stand-alone-STEP part executable end-to-end', async () => {
    const api = createKernelApi();
    await api.init();

    // 1. Ingest the cube STEP — this populates the importedShapeCache.
    const stepBytes = readFileSync(resolve(__dirname, '../occt/__tests__/fixtures/step/cube-10mm.step'));
    const importResult = await api.importStep({
      stepBytes: stepBytes.buffer.slice(stepBytes.byteOffset, stepBytes.byteOffset + stepBytes.byteLength),
      partName: 'cube-10mm',
    });
    expect(importResult.brepBlobId).toMatch(/^imp-/);
    expect(importResult.faceCount).toBe(6);

    // 2. Build a PartDocument referencing the cached blob.
    const part: PartDocument = {
      id: crypto.randomUUID(),
      name: 'cube-10mm',
      units: 'mm',
      parameters: {},
      featureTree: [
        ...ORIGIN_FEATURES,
        { kind: 'imported', id: 'imp.body', sourceStep: 'cube-10mm.step', bodyRef: importResult.brepBlobId },
      ],
      properties: {},
      materials: [],
      hardware: [],
    };

    // 3. Register and verify getPart round-trips.
    await api.registerPart(part);
    const fetched = await api.getPart(part.id);
    expect(fetched.id).toBe(part.id);
    expect(fetched.featureTree).toHaveLength(8);

    // 4. Execute — should produce a non-empty NamedShape (6-face cube).
    const result = await api.execute(part.id);
    expect(result.ok).toBe(true);
  });

  it('throws if the kernel is not initialized', async () => {
    const api = createKernelApi();
    // Skip init() deliberately.
    const part: PartDocument = {
      id: 'p1', name: 'x', units: 'mm', parameters: {},
      featureTree: [...ORIGIN_FEATURES],
      properties: {}, materials: [], hardware: [],
    };
    await expect(api.registerPart(part)).rejects.toThrow(/not initialized/);
  });

  it('throws on duplicate part id', async () => {
    const api = createKernelApi();
    await api.init();

    const part: PartDocument = {
      id: 'p-dup-test', name: 'dup', units: 'mm', parameters: {},
      featureTree: [...ORIGIN_FEATURES],
      properties: {}, materials: [], hardware: [],
    };

    await api.registerPart(part);
    await expect(api.registerPart(part)).rejects.toThrow(/already registered/);
  });
});
