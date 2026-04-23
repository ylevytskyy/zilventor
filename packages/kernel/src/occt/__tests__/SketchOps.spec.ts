import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeLineEdge, makeArcEdge, edgeEndpoints, disposeEdge } from '../SketchOps';

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
