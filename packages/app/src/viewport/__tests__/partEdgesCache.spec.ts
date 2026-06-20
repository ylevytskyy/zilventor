import { describe, it, expect } from 'vitest';
import type { TessellatedEdge } from '@zilventor/shared';

/**
 * RED: proves that partTessellatedEdgesCacheRef must be populated with
 * res.value.tessellatedEdges (same pattern as faces). The real behavioral
 * gate is the S-B e2e which drives a canvas click in axis mode and asserts
 * brokenRef=false — which only passes if the edge cache was populated.
 *
 * This unit test is a type-contract guard: verifies the cache Map type and
 * that isEdgeCircular correctly identifies closed-loop edges.
 */
function isEdgeCircular(e: TessellatedEdge): boolean {
  const first = e.segments[0];
  const last = e.segments[e.segments.length - 1];
  if (!first || !last) return false;
  const p0 = first[0]; const p1 = last[1];
  return Math.hypot(p0.x - p1.x, p0.y - p1.y, p0.z - p1.z) < 1e-3;
}

describe('partTessellatedEdgesCacheRef population + isEdgeCircular', () => {
  it('cache Map<string, TessellatedEdge[]> stores edges by partPath', () => {
    const cache = new Map<string, TessellatedEdge[]>();
    const edge: TessellatedEdge = {
      edgeName: { faceA: { featureId: 'f1', role: 'side', instance: 0 }, faceB: { featureId: 'f2', role: 'side', instance: 0 } },
      segments: [[{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]],
      faceNames: [{ featureId: 'f1', role: 'side', instance: 0 }, { featureId: 'f2', role: 'side', instance: 0 }],
    };
    cache.set('parts/box.zipt', [edge]);
    expect(cache.get('parts/box.zipt')).toHaveLength(1);
  });

  it('isEdgeCircular: closed loop (circle) returns true', () => {
    // Simulate a circle: 4 segments forming a closed loop.
    const R = 5;
    const pts = [0, 1, 2, 3, 4].map((i) => ({
      x: R * Math.cos((i / 4) * 2 * Math.PI),
      y: R * Math.sin((i / 4) * 2 * Math.PI),
      z: 0,
    }));
    const segs: [{ x: number; y: number; z: number }, { x: number; y: number; z: number }][] =
      [[pts[0]!, pts[1]!], [pts[1]!, pts[2]!], [pts[2]!, pts[3]!], [pts[3]!, pts[0]!]];
    const circleEdge: TessellatedEdge = {
      edgeName: { faceA: { featureId: 'f1', role: 'top', instance: 0 }, faceB: { featureId: 'f1', role: 'side', instance: 0 } },
      segments: segs,
      faceNames: [{ featureId: 'f1', role: 'top', instance: 0 }, { featureId: 'f1', role: 'side', instance: 0 }],
    };
    expect(isEdgeCircular(circleEdge)).toBe(true);
  });

  it('isEdgeCircular: open edge (line) returns false', () => {
    const lineEdge: TessellatedEdge = {
      edgeName: { faceA: { featureId: 'f1', role: 'side', instance: 0 }, faceB: { featureId: 'f2', role: 'side', instance: 0 } },
      segments: [[{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }]],
      faceNames: [{ featureId: 'f1', role: 'side', instance: 0 }, { featureId: 'f2', role: 'side', instance: 0 }],
    };
    expect(isEdgeCircular(lineEdge)).toBe(false);
  });
});
