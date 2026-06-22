import { parseDxf, toSketch } from '@zilventor/shared';
import type { PartDocument } from '@zilventor/shared';
import type { KernelApi } from '@zilventor/kernel/src/api';
import type { Command } from './Command';
import { buildSketchPartDocument } from '../import/buildSketchPartDocument';
import i18n from '../i18n';

type Ctx = {
  kernel: Pick<KernelApi, 'registerPart'>;
  store: { getActivePart: () => PartDocument | null; setActivePart: (p: PartDocument) => void };
  setStatus?: (msg: string) => void;
  file: File;
};

function fileStem(name: string): string {
  return name.replace(/\.[^./\\]+$/, '') || name;
}

export class ImportDxfIntoNewPartCommand implements Command {
  readonly name = 'ImportDxfIntoNewPart';
  private prior: PartDocument | null = null;

  constructor(private ctx: Ctx) {}

  async apply(): Promise<void> {
    this.prior = this.ctx.store.getActivePart();
    const text = await this.ctx.file.text();
    const { primitives, dropped } = toSketch(parseDxf(text));
    const part = buildSketchPartDocument(fileStem(this.ctx.file.name), primitives);
    await this.ctx.kernel.registerPart(part);
    this.ctx.store.setActivePart(part);
    const skipped = dropped.reduce((a, d) => a + d.count, 0);
    this.ctx.setStatus?.(i18n.t('status.dxfImport.done', { imported: primitives.length, skipped }));
  }

  async revert(): Promise<void> {
    if (this.prior) this.ctx.store.setActivePart(this.prior);
  }
}
