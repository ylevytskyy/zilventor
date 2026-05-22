import type { Command } from './Command';
import type { DrawingDocument } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';
import { useAppStore } from '../store/useAppStore';

export class AddDimensionGroupCommand implements Command {
  readonly name = 'AddDimensionGroupCommand';

  constructor(private readonly opts: { sheetId: string; group: DimensionGroup }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((sh) =>
        sh.id === this.opts.sheetId
          ? { ...sh, dimensionGroups: [...(sh.dimensionGroups ?? []), this.opts.group] }
          : sh,
      ),
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: next },
      activeDrawing: next,
    });
  }

  async revert(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((sh) =>
        sh.id === this.opts.sheetId
          ? {
              ...sh,
              dimensionGroups: (sh.dimensionGroups ?? []).filter(
                (g) => g.id !== this.opts.group.id,
              ),
            }
          : sh,
      ),
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: next },
      activeDrawing: next,
    });
  }
}
