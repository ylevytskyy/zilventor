import { describe, it, expect } from 'vitest';
import { buildSketchPartDocument } from '../../import/buildSketchPartDocument';
import { ImportDxfIntoNewPartCommand } from '../ImportDxfIntoNewPartCommand';

const SQUARE_DXF = ['  0','SECTION','  2','ENTITIES',
  '  0','LINE','  8','0',' 10','0',' 20','0',' 11','10',' 21','0',
  '  0','CIRCLE','  8','0',' 10','5',' 20','5',' 40','2',
  '  0','ENDSEC','  0','EOF'].join('\n');

function fakeFile(text: string, name = 'part.dxf'): File {
  return { name, text: async () => text } as unknown as File;
}

describe('buildSketchPartDocument', () => {
  it('wraps primitives in a sketch feature on origin.XY with 7 origin features', () => {
    const doc = buildSketchPartDocument('foo', [{ id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }]);
    expect(doc.name).toBe('foo');
    expect(doc.units).toBe('mm');
    const sketch = doc.featureTree.find((f) => f.kind === 'sketch');
    expect(sketch).toBeDefined();
    if (sketch && sketch.kind === 'sketch') {
      expect(sketch.plane).toEqual({ source: 'workPlane', featureId: 'origin.XY' });
      expect(sketch.primitives).toHaveLength(1);
      expect(sketch.constraints).toEqual([]);
    }
    expect(doc.featureTree.filter((f) => f.kind === 'workAxis' || f.kind === 'workPlane' || f.kind === 'workPoint')).toHaveLength(7);
  });
});

describe('ImportDxfIntoNewPartCommand', () => {
  it('registers a new part with the imported primitives and sets it active', async () => {
    const registered: unknown[] = [];
    let active: unknown = null;
    const cmd = new ImportDxfIntoNewPartCommand({
      kernel: { registerPart: async (p: unknown) => { registered.push(p); } } as never,
      store: { getActivePart: () => active as never, setActivePart: (p: unknown) => { active = p; } },
      file: fakeFile(SQUARE_DXF),
    });
    await cmd.apply();
    expect(registered).toHaveLength(1);
    const doc = active as { featureTree: Array<{ kind: string; primitives?: unknown[] }> };
    const sketch = doc.featureTree.find((f) => f.kind === 'sketch')!;
    expect(sketch.primitives).toHaveLength(2); // line + circle
  });

  it('revert restores the prior active part', async () => {
    const prior = { id: 'prev' };
    let active: unknown = prior;
    const cmd = new ImportDxfIntoNewPartCommand({
      kernel: { registerPart: async () => {} } as never,
      store: { getActivePart: () => active as never, setActivePart: (p: unknown) => { active = p; } },
      file: fakeFile(SQUARE_DXF),
    });
    await cmd.apply();
    expect(active).not.toBe(prior);
    await cmd.revert();
    expect(active).toBe(prior);
  });
});
