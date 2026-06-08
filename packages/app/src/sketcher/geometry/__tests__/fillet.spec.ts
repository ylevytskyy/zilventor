import { describe, it, expect } from 'vitest';
import { computeFillet, computeChamfer } from '../fillet';

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 4);

describe('computeFillet', () => {
  const lx = { id: 'lx', kind: 'line' as const, x1: 0, y1: 0, x2: 10, y2: 0 };  // corner at (0,0)
  const ly = { id: 'ly', kind: 'line' as const, x1: 0, y1: 0, x2: 0, y2: 10 };

  it('computes center, radius and tangent points for a right-angle corner, r=2', () => {
    const f = computeFillet(lx, ly, 2)!;
    expect(f).not.toBeNull();
    near(f.center.x, 2); near(f.center.y, 2);
    near(f.radius, 2);
    near(f.t1.x, 2); near(f.t1.y, 0);
    near(f.t2.x, 0); near(f.t2.y, 2);
    // Arc angles must be ordered (startAngle < endAngle) so OCCT builds the
    // minor arc rather than the 270° reflex arc.
    // For this corner: t1=(2,0) → angle=-π/2, t2=(0,2) → angle=−π (normalized).
    // After ordering: startAngle=−π (point (0,2)), endAngle=−π/2 (point (2,0)).
    expect(f.arc.startAngle).toBeLessThan(f.arc.endAngle);
    near(f.arc.startAngle, -Math.PI);
    near(f.arc.endAngle, -Math.PI / 2);
  });

  it('trims each source line to its tangent point (corner endpoint moved)', () => {
    const f = computeFillet(lx, ly, 2)!;
    expect([f.trimmedL1.x1, f.trimmedL1.y1].map((n) => Math.round(n))).toEqual([2, 0]);
    near(f.trimmedL1.x2, 10); near(f.trimmedL1.y2, 0);
    expect([f.trimmedL2.x1, f.trimmedL2.y1].map((n) => Math.round(n))).toEqual([0, 2]);
  });

  it('arc midpoint bulges toward the corner', () => {
    const f = computeFillet(lx, ly, 2)!;
    const mid = (f.arc.startAngle + f.arc.endAngle) / 2;
    const mx = f.center.x + f.radius * Math.cos(mid);
    const my = f.center.y + f.radius * Math.sin(mid);
    near(mx, 0.5858); near(my, 0.5858);
  });

  it('returns null when the lines share no corner', () => {
    expect(computeFillet(lx, { id: 'lz', kind: 'line', x1: 5, y1: 5, x2: 9, y2: 9 }, 2)).toBeNull();
  });

  it('returns null when the radius is too large to fit the corner', () => {
    expect(computeFillet(lx, ly, 50)).toBeNull();
  });
});

describe('computeChamfer (equal setback)', () => {
  const lx = { id: 'lx', kind: 'line' as const, x1: 0, y1: 0, x2: 10, y2: 0 };
  const ly = { id: 'ly', kind: 'line' as const, x1: 0, y1: 0, x2: 0, y2: 10 };
  it('places setback points and a connecting line for a right angle', () => {
    const c = computeChamfer(lx, ly, 3)!;
    expect([c.p1.x, c.p1.y].map(Math.round)).toEqual([3, 0]);
    expect([c.p2.x, c.p2.y].map(Math.round)).toEqual([0, 3]);
    expect(c.line.kind).toBe('line');
    expect([c.line.x1, c.line.y1, c.line.x2, c.line.y2].map(Math.round)).toEqual([3, 0, 0, 3]);
  });
  it('returns null when setback exceeds a leg length', () => {
    expect(computeChamfer(lx, ly, 50)).toBeNull();
  });
});
