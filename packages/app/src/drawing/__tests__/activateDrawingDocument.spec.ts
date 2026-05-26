import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument } from '@zilventor/shared';

// Mock loadDrawingSource + cache-clear so we control results
vi.mock('../loadDrawingSource', () => ({
  loadDrawingSource: vi.fn().mockResolvedValue({
    partId: 'kernel-part-uuid-mock',
    sourceFingerprint: 'fp-mock-bytes-hash',
  }),
  _clearLoadDrawingSourceCache: vi.fn(),
}));

// Mock loadAssemblyForProjection so assembly tests don't need real OPFS/kernel
vi.mock('../loadAssemblyForProjection', () => ({
  loadAssemblyForProjection: vi.fn().mockResolvedValue({
    components: [
      { partId: 'pid-asm-A', pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
    ],
    sourceFingerprint: 'fp-asm-reopened',
  }),
}));

// Mock AssemblyPacker.unpackAssembly — called by the assembly branch before loadAssemblyForProjection
vi.mock('@zilventor/kernel/src/storage/AssemblyPacker', () => ({
  unpackAssembly: vi.fn().mockResolvedValue({
    id: 'asm-mock',
    name: 'Mock Assembly',
    units: 'mm',
    parameters: {},
    components: [],
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {},
    cutListItemNumbers: {},
    colorOverrides: {},
    properties: {},
    materials: [],
    hardware: [],
  }),
}));

// Mock Opfs — not used directly by activateDrawingDocument (passed via args) but
// Opfs.forNavigator may be imported by loadDrawingSource shim; mock defensively.
vi.mock('@zilventor/kernel/src/storage/Opfs', () => ({
  Opfs: {
    forNavigator: vi.fn().mockResolvedValue({
      read: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      exists: vi.fn().mockResolvedValue(true),
    }),
  },
}));

const baseDoc: DrawingDocument = {
  id: 'drw-1',
  name: 'Cabinet — Drawing',
  units: 'mm',
  source: { partPath: 'parts/cabinet.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [
    {
      id: 's1',
      name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [],
      dimensions: [],
      dimensionGroups: [],
      annotations: [],
      titleBlock: {},
    },
  ],
  activeSheetId: 's1',
};

function makeKernel() {
  return {
    loadFromBytes: vi.fn().mockResolvedValue('kernel-part-uuid-mock'),
    execute: vi.fn().mockResolvedValue({ ok: true }),
  };
}

function makeOpfs(existsResult = true) {
  return {
    exists: vi.fn().mockResolvedValue(existsResult),
    read: vi.fn().mockResolvedValue(new Uint8Array([10, 20, 30])),
  };
}

function getStoreSlots() {
  const s = useAppStore.getState() as unknown as {
    activeDrawingSourcePartId: string | null;
    activeDrawingSourceFingerprint: string | null;
  };
  return { partId: s.activeDrawingSourcePartId, fingerprint: s.activeDrawingSourceFingerprint };
}

describe('activateDrawingDocument', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDocument: null,
      activePart: null,
      activeAssembly: null,
      activeDrawingSourcePartId: null,
      activeDrawingSourceFingerprint: null,
      activeDrawingSourceComponents: null,
    } as never);
    vi.clearAllMocks();
  });

  it('happy path (part source): sets activeDocument + source slots + statusMessage "Opened"', async () => {
    const { activateDrawingDocument } = await import('../activateDrawingDocument');
    const kernel = makeKernel();
    const opfs = makeOpfs(true);
    await activateDrawingDocument(baseDoc, { kernel: kernel as never, opfs: opfs as never });

    // activeDocument set correctly
    const doc = useAppStore.getState().activeDocument;
    expect(doc?.kind).toBe('drawing');
    expect((doc as { kind: 'drawing'; document: DrawingDocument }).document.id).toBe('drw-1');

    // Source slots set from loadDrawingSource mock
    const { partId, fingerprint } = getStoreSlots();
    expect(partId).toBe('kernel-part-uuid-mock');
    expect(fingerprint).toBe('fp-mock-bytes-hash');

    // Status bar must say "Opened" on the happy path (so FileTab doesn't overwrite
    // assembly/missing-source notices set by activateDrawingDocument itself).
    expect(useAppStore.getState().statusMessage).toBe('Opened');
  });

  it('missing source (opfs.exists=false): drawing still activated, slots null, setStatus called', async () => {
    const { loadDrawingSource } = await import('../loadDrawingSource');
    (loadDrawingSource as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('OPFS_READ_FAILED: cannot load source part "parts/cabinet.zipt"')
    );
    const { activateDrawingDocument } = await import('../activateDrawingDocument');
    const kernel = makeKernel();
    const opfs = makeOpfs(false);
    await activateDrawingDocument(baseDoc, { kernel: kernel as never, opfs: opfs as never });

    // Drawing still activated
    const doc = useAppStore.getState().activeDocument;
    expect(doc?.kind).toBe('drawing');

    // Source slots remain null
    const { partId, fingerprint } = getStoreSlots();
    expect(partId).toBeNull();
    expect(fingerprint).toBeNull();

    // Status message shows notice
    expect(useAppStore.getState().statusMessage).toMatch(/source part/i);
  });

  it('assembly source (happy path): loads components, sets slots, status "Opened"', async () => {
    const { loadAssemblyForProjection } = await import('../loadAssemblyForProjection');
    const { activateDrawingDocument } = await import('../activateDrawingDocument');
    const kernel = makeKernel();
    const opfs = makeOpfs(true);
    const asmDoc: DrawingDocument = {
      ...baseDoc,
      id: 'drw-asm',
      source: { partPath: 'assemblies/wardrobe.ziasm', sourceKind: 'assembly' },
    };

    await activateDrawingDocument(asmDoc, { kernel: kernel as never, opfs: opfs as never });

    // loadAssemblyForProjection was called
    expect(loadAssemblyForProjection).toHaveBeenCalled();

    const s = useAppStore.getState() as unknown as {
      activeDrawingSourceComponents: unknown;
      activeDrawingSourceFingerprint: string | null;
      activeDrawingSourcePartId: string | null;
    };
    expect(s.activeDrawingSourceComponents).toEqual([
      { partId: 'pid-asm-A', pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
    ]);
    expect(s.activeDrawingSourceFingerprint).toBe('fp-asm-reopened');
    expect(s.activeDrawingSourcePartId).toBeNull();
    expect(useAppStore.getState().statusMessage).toBe('Opened');
  });

  it('assembly source (load failure): drawing activated, slots null, setStatus notice', async () => {
    const { loadAssemblyForProjection } = await import('../loadAssemblyForProjection');
    (loadAssemblyForProjection as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('OPFS_READ_FAILED: assemblies/wardrobe.ziasm')
    );
    const { activateDrawingDocument } = await import('../activateDrawingDocument');
    const kernel = makeKernel();
    const opfs = makeOpfs(true);
    const asmDoc: DrawingDocument = {
      ...baseDoc,
      id: 'drw-asm2',
      source: { partPath: 'assemblies/wardrobe.ziasm', sourceKind: 'assembly' },
    };

    await activateDrawingDocument(asmDoc, { kernel: kernel as never, opfs: opfs as never });

    const doc = useAppStore.getState().activeDocument;
    expect(doc?.kind).toBe('drawing');

    const s = useAppStore.getState() as unknown as { activeDrawingSourceComponents: unknown };
    expect(s.activeDrawingSourceComponents).toBeNull();
    expect(useAppStore.getState().statusMessage).toMatch(/assembly.*failed|failed.*assembly|source.*not found/i);
  });

  it('clears the loadDrawingSource cache before loading (fresh OPFS read)', async () => {
    const { _clearLoadDrawingSourceCache } = await import('../loadDrawingSource');
    const { activateDrawingDocument } = await import('../activateDrawingDocument');
    const kernel = makeKernel();
    const opfs = makeOpfs(true);
    await activateDrawingDocument(baseDoc, { kernel: kernel as never, opfs: opfs as never });
    expect(_clearLoadDrawingSourceCache).toHaveBeenCalledOnce();
  });
});
