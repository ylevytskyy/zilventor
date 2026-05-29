import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Feature, AssemblyConstraintRef } from '@zilventor/shared';
import { createKernelApi } from '../api';

describe('KernelApi (end-to-end, in-process)', () => {
  it('can create a part, add features, set parameters, and execute the tree', async () => {
    const api = createKernelApi();
    await api.init();

    const partId = await api.createPart('Part1');
    expect(partId).toMatch(/[0-9a-f-]{36}/);

    await api.setParameter(partId, { name: 'd1', expression: '50', value: 50, unit: 'mm' });
    await api.addFeature(partId, { kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w: 100, h: 200 }], constraints: [] });
    await api.addFeature(partId, { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward', operation: 'new' });

    const part = await api.getPart(partId);
    expect(part).toBeTruthy();
    expect(part?.featureTree.length).toBe(9);
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

  it('addPrimitive + removePrimitive work via the API surface', async () => {
    const api = createKernelApi();
    await api.init();
    const id = await api.createPart('P');
    await api.addFeature(id, { kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [], constraints: [] });
    await api.addPrimitive(id, 's1', { id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10 });
    let part = await api.getPart(id);
    expect((part?.featureTree.find((f) => f.id === 's1') as { primitives: unknown[] }).primitives.length).toBe(1);
    await api.removePrimitive(id, 's1', 'p1');
    part = await api.getPart(id);
    expect((part?.featureTree.find((f) => f.id === 's1') as { primitives: unknown[] }).primitives.length).toBe(0);
  }, 60_000);

  it('previewFeature executes without mutating the stored part', async () => {
    const api = createKernelApi();
    await api.init();
    const partId = await api.createPart('P');
    await api.addFeature(partId, { kind: 'sketch', id: 'S1', plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [
        { id: 'R1', kind: 'rectangle', x: 5, y: 0, w: 10, h: 5 },
        { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }
      ], constraints: [] });
    await api.setParameter(partId, { name: 'angle0', expression: '360', value: 360, unit: 'deg' });

    const scratch: Feature = {
      kind: 'revolve', id: 'R_scratch', sketchRef: 'S1', axisPrimitiveId: 'L1',
      angleParam: 'angle0', direction: 'normal', operation: 'new'
    };
    const r = await api.previewFeature(partId, scratch);
    expect(r.ok).toBe(true);

    // Stored part's featureTree unchanged.
    const p = await api.getPart(partId);
    expect(p!.featureTree.filter((f) => f.kind === 'revolve')).toHaveLength(0);
  }, 120_000);

  it('extractAssemblyRef resolves +Z face plane from cached NamedShape (fix: T36 face-handle gap)', async () => {
    // Regression test: before the fix, extractAssemblyRef re-executed the tree
    // and reconstructed NamedShape with index placeholders instead of real OCCT
    // face handles, so extractFacePlane always returned null → broken-ref errors.
    const api = createKernelApi();
    await api.init();

    const partId = await api.createPart('Box');
    await api.setParameter(partId, { name: 'd1', expression: '50', value: 50, unit: 'mm' });
    await api.addFeature(partId, {
      kind: 'sketch', id: 's1',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w: 100, h: 100 }],
      constraints: []
    });
    await api.addFeature(partId, {
      kind: 'extrude', id: 'e1', sketchRef: 's1',
      distanceParam: 'd1', direction: 'forward', operation: 'new'
    });

    // Warm the NamedShape cache via execute().
    const execR = await api.execute(partId);
    expect(execR.ok).toBe(true);

    // The +Z top face of the box is named { featureId: 'e1', role: 'top' }.
    // (ExtrudeFeature labels the face with the highest centroid-Z as 'top'.)
    const ref: AssemblyConstraintRef = {
      kind: 'face',
      componentPath: ['C1'],
      face: { featureId: 'e1', role: 'top', instance: 0 }
    };

    const r = await api.extractAssemblyRef(partId, ref);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.value.kind).toBe('plane');
    if (r.value.kind !== 'plane') return;

    // The top face of a forward (+Z) extrude has its outward normal pointing
    // in +Z (0, 0, 1). Allow for sign flip — OCCT may orient the normal either
    // way; we just verify it is aligned with Z and not zero.
    const { N } = r.value;
    expect(Math.abs(N.z)).toBeCloseTo(1, 5);
    expect(Math.abs(N.x)).toBeCloseTo(0, 5);
    expect(Math.abs(N.y)).toBeCloseTo(0, 5);

    // The plane origin should be at Z ≈ 50 (the extrude distance).
    expect(r.value.P.z).toBeCloseTo(50, 3);
  }, 120_000);

  it('execute surfaces featureErrors for a fillet that fails to resolve', async () => {
    const api = createKernelApi();
    await api.init();
    const partId = await api.createPart('P');
    await api.addFeature(partId, { kind: 'sketch', id: 'S1', plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 }], constraints: [] });
    await api.setParameter(partId, { name: 'd1', expression: '10', value: 10, unit: 'mm' });
    await api.addFeature(partId, {
      kind: 'extrude', id: 'E1', sketchRef: 'S1', distanceParam: 'd1', direction: 'forward', operation: 'new'
    });
    // Fillet referencing a non-existent face.
    await api.setParameter(partId, { name: 'r1', expression: '2', value: 2, unit: 'mm' });
    await api.addFeature(partId, {
      kind: 'fillet', id: 'F1', mode: 'constant',
      edges: [{
        edgeId: { faceA: { featureId: 'ZZZ', role: 'top' }, faceB: { featureId: 'ZZZ', role: 'bottom' } },
        selectionMode: 'edge',
        radius: { kind: 'param', paramName: 'r1' }
      }],
      setbacks: []
    });
    const r = await api.execute(partId);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.featureErrors).toBeDefined();
      expect(r.value.featureErrors!.get('F1')?.kind).toBe('edgeNotFound');
    }
  }, 120_000);
});

describe('importStep metadata (no tessellation)', () => {
  it('returns faceCount=6, solidCount=1, correct bbox, non-empty brepBlobId, and triangleCount===0 for cube-10mm.step', async () => {
    const api = createKernelApi();
    await api.init();
    const bytes = readFileSync(
      resolve(__dirname, '../occt/__tests__/fixtures/step/cube-10mm.step')
    );
    const result = await api.importStep({
      stepBytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      partName: 'Cube',
    });
    expect(result.faceCount).toBe(6);
    expect(result.solidCount).toBe(1);
    expect(result.brepBlobId).toMatch(/^imp-/);
    // bbox of a 10mm cube: each span ≈ 10mm (allow ±0.01mm rounding)
    const [minX, minY, minZ, maxX, maxY, maxZ] = result.boundingBox;
    expect(maxX - minX).toBeCloseTo(10, 1);
    expect(maxY - minY).toBeCloseTo(10, 1);
    expect(maxZ - minZ).toBeCloseTo(10, 1);
    // Dead tessellation removed — always 0
    expect(result.triangleCount).toBe(0);
  }, 120_000);
});

describe('importStep + ImportedFeature roundtrip', () => {
  it('imports a STEP, attaches it as an imported feature, and execute() returns a mesh with 6 face names', async () => {
    const api = createKernelApi();
    await api.init();
    const bytes = readFileSync(
      resolve(__dirname, '../occt/__tests__/fixtures/step/cube-10mm.step')
    );
    const result = await api.importStep({
      stepBytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      partName: 'Cube',
    });
    expect(result.faceCount).toBe(6);
    // importStep no longer tessellates — triangleCount is always 0 (dead
    // tessellation removed; mesh is recomputed by executeTree on demand).
    expect(result.triangleCount).toBe(0);

    const partId = await api.createPart('Cube');
    await api.addFeature(partId, {
      kind: 'imported',
      id: 'imp-1',
      sourceStep: 'cube-10mm.step',
      bodyRef: result.brepBlobId,
    });
    const exec = await api.execute(partId);
    if (!exec.ok) throw new Error(`execute failed: ${JSON.stringify(exec.error)}`);
    expect(exec.value.mesh.indices.length).toBeGreaterThan(0);
    expect(exec.value.faceNames?.length).toBe(6);
    const roles = (exec.value.faceNames ?? []).map((f) => f.role);
    expect(new Set(roles)).toEqual(new Set(['imported-face']));
    const instances = (exec.value.faceNames ?? [])
      .map((f) => f.instance ?? -1)
      .sort((a, b) => a - b);
    expect(instances).toEqual([0, 1, 2, 3, 4, 5]);
  }, 120_000);
});
