import type { AssemblyConstraint, AssemblyDocument, ComponentInstance, ComponentPath, Vec3 } from '@zilventor/shared';
import { pathKey, parsePathKey } from '@zilventor/shared';
import type { SubAssemblyCache } from '../SubAssemblyCache';

export type Pose = { translation: Vec3; quaternion: [number, number, number, number] };

export type SolverInput = {
  unknowns: Pose[];
  pathToUnknown: Map<string, number>;
  /** Canonical pathKey for each unknown index (top-level component id OR rigid sub-asm root pathKey). */
  primaryPathByIndex: string[];
  constraints: AssemblyConstraint[];
  /** For rigid sub-asms: which top-of-subtree path maps to which unknown. */
  rigidSubtreeRoots: Map<string, ComponentPath>;
  /** For each leaf inside a rigid sub-asm: the composed static pose relative to the rigid root. */
  rigidLeafStaticPoses: Map<string, Pose>;
};

function initialPose(c: ComponentInstance): Pose {
  if (c.pose) return c.pose;
  return {
    translation: { x: c.position.x, y: c.position.y, z: c.position.z },
    quaternion: [0, 0, 0, 1],
  };
}

function prefixRef<T extends { componentPath: ComponentPath }>(ref: T, prefix: ComponentPath): T {
  return { ...ref, componentPath: [...prefix, ...ref.componentPath] };
}

function prefixConstraint(c: AssemblyConstraint, prefix: ComponentPath): AssemblyConstraint {
  switch (c.kind) {
    case 'mate':
    case 'flush':
      return { ...c, refA: prefixRef(c.refA, prefix), refB: prefixRef(c.refB, prefix) };
    case 'angle':
      return { ...c, refA: prefixRef(c.refA, prefix), refB: prefixRef(c.refB, prefix) };
    case 'insert':
      return {
        ...c,
        refA: { ...c.refA, componentPath: [...prefix, ...c.refA.componentPath] },
        refB: { ...c.refB, componentPath: [...prefix, ...c.refB.componentPath] },
      };
    default: {
      const _exhaustive: never = c;
      return _exhaustive;
    }
  }
}

export function flattenForSolver(
  activeDoc: AssemblyDocument,
  cache: Pick<SubAssemblyCache, 'get'>,
): SolverInput {
  const unknowns: Pose[] = [];
  const pathToUnknown = new Map<string, number>();
  const primaryPathByIndex: string[] = [];
  const constraints: AssemblyConstraint[] = [];
  const rigidSubtreeRoots = new Map<string, ComponentPath>();
  const rigidLeafStaticPoses = new Map<string, Pose>();

  function pushUnknown(path: string[], pose: Pose): number {
    const idx = unknowns.length;
    unknowns.push(pose);
    const k = pathKey(path);
    pathToUnknown.set(k, idx);
    primaryPathByIndex.push(k);
    return idx;
  }

  function walk(doc: AssemblyDocument, prefix: string[], inFlexible: boolean) {
    for (const c of doc.components) {
      const path = [...prefix, c.id];
      const isSubAsm = c.partPath.endsWith('.ziasm');
      if (!isSubAsm) {
        if (inFlexible || prefix.length === 0) {
          pushUnknown(path, initialPose(c));
        }
        continue;
      }
      const e = cache.get(c.partPath);
      if (!e || e.kind !== 'ok') continue;
      const subDoc = e.doc;
      if (!c.flexible) {
        const rootIdx = pushUnknown(path, initialPose(c));
        rigidSubtreeRoots.set(pathKey(path), path);
        // Register rigid-leaf paths under the rigid root's unknown index so
        // top-level constraints targeting leaves inside this rigid sub-asm
        // can resolve. The leaf's static-relative pose (from
        // innerStaticPoses) is recorded so the solver bridge can pre-compose
        // it into the extracted PartLocalGeometry.
        const inner = (e as { innerStaticPoses?: Map<string, Pose> }).innerStaticPoses;
        if (inner) {
          for (const [innerKey, innerPose] of inner) {
            const innerPath = parsePathKey(innerKey);
            const leafFullPath = [...path, ...innerPath];
            const leafKey = pathKey(leafFullPath);
            pathToUnknown.set(leafKey, rootIdx);
            rigidLeafStaticPoses.set(leafKey, innerPose);
          }
        }
        // Do NOT recurse into rigid subtrees — leaves are computed in composedPoses.
        continue;
      }
      // flexible: placement is an unknown anchor, recurse with inFlexible=true,
      // inline sub-asm constraints with path-prefixed refs.
      pushUnknown(path, initialPose(c));
      walk(subDoc, path, true);
      for (const innerC of subDoc.constraints) {
        constraints.push(prefixConstraint(innerC, path));
      }
    }
  }
  // Top-level constraints, refs unchanged
  for (const c of activeDoc.constraints) constraints.push(c);
  walk(activeDoc, [], false);
  return { unknowns, pathToUnknown, primaryPathByIndex, constraints, rigidSubtreeRoots, rigidLeafStaticPoses };
}
