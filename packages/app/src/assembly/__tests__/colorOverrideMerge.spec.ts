import { describe, expect, it } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { mergeAndPruneColorOverrides } from '../colorOverrideMerge';
import type { SubAssemblyCache } from '../SubAssemblyCache';

function doc(over: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return { id: 'x', name: 'x', units: 'mm', parameters: {}, components: [], constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [], hardware: [], ...over };
}
function stubCache(map: Map<string, AssemblyDocument>): SubAssemblyCache {
  return { get: (p: string) => map.has(p) ? { kind: 'ok', doc: map.get(p)!, partPath: p } as const : undefined } as unknown as SubAssemblyCache;
}

describe('mergeAndPruneColorOverrides', () => {
  it('drops keys whose component path no longer exists', () => {
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({
      components: [
        { id: 'sub1', partPath: 's.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      colorOverrides: {
        [pathKey(['sub1', 'leaf'])]: { kind: 'hex', hex: '#aabbcc' },
        [pathKey(['sub1', 'gone'])]: { kind: 'hex', hex: '#112233' },
      },
    });
    const next = mergeAndPruneColorOverrides(top, stubCache(new Map([['s.ziasm', sub]])));
    expect(next.colorOverrides).toEqual({ [pathKey(['sub1', 'leaf'])]: { kind: 'hex', hex: '#aabbcc' } });
  });
});
