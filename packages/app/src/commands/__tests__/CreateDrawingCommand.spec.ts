// packages/app/src/commands/__tests__/CreateDrawingCommand.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { CreateDrawingCommand } from '../CreateDrawingCommand';
import type { DrawingDocument } from '@zilventor/shared';

// Stub OPFS: CreateDrawingCommand calls saveDrawingToOpfs which we mock
vi.mock('../../storage/saveDrawingToOpfs', () => ({
  saveDrawingToOpfs: vi.fn().mockResolvedValue(undefined),
}));

function getDrawing(): DrawingDocument | null {
  const doc = useAppStore.getState().activeDocument as unknown as { kind: string; document: DrawingDocument } | null;
  if (!doc || doc.kind !== 'drawing') return null;
  return doc.document;
}

describe('CreateDrawingCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: null, activePart: null, activeAssembly: null } as never);
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
});
