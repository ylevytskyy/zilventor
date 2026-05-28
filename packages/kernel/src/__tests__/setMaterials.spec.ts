// packages/kernel/src/__tests__/setMaterials.spec.ts
import { describe, it, expect } from 'vitest';
import { createKernelApi } from '../api';
import type { MaterialEntry } from '@zilventor/shared';

const MAT_A: MaterialEntry = {
  id: 'mat-a', name: 'Birch 18', defaultThickness: 18, color: '#cfa84b',
};
const MAT_B: MaterialEntry = {
  id: 'mat-b', name: 'Oak 22', defaultThickness: 22, color: '#8b5e3c',
  hatchAngleDeg: 30, hatchSpacingMm: 2,
};

describe('KernelApi.setMaterials', () => {
  it('replaces the materials array on the stored part', async () => {
    const api = createKernelApi();
    await api.init();
    const partId = await api.createPart('P');

    await api.setMaterials(partId, [MAT_A]);
    const p1 = await api.getPart(partId);
    expect(p1!.materials).toHaveLength(1);
    expect(p1!.materials[0]!.id).toBe('mat-a');

    await api.setMaterials(partId, [MAT_A, MAT_B]);
    const p2 = await api.getPart(partId);
    expect(p2!.materials).toHaveLength(2);
    expect(p2!.materials[1]!.id).toBe('mat-b');
  });

  it('throws on unknown partId', async () => {
    const api = createKernelApi();
    await api.init();
    await expect(
      api.setMaterials('nonexistent-part', [MAT_A])
    ).rejects.toThrow(/setMaterials: unknown partId/);
  });

  it('saveToBytes after setMaterials round-trips the updated materials', async () => {
    const api = createKernelApi();
    await api.init();
    const partId = await api.createPart('RoundTrip');

    // Add a sketch + extrude so saveToBytes has a valid solid to pack.
    await api.setParameter(partId, { name: 'd1', expression: '10', value: 10, unit: 'mm' });
    await api.addFeature(partId, {
      kind: 'sketch', id: 's1',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 }],
      constraints: [],
    });
    await api.addFeature(partId, {
      kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1',
      direction: 'forward', operation: 'new',
    });
    await api.execute(partId);

    await api.setMaterials(partId, [MAT_A, MAT_B]);

    // Pack to bytes, then reload into a fresh api instance and read back.
    const bytes = await api.saveToBytes(partId);
    const api2 = createKernelApi();
    await api2.init();
    const loadedId = await api2.loadFromBytes(bytes);
    const loaded = await api2.getPart(loadedId);

    expect(loaded!.materials).toHaveLength(2);
    expect(loaded!.materials[0]!.id).toBe('mat-a');
    expect(loaded!.materials[1]!.hatchAngleDeg).toBe(30);
    expect(loaded!.materials[1]!.hatchSpacingMm).toBe(2);
  }, 60_000);

  it('defensive copy: mutating the input array after setMaterials does not affect kernel state', async () => {
    const api = createKernelApi();
    await api.init();
    const partId = await api.createPart('Defensive');

    const muts: MaterialEntry[] = [{ ...MAT_A }];
    await api.setMaterials(partId, muts);

    // Mutate the array we passed in.
    (muts as MaterialEntry[])[0] = { ...MAT_B };

    const p = await api.getPart(partId);
    // Kernel's copy should still be the original MAT_A.
    expect(p!.materials[0]!.id).toBe('mat-a');
  });
});
