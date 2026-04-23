import { describe, it, expect, beforeAll } from 'vitest';
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
    await api.addFeature(id, { kind: 'sketch', id: 's1', plane: 'XY', primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w: 100, h: 200 }] });
    await api.addFeature(id, { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward' });

    const h = new FakeHandle();
    await api.save(id, h as unknown as FileSystemFileHandle);

    // Fresh kernel — simulate closing and reopening
    const api2 = createKernelApi();
    await api2.init();
    const id2 = await api2.load(h as unknown as FileSystemFileHandle);
    const part = await api2.getPart(id2);
    expect(part?.featureTree.length).toBe(2);
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
});
