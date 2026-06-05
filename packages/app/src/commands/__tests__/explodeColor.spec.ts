// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { ExplodeIntoAssemblyCommand } from '../ExplodeIntoAssemblyCommand';
import type { PartDocument } from '@zilventor/shared';

// ---------- helpers (copied from ExplodeIntoAssemblyCommand.spec.ts) ----------

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async read(p: string) {
    const b = this.files.get(p);
    if (!b) throw new Error(`ENOENT: ${p}`);
    return b;
  }
  async exists(p: string) { return this.files.has(p); }
  async delete(p: string) { this.files.delete(p); }
  async listAll() { return [...this.files.keys()]; }
}

type SplitResult = {
  solids: Array<{ brepBlobId: string; boundingBox: [number, number, number, number, number, number]; color?: string }>;
  surfaces: { brepBlobId: string; boundingBox: [number, number, number, number, number, number] } | null;
};

function makeKernel(splitResult: SplitResult) {
  return {
    splitImportedShape: vi.fn(async () => splitResult),
    registerPart: vi.fn(async () => undefined),
    deletePart: vi.fn(async () => undefined),
    saveToBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
}

function makeImportedPart(name: string, bodyRef: string, sourceStep: string): PartDocument {
  return {
    id: 'part-imported-id',
    name,
    units: 'mm',
    parameters: {},
    featureTree: [
      {
        kind: 'imported' as const,
        id: 'feat-imported-id',
        sourceStep,
        bodyRef,
      },
    ],
    properties: {},
    materials: [],
    hardware: [],
  };
}

// ---------- tests: color stamping -------------------------------------------

describe('ExplodeIntoAssemblyCommand — color stamping', () => {
  let opfs: MemOpfs;

  beforeEach(() => {
    opfs = new MemOpfs();
    const part = makeImportedPart('Model', 'body-ref-abc', 'Model.step');
    useAppStore.getState().setActivePart(part);
  });

  it('stamps component[0].color from solid[0].color; component[1].color is undefined when solid has no color', async () => {
    const kernel = makeKernel({
      solids: [
        { brepBlobId: 'solid-blob-1', boundingBox: [0, 0, 0, 10, 10, 10], color: '#ff0000' },
        { brepBlobId: 'solid-blob-2', boundingBox: [20, 0, 0, 30, 10, 10] },
      ],
      surfaces: null,
    });

    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();

    const { activeDocument } = useAppStore.getState();
    expect(activeDocument?.kind).toBe('assembly');
    if (activeDocument?.kind !== 'assembly') throw new Error('guard');

    const components = activeDocument.document.components;
    expect(components).toHaveLength(2);

    // Find component by partPath to avoid ordering assumptions
    const comp1 = components.find(c => c.partPath === 'Model_1.zipt');
    const comp2 = components.find(c => c.partPath === 'Model_2.zipt');
    expect(comp1).toBeDefined();
    expect(comp2).toBeDefined();
    expect(comp1!.color).toEqual({ kind: 'hex', hex: '#ff0000' });
    expect(comp2!.color).toBeUndefined();
  });

  it('leaves all components uncolored when no solid carries a color', async () => {
    const kernel = makeKernel({
      solids: [
        { brepBlobId: 'solid-blob-1', boundingBox: [0, 0, 0, 10, 10, 10] },
        { brepBlobId: 'solid-blob-2', boundingBox: [20, 0, 0, 30, 10, 10] },
      ],
      surfaces: null,
    });

    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();

    const { activeDocument } = useAppStore.getState();
    if (activeDocument?.kind !== 'assembly') throw new Error('guard');
    for (const c of activeDocument.document.components) {
      expect(c.color).toBeUndefined();
    }
  });

  it('surfaces component is uncolored even when solids carry colors', async () => {
    const kernel = makeKernel({
      solids: [
        { brepBlobId: 'solid-blob-1', boundingBox: [0, 0, 0, 10, 10, 10], color: '#00ff00' },
      ],
      surfaces: { brepBlobId: 'surf-blob', boundingBox: [0, 0, 0, 100, 100, 5] },
    });

    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();

    const { activeDocument } = useAppStore.getState();
    if (activeDocument?.kind !== 'assembly') throw new Error('guard');

    const surfComp = activeDocument.document.components.find(c => c.partPath.endsWith('_surfaces.zipt'));
    expect(surfComp).toBeDefined();
    expect(surfComp!.color).toBeUndefined();
  });
});
