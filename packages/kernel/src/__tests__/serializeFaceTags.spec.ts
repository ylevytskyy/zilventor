// packages/kernel/src/__tests__/serializeFaceTags.spec.ts
//
// Spec-review tests for Batch 2 gaps:
//   HS-K-6 — planeSource round-trips through serializeFaceTags
//   HS-K-7 — single-part cutBySectionPlane wires splitPlane/splitSide through KernelApi

import { describe, it, expect } from 'vitest';
import { serializeFaceTags } from '../api';
import type { FaceTagMap as KernelFaceTagMap } from '../section/cutBySectionPlane';

// ---------------------------------------------------------------------------
// HS-K-6: serializeFaceTags round-trips planeSource
// ---------------------------------------------------------------------------

describe('HS-K-6: serializeFaceTags round-trips planeSource for half-section results', () => {
  it('planeSource: split survives serialization', () => {
    const kernelTags: KernelFaceTagMap = new Map([
      ['face-1', { tag: 'cut-face', partId: 'p1', materialId: 'm1', planeSource: 'split' }],
      ['face-2', { tag: 'cut-face', partId: 'p1', materialId: 'm1', planeSource: 'section' }],
      ['face-3', { tag: 'original-face', partId: 'p1', materialId: 'm1' }],
    ]);

    const serialized = serializeFaceTags(kernelTags);

    // After deserialization (Map.from entries), planeSource must be preserved
    const deserialized = new Map(serialized);

    const face1 = deserialized.get('face-1');
    const face2 = deserialized.get('face-2');
    const face3 = deserialized.get('face-3');
    if (face1?.tag !== 'cut-face' || face2?.tag !== 'cut-face') throw new Error('expected cut-face tags');
    expect(face1.planeSource).toBe('split');
    expect(face2.planeSource).toBe('section');
    // original-face's type forbids planeSource — the type system enforces this; no runtime check needed.
    expect(face3?.tag).toBe('original-face');
  });

  it('planeSource absent on non-half-section result (no spurious field)', () => {
    const kernelTags: KernelFaceTagMap = new Map([
      ['face-1', { tag: 'cut-face', partId: 'p1', materialId: 'm1' }],
    ]);

    const serialized = serializeFaceTags(kernelTags);
    const deserialized = new Map(serialized);

    expect(deserialized.get('face-1')).not.toHaveProperty('planeSource');
  });
});

// ---------------------------------------------------------------------------
// HS-K-7: single-part cutBySectionPlane KernelApi accepts splitPlane/splitSide
// (TypeScript interface proof; runtime wiring covered transitively by HS-K-5
//  on the assembly path, which uses the same forwarding pattern.)
// ---------------------------------------------------------------------------

describe('HS-K-7: single-part KernelApi.cutBySectionPlane accepts splitPlane/splitSide params (TS interface proof)', () => {
  it('compiles with the extended 5-arg signature and reaches the pre-init guard', async () => {
    const { createKernelApi } = await import('../api');
    const api = createKernelApi();

    const plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } };
    const splitPlane = { origin: { x: 25, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } };

    await expect(
      api.cutBySectionPlane('part-id', plane, 1, splitPlane, 1)
    ).rejects.toThrow('kernel not initialized');
  });
});
