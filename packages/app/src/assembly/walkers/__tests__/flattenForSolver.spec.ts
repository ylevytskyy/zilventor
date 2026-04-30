import { describe, expect, it } from 'vitest';
import type { AssemblyConstraint, AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { flattenForSolver } from '../flattenForSolver';
import type { SubAssemblyCache } from '../../SubAssemblyCache';

function doc(over: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return { id: 'x', name: 'x', units: 'mm', parameters: {}, components: [], constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {}, properties: {}, ...over };
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

describe('flattenForSolver — rigid sub-asm composite', () => {
  it('emits exactly one unknown for a rigid sub-asm placement; rigid leaves point at root index', () => {
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 7, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 's1', partPath: 'sub.ziasm', position: { x: 5, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const innerStaticPoses = new Map<string, { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] }>([
      [pathKey(['leaf']), { translation: { x: 7, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] }],
    ]);
    const cache = { get: (p: string) => p === 'sub.ziasm' ? { kind: 'ok' as const, doc: sub, partPath: p, innerStaticPoses } : undefined } as unknown as SubAssemblyCache;
    const r = flattenForSolver(top, cache);
    expect(r.unknowns).toHaveLength(1);
    expect(r.pathToUnknown.get(pathKey(['s1']))).toBe(0);
    expect(r.pathToUnknown.get(pathKey(['s1', 'leaf']))).toBe(0);
    expect(r.rigidSubtreeRoots.get(pathKey(['s1']))).toEqual(['s1']);
    expect(r.primaryPathByIndex[0]).toBe(pathKey(['s1']));
    const lp = r.rigidLeafStaticPoses.get(pathKey(['s1', 'leaf']));
    expect(lp).toBeDefined();
    expect(lp!.translation.x).toBeCloseTo(7);
  });

  it('emits no rigidLeafStaticPoses entries when the sub-asm has no innerStaticPoses', () => {
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 7, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 's1', partPath: 'sub.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const cache = { get: (p: string) => p === 'sub.ziasm' ? { kind: 'ok' as const, doc: sub, partPath: p } : undefined } as unknown as SubAssemblyCache;
    const r = flattenForSolver(top, cache);
    expect(r.unknowns).toHaveLength(1);
    expect(r.rigidLeafStaticPoses.size).toBe(0);
    expect(r.pathToUnknown.has(pathKey(['s1', 'leaf']))).toBe(false);
  });
});

describe('flattenForSolver — flexible inlining', () => {
  it('emits placement unknown PLUS one unknown per inner leaf', () => {
    const sub = doc({ components: [
      { id: 'a', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'b', partPath: 'p.zipt', position: { x: 1, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 's', partPath: 'sub.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, flexible: true },
    ] });
    const cache = { get: (p: string) => p === 'sub.ziasm' ? { kind: 'ok' as const, doc: sub, partPath: p } : undefined } as unknown as SubAssemblyCache;
    const r = flattenForSolver(top, cache);
    expect(r.unknowns).toHaveLength(3);
    expect(r.pathToUnknown.get(pathKey(['s']))).toBe(0);
    expect(r.pathToUnknown.get(pathKey(['s', 'a']))).toBe(1);
    expect(r.pathToUnknown.get(pathKey(['s', 'b']))).toBe(2);
    expect(r.rigidSubtreeRoots.size).toBe(0);
  });

  it('inlines sub-asm constraints with path-prefixed componentPath', () => {
    const subInner: AssemblyConstraint = {
      id: 'm1', kind: 'mate',
      refA: { kind: 'face', componentPath: ['a'], face: { featureId: 'E1', role: 'top' } },
      refB: { kind: 'face', componentPath: ['b'], face: { featureId: 'E1', role: 'bottom' } },
      offset: { kind: 'literal', value: 0 },
      suppressed: false,
    };
    const sub = doc({
      components: [
        { id: 'a', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'b', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [subInner],
    });
    const top = doc({ components: [
      { id: 's', partPath: 'sub.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, flexible: true },
    ] });
    const cache = { get: (p: string) => p === 'sub.ziasm' ? { kind: 'ok' as const, doc: sub, partPath: p } : undefined } as unknown as SubAssemblyCache;
    const r = flattenForSolver(top, cache);
    expect(r.constraints).toHaveLength(1);
    const c = r.constraints[0]!;
    expect(c.kind).toBe('mate');
    if (c.kind === 'mate') {
      expect(c.refA.componentPath).toEqual(['s', 'a']);
      expect(c.refB.componentPath).toEqual(['s', 'b']);
    }
  });
});
