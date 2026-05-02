import { describe, expect, it } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { composedPoses } from '../composedPoses';
import type { Pose } from '../flattenForSolver';

function doc(over: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return { id: 'x', name: 'x', units: 'mm', parameters: {}, components: [], constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [], ...over };
}
function tx(x: number): Pose { return { translation: { x, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] }; }

describe('composedPoses', () => {
  it('top-level component pose comes from solver result', () => {
    const top = doc({ components: [
      { id: 'a', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const cache = { get: () => undefined } as { get: (p: string) => undefined };
    const out = composedPoses(top, cache, {
      pathToUnknown: new Map([[pathKey(['a']), 0]]),
      poses: [tx(7)],
      rigidSubtreeRoots: new Map(),
    });
    expect(out.get(pathKey(['a']))!.translation.x).toBeCloseTo(7);
  });

  it('rigid sub-asm leaf pose = composite pose composed with inner static pose', () => {
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 2, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 's', partPath: 'sub.ziasm', position: { x: 5, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const cache = {
      get: (p: string) => p === 'sub.ziasm'
        ? { kind: 'ok' as const, doc: sub, partPath: p, innerStaticPoses: new Map([[pathKey(['leaf']), tx(2)]]) }
        : undefined,
    };
    const out = composedPoses(top, cache, {
      pathToUnknown: new Map([[pathKey(['s']), 0]]),
      poses: [tx(5)],
      rigidSubtreeRoots: new Map([[pathKey(['s']), ['s']]]),
    });
    // Rigid leaf world = compose(tx(5), tx(2)) → translation.x = 7
    expect(out.get(pathKey(['s', 'leaf']))!.translation.x).toBeCloseTo(7);
  });

  it('rigid sub-asm with multi-segment inner static pose keys composes correctly', () => {
    // innerStaticPoses key is pathKey(['inner', 'leaf']) — a multi-segment path.
    // Bug repro: split(' ') would treat the whole pathKey as one segment.
    const outerSubDoc = doc({ components: [
      { id: 'inner', partPath: 'inner.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 's', partPath: 'outer.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const cache = {
      get: (p: string) => p === 'outer.ziasm'
        ? {
            kind: 'ok' as const,
            doc: outerSubDoc,
            partPath: p,
            innerStaticPoses: new Map([[pathKey(['inner', 'leaf']), tx(2)]]),
          }
        : undefined,
    } as any;
    const out = composedPoses(top, cache, {
      pathToUnknown: new Map([[pathKey(['s']), 0]]),
      poses: [tx(5)],
      rigidSubtreeRoots: new Map([[pathKey(['s']), ['s']]]),
    });
    // Expected leaf path is ['s', 'inner', 'leaf']; world translation = 5 + 2 = 7
    const leaf = out.get(pathKey(['s', 'inner', 'leaf']));
    expect(leaf).toBeDefined();
    expect(leaf!.translation.x).toBeCloseTo(7);
  });

  it('flexible sub-asm leaf pose comes directly from its own solver unknown', () => {
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 's', partPath: 'sub.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, flexible: true },
    ] });
    const cache = { get: (p: string) => p === 'sub.ziasm' ? { kind: 'ok' as const, doc: sub, partPath: p } : undefined };
    const out = composedPoses(top, cache, {
      pathToUnknown: new Map([[pathKey(['s']), 0], [pathKey(['s', 'leaf']), 1]]),
      poses: [tx(5), tx(11)],
      rigidSubtreeRoots: new Map(),
    });
    expect(out.get(pathKey(['s', 'leaf']))!.translation.x).toBeCloseTo(11);
  });

  it('composedPoses with a 90deg rotation parent + non-zero child translation', () => {
    // Parent rotated 90 deg about +Z (quaternion [0, 0, sin(45deg), cos(45deg)]).
    // Child has translation {0, 1, 0} (along +Y in child frame).
    // Expected world translation: parent rotates child's +Y to world +(-X) → {-1, 0, 0}.
    const sqrt2over2 = Math.SQRT1_2;
    const top = doc({ components: [
      { id: 'a', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const cache = { get: () => undefined } as any;
    const out = composedPoses(top, cache, {
      pathToUnknown: new Map([[pathKey(['a']), 0]]),
      poses: [{ translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, sqrt2over2, sqrt2over2] }],
      rigidSubtreeRoots: new Map(),
    });
    // The leaf 'a' is the unknown itself; its world pose is the rotation pose with no translation.
    expect(out.get(pathKey(['a']))!.translation.x).toBeCloseTo(0);
    // To exercise rotation in compose, do a rigid sub-asm test instead:
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top2 = doc({ components: [
      { id: 's', partPath: 'sub.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const cache2 = {
      get: (p: string) => p === 'sub.ziasm'
        ? {
            kind: 'ok' as const,
            doc: sub,
            partPath: p,
            // Inner static pose: leaf at (0, 1, 0) in sub frame
            innerStaticPoses: new Map([[pathKey(['leaf']), { translation: { x: 0, y: 1, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] }]]),
          }
        : undefined,
    } as any;
    const out2 = composedPoses(top2, cache2, {
      pathToUnknown: new Map([[pathKey(['s']), 0]]),
      poses: [{ translation: { x: 10, y: 0, z: 0 }, quaternion: [0, 0, sqrt2over2, sqrt2over2] }],
      rigidSubtreeRoots: new Map([[pathKey(['s']), ['s']]]),
    });
    // Composite at (10, 0, 0) rotated 90deg about Z. Inner leaf at local (0, 1, 0).
    // Rotated leaf in composite frame: 90deg-Z * (0, 1, 0) = (-1, 0, 0).
    // World leaf pose = composite_translation + rotated_leaf = (10 + (-1), 0, 0) = (9, 0, 0).
    const leaf = out2.get(pathKey(['s', 'leaf']));
    expect(leaf).toBeDefined();
    expect(leaf!.translation.x).toBeCloseTo(9);
    expect(leaf!.translation.y).toBeCloseTo(0);
    expect(leaf!.translation.z).toBeCloseTo(0);
  });
});
