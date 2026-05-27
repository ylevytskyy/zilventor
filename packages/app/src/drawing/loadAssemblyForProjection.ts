/**
 * Load an assembly tree into the kernel and build the AssemblyComponentInput[]
 * required by getProjectorInput({ kind: 'assembly', components }).
 *
 * Uses the SAME static-composition path as the 3D viewport (App.tsx:3229-3234):
 *   flattenForSolver(asmDoc, cache) → composedPoses(..., { poses: flat.unknowns }) — NO solver.
 *
 * Recursive nested assemblies: uses SubAssemblyCache.loadSubAssemblyTree(asmDoc) to
 * recursively load all nested .ziasm refs via OPFS (no constraint solver — solver=null).
 * After loadSubAssemblyTree, cache.get(partPath) returns SubAssemblyEntry | undefined
 * for any nested sub-asm. The adapter passed to visibleLeaves / flattenForSolver /
 * composedPoses is built from the populated cache — identical pattern to App.tsx:3209-3213.
 *
 * Composite fingerprint: running djb2 over asmBytes then each leaf's bytes in
 * visibleLeaves traversal order (depth-first, document order). Deterministic across
 * save+reopen because AssemblyDocument.components order is preserved by packAssembly.
 *
 * NOTE: djb2Bytes in loadDrawingSource.ts is a private (non-exported) function —
 * do NOT import it. This file inlines its own djb2Running variant.
 */
import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey, migrateManifest } from '@zilventor/shared';
import { SubAssemblyCache } from '../assembly/SubAssemblyCache';
import { visibleLeaves } from '../assembly/walkers/visibleLeaves';
import { flattenForSolver } from '../assembly/walkers/flattenForSolver';
import { composedPoses } from '../assembly/walkers/composedPoses';
import type { AssemblyComponentInput } from '@zilventor/kernel/src/adapter/drawing/getProjectorInput';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';

// ---- djb2 ----
// NOTE: djb2Bytes in loadDrawingSource.ts is private/non-exported — inlined here.
function djb2Running(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) {
    h = ((h << 5) + h) ^ bytes[i]!;
    h = h >>> 0;
  }
  return h;
}

function fingerprint(h: number): string {
  return h.toString(16).padStart(8, '0');
}

export type KernelForAsmLoad = {
  loadFromBytes(bytes: Uint8Array): Promise<string>;
  execute(partId: string): Promise<{ ok: boolean; error?: unknown }>;
};

export type OpfsForAsmLoad = {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<Uint8Array>;
};

export type LoadAssemblyForProjectionArgs = {
  asmPath: string;
  asmDoc: AssemblyDocument;
  opfs: OpfsForAsmLoad;
  kernel: KernelForAsmLoad;
};

export type LoadAssemblyForProjectionResult = {
  components: AssemblyComponentInput[];
  sourceFingerprint: string;
  componentColors: Record<string, string>; // kernel partId → material color (hex)
};

export async function loadAssemblyForProjection(
  args: LoadAssemblyForProjectionArgs,
): Promise<LoadAssemblyForProjectionResult> {
  const { asmPath, asmDoc, opfs, kernel } = args;

  // Step 1: Read and hash the top-level assembly bytes (fingerprint seed).
  const asmBytes = await opfs.read(asmPath);
  let fpHash = djb2Running(5381, asmBytes);

  // Step 2: Recursively load all nested .ziasm sub-assemblies via SubAssemblyCache.
  // solver=null → no constraint pre-solve (innerStaticPoses will be undefined for sub-asms,
  // which is fine — composedPoses falls back to Euler initial poses, identical to the
  // first-render path in App.tsx:3228-3234 before the solver has run).
  // loadSubAssemblyTree(asmDoc) calls walkTree(asmDoc, new Set()) which recursively
  // walks every component with a .ziasm partPath and calls loadSubAssembly (OPFS read +
  // unpackAssembly) for each, with cycle detection. After this call, cache.get(p) returns
  // the SubAssemblyEntry for any nested .ziasm path reachable from asmDoc.
  const subAsmCache = new SubAssemblyCache(opfs, null /* no solver */);
  await subAsmCache.loadSubAssemblyTree(asmDoc);

  // Step 3: Build the adapter (mirrors App.tsx:3209-3213) — passed to visibleLeaves,
  // flattenForSolver, composedPoses so nested .ziasm refs resolve to REAL leaves.
  // composedPoses expects only `kind: 'ok'` entries (or undefined) — filter out
  // error entries (missing/parse/cycle) so the type is compatible.
  const cacheAdapter = {
    get: (p: string) => {
      const e = subAsmCache.get(p);
      return e?.kind === 'ok' ? e : undefined;
    },
  };

  // Step 4: Get visible leaves (depth-first, filters visible:false).
  // With a populated cacheAdapter, visibleLeaves recurses into nested sub-asm docs
  // and returns their leaf parts — no placeholder entries for loaded sub-asms.
  const leaves = visibleLeaves(asmDoc, cacheAdapter);

  // Step 5: Build composed world poses — NO solver (static/initial unknowns only).
  const flat = flattenForSolver(asmDoc, cacheAdapter);
  const posesMap = composedPoses(asmDoc, cacheAdapter, {
    pathToUnknown: flat.pathToUnknown,
    poses: flat.unknowns,
    rigidSubtreeRoots: flat.rigidSubtreeRoots,
  });

  // Step 6: Load each unique part into the kernel and build AssemblyComponentInput[].
  // Fail fast on any missing file (spec: don't drop a part silently).
  const partIdCache = new Map<string, string>(); // partPath → kernel UUID
  const componentColors: Record<string, string> = {}; // kernel partId → material color (hex)
  const components: AssemblyComponentInput[] = [];

  for (const leaf of leaves) {
    if (leaf.kind !== 'leaf') continue; // skip any remaining placeholders (missing sub-asms)

    // Load part bytes and accumulate fingerprint in traversal order.
    const partBytes = await opfs.read(leaf.partPath); // throws OPFS_READ_FAILED on miss
    fpHash = djb2Running(fpHash, partBytes);

    // Load into kernel (idempotent if already loaded; loadFromBytes re-registers).
    let partId = partIdCache.get(leaf.partPath);
    if (!partId) {
      partId = await kernel.loadFromBytes(partBytes);
      const execResult = await kernel.execute(partId);
      if (!execResult.ok) {
        throw new Error(
          `loadAssemblyForProjection: kernel.execute failed for "${leaf.partPath}": ${String(execResult.error)}`,
        );
      }
      partIdCache.set(leaf.partPath, partId);

      // Extract primary material color from the manifest (same bytes — no extra OPFS read).
      try {
        const { manifest } = await unpackProject(partBytes);
        const migrated = migrateManifest(manifest as Parameters<typeof migrateManifest>[0]);
        const color = (migrated as { document?: { materials?: ReadonlyArray<{ color?: string }> } })
          .document?.materials?.[0]?.color;
        if (color) componentColors[partId] = color;
      } catch {
        // malformed manifest → no entry → gray fallback at resolve time
      }
    }

    // Compose world pose from flattenForSolver initial unknowns.
    const key = pathKey(leaf.componentPath);
    const pose = posesMap.get(key) ?? {
      translation: { x: 0, y: 0, z: 0 },
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
    };

    components.push({
      partId,
      pose: {
        translation: { x: pose.translation.x, y: pose.translation.y, z: pose.translation.z },
        quaternion: [...pose.quaternion] as [number, number, number, number],
      },
    });
  }

  return { components, sourceFingerprint: fingerprint(fpHash), componentColors };
}
