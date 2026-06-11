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

  // ---- Phase 4: assembly + color-loss-trap guard ----

  it('exportStepAssembly: posed 2-component / 2-color assembly — BOTH colors survive + posed min-corner', async () => {
    const api = createKernelApi();
    await api.init();
    // Two registered parts (both executed → namedShapeCache warm).
    const redId = await makeBoxPart(api, 'Red', 10);
    const grnId = await makeBoxPart(api, 'Green', 10);
    await api.execute(redId);
    await api.execute(grnId);

    // Red at origin (identity); Green translated +50 along X. Different colors.
    const leaves: ExportLeaf[] = [
      { partId: redId, name: 'Red',   pose: { translation: { x: 0,  y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const },  color: [1, 0, 0] as const },
      { partId: grnId, name: 'Green', pose: { translation: { x: 50, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const },  color: [0, 1, 0] as const },
    ];
    const bytes = await api.exportStepAssembly(leaves);

    const oc = await loadOcct();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const res = readStep(oc, ab);

    // (a) solidCount FIRST — a cold/empty export shows 0 → RED before colors.
    expect(res.solidCount).toBe(2);
    // (b) the color-loss-trap signature: BOTH distinct colors survive (the bug drops all but the first).
    // sRGB-as-is, lowercase.
    expect(res.solidColors.filter(Boolean).sort()).toEqual(['#00ff00', '#ff0000']);
    // (c) pose lives in transform → posed bbox spans 0..60 (red 0..10, green 50..60).
    expect(res.boundingBox[0]!).toBeCloseTo(0, 3);   // red min-corner X
    expect(res.boundingBox[3]!).toBeCloseTo(60, 3);  // green max-corner X (50+10)
  }, 180_000);

  it('exportStepAssembly: 2 instances of ONE part → 2 posed components with distinct bboxes', async () => {
    const api = createKernelApi();
    await api.init();
    const boxId = await makeBoxPart(api, 'Box', 10);
    await api.execute(boxId);

    // Same partId used twice (protoKey = partId).
    const leaves: ExportLeaf[] = [
      { partId: boxId, name: 'A', pose: { translation: { x: 0,  y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const } },
      { partId: boxId, name: 'B', pose: { translation: { x: 30, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const } },
    ];
    const bytes = await api.exportStepAssembly(leaves);

    const oc = await loadOcct();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const res = readStep(oc, ab);
    // Two distinct posed instances of the same part.
    expect(res.solidCount).toBe(2);
    expect(res.boundingBox[0]!).toBeCloseTo(0, 3);
    expect(res.boundingBox[3]!).toBeCloseTo(40, 3); // B at 30..40
  }, 180_000);
});
