/**
 * Orchestration for the on-demand Interference / Clash Check.
 *
 * SC-6: reuses resolveExportLeaves — the only correct flatten+pose+load path.
 * PC-1: reads partId, pose, name, AND componentPath from the same ExportLeaf[]
 *        returned by resolveExportLeaves (no separate visibleLeaves call, no zip).
 * SC-7: carries both componentPath and componentPathKey in each ClashLeafMeta.
 */
import { buildClashReport, VOLUME_THRESHOLD_MM3, pathKey } from '@zilventor/shared';
import type { ClashReportRow, ClashLeafMeta, ClashPair, ComponentPath } from '@zilventor/shared';
import type { AssemblyDocument } from '@zilventor/shared';
import { resolveExportLeaves } from './resolveExportLeaves';
import type { PartInfoCache } from '../shell/resolvePartInfo';

type Pose = { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] };

type SubAsmCache = {
  get(p: string):
    | { kind: 'ok'; doc: AssemblyDocument; partPath: string; innerStaticPoses?: Map<string, Pose> }
    | undefined;
};

type KernelForClash = {
  loadFromBytes(b: Uint8Array): Promise<string>;
  checkInterference(
    leaves: ReadonlyArray<{ partId: string; pose: Pose }>,
    opts: { volumeThreshold: number; clearanceThreshold: number },
  ): Promise<ClashPair[]>;
};

type OpfsForClash = { read(p: string): Promise<Uint8Array>; exists(p: string): Promise<boolean> };

export async function runInterferenceCheck(args: {
  assembly: AssemblyDocument;
  kernel: KernelForClash;
  opfs: OpfsForClash;
  subAsmCache: SubAsmCache;
  componentPoses: Map<string, Pose>;
  partInfoCache: PartInfoCache;
  resolvePartInfo: (
    opfs: { read(p: string): Promise<Uint8Array> },
    partPath: string,
    cache: PartInfoCache,
  ) => Promise<{ name: string }>;
  clearanceThreshold: number;
}): Promise<ClashReportRow[]> {
  const { assembly, kernel, opfs, subAsmCache, componentPoses, partInfoCache, resolvePartInfo, clearanceThreshold } =
    args;

  // SC-6: resolveExportLeaves is the canonical path — visibleLeaves + composedPoses + loadFromBytes dedup.
  // PC-1: it now populates componentPath on every ExportLeaf so we can build leafMeta
  //        in one pass from the same array — no separate visibleLeaves call, no index-zip.
  let exportLeaves: Awaited<ReturnType<typeof resolveExportLeaves>>;
  try {
    exportLeaves = await resolveExportLeaves({
      assembly,
      kernel: { loadFromBytes: (b) => kernel.loadFromBytes(b) },
      opfs,
      subAsmCache,
      componentPoses,
      partInfoCache,
      resolvePartInfo: (o, p, c) =>
        resolvePartInfo(o as { read(p: string): Promise<Uint8Array> }, p, c),
    });
  } catch {
    // Unresolved sub-assembly or OPFS error — return empty rather than surface a crash.
    return [];
  }

  if (exportLeaves.length < 2) return [];

  // PC-1: build leafMeta[i] from the same ExportLeaf — one walk, no zip.
  // SC-7: carry both componentPath (for setSelectedComponentPaths) and
  //        componentPathKey (for highlight map key).
  const leafMeta: ClashLeafMeta[] = exportLeaves.map((leaf) => {
    const cp: ComponentPath = leaf.componentPath ?? [leaf.partId];
    return {
      componentPath: cp,
      componentPathKey: pathKey(cp),
      partName: leaf.name,
    };
  });

  // Kernel-ready leaves: { partId, pose } in the same order as leafMeta.
  const kernelLeaves = exportLeaves.map((l) => ({
    partId: l.partId,
    pose: l.pose as Pose,
  }));

  // PC-5: kernel sequences confirmed — call checkInterference directly.
  const pairs = await kernel.checkInterference(kernelLeaves, {
    volumeThreshold: VOLUME_THRESHOLD_MM3,
    clearanceThreshold,
  });

  return buildClashReport(pairs, leafMeta);
}
