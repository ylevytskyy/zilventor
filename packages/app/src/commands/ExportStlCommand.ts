import type { AssemblyDocument } from '@zilventor/shared';
import type { ExportLeaf } from '@zilventor/kernel/src/api';
import { triggerDownload } from '../nesting/triggerDownload';
import { resolveExportLeaves } from '../assembly/resolveExportLeaves';
import { resolvePartInfo, type PartInfoCache } from '../shell/resolvePartInfo';
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { computeInnerStaticPoses } from '../assembly/computeInnerStaticPoses';

declare global {
   
  var __zilventorStlBytes: Uint8Array | undefined;
}

type ActiveDoc =
  | { kind: 'part'; document: { name: string } }
  | { kind: 'assembly'; document: AssemblyDocument }
  | { kind: 'drawing'; document: { name: string } };

type Pose = { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] };

export class ExportStlCommand {
  readonly name = 'ExportStl';

  constructor(
    private readonly opts: {
      kernel: {
        loadFromBytes?(b: Uint8Array): Promise<string>;
        exportStlPart(id: string, o?: { binary?: boolean }): Promise<Uint8Array>;
        exportStlAssembly(leaves: readonly ExportLeaf[], o?: { binary?: boolean }): Promise<Uint8Array>;
      };
      activeDocument: ActiveDoc;
      activePart: { id: string } | null;
      opfs: { read(p: string): Promise<Uint8Array>; exists(p: string): Promise<boolean> };
      componentPoses: Map<string, Pose>;
      partInfoCache: PartInfoCache;
      subAssemblyDocs: Record<string, AssemblyDocument>;
      subAssemblyInnerPoses: Record<string, Map<string, Pose>>;
    },
  ) {}

  async apply(): Promise<void> {
    const { activeDocument, activePart, kernel } = this.opts;
    let bytes: Uint8Array;
    if (activeDocument.kind === 'part' && activePart) {
      bytes = await kernel.exportStlPart(activePart.id, { binary: true });
    } else if (activeDocument.kind === 'assembly') {
      const subAsmCache = await this._buildSubAsmCache();
      const leaves = await resolveExportLeaves({
        assembly: activeDocument.document,
        kernel: kernel as { loadFromBytes(b: Uint8Array): Promise<string> },
        opfs: this.opts.opfs,
        componentPoses: this.opts.componentPoses,
        partInfoCache: this.opts.partInfoCache,
        subAsmCache,
        resolvePartInfo: (opfs, partPath, cache) =>
          resolvePartInfo(opfs as unknown as import('@zilventor/kernel/src/storage/Opfs').Opfs, partPath, cache),
      });
      bytes = await kernel.exportStlAssembly(leaves, { binary: true });
    } else {
      throw new Error('ExportStl: no exportable document');
    }
    globalThis.__zilventorStlBytes = bytes;
    await triggerDownload(new Blob([bytes as BlobPart], { type: 'model/stl' }), {
      suggestedName: `${activeDocument.document.name}.stl`,
      mimeType: 'model/stl',
      extension: 'stl',
      description: 'STL file',
    });
  }

  /**
   * Build the sub-assembly cache adapter verbatim from App.tsx:3835-3841.
   * If the store is cold, run a BFS mirroring App.tsx:3182-3208 (addendum §2).
   */
  private async _buildSubAsmCache() {
    let docs = { ...this.opts.subAssemblyDocs };
    const innerPoses = { ...this.opts.subAssemblyInnerPoses };

    if (Object.keys(docs).length === 0 && this.opts.activeDocument.kind === 'assembly') {
      const opfs = this.opts.opfs;
      const stack: AssemblyDocument[] = [this.opts.activeDocument.document];
      const seen = new Set<string>();
      while (stack.length) {
        const d = stack.pop()!;
        for (const c of d.components) {
          if (!c.partPath.endsWith('.ziasm')) continue;
          if (seen.has(c.partPath)) continue;
          seen.add(c.partPath);
          if (docs[c.partPath]) {
            stack.push(docs[c.partPath]!);
            continue;
          }
          try {
            if (await opfs.exists(c.partPath)) {
              const sub = await unpackAssembly(await opfs.read(c.partPath));
              docs[c.partPath] = sub;
              innerPoses[c.partPath] = computeInnerStaticPoses(sub);
              stack.push(sub);
            }
          } catch {
            /* skip corrupt */
          }
        }
      }
    } else {
      for (const [p, d] of Object.entries(docs)) {
        if (!innerPoses[p]) {
          innerPoses[p] = computeInnerStaticPoses(d);
        }
      }
    }

    return {
      get: (p: string) =>
        docs[p]
          ? ({
              kind: 'ok' as const,
              doc: docs[p]!,
              partPath: p,
              ...(innerPoses[p] ? { innerStaticPoses: innerPoses[p] } : {}),
            })
          : undefined,
    };
  }

  async revert(): Promise<void> {
    /* non-undoable */
  }
}
