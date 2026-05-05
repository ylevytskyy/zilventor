// packages/app/src/drawing/DetailRegionOverlay.tsx
import React from 'react';
import type { BaseView, ProjectedView, IsoView, SectionView, DetailView } from '@zilventor/shared';

interface Props {
  parentView: BaseView | ProjectedView | IsoView | SectionView;
  detailView: DetailView;
  /** Sheet zoom factor (default 1). Used to scale label font size. */
  zoom?: number;
}

const LABEL_FONT_SIZE_MM = 5;
const CIRCLE_STROKE_WIDTH = 0.35;

export function DetailRegionOverlay({ parentView, detailView, zoom = 1 }: Props) {
  const parentScale = parentView.scale.numerator / parentView.scale.denominator;
  const { center, radiusMm } = detailView.regionParent;

  // Circle center in sheet space
  const cx = parentView.positionMm.x + center.x * parentScale;
  const cy = parentView.positionMm.y + center.y * parentScale;
  // Circle radius in sheet space
  const r = radiusMm * parentScale;

  // Label position: 5 mm upper-right of the circle's perimeter
  const cos45 = Math.SQRT2 / 2;
  const sin45 = Math.SQRT2 / 2;
  const labelX = cx + (r + 5) * cos45;
  const labelY = cy - (r + 5) * sin45;

  const fontSize = LABEL_FONT_SIZE_MM / zoom;

  return (
    <g data-detail-callout-overlay={detailView.id}>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="black"
        strokeWidth={CIRCLE_STROKE_WIDTH}
        data-role="detail-callout-label"
      />
      <text
        x={labelX}
        y={labelY}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fontFamily="sans-serif"
        data-role="detail-callout-label"
      >
        {detailView.label}
      </text>
    </g>
  );
}
