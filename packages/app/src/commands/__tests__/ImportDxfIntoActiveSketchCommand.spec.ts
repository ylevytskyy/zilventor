// packages/app/src/commands/__tests__/ImportDxfIntoActiveSketchCommand.spec.ts
import { describe, it, expect } from 'vitest';
import { ImportDxfIntoActiveSketchCommand } from '../ImportDxfIntoActiveSketchCommand';

const DXF = ['  0','SECTION','  2','ENTITIES',
  '  0','LINE','  8','0',' 10','0',' 20','0',' 11','1',' 21','1',
  '  0','LINE','  8','0',' 10','1',' 20','1',' 11','2',' 21','2',
  '  0','ENDSEC','  0','EOF'].join('\n');

function fakeFile(text: string): File { return { name: 'x.dxf', text: async () => text } as unknown as File; }

function harness() {
  const kernelAdds: string[] = []; const kernelRemoves: string[] = [];
  const sketcherAdds: string[] = []; const sketcherRemoves: string[] = [];
  const setParts: unknown[] = [];
  const kernel = {
    addPrimitive: async (_p: string, _s: string, prim: { id: string }) => { kernelAdds.push(prim.id); },
    removePrimitive: async (_p: string, _s: string, id: string) => { kernelRemoves.push(id); },
    getPart: async (_p: string) => ({ id: 'part1' } as never),
  };
  const sketcherClient = {
    addPrimitive: async (prim: { id: string }) => { sketcherAdds.push(prim.id); },
    removePrimitive: async (id: string) => { sketcherRemoves.push(id); },
  };
  const activePart = { id: 'part1' } as never;
  const store = { getActivePart: () => activePart, setActivePart: (p: unknown) => { setParts.push(p); } };
  return { kernelAdds, kernelRemoves, sketcherAdds, sketcherRemoves, setParts, kernel, sketcherClient, store };
}

describe('ImportDxfIntoActiveSketchCommand', () => {
  it('adds every primitive to BOTH kernel and sketcher; revert removes from both', async () => {
    const h = harness();
    const cmd = new ImportDxfIntoActiveSketchCommand({
      kernel: h.kernel as never, sketcherClient: h.sketcherClient as never,
      store: h.store,
      sketchId: 'sk1', file: fakeFile(DXF),
    });
    const priorPart = h.store.getActivePart();
    await cmd.apply();
    expect(h.kernelAdds).toHaveLength(2);
    expect(h.sketcherAdds).toEqual(h.kernelAdds);
    expect(h.setParts).toHaveLength(1); // setActivePart called once after apply
    await cmd.revert();
    expect(h.kernelRemoves.sort()).toEqual([...h.kernelAdds].sort());
    expect(h.sketcherRemoves.sort()).toEqual([...h.sketcherAdds].sort());
    // revert must restore the store to the pre-import snapshot
    expect(h.setParts).toHaveLength(2);
    expect(h.setParts[1]).toBe(priorPart);
  });

  it('rolls back partial adds if a later add throws', async () => {
    const h = harness();
    let calls = 0;
    h.kernel.addPrimitive = async (_p, _s, prim: { id: string }) => {
      calls += 1; if (calls === 2) throw new Error('boom'); h.kernelAdds.push(prim.id);
    };
    const cmd = new ImportDxfIntoActiveSketchCommand({
      kernel: h.kernel as never, sketcherClient: h.sketcherClient as never,
      store: h.store,
      sketchId: 'sk1', file: fakeFile(DXF),
    });
    await expect(cmd.apply()).rejects.toThrow('boom');
    // the one primitive that was added must have been removed from both paths
    expect(h.kernelRemoves).toEqual(h.kernelAdds);
    expect(h.sketcherRemoves.length).toBeGreaterThanOrEqual(1);
  });
});
