import { describe, it, expect } from 'vitest';
import { FilletTool } from '../FilletTool';

/**
 * Regression test for the arc-add / line-trim sequencing race.
 *
 * Root cause: in App.tsx, `emitArc` was a fire-and-forget async operation.
 * `AddPrimitiveCommand.apply()` takes a kernel snapshot BEFORE the UpdatePrimitive
 * patches run, then later calls `setActivePart(kernelSnapshot)` — overwriting any
 * store coord patches that ran while the kernel RPC was in-flight.
 *
 * The fix: make `emitArc` return `Promise<void>` and `await` it inside
 * `FilletTool.onPointerClick` before calling `updateLine`.
 *
 * This test simulates the race by making `emitArc` record a "stale snapshot" at call
 * time and apply it to a shared `store` object AFTER a microtask, while `updateLine`
 * patches the same store object synchronously. Without the fix, the stale snapshot
 * overwrites the patches; with the fix, the patches run after the snapshot settles.
 */
describe('FilletTool — arc-add / line-trim sequencing regression', () => {
  it('line trim patches survive an async arc-add that overwrites store state (regression)', async () => {
    // Shared fake store: tracks the x1 of 'lx' (the trimmed corner endpoint).
    // Initially the original value (0). The UpdatePrimitive patch sets it to ~2.
    // The stale kernel snapshot (taken before UpdatePrimitive) would reset it to 0.
    const store = { lxX1: 0 };

    // `emitArc` simulates AddPrimitiveCommand: captures the store value NOW (stale: 0),
    // then after a microtask resolves sets it back to the stale value — simulating the
    // `setActivePart(kernelSnapshot)` overwrite.
    const emitArc = async (_arc: any): Promise<void> => {
      const staleValue = store.lxX1; // snapshot taken while UpdatePrimitive hasn't run yet
      // Simulate kernel RPC latency: resolve after one microtask.
      await Promise.resolve();
      store.lxX1 = staleValue; // "setActivePart" overwrites with stale snapshot
    };

    // `updateLine` simulates UpdatePrimitiveCommand: writes the trimmed coord synchronously.
    const updateLine = (_id: string, patch: any): void => {
      if (patch.x1 !== undefined) store.lxX1 = patch.x1;
    };

    const emitConstraint = (_c: any): void => { /* not under test */ };

    const tool = new FilletTool({
      radius: 2,
      emitArc,
      updateLine,
      emitConstraint,
    });
    tool.setPrimitives([
      { id: 'lx', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'ly', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 },
    ]);

    await tool.onPointerClick({ x: 5, y: 0 });
    // onPointerClick must be awaited so the internal sequencing completes.
    await tool.onPointerClick({ x: 0, y: 5 });

    // With the fix: emitArc is awaited FIRST, so the stale snapshot lands BEFORE
    // updateLine runs → updateLine's patch (x1 ≈ 2) is the final value.
    // Without the fix: updateLine runs synchronously BEFORE the microtask tick;
    // then stale snapshot overwrites → store.lxX1 = 0 again.
    expect(store.lxX1).toBeCloseTo(2, 3);
  });
});

describe('FilletTool', () => {
  it('after picking two lines sharing a corner, emits an arc + trims + constraints', async () => {
    const out: any = { primitives: [], updates: [], constraints: [] };
    const tool = new FilletTool({
      radius: 2,
      emitArc: (a) => { out.primitives.push(a); },
      updateLine: (id, patch) => out.updates.push({ id, patch }),
      emitConstraint: (c) => out.constraints.push(c),
    });
    tool.setPrimitives([
      { id: 'lx', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'ly', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 },
    ]);
    await tool.onPointerClick({ x: 5, y: 0 });
    await tool.onPointerClick({ x: 0, y: 5 });
    expect(out.primitives).toHaveLength(1);
    expect(out.primitives[0].kind).toBe('arc');
    expect(out.updates).toHaveLength(2);
    const kinds = out.constraints.map((c: any) => c.kind).sort();
    expect(kinds).toEqual(['coincident', 'coincident', 'dim-radius', 'tangent', 'tangent']);
  });

  it('non-line picks are ignored', async () => {
    const out: any = { primitives: [], updates: [], constraints: [] };
    const tool = new FilletTool({
      radius: 2,
      emitArc: (a) => { out.primitives.push(a); },
      updateLine: (_id, _patch) => out.updates.push({}),
      emitConstraint: (c) => out.constraints.push(c),
    });
    tool.setPrimitives([
      { id: 'c1', kind: 'circle', cx: 5, cy: 0, r: 3 },
      { id: 'lx', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
    ]);
    // click on circle body — should not count as first pick
    await tool.onPointerClick({ x: 5, y: 3 });
    expect(out.primitives).toHaveLength(0);
  });

  it('two lines not sharing a corner reset without emitting', async () => {
    const out: any = { primitives: [], updates: [], constraints: [] };
    const tool = new FilletTool({
      radius: 2,
      emitArc: (a) => { out.primitives.push(a); },
      updateLine: (_id, _patch) => out.updates.push({}),
      emitConstraint: (c) => out.constraints.push(c),
    });
    tool.setPrimitives([
      { id: 'la', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'lb', kind: 'line', x1: 5, y1: 5, x2: 15, y2: 5 },
    ]);
    await tool.onPointerClick({ x: 5, y: 0 });
    await tool.onPointerClick({ x: 10, y: 5 });
    expect(out.primitives).toHaveLength(0);
  });

  it('escape resets state', async () => {
    const out: any = { primitives: [], updates: [], constraints: [] };
    const tool = new FilletTool({
      radius: 2,
      emitArc: (a) => { out.primitives.push(a); },
      updateLine: (_id, _patch) => out.updates.push({}),
      emitConstraint: (c) => out.constraints.push(c),
    });
    tool.setPrimitives([
      { id: 'lx', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'ly', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 },
    ]);
    await tool.onPointerClick({ x: 5, y: 0 });
    tool.onEscapePressed();
    // after escape, second click should start fresh (one pick), no commit yet
    await tool.onPointerClick({ x: 5, y: 0 });
    expect(out.primitives).toHaveLength(0);
  });

  it('emitted tangent constraints reference correct line and arc ids', async () => {
    const out: any = { primitives: [], updates: [], constraints: [] };
    const tool = new FilletTool({
      radius: 2,
      emitArc: (a) => { out.primitives.push(a); },
      updateLine: (id, patch) => out.updates.push({ id, patch }),
      emitConstraint: (c) => out.constraints.push(c),
    });
    tool.setPrimitives([
      { id: 'lx', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'ly', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 },
    ]);
    await tool.onPointerClick({ x: 5, y: 0 });
    await tool.onPointerClick({ x: 0, y: 5 });

    const arcId = out.primitives[0].id;
    const tangents = out.constraints.filter((c: any) => c.kind === 'tangent');
    expect(tangents).toHaveLength(2);
    const lineIds = tangents.map((c: any) => c.line).sort();
    expect(lineIds).toEqual(['lx', 'ly'].sort());
    tangents.forEach((c: any) => expect(c.arc).toBe(arcId));

    const dimRadius = out.constraints.find((c: any) => c.kind === 'dim-radius');
    expect(dimRadius).toBeDefined();
    expect(dimRadius.circle).toBe(arcId);
    expect(dimRadius.value).toEqual({ kind: 'literal', value: 2 });
    expect(typeof dimRadius.paramName).toBe('string');
    expect(dimRadius.paramName.length).toBeGreaterThan(0);
  });

  it('updateLine patches carry changed endpoint fields from trimmedL1 / trimmedL2', async () => {
    const out: any = { primitives: [], updates: [], constraints: [] };
    const tool = new FilletTool({
      radius: 2,
      emitArc: (a) => { out.primitives.push(a); },
      updateLine: (id, patch) => out.updates.push({ id, patch }),
      emitConstraint: (c) => out.constraints.push(c),
    });
    tool.setPrimitives([
      { id: 'lx', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'ly', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 },
    ]);
    await tool.onPointerClick({ x: 5, y: 0 });
    await tool.onPointerClick({ x: 0, y: 5 });

    // Both updates must have a patch that changes the corner endpoint closer to the arc
    const lxUpdate = out.updates.find((u: any) => u.id === 'lx');
    const lyUpdate = out.updates.find((u: any) => u.id === 'ly');
    expect(lxUpdate).toBeDefined();
    expect(lyUpdate).toBeDefined();
    // lx corner is at (0,0) which is x1,y1 → trimmed x1 should be ~2 (tangent dist for 90° corner, r=2)
    // y1 is unchanged (still 0) so diffLine omits it from patch
    expect(lxUpdate.patch.x1).toBeCloseTo(2, 3);
    expect(lxUpdate.patch.y1).toBeUndefined();
    // ly corner is at (0,0) which is x1,y1 → trimmed y1 should be ~2
    // x1 is unchanged (still 0) so diffLine omits it from patch
    expect(lyUpdate.patch.x1).toBeUndefined();
    expect(lyUpdate.patch.y1).toBeCloseTo(2, 3);
  });

  it('emits two coincident constraints pinning arc endpoints to trimmed line endpoints', async () => {
    // Use any[] consistent with the existing FilletTool.spec.ts style.
    const out: { primitives: any[]; constraints: any[] } = {
      primitives: [],
      constraints: [],
    };
    const tool = new FilletTool({
      radius: 2,
      emitArc: (a) => { out.primitives.push(a); },
      updateLine: (_id, _patch) => { /* ignore for this test */ },
      emitConstraint: (c) => out.constraints.push(c),
    });
    tool.setPrimitives([
      { id: 'lx', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'ly', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 },
    ]);
    await tool.onPointerClick({ x: 5, y: 0 });
    await tool.onPointerClick({ x: 0, y: 5 });

    // Previously: 2 tangent + 1 dim-radius = 3 constraints.
    // After fix:  2 tangent + 1 dim-radius + 2 coincident = 5 constraints.
    expect(out.constraints).toHaveLength(5);
    const coincidents = out.constraints.filter((c: any) => c.kind === 'coincident');
    expect(coincidents).toHaveLength(2);

    const arcId = out.primitives[0]!.id;
    // Each coincident must reference the arc (one endpoint 'start', one 'end')
    // and a trimmed line endpoint.
    const arcRefs = coincidents.flatMap((c: any) => {
      const pts = [c.a, c.b];
      return pts.filter((p: any) => p.primitiveId === arcId);
    });
    expect(arcRefs.map((r: any) => r.anchor).sort()).toEqual(['end', 'start']);
  });
});
