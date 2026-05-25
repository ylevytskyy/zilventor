// packages/shared/src/drawing/__tests__/types.regionparent.test.ts
import { describe, it, expect } from 'vitest';
import type { RegionParent, DetailView, DrawingView } from '../types';

// ─── circle arm ──────────────────────────────────────────────────────────────
describe('RegionParent — circle arm', () => {
  it('circle arm has kind, center, radiusMm', () => {
    const rp = {
      kind: 'circle' as const,
      center: { x: 10, y: 8 },
      radiusMm: 5,
    } satisfies RegionParent;
    expect(rp.kind).toBe('circle');
    expect(rp.center.x).toBe(10);
    expect(rp.radiusMm).toBe(5);
  });

  it('circle arm survives JSON round-trip', () => {
    const rp: RegionParent = { kind: 'circle', center: { x: 25.5, y: 13.25 }, radiusMm: 7.5 };
    const parsed = JSON.parse(JSON.stringify(rp)) as RegionParent;
    expect(parsed.kind).toBe('circle');
    expect((parsed as Extract<RegionParent, { kind: 'circle' }>).radiusMm).toBe(7.5);
  });
});

// ─── rect arm ────────────────────────────────────────────────────────────────
describe('RegionParent — rect arm', () => {
  it('rect arm has kind, center, widthMm, heightMm', () => {
    const rp = {
      kind: 'rect' as const,
      center: { x: 50, y: 40 },
      widthMm: 30,
      heightMm: 20,
    } satisfies RegionParent;
    expect(rp.kind).toBe('rect');
    expect(rp.center.x).toBe(50);
    expect(rp.widthMm).toBe(30);
    expect(rp.heightMm).toBe(20);
  });

  it('rect arm survives JSON round-trip', () => {
    const rp: RegionParent = { kind: 'rect', center: { x: 0, y: 0 }, widthMm: 100, heightMm: 60 };
    const parsed = JSON.parse(JSON.stringify(rp)) as RegionParent;
    expect(parsed.kind).toBe('rect');
    expect((parsed as Extract<RegionParent, { kind: 'rect' }>).widthMm).toBe(100);
    expect((parsed as Extract<RegionParent, { kind: 'rect' }>).heightMm).toBe(60);
  });

  it('rect arm does NOT have radiusMm', () => {
    const rp: RegionParent = { kind: 'rect', center: { x: 0, y: 0 }, widthMm: 10, heightMm: 10 };
    // TypeScript narrowing — at runtime confirm the field is absent
    expect((rp as Record<string, unknown>)['radiusMm']).toBeUndefined();
  });
});

// ─── union switch exhaustiveness ─────────────────────────────────────────────
describe('RegionParent — union exhaustiveness', () => {
  it('switch on kind covers both arms with a never fallthrough', () => {
    function describe(rp: RegionParent): string {
      switch (rp.kind) {
        case 'circle': return `circle r=${rp.radiusMm}`;
        case 'rect':   return `rect ${rp.widthMm}×${rp.heightMm}`;
        default: {
          const _never: never = rp;
          return _never;
        }
      }
    }
    expect(describe({ kind: 'circle', center: { x: 0, y: 0 }, radiusMm: 5 })).toBe('circle r=5');
    expect(describe({ kind: 'rect', center: { x: 0, y: 0 }, widthMm: 20, heightMm: 10 })).toBe('rect 20×10');
  });
});

// ─── DetailView still accepts both arms ──────────────────────────────────────
describe('DetailView with RegionParent union', () => {
  it('DetailView.regionParent as circle arm type-checks', () => {
    const dv: DetailView = {
      id: 'dv1',
      kind: 'detail',
      parentViewId: 'pv1',
      regionParent: { kind: 'circle', center: { x: 10, y: 8 }, radiusMm: 5 },
      label: 'A',
      positionMm: { x: 50, y: 150 },
      scale: { numerator: 2, denominator: 1 },
      showHidden: false,
    };
    expect(dv.regionParent.kind).toBe('circle');
  });

  it('DetailView.regionParent as rect arm type-checks', () => {
    const dv: DetailView = {
      id: 'dv2',
      kind: 'detail',
      parentViewId: 'pv1',
      regionParent: { kind: 'rect', center: { x: 20, y: 15 }, widthMm: 40, heightMm: 25 },
      label: 'B',
      positionMm: { x: 200, y: 100 },
      scale: { numerator: 2, denominator: 1 },
      showHidden: false,
    };
    expect(dv.regionParent.kind).toBe('rect');
  });

  it('DrawingView union still admits detail with circle regionParent', () => {
    function labelView(v: DrawingView): string {
      switch (v.kind) {
        case 'base': return 'base';
        case 'projected': return 'projected';
        case 'iso': return 'iso';
        case 'section': return 'section';
        case 'detail': return `detail-${v.regionParent.kind}`;
        default: {
          const _never: never = v;
          return _never;
        }
      }
    }
    const dv: DrawingView = {
      id: 'dv3', kind: 'detail', parentViewId: 'pv1',
      regionParent: { kind: 'circle', center: { x: 0, y: 0 }, radiusMm: 5 },
      label: 'A', positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 }, showHidden: false,
    };
    expect(labelView(dv)).toBe('detail-circle');
  });
});
