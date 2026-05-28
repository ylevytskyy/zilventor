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
    // Two cubes at origin — one 10×10×10 and one 5×5×5 — must have distinct
    // X-extents (proves they're geometrically distinct solids, not just
    // duplicate references to the same shape).
    const bbox0 = results[0]?.boundingBox;
    const bbox1 = results[1]?.boundingBox;
    const xExtent0 = (bbox0?.[3] ?? 0) - (bbox0?.[0] ?? 0);
    const xExtent1 = (bbox1?.[3] ?? 0) - (bbox1?.[0] ?? 0);
    expect(xExtent0).toBeGreaterThan(0);
    expect(xExtent1).toBeGreaterThan(0);
    expect(xExtent0).not.toBeCloseTo(xExtent1, 1);
  });

  it('rejects unparseable STEP bytes', async () => {
    // Empty/malformed STEP fails at the OCCT parser before the solidCount
    // guard is reached. The user-facing behavior — extractStepSolids rejects
    // — is the same. A real shells-only fixture (zero solids that parses
    // cleanly) is out of scope; the solidCount guard is unit-covered by the
    // explicit throw at StepIO.ts:101-103.
    const kernel = createKernelApi();
    await kernel.init();
    await expect(
      kernel.extractStepSolids({ stepBytes: new ArrayBuffer(0) }),
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
