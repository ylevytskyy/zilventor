import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../../occt/occtLoader';
import { executeTree } from '../../FeatureTree';
import { newPart, addFeature } from '../../PartDocument';
import { disposeShape, computeBoundingBox } from '../../../occt/SolidOps';
import { createKernelApi } from '../../../api';
import type { PanelFeature, PartDocument } from '@zilventor/shared';

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

/**
 * In-memory FileSystemFileHandle stand-in (mirrors the FakeHandle in
 * `save-roundtrip.integration.spec.ts`). Used to drive `api.save` /
 * `api.load` without touching the real filesystem.
 */
class FakeHandle {
  private bytes = new Uint8Array();
  async createWritable(): Promise<{ write: (c: Uint8Array) => Promise<void>; close: () => Promise<void> }> {
    const chunks: Uint8Array[] = [];
    return {
      write: async (c: Uint8Array) => { chunks.push(c); },
      close: async () => {
        const total = chunks.reduce((n, c) => n + c.byteLength, 0);
        const flat = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { flat.set(c, off); off += c.byteLength; }
        this.bytes = flat;
      },
    };
  }
  async getFile(): Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }> {
    const data = this.bytes;
    return { arrayBuffer: async () => data.slice().buffer };
  }
}

const mkPanel = (over: Partial<PanelFeature> = {}): PanelFeature => ({
  kind: 'panel', id: 'pf-1',
  length: { kind: 'literal', value: 600 },
  width: { kind: 'literal', value: 400 },
  thickness: { kind: 'literal', value: 18 },
  thicknessFromMaterial: true,
  materialId: 'mat-1',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
  ...over,
});

describe('PanelFeature integration', () => {
  it('appears at user-feature index 0 (after the 7 origin features)', () => {
    let doc = newPart('Part1');
    doc = addFeature(doc, mkPanel());
    // newPart seeds 7 origin features, so the panel sits at absolute index 7.
    expect(doc.featureTree).toHaveLength(8);
    expect(doc.featureTree[7]).toMatchObject({ kind: 'panel', id: 'pf-1' });
  });

  it('executeTree dispatches panel to evaluatePanel and produces a 600×400×18 body', async () => {
    let doc = newPart('Part1');
    doc = addFeature(doc, mkPanel());

    const r = await executeTree(occt, doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bbox = computeBoundingBox(occt, r.value.finalSolid);
    expect(bbox[3] - bbox[0]).toBeCloseTo(600, 5);
    expect(bbox[4] - bbox[1]).toBeCloseTo(400, 5);
    expect(bbox[5] - bbox[2]).toBeCloseTo(18, 5);
    disposeShape(r.value.finalSolid);
  });

  it('executeTree for panel grain=length produces mesh.uv with length = (positions.length/3)*2', async () => {
    let doc = newPart('Part1');
    doc = addFeature(doc, mkPanel({ grain: 'length' }));
    const r = await executeTree(occt, doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.mesh.uv).toBeDefined();
    expect(r.value.mesh.uv!.length).toBe((r.value.mesh.positions.length / 3) * 2);
    disposeShape(r.value.finalSolid);
  }, 60_000);

  it('executeTree for panel grain=width: U spans ~400mm (width axis)', async () => {
    let doc = newPart('Part1');
    doc = addFeature(doc, mkPanel({ grain: 'width' }));
    const r = await executeTree(occt, doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const uv = r.value.mesh.uv!;
    let maxU = -Infinity, minU = Infinity;
    for (let i = 0; i < uv.length; i += 2) { const u = uv[i]!; if (u > maxU) maxU = u; if (u < minU) minU = u; }
    expect(maxU - minU).toBeGreaterThan(350);
    disposeShape(r.value.finalSolid);
  }, 60_000);

  it('save → reload preserves the panel and re-executes to identical geometry', async () => {
    const api = createKernelApi();
    await api.init();
    const id = await api.createPart('Part1');
    await api.addFeature(id, mkPanel());

    const r1 = await api.execute(id);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const bbox1 = r1.value.mesh.boundingBox;

    const h = new FakeHandle();
    await api.save(id, h as unknown as FileSystemFileHandle);

    const api2 = createKernelApi();
    await api2.init();
    const id2 = await api2.load(h as unknown as FileSystemFileHandle);
    const reloaded = (await api2.getPart(id2)) as PartDocument | undefined;
    expect(reloaded).toBeDefined();
    if (!reloaded) return;
    // 7 origin features + 1 panel = 8 features in the user-visible tree.
    expect(reloaded.featureTree).toHaveLength(8);
    expect(reloaded.featureTree[7]).toMatchObject({ kind: 'panel', id: 'pf-1' });

    const r2 = await api2.execute(id2);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.mesh.boundingBox).toEqual(bbox1);
  }, 120_000);
});
