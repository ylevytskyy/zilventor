import type { Command } from './Command';
import type { KernelApi } from '@zilventor/kernel/src/api';
import type { PartDocument } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { useAppStore } from '../store/useAppStore';

export type UnbakeBoresOpts = {
  partPath: string;
  opfs: { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };
  kernel: Pick<KernelApi, 'execute' | 'registerPart' | 'saveToBytes' | 'deletePart'>;
  store?: typeof useAppStore;
};

export class UnbakeBoresCommand implements Command {
  readonly name = 'UnbakeBores';
  private priorBytes: Uint8Array | null = null;
  private readonly store: typeof useAppStore;

  constructor(private readonly opts: UnbakeBoresOpts) {
    this.store = opts.store ?? useAppStore;
  }

  async apply(): Promise<void> {
    const bytes = await this.opts.opfs.read(this.opts.partPath);
    this.priorBytes = bytes;
    const project = await unpackProject(bytes);
    const manifest = project.manifest as { document: PartDocument };
    const doc: PartDocument = {
      ...manifest.document,
      featureTree: manifest.document.featureTree.filter((f) => !f.id.startsWith('bake:')),
    };
    await this.persist(doc);
    await this.rebuild(doc);
    // Evict bore/geometry caches so undo/redo re-renders bore markers.
    this.store.getState().boreCacheInvalidator?.([this.opts.partPath]);
  }

  async revert(): Promise<void> {
    if (!this.priorBytes) return;
    await this.opts.opfs.write(this.opts.partPath, this.priorBytes);
    const project = await unpackProject(this.priorBytes);
    await this.rebuild((project.manifest as { document: PartDocument }).document);
    // Evict bore/geometry caches after revert so undo re-renders bore markers.
    this.store.getState().boreCacheInvalidator?.([this.opts.partPath]);
  }

  private async persist(doc: PartDocument): Promise<void> {
    const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
    // writeTarGz is async — await it.
    await this.opts.opfs.write(this.opts.partPath, await writeTarGz([
      { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) },
    ]));
  }

  private async rebuild(doc: PartDocument): Promise<void> {
    try { await this.opts.kernel.deletePart(doc.id); } catch { /* not registered */ }
    await this.opts.kernel.registerPart(doc);
    await this.opts.kernel.execute(doc.id);
  }
}
