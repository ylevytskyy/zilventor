import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeLineEdge, makeArcEdge, edgeEndpoints, disposeEdge } from '../SketchOps';
import { makeCircleEdge, makeSplineEdge, makeRectangleEdges } from '../SketchOps';
import { combineEdgesIntoWires, SKETCH_TOLERANCE_MM } from '../SketchOps';

let occt: OcctInstance;
beforeAll(async () => {
  occt = await loadOcct();
}, 60_000);

describe('SketchOps.makeLineEdge', () => {
  it('creates an edge with endpoints exactly at the given points', () => {
    const edge = makeLineEdge(occt, { x: 0, y: 0 }, { x: 100, y: 50 });
    const { start, end } = edgeEndpoints(occt, edge);
    expect(start.x).toBeCloseTo(0, 5);
    expect(start.y).toBeCloseTo(0, 5);
    expect(end.x).toBeCloseTo(100, 5);
    expect(end.y).toBeCloseTo(50, 5);
    disposeEdge(edge);
  });
});

describe('SketchOps.makeArcEdge', () => {
  it('creates a quarter arc with endpoints at (50,0) and (0,50)', () => {
    const edge = makeArcEdge(occt, { cx: 0, cy: 0, r: 50, startAngle: 0, endAngle: Math.PI / 2 });
    const { start, end } = edgeEndpoints(occt, edge);
    expect(start.x).toBeCloseTo(50, 3);
    expect(start.y).toBeCloseTo(0, 3);
    expect(end.x).toBeCloseTo(0, 3);
    expect(end.y).toBeCloseTo(50, 3);
    disposeEdge(edge);
  });
});

describe('SketchOps.makeCircleEdge', () => {
  it('creates a closed circle edge; endpoints coincide', () => {
    const edge = makeCircleEdge(occt, { cx: 10, cy: 20, r: 5 });
    const { start, end } = edgeEndpoints(occt, edge);
    expect(start.x).toBeCloseTo(end.x, 3);
    expect(start.y).toBeCloseTo(end.y, 3);
    disposeEdge(edge);
  });
});

describe('SketchOps.makeSplineEdge', () => {
  it('creates a degree-3 bspline edge from 4 control points; start at first CP, end at last', () => {
    const edge = makeSplineEdge(occt, {
      controlPoints: [{ x: 0, y: 0 }, { x: 10, y: 30 }, { x: 20, y: 30 }, { x: 30, y: 0 }],
      degree: 3,
      closed: false
    });
    const { start, end } = edgeEndpoints(occt, edge);
    expect(start.x).toBeCloseTo(0, 2);
    expect(start.y).toBeCloseTo(0, 2);
    expect(end.x).toBeCloseTo(30, 2);
    expect(end.y).toBeCloseTo(0, 2);
    disposeEdge(edge);
  });

  it('rejects a spline with fewer than 2 control points', () => {
    expect(() => makeSplineEdge(occt, { controlPoints: [{ x: 0, y: 0 }], degree: 3, closed: false }))
      .toThrow(/control points/i);
  });
});

describe('SketchOps.makeRectangleEdges', () => {
  it('produces 4 edges that connect end-to-start in order and close back to start', () => {
    const edges = makeRectangleEdges(occt, { x: 0, y: 0, w: 100, h: 200 });
    expect(edges.length).toBe(4);
    const ends = edges.map((e) => edgeEndpoints(occt, e));
    // Each edge's end must match the next edge's start, wrapping around.
    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      expect(ends[i]!.end.x).toBeCloseTo(ends[next]!.start.x, 5);
      expect(ends[i]!.end.y).toBeCloseTo(ends[next]!.start.y, 5);
    }
    edges.forEach(disposeEdge);
  });
});

describe('SketchOps.combineEdgesIntoWires', () => {
  it('exports SKETCH_TOLERANCE_MM = 1e-3', () => {
    expect(SKETCH_TOLERANCE_MM).toBe(1e-3);
  });

  it('four lines forming a square → 1 closed wire, 0 open chains', () => {
    const e1 = makeLineEdge(occt, { x: 0, y: 0 }, { x: 100, y: 0 });
    const e2 = makeLineEdge(occt, { x: 100, y: 0 }, { x: 100, y: 100 });
    const e3 = makeLineEdge(occt, { x: 100, y: 100 }, { x: 0, y: 100 });
    const e4 = makeLineEdge(occt, { x: 0, y: 100 }, { x: 0, y: 0 });
    const result = combineEdgesIntoWires(occt, [e1, e2, e3, e4]);
    expect(result.closedWires.length).toBe(1);
    expect(result.openChains.length).toBe(0);
    result.closedWires.forEach((w) => (w.wire as { delete?: () => void }).delete?.());
    [e1, e2, e3, e4].forEach(disposeEdge);
  });

  it('three lines in L shape → 1 open chain, 0 closed', () => {
    const e1 = makeLineEdge(occt, { x: 0, y: 0 }, { x: 100, y: 0 });
    const e2 = makeLineEdge(occt, { x: 100, y: 0 }, { x: 100, y: 100 });
    const e3 = makeLineEdge(occt, { x: 100, y: 100 }, { x: 50, y: 100 });
    const result = combineEdgesIntoWires(occt, [e1, e2, e3]);
    expect(result.closedWires.length).toBe(0);
    expect(result.openChains.length).toBe(1);
    [e1, e2, e3].forEach(disposeEdge);
  });

  it('connects regardless of input order', () => {
    const e1 = makeLineEdge(occt, { x: 0, y: 0 }, { x: 100, y: 0 });
    const e2 = makeLineEdge(occt, { x: 100, y: 0 }, { x: 100, y: 100 });
    const e3 = makeLineEdge(occt, { x: 100, y: 100 }, { x: 0, y: 100 });
    const e4 = makeLineEdge(occt, { x: 0, y: 100 }, { x: 0, y: 0 });
    const result = combineEdgesIntoWires(occt, [e3, e1, e4, e2]);
    expect(result.closedWires.length).toBe(1);
    result.closedWires.forEach((w) => (w.wire as { delete?: () => void }).delete?.());
    [e1, e2, e3, e4].forEach(disposeEdge);
  });

  it('chains edges by matching either endpoint (reversing as needed)', () => {
    const e1 = makeLineEdge(occt, { x: 0, y: 0 }, { x: 100, y: 0 });
    const e2 = makeLineEdge(occt, { x: 100, y: 100 }, { x: 100, y: 0 });
    const result = combineEdgesIntoWires(occt, [e1, e2]);
    expect(result.openChains.length).toBe(1);
    [e1, e2].forEach(disposeEdge);
  });

  it('considers endpoints within ε tolerance as coincident', () => {
    const e1 = makeLineEdge(occt, { x: 0, y: 0 }, { x: 100, y: 0 });
    const e2 = makeLineEdge(occt, { x: 100.0001, y: 0 }, { x: 100.0001, y: 100 });
    const result = combineEdgesIntoWires(occt, [e1, e2]);
    expect(result.openChains.length).toBe(1);
    [e1, e2].forEach(disposeEdge);
  });

  it('empty input → no wires, no chains', () => {
    const result = combineEdgesIntoWires(occt, []);
    expect(result.closedWires.length).toBe(0);
    expect(result.openChains.length).toBe(0);
  });
});
