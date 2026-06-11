import { describe, it, expect } from 'vitest';
import { createKernelApi } from '../api';
import { loadOcct } from '../occt/occtLoader'; // confirmed: occtLoader.ts:18 exports loadOcct
import { readStep } from '../occt/StepIO';
import { parseBinaryStl } from '../occt/__tests__/binaryStlParser';

/**
 * Build a real `w × d × h` mm box part and return its registered kernel partId.
 * This makeBoxPart is local to this e2e file; the kernel-step chunk's
 * api.export.integration.spec.ts has its own independent makeBoxPart.
 */
async function makeBoxPart(
  api: ReturnType<typeof createKernelApi>,
  name: string,
  w: number,
  d: number,
  h: number,
): Promise<string> {
  const id = await api.createPart(name);
  await api.setParameter(id, { name: 'h1', expression: String(h), value: h, unit: 'mm' });
  await api.addFeature(id, {
    kind: 'sketch',
    id: 's1',
    plane: { source: 'workPlane', featureId: 'origin.XY' },
    primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w, h: d }],
    constraints: [],
  });
  await api.addFeature(id, {
    kind: 'extrude',
    id: 'e1',
    sketchRef: 's1',
    distanceParam: 'h1',
    direction: 'forward',
    operation: 'new',
  });
  const res = await api.execute(id);
  expect(res.ok).toBe(true);
  return id;
}

describe('KernelApi 3D export — real OCCT e2e round-trip', () => {
  it('exportStepPart → readStep recovers a 10mm box with mm units (ISO-10303-21 header)', async () => {
    const api = createKernelApi();
    await api.init();
    const id = await makeBoxPart(api, 'Cube', 10, 10, 10);
    const bytes = await api.exportStepPart(id);

    // Confirm STEP header
    expect(new TextDecoder().decode(bytes.slice(0, 13))).toBe('ISO-10303-21;');

    const oc = await loadOcct();
    const r = readStep(oc, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(r.solidCount).toBe(1); // cold-cache guard: empty export would be 0
    const [minX, minY, minZ, maxX, maxY, maxZ] = r.boundingBox;
    expect(maxX - minX).toBeCloseTo(10, 3); // mm proof — strict
    expect(maxY - minY).toBeCloseTo(10, 3);
    expect(maxZ - minZ).toBeCloseTo(10, 3);
  }, 120_000);

  it('exportStlPart → parseBinaryStl recovers a 10mm box (triCount multiple-of-2 ≥ 12, mm span)', async () => {
    const api = createKernelApi();
    await api.init();
    const id = await makeBoxPart(api, 'Cube2', 10, 10, 10);
    const bytes = await api.exportStlPart(id, { binary: true });
    const { triCount, bbox } = parseBinaryStl(bytes);
    // OCCT may split faces; do not assert exactly 12. Assert even and >= 12 (addendum §5).
    expect(triCount % 2).toBe(0);
    expect(triCount).toBeGreaterThanOrEqual(12);
    expect(bbox[3] - bbox[0]).toBeCloseTo(10, 3); // mm span, strict (the real unit proof)
    expect(bbox[5] - bbox[2]).toBeCloseTo(10, 3);
  }, 120_000);

  it('exportStepAssembly preserves 2 posed components with 2 DIFFERENT colors (color-loss trap) + NAUO in output', async () => {
    const api = createKernelApi();
    await api.init();
    const partId = await makeBoxPart(api, 'Side', 10, 10, 10); // one prototype, two instances
    const leaves = [
      {
        partId,
        name: 'Side_A',
        pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const },
        color: [1, 0, 0] as const,
      },
      {
        partId,
        name: 'Side_B',
        pose: { translation: { x: 50, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const },
        color: [0, 0, 1] as const,
      },
    ];
    const bytes = await api.exportStepAssembly(leaves, { name: 'Pair' });

    // ISO header
    expect(new TextDecoder().decode(bytes.slice(0, 13))).toBe('ISO-10303-21;');

    const txt = new TextDecoder().decode(bytes);
    // Component names survive (NameMode=true)
    expect(txt).toContain('Side_A');
    expect(txt).toContain('Side_B');
    // XCAF assembly structure: NEXT_ASSEMBLY_USAGE_OCCURRENCE entities indicate true hierarchy
    expect(txt).toContain('NEXT_ASSEMBLY_USAGE_OCCURRENCE');

    const oc = await loadOcct();
    const r = readStep(oc, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(r.solidCount).toBe(2); // BOTH instances present (assert FIRST per §C)
    const colors = r.solidColors.filter((c): c is string => !!c).map((c) => c.toLowerCase());
    expect(new Set(colors).size).toBe(2); // TWO DISTINCT colors survived (the trap's signature)
    expect(colors).toContain('#ff0000');
    expect(colors).toContain('#0000ff');
    // Posed bbox: second instance shifted +50mm → overall span 50+10 = 60mm in X
    const [minX, , , maxX] = r.boundingBox;
    expect(maxX - minX).toBeCloseTo(60, 3);
  }, 180_000);
});
