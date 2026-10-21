import type { CutListResult, NestState } from '@zilventor/shared';
import { buildPanelLabels } from '../drawing/buildPanelLabels';
import { renderLabelsPdf, type LabelTemplateId } from '../drawing/renderLabelsPdf';
import { triggerDownload } from '../nesting/triggerDownload';

declare global {
  // E2E-inspectable bytes from the latest labels export call.
  var __zilventorPanelLabelsBytes: Uint8Array | undefined;
}

/** Export one printable PDF label per physical panel from the active assembly cut-list. */
export class ExportPanelLabelsCommand {
  constructor(private readonly opts: {
    cutListResult: CutListResult;
    suggestedName: string;
    templateId?: LabelTemplateId;
    headerLine1?: string;
    headerLine2?: string;
    nest?: NestState;
  }) {}

  async apply(): Promise<void> {
    const labels = buildPanelLabels(this.opts.cutListResult, this.opts.nest);
    const bytes = renderLabelsPdf(labels, {
      ...(this.opts.templateId !== undefined ? { templateId: this.opts.templateId } : {}),
      ...(this.opts.headerLine1 !== undefined ? { headerLine1: this.opts.headerLine1 } : {}),
      ...(this.opts.headerLine2 !== undefined ? { headerLine2: this.opts.headerLine2 } : {}),
    });
    (globalThis as { __zilventorPanelLabelsBytes?: Uint8Array }).__zilventorPanelLabelsBytes = bytes;
    const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
    await triggerDownload(blob, {
      suggestedName: this.opts.suggestedName,
      mimeType: 'application/pdf',
      extension: 'pdf',
      description: 'Labels PDF',
    });
  }
}
