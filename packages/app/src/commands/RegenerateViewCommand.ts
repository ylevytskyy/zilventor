import type { Command } from './Command';
import type { DrawingDocument, ProjectedGeometry } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class RegenerateViewCommand implements Command {
  readonly name = 'RegenerateView';
  private prevProjection: ProjectedGeometry | undefined = undefined;
  private prevFingerprint: string | undefined = undefined;
  private applied = false;

  constructor(
    private readonly opts: {
      sheetId: string;
      viewId: string;
      projection: ProjectedGeometry;
      inputFingerprint: string;
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

    // Capture prior values (may be undefined for a fresh view)
    this.prevProjection = view.projection;
    this.prevFingerprint = view.inputFingerprint;
    this.applied = true;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? {
              ...s,
              views: s.views.map(v =>
                v.id === this.opts.viewId
                  ? { ...v, projection: this.opts.projection, inputFingerprint: this.opts.inputFingerprint }
                  : v
              ),
            }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
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
                // Restore: conditionally set or delete the optional fields
                const base = { ...v };
                if (this.prevProjection !== undefined) {
                  (base as { projection?: ProjectedGeometry }).projection = this.prevProjection;
                } else {
                  delete (base as { projection?: ProjectedGeometry }).projection;
                }
                if (this.prevFingerprint !== undefined) {
                  (base as { inputFingerprint?: string }).inputFingerprint = this.prevFingerprint;
                } else {
                  delete (base as { inputFingerprint?: string }).inputFingerprint;
                }
                return base;
              }),
            }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
    this.applied = false;
  }
}
