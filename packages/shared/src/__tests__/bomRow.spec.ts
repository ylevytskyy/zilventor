import { describe, it, expect } from 'vitest';
import { bomRowKey, aggregateBom, type BomRow } from '../bomRow';
import type { AssemblyDocument } from '../types';

function makeAssembly(overrides: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return {
    id: 'A', name: 'A', units: 'mm', parameters: {},
    components: [], constraints: [], groundedComponentIds: [],
    colors: {}, bomItemNumbers: {},
    ...overrides,
  };
}

describe('bomRowKey', () => {
  it('returns ::none for missing color', () => {
    expect(bomRowKey('parts/cube.zipt')).toBe('parts/cube.zipt::none');
    expect(bomRowKey('parts/cube.zipt', undefined)).toBe('parts/cube.zipt::none');
  });

  it('encodes palette colors with name', () => {
    expect(bomRowKey('parts/cube.zipt', { kind: 'palette', name: 'Maple' }))
      .toBe('parts/cube.zipt::palette:Maple');
  });

  it('encodes hex colors normalised to lowercase', () => {
    expect(bomRowKey('parts/cube.zipt', { kind: 'hex', hex: '#CC8866' }))
      .toBe('parts/cube.zipt::hex:#cc8866');
  });

  it('does not collide across kinds with the same string after the prefix', () => {
    const a = bomRowKey('parts/cube.zipt', { kind: 'palette', name: '#Maple' });
    const b = bomRowKey('parts/cube.zipt', { kind: 'hex', hex: '#Maple' });
    expect(a).not.toBe(b);
  });
});

describe('aggregateBom', () => {
  it('aggregates identical components into one row with QTY = count', () => {
    const a = makeAssembly({
      components: [
        { id: 'C1', partPath: 'parts/cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'C2', partPath: 'parts/cube.zipt', position: { x: 1, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'C3', partPath: 'parts/cube.zipt', position: { x: 2, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    const rows = aggregateBom(a, new Map([['parts/cube.zipt', 'cube']]));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.qty).toBe(3);
    expect(rows[0]!.partName).toBe('cube');
    expect(rows[0]!.componentIds).toEqual(['C1', 'C2', 'C3']);
  });

  it('splits identical partPaths by color', () => {
    const a = makeAssembly({
      colors: { Maple: '#d4a574' },
      components: [
        { id: 'C1', partPath: 'parts/cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'C2', partPath: 'parts/cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'palette', name: 'Maple' } },
      ],
    });
    const rows = aggregateBom(a, new Map([['parts/cube.zipt', 'cube']]));
    expect(rows).toHaveLength(2);
  });

  it('uses stored item numbers when present and assigns max+1 for new keys', () => {
    const a = makeAssembly({
      components: [
        { id: 'C1', partPath: 'parts/a.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'C2', partPath: 'parts/b.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      bomItemNumbers: { 'parts/a.zipt::none': 5 },
    });
    const rows = aggregateBom(a, new Map([['parts/a.zipt', 'a'], ['parts/b.zipt', 'b']]));
    const aRow = rows.find((r) => r.partPath === 'parts/a.zipt')!;
    const bRow = rows.find((r) => r.partPath === 'parts/b.zipt')!;
    expect(aRow.itemNumber).toBe(5);
    expect(bRow.itemNumber).toBe(6);
  });

  it('sorts rows by itemNumber ASC', () => {
    const a = makeAssembly({
      components: [
        { id: 'C1', partPath: 'parts/a.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'C2', partPath: 'parts/b.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      bomItemNumbers: { 'parts/a.zipt::none': 7, 'parts/b.zipt::none': 3 },
    });
    const rows = aggregateBom(a, new Map([['parts/a.zipt', 'a'], ['parts/b.zipt', 'b']]));
    expect(rows.map((r) => r.itemNumber)).toEqual([3, 7]);
  });

  it('treats dangling palette refs as no color for display', () => {
    const a = makeAssembly({
      colors: {},
      components: [
        { id: 'C1', partPath: 'parts/cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'palette', name: 'GoneAway' } },
      ],
    });
    const rows = aggregateBom(a, new Map([['parts/cube.zipt', 'cube']]));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.color).toBeUndefined();
  });

  it('falls back to "(missing part)" when partName is unknown', () => {
    const a = makeAssembly({
      components: [
        { id: 'C1', partPath: 'parts/missing.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    const rows = aggregateBom(a, new Map());
    expect(rows[0]!.partName).toBe('(missing part)');
  });
});
