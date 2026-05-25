// packages/app/src/drawing/__tests__/DetailRegionEditHandles.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { DetailRegionEditHandles } from '../DetailRegionEditHandles';
import type { DetailView, DrawingView } from '@zilventor/shared';

// toolMode store mock — factory cannot reference outer variables (vi.mock is hoisted)
vi.mock('../toolMode', () => {
  const state = {
    editDetailRegionState: { stage: 'idle' },
    editDragStart: vi.fn(),
    editDragMove: vi.fn(),
    editDragEnd: vi.fn(),
    editDetailCancel: vi.fn(),
    mode: 'editDetailRegion',
  };
  const store = vi.fn(() => state) as ReturnType<typeof vi.fn> & { getState: () => typeof state };
  store.getState = vi.fn(() => state);
  return { useToolModeStore: store };
});

// Cast as DrawingView with required projection for the Props type
const PARENT_VIEW = {
  id: 'pv1',
  kind: 'base',
  positionMm: { x: 10, y: 10 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front',
  showHidden: false,
  projection: {
    visibleEdges: [],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
  },
  inputFingerprint: 'pv1-fp',
} as DrawingView & { projection: NonNullable<DrawingView['projection']> };

const DETAIL_VIEW: DetailView = {
  id: 'dv1',
  kind: 'detail',
  parentViewId: 'pv1',
  regionParent: { kind: 'circle', center: { x: 20, y: 15 }, radiusMm: 8 },
  label: 'A',
  positionMm: { x: 200, y: 100 },
  scale: { numerator: 2, denominator: 1 },
  showHidden: false,
  projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
  inputFingerprint: 'dv1-fp',
};

// Sheet-space coords: cx = 10 + 20*1 = 30, cy = 10 + 15*1 = 25, r = 8*1 = 8

describe('DetailRegionEditHandles', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a transparent body circle with data-role="edit-center-handle"', () => {
    render(
      <svg>
        <DetailRegionEditHandles
          parentView={PARENT_VIEW}
          detailView={DETAIL_VIEW}
          zoom={1}
          onUpdateLive={vi.fn()}
          onCommit={vi.fn()}
          svgRef={{ current: null }}
          sheetW={420}
          sheetH={297}
        />
      </svg>
    );
    const circle = document.querySelector('[data-role="edit-center-handle"]');
    expect(circle).not.toBeNull();
    expect(circle?.tagName.toLowerCase()).toBe('circle');
  });

  it('body circle has fill-opacity=0 (transparent body for hit-test)', () => {
    render(
      <svg>
        <DetailRegionEditHandles
          parentView={PARENT_VIEW}
          detailView={DETAIL_VIEW}
          zoom={1}
          onUpdateLive={vi.fn()}
          onCommit={vi.fn()}
          svgRef={{ current: null }}
          sheetW={420}
          sheetH={297}
        />
      </svg>
    );
    const circle = document.querySelector('[data-role="edit-center-handle"]') as SVGCircleElement | null;
    const fillOpacity = circle?.getAttribute('fill-opacity') ?? circle?.style.fillOpacity;
    expect(Number(fillOpacity ?? '0')).toBe(0);
  });

  it('renders an east-edge square handle with data-role="edit-radius-handle"', () => {
    render(
      <svg>
        <DetailRegionEditHandles
          parentView={PARENT_VIEW}
          detailView={DETAIL_VIEW}
          zoom={1}
          onUpdateLive={vi.fn()}
          onCommit={vi.fn()}
          svgRef={{ current: null }}
          sheetW={420}
          sheetH={297}
        />
      </svg>
    );
    const rect = document.querySelector('[data-role="edit-radius-handle"]');
    expect(rect).not.toBeNull();
    expect(rect?.tagName.toLowerCase()).toBe('rect');
  });

  it('body circle cx, cy, r match DetailRegionOverlay sheet-space transform', () => {
    render(
      <svg>
        <DetailRegionEditHandles
          parentView={PARENT_VIEW}
          detailView={DETAIL_VIEW}
          zoom={1}
          onUpdateLive={vi.fn()}
          onCommit={vi.fn()}
          svgRef={{ current: null }}
          sheetW={420}
          sheetH={297}
        />
      </svg>
    );
    const circle = document.querySelector('[data-role="edit-center-handle"]') as SVGCircleElement | null;
    // cx = 10 + 20*1 = 30, cy = 10 + 15*1 = 25, r = 8*1 = 8
    expect(Number(circle?.getAttribute('cx'))).toBeCloseTo(30);
    expect(Number(circle?.getAttribute('cy'))).toBeCloseTo(25);
    expect(Number(circle?.getAttribute('r'))).toBeCloseTo(8);
  });

  it('radius handle x is at cx+r (east edge)', () => {
    render(
      <svg>
        <DetailRegionEditHandles
          parentView={PARENT_VIEW}
          detailView={DETAIL_VIEW}
          zoom={1}
          onUpdateLive={vi.fn()}
          onCommit={vi.fn()}
          svgRef={{ current: null }}
          sheetW={420}
          sheetH={297}
        />
      </svg>
    );
    const rect = document.querySelector('[data-role="edit-radius-handle"]') as SVGRectElement | null;
    // center of rect should be near cx+r = 38, cy = 25
    const rx = Number(rect?.getAttribute('x'));
    const rw = Number(rect?.getAttribute('width'));
    const rectCx = rx + rw / 2;
    expect(rectCx).toBeCloseTo(38, 0); // cx+r = 30+8
  });
});

// ─── Rect branch ─────────────────────────────────────────────────────────────

const RECT_DETAIL_VIEW_EH: DetailView = {
  id: 'dv-rect',
  kind: 'detail',
  parentViewId: 'pv1',
  regionParent: { kind: 'rect', center: { x: 20, y: 15 }, widthMm: 30, heightMm: 20 },
  label: 'B',
  positionMm: { x: 200, y: 100 },
  scale: { numerator: 2, denominator: 1 },
  showHidden: false,
  projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
  inputFingerprint: 'dv-rect-fp',
};

// Sheet-space: parentPos={10,10} parentScale=1 → sheetCx=30, sheetCy=25; hw=15, hh=10
// body rect: x=15, y=15, w=30, h=20
// NW: (15,15), NE: (45,15), SE: (45,35), SW: (15,35)

const renderRect = () =>
  render(
    <svg>
      <DetailRegionEditHandles
        parentView={PARENT_VIEW}
        detailView={RECT_DETAIL_VIEW_EH}
        zoom={1}
        onUpdateLive={vi.fn()}
        onCommit={vi.fn()}
        svgRef={{ current: null }}
        sheetW={420}
        sheetH={297}
      />
    </svg>,
  );

describe('DetailRegionEditHandles — rect branch', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('renders body rect with data-role="edit-center-handle"', () => {
    renderRect();
    const el = document.querySelector('[data-role="edit-center-handle"]');
    expect(el).not.toBeNull();
    expect(el?.tagName.toLowerCase()).toBe('rect');
  });

  it('does NOT render <circle data-role="edit-center-handle"> for rect region', () => {
    renderRect();
    const circles = document.querySelectorAll('circle[data-role="edit-center-handle"]');
    expect(circles).toHaveLength(0);
  });

  it('renders exactly 4 corner handles', () => {
    renderRect();
    const nw = document.querySelector('[data-role="edit-corner-handle-NW"]');
    const ne = document.querySelector('[data-role="edit-corner-handle-NE"]');
    const se = document.querySelector('[data-role="edit-corner-handle-SE"]');
    const sw = document.querySelector('[data-role="edit-corner-handle-SW"]');
    expect(nw).not.toBeNull();
    expect(ne).not.toBeNull();
    expect(se).not.toBeNull();
    expect(sw).not.toBeNull();
  });

  it('NW corner handle is at sheet-space top-left corner (sheetCx-hw, sheetCy-hh)', () => {
    renderRect();
    const nw = document.querySelector('[data-role="edit-corner-handle-NW"]') as SVGRectElement;
    // handle x + w/2 = corner x = sheetCx - hw = 30 - 15 = 15
    const handleCx = parseFloat(nw.getAttribute('x')!) + parseFloat(nw.getAttribute('width')!) / 2;
    expect(handleCx).toBeCloseTo(15, 1);
  });

  it('SE corner handle center is at sheet-space bottom-right corner (sheetCx+hw, sheetCy+hh)', () => {
    renderRect();
    const se = document.querySelector('[data-role="edit-corner-handle-SE"]') as SVGRectElement;
    // sheetCx+hw = 30+15=45, sheetCy+hh = 25+10=35
    const handleCx = parseFloat(se.getAttribute('x')!) + parseFloat(se.getAttribute('width')!) / 2;
    const handleCy = parseFloat(se.getAttribute('y')!) + parseFloat(se.getAttribute('height')!) / 2;
    expect(handleCx).toBeCloseTo(45, 1);
    expect(handleCy).toBeCloseTo(35, 1);
  });

  it('body rect x/y/width/height match sheet-space rect geometry', () => {
    renderRect();
    const body = document.querySelector('[data-role="edit-center-handle"]') as SVGRectElement;
    expect(parseFloat(body.getAttribute('x')!)).toBeCloseTo(15, 1);   // sheetCx-hw
    expect(parseFloat(body.getAttribute('y')!)).toBeCloseTo(15, 1);   // sheetCy-hh
    expect(parseFloat(body.getAttribute('width')!)).toBeCloseTo(30, 1);
    expect(parseFloat(body.getAttribute('height')!)).toBeCloseTo(20, 1);
  });

  it('circle branch still renders circle + radius handle (regression guard)', () => {
    render(
      <svg>
        <DetailRegionEditHandles
          parentView={PARENT_VIEW}
          detailView={DETAIL_VIEW}
          zoom={1}
          onUpdateLive={vi.fn()}
          onCommit={vi.fn()}
          svgRef={{ current: null }}
          sheetW={420}
          sheetH={297}
        />
      </svg>,
    );
    expect(document.querySelector('circle[data-role="edit-center-handle"]')).not.toBeNull();
    expect(document.querySelector('[data-role="edit-radius-handle"]')).not.toBeNull();
    expect(document.querySelector('[data-role="edit-corner-handle-NW"]')).toBeNull();
  });
});
