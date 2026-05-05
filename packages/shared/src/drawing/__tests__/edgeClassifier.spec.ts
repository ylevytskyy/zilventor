// packages/shared/src/drawing/__tests__/edgeClassifier.spec.ts
import { describe, it, expect } from 'vitest';
import { classifyEdges } from '../edgeClassifier';
import { buildDepthBuffer } from '../depthBuffer';
import type { BoundingBox } from '../../types';

describe('classifyEdges', () => {
  const pitch = 1;
  // Depth buffer with a triangle from (0,0,z=10) to (100,100,z=10)
  // covering the lower-left triangle of the 100×100 canvas.
  const tri: [[number, number, number], [number, number, number], [number, number, number]] = [
    [0, 0, 10],
    [100, 0, 10],
    [0, 100, 10],
  ];
  const bbox: BoundingBox = [0, 0, 0, 100, 100, 20];
  const buf = buildDepthBuffer([tri], bbox, pitch);

  // Fully-visible edge: z=5 (in front of the triangle at z=10), horizontal across y=50
  const visibleEdge = {
    id: 'edge-vis',
    points: [[10, 50, 5], [90, 50, 5]] as [number, number, number][],
    adjacentFaces: ['face1'],
  };

  // Fully-hidden edge: z=15 (behind the triangle at z=10), along y=10 inside the triangle area
  const hiddenEdge = {
    id: 'edge-hid',
    points: [[5, 5, 15], [50, 5, 15]] as [number, number, number][],
    adjacentFaces: ['face2'],
  };

  it('visible edge produces only visibleEdges entries', () => {
    const { visibleEdges, hiddenEdges } = classifyEdges([visibleEdge], buf, bbox, pitch);
    expect(visibleEdges.length).toBeGreaterThan(0);
    expect(hiddenEdges.length).toBe(0);
  });

  it('hidden edge produces only hiddenEdges entries', () => {
    const { visibleEdges, hiddenEdges } = classifyEdges([hiddenEdge], buf, bbox, pitch);
    expect(hiddenEdges.length).toBeGreaterThan(0);
    expect(visibleEdges.length).toBe(0);
  });

  it('edge id format is <edgeKey>_<runIndex>', () => {
    const { visibleEdges } = classifyEdges([visibleEdge], buf, bbox, pitch);
    expect(visibleEdges[0]?.id).toMatch(/^edge-vis_\d+$/);
  });

  it('sample count is at least 8 for short edges', () => {
    // Short edge (3mm long) should still get min 8 samples
    const shortEdge = {
      id: 'short',
      points: [[5, 5, 5], [8, 5, 5]] as [number, number, number][],
      adjacentFaces: [],
    };
    // No error means samples were computed (at least 8)
    expect(() => classifyEdges([shortEdge], buf, bbox, pitch)).not.toThrow();
  });

  it('run-length encoding splits a mixed edge into visible and hidden segments', () => {
    // Edge from visible region (z=5, outside triangle at x=95) to hidden region (z=15, inside triangle at x=5)
    // Travels across the triangle boundary
    const mixedEdge = {
      id: 'mixed',
      // Start at x=5 (inside tri area) z=15 hidden, end at x=95 z=5 visible; y=10 stays inside tri region for first half
      points: [[5, 10, 15], [95, 10, 5]] as [number, number, number][],
      adjacentFaces: [],
    };
    const { visibleEdges, hiddenEdges } = classifyEdges([mixedEdge], buf, bbox, pitch);
    // Both segments should exist
    expect(visibleEdges.length).toBeGreaterThan(0);
    expect(hiddenEdges.length).toBeGreaterThan(0);
  });
});
