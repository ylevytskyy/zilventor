// packages/app/src/drawing/__tests__/AnnotationElement.spec.tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AnnotationElement } from '../AnnotationElement';
import type { DrawingAnnotation, DrawingView, ProjectedGeometry, HoleTableAnnotation } from '@zilventor/shared';

// Stub HoleTableElement so Task 3.3 test can verify routing without rendering the full element
vi.mock('../HoleTableElement', () => ({
  HoleTableElement: ({ ann }: { ann: HoleTableAnnotation }) => (
    <g data-testid="hole-table-stub" data-ann-id={ann.id} />
  ),
}));
// Stub computeHoleTableRows and store (used transitively by HoleTableElement mock)
vi.mock('@zilventor/shared/src/drawing/holeTable', () => ({
  computeHoleTableRows: vi.fn(() => []),
}));

const mockProj = (): ProjectedGeometry => ({
  visibleEdges: [
    { id: 'e1', kind: 'outline', points: [[0, 0], [100, 0]] },
    { id: 'e2', kind: 'outline', points: [[50, 0], [50, 80]] },
    { id: 'circ1', kind: 'feature', points: [[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]] },
  ],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
});

const mockView = (): DrawingView => ({
  id: 'v1', kind: 'base', positionMm: { x: 0, y: 0 },
  scale: { numerator: 1, denominator: 1 }, orientation: 'front',
  showHidden: false, projection: mockProj(),
} as DrawingView);

describe('AnnotationElement — balloon', () => {
  const ann: DrawingAnnotation = {
    id: 'a1',
    kind: 'balloon',
    viewId: 'v1',
    targetMm: { x: 30, y: 30 },
    textPosMm: { x: 60, y: 20 },
    itemNumber: 3,
  };

  it('renders a circle element', () => {
    render(<svg><AnnotationElement ann={ann} view={mockView()} /></svg>);
    expect(document.querySelector('circle')).not.toBeNull();
  });

  it('renders the item number inside the balloon', () => {
    render(<svg><AnnotationElement ann={ann} view={mockView()} /></svg>);
    const text = document.querySelector('[data-ann-text]');
    expect(text?.textContent).toBe('3');
  });

  it('renders a leader polyline from targetMm to textPosMm', () => {
    render(<svg><AnnotationElement ann={ann} view={mockView()} /></svg>);
    expect(document.querySelector('polyline')).not.toBeNull();
  });
});

describe('AnnotationElement — centerline', () => {
  const ann: DrawingAnnotation = {
    id: 'a2', kind: 'centerline', viewId: 'v1',
    edgeIdA: 'e1', edgeIdB: 'e2',
  };

  it('renders cross-pattern paths for centerline', () => {
    render(<svg><AnnotationElement ann={ann} view={mockView()} /></svg>);
    const paths = document.querySelectorAll('line,path');
    expect(paths.length).toBeGreaterThan(0);
  });
});

describe('AnnotationElement — center-mark', () => {
  const ann: DrawingAnnotation = {
    id: 'a3', kind: 'center-mark', viewId: 'v1', edgeId: 'circ1',
  };

  it('renders center mark cross lines', () => {
    render(<svg><AnnotationElement ann={ann} view={mockView()} /></svg>);
    expect(document.querySelectorAll('line').length).toBeGreaterThanOrEqual(2);
  });
});

describe('AnnotationElement — leader', () => {
  const ann: DrawingAnnotation = {
    id: 'a4', kind: 'leader', viewId: 'v1',
    targetMm: { x: 20, y: 20 }, textPosMm: { x: 60, y: 10 }, text: 'Sharp edge',
  };

  it('renders text content for leader', () => {
    render(<svg><AnnotationElement ann={ann} view={mockView()} /></svg>);
    expect(document.querySelector('[data-ann-text]')?.textContent).toBe('Sharp edge');
  });
});

// ---------------------------------------------------------------------------
// Task 3.3 — holeTable case routing
// ---------------------------------------------------------------------------

const htAnn: HoleTableAnnotation = {
  kind: 'holeTable',
  id: 'ht-ann-1',
  viewId: 'v-1',
  datum: { kind: 'edge-endpoint', edgeId: 'e-1', end: 'start' },
  positionMm: { x: 200, y: 50 },
  entries: [],
};
const dummyView = {
  id: 'v-1',
  projection: { visibleEdges: [], hiddenEdges: [], bbox: {} },
} as unknown as DrawingView;

describe('AnnotationElement — holeTable case', () => {
  it('renders HoleTableElement for a holeTable annotation', () => {
    const { container } = render(
      <svg>
        <AnnotationElement ann={htAnn as DrawingAnnotation} view={dummyView} />
      </svg>,
    );
    expect(container.querySelector('[data-testid="hole-table-stub"]')).not.toBeNull();
  });
});
