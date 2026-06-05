import { describe, it, expect, beforeAll } from 'vitest';
import { createKernelApi } from '../api';
import { loadOcct } from '../occt/occtLoader';
import type { OcctInstance } from '../occt/occtLoader';
import { makeColoredBoxStepBytes } from '../occt/__tests__/stepColor.helper';

describe('importStep + splitImportedShape color round-trip', () => {
  let oc: OcctInstance;
  beforeAll(async () => { oc = await loadOcct(); }, 120_000);

  it('split returns per-solid color extracted at import time', async () => {
    const kernel = createKernelApi();
    await kernel.init();
    const bytes = makeColoredBoxStepBytes(oc, ['#ff0000', '#00ff00']);
    const { brepBlobId, solidCount } = await kernel.importStep({ stepBytes: bytes, partName: 'boxes' });
    expect(solidCount).toBe(2);
    const { solids } = await kernel.splitImportedShape(brepBlobId);
    expect(solids).toHaveLength(2);
    expect(solids.map((s) => s.color).filter(Boolean).sort()).toEqual(['#00ff00', '#ff0000']);
  });
});
