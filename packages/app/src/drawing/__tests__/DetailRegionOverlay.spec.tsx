// packages/app/src/drawing/__tests__/DetailRegionOverlay.spec.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { DetailRegionOverlay } from '../DetailRegionOverlay';
import type { BaseView, DetailView } from '@zilventor/shared';

const PARENT_VIEW: BaseView = {
  id: 'pv1',
  kind: 'base',
  positionMm: { x: 50, y: 40 },
  scale: { numerator: 1, denominator: 5 },  // 1:5 → parentScale = 0.2
  orientation: 'front',
  showHidden: false,
};

const DETAIL_VIEW: DetailView = {
  id: 'dv1',
  kind: 'detail',
  parentViewId: 'pv1',
  regionParent: { kind: 'circle', center: { x: 10, y: 8 }, radiusMm: 5 },
  label: 'A',
  positionMm: { x: 200, y: 150 },
  scale: { numerator: 2, denominator: 1 },
  showHidden: false,
};

describe('DetailRegionOverlay', () => {
  it('renders a <circle> element with data-role="detail-callout-label"', () => {
    const { container } = render(
      <svg>
        <DetailRegionOverlay parentView={PARENT_VIEW} detailView={DETAIL_VIEW} />
      </svg>,
    );
    const circle = container.querySelector('circle[data-role="detail-callout-label"]');
    expect(circle).not.toBeNull();
  });

  it('circle cx/cy are in sheet space: positionMm + center * parentScale', () => {
    const { container } = render(
      <svg>
        <DetailRegionOverlay parentView={PARENT_VIEW} detailView={DETAIL_VIEW} />
      </svg>,
    );
    const circle = container.querySelector('circle[data-role="detail-callout-label"]')!;
    // cx = 50 + 10 * 0.2 = 52, cy = 40 + 8 * 0.2 = 41.6
    expect(parseFloat(circle.getAttribute('cx')!)).toBeCloseTo(52, 3);
    expect(parseFloat(circle.getAttribute('cy')!)).toBeCloseTo(41.6, 3);
  });

  it('circle r = regionParent.radiusMm * parentScale', () => {
    const { container } = render(
      <svg>
        <DetailRegionOverlay parentView={PARENT_VIEW} detailView={DETAIL_VIEW} />
      </svg>,
    );
    const circle = container.querySelector('circle[data-role="detail-callout-label"]')!;
    // r = 5 * 0.2 = 1
    expect(parseFloat(circle.getAttribute('r')!)).toBeCloseTo(1, 3);
  });

  it('renders a <text> with data-role="detail-callout-label" containing the label letter', () => {
    const { container } = render(
      <svg>
        <DetailRegionOverlay parentView={PARENT_VIEW} detailView={DETAIL_VIEW} />
      </svg>,
    );
    const text = container.querySelector('text[data-role="detail-callout-label"]');
    expect(text).not.toBeNull();
    expect(text!.textContent).toBe('A');
  });

  it('label x is upper-right of circle perimeter: cx + (r+5)*cos(45°)', () => {
    const { container } = render(
      <svg>
        <DetailRegionOverlay parentView={PARENT_VIEW} detailView={DETAIL_VIEW} />
      </svg>,
    );
    const text = container.querySelector('text[data-role="detail-callout-label"]')!;
    const cx = 50 + 10 * 0.2;           // 52
    const r  = 5 * 0.2;                 // 1
    const cos45 = Math.SQRT2 / 2;
    const expectedX = cx + (r + 5) * cos45;
    expect(parseFloat(text.getAttribute('x')!)).toBeCloseTo(expectedX, 2);
  });

  it('label y is upper-right of circle perimeter: cy - (r+5)*sin(45°)', () => {
    const { container } = render(
      <svg>
        <DetailRegionOverlay parentView={PARENT_VIEW} detailView={DETAIL_VIEW} />
      </svg>,
    );
    const text = container.querySelector('text[data-role="detail-callout-label"]')!;
    const cy = 40 + 8 * 0.2;            // 41.6
    const r  = 5 * 0.2;                 // 1
    const sin45 = Math.SQRT2 / 2;
    const expectedY = cy - (r + 5) * sin45;
    expect(parseFloat(text.getAttribute('y')!)).toBeCloseTo(expectedY, 2);
  });

  it('circle stroke-width is 0.35 mm', () => {
    const { container } = render(
      <svg>
        <DetailRegionOverlay parentView={PARENT_VIEW} detailView={DETAIL_VIEW} />
      </svg>,
    );
    const circle = container.querySelector('circle[data-role="detail-callout-label"]')!;
    expect(parseFloat(circle.getAttribute('stroke-width')!)).toBeCloseTo(0.35, 3);
  });

  it('stroke-width of circle is stable (no zoom prop affects circle weight)', () => {
    const { container: c1 } = render(
      <svg><DetailRegionOverlay parentView={PARENT_VIEW} detailView={DETAIL_VIEW} zoom={1} /></svg>,
    );
    const { container: c2 } = render(
      <svg><DetailRegionOverlay parentView={PARENT_VIEW} detailView={DETAIL_VIEW} zoom={2} /></svg>,
    );
    // The circle's stroke-width is fixed at 0.35; only text font-size scales by zoom
    const sw1 = parseFloat(c1.querySelector('circle[data-role="detail-callout-label"]')!.getAttribute('stroke-width')!);
    const sw2 = parseFloat(c2.querySelector('circle[data-role="detail-callout-label"]')!.getAttribute('stroke-width')!);
    expect(sw1).toBeCloseTo(sw2, 3);
  });
});

// ─── Rect branch tests ───────────────────────────────────────────────────────

const PARENT_VIEW_2: BaseView = {
  id: 'pv2',
  kind: 'base',
  positionMm: { x: 50, y: 40 },
  scale: { numerator: 1, denominator: 5 },  // parentScale = 0.2
  orientation: 'front',
  showHidden: false,
};

const RECT_DETAIL_VIEW: DetailView = {
  id: 'dv-rect',
  kind: 'detail',
  parentViewId: 'pv2',
  regionParent: { kind: 'rect', center: { x: 20, y: 10 }, widthMm: 30, heightMm: 20 },
  label: 'B',
  positionMm: { x: 200, y: 150 },
  scale: { numerator: 2, denominator: 1 },
  showHidden: false,
};

describe('DetailRegionOverlay — rect branch', () => {
  it('renders a <rect> element with data-role="detail-callout-label"', () => {
    const { container } = render(
      <svg>
        <DetailRegionOverlay parentView={PARENT_VIEW_2} detailView={RECT_DETAIL_VIEW} />
      </svg>,
    );
    const rect = container.querySelector('rect[data-role="detail-callout-label"]');
    expect(rect).not.toBeNull();
  });

  it('does NOT render a circle when regionParent.kind is rect', () => {
    const { container } = render(
      <svg>
        <DetailRegionOverlay parentView={PARENT_VIEW_2} detailView={RECT_DETAIL_VIEW} />
      </svg>,
    );
    expect(container.querySelector('circle[data-role="detail-callout-label"]')).toBeNull();
  });

  it('rect x, y are in sheet space: positionMm + (center − w/2) * parentScale', () => {
    const { container } = render(
      <svg>
        <DetailRegionOverlay parentView={PARENT_VIEW_2} detailView={RECT_DETAIL_VIEW} />
      </svg>,
    );
    const rect = container.querySelector('rect[data-role="detail-callout-label"]')!;
    // x = 50 + (20 - 15) * 0.2 = 50 + 1 = 51
    // y = 40 + (10 - 10) * 0.2 = 40 + 0 = 40
    expect(parseFloat(rect.getAttribute('x')!)).toBeCloseTo(51, 3);
    expect(parseFloat(rect.getAttribute('y')!)).toBeCloseTo(40, 3);
  });

  it('rect width/height = widthMm/heightMm * parentScale', () => {
    const { container } = render(
      <svg>
        <DetailRegionOverlay parentView={PARENT_VIEW_2} detailView={RECT_DETAIL_VIEW} />
      </svg>,
    );
    const rect = container.querySelector('rect[data-role="detail-callout-label"]')!;
    // width = 30 * 0.2 = 6, height = 20 * 0.2 = 4
    expect(parseFloat(rect.getAttribute('width')!)).toBeCloseTo(6, 3);
    expect(parseFloat(rect.getAttribute('height')!)).toBeCloseTo(4, 3);
  });

  it('renders <text data-role="detail-callout-label"> with the label letter', () => {
    const { container } = render(
      <svg>
        <DetailRegionOverlay parentView={PARENT_VIEW_2} detailView={RECT_DETAIL_VIEW} />
      </svg>,
    );
    const text = container.querySelector('text[data-role="detail-callout-label"]');
    expect(text).not.toBeNull();
    expect(text!.textContent).toBe('B');
  });

  it('label x is at upper-right corner of rect + 5 mm diagonal offset', () => {
    const { container } = render(
      <svg>
        <DetailRegionOverlay parentView={PARENT_VIEW_2} detailView={RECT_DETAIL_VIEW} />
      </svg>,
    );
    const text = container.querySelector('text[data-role="detail-callout-label"]')!;
    // labelX = 50 + (20 + 15) * 0.2 + 5 * cos45 = 50 + 7 + 5*cos45
    const expectedX = 50 + (20 + 15) * 0.2 + 5 * (Math.SQRT2 / 2);
    expect(parseFloat(text.getAttribute('x')!)).toBeCloseTo(expectedX, 2);
  });

  it('rect stroke-width is 0.35 mm', () => {
    const { container } = render(
      <svg>
        <DetailRegionOverlay parentView={PARENT_VIEW_2} detailView={RECT_DETAIL_VIEW} />
      </svg>,
    );
    const rect = container.querySelector('rect[data-role="detail-callout-label"]')!;
    expect(parseFloat(rect.getAttribute('stroke-width')!)).toBeCloseTo(0.35, 3);
  });

  it('circle branch still works after refactor (regression guard)', () => {
    const circleDetailView: DetailView = {
      id: 'dv-circle-rg',
      kind: 'detail',
      parentViewId: 'pv2',
      regionParent: { kind: 'circle', center: { x: 10, y: 8 }, radiusMm: 5 },
      label: 'A',
      positionMm: { x: 200, y: 150 },
      scale: { numerator: 2, denominator: 1 },
      showHidden: false,
    };
    const { container } = render(
      <svg>
        <DetailRegionOverlay parentView={PARENT_VIEW_2} detailView={circleDetailView} />
      </svg>,
    );
    expect(container.querySelector('circle[data-role="detail-callout-label"]')).not.toBeNull();
    expect(container.querySelector('rect[data-role="detail-callout-label"]')).toBeNull();
  });
});
