import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeBox } from '../SolidOps';
import { readStep } from '../StepIO';
import { exportStepDoc, IDENTITY_POSE, type KernelExportLeaf } from '../StepExport';

describe('exportStepDoc — XCAF STEP write core', () => {
  let oc: OcctInstance;
  beforeAll(async () => { oc = await loadOcct(); }, 120_000);

  it('writes a single 10mm box that round-trips through readStep with correct mm units', () => {
    const box = makeBox(oc, 10, 10, 10); // [0,10]^3 — span proves mm, not cm/m
    const leaves: KernelExportLeaf[] = [
      { shape: box, protoKey: 'p1', name: 'Box10', pose: IDENTITY_POSE },
    ];
    const bytes = exportStepDoc(oc, leaves);
    expect(bytes.byteLength).toBeGreaterThan(0);

    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const res = readStep(oc, ab);
    expect(res.solidCount).toBe(1);                        // cold/empty export would be 0 → RED
    const span = res.boundingBox[3]! - res.boundingBox[0]!;
    expect(span).toBeCloseTo(10, 3);                       // PROVES mm — never `>`
    expect(res.boundingBox[4]! - res.boundingBox[1]!).toBeCloseTo(10, 3);
    expect(res.boundingBox[5]! - res.boundingBox[2]!).toBeCloseTo(10, 3);
  }, 120_000);

  it('round-trips a single surface color (sRGB) on a part label', () => {
    const box = makeBox(oc, 10, 10, 10);
    const leaves: KernelExportLeaf[] = [
      { shape: box, protoKey: 'p1', name: 'Red', pose: IDENTITY_POSE,
        color: [1, 0, 0] },
    ];
    const bytes = exportStepDoc(oc, leaves);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const res = readStep(oc, ab);
    expect(res.solidCount).toBe(1);
    expect(res.solidColors.filter(Boolean)).toEqual(['#ff0000']); // sRGB-as-is, lowercase
  }, 120_000);
});
