import { describe, expect, it } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { flattenForSolver } from '../flattenForSolver';
import type { SubAssemblyCache } from '../../SubAssemblyCache';

function doc(over: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return { id: 'x', name: 'x', units: 'mm', parameters: {}, components: [], constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {}, ...over };
}
function cache(): SubAssemblyCache {
  return { get: () => undefined } as unknown as SubAssemblyCache;
}

describe('flattenForSolver — top-level baseline', () => {
  it('emits one unknown per top-level part component', () => {
    const top = doc({ components: [
      { id: 'a', partPath: 'p.zipt', position: { x: 1, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'b', partPath: 'p.zipt', position: { x: 5, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const r = flattenForSolver(top, cache());
    expect(r.unknowns).toHaveLength(2);
    expect(r.pathToUnknown.get(pathKey(['a']))).toBe(0);
    expect(r.pathToUnknown.get(pathKey(['b']))).toBe(1);
    expect(r.unknowns[0]!.translation.x).toBeCloseTo(1);
    expect(r.unknowns[1]!.translation.x).toBeCloseTo(5);
  });

  it('does not emit unknowns for sub-asms when cache misses (broken-ref placeholder)', () => {
    const top = doc({ components: [
      { id: 's', partPath: 'sub.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const r = flattenForSolver(top, cache());
    expect(r.unknowns).toHaveLength(0);
  });

  it('passes through top-level constraints with single-elem componentPath', () => {
    const top = doc({
      components: [
        { id: 'a', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'b', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [
        { id: 'm1', kind: 'mate',
          refA: { kind: 'face', componentPath: ['a'], face: { featureId: 'E1', role: 'top' } },
          refB: { kind: 'face', componentPath: ['b'], face: { featureId: 'E1', role: 'bottom' } },
          offset: { kind: 'literal', value: 0 },
          suppressed: false,
        },
      ],
    });
    const r = flattenForSolver(top, cache());
    expect(r.constraints).toHaveLength(1);
    expect(r.constraints[0]!.refA.componentPath).toEqual(['a']);
  });
});
