import { describe, expect, it } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { visibleLeaves } from '../visibleLeaves';
import type { SubAssemblyCache } from '../../SubAssemblyCache';

function doc(over: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return { id: 'x', name: 'x', units: 'mm', parameters: {}, components: [], constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [], ...over };
}
function stubCache(map: Map<string, AssemblyDocument>): SubAssemblyCache {
  return { get: (p: string) => map.has(p) ? { kind: 'ok', doc: map.get(p)!, partPath: p } as const : undefined } as unknown as SubAssemblyCache;
}

describe('visibleLeaves', () => {
  it('emits one entry per leaf with full componentPath', () => {
    const sub = doc({ components: [
      { id: 'leaf-a', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'leaf-b', partPath: 'p.zipt', position: { x: 1, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 'sub', partPath: 's.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const out = visibleLeaves(top, stubCache(new Map([['s.ziasm', sub]])));
    const keys = out.map((l) => pathKey(l.componentPath)).sort();
    expect(keys).toEqual([pathKey(['sub', 'leaf-a']), pathKey(['sub', 'leaf-b'])].sort());
  });

  it('omits leaves whose ancestry includes visible:false', () => {
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 'sub', partPath: 's.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: false },
    ] });
    expect(visibleLeaves(top, stubCache(new Map([['s.ziasm', sub]])))).toEqual([]);
  });

  it('emits a placeholder leaf for a missing sub-asm reference', () => {
    const top = doc({ components: [
      { id: 'broken', partPath: 'missing.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const out = visibleLeaves(top, stubCache(new Map()));
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('placeholder');
    expect(out[0]!.componentPath).toEqual(['broken']);
  });

  it('emits placeholder for a cycle-position sub-asm placement', () => {
    const a = doc({ components: [
      { id: 'self', partPath: 'a.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 't', partPath: 'a.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const cache = stubCache(new Map([['a.ziasm', a]]));
    const out = visibleLeaves(top, cache);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('placeholder');
    expect(out[0]!.componentPath).toEqual(['t', 'self']);
  });

  it('emits placeholder for a transitive cycle (A -> B -> A)', () => {
    const a = doc({ components: [
      { id: 'p', partPath: 'b.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const b = doc({ components: [
      { id: 'p', partPath: 'a.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 't', partPath: 'a.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const cache = stubCache(new Map([['a.ziasm', a], ['b.ziasm', b]]));
    const out = visibleLeaves(top, cache);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('placeholder');
    expect(out[0]!.componentPath).toEqual(['t', 'p', 'p']);
  });
});
