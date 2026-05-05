import type { Command } from './Command';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class MoveDrawingDimensionCommand implements Command {
  readonly name = 'MoveDrawingDimension';
  private prevOffsetMm: number | undefined;
  private prevAngleDeg: number | undefined;

  constructor(private readonly opts: { sheetId: string; dimId: string; offsetMm: number; angleDeg?: number }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    // TODO(phase-7): drop cast after activeDocument union widening
    const doc = state.activeDocument as unknown as { kind: string; document: DrawingDocument } | null;
    if (!doc || doc.kind !== 'drawing') return;

    const sheets = doc.document.sheets.map((sh) => {
      if (sh.id !== this.opts.sheetId) return sh;
      const dimensions = sh.dimensions.map((d) => {
        if (d.id !== this.opts.dimId) return d;
        this.prevOffsetMm = (d as { offsetMm: number }).offsetMm;
        this.prevAngleDeg = (d as { angleDeg?: number }).angleDeg;
        const updated = { ...d, offsetMm: this.opts.offsetMm } as DrawingDimension;
        if (this.opts.angleDeg !== undefined && 'angleDeg' in d) {
          return { ...updated, angleDeg: this.opts.angleDeg } as DrawingDimension;
        }
        return updated;
      });
      return { ...sh, dimensions };
    });
    const next: DrawingDocument = { ...doc.document, sheets };
    // TODO(phase-7): drop cast after activeDocument union widening
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
  }

  async revert(): Promise<void> {
    if (this.prevOffsetMm === undefined) return;
    const state = useAppStore.getState();
    // TODO(phase-7): drop cast after activeDocument union widening
    const doc = state.activeDocument as unknown as { kind: string; document: DrawingDocument } | null;
    if (!doc || doc.kind !== 'drawing') return;

    const prevOffsetMm = this.prevOffsetMm;
    const prevAngleDeg = this.prevAngleDeg;
    const sheets = doc.document.sheets.map((sh) => {
      if (sh.id !== this.opts.sheetId) return sh;
      const dimensions = sh.dimensions.map((d) => {
        if (d.id !== this.opts.dimId) return d;
        const restored = { ...d, offsetMm: prevOffsetMm } as DrawingDimension;
        if (prevAngleDeg !== undefined && 'angleDeg' in d) {
          return { ...restored, angleDeg: prevAngleDeg } as DrawingDimension;
        }
        return restored;
      });
      return { ...sh, dimensions };
    });
    const next: DrawingDocument = { ...doc.document, sheets };
    // TODO(phase-7): drop cast after activeDocument union widening
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
  }
}
