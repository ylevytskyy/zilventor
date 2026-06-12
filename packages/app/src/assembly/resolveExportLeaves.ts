import type { AssemblyDocument, ComponentColor } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { visibleLeaves } from './walkers/visibleLeaves';
import { composedPoses } from './walkers/composedPoses';
import { flattenForSolver, type Pose } from './walkers/flattenForSolver';
import type { PartInfoCache } from '../shell/resolvePartInfo';
import type { ExportLeaf, ExportPose } from '@zilventor/kernel/src/api';

/**
 * Resolve a (pre-resolved) ComponentColor union to a 0–1 RGB triple, mirroring
 * the renderer's palette/hex resolution (App.tsx:3915-3919). A palette name not
 * present in `colors`, or an absent color, yields undefined (= unmaterialized;
 * the export omits a color label for that leaf).
 *
 * Self-contained hex parser — does NOT import the kernel test helper hexToRgb01
 * (that is inaccessible to app code). Inline parse mirrors App.tsx:3916-3918.
 */
export function effectiveColorToRgb(
  color: ComponentColor | undefined,
  colors: Record<string, string>,
): readonly [number, number, number] | undefined {
  let hexStr: string | undefined;
  if (!color) return undefined;
  if (color.kind === 'hex') hexStr = color.hex;
  else if (color.kind === 'palette') hexStr = colors[color.name];
  if (!hexStr) return undefined;
  const h = hexStr.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/**
 * Sub-asm cache adapter shape consumed by visibleLeaves/composedPoses/flattenForSolver.
 *
 * CANONICAL ARG CONTRACT (addendum §2 — 5b MUST match exactly):
 *   assembly        — the top-level AssemblyDocument to export
 *   kernel          — { loadFromBytes(b): Promise<partId> } from the Comlink proxy
 *   opfs            — { read(p): Promise<Uint8Array> } for reading .zipt part bytes
 *   subAsmCache     — pre-warmed adapter built by the 5b command from the store
 *                     (App.tsx:3837–3841 shape; carries innerStaticPoses for rigid sub-asms)
 *   componentPoses  — solver-published Map<pathKey, Pose>; may be empty → forces recompute
 *   partInfoCache   — mutable Map<partPath, PartInfo>; passed through to resolvePartInfo
 *   resolvePartInfo — injected 3-arg fn matching resolvePartInfo.ts:7 signature
 *
 * This function is PURE — it does NOT run OPFS reads for sub-assemblies, call
 * unpackAssembly, or run the self-warm BFS. The 5b command builds the subAsmCache
 * adapter and passes it in. 5a only asserts that every placeholder is a hard error.
 */
type ExportSubAsmCache = {
  get(p: string): { kind: 'ok'; doc: AssemblyDocument; partPath: string; innerStaticPoses?: Map<string, Pose> } | undefined;
};

const IDENTITY_POSE: ExportPose = { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] };

export async function resolveExportLeaves(args: {
  assembly: AssemblyDocument;
  kernel: { loadFromBytes(b: Uint8Array): Promise<string> };
  opfs: { read(p: string): Promise<Uint8Array> };
  /** Pre-warmed sub-asm cache adapter — the 5b command builds this from
   *  useAppStore.getState().subAssemblyDocs + subAssemblyInnerPoses (App.tsx:3837–3841).
   *  For flat assemblies (no .ziasm children), pass { get: () => undefined }. */
  subAsmCache: ExportSubAsmCache;
  componentPoses: Map<string, Pose>;
  partInfoCache: PartInfoCache;
  /** Injected 3-arg function matching resolvePartInfo.ts:7 — (opfs, partPath, cache) → PartInfo */
  resolvePartInfo: (opfs: { read(p: string): Promise<Uint8Array> }, partPath: string, cache: PartInfoCache) => Promise<{ name: string }>;
}): Promise<ExportLeaf[]> {
  const { assembly, kernel, opfs, subAsmCache, componentPoses, partInfoCache, resolvePartInfo } = args;

  // 1. Visible leaves over the (already-warmed) sub-asm cache.
  const leaves = visibleLeaves(assembly, subAsmCache);

  // 2. Unresolved sub-assembly leaves are a hard error — never silently dropped.
  //    The 5b command MUST ensure subAsmCache is warm before calling here.
  for (const l of leaves) {
    if (l.kind === 'placeholder') {
      throw new Error(`export: unresolved sub-assembly leaf ${l.partPath}`);
    }
  }

  // 3. World poses. Prefer the already-solved componentPoses; if it doesn't
  //    cover every leaf (first render after a mutation), recompute via
  //    flattenForSolver + composedPoses against initial unknown poses.
  let composedMap: Map<string, Pose> = componentPoses;
  if (!leaves.every((l) => composedMap.has(pathKey(l.componentPath)))) {
    const flat = flattenForSolver(assembly, subAsmCache);
    composedMap = composedPoses(assembly, subAsmCache, {
      pathToUnknown: flat.pathToUnknown,
      poses: flat.unknowns,
      rigidSubtreeRoots: flat.rigidSubtreeRoots,
    });
  }

  // 4. partPath → kernel partId (the persisted-UUID bridge). loadFromBytes is
  //    stable per part doc; warm one id per unique partPath.
  const partIdByPath = new Map<string, string>();
  const nameByPath = new Map<string, string>();
  for (const pp of new Set(leaves.map((l) => l.partPath))) {
    const bytes = await opfs.read(pp);
    partIdByPath.set(pp, await kernel.loadFromBytes(bytes));
    const info = await resolvePartInfo(opfs, pp, partInfoCache);
    nameByPath.set(pp, info.name || pp.split('/').pop() || pp);
  }

  // 5. Build one ExportLeaf per visible instance (prototype de-dup is a kernel concern).
  // PC-1: populate componentPath so checkInterference (Task 3) can read partId, pose,
  // name, AND componentPath from the same array — one walk, no zip.
  return leaves.map((l) => {
    const pose = composedMap.get(pathKey(l.componentPath)) ?? IDENTITY_POSE;
    const color = effectiveColorToRgb(l.effectiveColor, assembly.colors);
    return {
      partId: partIdByPath.get(l.partPath)!,
      name: nameByPath.get(l.partPath)!,
      pose: { translation: { ...pose.translation }, quaternion: [...pose.quaternion] as ExportPose['quaternion'] },
      componentPath: l.componentPath,
      ...(color !== undefined ? { color } : {}),
    };
  });
}
