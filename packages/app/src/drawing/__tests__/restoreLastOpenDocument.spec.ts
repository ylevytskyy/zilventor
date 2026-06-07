import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../storage/lastOpenDocument', () => ({
  getLastOpenDocument: vi.fn(),
  clearLastOpen: vi.fn(),
}));

vi.mock('../../storage/DrawingPacker', () => ({
  unpackDrawing: vi.fn(),
}));

vi.mock('@zilventor/kernel/src/storage/AssemblyPacker', () => ({
  unpackAssembly: vi.fn(),
  unpackAssemblyWithTextures: vi.fn().mockResolvedValue({ doc: undefined, textures: {} }),
}));

vi.mock('../activateDrawingDocument', () => ({
  activateDrawingDocument: vi.fn().mockResolvedValue(undefined),
}));

import { getLastOpenDocument, clearLastOpen } from '../../storage/lastOpenDocument';
import { unpackDrawing } from '../../storage/DrawingPacker';
import { unpackAssembly, unpackAssemblyWithTextures } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { activateDrawingDocument } from '../activateDrawingDocument';
import { restoreLastOpenDocument } from '../restoreLastOpenDocument';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument } from '@zilventor/shared';

const baseDrawingDoc: DrawingDocument = {
  id: 'drw-restore',
  name: 'Restored Drawing',
  units: 'mm',
  source: { partPath: 'parts/cab.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [],
  activeSheetId: '',
};

function makeOpfs(existsResult = true) {
  return {
    exists: vi.fn().mockResolvedValue(existsResult),
    read: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    write: vi.fn(),
    delete: vi.fn(),
    listAll: vi.fn(),
  };
}

function makeKernel() {
  return {
    loadFromBytes: vi.fn().mockResolvedValue('kernel-part-id'),
    execute: vi.fn().mockResolvedValue({ ok: true }),
    getPart: vi.fn(), // set per-test
  };
}

describe('restoreLastOpenDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      activeDocument: null,
      activePart: null,
      activeAssembly: null,
      activeDrawing: null,
    } as never);
  });

  // ─── Drawing path (existing) ─────────────────────────────────────────────

  it('returns false immediately when getLastOpenDocument returns null', async () => {
    (getLastOpenDocument as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const opfs = makeOpfs();
    const kernel = makeKernel();

    const result = await restoreLastOpenDocument({ kernel: kernel as never, opfs });

    expect(result).toBe(false);
    expect(opfs.exists).not.toHaveBeenCalled();
    expect(activateDrawingDocument).not.toHaveBeenCalled();
  });

  it('drawing happy path: reads OPFS file, unpacks, activates, returns true', async () => {
    (getLastOpenDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      kind: 'drawing',
      opfsPath: 'drawings/drw-restore.zidw',
    });
    (unpackDrawing as ReturnType<typeof vi.fn>).mockResolvedValue(baseDrawingDoc);
    const opfs = makeOpfs(true);
    const kernel = makeKernel();

    const result = await restoreLastOpenDocument({ kernel: kernel as never, opfs });

    expect(result).toBe(true);
    expect(opfs.exists).toHaveBeenCalledWith('drawings/drw-restore.zidw');
    expect(opfs.read).toHaveBeenCalledWith('drawings/drw-restore.zidw');
    expect(unpackDrawing).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(activateDrawingDocument).toHaveBeenCalledWith(baseDrawingDoc, {
      kernel: kernel,
      opfs,
    });
    expect(clearLastOpen).not.toHaveBeenCalled();
  });

  it('OPFS file missing: clears pointer, returns false, does not call activateDrawingDocument', async () => {
    (getLastOpenDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      kind: 'drawing',
      opfsPath: 'drawings/ghost.zidw',
    });
    const opfs = makeOpfs(false); // exists = false
    const kernel = makeKernel();

    const result = await restoreLastOpenDocument({ kernel: kernel as never, opfs });

    expect(result).toBe(false);
    expect(clearLastOpen).toHaveBeenCalled();
    expect(activateDrawingDocument).not.toHaveBeenCalled();
  });

  it('corrupt bytes (unpackDrawing throws): clears pointer, returns false, does not throw', async () => {
    (getLastOpenDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      kind: 'drawing',
      opfsPath: 'drawings/corrupt.zidw',
    });
    (unpackDrawing as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('DrawingPacker: malformed manifest.json'),
    );
    const opfs = makeOpfs(true);
    const kernel = makeKernel();

    await expect(
      restoreLastOpenDocument({ kernel: kernel as never, opfs }),
    ).resolves.toBe(false);

    expect(clearLastOpen).toHaveBeenCalled();
    expect(activateDrawingDocument).not.toHaveBeenCalled();
  });

  // ─── Part path ────────────────────────────────────────────────────────────

  it('part pointer: loadFromBytes→execute→getPart→setActiveDocument(part)', async () => {
    const partDoc = {
      id: 'kernel-part-id',
      name: 'Cabinet',
      units: 'mm' as const,
      featureTree: [],
      materials: [],
      hardware: [],
      parameters: {},
      properties: {},
    };
    (getLastOpenDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      kind: 'part',
      opfsPath: 'Cabinet.zipt',
    });
    const kernel = makeKernel();
    kernel.getPart.mockResolvedValue(partDoc);
    const opfs = makeOpfs(true);

    const ok = await restoreLastOpenDocument({ kernel: kernel as never, opfs });

    expect(ok).toBe(true);
    expect(kernel.loadFromBytes).toHaveBeenCalled();
    expect(kernel.execute).toHaveBeenCalledWith('kernel-part-id');
    expect(kernel.getPart).toHaveBeenCalledWith('kernel-part-id');
    const active = useAppStore.getState().activeDocument;
    expect(active?.kind).toBe('part');
    expect((active as { document: unknown }).document).toBe(partDoc);
  });

  it('assembly pointer: unpackAssembly→setActiveDocument(assembly), no kernel load', async () => {
    const asmDoc = {
      id: 'asm1',
      name: 'Kitchen',
      units: 'mm' as const,
      components: [],
      materials: [],
      hardware: [],
      parameters: {},
      constraints: [],
      groundedComponentPaths: [],
      colors: {},
      bomItemNumbers: {},
      cutListItemNumbers: {},
      colorOverrides: {},
      properties: {},
    };
    (getLastOpenDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      kind: 'assembly',
      opfsPath: 'Kitchen.ziasm',
    });
    // Production code calls unpackAssemblyWithTextures (not unpackAssembly) for assembly docs.
    (unpackAssembly as ReturnType<typeof vi.fn>).mockResolvedValue(asmDoc);
    vi.mocked(unpackAssemblyWithTextures).mockResolvedValue({ doc: asmDoc, textures: {} });
    const kernel = makeKernel();
    const ok = await restoreLastOpenDocument({ kernel: kernel as never, opfs: makeOpfs(true) });

    expect(ok).toBe(true);
    expect(kernel.loadFromBytes).not.toHaveBeenCalled();
    expect(useAppStore.getState().activeDocument?.kind).toBe('assembly');
    expect((useAppStore.getState().activeDocument as { document: unknown }).document).toBe(asmDoc);
  });

  it('part pointer: execute failure clears pointer, returns false, no setActiveDocument', async () => {
    (getLastOpenDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      kind: 'part',
      opfsPath: 'Cabinet.zipt',
    });
    const kernel = makeKernel();
    kernel.execute.mockResolvedValue({ ok: false, error: 'boom' });
    const ok = await restoreLastOpenDocument({ kernel: kernel as never, opfs: makeOpfs(true) });

    expect(ok).toBe(false);
    expect(clearLastOpen).toHaveBeenCalled();
    expect(useAppStore.getState().activeDocument).toBeNull();
  });

  it('part pointer: getPart returns null clears pointer, returns false, no setActiveDocument', async () => {
    (getLastOpenDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      kind: 'part',
      opfsPath: 'Cabinet.zipt',
    });
    const kernel = makeKernel();
    kernel.getPart.mockResolvedValue(null);
    const ok = await restoreLastOpenDocument({ kernel: kernel as never, opfs: makeOpfs(true) });

    expect(ok).toBe(false);
    expect(clearLastOpen).toHaveBeenCalled();
    expect(useAppStore.getState().activeDocument).toBeNull();
  });
});
