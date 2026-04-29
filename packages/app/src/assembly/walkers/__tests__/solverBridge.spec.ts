import { describe, expect, it } from 'vitest';
import type { AssemblyConstraint, AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { flattenForSolver } from '../flattenForSolver';
import { composedPoses } from '../composedPoses';
import { solveAssembly } from '@zilventor/kernel/src/assembly/AssemblyConstraintSolver';
import type { PartLocalGeometry } from '@zilventor/kernel/src/assembly/AssemblyConstraintRefs';

/**
 * Solver-bridge wiring (T31b) — exercises the flatten → rewrite-refs →
 * solveAssembly → composedPoses pipeline that App.tsx runs end-to-end.
 *
 * The goal: prove that constraints inside a flexible sub-asm participate in
 * the parent's LM solve, so the inner components end up at composed poses
 * that satisfy the inner constraint.
 */

function doc(over: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return {
    id: 'x', name: 'x', units: 'mm', parameters: {},
    components: [], constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {},
    ...over,
  };
}

/** Mirror App.tsx's constraint-rewrite step: collapse ref.componentPath to [pathKey(path)]. */
function rewriteRefs(constraints: AssemblyConstraint[]): AssemblyConstraint[] {
  return constraints.map((k) => ({
    ...k,
    refA: { ...k.refA, componentPath: [pathKey(k.refA.componentPath)] },
    refB: { ...k.refB, componentPath: [pathKey(k.refB.componentPath)] },
  }) as AssemblyConstraint);
}

describe('Solver bridge (T31b) — top-level baseline', () => {
  it('top-level mate constraint solves through the path-keyed bridge', () => {
    // Two top-level cubes A and B. A is grounded at origin, B floats.
    // A face-face mate brings B's bottom face onto A's top face.
    // pathKey([id]) === id, so this should match the legacy id-based behavior.
    const top = doc({
      components: [
        { id: 'a', partPath: 'cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'b', partPath: 'cube.zipt', position: { x: 0, y: 0, z: 100 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      groundedComponentPaths: [['a']],
      constraints: [
        { id: 'm1', kind: 'mate',
          refA: { kind: 'face', componentPath: ['a'], face: { featureId: 'F', role: 'top' } },
          refB: { kind: 'face', componentPath: ['b'], face: { featureId: 'F', role: 'bottom' } },
          offset: { kind: 'literal', value: 0 },
          suppressed: false,
        },
      ],
    });
    const cache = { get: () => undefined };
    const flat = flattenForSolver(top, cache);
    expect(flat.unknowns).toHaveLength(2);

    // Build resolvedRefs keyed by `${k.id}#${pathKey(refPath)}` (matches App.tsx step 2).
    // 'a' top face: at z=50, normal +Z. 'b' bottom face: at z=0, normal -Z (face-face mate
    // requires anti-parallel normals).
    const resolvedRefs = new Map<string, PartLocalGeometry>();
    resolvedRefs.set(`m1#${pathKey(['a'])}`, { kind: 'plane', P: { x: 0, y: 0, z: 50 }, N: { x: 0, y: 0, z: 1 } });
    resolvedRefs.set(`m1#${pathKey(['b'])}`, { kind: 'plane', P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: -1 } });

    const indexToPath = new Array<string>(flat.unknowns.length);
    for (const [k, v] of flat.pathToUnknown) indexToPath[v] = k;

    const out = solveAssembly({
      components: flat.unknowns.map((p, i) => ({ id: indexToPath[i]!, T: p.translation, q: p.quaternion })),
      groundedComponentIds: top.groundedComponentPaths.map(pathKey).filter((k) => flat.pathToUnknown.has(k)),
      constraints: rewriteRefs(flat.constraints),
      resolvedRefs,
      paramValues: {},
    });

    // a is grounded at z=0 with top face at z=50. b's bottom face must end up
    // at z=50 (so b.position.z = 50). Mate: face-face coincident with anti-
    // parallel normals → pulls b down so its bottom face touches a's top face.
    const poseA = out.poses.get(pathKey(['a']))!;
    const poseB = out.poses.get(pathKey(['b']))!;
    expect(poseA.translation.z).toBeCloseTo(0);
    expect(poseB.translation.z).toBeCloseTo(50, 1);
  });
});

describe('Solver bridge (T31b) — flexible sub-asm path-keyed solve', () => {
  it('inner mate constraint inside a flexible sub-asm solves through the parent LM', () => {
    // Top has one flexible sub-asm placement at the origin (grounded).
    // Sub has two inner cubes 'a' and 'b' with an inner face-face mate.
    // Sub-asm placement 's' is grounded; inner 'a' is also grounded so the
    // mate has a stable anchor; inner 'b' must be pulled into contact.
    const sub = doc({
      components: [
        { id: 'a', partPath: 'cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'b', partPath: 'cube.zipt', position: { x: 0, y: 0, z: 100 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [
        { id: 'innerMate', kind: 'mate',
          refA: { kind: 'face', componentPath: ['a'], face: { featureId: 'F', role: 'top' } },
          refB: { kind: 'face', componentPath: ['b'], face: { featureId: 'F', role: 'bottom' } },
          offset: { kind: 'literal', value: 0 },
          suppressed: false,
        },
      ],
    });
    const top = doc({
      components: [
        { id: 's', partPath: 'sub.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, flexible: true },
      ],
      // Ground both 's' (placement) and ['s', 'a'] (inner anchor) so the LM
      // has a stable reference frame for the inner mate.
      groundedComponentPaths: [['s'], ['s', 'a']],
    });
    const cache = {
      get: (p: string) => p === 'sub.ziasm' ? { kind: 'ok' as const, doc: sub, partPath: p } : undefined,
    };
    const flat = flattenForSolver(top, cache);
    // Flexible sub-asm: placement 's' + inner 'a' + inner 'b' = 3 unknowns.
    expect(flat.unknowns).toHaveLength(3);
    expect(flat.constraints).toHaveLength(1);
    // The inner constraint's componentPath was prefixed by flatten.
    expect(flat.constraints[0]!.refA.componentPath).toEqual(['s', 'a']);
    expect(flat.constraints[0]!.refB.componentPath).toEqual(['s', 'b']);

    // Build resolvedRefs keyed by pathKey of the prefixed paths.
    const resolvedRefs = new Map<string, PartLocalGeometry>();
    resolvedRefs.set(`innerMate#${pathKey(['s', 'a'])}`, { kind: 'plane', P: { x: 0, y: 0, z: 50 }, N: { x: 0, y: 0, z: 1 } });
    resolvedRefs.set(`innerMate#${pathKey(['s', 'b'])}`, { kind: 'plane', P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: -1 } });

    const indexToPath = new Array<string>(flat.unknowns.length);
    for (const [k, v] of flat.pathToUnknown) indexToPath[v] = k;

    const groundedComponentIds = top.groundedComponentPaths
      .map((p) => pathKey(p))
      .filter((k) => flat.pathToUnknown.has(k));

    const out = solveAssembly({
      components: flat.unknowns.map((p, i) => ({ id: indexToPath[i]!, T: p.translation, q: p.quaternion })),
      groundedComponentIds,
      constraints: rewriteRefs(flat.constraints),
      resolvedRefs,
      paramValues: {},
    });

    // ['s'] is grounded at origin; ['s', 'a'] is grounded at sub's local origin.
    // The inner mate pulls ['s', 'b'] from initial z=100 to z=50 so its bottom
    // face touches a's top face at z=50.
    const poseSB = out.poses.get(pathKey(['s', 'b']))!;
    expect(poseSB.translation.z).toBeCloseTo(50, 1);
  });

  it('composedPoses surfaces solver result for both rigid and flexible leaves', () => {
    // Mixed scenario: one top-level solo cube + one rigid sub-asm placement.
    // Verifies composedPoses returns a Map<pathKey, Pose> covering all
    // visible leaves: the solo cube key is the top-level segment, and the
    // rigid leaf key is composed via innerStaticPoses.
    const sub = doc({
      components: [
        { id: 'leaf', partPath: 'cube.zipt', position: { x: 2, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    const top = doc({
      components: [
        { id: 'solo', partPath: 'cube.zipt', position: { x: 7, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'rig', partPath: 'sub.ziasm', position: { x: 5, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    const cache = {
      get: (p: string) => p === 'sub.ziasm'
        ? {
            kind: 'ok' as const,
            doc: sub,
            partPath: p,
            innerStaticPoses: new Map([[pathKey(['leaf']), { translation: { x: 2, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] }]]),
          }
        : undefined,
    };
    const flat = flattenForSolver(top, cache);
    // Two top-level unknowns: 'solo' and 'rig' placement. Inner 'leaf' is rigid.
    expect(flat.unknowns).toHaveLength(2);

    const composed = composedPoses(top, cache, {
      pathToUnknown: flat.pathToUnknown,
      poses: flat.unknowns,
      rigidSubtreeRoots: flat.rigidSubtreeRoots,
    });

    expect(composed.get(pathKey(['solo']))!.translation.x).toBeCloseTo(7);
    expect(composed.get(pathKey(['rig']))!.translation.x).toBeCloseTo(5);
    // Rigid leaf composed: 5 (placement) + 2 (inner static) = 7
    expect(composed.get(pathKey(['rig', 'leaf']))!.translation.x).toBeCloseTo(7);
  });
});
