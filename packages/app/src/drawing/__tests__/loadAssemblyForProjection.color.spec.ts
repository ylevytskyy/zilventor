// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';

// ---- Module mocks (hoisted by Vitest) ----
vi.mock('@zilventor/kernel/src/storage/ProjectPacker', () => ({
  unpackProject: vi.fn(),
}));
vi.mock('@zilventor/shared', async (importActual) => ({
  ...(await importActual<typeof import('@zilventor/shared')>()),
  migrateManifest: vi.fn((m: unknown) => m), // passthrough → migrated.document === manifest.document
}));

import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';

// ---- Fixtures ----
const PART_A_PATH = 'parts/partA.zipt';
const PART_B_PATH = 'parts/partB.zipt';
const ASM_PATH = 'assemblies/top.ziasm';
const PART_A_BYTES = new Uint8Array([1, 2, 3]);
const PART_B_BYTES = new Uint8Array([4, 5, 6]);
const ASM_BYTES = new Uint8Array([7, 8, 9]);

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
      if (path === ASM_PATH) return ASM_BYTES;
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

describe('loadAssemblyForProjection componentColors', () => {
  it('maps each kernel partId to its primary material color', async () => {
    // Set up unpackProject to return distinct colors for each part
    vi.mocked(unpackProject)
      .mockResolvedValueOnce({
        manifest: {
          document: {
            materials: [{ id: 'm1', name: 'oak', defaultThickness: 18, color: '#aa0000' }],
          },
        },
      } as never)
      .mockResolvedValueOnce({
        manifest: {
          document: {
            materials: [{ id: 'm2', name: 'steel', defaultThickness: 3, color: '#0000bb' }],
          },
        },
      } as never);

    const { loadAssemblyForProjection } = await import('../loadAssemblyForProjection');
    const opfs = makeOpfs();
    const kernel = makeKernel();

    const { components, componentColors } = await loadAssemblyForProjection({
      asmPath: ASM_PATH,
      asmDoc,
      opfs: opfs as never,
      kernel: kernel as never,
    });

    // Each component's partId must have a corresponding color entry
    const colors = components.map((c) => componentColors[c.partId]);
    expect(new Set(colors)).toEqual(new Set(['#aa0000', '#0000bb']));
  });

  it('omits partId from componentColors when manifest has no materials', async () => {
    vi.mocked(unpackProject)
      .mockResolvedValueOnce({
        manifest: {
          document: {
            materials: [],
          },
        },
      } as never)
      .mockResolvedValueOnce({
        manifest: {
          document: {
            materials: [{ id: 'm2', name: 'steel', defaultThickness: 3, color: '#0000bb' }],
          },
        },
      } as never);

    const { loadAssemblyForProjection } = await import('../loadAssemblyForProjection');
    const opfs = makeOpfs();
    const kernel = makeKernel();

    const { componentColors } = await loadAssemblyForProjection({
      asmPath: ASM_PATH,
      asmDoc,
      opfs: opfs as never,
      kernel: kernel as never,
    });

    // Part A has no materials → no entry in componentColors
    expect(componentColors['kernel-id-A']).toBeUndefined();
    // Part B has a color
    expect(componentColors['kernel-id-B']).toBe('#0000bb');
  });
});
