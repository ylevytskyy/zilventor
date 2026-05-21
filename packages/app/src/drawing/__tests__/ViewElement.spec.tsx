// packages/app/src/drawing/__tests__/ViewElement.spec.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ViewElement } from '../ViewElement';
import type { DrawingView, ProjectedGeometry, SectionView, DetailView } from '@zilventor/shared';

const proj = (): ProjectedGeometry => ({
  visibleEdges: [
    { id: 've1', kind: 'outline', points: [[0, 0], [100, 0]] },
    { id: 've2', kind: 'feature', points: [[0, 10], [100, 10]] },
  ],
  hiddenEdges: [
    { id: 'he1', kind: 'outline', points: [[0, 20], [100, 20]] },
  ],
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 20 },
});

const view = (): DrawingView => ({
  id: 'v1',
  kind: 'base',
  positionMm: { x: 50, y: 50 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front',
  showHidden: true,
  projection: proj(),
  inputFingerprint: 'fp1',
} as DrawingView);

describe('ViewElement', () => {
  it('renders 2 visible polylines and 1 hidden polyline', () => {
    render(
      <svg>
        <ViewElement view={view()} isStale={false} onRegenerate={vi.fn()} />
      </svg>
    );
    const polylines = document.querySelectorAll('polyline');
    expect(polylines).toHaveLength(3);
  });

  it('visible polylines have stroke-width 0.35', () => {
    render(
      <svg>
        <ViewElement view={view()} isStale={false} onRegenerate={vi.fn()} />
      </svg>
    );
    const visible = document.querySelector('[data-edge-id="ve1"]');
    expect(visible?.getAttribute('stroke-width')).toBe('0.35');
  });

  it('hidden polyline has stroke-dasharray "2 1" and stroke-width 0.18', () => {
    render(
      <svg>
        <ViewElement view={view()} isStale={false} onRegenerate={vi.fn()} />
      </svg>
    );
    const hidden = document.querySelector('[data-edge-id="he1"]');
    expect(hidden?.getAttribute('stroke-dasharray')).toBe('2 1');
    expect(hidden?.getAttribute('stroke-width')).toBe('0.18');
  });

  it('no stale marker when isStale=false', () => {
    render(
      <svg>
        <ViewElement view={view()} isStale={false} onRegenerate={vi.fn()} />
      </svg>
    );
    expect(document.querySelector('[data-stale-marker]')).toBeNull();
  });

  it('renders stale marker when isStale=true', () => {
    render(
      <svg>
        <ViewElement view={view()} isStale={true} onRegenerate={vi.fn()} />
      </svg>
    );
    expect(document.querySelector('[data-stale-marker]')).not.toBeNull();
  });

  it('clicking stale marker calls onRegenerate with the view id', () => {
    const onRegen = vi.fn();
    render(
      <svg>
        <ViewElement view={view()} isStale={true} onRegenerate={onRegen} />
      </svg>
    );
    const marker = document.querySelector('[data-stale-marker]') as SVGElement;
    fireEvent.click(marker);
    expect(onRegen).toHaveBeenCalledWith('v1');
  });
});

const SECTION_VIEW_WITH_HATCH: SectionView = {
  id: 'v-sec',
  kind: 'section',
  label: 'A',
  parentViewId: 'v-base',
  sectionLine: { p0: { x: 5, y: 25 }, p1: { x: 45, y: 25 } },
  arrowDirection: 1,
  positionMm: { x: 100, y: 50 },
  scale: { numerator: 1, denominator: 1 },
  showHidden: false,
  mode: 'full',
  hatchSegments: [
    { p0: { x: 10, y: 5 }, p1: { x: 40, y: 5 }, materialId: 'mat-pine' },
    { p0: { x: 10, y: 8 }, p1: { x: 40, y: 8 }, materialId: 'mat-pine' },
    { p0: { x: 10, y: 11 }, p1: { x: 40, y: 11 }, materialId: 'mat-oak' },
  ],
  projection: {
    visibleEdges: [{ id: 'e0', kind: 'outline', points: [[0, 0], [50, 0], [50, 50], [0, 50], [0, 0]] }],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
  },
  fingerprint: 'fp-sec',
};

describe('ViewElement — section view', () => {
  it('renders 3 hatch <line> elements for 3 hatch segments', () => {
    const { container } = render(
      <svg>
        <ViewElement view={SECTION_VIEW_WITH_HATCH} sheetZoom={1} isStale={false} onRegenerate={vi.fn()} />
      </svg>,
    );
    const hatchLines = container.querySelectorAll('line[data-role="hatch"]');
    expect(hatchLines).toHaveLength(3);
  });

  it('hatch lines have correct coords from hatchSegments', () => {
    const { container } = render(
      <svg>
        <ViewElement view={SECTION_VIEW_WITH_HATCH} sheetZoom={1} isStale={false} onRegenerate={vi.fn()} />
      </svg>,
    );
    const first = container.querySelector('line[data-role="hatch"]')!;
    expect(parseFloat(first.getAttribute('x1')!)).toBeCloseTo(10);
    expect(parseFloat(first.getAttribute('y1')!)).toBeCloseTo(5);
  });

  it('renders caption "SECTION A-A" below view bounds', () => {
    const { getByText } = render(
      <svg>
        <ViewElement view={SECTION_VIEW_WITH_HATCH} sheetZoom={1} isStale={false} onRegenerate={vi.fn()} />
      </svg>,
    );
    expect(getByText('SECTION A-A')).toBeDefined();
  });

  it('does NOT render hidden edges for section view', () => {
    const { container } = render(
      <svg>
        <ViewElement view={SECTION_VIEW_WITH_HATCH} sheetZoom={1} isStale={false} onRegenerate={vi.fn()} />
      </svg>,
    );
    const hiddenPolylines = container.querySelectorAll('polyline[data-edge-kind="hidden"]');
    expect(hiddenPolylines).toHaveLength(0);
  });

  it('renders hatch with 0.25mm stroke-width at zoom 1', () => {
    const { container } = render(
      <svg>
        <ViewElement view={SECTION_VIEW_WITH_HATCH} sheetZoom={1} isStale={false} onRegenerate={vi.fn()} />
      </svg>,
    );
    const hatchLine = container.querySelector('line[data-role="hatch"]')!;
    expect(parseFloat(hatchLine.getAttribute('stroke-width')!)).toBeCloseTo(0.25);
  });
});

const DETAIL_VIEW_FIXTURE: DetailView = {
  id: 'dv1',
  kind: 'detail',
  parentViewId: 'pv1',
  regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
  label: 'A',
  positionMm: { x: 200, y: 100 },
  scale: { numerator: 2, denominator: 1 },
  showHidden: false,
  projection: {
    visibleEdges: [
      { id: 'dve1', kind: 'outline', points: [[0, 0], [8, 0], [8, 6], [0, 6], [0, 0]] },
    ],
    hiddenEdges: [],
    bbox: { minX: -8, minY: -6, maxX: 8, maxY: 6 },
  },
  inputFingerprint: 'fp-detail',
};

const BASE_VIEW_WITH_BREAK_EDGE: import('@zilventor/shared').DrawingView = {
  id: 'bv-break',
  kind: 'base',
  positionMm: { x: 50, y: 50 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front',
  showHidden: false,
  projection: {
    visibleEdges: [
      { id: 've-normal', kind: 'outline', points: [[0, 0], [50, 0]] },
      {
        id: 'break_b1',
        kind: 'break' as const,
        points: [[55, -5], [53, 0], [57, 5], [55, 10], [53, 15], [57, 20]],
      },
    ],
    hiddenEdges: [],
    bbox: { minX: 0, minY: -5, maxX: 60, maxY: 25 },
  },
  inputFingerprint: 'fp-bv-break',
} as import('@zilventor/shared').DrawingView;

describe('ViewElement — break-symbol edge rendering', () => {
  it('renders a polyline with data-role="break-symbol" for kind=break edge', () => {
    const { container } = render(
      <svg>
        <ViewElement view={BASE_VIEW_WITH_BREAK_EDGE} isStale={false} onRegenerate={vi.fn()} />
      </svg>,
    );
    const breakPoly = container.querySelector('polyline[data-role="break-symbol"]');
    expect(breakPoly).not.toBeNull();
  });

  it('break-symbol polyline has strokeWidth 0.5 (heavier than normal 0.35)', () => {
    const { container } = render(
      <svg>
        <ViewElement view={BASE_VIEW_WITH_BREAK_EDGE} isStale={false} onRegenerate={vi.fn()} />
      </svg>,
    );
    const breakPoly = container.querySelector('polyline[data-role="break-symbol"]')!;
    expect(breakPoly.getAttribute('stroke-width')).toBe('0.5');
  });

  it('normal outline edge does NOT have data-role="break-symbol"', () => {
    const { container } = render(
      <svg>
        <ViewElement view={BASE_VIEW_WITH_BREAK_EDGE} isStale={false} onRegenerate={vi.fn()} />
      </svg>,
    );
    const normalPoly = container.querySelector('polyline[data-edge-id="ve-normal"]');
    expect(normalPoly).not.toBeNull();
    expect(normalPoly!.getAttribute('data-role')).toBeNull();
  });

  it('both break-symbol and normal polylines share the same parent visible edge group', () => {
    const { container } = render(
      <svg>
        <ViewElement view={BASE_VIEW_WITH_BREAK_EDGE} isStale={false} onRegenerate={vi.fn()} />
      </svg>,
    );
    const group = container.querySelector('[data-edge-group="visible"]');
    expect(group).not.toBeNull();
    const polylines = group!.querySelectorAll('polyline');
    expect(polylines.length).toBe(2); // one normal + one break-symbol
  });
});

describe('ViewElement — detail view', () => {
  it('renders <circle data-role="detail-border"> with r = regionParent.radiusMm', () => {
    const { container } = render(
      <svg>
        <ViewElement view={DETAIL_VIEW_FIXTURE} isStale={false} onRegenerate={vi.fn()} />
      </svg>,
    );
    const circle = container.querySelector('circle[data-role="detail-border"]');
    expect(circle).not.toBeNull();
    // r in detail-local mm equals regionParent.radiusMm (the scale() transform on the <g> handles sheet-mm sizing)
    expect(parseFloat(circle!.getAttribute('r')!)).toBeCloseTo(5, 3);
  });

  it('renders visible edge polylines from projection.visibleEdges', () => {
    const { container } = render(
      <svg>
        <ViewElement view={DETAIL_VIEW_FIXTURE} isStale={false} onRegenerate={vi.fn()} />
      </svg>,
    );
    const polylines = container.querySelectorAll('polyline[data-edge-id="dve1"]');
    expect(polylines).toHaveLength(1);
  });

  it('renders <text data-role="detail-caption"> with "DETAIL A" text', () => {
    const { container } = render(
      <svg>
        <ViewElement view={DETAIL_VIEW_FIXTURE} isStale={false} onRegenerate={vi.fn()} />
      </svg>,
    );
    const caption = container.querySelector('text[data-role="detail-caption"]');
    expect(caption).not.toBeNull();
    expect(caption!.textContent).toContain('DETAIL A');
  });

  it('caption <tspan> contains the scale ratio "2:1"', () => {
    const { container } = render(
      <svg>
        <ViewElement view={DETAIL_VIEW_FIXTURE} isStale={false} onRegenerate={vi.fn()} />
      </svg>,
    );
    const caption = container.querySelector('text[data-role="detail-caption"]');
    expect(caption!.textContent).toContain('2:1');
  });

  it('stale banner renders for detail view when isStale=true', () => {
    const { container } = render(
      <svg>
        <ViewElement view={DETAIL_VIEW_FIXTURE} isStale={true} onRegenerate={vi.fn()} />
      </svg>,
    );
    expect(container.querySelector('[data-stale-marker]')).not.toBeNull();
  });

  it('clicking stale marker on detail view calls onRegenerate with view id', () => {
    const onRegen = vi.fn();
    const { container } = render(
      <svg>
        <ViewElement view={DETAIL_VIEW_FIXTURE} isStale={true} onRegenerate={onRegen} />
      </svg>,
    );
    const marker = container.querySelector('[data-stale-marker]') as SVGElement;
    fireEvent.click(marker);
    expect(onRegen).toHaveBeenCalledWith('dv1');
  });

  it('detail view with showHidden=false renders no hidden polylines', () => {
    const withHidden: DetailView = {
      ...DETAIL_VIEW_FIXTURE,
      showHidden: false,
      projection: {
        visibleEdges: DETAIL_VIEW_FIXTURE.projection!.visibleEdges,
        hiddenEdges: [{ id: 'dhe1', kind: 'outline', points: [[0, 0], [4, 0]] }],
        bbox: DETAIL_VIEW_FIXTURE.projection!.bbox,
      },
    };
    const { container } = render(
      <svg>
        <ViewElement view={withHidden} isStale={false} onRegenerate={vi.fn()} />
      </svg>,
    );
    expect(container.querySelectorAll('polyline[data-edge-kind="hidden"]')).toHaveLength(0);
  });
});
