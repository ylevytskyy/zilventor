import { describe, it, expect } from 'vitest';
import { mergeAndPruneBom } from '../mergeBomItemNumbers';
import type { AssemblyDocument } from '@zilventor/shared';

function makeAssembly(overrides: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return {
    id: 'A', name: 'A', units: 'mm', parameters: {}, properties: {},
    components: [], constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, colorOverrides: {},
    ...overrides,
  };
}

describe('mergeAndPruneBom', () => {
  it('merges newly-resolved item numbers and prunes orphans', () => {
    const a = makeAssembly({
      components: [
        { id: 'C1', partPath: 'parts/cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'C2', partPath: 'parts/leg.zipt',  position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      bomItemNumbers: { 'parts/cube.zipt::none': 5, 'parts/orphan.zipt::none': 99 },
    });
    const partInfo = new Map([['parts/cube.zipt', { name: 'cube' }], ['parts/leg.zipt', { name: 'leg' }]]);
    const out = mergeAndPruneBom(a, partInfo, { get: () => undefined });
    expect(out.bomItemNumbers['parts/cube.zipt::none']).toBe(5);            // preserved
    expect(out.bomItemNumbers['parts/leg.zipt::none']).toBe(6);              // newly assigned (max + 1)
    expect(out.bomItemNumbers['parts/orphan.zipt::none']).toBeUndefined();   // pruned
    // The rest of the document is untouched.
    expect(out.id).toBe(a.id);
    expect(out.components).toBe(a.components);
  });

  it('returns an assembly with empty bomItemNumbers when there are no components', () => {
    const a = makeAssembly({ bomItemNumbers: { 'parts/orphan.zipt::none': 1 } });
    const out = mergeAndPruneBom(a, new Map(), { get: () => undefined });
    expect(out.bomItemNumbers).toEqual({});
  });
});
