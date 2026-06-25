import { describe, it, expect } from 'vitest';
import { computeLegPositions } from '../legLayout';

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
