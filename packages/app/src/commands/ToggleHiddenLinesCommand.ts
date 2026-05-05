import type { Command } from './Command';
import type { DrawingDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class ToggleHiddenLinesCommand implements Command {
  readonly name = 'ToggleHiddenLines';
  private prevShowHidden: boolean | null = null;

  constructor(
    private readonly opts: {
      sheetId: string;
      viewId: string;
      showHidden: boolean;
    }
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    // TODO(phase-7): drop cast after activeDocument union widening
    const doc = state.activeDocument as unknown as { kind: string; document: DrawingDocument } | null;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) return;

    const view = sheet.views.find(v => v.id === this.opts.viewId);
    if (!view) return;

    this.prevShowHidden = view.showHidden;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? {
              ...s,
              views: s.views.map(v =>
                v.id === this.opts.viewId
                  ? { ...v, showHidden: this.opts.showHidden }
                  : v
              ),
            }
          : s
      ),
    };
    // TODO(phase-7): drop cast after activeDocument union widening
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
  }

  async revert(): Promise<void> {
    if (this.prevShowHidden === null) return;
    const state = useAppStore.getState();
    // TODO(phase-7): drop cast after activeDocument union widening
    const doc = state.activeDocument as unknown as { kind: string; document: DrawingDocument } | null;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? {
              ...s,
              views: s.views.map(v =>
                v.id === this.opts.viewId
                  ? { ...v, showHidden: this.prevShowHidden! }
                  : v
              ),
            }
          : s
      ),
    };
    // TODO(phase-7): drop cast after activeDocument union widening
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
    this.prevShowHidden = null;
  }
}
