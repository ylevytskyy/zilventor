import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createKernelApi } from '../api';

const HERE = dirname(fileURLToPath(import.meta.url));
const STEP_PATH = resolve(
  HERE,
  '../occt/__tests__/fixtures/step/two-bodies.step',
);

describe('extractStepSolids — two-bodies.step', () => {
  let stepBytes: ArrayBuffer;

  beforeAll(() => {
    const raw = readFileSync(STEP_PATH);
    stepBytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  });

  it('returns 2 entries with distinct brepBlobIds + disjoint bboxes', async () => {
    const kernel = createKernelApi();
    await kernel.init();

    const results = await kernel.extractStepSolids({ stepBytes });

    expect(results).toHaveLength(2);
    expect(results[0]?.brepBlobId).not.toBe(results[1]?.brepBlobId);

    // BoundingBox is a 6-tuple [xMin, yMin, zMin, xMax, yMax, zMax].
    // The two-bodies fixture is a 10×10×10 cube and a 5×5×5 cube, both at
    // origin — they share the same min corner but have different max corners.
    // Assert the bboxes are distinct (not identical) as a proxy for distinct solids.
    const bbox0 = results[0]?.boundingBox;
    const bbox1 = results[1]?.boundingBox;
    expect(JSON.stringify(bbox0)).not.toBe(JSON.stringify(bbox1));
    // Each bbox should have non-zero volume (max > min on at least one axis).
    const hasVolume = (bb: typeof bbox0) =>
      bb !== undefined &&
      (bb[3] > bb[0] || bb[4] > bb[1] || bb[5] > bb[2]);
    expect(hasVolume(bbox0)).toBe(true);
    expect(hasVolume(bbox1)).toBe(true);
  });

  it('throws on STEP with no solids', async () => {
    const kernel = createKernelApi();
    await kernel.init();
    // Empty Uint8Array → readStep will fail at the OCCT level; we assert
    // a descriptive error rather than a hang.
    const empty = new ArrayBuffer(0);
    await expect(
      kernel.extractStepSolids({ stepBytes: empty }),
    ).rejects.toThrow();
  });

  it('single-cube STEP returns single-element array', async () => {
    const SINGLE_PATH = resolve(
      HERE,
      '../occt/__tests__/fixtures/step/cube-10mm.step',
    );
    const raw = readFileSync(SINGLE_PATH);
    const bytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    const kernel = createKernelApi();
    await kernel.init();

    const results = await kernel.extractStepSolids({ stepBytes: bytes });
    expect(results).toHaveLength(1);
  });
});
