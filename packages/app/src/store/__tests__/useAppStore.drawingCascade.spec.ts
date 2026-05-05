import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../useAppStore';
import type { DrawingDocument } from '@zilventor/shared';

const makeDrawing = (): DrawingDocument =>
  ({ id: 'd1', name: 'Drawing', sourcePath: 'part.zipt', sheets: [], titleBlock: {} } as unknown as DrawingDocument);

beforeEach(() => {
  useAppStore.getState().setActiveDocument(null);
});

describe('store cascade — drawing kind no-ops assembly mutators', () => {
  it('setColorOverride is a no-op when drawing is active', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: makeDrawing() });
    const before = useAppStore.getState().activeDocument;
    useAppStore.getState().setColorOverride(['comp1'], { r: 1, g: 0, b: 0 });
    expect(useAppStore.getState().activeDocument).toBe(before); // reference unchanged
  });

  it('setComponentFlexible is a no-op when drawing is active', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: makeDrawing() });
    const before = useAppStore.getState().activeDocument;
    useAppStore.getState().setComponentFlexible('comp1', true);
    expect(useAppStore.getState().activeDocument).toBe(before);
  });

  it('switching to drawing clears activePart and activeAssembly', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: makeDrawing() });
    expect(useAppStore.getState().activePart).toBeNull();
    expect(useAppStore.getState().activeAssembly).toBeNull();
  });
});
