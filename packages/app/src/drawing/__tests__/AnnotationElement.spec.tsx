// packages/app/src/drawing/__tests__/AnnotationElement.spec.tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AnnotationElement } from '../AnnotationElement';
import type { DrawingAnnotation, DrawingView, ProjectedGeometry, HoleTableAnnotation, PartsListAnnotation } from '@zilventor/shared';

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

  it('renders nothing (no crash) for a centerline annotation whose view is unresolved', () => {
    const { container } = render(<svg><AnnotationElement ann={ann} view={undefined} /></svg>);
    expect(container.querySelector('line')).toBeNull();
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

// ---------------------------------------------------------------------------
// partsList case — sheet-level annotation, no viewId
// ---------------------------------------------------------------------------

const plAnn: PartsListAnnotation = {
  kind: 'partsList',
  id: 'pl-ann-1',
  positionMm: { x: 10, y: 20 },
  rows: [
    { item: 1, qty: 2, partName: 'Side Panel', material: 'MDF 18mm', dimensions: '700×300×18', edgeBands: 'ABS' },
    { item: 2, qty: 1, partName: 'Shelf',      material: '',          dimensions: '',            edgeBands: '' },
  ],
};

describe('AnnotationElement — partsList case', () => {
  it('renders a g element with data-ann-kind="partsList"', () => {
    const { container } = render(
      <svg>
        <AnnotationElement ann={plAnn as DrawingAnnotation} view={undefined as any} />
      </svg>,
    );
    expect(container.querySelector('[data-ann-kind="partsList"]')).not.toBeNull();
  });

  it('renders ITEM column header', () => {
    const { container } = render(
      <svg>
        <AnnotationElement ann={plAnn as DrawingAnnotation} view={undefined as any} />
      </svg>,
    );
    const texts = Array.from(container.querySelectorAll('text'));
    expect(texts.some((t) => t.textContent === 'ITEM')).toBe(true);
  });

  it('renders QTY column header', () => {
    const { container } = render(
      <svg>
        <AnnotationElement ann={plAnn as DrawingAnnotation} view={undefined as any} />
      </svg>,
    );
    const texts = Array.from(container.querySelectorAll('text'));
    expect(texts.some((t) => t.textContent === 'QTY')).toBe(true);
  });

  it('renders PART NAME column header', () => {
    const { container } = render(
      <svg>
        <AnnotationElement ann={plAnn as DrawingAnnotation} view={undefined as any} />
      </svg>,
    );
    const texts = Array.from(container.querySelectorAll('text'));
    expect(texts.some((t) => t.textContent === 'PART NAME')).toBe(true);
  });

  it('renders a data row value for partName "Side Panel"', () => {
    const { container } = render(
      <svg>
        <AnnotationElement ann={plAnn as DrawingAnnotation} view={undefined as any} />
      </svg>,
    );
    const texts = Array.from(container.querySelectorAll('text'));
    expect(texts.some((t) => t.textContent === 'Side Panel')).toBe(true);
  });

  it('renders empty string cells for hardware row', () => {
    const { container } = render(
      <svg>
        <AnnotationElement ann={plAnn as DrawingAnnotation} view={undefined as any} />
      </svg>,
    );
    // The empty-material + empty-dimensions cells render as text nodes with empty content
    const texts = Array.from(container.querySelectorAll('text'));
    const emptyCount = texts.filter((t) => t.textContent === '').length;
    // row 2 has material='', dimensions='', edgeBands='' → at least 2 empty cells
    expect(emptyCount).toBeGreaterThanOrEqual(2);
  });
});
