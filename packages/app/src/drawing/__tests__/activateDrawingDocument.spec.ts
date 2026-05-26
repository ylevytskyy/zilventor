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
    } as never);
    vi.clearAllMocks();
  });

  it('happy path (part source): sets activeDocument + source slots', async () => {
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

  it('assembly source: setActiveDocument called, source-load skipped, slots null', async () => {
    const { loadDrawingSource } = await import('../loadDrawingSource');
    const { activateDrawingDocument } = await import('../activateDrawingDocument');
    const kernel = makeKernel();
    const opfs = makeOpfs(true);
    const asmDoc: DrawingDocument = {
      ...baseDoc,
      id: 'drw-asm',
      source: { partPath: 'assemblies/wardrobe.ziasm', sourceKind: 'assembly' },
    };
    await activateDrawingDocument(asmDoc, { kernel: kernel as never, opfs: opfs as never });

    const doc = useAppStore.getState().activeDocument;
    expect(doc?.kind).toBe('drawing');
    expect((doc as { kind: 'drawing'; document: DrawingDocument }).document.id).toBe('drw-asm');

    // loadDrawingSource must NOT be called for assembly
    expect(loadDrawingSource).not.toHaveBeenCalled();

    // Slots stay null
    const { partId, fingerprint } = getStoreSlots();
    expect(partId).toBeNull();
    expect(fingerprint).toBeNull();

    // Non-blocking notice
    expect(useAppStore.getState().statusMessage).toMatch(/assembly/i);
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
