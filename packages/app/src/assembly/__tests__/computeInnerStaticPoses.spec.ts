import { describe, expect, it } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { computeInnerStaticPoses } from '../computeInnerStaticPoses';

function doc(over: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return {
    id: 'x', name: 'x', units: 'mm', parameters: {}, components: [], constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {}, ...over,
  };
}

describe('computeInnerStaticPoses', () => {
  it('returns each top-level part component at its declared position', () => {
    const sub = doc({ components: [
      { id: 'a', partPath: 'p.zipt', position: { x: 1, y: 2, z: 3 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'b', partPath: 'p.zipt', position: { x: 5, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const poses = computeInnerStaticPoses(sub);
    expect(poses.size).toBe(2);
    expect(poses.get(pathKey(['a']))!.translation).toEqual({ x: 1, y: 2, z: 3 });
    expect(poses.get(pathKey(['b']))!.translation).toEqual({ x: 5, y: 0, z: 0 });
  });

  it('returns an empty map for a sub-asm with no leaves', () => {
    const sub = doc({ components: [] });
    const poses = computeInnerStaticPoses(sub);
    expect(poses.size).toBe(0);
  });

  it('treats nested .ziasm refs as opaque (no recursion into unloaded sub-sub-asms)', () => {
    const sub = doc({ components: [
      { id: 'inner', partPath: 'sub.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const poses = computeInnerStaticPoses(sub);
    expect(poses.size).toBe(0);
  });
});
