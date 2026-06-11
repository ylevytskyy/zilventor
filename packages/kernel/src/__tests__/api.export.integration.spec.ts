import { describe, it, expect } from 'vitest';
import { createKernelApi } from '../api';
import type { ExportLeaf } from '../api';
import { readStep } from '../occt/StepIO';
import { loadOcct } from '../occt/occtLoader';

async function makeBoxPart(api: ReturnType<typeof createKernelApi>, name: string, side: number): Promise<string> {
  const partId = await api.createPart(name);
  await api.setParameter(partId, { name: 'd1', expression: String(side), value: side, unit: 'mm' });
  await api.addFeature(partId, { kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' },
    primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w: side, h: side }], constraints: [] });
  await api.addFeature(partId, { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward', operation: 'new' });
  return partId;
}

describe('KernelApi STEP export', () => {
  it('exportStepPart on an executed part round-trips a 10mm box (mm units, 1 solid)', async () => {
    const api = createKernelApi();
    await api.init();
    const partId = await makeBoxPart(api, 'Box', 10);
    const r = await api.execute(partId); // warms namedShapeCache
    expect(r.ok).toBe(true);

    const bytes = await api.exportStepPart(partId);
    expect(bytes.byteLength).toBeGreaterThan(0);

    const oc = await loadOcct();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const res = readStep(oc, ab);
    expect(res.solidCount).toBe(1);
    // (c) mm proof: span toBeCloseTo(10, 3) — NEVER '>'
    expect(res.boundingBox[3]! - res.boundingBox[0]!).toBeCloseTo(10, 3);
  }, 120_000);

  it('exportStepPart re-executes a COLD namedShapeCache (loadFromBytes warms parts only)', async () => {
    const api = createKernelApi();
    await api.init();
    const partId = await makeBoxPart(api, 'ColdBox', 10);
    await api.execute(partId);
    const archive = await api.saveToBytes(partId);

    // Fresh kernel: loadFromBytes populates `parts` but NOT namedShapeCache → cold.
    const api2 = createKernelApi();
    await api2.init();
    const reloadedId = await api2.loadFromBytes(archive);

    // (a) cold-cache guard: MUST re-execute, not export empty (solidCount === 0 would mean cold-cache exported empty)
    const bytes = await api2.exportStepPart(reloadedId);
    const oc = await loadOcct();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const res = readStep(oc, ab);
    expect(res.solidCount).toBe(1); // cold-cache-empty bug → 0 → RED
    expect(res.boundingBox[3]! - res.boundingBox[0]!).toBeCloseTo(10, 3);
  }, 120_000);
});
