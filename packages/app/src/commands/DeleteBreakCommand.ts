// packages/app/src/commands/DeleteBreakCommand.ts
import type { Command } from './Command';
import type { DrawingDocument, BreakRegion, ProjectedGeometry } from '@zilventor/shared';
import { applyBreaks, fingerprintBreaksArray } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type DeleteBreakOpts = {
  drawingId: string;
  sheetId: string;
  viewId: string;
  breakId: string;
};

export class DeleteBreakCommand implements Command {
  readonly name = 'DeleteBreak';
  private deletedBreak: BreakRegion | null = null;
  private savedRawProjection: ProjectedGeometry | undefined = undefined;
  private savedPriorProjection: ProjectedGeometry | undefined = undefined;
  private savedPriorFingerprint: string | undefined = undefined;
  private applied = false;

  constructor(private readonly opts: DeleteBreakOpts) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;
    const sheet = drawing.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) throw new Error('view-not-found');

    const view = sheet.views.find(v => v.id === this.opts.viewId);
    if (!view) throw new Error('view-not-found');

    const existingBreaks: readonly BreakRegion[] =
      (view as { breaks?: readonly BreakRegion[] }).breaks ?? [];
    const targetBreak = existingBreaks.find(b => b.id === this.opts.breakId);
    if (!targetBreak) throw new Error('break-not-found');

    const rawProj = (view as { rawProjection?: ProjectedGeometry }).rawProjection;
    if (!rawProj) throw new Error('view-projection-missing');

    const remaining: BreakRegion[] = existingBreaks.filter(b => b.id !== this.opts.breakId) as BreakRegion[];

    // Stash for revert
    this.deletedBreak = targetBreak;
    this.savedRawProjection = rawProj;
    this.savedPriorProjection = (view as { projection?: ProjectedGeometry }).projection;
    this.savedPriorFingerprint = (view as { inputFingerprint?: string }).inputFingerprint;
    this.applied = true;

    let updatedView: typeof view;
    if (remaining.length === 0) {
      // Last break removed: restore projection = rawProjection, clear rawProjection.
      // α-conditional: breaks.length === 0 → rawProjection must be absent.
      const base = { ...view } as Record<string, unknown>;
      base['breaks'] = [];
      base['projection'] = rawProj;
      base['inputFingerprint'] = this.savedPriorFingerprint;
      delete base['rawProjection'];
      updatedView = base as typeof view;
    } else {
      const { edges: visFrags, breakSymbolEdges } = applyBreaks(
        rawProj.visibleEdges, remaining, rawProj.bbox,
      );
      const { edges: hidFrags } = applyBreaks(rawProj.hiddenEdges, remaining, rawProj.bbox);
      const newProjection: ProjectedGeometry = {
        ...rawProj,
        visibleEdges: [...visFrags, ...breakSymbolEdges],
        hiddenEdges: hidFrags,
      };
      const newFingerprint =
        (this.savedPriorFingerprint ?? '') + '|' + fingerprintBreaksArray(remaining);
      const delBase = { ...view } as Record<string, unknown>;
      delBase['breaks'] = remaining;
      delBase['projection'] = newProjection;
      delBase['inputFingerprint'] = newFingerprint;
      updatedView = delBase as typeof view;
    }

    const nextDoc: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: s.views.map(v => v.id === this.opts.viewId ? updatedView : v) }
          : s
      ),
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: nextDoc },
      activeDrawing: nextDoc,
    });
  }

  async revert(): Promise<void> {
    if (!this.applied || !this.deletedBreak) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;
    const sheet = drawing.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) return;
    const view = sheet.views.find(v => v.id === this.opts.viewId);
    if (!view) return;

    const currentBreaks: readonly BreakRegion[] =
      (view as { breaks?: readonly BreakRegion[] }).breaks ?? [];
    const restoredBreaks: BreakRegion[] = [...currentBreaks, this.deletedBreak] as BreakRegion[];
    const rawProj = this.savedRawProjection!;

    const { edges: visFrags, breakSymbolEdges } = applyBreaks(
      rawProj.visibleEdges, restoredBreaks, rawProj.bbox,
    );
    const { edges: hidFrags } = applyBreaks(rawProj.hiddenEdges, restoredBreaks, rawProj.bbox);
    const restoredProjection: ProjectedGeometry = {
      ...rawProj,
      visibleEdges: [...visFrags, ...breakSymbolEdges],
      hiddenEdges: hidFrags,
    };
    const restoredFingerprint =
      (this.savedPriorFingerprint ?? '') + '|' + fingerprintBreaksArray(restoredBreaks);

    const revertBase = { ...view } as Record<string, unknown>;
    revertBase['breaks'] = restoredBreaks;
    revertBase['rawProjection'] = rawProj;
    revertBase['projection'] = restoredProjection;
    revertBase['inputFingerprint'] = restoredFingerprint;
    const updatedView = revertBase as typeof view;

    const nextDoc: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: s.views.map(v => v.id === this.opts.viewId ? updatedView : v) }
          : s
      ),
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: nextDoc },
      activeDrawing: nextDoc,
    });
    this.applied = false;
  }
}
