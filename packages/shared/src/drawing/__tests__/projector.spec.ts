// packages/shared/src/drawing/__tests__/projector.spec.ts
import { describe, it, expect } from 'vitest';
import { projectView } from '../projector';
import type { ProjectorInput } from '../projector';

// Helper: build a solid axis-aligned box from (0,0,0) to (w,h,d).
// Returns 12 triangles (2 per face) + 12 edges (4 per axis pair of faces).
function makeBox(w: number, h: number, d: number): ProjectorInput {
  // Vertices — use a const tuple so indexing is safe
  const vs = [
    [0,0,0],[w,0,0],[w,h,0],[0,h,0],
    [0,0,d],[w,0,d],[w,h,d],[0,h,d],
  ] as const satisfies readonly [number,number,number][];
  // 12 triangles (2 per face)
  const triangles: [[number,number,number],[number,number,number],[number,number,number]][] = [
    // front (z=0)
    [[...vs[0]],[...vs[1]],[...vs[2]]], [[...vs[0]],[...vs[2]],[...vs[3]]],
    // back (z=d)
    [[...vs[4]],[...vs[6]],[...vs[5]]], [[...vs[4]],[...vs[7]],[...vs[6]]],
    // left (x=0)
    [[...vs[0]],[...vs[3]],[...vs[7]]], [[...vs[0]],[...vs[7]],[...vs[4]]],
    // right (x=w)
    [[...vs[1]],[...vs[5]],[...vs[6]]], [[...vs[1]],[...vs[6]],[...vs[2]]],
    // bottom (y=0)
    [[...vs[0]],[...vs[4]],[...vs[5]]], [[...vs[0]],[...vs[5]],[...vs[1]]],
    // top (y=h)
    [[...vs[3]],[...vs[2]],[...vs[6]]], [[...vs[3]],[...vs[6]],[...vs[7]]],
  ];
  // 12 box edges
  const edges = [
    // bottom rect
    { id: 'e0',  points: [[...vs[0]],[...vs[1]]] as [number,number,number][], adjacentFaces: [] },
    { id: 'e1',  points: [[...vs[1]],[...vs[2]]] as [number,number,number][], adjacentFaces: [] },
    { id: 'e2',  points: [[...vs[2]],[...vs[3]]] as [number,number,number][], adjacentFaces: [] },
    { id: 'e3',  points: [[...vs[3]],[...vs[0]]] as [number,number,number][], adjacentFaces: [] },
    // top rect
    { id: 'e4',  points: [[...vs[4]],[...vs[5]]] as [number,number,number][], adjacentFaces: [] },
    { id: 'e5',  points: [[...vs[5]],[...vs[6]]] as [number,number,number][], adjacentFaces: [] },
    { id: 'e6',  points: [[...vs[6]],[...vs[7]]] as [number,number,number][], adjacentFaces: [] },
    { id: 'e7',  points: [[...vs[7]],[...vs[4]]] as [number,number,number][], adjacentFaces: [] },
    // verticals
    { id: 'e8',  points: [[...vs[0]],[...vs[4]]] as [number,number,number][], adjacentFaces: [] },
    { id: 'e9',  points: [[...vs[1]],[...vs[5]]] as [number,number,number][], adjacentFaces: [] },
    { id: 'e10', points: [[...vs[2]],[...vs[6]]] as [number,number,number][], adjacentFaces: [] },
    { id: 'e11', points: [[...vs[3]],[...vs[7]]] as [number,number,number][], adjacentFaces: [] },
  ];
  return {
    triangles,
    edges,
    bbox: [0, 0, 0, w, h, d],
  };
}

describe('projectView — box 100×60×40', () => {
  const box = makeBox(100, 60, 40);

  it('front view: 4 outer visible edges, 0 hidden', () => {
    const result = projectView(box, 'front');
    // Front view of a solid box: 4 outer silhouette edges visible; back edges fully hidden
    expect(result.visibleEdges.length).toBeGreaterThanOrEqual(4);
    // All front-face edges (e0..e3) should be visible
    const visIds = new Set(result.visibleEdges.map(e => e.id.split('_')[0]));
    expect(visIds.has('e0')).toBe(true);
    expect(visIds.has('e1')).toBe(true);
    expect(visIds.has('e2')).toBe(true);
    expect(visIds.has('e3')).toBe(true);
  });

  it('front view bbox is positive', () => {
    const result = projectView(box, 'front');
    expect(result.bbox.maxX).toBeGreaterThan(result.bbox.minX);
    expect(result.bbox.maxY).toBeGreaterThan(result.bbox.minY);
  });

  it('top view: produces visible edges', () => {
    const result = projectView(box, 'top');
    expect(result.visibleEdges.length).toBeGreaterThan(0);
  });

  it('iso-NE view: produces visible edges; back edges hidden', () => {
    const result = projectView(box, 'iso-NE');
    expect(result.visibleEdges.length).toBeGreaterThanOrEqual(9);
    expect(result.hiddenEdges.length).toBeGreaterThanOrEqual(1);
  });
});

describe('projectView — cylinder Ø50 h100 (front view)', () => {
  // Approximate a cylinder with 32-segment prism
  function makeCylinder(r: number, h: number, segs = 32): ProjectorInput {
    const triangles: [[number,number,number],[number,number,number],[number,number,number]][] = [];
    const edges: { id: string; points: [number,number,number][]; adjacentFaces: string[] }[] = [];
    for (let i = 0; i < segs; i++) {
      const a0 = (2 * Math.PI * i) / segs;
      const a1 = (2 * Math.PI * (i + 1)) / segs;
      const x0 = r * Math.cos(a0), y0 = r * Math.sin(a0);
      const x1 = r * Math.cos(a1), y1 = r * Math.sin(a1);
      // Side quad
      triangles.push([[x0,y0,0],[x1,y1,0],[x1,y1,h]]);
      triangles.push([[x0,y0,0],[x1,y1,h],[x0,y0,h]]);
      // Top cap
      triangles.push([[0,0,h],[x0,y0,h],[x1,y1,h]]);
      // Bottom cap
      triangles.push([[0,0,0],[x1,y1,0],[x0,y0,0]]);
    }
    // Top and bottom circle edges
    const topPts: [number,number,number][] = [];
    const botPts: [number,number,number][] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (2 * Math.PI * i) / segs;
      topPts.push([r * Math.cos(a), r * Math.sin(a), h]);
      botPts.push([r * Math.cos(a), r * Math.sin(a), 0]);
    }
    edges.push({ id: 'top-circle', points: topPts, adjacentFaces: [] });
    edges.push({ id: 'bot-circle', points: botPts, adjacentFaces: [] });
    // Silhouette lines (at x=±r)
    edges.push({ id: 'sil-left',  points: [[-r,0,0],[-r,0,h]], adjacentFaces: [] });
    edges.push({ id: 'sil-right', points: [[r,0,0],[r,0,h]], adjacentFaces: [] });
    return {
      triangles,
      edges,
      bbox: [-r, -r, 0, r, r, h],
    };
  }

  const cyl = makeCylinder(25, 100, 32);

  it('front view: silhouette lines visible', () => {
    const result = projectView(cyl, 'front');
    const visIds = new Set(result.visibleEdges.map(e => e.id.split('_')[0]));
    expect(visIds.has('sil-left') || visIds.has('sil-right')).toBe(true);
  });

  it('front view: top and bottom circles have ≥16 2D points each', () => {
    const result = projectView(cyl, 'front');
    const allEdges = [...result.visibleEdges, ...result.hiddenEdges];
    const topEdges = allEdges.filter(e => e.id.startsWith('top-circle'));
    const botEdges = allEdges.filter(e => e.id.startsWith('bot-circle'));
    const topPts = topEdges.reduce((s, e) => s + e.points.length, 0);
    const botPts = botEdges.reduce((s, e) => s + e.points.length, 0);
    expect(topPts).toBeGreaterThanOrEqual(16);
    expect(botPts).toBeGreaterThanOrEqual(16);
  });
});
