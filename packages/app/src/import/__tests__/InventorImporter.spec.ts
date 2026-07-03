// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runInventorImport } from '../InventorImporter';
import { makeFakeInputDir, makeFakeWritableTarget } from '../buildFakeImportEnv';

const makeDir = (entries: Record<string, Uint8Array>) => makeFakeInputDir(entries);
const makeWritableTarget = () => makeFakeWritableTarget();

function utf8(s: string): Uint8Array { return new TextEncoder().encode(s); }

function makeKernelStub(isManifold = true) {
  let nextId = 0;
  const features = new Map<string, unknown[]>();
  return {
    importStepCalls: [] as Array<{ partName: string; size: number }>,
    // Kept separately from `features` because deletePart() clears the map —
    // this array survives so tests can inspect what addFeature received.
    addFeatureCalls: [] as Array<{ partId: string; feature: unknown }>,
    saveCalls: [] as string[],
    deleteCalls: [] as string[],
    async importStep({ stepBytes, partName }: { stepBytes: ArrayBuffer; partName: string }) {
      this.importStepCalls.push({ partName, size: stepBytes.byteLength });
      return { brepBlobId: `imp-${++nextId}`, triangleCount: 12, boundingBox: [0, 0, 0, 1, 1, 1] as const, faceCount: 6, isManifold };
    },
    async createPart(_n: string) { const id = `p-${++nextId}`; features.set(id, []); return id; },
    async addFeature(pid: string, f: unknown) { features.get(pid)!.push(f); this.addFeatureCalls.push({ partId: pid, feature: f }); },
    async saveToBytes(pid: string) { this.saveCalls.push(pid); return new TextEncoder().encode(`PART:${pid}`); },
    async deletePart(pid: string) { this.deleteCalls.push(pid); features.delete(pid); },
  };
}

describe('runInventorImport', () => {
  it('imports a single part: parses JSON, calls kernel.importStep, packs .zipt, writes to target', async () => {
    const stepBytes = new Uint8Array([1, 2, 3, 4]);
    const partJson = utf8(JSON.stringify({
      schemaVersion: 1, kind: 'part', exportedAt: 't',
      source: { iptPath: 'P.ipt', fileVersion: 'I' },
      step: 'P.step', name: 'P', properties: { partNumber: 'X' }, parameters: {},
    }));
    const inputDir = makeDir({ 'P.ipt.json': partJson, 'P.step': stepBytes });
    const { dir: targetDir, writes } = makeWritableTarget();
    const kernel = makeKernelStub();

    const summary = await runInventorImport({ input: inputDir, target: targetDir, conflict: 'overwrite', kernel: kernel as any });

    expect(summary.partsImported).toBe(1);
    expect(summary.assembliesImported).toBe(0);
    expect(summary.errors).toHaveLength(0);
    expect(writes.has('P.zipt')).toBe(true);
    expect(new TextDecoder().decode(writes.get('P.zipt')!)).toMatch(/^PART:p-/);
    expect(kernel.importStepCalls).toEqual([{ partName: 'P', size: 4 }]);
    expect(kernel.deleteCalls).toHaveLength(1);
  });

  it('threads kernel.importStep isManifold: false onto the addFeature ImportedFeature — must NOT be dropped by a truthy-spread bug', async () => {
    const stepBytes = new Uint8Array([1, 2, 3, 4]);
    const partJson = utf8(JSON.stringify({
      schemaVersion: 1, kind: 'part', exportedAt: 't',
      source: { iptPath: 'Broken.ipt', fileVersion: 'I' },
      step: 'Broken.step', name: 'Broken', properties: {}, parameters: {},
    }));
    const inputDir = makeDir({ 'Broken.ipt.json': partJson, 'Broken.step': stepBytes });
    const { dir: targetDir } = makeWritableTarget();
    const kernel = makeKernelStub(false);

    const summary = await runInventorImport({ input: inputDir, target: targetDir, conflict: 'overwrite', kernel: kernel as any });

    expect(summary.partsImported).toBe(1);
    expect(kernel.addFeatureCalls).toHaveLength(1);
    const feature = kernel.addFeatureCalls[0]?.feature as { kind: string; isManifold?: boolean };
    expect(feature.kind).toBe('imported');
    expect(feature.isManifold).toBe(false);
  });

  it('imports an assembly with one part child: writes both .zipt and .ziasm in topo order', async () => {
    const stepBytes = new Uint8Array([1, 2, 3, 4]);
    const partJson = utf8(JSON.stringify({
      schemaVersion: 1, kind: 'part', exportedAt: 't',
      source: { iptPath: 'Side.ipt', fileVersion: 'I' },
      step: 'Side.step', name: 'Side', properties: {}, parameters: {},
    }));
    const asmJson = utf8(JSON.stringify({
      schemaVersion: 1, kind: 'assembly', exportedAt: 't',
      source: { iamPath: 'Cabinet.iam', fileVersion: 'I' },
      name: 'Cabinet', properties: {}, parameters: {},
      occurrences: [
        { occurrenceName: 'Side:1', ref: './Side.ipt.json',
          pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
          visible: true, grounded: true },
      ],
    }));
    const inputDir = makeDir({ 'Side.ipt.json': partJson, 'Side.step': stepBytes, 'Cabinet.iam.json': asmJson });
    const { dir: targetDir, writes } = makeWritableTarget();
    const kernel = makeKernelStub();

    const summary = await runInventorImport({ input: inputDir, target: targetDir, conflict: 'overwrite', kernel: kernel as any });

    expect(summary.partsImported).toBe(1);
    expect(summary.assembliesImported).toBe(1);
    expect(summary.errors).toHaveLength(0);
    expect(writes.has('Side.zipt')).toBe(true);
    expect(writes.has('Cabinet.ziasm')).toBe(true);
  });

  it('records error for a part whose .step is missing, but continues processing other entries', async () => {
    const orphanPartJson = utf8(JSON.stringify({
      schemaVersion: 1, kind: 'part', exportedAt: 't',
      source: { iptPath: 'Orphan.ipt', fileVersion: 'I' },
      step: 'Orphan.step', name: 'Orphan', properties: {}, parameters: {},
    }));
    const goodPartJson = utf8(JSON.stringify({
      schemaVersion: 1, kind: 'part', exportedAt: 't',
      source: { iptPath: 'Good.ipt', fileVersion: 'I' },
      step: 'Good.step', name: 'Good', properties: {}, parameters: {},
    }));
    const inputDir = makeDir({
      'Orphan.ipt.json': orphanPartJson,
      'Good.ipt.json': goodPartJson,
      'Good.step': new Uint8Array([9]),
    });
    const { dir: targetDir, writes } = makeWritableTarget();
    const kernel = makeKernelStub();

    const summary = await runInventorImport({ input: inputDir, target: targetDir, conflict: 'overwrite', kernel: kernel as any });

    expect(summary.partsImported).toBe(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]!.path).toMatch(/Orphan/);
    expect(writes.has('Good.zipt')).toBe(true);
  });

  it('progress callback fires with current/total/path per node', async () => {
    const partJson = utf8(JSON.stringify({
      schemaVersion: 1, kind: 'part', exportedAt: 't',
      source: { iptPath: 'P.ipt', fileVersion: 'I' },
      step: 'P.step', name: 'P', properties: {}, parameters: {},
    }));
    const inputDir = makeDir({ 'P.ipt.json': partJson, 'P.step': new Uint8Array([1]) });
    const { dir: targetDir } = makeWritableTarget();
    const events: { current: number; total: number; path: string }[] = [];
    await runInventorImport({
      input: inputDir, target: targetDir, conflict: 'overwrite',
      kernel: makeKernelStub() as any,
      onProgress: (p) => events.push(p),
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]!.path).toBe('P.ipt.json');
    expect(events[0]!.total).toBe(1);
  });

  it('signal abort: stops processing remaining nodes', async () => {
    const partJson = (n: string) => utf8(JSON.stringify({
      schemaVersion: 1, kind: 'part', exportedAt: 't',
      source: { iptPath: `${n}.ipt`, fileVersion: 'I' },
      step: `${n}.step`, name: n, properties: {}, parameters: {},
    }));
    const inputDir = makeDir({
      'A.ipt.json': partJson('A'), 'A.step': new Uint8Array([1]),
      'B.ipt.json': partJson('B'), 'B.step': new Uint8Array([2]),
    });
    const { dir: targetDir, writes } = makeWritableTarget();
    const ac = new AbortController();
    let count = 0;
    const summary = await runInventorImport({
      input: inputDir, target: targetDir, conflict: 'overwrite',
      kernel: makeKernelStub() as any,
      signal: ac.signal,
      onProgress: () => { if (++count === 1) ac.abort(); },
    });
    expect(summary.partsImported).toBeLessThan(2);
    expect(writes.size).toBeLessThan(2);
  });
});
