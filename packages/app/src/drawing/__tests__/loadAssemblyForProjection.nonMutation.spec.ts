// @vitest-environment node
//
// R6 guardrail (docs/abf-plugin/05-parity/03-processing-parity-requirements.md:116-134):
// assembly-sourced drawing generation must be a pure, read-only projection over the
// source model. This spec exercises the real loadAssemblyForProjection (the function
// CreateDrawingCommand.ts:124-129 calls for sourceKind === 'assembly') against a fake
// OPFS-backed byte store and asserts the store is byte-identical before/after, and
// that regeneration after a real source change is not a no-op.
import { describe, it, expect, vi } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';

const PART_A_PATH = 'parts/partA.zipt';
const PART_B_PATH = 'parts/partB.zipt';
const ASM_PATH = 'assemblies/top.ziasm';

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

function makeKernel() {
  return {
    loadFromBytes: vi.fn().mockImplementation(async () => 'kernel-id'),
    execute: vi.fn().mockResolvedValue({ ok: true }),
  };
}

/**
 * Fake OPFS-backed byte store keyed by path, standing in for a real .ziasm/.zipt
 * OPFS filesystem. `mutateOnRead`, when true, deliberately simulates a *buggy* read
 * path that corrupts the stored bytes in place on every read — used ONLY to prove
 * the non-mutation assertion below genuinely fails when the store really changes
 * (RED check on the test itself), then flipped to false to exercise the real
 * (non-mutating) loadAssemblyForProjection contract (GREEN).
 */
function makeStore(mutateOnRead: boolean) {
  const store = new Map<string, Uint8Array>();
  store.set(ASM_PATH, new Uint8Array([7, 8, 9]));
  store.set(PART_A_PATH, new Uint8Array([1, 2, 3]));
  store.set(PART_B_PATH, new Uint8Array([4, 5, 6]));

  const opfs = {
    exists: vi.fn().mockResolvedValue(true),
    read: vi.fn().mockImplementation(async (path: string) => {
      const bytes = store.get(path);
      if (!bytes) throw new Error(`unexpected read: ${path}`);
      if (mutateOnRead) {
        bytes[0] = (bytes[0]! + 1) & 0xff; // deliberate fixture corruption for the RED check
      }
      return bytes;
    }),
  };

  return { store, opfs };
}

describe('loadAssemblyForProjection — R6 non-mutation guardrail', () => {
  it('does not mutate source .ziasm/.zipt bytes during projection', async () => {
    const { loadAssemblyForProjection } = await import('../loadAssemblyForProjection');
    const { store, opfs } = makeStore(false);
    const asmDoc = makeAsmDoc();
    const kernel = makeKernel();

    const before = new Map<string, Uint8Array>();
    for (const [path, bytes] of store) before.set(path, bytes.slice());

    await loadAssemblyForProjection({
      asmPath: ASM_PATH,
      asmDoc,
      opfs: opfs as never,
      kernel: kernel as never,
    });

    for (const [path, snapshot] of before) {
      expect(store.get(path)).toEqual(snapshot);
    }
  });

  it('regeneration is not a no-op: fingerprint changes when a part changes, store stays exact', async () => {
    const { loadAssemblyForProjection } = await import('../loadAssemblyForProjection');
    const { store, opfs } = makeStore(false);
    const asmDoc = makeAsmDoc();

    const r1 = await loadAssemblyForProjection({
      asmPath: ASM_PATH,
      asmDoc,
      opfs: opfs as never,
      kernel: makeKernel() as never,
    });

    const changedA = new Uint8Array([99, 88, 77]);
    store.set(PART_A_PATH, changedA);

    const r2 = await loadAssemblyForProjection({
      asmPath: ASM_PATH,
      asmDoc,
      opfs: opfs as never,
      kernel: makeKernel() as never,
    });

    expect(r2.sourceFingerprint).not.toBe(r1.sourceFingerprint);
    expect(store.get(PART_A_PATH)).toEqual(changedA);
    expect(store.get(PART_B_PATH)).toEqual(new Uint8Array([4, 5, 6]));
  });
});
