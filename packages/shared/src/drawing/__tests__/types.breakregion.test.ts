import { describe, it, expect } from 'vitest';
import type { BreakRegion } from '../types';
import type { Edge2D } from '../projectedGeometry';

describe('BreakRegion shape (spec §5.1)', () => {
  it('has all 6 required fields with correct types', () => {
    const br: BreakRegion = {
      id: 'br-1',
      axis: 'x',
      coordA: 50,
      coordB: 150,
      gapMm: 5,
      style: 'zigzag',
    };
    expect(br.id).toBe('br-1');
    expect(br.axis).toBe('x');
    expect(br.coordA).toBe(50);
    expect(br.coordB).toBe(150);
    expect(br.gapMm).toBe(5);
    expect(br.style).toBe('zigzag');
  });

  it('accepts axis: "y"', () => {
    const br: BreakRegion = {
      id: 'br-y',
      axis: 'y',
      coordA: 30,
      coordB: 80,
      gapMm: 5,
      style: 'zigzag',
    };
    expect(br.axis).toBe('y');
  });

  it('survives JSON round-trip without drift', () => {
    const br: BreakRegion = {
      id: 'br-rt',
      axis: 'x',
      coordA: 100.5,
      coordB: 200.75,
      gapMm: 5,
      style: 'zigzag',
    };
    const parsed = JSON.parse(JSON.stringify(br)) as BreakRegion;
    expect(parsed.coordA).toBe(100.5);
    expect(parsed.coordB).toBe(200.75);
    expect(parsed.style).toBe('zigzag');
  });
});

describe('Edge2D.kind — break tier (spec §5.3)', () => {
  it('accepts kind: "break" at the type level and survives round-trip', () => {
    const breakEdge: Edge2D = {
      id: 'break_br1',
      kind: 'break',
      points: [[100, -5], [100.75, 0], [99.25, 3], [100, 6]],
    };
    const parsed = JSON.parse(JSON.stringify(breakEdge)) as Edge2D;
    expect(parsed.kind).toBe('break');
    expect(parsed.sourceFaceIds).toBeUndefined();
  });

  it('existing kinds silhouette/feature/outline still assignable', () => {
    const e1: Edge2D = { id: 'a', kind: 'silhouette', points: [[0, 0], [1, 1]] };
    const e2: Edge2D = { id: 'b', kind: 'feature',    points: [[0, 0], [1, 1]] };
    const e3: Edge2D = { id: 'c', kind: 'outline',    points: [[0, 0], [1, 1]] };
    expect(e1.kind).toBe('silhouette');
    expect(e2.kind).toBe('feature');
    expect(e3.kind).toBe('outline');
  });
});
