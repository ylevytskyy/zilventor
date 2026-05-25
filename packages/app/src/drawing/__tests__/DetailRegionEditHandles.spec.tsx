// packages/app/src/drawing/__tests__/DetailRegionEditHandles.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { DetailRegionEditHandles } from '../DetailRegionEditHandles';
import type { DetailView, DrawingView } from '@zilventor/shared';

// toolMode store mock
vi.mock('../toolMode', () => ({
  useToolModeStore: vi.fn(() => ({
    editDetailRegionState: { stage: 'idle' },
    editDragStart: vi.fn(),
    editDragMove: vi.fn(),
    editDragEnd: vi.fn(),
    editDetailCancel: vi.fn(),
    mode: 'editDetailRegion',
  })),
}));

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
  regionParent: { center: { x: 20, y: 15 }, radiusMm: 8 },
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
