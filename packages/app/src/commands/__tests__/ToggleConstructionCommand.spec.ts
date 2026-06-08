import { describe, it, expect, beforeEach } from 'vitest';
import { ToggleConstructionCommand } from '../ToggleConstructionCommand';
import { useAppStore } from '../../store/useAppStore';
import type { PartDocument, SketchPrimitive } from '@zilventor/shared';

const LINE_A: SketchPrimitive = { id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 };
const LINE_B: SketchPrimitive = { id: 'p2', kind: 'line', x1: 10, y1: 0, x2: 20, y2: 0 };
const CIRCLE: SketchPrimitive = { id: 'p3', kind: 'circle', cx: 5, cy: 5, r: 3, construction: true };

function makePart(): PartDocument {
  return {
    id: 'part-1',
    name: 'Part',
    units: 'mm',
    parameters: {},
    featureTree: [
      {
        kind: 'sketch',
        id: 'sk1',
        plane: { source: 'workPlane', featureId: 'origin.XY' },
        primitives: [LINE_A, LINE_B, CIRCLE],
        constraints: [],
      },
    ],
    customTextures: [],
    materials: [],
  } as unknown as PartDocument;
}

beforeEach(() => {
  useAppStore.setState({
    activePart: makePart(),
    activeDocument: { kind: 'part', document: makePart() },
  });
});

describe('ToggleConstructionCommand', () => {
  it('apply stamps construction:true onto non-construction primitives', async () => {
    const cmd = new ToggleConstructionCommand({ primitiveIds: ['p1', 'p2'], sketchId: 'sk1' });
    await cmd.apply();

    const part = useAppStore.getState().activePart!;
    const sketch = part.featureTree.find(f => f.id === 'sk1')!;
    if (sketch.kind !== 'sketch') throw new Error('expected sketch');
    expect(sketch.primitives.find(p => p.id === 'p1')!.construction).toBe(true);
    expect(sketch.primitives.find(p => p.id === 'p2')!.construction).toBe(true);
  });

  it('apply clears construction flag on already-construction primitives', async () => {
    const cmd = new ToggleConstructionCommand({ primitiveIds: ['p3'], sketchId: 'sk1' });
    await cmd.apply();

    const part = useAppStore.getState().activePart!;
    const sketch = part.featureTree.find(f => f.id === 'sk1')!;
    if (sketch.kind !== 'sketch') throw new Error('expected sketch');
    expect(sketch.primitives.find(p => p.id === 'p3')!.construction).toBe(false);
  });

  it('revert restores prior construction values', async () => {
    const cmd = new ToggleConstructionCommand({ primitiveIds: ['p1', 'p3'], sketchId: 'sk1' });
    await cmd.apply();
    await cmd.revert();

    const part = useAppStore.getState().activePart!;
    const sketch = part.featureTree.find(f => f.id === 'sk1')!;
    if (sketch.kind !== 'sketch') throw new Error('expected sketch');
    // p1 had construction:undefined (falsy) before → restored
    expect(sketch.primitives.find(p => p.id === 'p1')!.construction).toBeFalsy();
    // p3 had construction:true before → restored
    expect(sketch.primitives.find(p => p.id === 'p3')!.construction).toBe(true);
  });

  it('apply is a no-op when sketchId not found', async () => {
    const cmd = new ToggleConstructionCommand({ primitiveIds: ['p1'], sketchId: 'missing' });
    await expect(cmd.apply()).resolves.toBeUndefined();
    // Part unchanged
    const part = useAppStore.getState().activePart!;
    const sketch = part.featureTree.find(f => f.id === 'sk1')!;
    if (sketch.kind !== 'sketch') throw new Error('expected sketch');
    expect(sketch.primitives.find(p => p.id === 'p1')!.construction).toBeFalsy();
  });

  it('apply is a no-op when no active part', async () => {
    useAppStore.setState({ activePart: null, activeDocument: null });
    const cmd = new ToggleConstructionCommand({ primitiveIds: ['p1'], sketchId: 'sk1' });
    await expect(cmd.apply()).resolves.toBeUndefined();
  });
});
