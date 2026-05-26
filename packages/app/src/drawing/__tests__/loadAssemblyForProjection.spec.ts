// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';

// ---- Fixtures ----
const PART_A_PATH = 'parts/partA.zipt';
const PART_B_PATH = 'parts/partB.zipt';
const ASM_PATH    = 'assemblies/top.ziasm';
const PART_A_BYTES = new Uint8Array([1, 2, 3]);
const PART_B_BYTES = new Uint8Array([4, 5, 6]);
const ASM_BYTES    = new Uint8Array([7, 8, 9]);

function makeAsmDoc(overrides?: Partial<AssemblyDocument>): AssemblyDocument {
  return {
    id: 'asm-top',
    name: 'Top',
    units: 'mm',
    parameters: {},
    components: [
      {
        id: 'c1',
        partPath: PART_A_PATH,
        position: { x: 10, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
        flexible: false,
      },
      {
        id: 'c2',
        partPath: PART_B_PATH,
        position: { x: -10, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
        flexible: false,
      },
    ],
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {},
    cutListItemNumbers: {},
    colorOverrides: {},
    properties: {},
    materials: [],
    hardware: [],
    ...overrides,
  };
}

const asmDoc = makeAsmDoc();

function makeOpfs() {
  return {
    exists: vi.fn().mockResolvedValue(true),
    read: vi.fn().mockImplementation(async (path: string) => {
      if (path === ASM_PATH)    return ASM_BYTES;
      if (path === PART_A_PATH) return PART_A_BYTES;
      if (path === PART_B_PATH) return PART_B_BYTES;
      throw new Error(`unexpected read: ${path}`);
    }),
  };
}

function makeKernel() {
  return {
    loadFromBytes: vi.fn().mockImplementation(async (bytes: Uint8Array) => {
      if (bytes === PART_A_BYTES) return 'kernel-id-A';
      if (bytes === PART_B_BYTES) return 'kernel-id-B';
      throw new Error('unexpected bytes in loadFromBytes');
    }),
    execute: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe('loadAssemblyForProjection', () => {
  it('T1: returns AssemblyComponentInput[] for 2-part flat assembly with composed world poses', async () => {
    const { loadAssemblyForProjection } = await import('../loadAssemblyForProjection');
    const opfs = makeOpfs();
    const kernel = makeKernel();

    const result = await loadAssemblyForProjection({
      asmPath: ASM_PATH,
      asmDoc,
      opfs: opfs as never,
      kernel: kernel as never,
    });

    expect(result.components).toHaveLength(2);

    // c1 has position {x:10,y:0,z:0}, no constraint solve → translation = {x:10,y:0,z:0}
    const compA = result.components.find((c) => c.partId === 'kernel-id-A');
    expect(compA).toBeDefined();
    expect(compA!.pose.translation).toEqual({ x: 10, y: 0, z: 0 });
    expect(compA!.pose.quaternion).toEqual([0, 0, 0, 1]);

    // c2 has position {x:-10,y:0,z:0}
    const compB = result.components.find((c) => c.partId === 'kernel-id-B');
    expect(compB).toBeDefined();
    expect(compB!.pose.translation).toEqual({ x: -10, y: 0, z: 0 });

    // kernel.execute called for each unique part
    expect(kernel.execute).toHaveBeenCalledTimes(2);
  });

  it('T2: composite fingerprint changes when one part bytes change; stable when unchanged', async () => {
    const { loadAssemblyForProjection } = await import('../loadAssemblyForProjection');
    const opfs = makeOpfs();
    const kernel = makeKernel();

    const r1 = await loadAssemblyForProjection({ asmPath: ASM_PATH, asmDoc, opfs: opfs as never, kernel: kernel as never });

    // Change part A bytes — use a separate kernel that handles the new bytes
    const CHANGED_A_BYTES = new Uint8Array([99, 88, 77]);
    const opfs2 = {
      ...opfs,
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === ASM_PATH)    return ASM_BYTES;
        if (path === PART_A_PATH) return CHANGED_A_BYTES;
        if (path === PART_B_PATH) return PART_B_BYTES;
        throw new Error(`unexpected: ${path}`);
      }),
    };
    // kernel2 handles the changed A bytes
    const kernel2 = {
      loadFromBytes: vi.fn().mockImplementation(async (bytes: Uint8Array) => {
        if (bytes === CHANGED_A_BYTES) return 'kernel-id-A';
        if (bytes === PART_B_BYTES)    return 'kernel-id-B';
        throw new Error('unexpected bytes in kernel2.loadFromBytes');
      }),
      execute: vi.fn().mockResolvedValue({ ok: true }),
    };
    const r2 = await loadAssemblyForProjection({ asmPath: ASM_PATH, asmDoc, opfs: opfs2 as never, kernel: kernel2 as never });

    expect(r2.sourceFingerprint).not.toBe(r1.sourceFingerprint);

    // Unchanged bytes → same fingerprint (new call with original opfs/kernel)
    const r3 = await loadAssemblyForProjection({ asmPath: ASM_PATH, asmDoc, opfs: opfs as never, kernel: makeKernel() as never });
    expect(r3.sourceFingerprint).toBe(r1.sourceFingerprint);
  });

  it('T3: invisible component excluded from components list', async () => {
    const { loadAssemblyForProjection } = await import('../loadAssemblyForProjection');
    const asmWithInvisible = makeAsmDoc({
      components: [
        { ...asmDoc.components[0]!, visible: true },
        { ...asmDoc.components[1]!, visible: false },
      ],
    });
    const opfs = makeOpfs();
    const kernel = makeKernel();

    const r = await loadAssemblyForProjection({ asmPath: ASM_PATH, asmDoc: asmWithInvisible, opfs: opfs as never, kernel: kernel as never });
    expect(r.components).toHaveLength(1);
    expect(r.components[0]!.partId).toBe('kernel-id-A');
  });

  it('T4: missing part file → throws OPFS_READ_FAILED (fail whole projection)', async () => {
    const { loadAssemblyForProjection } = await import('../loadAssemblyForProjection');
    const opfsWithMissing = {
      exists: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === ASM_PATH)    return ASM_BYTES;
        if (path === PART_A_PATH) return PART_A_BYTES;
        throw new Error(`OPFS_READ_FAILED: ${path}`);
      }),
    };
    const kernel = makeKernel();

    await expect(
      loadAssemblyForProjection({ asmPath: ASM_PATH, asmDoc, opfs: opfsWithMissing as never, kernel: kernel as never })
    ).rejects.toThrow('OPFS_READ_FAILED');
  });

  it('T5: all-invisible assembly → empty components, no error', async () => {
    const { loadAssemblyForProjection } = await import('../loadAssemblyForProjection');
    const allInvisible = makeAsmDoc({
      components: asmDoc.components.map((c) => ({ ...c, visible: false })),
    });
    const opfs = makeOpfs();
    const kernel = makeKernel();

    const r = await loadAssemblyForProjection({ asmPath: ASM_PATH, asmDoc: allInvisible, opfs: opfs as never, kernel: kernel as never });
    expect(r.components).toHaveLength(0);
    expect(typeof r.sourceFingerprint).toBe('string');
  });

  it('T6: 2-level nested assembly (top → sub-asm → leaf parts) yields nested leaf parts in components[]', async () => {
    // Fixture: top assembly has one sub-asm component; sub-asm has two leaf part components.
    // Verifies SubAssemblyCache.loadSubAssemblyTree resolves nested .ziasm → real leaves.
    const { loadAssemblyForProjection } = await import('../loadAssemblyForProjection');

    const SUB_ASM_PATH  = 'assemblies/sub.ziasm';
    const LEAF_C_PATH   = 'parts/partC.zipt';
    const LEAF_D_PATH   = 'parts/partD.zipt';
    const LEAF_C_BYTES  = new Uint8Array([10, 20, 30]);
    const LEAF_D_BYTES  = new Uint8Array([40, 50, 60]);

    // Sub-assembly document: two leaf parts
    const subAsmDoc: AssemblyDocument = {
      id: 'sub-asm',
      name: 'Sub',
      units: 'mm',
      parameters: {},
      components: [
        {
          id: 'sc1', partPath: LEAF_C_PATH,
          position: { x: 5, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 },
          visible: true, flexible: false,
        },
        {
          id: 'sc2', partPath: LEAF_D_PATH,
          position: { x: -5, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 },
          visible: true, flexible: false,
        },
      ],
      constraints: [],
      groundedComponentPaths: [],
      colors: {},
      bomItemNumbers: {},
      cutListItemNumbers: {},
      colorOverrides: {},
      properties: {},
      materials: [],
      hardware: [],
    };

    // Top assembly document: one sub-asm component
    const topAsmDoc: AssemblyDocument = {
      id: 'top-asm',
      name: 'Top',
      units: 'mm',
      parameters: {},
      components: [
        {
          id: 'tc1', partPath: SUB_ASM_PATH,
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 },
          visible: true, flexible: false,
        },
      ],
      constraints: [],
      groundedComponentPaths: [],
      colors: {},
      bomItemNumbers: {},
      cutListItemNumbers: {},
      colorOverrides: {},
      properties: {},
      materials: [],
      hardware: [],
    };

    // Mock SubAssemblyCache.loadSubAssemblyTree to inject the sub-asm doc
    // directly into the cache's private `entries` map — avoids real unpackAssembly.
    const { SubAssemblyCache } = await import('../../assembly/SubAssemblyCache');
    const mockLoadSubAsmTree = vi.spyOn(SubAssemblyCache.prototype, 'loadSubAssemblyTree').mockImplementation(
      async function (this: InstanceType<typeof SubAssemblyCache>, _rootDoc: AssemblyDocument): Promise<void> {
        // Inject the sub-assembly entry directly into the cache.
        // We access the private `entries` map via a cast — unit test only.
        (this as unknown as { entries: Map<string, unknown> }).entries.set(SUB_ASM_PATH, {
          kind: 'ok',
          partPath: SUB_ASM_PATH,
          doc: subAsmDoc,
        });
      }
    );

    const nestedOpfs = {
      exists: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === ASM_PATH)      return ASM_BYTES;       // top-asm bytes (for fingerprint)
        if (path === LEAF_C_PATH)   return LEAF_C_BYTES;
        if (path === LEAF_D_PATH)   return LEAF_D_BYTES;
        throw new Error(`unexpected read: ${path}`);
      }),
    };

    const nestedKernel = {
      loadFromBytes: vi.fn().mockImplementation(async (bytes: Uint8Array) => {
        if (bytes === LEAF_C_BYTES) return 'kernel-id-C';
        if (bytes === LEAF_D_BYTES) return 'kernel-id-D';
        throw new Error('unexpected bytes');
      }),
      execute: vi.fn().mockResolvedValue({ ok: true }),
    };

    const result = await loadAssemblyForProjection({
      asmPath: ASM_PATH,
      asmDoc: topAsmDoc,
      opfs: nestedOpfs as never,
      kernel: nestedKernel as never,
    });

    mockLoadSubAsmTree.mockRestore();

    // Both nested leaf parts must appear in components[] — NOT skipped as placeholders.
    expect(result.components).toHaveLength(2);
    expect(result.components.map((c) => c.partId).sort()).toEqual(['kernel-id-C', 'kernel-id-D']);
    expect(nestedKernel.execute).toHaveBeenCalledTimes(2);
  });
});
