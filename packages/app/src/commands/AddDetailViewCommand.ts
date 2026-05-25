// packages/app/src/commands/AddDetailViewCommand.ts
import type { Command } from './Command';
import type { DrawingDocument, DetailView, SectionView, RegionParent } from '@zilventor/shared';
import { allocateCalloutLabel, projectDetailView, fingerprintDetailView } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type AddDetailViewOpts = {
  drawingId: string;
  sheetId: string;
  parentViewId: string;
  regionParent: RegionParent;   // circle or rect; built by ToolMode on commit
  dropAt: { x: number; y: number };  // sheet-space position mm
};

export class AddDetailViewCommand implements Command {
  readonly name = 'AddDetailView';
  private newViewId: string | null = null;

  constructor(private readonly opts: AddDetailViewOpts) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;
    const sheet = drawing.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) throw new Error(`sheet ${this.opts.sheetId} not found`);

    // 1. Resolve parent view.
    const parentView = sheet.views.find(v => v.id === this.opts.parentViewId);
    if (!parentView) throw new Error('parent-not-found');

    // 2. Require parent projection to be populated.
    if (!parentView.projection) throw new Error('parent-projection-missing');

    // 3. Allocate label from shared pool (SectionView + DetailView labels).
    const existingLabels = sheet.views
      .filter((v): v is SectionView | DetailView =>
        v.kind === 'section' || v.kind === 'detail')
      .map(v => v.label);
    const label = allocateCalloutLabel(existingLabels);

    // 4. Determine showHidden from parent (spec §8.1 step 4).
    const showHidden =
      parentView.kind !== 'section' &&
      (parentView as { showHidden?: boolean }).showHidden === true;

    // 5. Default scale: 2:1 per spec §8.1 step 5.
    const defaultScale = { numerator: 2, denominator: 1 };

    // 6. Clip parent edges → projectDetailView (pure 2D, no kernel).
    const projection = projectDetailView({
      parentView: parentView as typeof parentView & { projection: NonNullable<typeof parentView.projection> },
      regionParent: this.opts.regionParent,
      detailScale: defaultScale,
      showHidden,
    });

    // 7. Compute fingerprint.
    const inputFingerprint = fingerprintDetailView(
      (parentView as { inputFingerprint?: string }).inputFingerprint ?? '',
      this.opts.regionParent,
      defaultScale,
    );

    // 8. Build DetailView.
    const newId = crypto.randomUUID();
    this.newViewId = newId;

    const view: DetailView = {
      id: newId,
      kind: 'detail',
      parentViewId: this.opts.parentViewId,
      regionParent: this.opts.regionParent,
      label,
      positionMm: this.opts.dropAt,
      scale: defaultScale,
      showHidden,
      projection,
      inputFingerprint,
    };

    // 9. Push onto sheet.views[].
    const nextDoc: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: [...s.views, view] }
          : s
      ),
    };
    // F6 gotcha: DrawingCanvas subscribes to activeDrawing — must set BOTH.
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
  }

  async revert(): Promise<void> {
    if (!this.newViewId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;
    const nextDoc: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: s.views.filter(v => v.id !== this.newViewId) }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
    this.newViewId = null;
  }
}
