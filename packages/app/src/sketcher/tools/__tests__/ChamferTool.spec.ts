import { describe, it, expect } from 'vitest';
import { ChamferTool } from '../ChamferTool';

/**
 * Regression test for the chamfer-line-emit / source-line-trim sequencing race.
 * Identical root cause to FilletTool: emitLine (emitPrimitive in App.tsx) was
 * fire-and-forget async; the delayed setActivePart overwrite clobbered updateLine patches.
 */
describe('ChamferTool — line-emit / line-trim sequencing regression', () => {
  it('source line trim patches survive an async line-emit that overwrites store state (regression)', async () => {
    const store = { lxX1: 0 };

    const emitLine = async (_line: any): Promise<void> => {
      const staleValue = store.lxX1;
      await Promise.resolve();
      store.lxX1 = staleValue; // simulate stale setActivePart overwrite
    };

    const updateLine = (_id: string, patch: any): void => {
      if (patch.x1 !== undefined) store.lxX1 = patch.x1;
    };

    const tool = new ChamferTool({
      setback: 3,
      emitLine,
      updateLine,
      emitConstraint: () => { /* not under test */ },
    });
    tool.setPrimitives([
      { id: 'lx', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'ly', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 },
    ]);

    await tool.onPointerClick({ x: 5, y: 0 });
    await tool.onPointerClick({ x: 0, y: 5 });

    // With fix: emitLine is awaited before updateLine → patch (x1 ≈ 3) survives.
    // Without fix: updateLine runs sync, then stale snapshot resets to 0.
    expect(store.lxX1).toBeCloseTo(3, 3);
  });
});

describe('ChamferTool', () => {
  it('after picking two lines sharing a corner, emits a line + trims + coincident constraints', async () => {
    const out: any = { lines: [], updates: [], constraints: [] };
    const tool = new ChamferTool({
      setback: 3,
      emitLine: (l) => out.lines.push(l),
      updateLine: (id, patch) => out.updates.push({ id, patch }),
      emitConstraint: (c) => out.constraints.push(c),
    });
    tool.setPrimitives([
      { id: 'lx', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'ly', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 },
    ]);
    // click body of lx near (5,0), then body of ly near (0,5)
    await tool.onPointerClick({ x: 5, y: 0 });
    await tool.onPointerClick({ x: 0, y: 5 });

    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].kind).toBe('line');
    expect(out.updates).toHaveLength(2);

    // Two coincident constraints
    const kinds = out.constraints.map((c: any) => c.kind).sort();
    expect(kinds).toEqual(['coincident', 'coincident']);
  });

  it('emitted coincident constraints tie connecting line endpoints to trimmed source-line corners', async () => {
    const out: any = { lines: [], updates: [], constraints: [] };
    const tool = new ChamferTool({
      setback: 3,
      emitLine: (l) => out.lines.push(l),
      updateLine: (id, patch) => out.updates.push({ id, patch }),
      emitConstraint: (c) => out.constraints.push(c),
    });
    tool.setPrimitives([
      { id: 'lx', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'ly', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 },
    ]);
    await tool.onPointerClick({ x: 5, y: 0 });
    await tool.onPointerClick({ x: 0, y: 5 });

    const lineId = out.lines[0].id;
    const constraints = out.constraints as any[];

    // One coincident per source line
    const cForLx = constraints.find((c) => c.a.primitiveId === lineId && c.b.primitiveId === 'lx'
      || c.a.primitiveId === 'lx' && c.b.primitiveId === lineId);
    const cForLy = constraints.find((c) => c.a.primitiveId === lineId && c.b.primitiveId === 'ly'
      || c.a.primitiveId === 'ly' && c.b.primitiveId === lineId);

    expect(cForLx).toBeDefined();
    expect(cForLy).toBeDefined();

    // For lx: corner was at start (x1,y1=0,0), so lx anchor = 'start'
    // The chamfer line's p1 connects to lx's corner endpoint → chamfer line 'start'
    const lxAnchorOnChamfer = cForLx.a.primitiveId === lineId ? cForLx.a.anchor : cForLx.b.anchor;
    const lxAnchorOnSource = cForLx.a.primitiveId === 'lx' ? cForLx.a.anchor : cForLx.b.anchor;
    expect(lxAnchorOnChamfer).toBe('start');
    expect(lxAnchorOnSource).toBe('start');

    // For ly: corner was at start (x1,y1=0,0), so ly anchor = 'start'
    // The chamfer line's p2 connects to ly's corner endpoint → chamfer line 'end'
    const lyAnchorOnChamfer = cForLy.a.primitiveId === lineId ? cForLy.a.anchor : cForLy.b.anchor;
    const lyAnchorOnSource = cForLy.a.primitiveId === 'ly' ? cForLy.a.anchor : cForLy.b.anchor;
    expect(lyAnchorOnChamfer).toBe('end');
    expect(lyAnchorOnSource).toBe('start');
  });

  it('updateLine patches carry the changed corner endpoint', async () => {
    const out: any = { lines: [], updates: [], constraints: [] };
    const tool = new ChamferTool({
      setback: 3,
      emitLine: (l) => out.lines.push(l),
      updateLine: (id, patch) => out.updates.push({ id, patch }),
      emitConstraint: (c) => out.constraints.push(c),
    });
    tool.setPrimitives([
      { id: 'lx', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'ly', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 },
    ]);
    await tool.onPointerClick({ x: 5, y: 0 });
    await tool.onPointerClick({ x: 0, y: 5 });

    const lxUpdate = out.updates.find((u: any) => u.id === 'lx');
    const lyUpdate = out.updates.find((u: any) => u.id === 'ly');
    expect(lxUpdate).toBeDefined();
    expect(lyUpdate).toBeDefined();
    // lx corner at (0,0) = x1,y1 → trimmed x1 = 3
    expect(lxUpdate.patch.x1).toBeCloseTo(3, 3);
    expect(lxUpdate.patch.y1).toBeUndefined();
    // ly corner at (0,0) = x1,y1 → trimmed y1 = 3
    expect(lyUpdate.patch.x1).toBeUndefined();
    expect(lyUpdate.patch.y1).toBeCloseTo(3, 3);
  });

  it('non-line picks are ignored', async () => {
    const out: any = { lines: [], updates: [], constraints: [] };
    const tool = new ChamferTool({
      setback: 3,
      emitLine: (l) => out.lines.push(l),
      updateLine: (_id, _patch) => out.updates.push({}),
      emitConstraint: (c) => out.constraints.push(c),
    });
    tool.setPrimitives([
      { id: 'c1', kind: 'circle', cx: 5, cy: 0, r: 3 },
      { id: 'lx', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
    ]);
    // click on circle body — should not count as first pick
    await tool.onPointerClick({ x: 5, y: 3 });
    expect(out.lines).toHaveLength(0);
  });

  it('two lines not sharing a corner reset without emitting', async () => {
    const out: any = { lines: [], updates: [], constraints: [] };
    const tool = new ChamferTool({
      setback: 3,
      emitLine: (l) => out.lines.push(l),
      updateLine: (_id, _patch) => out.updates.push({}),
      emitConstraint: (c) => out.constraints.push(c),
    });
    tool.setPrimitives([
      { id: 'la', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'lb', kind: 'line', x1: 5, y1: 5, x2: 15, y2: 5 },
    ]);
    await tool.onPointerClick({ x: 5, y: 0 });
    await tool.onPointerClick({ x: 10, y: 5 });
    expect(out.lines).toHaveLength(0);
  });

  it('escape resets state', async () => {
    const out: any = { lines: [], updates: [], constraints: [] };
    const tool = new ChamferTool({
      setback: 3,
      emitLine: (l) => out.lines.push(l),
      updateLine: (_id, _patch) => out.updates.push({}),
      emitConstraint: (c) => out.constraints.push(c),
    });
    tool.setPrimitives([
      { id: 'lx', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'ly', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 },
    ]);
    await tool.onPointerClick({ x: 5, y: 0 });
    tool.onEscapePressed();
    // After escape, second click should start fresh (one pick only), no commit
    await tool.onPointerClick({ x: 5, y: 0 });
    expect(out.lines).toHaveLength(0);
  });
});
