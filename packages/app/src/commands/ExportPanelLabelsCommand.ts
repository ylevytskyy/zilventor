import type { CutListResult } from '@zilventor/shared';
import { buildPanelLabels } from '../drawing/buildPanelLabels';
import { renderLabelsPdf } from '../drawing/renderLabelsPdf';
import { triggerDownload } from '../nesting/triggerDownload';

declare global {
  // E2E-inspectable bytes from the latest labels export call.
  // eslint-disable-next-line no-var
  var __zilventorPanelLabelsBytes: Uint8Array | undefined;
}

/** Export one printable PDF label per physical panel from the active assembly cut-list. */
export class ExportPanelLabelsCommand {
  constructor(private readonly opts: { cutListResult: CutListResult; suggestedName: string }) {}

  async apply(): Promise<void> {
    const labels = buildPanelLabels(this.opts.cutListResult);
    const bytes = renderLabelsPdf(labels);
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
