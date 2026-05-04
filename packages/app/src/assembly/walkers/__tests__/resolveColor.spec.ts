import { describe, expect, it } from 'vitest';
import type { AssemblyDocument, ComponentColor } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { resolveColor } from '../resolveColor';
import type { SubAssemblyCache } from '../../SubAssemblyCache';

function doc(over: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return { id: 'x', name: 'x', units: 'mm', parameters: {}, components: [], constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [], hardware: [], ...over };
}
function stubCache(map: Map<string, AssemblyDocument>): SubAssemblyCache {
  return { get: (p: string) => map.has(p) ? { kind: 'ok', doc: map.get(p)!, partPath: p } as const : undefined } as unknown as SubAssemblyCache;
}

describe('resolveColor', () => {
  it('returns leaf color when no override and no ancestor tint', () => {
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'palette', name: 'oak' } as ComponentColor },
    ] });
    const top = doc({ components: [
      { id: 'sub', partPath: 's.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    expect(resolveColor(['sub', 'leaf'], top, stubCache(new Map([['s.ziasm', sub]])))).toEqual({ kind: 'palette', name: 'oak' });
  });

  it('returns top-down placement tint when leaf has no color', () => {
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 'sub', partPath: 's.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'hex', hex: '#ff00aa' } },
    ] });
    expect(resolveColor(['sub', 'leaf'], top, stubCache(new Map([['s.ziasm', sub]])))).toEqual({ kind: 'hex', hex: '#ff00aa' });
  });

  it('per-leaf override beats placement tint and leaf color', () => {
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'palette', name: 'oak' } },
    ] });
    const top = doc({
      components: [
        { id: 'sub', partPath: 's.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'hex', hex: '#ff00aa' } },
      ],
      colorOverrides: { [pathKey(['sub', 'leaf'])]: { kind: 'palette', name: 'walnut' } },
    });
    expect(resolveColor(['sub', 'leaf'], top, stubCache(new Map([['s.ziasm', sub]])))).toEqual({ kind: 'palette', name: 'walnut' });
  });

  it('override at ancestor (sub-asm) path does NOT propagate to leaves below', () => {
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'palette', name: 'oak' } },
    ] });
    const top = doc({
      components: [
        { id: 'sub', partPath: 's.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      colorOverrides: { [pathKey(['sub'])]: { kind: 'palette', name: 'walnut' } },
    });
    expect(resolveColor(['sub', 'leaf'], top, stubCache(new Map([['s.ziasm', sub]])))).toEqual({ kind: 'palette', name: 'oak' });
  });

  it('returns undefined when nothing in chain has a color', () => {
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 'sub', partPath: 's.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    expect(resolveColor(['sub', 'leaf'], top, stubCache(new Map([['s.ziasm', sub]])))).toBeUndefined();
  });
});
