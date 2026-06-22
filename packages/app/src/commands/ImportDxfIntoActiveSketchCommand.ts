import { parseDxf, toSketch } from '@zilventor/shared';
import type { PartDocument, SketchPrimitive } from '@zilventor/shared';
import type { KernelApi } from '@zilventor/kernel/src/api';
import type { Command } from './Command';

type SketcherClient = {
  addPrimitive: (p: SketchPrimitive) => Promise<void>;
  removePrimitive: (id: string) => Promise<void>;
};

type Ctx = {
  kernel: Pick<KernelApi, 'addPrimitive' | 'removePrimitive'>;
  sketcherClient?: SketcherClient;
  store: { getActivePart: () => PartDocument | null };
  sketchId: string;
  setStatus?: (msg: string) => void;
  file: File;
};

export class ImportDxfIntoActiveSketchCommand implements Command {
  readonly name = 'ImportDxfIntoActiveSketch';
  private partId = '';
  private added: SketchPrimitive[] = [];

  constructor(private ctx: Ctx) {}

  async apply(): Promise<void> {
    const part = this.ctx.store.getActivePart();
    if (!part) throw new Error('no active part');
    this.partId = part.id;
    const text = await this.ctx.file.text();
    const { primitives, dropped } = toSketch(parseDxf(text));
    this.added = [];
    try {
      for (const p of primitives) {
        await this.ctx.kernel.addPrimitive(this.partId, this.ctx.sketchId, p);
        if (this.ctx.sketcherClient) await this.ctx.sketcherClient.addPrimitive(p);
        this.added.push(p);
      }
    } catch (err) {
      await this.revert();
      throw err;
    }
    const skipped = dropped.reduce((a, d) => a + d.count, 0);
    this.ctx.setStatus?.(`Imported ${primitives.length} primitives, skipped ${skipped} entities`);
  }

  async revert(): Promise<void> {
    for (const p of [...this.added].reverse()) {
      await this.ctx.kernel.removePrimitive(this.partId, this.ctx.sketchId, p.id);
      if (this.ctx.sketcherClient) await this.ctx.sketcherClient.removePrimitive(p.id);
    }
    this.added = [];
  }
}
