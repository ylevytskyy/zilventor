import type { AssemblyDocument } from '@zilventor/shared';
import { composePoses } from '../assembly/walkers/composedPoses';
import type { Pose } from '../assembly/walkers/flattenForSolver';
import { componentLocalPose } from '../assembly/walkers/componentLocalPose';

export type ProjectionLeaf = {
  /** Kernel partId for this leaf (matches the id passed to kernel.execute). */
  partId: string;
  pose: {
    translation: { x: number; y: number; z: number };
    quaternion: readonly [number, number, number, number];
  };
};

type SubAsmLookup = (partPath: string) => AssemblyDocument | undefined;

const IDENTITY_POSE: Pose = {
  translation: { x: 0, y: 0, z: 0 },
  quaternion: [0, 0, 0, 1],
};

function componentPose(c: AssemblyDocument['components'][number]): Pose {
  return componentLocalPose(c);
}

/**
 * Flatten an AssemblyDocument into a list of (partId, world-pose) pairs for
 * projection. Components where `suppressed === true` or `visible === false`
 * are excluded. Sub-assemblies are recursively expanded with composed poses.
 *
 * @param asm - The top-level AssemblyDocument to flatten.
 * @param lookupSubAsm - Returns the sub-assembly document for a `.ziasm` path,
 *   or undefined if not loaded. Unresolvable or cyclic sub-assemblies are skipped.
 * @param partPathToId - Maps a leaf part's `partPath` (e.g. `"chair.zipt"`)
 *   to the kernel partId used when that part was executed. Leaf components
 *   whose partPath is not in this map are skipped.
 */
export function flattenAssemblyForProjection(
  asm: AssemblyDocument,
  lookupSubAsm: SubAsmLookup,
  partPathToId: Map<string, string>,
): ProjectionLeaf[] {
  const out: ProjectionLeaf[] = [];

  function walk(doc: AssemblyDocument, parentPose: Pose, visited: Set<string>) {
    for (const c of doc.components) {
      if (c.visible === false) continue;
      if ((c as { suppressed?: boolean }).suppressed === true) continue;

      const localPose = componentPose(c);
      const worldPose = composePoses(parentPose, localPose);

      if (!c.partPath.endsWith('.ziasm')) {
        const partId = partPathToId.get(c.partPath);
        if (!partId) continue;
        out.push({
          partId,
          pose: {
            translation: worldPose.translation,
            quaternion: worldPose.quaternion,
          },
        });
      } else {
        if (visited.has(c.partPath)) continue;
        const subDoc = lookupSubAsm(c.partPath);
        if (!subDoc) continue;
        const next = new Set(visited);
        next.add(c.partPath);
        walk(subDoc, worldPose, next);
      }
    }
  }

  walk(asm, IDENTITY_POSE, new Set());
  return out;
}
