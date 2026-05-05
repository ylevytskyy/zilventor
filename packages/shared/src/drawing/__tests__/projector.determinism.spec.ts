// packages/shared/src/drawing/__tests__/projector.determinism.spec.ts
import { describe, it, expect } from 'vitest';
import { projectView, type ProjectorInput } from '../projector';

// Minimal 100×60×40 box input (same as projector.spec)
const vs = [
  [0,0,0],[100,0,0],[100,60,0],[0,60,0],
  [0,0,40],[100,0,40],[100,60,40],[0,60,40],
] as const satisfies readonly [number,number,number][];

const BOX_INPUT: ProjectorInput = {
  triangles: [
    [[...vs[0]],[...vs[1]],[...vs[2]]], [[...vs[0]],[...vs[2]],[...vs[3]]],
    [[...vs[4]],[...vs[6]],[...vs[5]]], [[...vs[4]],[...vs[7]],[...vs[6]]],
    [[...vs[0]],[...vs[3]],[...vs[7]]], [[...vs[0]],[...vs[7]],[...vs[4]]],
    [[...vs[1]],[...vs[5]],[...vs[6]]], [[...vs[1]],[...vs[6]],[...vs[2]]],
    [[...vs[0]],[...vs[4]],[...vs[5]]], [[...vs[0]],[...vs[5]],[...vs[1]]],
    [[...vs[3]],[...vs[2]],[...vs[6]]], [[...vs[3]],[...vs[6]],[...vs[7]]],
  ],
  edges: [
    { id: 'e0',  points: [[...vs[0]],[...vs[1]]], adjacentFaces: [] },
    { id: 'e1',  points: [[...vs[1]],[...vs[2]]], adjacentFaces: [] },
    { id: 'e2',  points: [[...vs[2]],[...vs[3]]], adjacentFaces: [] },
    { id: 'e3',  points: [[...vs[3]],[...vs[0]]], adjacentFaces: [] },
    { id: 'e4',  points: [[...vs[4]],[...vs[5]]], adjacentFaces: [] },
    { id: 'e5',  points: [[...vs[5]],[...vs[6]]], adjacentFaces: [] },
    { id: 'e6',  points: [[...vs[6]],[...vs[7]]], adjacentFaces: [] },
    { id: 'e7',  points: [[...vs[7]],[...vs[4]]], adjacentFaces: [] },
    { id: 'e8',  points: [[...vs[0]],[...vs[4]]], adjacentFaces: [] },
    { id: 'e9',  points: [[...vs[1]],[...vs[5]]], adjacentFaces: [] },
    { id: 'e10', points: [[...vs[2]],[...vs[6]]], adjacentFaces: [] },
    { id: 'e11', points: [[...vs[3]],[...vs[7]]], adjacentFaces: [] },
  ],
  bbox: [0, 0, 0, 100, 60, 40],
};

function canonicalize(obj: unknown): string {
  return JSON.stringify(obj, (_, v) =>
    typeof v === 'number' ? parseFloat(v.toFixed(9)) : v,
  );
}

describe('projector determinism', () => {
  it('100 runs of projectView produce byte-identical output for front view', () => {
    const first = canonicalize(projectView(BOX_INPUT, 'front'));
    for (let i = 1; i < 100; i++) {
      expect(canonicalize(projectView(BOX_INPUT, 'front'))).toBe(first);
    }
  });

  it('100 runs of projectView produce byte-identical output for iso-NE view', () => {
    const first = canonicalize(projectView(BOX_INPUT, 'iso-NE'));
    for (let i = 1; i < 100; i++) {
      expect(canonicalize(projectView(BOX_INPUT, 'iso-NE'))).toBe(first);
    }
  });
});
