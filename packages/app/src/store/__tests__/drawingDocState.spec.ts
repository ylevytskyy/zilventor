// packages/app/src/store/__tests__/drawingDocState.spec.ts
import { describe, it, expect } from 'vitest';
import type { DrawingDocument } from '@zilventor/shared';
import { drawingDocState } from '../drawingDocState';
import { useAppStore } from '../useAppStore';

const doc = { id: 'd1', name: 'D', units: 'mm' } as unknown as DrawingDocument;

describe('drawingDocState', () => {
  it('returns the full derived drawing slice with activeDrawing === the doc', () => {
    const slice = drawingDocState(doc);
    expect(slice.activeDocument).toEqual({ kind: 'drawing', document: doc });
    expect(slice.activeDrawing).toBe(doc);
    expect(slice.activePart).toBeNull();
    expect(slice.activeAssembly).toBeNull();
  });

  it('activeDrawing is referentially identical to activeDocument.document', () => {
    const slice = drawingDocState(doc);
    expect(slice.activeDrawing).toBe(slice.activeDocument.document);
  });

  it('preserves activeDrawingSourceDocument across a drawingDocState write', () => {
    const stubDoc = { id: 'p1', name: 'Widget', units: 'mm', parameters: {},
      featureTree: [], properties: {}, materials: [], hardware: [] };
    useAppStore.setState({ activeDrawingSourceDocument: stubDoc } as never);

    const nextDrawing = { ...doc };
    useAppStore.setState(drawingDocState(nextDrawing as unknown as DrawingDocument));

    expect((useAppStore.getState() as never as { activeDrawingSourceDocument: unknown })
      .activeDrawingSourceDocument).toBe(stubDoc);
  });
});
