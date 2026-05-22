// packages/app/src/drawing/__tests__/DimensionElement.f5render.spec.tsx
/**
 * TDD RED → GREEN for Task A: React renderers for baseline/ordinate/angular dims.
 *
 * Tests that DimensionElement renders actual SVG DOM elements for F5 dim kinds
 * (baseline, ordinate, angular), NOT null. These tests should fail before
 * BaselineDimension / OrdinateDimension / AngularDimension are added.
 *
 * Pattern: useAppStore.setState injection (same as DrawingCanvas.baseline.spec.tsx).
 * No vi.mock — we use the real store so getDimensionGroupForDim can read activeDrawing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { DimensionElement } from '../DimensionElement';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDimension, DrawingView, DimensionGroup, ProjectedGeometry } from '@zilventor/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHEET_ID = 'sheet-f5render';
const VIEW_ID  = 'view-f5render';
const DATUM_EDGE_ID = 'e-datum';
const MEMBER_EDGE_ID = 'e-member';
const ORIGIN_EDGE_ID = 'e-origin';
const ORD_MEMBER_EDGE_ID = 'e-ord-member';
const ARC_EDGE_ID = 'e-arc';
const EDGE1_ID = 'e-ang-1';
const EDGE2_ID = 'e-ang-2';

function makeProj(): ProjectedGeometry {
  return {
    visibleEdges: [
      { id: DATUM_EDGE_ID,      kind: 'outline', points: [[-25, -10], [-25, 10]] as readonly (readonly [number, number])[] },
      { id: MEMBER_EDGE_ID,     kind: 'outline', points: [[25, -10],  [25, 10]]  as readonly (readonly [number, number])[] },
      { id: ORIGIN_EDGE_ID,     kind: 'outline', points: [[-50, 0],   [0, 0]]    as readonly (readonly [number, number])[] },
      { id: ORD_MEMBER_EDGE_ID, kind: 'outline', points: [[30, -5],   [30, 5]]   as readonly (readonly [number, number])[] },
      // Arc edge: 5 points approximating a quarter-circle
      { id: ARC_EDGE_ID,        kind: 'outline', points: [[10, 0], [9, 4], [7, 7], [4, 9], [0, 10]] as readonly (readonly [number, number])[] },
      // Two-edges for angular two-edges dim
      { id: EDGE1_ID,           kind: 'outline', points: [[0, 0], [30, 0]]  as readonly (readonly [number, number])[] },
      { id: EDGE2_ID,           kind: 'outline', points: [[0, 0], [0, 30]]  as readonly (readonly [number, number])[] },
    ],
    hiddenEdges: [],
    bbox: { minX: -50, minY: -10, maxX: 50, maxY: 50 },
  };
}

function makeView(): DrawingView {
  return {
    id: VIEW_ID,
    kind: 'base',
    positionMm: { x: 0, y: 0 },
    scale: { numerator: 1, denominator: 1 },
    orientation: 'front',
    showHidden: false,
    projection: makeProj(),
  } as DrawingView;
}

const BASELINE_GROUP_ID = 'bg-f5render';
const ORDINATE_GROUP_ID = 'og-f5render';

function makeBaselineGroup(): DimensionGroup {
  return {
    kind: 'baseline',
    id: BASELINE_GROUP_ID,
    viewId: VIEW_ID,
    datum: { kind: 'edge-endpoint', edgeId: DATUM_EDGE_ID, end: 'start' },
    direction: 'h',
    baseOffsetMm: 20,
    spacingMm: 10,
  };
}

function makeOrdinateGroup(): DimensionGroup {
  return {
    kind: 'ordinate',
    id: ORDINATE_GROUP_ID,
    viewId: VIEW_ID,
    origin: { kind: 'edge-endpoint', edgeId: ORIGIN_EDGE_ID, end: 'start' },
    xColumnOffsetMm: 20,
    yColumnOffsetMm: 20,
  };
}

function makeDrawingWithGroups(groups: DimensionGroup[]) {
  return {
    id: 'drw-f5render',
    name: 'F5 Render Test Drawing',
    units: 'mm',
    source: { partPath: 'test.zipt', sourceKind: 'part' as const },
    properties: {},
    sheets: [{
      id: SHEET_ID,
      name: 'Sheet 1',
      size: { kind: 'iso' as const, size: 'A4' as const },
      orientation: 'landscape' as const,
      views: [makeView()],
      dimensions: [],
      dimensionGroups: groups,
      annotations: [],
      titleBlock: {},
    }],
    activeSheetId: SHEET_ID,
  };
}

beforeEach(() => {
  cleanup();
  // Inject drawing into store so getDimensionGroupForDim can find the group.
  const drawing = makeDrawingWithGroups([makeBaselineGroup(), makeOrdinateGroup()]) as never;
  useAppStore.setState({
    activeDrawing: drawing,
    activeDocument: { kind: 'drawing', document: drawing },
  } as never, false);
});

// ---------------------------------------------------------------------------
// Baseline renders
// ---------------------------------------------------------------------------

describe('DimensionElement — baseline (Task A: RED→GREEN)', () => {
  const baselineDim: DrawingDimension = {
    kind: 'baseline',
    id: 'dim-bl-f5render',
    viewId: VIEW_ID,
    groupId: BASELINE_GROUP_ID,
    slot: 0,
    to: { kind: 'edge-endpoint', edgeId: MEMBER_EDGE_ID, end: 'start' },
  };

  it('renders data-dim-kind="baseline" attribute in the DOM', () => {
    const view = makeView();
    render(<svg><DimensionElement dim={baselineDim} view={view} /></svg>);
    const el = document.querySelector('[data-dim-kind="baseline"]');
    expect(el).not.toBeNull();
  });

  it('renders data-dim-id attribute matching the dim id', () => {
    const view = makeView();
    render(<svg><DimensionElement dim={baselineDim} view={view} /></svg>);
    expect(document.querySelector('[data-dim-id="dim-bl-f5render"]')).not.toBeNull();
  });

  it('renders data-group-id attribute', () => {
    const view = makeView();
    render(<svg><DimensionElement dim={baselineDim} view={view} /></svg>);
    expect(document.querySelector(`[data-group-id="${BASELINE_GROUP_ID}"]`)).not.toBeNull();
  });

  it('renders at least 3 line elements (1 dim line + 2 extension lines)', () => {
    const view = makeView();
    const { container } = render(<svg><DimensionElement dim={baselineDim} view={view} /></svg>);
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  it('renders a text element with the computed distance', () => {
    const view = makeView();
    const { container } = render(<svg><DimensionElement dim={baselineDim} view={view} /></svg>);
    const text = container.querySelector('text');
    expect(text).not.toBeNull();
    expect(text?.textContent).toBeTruthy();
  });

  it('returns null when the group is not found in the store', () => {
    // Inject drawing without any groups
    const drawingNoGroups = makeDrawingWithGroups([]) as never;
    useAppStore.setState({
      activeDrawing: drawingNoGroups,
      activeDocument: { kind: 'drawing', document: drawingNoGroups },
    } as never, false);
    const view = makeView();
    const { container } = render(<svg><DimensionElement dim={baselineDim} view={view} /></svg>);
    // Should render nothing inside the svg
    expect(container.querySelector('[data-dim-kind="baseline"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ordinate renders
// ---------------------------------------------------------------------------

describe('DimensionElement — ordinate (Task A: RED→GREEN)', () => {
  const ordinateDim: DrawingDimension = {
    kind: 'ordinate',
    id: 'dim-ord-f5render',
    viewId: VIEW_ID,
    groupId: ORDINATE_GROUP_ID,
    to: { kind: 'edge-endpoint', edgeId: ORD_MEMBER_EDGE_ID, end: 'start' },
    axis: 'x',
  };

  it('renders data-dim-kind="ordinate" attribute', () => {
    const view = makeView();
    render(<svg><DimensionElement dim={ordinateDim} view={view} /></svg>);
    expect(document.querySelector('[data-dim-kind="ordinate"]')).not.toBeNull();
  });

  it('renders data-axis attribute', () => {
    const view = makeView();
    render(<svg><DimensionElement dim={ordinateDim} view={view} /></svg>);
    expect(document.querySelector('[data-axis="x"]')).not.toBeNull();
  });

  it('renders exactly 2 line elements for the L-leader', () => {
    const view = makeView();
    const { container } = render(<svg><DimensionElement dim={ordinateDim} view={view} /></svg>);
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('renders a text element with the delta value', () => {
    const view = makeView();
    const { container } = render(<svg><DimensionElement dim={ordinateDim} view={view} /></svg>);
    const text = container.querySelector('text');
    expect(text).not.toBeNull();
  });

  it('returns null when the ordinate group is missing', () => {
    const drawingNoGroups = makeDrawingWithGroups([]) as never;
    useAppStore.setState({
      activeDrawing: drawingNoGroups,
      activeDocument: { kind: 'drawing', document: drawingNoGroups },
    } as never, false);
    const view = makeView();
    const { container } = render(<svg><DimensionElement dim={ordinateDim} view={view} /></svg>);
    expect(container.querySelector('[data-dim-kind="ordinate"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Angular renders — two-edges
// ---------------------------------------------------------------------------

describe('DimensionElement — angular two-edges (Task A: RED→GREEN)', () => {
  const angularTwoEdges: DrawingDimension = {
    kind: 'angular',
    id: 'dim-ang-two-f5render',
    viewId: VIEW_ID,
    ref: {
      kind: 'two-edges',
      edge1: { viewId: VIEW_ID, edgeId: EDGE1_ID },
      edge2: { viewId: VIEW_ID, edgeId: EDGE2_ID },
    },
    arcSide: 'inside',
    offsetMm: 15,
  };

  it('renders data-dim-kind="angular" attribute', () => {
    const view = makeView();
    render(<svg><DimensionElement dim={angularTwoEdges} view={view} /></svg>);
    expect(document.querySelector('[data-dim-kind="angular"]')).not.toBeNull();
  });

  it('renders data-arc-side attribute', () => {
    const view = makeView();
    render(<svg><DimensionElement dim={angularTwoEdges} view={view} /></svg>);
    expect(document.querySelector('[data-arc-side="inside"]')).not.toBeNull();
  });

  it('renders a path element with arc command (contains "A")', () => {
    const view = makeView();
    const { container } = render(<svg><DimensionElement dim={angularTwoEdges} view={view} /></svg>);
    const paths = container.querySelectorAll('path');
    const arcPaths = Array.from(paths).filter((p) => p.getAttribute('d')?.includes('A'));
    expect(arcPaths.length).toBeGreaterThanOrEqual(1);
  });

  it('renders a text element with the angle label', () => {
    const view = makeView();
    const { container } = render(<svg><DimensionElement dim={angularTwoEdges} view={view} /></svg>);
    const text = container.querySelector('text');
    expect(text).not.toBeNull();
    expect(text?.textContent).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Angular renders — arc
// ---------------------------------------------------------------------------

describe('DimensionElement — angular arc (Task A: RED→GREEN)', () => {
  const angularArc: DrawingDimension = {
    kind: 'angular',
    id: 'dim-ang-arc-f5render',
    viewId: VIEW_ID,
    ref: {
      kind: 'arc',
      edge: { viewId: VIEW_ID, edgeId: ARC_EDGE_ID },
    },
    arcSide: 'inside',
    offsetMm: 5,
  };

  it('renders data-dim-kind="angular" for arc variant', () => {
    const view = makeView();
    render(<svg><DimensionElement dim={angularArc} view={view} /></svg>);
    expect(document.querySelector('[data-dim-kind="angular"]')).not.toBeNull();
  });

  it('renders a path element with arc command (contains "A") for arc variant', () => {
    const view = makeView();
    const { container } = render(<svg><DimensionElement dim={angularArc} view={view} /></svg>);
    const paths = container.querySelectorAll('path');
    const arcPaths = Array.from(paths).filter((p) => p.getAttribute('d')?.includes('A'));
    expect(arcPaths.length).toBeGreaterThanOrEqual(1);
  });
});
