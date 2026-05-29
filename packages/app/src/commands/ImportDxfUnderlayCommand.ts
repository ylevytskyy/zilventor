// packages/app/src/commands/ImportDxfUnderlayCommand.ts
import type { Command } from './Command';
import type { DrawingDocument, DxfUnderlay } from '@zilventor/shared';
import { ISO_SIZES_MM } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { drawingDocState } from '../store/drawingDocState';
import { parseDxfUnderlay } from '../drawing/parseDxfUnderlay';
import { computeUnderlayOffset } from '../drawing/underlayTransform';

export class ImportDxfUnderlayCommand implements Command {
  readonly name = 'ImportDxfUnderlay';

  private priorUnderlay: DxfUnderlay | undefined = undefined;

  constructor(
    private readonly opts: { dxfText: string; fileName: string },
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;
    const activeSheetId = drawing.activeSheetId ?? drawing.sheets[0]?.id;
    const activeSheet = drawing.sheets.find((s) => s.id === activeSheetId);

    // Capture prior underlay for undo
    this.priorUnderlay = activeSheet?.underlay;

    const underlayRaw = parseDxfUnderlay(this.opts.dxfText, this.opts.fileName);

    // Compute sheet dimensions for fit-to-sheet centering.
    const MARGIN = 10;
    const TITLE_H = 20;
    let sheetW = 420; // A3 landscape default
    let sheetH = 297;
    if (activeSheet) {
      if (activeSheet.size.kind === 'iso') {
        const base = ISO_SIZES_MM[activeSheet.size.size];
        sheetW = activeSheet.orientation === 'landscape' ? base.w : base.h;
        sheetH = activeSheet.orientation === 'landscape' ? base.h : base.w;
      } else {
        const { widthMm, heightMm } = activeSheet.size;
        sheetW = activeSheet.orientation === 'landscape' ? Math.max(widthMm, heightMm) : Math.min(widthMm, heightMm);
        sheetH = activeSheet.orientation === 'landscape' ? Math.min(widthMm, heightMm) : Math.max(widthMm, heightMm);
      }
    }

    const offsetMm = computeUnderlayOffset(underlayRaw.sourceBBoxMm, sheetW, sheetH, MARGIN, TITLE_H);
    const underlay: DxfUnderlay = { ...underlayRaw, offsetMm };

    const next: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map((sh) =>
        sh.id === activeSheetId ? { ...sh, underlay } : sh,
      ),
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
          // Remove the underlay key entirely
          const { underlay: _removed, ...rest } = sh;
          return rest as typeof sh;
        }
        return { ...sh, underlay: this.priorUnderlay };
      }),
    };
    useAppStore.setState(drawingDocState(next));
  }
}
