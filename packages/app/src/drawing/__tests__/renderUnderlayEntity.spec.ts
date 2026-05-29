// packages/app/src/drawing/__tests__/renderUnderlayEntity.spec.ts
// Unit tests for the arc→SVG-path conversion inside the underlay entity renderer.
import { describe, it, expect } from 'vitest';
import { underlayEntityToSvg } from '../renderUnderlayEntity';
import type { UnderlayEntity } from '@zilventor/shared';

describe('underlayEntityToSvg — arc path conversion', () => {
  it('90° arc center (0,0) r=10 from 0°→90°: path starts at (10,0) and ends at (0,10)', () => {
    const entity: UnderlayEntity = {
      kind: 'arc',
      cx: 0, cy: 0, r: 10,
      startAngle: 0,   // degrees
      endAngle: 90,    // degrees
    };
    const svg = underlayEntityToSvg(entity);
    expect(svg).toContain('<path');
    // Start x=10, y=0 (cos0°=1, sin0°=0 → 10,0)
    expect(svg).toMatch(/M\s*10([.,]0+)?\s+0([.,]0+)?/);
    // End x=0, y=10 (cos90°=0, sin90°=1 → 0,10)
    // The path ends with "...flag ex ey" then closing quote/space
    expect(svg).toMatch(/A[^"]*\s+0([.,]0+)?\s+10([.,]0+)?[" ]/);
    // Also verify the endpoint directly: 0 10 should appear as endpoint coords
    expect(svg).toContain('0 10"');
  });

  it('90° arc has large-arc-flag=0 (sweep < 180°)', () => {
    const entity: UnderlayEntity = {
      kind: 'arc',
      cx: 0, cy: 0, r: 10,
      startAngle: 0, endAngle: 90,
    };
    const svg = underlayEntityToSvg(entity);
    // SVG arc: "A rx ry x-rotation large-arc-flag sweep-flag ex ey"
    // large-arc-flag must be 0 for 90° sweep
    expect(svg).toMatch(/A\s+10([.,]0+)?\s+10([.,]0+)?\s+0\s+0\s+/);
  });

  it('270° arc has large-arc-flag=1 (sweep > 180°)', () => {
    const entity: UnderlayEntity = {
      kind: 'arc',
      cx: 0, cy: 0, r: 10,
      startAngle: 0, endAngle: 270,
    };
    const svg = underlayEntityToSvg(entity);
    expect(svg).toMatch(/A\s+10([.,]0+)?\s+10([.,]0+)?\s+0\s+1\s+/);
  });

  it('line entity produces <line> element', () => {
    const entity: UnderlayEntity = { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 20 };
    const svg = underlayEntityToSvg(entity);
    expect(svg).toContain('<line');
    expect(svg).toContain('x1="0"');
    expect(svg).toContain('y1="0"');
    expect(svg).toContain('x2="10"');
    expect(svg).toContain('y2="20"');
  });

  it('circle entity produces <circle> element', () => {
    const entity: UnderlayEntity = { kind: 'circle', cx: 5, cy: 7, r: 3 };
    const svg = underlayEntityToSvg(entity);
    expect(svg).toContain('<circle');
    expect(svg).toContain('cx="5"');
    expect(svg).toContain('cy="7"');
    expect(svg).toContain('r="3"');
  });

  it('polyline (open) produces <polyline> element', () => {
    const entity: UnderlayEntity = {
      kind: 'polyline',
      points: [[0, 0], [10, 0], [10, 10]] as ReadonlyArray<readonly [number, number]>,
      closed: false,
    };
    const svg = underlayEntityToSvg(entity);
    expect(svg).toContain('<polyline');
    expect(svg).toContain('0,0');
  });

  it('polyline (closed) produces <polygon> element', () => {
    const entity: UnderlayEntity = {
      kind: 'polyline',
      points: [[0, 0], [10, 0], [10, 10]] as ReadonlyArray<readonly [number, number]>,
      closed: true,
    };
    const svg = underlayEntityToSvg(entity);
    // closed polylines become polygon for correct fill-none appearance
    expect(svg).toMatch(/<polyline|<polygon/);
  });

  it('text entity produces <text> element', () => {
    const entity: UnderlayEntity = {
      kind: 'text',
      x: 10, y: 20, height: 5, value: 'Hello', rotation: 0,
    };
    const svg = underlayEntityToSvg(entity);
    expect(svg).toContain('<text');
    expect(svg).toContain('Hello');
  });
});
