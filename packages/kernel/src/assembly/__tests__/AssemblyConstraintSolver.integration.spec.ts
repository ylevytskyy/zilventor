import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../occt/occtLoader';
import { makeBox, disposeShape } from '../../occt/SolidOps';
import { namedFace, attachName, type NamedShape } from '../../occt/FaceNaming';
import { extractFacePlane } from '../../occt/WorkFeatureOps';
import type { FaceName } from '@zilventor/shared';
import {
  realExtractorBundle,
  AssemblyRefCache,
  resolveRef,
} from '../AssemblyConstraintRefs';
import { solveAssembly, type AssemblySolveInput } from '../AssemblyConstraintSolver';

let oc: OcctInstance;
beforeAll(async () => {
  oc = await loadOcct();
}, 60_000);

/**
 * Build a named 50×50×50 mm box at the origin ([0,50]³).
 * Enumerates all 6 faces and attaches names 'F0'..'F5' under featureId `prefix`.
 */
function buildNamedBox50(prefix: string): {
  nm: NamedShape;
  faceNames: FaceName[];
  cleanup: () => void;
} {
  const box = makeBox(oc, 50, 50, 50);
  const explorer = new oc.TopExp_Explorer_2(
    box.handle as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
  );
  const faces: unknown[] = [];
  while (explorer.More()) {
    faces.push(explorer.Current());
    explorer.Next();
  }
  explorer.delete();

  const nm: NamedShape = { shape: box, faceNames: [] };
  const faceNames: FaceName[] = [];
  faces.forEach((f, i) => {
    const name = namedFace(prefix, `F${i}`);
    attachName(nm, f, name);
    faceNames.push(name);
  });

  return {
    nm,
    faceNames,
    cleanup: () => {
      disposeShape(box);
      for (const f of faces) (f as { delete?: () => void }).delete?.();
    },
  };
}

/**
 * Find the face name whose plane origin has the given z-coordinate.
 * makeBox(50,50,50) creates a box spanning [0,50]³.
 * All faces report normal = +Z (OCCT gp_Pln axis), so we distinguish them
 * by origin instead:
 *   +Z face: origin.z ≈ 50  (top face)
 *   -Z face: origin.z ≈  0  (bottom face, distinguishable from X/Y faces
 *             because those have normal.z == 0)
 */
function findZFaceByOrigin(
  nm: NamedShape,
  faceNames: FaceName[],
  targetZ: number,
): FaceName | null {
  for (const fn of faceNames) {
    const r = extractFacePlane(oc, nm, fn);
    if (!r) continue;
    // Must be a Z-normal face (x≈0, y≈0, |z|≈1).
    if (Math.abs(r.normal.z) < 0.9) continue;
    if (Math.abs(r.origin.z - targetZ) < 1) return fn;
  }
  return null;
}

describe('AssemblyConstraintSolver integration (real OCCT)', () => {
  it('mate face↔face brings two cubes face-to-face within 1 mm', () => {
    const boxA = buildNamedBox50('A');
    const boxB = buildNamedBox50('B');

    try {
      // A's +Z face is at origin.z=50; B's -Z face is at origin.z=0.
      // Both faces return normal=(0,0,1) from OCCT (gp_Pln axis direction);
      // we distinguish them by their origin position.
      const faceNameA = findZFaceByOrigin(boxA.nm, boxA.faceNames, 50);
      const faceNameB = findZFaceByOrigin(boxB.nm, boxB.faceNames, 0);
      expect(faceNameA).not.toBeNull();
      expect(faceNameB).not.toBeNull();

      const ex = realExtractorBundle(oc);
      const cache = new AssemblyRefCache();

      const refA = {
        kind: 'face' as const,
        componentId: 'A',
        face: faceNameA!,
      };
      const refB = {
        kind: 'face' as const,
        componentId: 'B',
        face: faceNameB!,
      };

      // Resolve part-local geometry from OCCT.
      const localA = cache.getOrCompute('A.zipt', refA, () =>
        resolveRef(refA, boxA.nm, new Map(), ex),
      );
      const localB = cache.getOrCompute('B.zipt', refB, () =>
        resolveRef(refB, boxB.nm, new Map(), ex),
      );

      expect(localA.ok).toBe(true);
      expect(localB.ok).toBe(true);

      // extractFacePlane now returns the outward face normal (orientation-aware):
      // A's top face (+Z outward) => N=(0,0,+1); B's bottom face (-Z outward) => N=(0,0,-1).
      // The mate residual Na + Nb = 0 is satisfied by pure translation — no rotation needed.
      const geomA = (localA as { ok: true; value: any }).value;
      const geomB = (localB as { ok: true; value: any }).value;

      // B starts away from the mate target — solver must drive it to z=50.
      // After mate: B's -Z face (at B.T.z + 0 in B-local coords) touches A's +Z
      // face at z=50, so B.T.z = 50.
      const input: AssemblySolveInput = {
        components: [
          { id: 'A', T: { x: 0, y: 0, z: 0 }, q: [0, 0, 0, 1] },
          { id: 'B', T: { x: 0, y: 0, z: 80 }, q: [0, 0, 0, 1] },
        ],
        groundedComponentIds: ['A'],
        constraints: [
          {
            id: 'k1',
            kind: 'mate',
            suppressed: false,
            refA,
            refB,
            offset: { kind: 'literal', value: 0 } as any,
          },
        ],
        resolvedRefs: new Map([
          ['k1#A', geomA],
          ['k1#B', geomB],
        ]),
        paramValues: {},
      };

      const out = solveAssembly(input);
      const poseB = out.poses.get('B')!;

      // A's +Z face is at world z=50. B's bottom face (local z=0) should land there.
      expect(Math.abs(poseB.translation.z - 50)).toBeLessThan(1.0);

      // Constraint must not be a broken ref.
      expect(out.diagnostics.perConstraint.get('k1')!.brokenRef).toBe(false);

      // Solver must have converged.
      expect(out.diagnostics.status).not.toBe('did-not-converge');
    } finally {
      boxA.cleanup();
      boxB.cleanup();
    }
  });
});
