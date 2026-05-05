import type { Command } from './Command';
import type { DrawingDocument, DrawingView, DrawingDimension, DrawingAnnotation, SectionView } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { sectionCache } from '../drawing/sectionCache';

type Snapshot = {
  views: DrawingView[];
  viewIndices: number[];
  dimensions: DrawingDimension[];
  dimIndices: number[];
  annotations: DrawingAnnotation[];
  annIndices: number[];
  /** Cache keys for removed section views, evicted during apply. Not restored on revert — caller re-cuts on next use. */
  sectionCacheKeys: string[];
};

export class DeleteViewCommand implements Command {
  readonly name = 'DeleteView';
  private snapshot: Snapshot | null = null;

  constructor(private readonly opts: { sheetId: string; viewId: string }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) return;

    const targetView = sheet.views.find(v => v.id === this.opts.viewId);
    if (!targetView) return;

    // Determine which view ids to remove (target + projected/section children if base)
    const viewIdsToRemove = new Set<string>([this.opts.viewId]);
    if (targetView.kind === 'base') {
      for (const v of sheet.views) {
        if (v.kind === 'projected' && v.baseViewId === this.opts.viewId) {
          viewIdsToRemove.add(v.id);
        }
        if (v.kind === 'section' && (v as SectionView).parentViewId === this.opts.viewId) {
          viewIdsToRemove.add(v.id);
        }
      }
    }

    // Capture snapshots with original indices for revert
    const removedViews: DrawingView[] = [];
    const removedViewIndices: number[] = [];
    const removedDims: DrawingDimension[] = [];
    const removedDimIndices: number[] = [];
    const removedAnns: DrawingAnnotation[] = [];
    const removedAnnIndices: number[] = [];

    sheet.views.forEach((v, i) => {
      if (viewIdsToRemove.has(v.id)) {
        removedViews.push(v);
        removedViewIndices.push(i);
      }
    });
    sheet.dimensions.forEach((d, i) => {
      if (viewIdsToRemove.has(d.viewId)) {
        removedDims.push(d);
        removedDimIndices.push(i);
      }
    });
    sheet.annotations.forEach((a, i) => {
      if (viewIdsToRemove.has(a.viewId)) {
        removedAnns.push(a);
        removedAnnIndices.push(i);
      }
    });

    // Collect cache keys for removed section views so they can be evicted.
    const sectionCacheKeys: string[] = [];
    for (const v of removedViews) {
      if (v.kind === 'section') {
        const sv = v as SectionView;
        if (sv.fingerprint) sectionCacheKeys.push(sv.fingerprint);
      }
    }

    this.snapshot = {
      views: removedViews,
      viewIndices: removedViewIndices,
      dimensions: removedDims,
      dimIndices: removedDimIndices,
      annotations: removedAnns,
      annIndices: removedAnnIndices,
      sectionCacheKeys,
    };

    // Evict section cache entries for removed views (best-effort).
    for (const key of sectionCacheKeys) {
      await sectionCache.delete(key).catch(() => undefined);
    }

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? {
              ...s,
              views: s.views.filter(v => !viewIdsToRemove.has(v.id)),
              dimensions: s.dimensions.filter(d => !viewIdsToRemove.has(d.viewId)),
              annotations: s.annotations.filter(a => !viewIdsToRemove.has(a.viewId)),
            }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
  }

  async revert(): Promise<void> {
    if (!this.snapshot) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const snap = this.snapshot;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s => {
        if (s.id !== this.opts.sheetId) return s;

        // Re-splice captured items back at their original indices
        const views = [...s.views];
        for (let i = 0; i < snap.views.length; i++) {
          views.splice(snap.viewIndices[i]!, 0, snap.views[i]!);
        }
        const dimensions = [...s.dimensions];
        for (let i = 0; i < snap.dimensions.length; i++) {
          dimensions.splice(snap.dimIndices[i]!, 0, snap.dimensions[i]!);
        }
        const annotations = [...s.annotations];
        for (let i = 0; i < snap.annotations.length; i++) {
          annotations.splice(snap.annIndices[i]!, 0, snap.annotations[i]!);
        }

        return { ...s, views, dimensions, annotations };
      }),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
    this.snapshot = null;
  }
}
