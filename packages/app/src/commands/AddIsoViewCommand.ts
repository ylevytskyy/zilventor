import type { Command } from './Command';
import type { DrawingDocument, ViewScale, IsoView } from '@zilventor/shared';
import type { ViewOrientation } from '@zilventor/shared/src/drawing/viewMatrix';
import { autoPlaceCenterMarks } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { drawingDocState } from '../store/drawingDocState';
import { projectViewFromSource } from '../drawing/projectViewFromSource';

export class AddIsoViewCommand implements Command {
  readonly name = 'AddIsoView';
  private newViewId: string | null = null;
  private newAnnotationIds: string[] = [];

  constructor(
    private readonly opts: {
      sheetId: string;
      positionMm: { x: number; y: number };
      corner: 'NE' | 'NW' | 'SE' | 'SW';
      scale: ViewScale;
      showHidden?: boolean;
    }
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    // corner → iso-<corner> matches ViewOrientation: 'iso-NE' | 'iso-NW' | 'iso-SE' | 'iso-SW'
    const orientation: ViewOrientation = `iso-${this.opts.corner}` as ViewOrientation;
    const { projection, inputFingerprint } = await projectViewFromSource(orientation);

    const newId = crypto.randomUUID();
    this.newViewId = newId;

    const view: IsoView = {
      id: newId,
      kind: 'iso',
      positionMm: this.opts.positionMm,
      corner: this.opts.corner,
      scale: this.opts.scale,
      showHidden: this.opts.showHidden ?? false, // engineering convention
      projection,
      inputFingerprint,
    };

    const centerMarks = autoPlaceCenterMarks(projection, newId);
    this.newAnnotationIds = centerMarks.map(a => a.id);

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: [...s.views, view], annotations: [...s.annotations, ...centerMarks] }
          : s
      ),
    };
    useAppStore.setState(drawingDocState(next));
  }

  async revert(): Promise<void> {
    if (!this.newViewId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const removedAnnotationIds = new Set(this.newAnnotationIds);
    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? {
              ...s,
              views: s.views.filter(v => v.id !== this.newViewId),
              annotations: s.annotations.filter(a => !removedAnnotationIds.has(a.id)),
            }
          : s
      ),
    };
    useAppStore.setState(drawingDocState(next));
    this.newViewId = null;
    this.newAnnotationIds = [];
  }
}
