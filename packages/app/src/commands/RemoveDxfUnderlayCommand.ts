// packages/app/src/commands/RemoveDxfUnderlayCommand.ts
import type { Command } from './Command';
import type { DrawingDocument, DxfUnderlay } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { drawingDocState } from '../store/drawingDocState';

export class RemoveDxfUnderlayCommand implements Command {
  readonly name = 'RemoveDxfUnderlay';

  private priorUnderlay: DxfUnderlay | undefined = undefined;

  constructor(private readonly _opts: Record<string, never>) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;
    const activeSheetId = drawing.activeSheetId ?? drawing.sheets[0]?.id;
    const activeSheet = drawing.sheets.find((s) => s.id === activeSheetId);

    // Capture prior underlay for undo
    this.priorUnderlay = activeSheet?.underlay;

    const next: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map((sh) => {
        if (sh.id !== activeSheetId) return sh;
        // Destructure out the underlay key so it doesn't linger as {underlay: undefined}
        const { underlay: _removed, ...rest } = sh;
        return rest as typeof sh;
      }),
    };
    useAppStore.setState(drawingDocState(next));
  }

  async revert(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;
    const activeSheetId = drawing.activeSheetId ?? drawing.sheets[0]?.id;

    const next: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map((sh) => {
        if (sh.id !== activeSheetId) return sh;
        if (this.priorUnderlay === undefined) {
          // No prior underlay — remove key entirely
          const { underlay: _removed, ...rest } = sh;
          return rest as typeof sh;
        }
        return { ...sh, underlay: this.priorUnderlay };
      }),
    };
    useAppStore.setState(drawingDocState(next));
  }
}
