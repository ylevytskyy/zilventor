import { describe, it, expect } from 'vitest';
import { projectSectionView, type FaceTag } from '../projectSectionView';
import type { ProjectorInput } from '../projector';

// Minimal stub that satisfies projectView's bbox requirement; hatch path only needs faceTags.
const stubInput: ProjectorInput = {
  triangles: [] as unknown as ProjectorInput['triangles'],
  edges: [] as unknown as ProjectorInput['edges'],
  bbox: [0, 0, 0, 10, 10, 10],
} as unknown as ProjectorInput;

const faceTags = new Map<string, FaceTag>([
  ['f1', {
    tag: 'cut-face',
    partId: 'P1',
    materialId: '',
    polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  }],
]);

describe('projectSectionView color attachment', () => {
  it('stamps colorForFace(partId) onto every hatch segment of a cut face', () => {
    const { hatchSegments } = projectSectionView(
      stubInput,
      faceTags,
      1,
      (_materialId: string) => ({ angleDeg: 45, spacingMm: 3 }),
      undefined,
      undefined,
      (partId: string) => (partId === 'P1' ? '#ab12cd' : '#808080'),
    );
    expect(hatchSegments.length).toBeGreaterThan(0);
    expect(hatchSegments.every((s) => s.color === '#ab12cd')).toBe(true);
  });

  it('omits color when no colorForFace is provided (legacy callers unaffected)', () => {
    const { hatchSegments } = projectSectionView(
      stubInput,
      faceTags,
      1,
      () => ({ angleDeg: 45, spacingMm: 3 }),
    );
    expect(hatchSegments.length).toBeGreaterThan(0);
    expect(hatchSegments.every((s) => s.color === undefined)).toBe(true);
  });
});
