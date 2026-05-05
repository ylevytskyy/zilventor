import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore, selectActiveDrawing } from '../useAppStore';
import type { PartDocument, AssemblyDocument, DrawingDocument } from '@zilventor/shared';

const makePart = (): PartDocument =>
  ({ id: 'p1', kind: 'part', name: 'Part', featureTree: [], parameters: {}, materials: [] } as unknown as PartDocument);

const makeAssembly = (): AssemblyDocument =>
  ({ id: 'a1', name: 'Asm', components: [], constraints: [], groundedComponentPaths: [],
     materials: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {} } as unknown as AssemblyDocument);

const makeDrawing = (): DrawingDocument =>
  ({ id: 'd1', name: 'Drawing', sourcePath: 'part.zipt', sheets: [], titleBlock: {} } as unknown as DrawingDocument);

beforeEach(() => {
  useAppStore.getState().setActiveDocument(null);
});

describe('activeDocument drawing arm', () => {
  it('setActiveDocument(null) → activePart null, activeAssembly null, activeDrawing null', () => {
    const s = useAppStore.getState();
    expect(s.activePart).toBeNull();
    expect(s.activeAssembly).toBeNull();
    expect(s.activeDrawing).toBeNull();
  });

  it('setActiveDocument(part) → activePart set, activeAssembly null, activeDrawing null', () => {
    const part = makePart();
    useAppStore.getState().setActiveDocument({ kind: 'part', document: part });
    const s = useAppStore.getState();
    expect(s.activePart).toBe(part);
    expect(s.activeAssembly).toBeNull();
    expect(s.activeDrawing).toBeNull();
  });

  it('setActiveDocument(assembly) → activePart null, activeAssembly set, activeDrawing null', () => {
    const asm = makeAssembly();
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    const s = useAppStore.getState();
    expect(s.activePart).toBeNull();
    expect(s.activeAssembly).toBe(asm);
    expect(s.activeDrawing).toBeNull();
  });

  it('setActiveDocument(drawing) → activePart null, activeAssembly null, activeDrawing set', () => {
    const drawing = makeDrawing();
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: drawing });
    const s = useAppStore.getState();
    expect(s.activePart).toBeNull();
    expect(s.activeAssembly).toBeNull();
    expect(s.activeDrawing).toBe(drawing);
    expect(selectActiveDrawing(s)).toBe(drawing);
  });

  it('selectActiveDrawing returns null when part is active', () => {
    useAppStore.getState().setActiveDocument({ kind: 'part', document: makePart() });
    expect(selectActiveDrawing(useAppStore.getState())).toBeNull();
  });
});
