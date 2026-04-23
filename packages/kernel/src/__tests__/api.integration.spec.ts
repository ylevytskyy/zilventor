import { describe, it, expect } from 'vitest';
import { createKernelApi } from '../api';

describe('KernelApi (end-to-end, in-process)', () => {
  it('can create a part, add features, set parameters, and execute the tree', async () => {
    const api = createKernelApi();
    await api.init();

    const partId = await api.createPart('Part1');
    expect(partId).toMatch(/[0-9a-f-]{36}/);

    await api.setParameter(partId, { name: 'd1', expression: '50', value: 50, unit: 'mm' });
    await api.addFeature(partId, { kind: 'sketch', id: 's1', plane: 'XY', primitives: [{ kind: 'rectangle', x: 0, y: 0, w: 100, h: 200 }] });
    await api.addFeature(partId, { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward' });

    const part = await api.getPart(partId);
    expect(part).toBeTruthy();
    expect(part?.featureTree.length).toBe(2);
    expect(part?.parameters.d1?.value).toBe(50);

    const res = await api.execute(partId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.mesh.boundingBox[3]).toBeCloseTo(100, 5);
    expect(res.value.mesh.boundingBox[4]).toBeCloseTo(200, 5);
    expect(res.value.mesh.boundingBox[5]).toBeCloseTo(50, 5);
    expect(res.value.mesh.indices.length).toBeGreaterThan(0);
  }, 120_000);

  it('getPart returns null for unknown partId', async () => {
    const api = createKernelApi();
    await api.init();
    expect(await api.getPart('nonexistent')).toBeNull();
  }, 60_000);

  it('execute throws when called on an unknown partId', async () => {
    const api = createKernelApi();
    await api.init();
    await expect(api.execute('nonexistent')).rejects.toThrow(/no part/);
  }, 60_000);
});
