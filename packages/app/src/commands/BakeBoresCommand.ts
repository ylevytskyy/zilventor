import type { Command } from './Command';
import type { KernelApi } from '@zilventor/kernel/src/api';
import type { BoreOp, PartDocument, HoleFeature } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { useAppStore } from '../store/useAppStore';

export type BakeBoresOpts = {
  partPath: string;
  opfs: { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };
  kernel: Pick<KernelApi, 'registerPart' | 'execute' | 'saveToBytes' | 'deletePart'>;
  store?: typeof useAppStore;
};

function groupKey(b: BoreOp): string {
  return `${b.face.role}|${b.diameter}|${b.depth}`;
}

/** Deterministic bake-authored feature id so UnbakeBoresCommand can find them. */
function bakeFeatureId(b: BoreOp): string {
  return `bake:${b.face.role}:${b.diameter}:${b.depth}`;
}

function bakedFeaturesFor(bores: ReadonlyArray<BoreOp>): HoleFeature[] {
  const groups = new Map<string, BoreOp[]>();
  for (const b of bores) {
    const k = groupKey(b);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(b);
  }
  const out: HoleFeature[] = [];
  for (const group of groups.values()) {
    const first = group[0]!;
    out.push({
      id: bakeFeatureId(first),
      kind: 'hole',
      placement: {
        kind: 'atFace',
        faceName: first.face,
        points: group.map((g) => ({ u: g.u, v: g.v })),
        axis: 'into-face',
      },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: first.diameter } },
      termination: first.depth === 'throughAll'
        ? { kind: 'throughAll' }
        : { kind: 'distance', depth: { kind: 'literal', value: first.depth } },
      flipAxis: false,
    });
  }
  return out;
}

export class BakeBoresCommand implements Command {
  readonly name = 'BakeBores';
  private priorBytes: Uint8Array | null = null;
  private readonly store: typeof useAppStore;

  constructor(private readonly opts: BakeBoresOpts) {
    this.store = opts.store ?? useAppStore;
  }

  async apply(): Promise<void> {
    const bytes = await this.opts.opfs.read(this.opts.partPath);
    this.priorBytes = bytes;
    const project = await unpackProject(bytes);
    const manifest = project.manifest as { document: PartDocument };
    let doc = manifest.document;
    const bores = doc.bores ?? [];
    if (bores.length === 0) return;

    // Drop any prior bake features (idempotent re-bake), then append the new ones.
    doc = { ...doc, featureTree: doc.featureTree.filter((f) => !f.id.startsWith('bake:')) };
    for (const f of bakedFeaturesFor(bores)) doc = addFeature(doc, f);

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
    const repacked = await writeTarGz([
      { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) },
    ]);
    await this.opts.opfs.write(this.opts.partPath, repacked);
  }

  private async rebuild(doc: PartDocument): Promise<void> {
    // Delete first (in case already registered), then re-register + execute.
    try { await this.opts.kernel.deletePart(doc.id); } catch { /* not registered yet */ }
    await this.opts.kernel.registerPart(doc);
    await this.opts.kernel.execute(doc.id);
  }
}
