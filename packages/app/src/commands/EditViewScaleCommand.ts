import type { Command } from './Command';
import type { DrawingDocument, ViewScale } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class EditViewScaleCommand implements Command {
  readonly name = 'EditViewScale';
  private prevScale: ViewScale | null = null;
  private prevFingerprint: string | undefined = undefined;
  private applied = false;

  constructor(
    private readonly opts: {
      sheetId: string;
      viewId: string;
      scale: ViewScale;
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

    this.prevScale = view.scale;
    this.prevFingerprint = view.inputFingerprint;
    this.applied = true;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? {
              ...s,
              views: s.views.map(v => {
                if (v.id !== this.opts.viewId) return v;
                const updated = { ...v, scale: this.opts.scale };
                // Scale change invalidates projection — clear fingerprint to trigger stale-banner
                delete (updated as { inputFingerprint?: string }).inputFingerprint;
                return updated;
              }),
            }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
  }

  async revert(): Promise<void> {
    if (!this.applied || !this.prevScale) return;
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
                const restored = { ...v, scale: this.prevScale! };
                if (this.prevFingerprint !== undefined) {
                  (restored as { inputFingerprint?: string }).inputFingerprint = this.prevFingerprint;
                }
                return restored;
              }),
            }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
    this.applied = false;
  }
}
