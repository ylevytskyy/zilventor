// packages/app/src/store/__tests__/drawingDocState.spec.ts
import { describe, it, expect } from 'vitest';
import type { DrawingDocument } from '@zilventor/shared';
import { drawingDocState } from '../drawingDocState';

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
});
