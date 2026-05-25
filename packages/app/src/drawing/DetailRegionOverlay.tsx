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
const STROKE_WIDTH = 0.35;

export function DetailRegionOverlay({ parentView, detailView, zoom = 1 }: Props) {
  const parentScale = parentView.scale.numerator / parentView.scale.denominator;
  const rp = detailView.regionParent;
  const fontSize = LABEL_FONT_SIZE_MM / zoom;
  const cos45 = Math.SQRT2 / 2;
  const sin45 = Math.SQRT2 / 2;

  if (rp.kind === 'circle') {
    const cx = parentView.positionMm.x + rp.center.x * parentScale;
    const cy = parentView.positionMm.y + rp.center.y * parentScale;
    const r  = rp.radiusMm * parentScale;
    const labelX = cx + (r + 5) * cos45;
    const labelY = cy - (r + 5) * sin45;

    return (
      <g data-detail-callout-overlay={detailView.id}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="black"
          strokeWidth={STROKE_WIDTH}
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

  // kind === 'rect'
  const { center, widthMm, heightMm } = rp;
  const rx = parentView.positionMm.x + (center.x - widthMm / 2) * parentScale;
  const ry = parentView.positionMm.y + (center.y - heightMm / 2) * parentScale;
  const rw = widthMm  * parentScale;
  const rh = heightMm * parentScale;
  // Label: upper-right corner of the rect + 5 mm diagonal offset
  const labelX = parentView.positionMm.x + (center.x + widthMm / 2) * parentScale + 5 * cos45;
  const labelY = parentView.positionMm.y + (center.y - heightMm / 2) * parentScale - 5 * sin45;

  return (
    <g data-detail-callout-overlay={detailView.id}>
      <rect
        x={rx}
        y={ry}
        width={rw}
        height={rh}
        fill="none"
        stroke="black"
        strokeWidth={STROKE_WIDTH}
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
