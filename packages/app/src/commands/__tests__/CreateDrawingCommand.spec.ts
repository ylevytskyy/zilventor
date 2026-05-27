// packages/app/src/commands/__tests__/CreateDrawingCommand.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { CreateDrawingCommand } from '../CreateDrawingCommand';
import type { DrawingDocument, AssemblyDocument } from '@zilventor/shared';
import * as deleteModule from '../../storage/deleteDrawingFromOpfs';

// Stub OPFS: CreateDrawingCommand calls saveDrawingToOpfs / deleteDrawingFromOpfs which we mock
vi.mock('../../storage/saveDrawingToOpfs', () => ({
  saveDrawingToOpfs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../storage/deleteDrawingFromOpfs', () => ({
  deleteDrawingFromOpfs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../drawing/loadDrawingSource', () => ({
  loadDrawingSource: vi.fn().mockResolvedValue({ partId: 'kernel-part-uuid-from-load', sourceFingerprint: 'fp-bytes-hash-abc', sourceDocument: null }),
  _clearLoadDrawingSourceCache: vi.fn(),
}));

vi.mock('../../drawing/loadAssemblyForProjection', () => ({
  loadAssemblyForProjection: vi.fn().mockResolvedValue({
    components: [
      { partId: 'pid-A', pose: { translation: { x: 10, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
    ],
    sourceFingerprint: 'fp-asm-mock',
  }),
}));

vi.mock('@zilventor/kernel/src/storage/Opfs', () => ({
  Opfs: {
    forNavigator: vi.fn().mockResolvedValue({
      read: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      exists: vi.fn().mockResolvedValue(true),
    }),
  },
}));

function makeAsmDoc(): AssemblyDocument {
  return {
    id: 'asm-1', name: 'Cabinet', units: 'mm',
    parameters: {}, properties: {}, components: [], constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
    cutListItemNumbers: {}, colorOverrides: {}, materials: [], hardware: [],
  };
}

function getDrawing(): DrawingDocument | null {
  const doc = useAppStore.getState().activeDocument as unknown as { kind: string; document: DrawingDocument } | null;
  if (!doc || doc.kind !== 'drawing') return null;
  return doc.document;
}

describe('CreateDrawingCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: null, activePart: null, activeAssembly: null, activeDrawingSourcePartId: null, activeDrawingSourceFingerprint: null, activeDrawingSourceComponents: null } as never);
  });

  it('apply creates a drawing document with one A3-landscape sheet', async () => {
    const cmd = new CreateDrawingCommand({
      sourcePath: 'parts/cabinet1.zipt',
      sourceKind: 'part',
    });
    await cmd.apply();

    const doc = getDrawing();
    expect(doc).not.toBeNull();
    expect(doc!.source.partPath).toBe('parts/cabinet1.zipt');
    expect(doc!.source.sourceKind).toBe('part');
    expect(doc!.sheets).toHaveLength(1);
    expect(doc!.sheets[0]!.size).toEqual({ kind: 'iso', size: 'A3' });
    expect(doc!.sheets[0]!.orientation).toBe('landscape');
    expect(doc!.activeSheetId).toBe(doc!.sheets[0]!.id);
  });

  it('apply uses provided sheetSize when given', async () => {
    const cmd = new CreateDrawingCommand({
      sourcePath: 'parts/p.zipt',
      sourceKind: 'part',
      sheetSize: { kind: 'iso', size: 'A4' },
    });
    await cmd.apply();
    const doc = getDrawing();
    expect(doc!.sheets[0]!.size).toEqual({ kind: 'iso', size: 'A4' });
  });

  it('revert removes the drawing and restores prior activeDocument', async () => {
    const cmd = new CreateDrawingCommand({ sourcePath: 'parts/p.zipt', sourceKind: 'part' });
    await cmd.apply();
    expect(getDrawing()).not.toBeNull();

    await cmd.revert();
    expect(useAppStore.getState().activeDocument).toBeNull();
  });

  it('revert restores a previously active part document', async () => {
    // Set up a prior part document
    const priorPart = { id: 'p1', name: 'P', units: 'mm' as const, featureTree: [], parameters: {}, parameterRefs: [], sketches: [], properties: {}, materials: [], hardware: [] };
    useAppStore.setState({
      activeDocument: { kind: 'part', document: priorPart },
      activePart: priorPart,
    } as never);

    const cmd = new CreateDrawingCommand({ sourcePath: 'parts/p.zipt', sourceKind: 'part' });
    await cmd.apply();
    expect(getDrawing()).not.toBeNull();

    await cmd.revert();
    const doc = useAppStore.getState().activeDocument;
    expect(doc?.kind).toBe('part');
  });

  it('drawing gets a unique id each call', async () => {
    const cmd1 = new CreateDrawingCommand({ sourcePath: 'parts/p.zipt', sourceKind: 'part' });
    const cmd2 = new CreateDrawingCommand({ sourcePath: 'parts/p.zipt', sourceKind: 'part' });
    await cmd1.apply();
    const id1 = getDrawing()!.id;
    await cmd1.revert();
    await cmd2.apply();
    const id2 = getDrawing()!.id;
    expect(id1).not.toBe(id2);
  });

  it('revert calls deleteDrawingFromOpfs with the created drawing id', async () => {
    const deleteSpy = vi.spyOn(deleteModule, 'deleteDrawingFromOpfs');
    const cmd = new CreateDrawingCommand({ sourcePath: 'parts/p.zipt', sourceKind: 'part' });
    await cmd.apply();
    const createdId = getDrawing()!.id;

    await cmd.revert();

    expect(deleteSpy).toHaveBeenCalledOnce();
    expect(deleteSpy).toHaveBeenCalledWith(createdId);
  });

  it('apply sets activeDrawingSourcePartId + activeDrawingSourceFingerprint from loadDrawingSource when sourceKind is part', async () => {
    const cmd = new CreateDrawingCommand({
      sourcePath: 'parts/cabinet1.zipt',
      sourceKind: 'part',
    });
    useAppStore.setState({ kernel: { loadFromBytes: vi.fn(), execute: vi.fn() } as never } as never);
    await cmd.apply();

    const s = useAppStore.getState() as unknown as {
      activeDrawingSourcePartId: string | null;
      activeDrawingSourceFingerprint: string | null;
    };
    expect(s.activeDrawingSourcePartId).toBe('kernel-part-uuid-from-load');
    expect(s.activeDrawingSourceFingerprint).toBe('fp-bytes-hash-abc');
  });

  it('apply (assembly source): sets activeDrawingSourceComponents + activeDrawingSourceFingerprint', async () => {
    const cmd = new CreateDrawingCommand({
      sourcePath: 'assemblies/cabinet.ziasm',
      sourceKind: 'assembly',
    });
    const fakeAsmDoc = makeAsmDoc();
    useAppStore.setState({ activeAssembly: fakeAsmDoc, kernel: { loadFromBytes: vi.fn(), execute: vi.fn() } as never } as never);

    await cmd.apply();

    const s = useAppStore.getState() as unknown as {
      activeDrawingSourceComponents: unknown;
      activeDrawingSourceFingerprint: string | null;
      activeDrawingSourcePartId: string | null;
    };
    expect(s.activeDrawingSourceComponents).toEqual([
      { partId: 'pid-A', pose: { translation: { x: 10, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
    ]);
    expect(s.activeDrawingSourceFingerprint).toBe('fp-asm-mock');
    // Part slot must remain null for assembly drawings
    expect(s.activeDrawingSourcePartId).toBeNull();
  });

  it('revert (assembly source): clears activeDrawingSourceComponents', async () => {
    const cmd = new CreateDrawingCommand({
      sourcePath: 'assemblies/cabinet.ziasm',
      sourceKind: 'assembly',
    });
    const fakeAsmDoc = makeAsmDoc();
    useAppStore.setState({ activeAssembly: fakeAsmDoc, kernel: { loadFromBytes: vi.fn(), execute: vi.fn() } as never } as never);

    await cmd.apply();
    await cmd.revert();

    const s = useAppStore.getState() as unknown as { activeDrawingSourceComponents: unknown };
    expect(s.activeDrawingSourceComponents).toBeNull();
  });

  it('revert resets both source slots to null', async () => {
    const cmd = new CreateDrawingCommand({
      sourcePath: 'parts/cabinet1.zipt',
      sourceKind: 'part',
    });
    useAppStore.setState({ kernel: { loadFromBytes: vi.fn(), execute: vi.fn() } as never } as never);
    await cmd.apply();
    await cmd.revert();

    const s = useAppStore.getState() as unknown as {
      activeDrawingSourcePartId: string | null;
      activeDrawingSourceFingerprint: string | null;
    };
    expect(s.activeDrawingSourcePartId).toBeNull();
    expect(s.activeDrawingSourceFingerprint).toBeNull();
  });

  it('part: sets activeDrawingSourceDocument from the captured activePart (fallback when sourceDocument null)', async () => {
    const partDoc = { id: 'p1', name: 'Widget', units: 'mm' as const, parameters: {},
      featureTree: [], properties: {}, materials: [], hardware: [] };
    useAppStore.setState({ activePart: partDoc, activeAssembly: null } as never);

    await new CreateDrawingCommand({ sourcePath: 'p1.zipt', sourceKind: 'part' }).apply();

    const s = useAppStore.getState() as unknown as { activeDrawingSourceDocument: unknown };
    expect(s.activeDrawingSourceDocument).toMatchObject({ id: 'p1', name: 'Widget' });
  });

  it('assembly: sets activeDrawingSourceDocument from the captured activeAssembly', async () => {
    const asmDoc = makeAsmDoc();
    useAppStore.setState({ activePart: null, activeAssembly: asmDoc } as never);

    await new CreateDrawingCommand({ sourcePath: 'a1.ziasm', sourceKind: 'assembly' }).apply();

    const s = useAppStore.getState() as unknown as { activeDrawingSourceDocument: unknown };
    expect(s.activeDrawingSourceDocument).toMatchObject({ id: 'asm-1', name: 'Cabinet' });
  });

  it('revert restores the prior activeDrawingSourceDocument', async () => {
    const prior = { id: 'prev', name: 'Prev', units: 'mm' as const, parameters: {},
      featureTree: [], properties: {}, materials: [], hardware: [] };
    const partDoc = { id: 'p1', name: 'Widget', units: 'mm' as const, parameters: {},
      featureTree: [], properties: {}, materials: [], hardware: [] };
    useAppStore.setState({ activeDrawingSourceDocument: prior, activePart: partDoc } as never);

    const cmd = new CreateDrawingCommand({ sourcePath: 'p1.zipt', sourceKind: 'part' });
    await cmd.apply();
    await cmd.revert();

    const s = useAppStore.getState() as unknown as { activeDrawingSourceDocument: unknown };
    expect(s.activeDrawingSourceDocument).toBe(prior);
  });

  it('part: activeDrawingSourceDocument is set to the fresh activePart even when kernel is null (no stale-source leak)', async () => {
    // Seed a STALE source document from a hypothetically previous drawing.
    const staleDoc = { id: 'stale', name: 'StaleDrawing' };
    const freshPart = { id: 'p-fresh', name: 'FreshPart', units: 'mm' as const, parameters: {},
      featureTree: [], properties: {}, materials: [], hardware: [] };
    // kernel=null so the `if (kernel)` branch is skipped entirely — previously the
    // only place that wrote activeDrawingSourceDocument was INSIDE that branch.
    useAppStore.setState({
      activeDrawingSourceDocument: staleDoc,
      activePart: freshPart,
      kernel: null,
    } as never);

    const cmd = new CreateDrawingCommand({ sourcePath: 'p-fresh.zipt', sourceKind: 'part' });
    await cmd.apply();

    const s = useAppStore.getState() as unknown as { activeDrawingSourceDocument: unknown };
    // Must be the fresh part, NOT the stale doc from the previous drawing.
    expect(s.activeDrawingSourceDocument).toMatchObject({ id: 'p-fresh' });
  });
});
