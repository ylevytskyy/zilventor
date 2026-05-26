import type { DrawingDocument } from '@zilventor/shared';

/**
 * Derived store slice for "a drawing document is now active".
 * Spread into useAppStore.setState(...) so activeDrawing can never drift from
 * activeDocument — see docs/superpowers/specs/2026-05-25-active-drawing-audit-design.md.
 *
 * Does NOT reset activeDrawingSourcePartId / activeDrawingSourceFingerprint /
 * activeDrawingSourceComponents — those are set by CreateDrawingCommand → loadDrawingSource
 * (part) or loadAssemblyForProjection (assembly) on drawing activation and must survive all
 * subsequent drawing edit operations (AddBaseViewCommand, AddIsoViewCommand, etc.) that call
 * drawingDocState to update the document. Resetting them here would clear the source identity
 * on every view add and break projectViewFromSource.
 */
export function drawingDocState(nextDoc: DrawingDocument) {
  return {
    activeDocument: { kind: 'drawing' as const, document: nextDoc },
    activePart: null,
    activeAssembly: null,
    activeDrawing: nextDoc,
  };
}
