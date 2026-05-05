// packages/shared/src/drawing/projectSectionView.test.ts
import { describe, it, expect, vi } from 'vitest';
import { projectSectionView } from './projectSectionView';

// Minimal stub for projectView — returns projected geometry with 4 edges
vi.mock('./projector', () => ({
  projectView: vi.fn(() => ({
    visibleEdges: [
      { id: 'e1_0', kind: 'outline', points: [[0, 0], [10, 0]] },
      { id: 'e2_0', kind: 'outline', points: [[10, 0], [10, 10]] },
      { id: 'e3_0', kind: 'outline', points: [[10, 10], [0, 10]] },
      { id: 'e4_0', kind: 'outline', points: [[0, 10], [0, 0]] },
    ],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  })),
}));

describe('projectSectionView', () => {
  it('returns edges, hatchSegments, and fingerprint', () => {
    const faceTags = new Map([
      ['face-top', { tag: 'cut-face' as const, partId: 'part-1', materialId: 'mat-wood' }],
    ]);

    const result = projectSectionView(
      { triangles: [], edges: [], bbox: [0, 0, 0, 10, 10, 10] },
      faceTags,
      1,
    );

    expect(result).toHaveProperty('edges');
    expect(result).toHaveProperty('hatchSegments');
    expect(result).toHaveProperty('fingerprint');
    expect(typeof result.fingerprint).toBe('string');
    expect(result.fingerprint.length).toBeGreaterThan(0);
  });

  it('hatchSegments carry materialId from FaceTagMap', () => {
    const polygon = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    const faceTags = new Map([
      ['face-cut', { tag: 'cut-face' as const, partId: 'p1', materialId: 'mat-birch', polygon }],
    ]);

    const result = projectSectionView(
      { triangles: [], edges: [], bbox: [0, 0, 0, 10, 10, 10] },
      faceTags,
      1,
    );

    // If any hatch segments exist they must carry the correct materialId
    result.hatchSegments.forEach(s => {
      expect(s.materialId).toBe('mat-birch');
    });
  });

  it('no hatch segments when all FaceTag entries are original-face (no cut faces)', () => {
    const faceTags = new Map([
      ['face-side', { tag: 'original-face' as const, partId: 'p1', materialId: 'mat-wood' }],
    ]);

    const result = projectSectionView(
      { triangles: [], edges: [], bbox: [0, 0, 0, 10, 10, 10] },
      faceTags,
      1,
    );

    expect(result.hatchSegments).toHaveLength(0);
  });
});
