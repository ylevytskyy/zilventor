import { describe, it, expect } from 'vitest';
import { computeLegPositions, legLevelerBores } from '../legLayout';
import type { FaceName } from '../../types';

describe('computeLegPositions', () => {
  const base = { width: 600, depth: 560, sideInset: 50, frontInset: 75, backInset: 25 };

  it('returns 2R positions, front row then back row', () => {
    const pos = computeLegPositions({ ...base, legsPerRow: 2 });
    expect(pos).toHaveLength(4);
    expect(pos[0]).toEqual({ x: 50, y: 75 });           // front-left
    expect(pos[1]).toEqual({ x: 550, y: 75 });          // front-right
    expect(pos[2]).toEqual({ x: 50, y: 535 });          // back-left
    expect(pos[3]).toEqual({ x: 550, y: 535 });         // back-right
  });

  it('distributes R>2 evenly across usable width', () => {
    const pos = computeLegPositions({ ...base, legsPerRow: 3 });
    expect(pos).toHaveLength(6);
    expect(pos.slice(0, 3).map((p) => p.x)).toEqual([50, 300, 550]);
    expect(pos.slice(0, 3).every((p) => p.y === 75)).toBe(true);
    expect(pos.slice(3).every((p) => p.y === 535)).toBe(true);
  });
});

describe('legLevelerBores', () => {
  const spec = { screwCount: 4, patternW: 36, patternD: 36, screwDiameter: 4, screwDepth: 13 } as const;
  const face: FaceName = { featureId: 'panel', role: 'Bottom', instance: 0 };

  it('emits 4 screw bores in a square around the center', () => {
    const bores = legLevelerBores({ u: 100, v: 200 }, spec, face, 'leg-0');
    expect(bores).toHaveLength(4);
    const coords = bores.map((b) => [b.u, b.v]).sort();
    expect(coords).toEqual([[82, 182], [82, 218], [118, 182], [118, 218]].sort());
    for (const b of bores) {
      expect(b.diameter).toBe(4);
      expect(b.depth).toBe(13);
      expect(b.role).toBe('legLeveler');
      expect(b.connectorKind).toBe('legLeveler');
      expect(b.face).toEqual(face);
    }
    expect(new Set(bores.map((b) => b.id)).size).toBe(4); // unique ids
  });
});
