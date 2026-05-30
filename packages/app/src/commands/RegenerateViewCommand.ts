import type { Command } from './Command';
import type { DrawingDocument, ProjectedGeometry, BreakRegion, DrawingAnnotation } from '@zilventor/shared';
import { applyBreaks, fingerprintBreaksArray } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { drawingDocState } from '../store/drawingDocState';

export class RegenerateViewCommand implements Command {
  readonly name = 'RegenerateView';
  private prevProjection: ProjectedGeometry | undefined = undefined;
  private prevRawProjection: ProjectedGeometry | undefined = undefined;
  private prevFingerprint: string | undefined = undefined;
  private prevHadRawProjection = false;
  private applied = false;
  /** Center-mark annotations that existed on the sheet BEFORE apply (for revert). */
  private prevCenterMarks: readonly DrawingAnnotation[] = [];

  constructor(
    private readonly opts: {
      sheetId: string;
      viewId: string;
      projection: ProjectedGeometry;
      inputFingerprint: string;
      /** Fresh center-mark annotations to replace the old ones for this viewId. Default: []. */
      centerMarkAnnotations?: readonly DrawingAnnotation[];
    }
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) return;

    const view = sheet.views.find(v => v.id === this.opts.viewId);
    if (!view) return;

    // Capture prior values for revert
    this.prevProjection = view.projection;
    this.prevRawProjection = (view as { rawProjection?: ProjectedGeometry }).rawProjection;
    this.prevHadRawProjection = 'rawProjection' in view;
    this.prevFingerprint = view.inputFingerprint;
    this.prevCenterMarks = sheet.annotations.filter(
      a => a.kind === 'center-mark' && a.viewId === this.opts.viewId,
    );
    this.applied = true;

    const currentBreaks: readonly BreakRegion[] =
      (view as { breaks?: readonly BreakRegion[] }).breaks ?? [];

    let updatedView: typeof view;
    if (currentBreaks.length > 0) {
      // α-conditional: breaks exist → store fresh kernel output as rawProjection,
      // then apply breaks to produce projection.
      const rawProj = this.opts.projection;
      const { edges: visFrags, breakSymbolEdges } = applyBreaks(
        rawProj.visibleEdges, currentBreaks, rawProj.bbox,
      );
      const { edges: hidFrags } = applyBreaks(rawProj.hiddenEdges, currentBreaks, rawProj.bbox);
      const newProjection: ProjectedGeometry = {
        ...rawProj,
        visibleEdges: [...visFrags, ...breakSymbolEdges],
        hiddenEdges: hidFrags,
      };
      const newFingerprint = this.opts.inputFingerprint + '|' + fingerprintBreaksArray(currentBreaks);
      const regenBase = { ...view } as Record<string, unknown>;
      regenBase['rawProjection'] = rawProj;
      regenBase['projection'] = newProjection;
      regenBase['inputFingerprint'] = newFingerprint;
      updatedView = regenBase as typeof view;
    } else {
      // α-conditional: no breaks → rawProjection stays undefined.
      const base = { ...view } as Record<string, unknown>;
      base['projection'] = this.opts.projection;
      base['inputFingerprint'] = this.opts.inputFingerprint;
      delete base['rawProjection'];
      updatedView = base as typeof view;
    }

    const freshCenterMarks = this.opts.centerMarkAnnotations ?? [];
    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? {
              ...s,
              views: s.views.map(v => v.id === this.opts.viewId ? updatedView : v),
              // Atomically replace center-marks for this viewId: remove old, add fresh.
              annotations: [
                ...s.annotations.filter(
                  a => !(a.kind === 'center-mark' && a.viewId === this.opts.viewId),
                ),
                ...freshCenterMarks,
              ],
            }
          : s
      ),
    };
    useAppStore.setState(drawingDocState(next));
  }

  async revert(): Promise<void> {
    if (!this.applied) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? {
              ...s,
              views: s.views.map(v => {
                if (v.id !== this.opts.viewId) return v;
                const base = { ...v } as Record<string, unknown>;
                if (this.prevProjection !== undefined) {
                  base['projection'] = this.prevProjection;
                } else {
                  delete base['projection'];
                }
                if (this.prevHadRawProjection) {
                  base['rawProjection'] = this.prevRawProjection;
                } else {
                  delete base['rawProjection'];
                }
                if (this.prevFingerprint !== undefined) {
                  base['inputFingerprint'] = this.prevFingerprint;
                } else {
                  delete base['inputFingerprint'];
                }
                return base as typeof v;
              }),
              // Restore center-marks: remove fresh ones, re-add the pre-apply set.
              annotations: [
                ...s.annotations.filter(
                  a => !(a.kind === 'center-mark' && a.viewId === this.opts.viewId),
                ),
                ...this.prevCenterMarks,
              ],
            }
          : s
      ),
    };
    useAppStore.setState(drawingDocState(next));
    this.applied = false;
  }
}
