import { describe, expect, it } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { aggregateBomRecursive } from '../aggregateBomRecursive';
import type { SubAssemblyCache } from '../../SubAssemblyCache';

function doc(over: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return { id: 'x', name: 'x', units: 'mm', parameters: {}, components: [], constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {}, ...over };
}
function stubCache(map: Map<string, AssemblyDocument>): SubAssemblyCache {
  return { get: (p: string) => map.has(p) ? { kind: 'ok', doc: map.get(p)!, partPath: p } as const : undefined } as unknown as SubAssemblyCache;
}
const names = (m: Record<string, string>) => new Map(Object.entries(m));

describe('aggregateBomRecursive', () => {
  it('aggregates leaves across a 2-level tree by partPath', () => {
    const drawer = doc({ components: [
      { id: 'pa', partPath: 'panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'pb', partPath: 'panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 'd1', partPath: 'drawer.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'd2', partPath: 'drawer.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const rows = aggregateBomRecursive(top, stubCache(new Map([['drawer.ziasm', drawer]])), names({ 'panel.zipt': 'Panel' }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.qty).toBe(4);
  });

  it('splits rows when a per-leaf override changes effective color', () => {
    const drawer = doc({ components: [
      { id: 'pa', partPath: 'panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'palette', name: 'oak' } },
      { id: 'pb', partPath: 'panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'palette', name: 'oak' } },
    ] });
    const top = doc({
      components: [
        { id: 'd1', partPath: 'drawer.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      colors: { oak: '#a0651e', walnut: '#5b3a1a' },
      colorOverrides: { [pathKey(['d1', 'pa'])]: { kind: 'palette', name: 'walnut' } },
    });
    const rows = aggregateBomRecursive(top, stubCache(new Map([['drawer.ziasm', drawer]])), names({ 'panel.zipt': 'Panel' }));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.qty).sort()).toEqual([1, 1]);
  });

  it('skips broken sub-asm refs', () => {
    const top = doc({ components: [
      { id: 'broken', partPath: 'missing.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'cube', partPath: 'cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const rows = aggregateBomRecursive(top, stubCache(new Map()), names({ 'cube.zipt': 'Cube' }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.partPath).toBe('cube.zipt');
  });
});
