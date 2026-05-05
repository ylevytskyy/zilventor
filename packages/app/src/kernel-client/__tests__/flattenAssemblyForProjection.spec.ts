import { describe, it, expect } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';
import { flattenAssemblyForProjection } from '../flattenAssemblyForProjection';

const IDENTITY_Q = [0, 0, 0, 1] as [number, number, number, number];

function makeAsm(over: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return {
    id: 'asm',
    name: 'asm',
    units: 'mm',
    parameters: {},
    components: [],
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {},
    cutListItemNumbers: {},
    colorOverrides: {},
    properties: {},
    materials: [],
    hardware: [],
    ...over,
  };
}

function comp(
  id: string,
  partPath: string,
  opts: { visible?: boolean; suppressed?: boolean; position?: { x: number; y: number; z: number } } = {},
): AssemblyDocument['components'][number] {
  return {
    id,
    partPath,
    position: opts.position ?? { x: 0, y: 0, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: opts.visible ?? true,
    ...(opts.suppressed !== undefined ? { suppressed: opts.suppressed } : {}),
  };
}

describe('flattenAssemblyForProjection', () => {
  it('returns one entry per visible leaf component', () => {
    const asm = makeAsm({
      components: [
        comp('c1', 'a.zipt'),
        comp('c2', 'b.zipt'),
      ],
    });
    const pathToId = new Map([['a.zipt', 'id-a'], ['b.zipt', 'id-b']]);
    const result = flattenAssemblyForProjection(asm, () => undefined, pathToId);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.partId).sort()).toEqual(['id-a', 'id-b']);
  });

  it('excludes suppressed components', () => {
    const asm = makeAsm({
      components: [
        comp('c1', 'a.zipt'),
        comp('c2', 'b.zipt', { suppressed: true }),
      ],
    });
    const pathToId = new Map([['a.zipt', 'id-a'], ['b.zipt', 'id-b']]);
    const result = flattenAssemblyForProjection(asm, () => undefined, pathToId);
    expect(result).toHaveLength(1);
    expect(result[0]!.partId).toBe('id-a');
  });

  it('excludes components with visible: false', () => {
    const asm = makeAsm({
      components: [
        comp('c1', 'a.zipt'),
        comp('c2', 'b.zipt', { visible: false }),
      ],
    });
    const pathToId = new Map([['a.zipt', 'id-a'], ['b.zipt', 'id-b']]);
    const result = flattenAssemblyForProjection(asm, () => undefined, pathToId);
    expect(result).toHaveLength(1);
    expect(result[0]!.partId).toBe('id-a');
  });

  it('recursively flattens a nested sub-assembly and composes poses', () => {
    const sub = makeAsm({
      id: 'sub',
      components: [
        comp('leaf1', 'p.zipt', { position: { x: 10, y: 0, z: 0 } }),
        comp('leaf2', 'q.zipt', { position: { x: 0, y: 20, z: 0 } }),
      ],
    });
    const asm = makeAsm({
      components: [
        // sub-assembly placed at (100, 0, 0)
        comp('sub-inst', 'sub.ziasm', { position: { x: 100, y: 0, z: 0 } }),
      ],
    });
    const pathToId = new Map([['p.zipt', 'id-p'], ['q.zipt', 'id-q']]);
    const result = flattenAssemblyForProjection(
      asm,
      (path) => (path === 'sub.ziasm' ? sub : undefined),
      pathToId,
    );
    expect(result).toHaveLength(2);

    const leaf1 = result.find((r) => r.partId === 'id-p')!;
    const leaf2 = result.find((r) => r.partId === 'id-q')!;
    expect(leaf1).toBeDefined();
    expect(leaf2).toBeDefined();

    // sub at x=100, leaf1 local x=10 → world x=110
    expect(leaf1.pose.translation.x).toBeCloseTo(110);
    // sub at x=100, leaf2 local y=20 → world y=20, x=100
    expect(leaf2.pose.translation.x).toBeCloseTo(100);
    expect(leaf2.pose.translation.y).toBeCloseTo(20);

    // Identity quaternion throughout
    expect(leaf1.pose.quaternion).toEqual(IDENTITY_Q);
    expect(leaf2.pose.quaternion).toEqual(IDENTITY_Q);
  });

  it('returns empty list for an empty assembly', () => {
    const asm = makeAsm();
    const result = flattenAssemblyForProjection(asm, () => undefined, new Map());
    expect(result).toHaveLength(0);
  });

  it('skips leaf components whose partPath is not in partPathToId', () => {
    const asm = makeAsm({
      components: [comp('c1', 'unknown.zipt')],
    });
    const result = flattenAssemblyForProjection(asm, () => undefined, new Map());
    expect(result).toHaveLength(0);
  });

  it('skips cyclic sub-assembly references', () => {
    const a = makeAsm({
      id: 'a',
      components: [comp('self-ref', 'a.ziasm')],
    });
    const asm = makeAsm({
      components: [comp('inst', 'a.ziasm')],
    });
    const result = flattenAssemblyForProjection(
      asm,
      (path) => (path === 'a.ziasm' ? a : undefined),
      new Map(),
    );
    expect(result).toHaveLength(0);
  });
});
