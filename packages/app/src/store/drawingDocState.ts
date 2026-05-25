import type { DrawingDocument } from '@zilventor/shared';

/**
 * Derived store slice for "a drawing document is now active".
 * Spread into useAppStore.setState(...) so activeDrawing can never drift from
 * activeDocument — see docs/superpowers/specs/2026-05-25-active-drawing-audit-design.md.
 */
export function drawingDocState(nextDoc: DrawingDocument) {
  return {
    activeDocument: { kind: 'drawing' as const, document: nextDoc },
    activePart: null,
    activeAssembly: null,
    activeDrawing: nextDoc,
  };
}
