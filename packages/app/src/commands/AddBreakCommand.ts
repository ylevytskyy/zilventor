// packages/app/src/commands/AddBreakCommand.ts
import type { Command } from './Command';
import type { DrawingDocument, BreakRegion, ProjectedGeometry } from '@zilventor/shared';
import { applyBreaks, fingerprintBreaksArray } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type AddBreakOpts = {
  drawingId: string;
  sheetId: string;
  viewId: string;
  axis: 'x' | 'y';
  coordA: number;
  coordB: number;
  gapMm?: number;
};

export class AddBreakCommand implements Command {
  readonly name = 'AddBreak';
  private breakId: string | null = null;
  private wasFirstBreak = false;
  private savedPriorProjection: ProjectedGeometry | undefined = undefined;
  private savedPriorFingerprint: string | undefined = undefined;
  /** Whether the view had a 'breaks' key at all before apply (used to fully restore on revert). */
  private savedHadBreaksKey = false;

  constructor(private readonly opts: AddBreakOpts) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;
    const sheet = drawing.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) throw new Error('view-not-found');

    const view = sheet.views.find(v => v.id === this.opts.viewId);
    if (!view) throw new Error('view-not-found');

    // Validate kind — section and detail are not breakable (spec §10.3, F3.6 deferred)
    if (view.kind === 'section' || view.kind === 'detail') throw new Error('view-not-breakable');

    // Validate band
    if (this.opts.coordB <= this.opts.coordA) throw new Error('invalid-band');

    // Validate no overlap with existing breaks on same axis
    const existingBreaks: readonly BreakRegion[] =
      (view as { breaks?: readonly BreakRegion[] }).breaks ?? [];
    for (const b of existingBreaks) {
      if (b.axis === this.opts.axis) {
        const overlapStart = Math.max(this.opts.coordA, b.coordA);
        const overlapEnd = Math.min(this.opts.coordB, b.coordB);
        if (overlapStart < overlapEnd) throw new Error('overlapping-break');
      }
    }

    // Require projection to be populated (spec §10.3)
    const viewProj = (view as { projection?: ProjectedGeometry }).projection;
    if (!viewProj) throw new Error('view-projection-missing');

    const isFirst = existingBreaks.length === 0;
    // α-conditional: on first break, snapshot view.projection as rawProjection;
    // on subsequent breaks, rawProjection already exists — use it as base.
    const rawProjection: ProjectedGeometry = isFirst
      ? viewProj
      : (view as { rawProjection: ProjectedGeometry }).rawProjection;

    const newBreak: BreakRegion = {
      id: crypto.randomUUID(),
      axis: this.opts.axis,
      coordA: this.opts.coordA,
      coordB: this.opts.coordB,
      gapMm: this.opts.gapMm ?? 5,
      style: 'zigzag',
    };

    const newBreaks: BreakRegion[] = [...existingBreaks, newBreak];
    const { edges: visFrags, breakSymbolEdges } = applyBreaks(
      rawProjection.visibleEdges, newBreaks, rawProjection.bbox,
    );
    const { edges: hidFrags } = applyBreaks(
      rawProjection.hiddenEdges, newBreaks, rawProjection.bbox,
    );
    const newProjection: ProjectedGeometry = {
      ...rawProjection,
      visibleEdges: [...visFrags, ...breakSymbolEdges],
      hiddenEdges: hidFrags,
    };
    const priorFingerprint = (view as { inputFingerprint?: string }).inputFingerprint ?? '';
    const newFingerprint = priorFingerprint + '|' + fingerprintBreaksArray(newBreaks);

    // Save for revert
    this.breakId = newBreak.id;
    this.wasFirstBreak = isFirst;
    this.savedPriorProjection = viewProj;
    this.savedPriorFingerprint = (view as { inputFingerprint?: string }).inputFingerprint;
    this.savedHadBreaksKey = 'breaks' in view;

    // Build updated view — spread in rawProjection only on first break
    // (subsequent breaks: rawProjection already on view, spread keeps it).
    // Cast via Record to avoid TypeScript discriminant errors (DetailView lacks
    // 'breaks'/'rawProjection' fields even though we only reach this path for
    // non-detail, non-section kinds).
    const updatedViewBase = { ...view } as Record<string, unknown>;
    updatedViewBase['breaks'] = newBreaks;
    updatedViewBase['projection'] = newProjection;
    updatedViewBase['inputFingerprint'] = newFingerprint;
    if (isFirst) updatedViewBase['rawProjection'] = rawProjection;
    const updatedView = updatedViewBase as typeof view;

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
    if (!this.breakId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;
    const sheet = drawing.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) return;
    const view = sheet.views.find(v => v.id === this.opts.viewId);
    if (!view) return;

    const remainingBreaks: BreakRegion[] = (
      (view as { breaks?: readonly BreakRegion[] }).breaks ?? []
    ).filter(b => b.id !== this.breakId) as BreakRegion[];

    let updatedView: typeof view;
    if (remainingBreaks.length === 0) {
      // Reverting the first (and only) break: restore prior projection, clear rawProjection.
      // Use object spread + delete to avoid setting undefined on an
      // exactOptionalPropertyTypes-strict field.
      const base = { ...view } as Record<string, unknown>;
      // Restore 'breaks' to its original presence: if the view had no 'breaks' key
      // before the first add, remove it so a deep-equal against the original passes.
      if (this.savedHadBreaksKey) {
        base['breaks'] = [];
      } else {
        delete base['breaks'];
      }
      base['projection'] = this.savedPriorProjection;
      if (this.savedPriorFingerprint !== undefined) {
        base['inputFingerprint'] = this.savedPriorFingerprint;
      } else {
        delete base['inputFingerprint'];
      }
      delete base['rawProjection'];
      updatedView = base as typeof view;
    } else {
      // Reverting one of multiple breaks: re-apply applyBreaks against rawProjection.
      const rawProj = (view as { rawProjection: ProjectedGeometry }).rawProjection;
      const { edges: visFrags, breakSymbolEdges } = applyBreaks(
        rawProj.visibleEdges, remainingBreaks, rawProj.bbox,
      );
      const { edges: hidFrags } = applyBreaks(rawProj.hiddenEdges, remainingBreaks, rawProj.bbox);
      const restoredProjection: ProjectedGeometry = {
        ...rawProj,
        visibleEdges: [...visFrags, ...breakSymbolEdges],
        hiddenEdges: hidFrags,
      };
      const restoredFingerprint =
        (this.savedPriorFingerprint ?? '') + '|' + fingerprintBreaksArray(remainingBreaks);
      const revertBase = { ...view } as Record<string, unknown>;
      revertBase['breaks'] = remainingBreaks;
      revertBase['projection'] = restoredProjection;
      revertBase['inputFingerprint'] = restoredFingerprint;
      updatedView = revertBase as typeof view;
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
    this.breakId = null;
  }
}
