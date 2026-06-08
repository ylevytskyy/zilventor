import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createKernelApi } from '../api';

class FakeHandle {
  private bytes = new Uint8Array();
  async createWritable() {
    const chunks: Uint8Array[] = [];
    return {
      write: async (c: Uint8Array) => { chunks.push(c); },
      close: async () => {
        const total = chunks.reduce((n, c) => n + c.byteLength, 0);
        const flat = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { flat.set(c, off); off += c.byteLength; }
        this.bytes = flat;
      }
    };
  }
  async getFile() {
    const data = this.bytes;
    return { arrayBuffer: async () => data.slice().buffer };
  }
}

let api: ReturnType<typeof createKernelApi>;
beforeAll(async () => {
  api = createKernelApi();
  await api.init();
}, 60_000);

describe('Save/Load round-trip via FakeHandle', () => {
  it('preserves feature tree and re-executes to produce the same geometry', async () => {
    const id = await api.createPart('Part1');
    await api.setParameter(id, { name: 'd1', expression: '50', value: 50, unit: 'mm' });
    await api.addFeature(id, { kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w: 100, h: 200 }], constraints: [] });
    await api.addFeature(id, { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward', operation: 'new' });

    const h = new FakeHandle();
    await api.save(id, h as unknown as FileSystemFileHandle);

    // Fresh kernel — simulate closing and reopening
    const api2 = createKernelApi();
    await api2.init();
    const id2 = await api2.load(h as unknown as FileSystemFileHandle);
    const part = await api2.getPart(id2);
    expect(part?.featureTree.length).toBe(9);
    expect(part?.parameters.d1?.value).toBe(50);

    const r = await api2.execute(id2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.mesh.boundingBox[3]).toBeCloseTo(100, 5);
    expect(r.value.mesh.boundingBox[4]).toBeCloseTo(200, 5);
    expect(r.value.mesh.boundingBox[5]).toBeCloseTo(50, 5);
  }, 120_000);

  it('refuses to load a file from a newer format version', async () => {
    const h = new FakeHandle();
    const { packProject } = await import('../storage/ProjectPacker');
    const archive = await packProject({
      manifest: { formatVersion: 99, kind: 'part' },
      blobs: {}
    });
    const { writeToHandle } = await import('../storage/FileSystemAccess');
    await writeToHandle(h as unknown as FileSystemFileHandle, archive);

    await expect(api.load(h as unknown as FileSystemFileHandle)).rejects.toThrow(/newer/i);
  });

  it('loadFromBytes: round-trip preserves feature tree without a FileHandle', async () => {
    const id = await api.createPart('P2');
    await api.setParameter(id, { name: 'd1', expression: '20', value: 20, unit: 'mm' });
    await api.addFeature(id, { kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 }], constraints: [] });
    await api.addFeature(id, { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward', operation: 'new' });

    const h = new FakeHandle();
    await api.save(id, h as unknown as FileSystemFileHandle);
    // Read raw bytes from the fake handle
    const file = await h.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());

    const api3 = createKernelApi();
    await api3.init();
    const id3 = await api3.loadFromBytes(bytes);
    expect(id3).toMatch(/[0-9a-f-]{36}/);
    const part3 = await api3.getPart(id3);
    expect(part3?.featureTree.length).toBe(9);
    expect(part3?.parameters.d1?.value).toBe(20);
  }, 120_000);

  it('saveToBytes: returns archive bytes that loadFromBytes can re-hydrate', async () => {
    const id = await api.createPart('P3');
    await api.setParameter(id, { name: 'd1', expression: '15', value: 15, unit: 'mm' });
    await api.addFeature(id, { kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 }], constraints: [] });
    await api.addFeature(id, { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward', operation: 'new' });

    const bytes = await api.saveToBytes(id);
    expect(bytes.length).toBeGreaterThan(0);

    const api2 = createKernelApi();
    await api2.init();
    const id2 = await api2.loadFromBytes(bytes);
    const part2 = await api2.getPart(id2);
    expect(part2?.featureTree.length).toBe(9);
    expect(part2?.parameters.d1?.value).toBe(15);
  }, 120_000);

  it('round-trips an imported part: importStep → addFeature → saveToBytes → loadFromBytes (fresh API) → execute', async () => {
    const api = createKernelApi();
    await api.init();
    const bytes = readFileSync(resolve(__dirname, '../occt/__tests__/fixtures/step/cube-10mm.step'));
    const imp = await api.importStep({
      stepBytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      partName: 'Cube',
    });
    const partId = await api.createPart('Cube');
    await api.addFeature(partId, {
      kind: 'imported', id: 'imp-1', sourceStep: 'cube-10mm.step', bodyRef: imp.brepBlobId,
    });
    const saved = await api.saveToBytes(partId);

    // Fresh API instance simulates a reload
    const api2 = createKernelApi();
    await api2.init();
    const partId2 = await api2.loadFromBytes(saved);
    const exec = await api2.execute(partId2);
    if (!exec.ok) throw new Error(`execute after reload failed: ${JSON.stringify(exec.error)}`);
    expect(exec.value.mesh.indices.length).toBeGreaterThan(0);
    expect(exec.value.faceNames?.length).toBe(6);
  }, 120_000);

  it('construction flag on SketchPrimitive survives packProject → loadFromBytes round-trip', async () => {
    // Build the archive directly (bypassing saveToBytes / executeTree) so the
    // test focuses on JSON serialisation of the construction flag only.
    // Task 3 will add construction-exclusion to executeSketchFeature; until
    // then a sketch with only open lines cannot pass executeTree.
    const { packProject } = await import('../storage/ProjectPacker');
    const partDoc = {
      id: 'ctor-test-part',
      name: 'ConstructionTest',
      units: 'mm',
      parameters: {},
      featureTree: [
        {
          kind: 'sketch',
          id: 's1',
          plane: { source: 'workPlane', featureId: 'origin.XY' },
          primitives: [
            { id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 50, y2: 0 },
            { id: 'p2', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 50, construction: true },
          ],
          constraints: [],
        },
      ],
      properties: {},
      materials: [],
      hardware: [],
    };
    const archive = await packProject({
      manifest: { formatVersion: 20, kind: 'part', createdAt: new Date().toISOString(), appVersion: '0.0.0', document: partDoc },
      blobs: {},
    });

    const api4 = createKernelApi();
    await api4.init();
    const id4 = await api4.loadFromBytes(archive);
    const part4 = await api4.getPart(id4);

    const sketch = part4?.featureTree.find(f => f.id === 's1');
    if (!sketch || sketch.kind !== 'sketch') throw new Error('sketch s1 not found after reload');
    const p1 = sketch.primitives.find(p => p.id === 'p1');
    const p2 = sketch.primitives.find(p => p.id === 'p2');
    expect(p2?.construction).toBe(true);
    expect(p1?.construction).toBeFalsy();
  }, 120_000);
});
