// packages/app/src/drawing/__tests__/HoleTableElement.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { HoleTableAnnotation } from '@zilventor/shared';
import type { DrawingView } from '@zilventor/shared';
import type { HoleTableRow } from '@zilventor/shared/src/drawing/holeTable';

// Stub computeHoleTableRows — Batch 1 already ships it; we control its output here
vi.mock('@zilventor/shared/src/drawing/holeTable', () => ({
  computeHoleTableRows: vi.fn(),
}));

import { computeHoleTableRows } from '@zilventor/shared/src/drawing/holeTable';

// Use the real useAppStore with setState to control activePart
import { useAppStore } from '../../store/useAppStore';

const mockRows: HoleTableRow[] = [
  {
    tag: 'A1',
    xDim: 20,
    yDim: -15,
    description: '⌀8 THRU',
    markerCenterSheetMm: { x: 130, y: 80 },
  },
  {
    tag: 'B1',
    xDim: 60,
    yDim: -15,
    description: '⌀12 THRU',
    markerCenterSheetMm: { x: 170, y: 80 },
  },
];

const mockAnn: HoleTableAnnotation = {
  kind: 'holeTable',
  id: 'ht-1',
  viewId: 'v-1',
  datum: { kind: 'edge-endpoint', edgeId: 'e-1', end: 'start' },
  positionMm: { x: 200, y: 50 },
  entries: [
    { holeFeatureId: 'H1', tag: 'A1' },
    { holeFeatureId: 'H2', tag: 'B1' },
  ],
};

const mockView: DrawingView = {
  id: 'v-1',
  kind: 'base',
  positionMm: { x: 100, y: 50 },
  scale: { numerator: 1, denominator: 1 },
  projection: {
    visibleEdges: [],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  },
} as unknown as DrawingView;

// A minimal fake part so the component doesn't early-return on null activePart
const fakePart = {
  id: 'p1',
  name: 'FakePart',
  parameters: { d1: { value: 8 } },
  featureTree: [],
  materials: [],
  hardware: [],
  properties: {},
  units: 'mm' as const,
};

beforeEach(() => {
  vi.mocked(computeHoleTableRows).mockReturnValue(mockRows);
  // Provide a non-null activePart so the component renders
  useAppStore.setState({ activePart: fakePart as never });
});

import { HoleTableElement } from '../HoleTableElement';

describe('HoleTableElement', () => {
  it('renders a table grid with header and one row per HoleTableRow', () => {
    const { container } = render(
      <svg>
        <HoleTableElement ann={mockAnn} view={mockView} />
      </svg>,
    );
    const g = container.querySelector('[data-ann-id="ht-1"][data-ann-kind="holeTable"]');
    expect(g).not.toBeNull();

    // Header texts
    expect(container.textContent).toContain('TAG');
    expect(container.textContent).toContain('XDIM');
    expect(container.textContent).toContain('YDIM');
    expect(container.textContent).toContain('DESCRIPTION');

    // Row tag texts
    expect(container.textContent).toContain('A1');
    expect(container.textContent).toContain('B1');
  });

  it('renders dimension values formatted to one decimal', () => {
    const { container } = render(
      <svg>
        <HoleTableElement ann={mockAnn} view={mockView} />
      </svg>,
    );
    // 20 mm → "20.0"; -15 mm → "-15.0"
    expect(container.textContent).toContain('20.0');
    expect(container.textContent).toContain('-15.0');
  });

  it('renders per-hole balloons (circles) and leaders (lines) to markerCenterSheetMm', () => {
    const { container } = render(
      <svg>
        <HoleTableElement ann={mockAnn} view={mockView} />
      </svg>,
    );
    // One balloon <circle> per row (data-role="hole-balloon")
    const balloons = container.querySelectorAll('[data-role="hole-balloon"]');
    expect(balloons).toHaveLength(2);
    // One leader line per row
    const leaders = container.querySelectorAll('[data-role="hole-leader"]');
    expect(leaders).toHaveLength(2);
  });

  it('passes the correct resolveParam built from activePart to computeHoleTableRows', () => {
    render(
      <svg>
        <HoleTableElement ann={mockAnn} view={mockView} />
      </svg>,
    );
    // computeHoleTableRows should be called with the fakePart from the store
    expect(computeHoleTableRows).toHaveBeenCalledWith(
      mockAnn,
      mockView,
      fakePart,
      expect.any(Function),
    );
  });

  it('returns null when computeHoleTableRows returns an empty array', () => {
    vi.mocked(computeHoleTableRows).mockReturnValue([]);
    const { container } = render(
      <svg>
        <HoleTableElement ann={mockAnn} view={mockView} />
      </svg>,
    );
    const g = container.querySelector('[data-ann-id="ht-1"]');
    expect(g).toBeNull();
  });
});
