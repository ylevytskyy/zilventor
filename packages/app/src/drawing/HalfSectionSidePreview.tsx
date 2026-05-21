// packages/app/src/drawing/HalfSectionSidePreview.tsx
import React, { useEffect } from 'react';

export type Vec2 = { x: number; y: number };

export interface HalfSectionSidePreviewProps {
  sectionLine: { p0: Vec2; p1: Vec2 };
  pendingCutSide: -1 | 1;
  zoom: number;
  /** Drop point in sheet-space mm — the overlay anchors here. */
  dropAt: Vec2;
  onSideHover: (side: -1 | 1) => void;
  onCommit: (side: -1 | 1) => void;
}

// Preview box size in mm at zoom=1 (scales with 1/zoom to stay screen-pixel-stable)
const PREVIEW_MM = 24;

export function HalfSectionSidePreview({
  sectionLine: _sl,
  pendingCutSide,
  zoom,
  dropAt,
  onSideHover,
  onCommit,
}: HalfSectionSidePreviewProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') onSideHover(1);
      else if (e.key === 'ArrowLeft') onSideHover(-1);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onSideHover]);

  // Scale the preview so it appears as PREVIEW_MM × PREVIEW_MM screen-pixels
  // regardless of the current SVG zoom level.
  const size = PREVIEW_MM / zoom;
  const cx = size / 2;
  const fillWidth = Math.max(4 / zoom, cx);
  const fillX = pendingCutSide === 1 ? cx : 0;
  const fontSize = 5 / zoom;
  const strokeWidth = 0.5 / zoom;

  return (
    <g
      data-role="half-section-side-preview"
      transform={`translate(${dropAt.x - size / 2},${dropAt.y - size / 2})`}
      style={{ pointerEvents: 'auto', userSelect: 'none' } as React.CSSProperties}
    >
      {/* Background */}
      <rect
        x={0}
        y={0}
        width={size}
        height={size}
        fill="white"
        fillOpacity={0.92}
        stroke="#1e3a5f"
        strokeWidth={strokeWidth}
        rx={1 / zoom}
      />

      {/* Highlighted fill on active side */}
      <rect
        x={fillX}
        y={0}
        width={fillWidth}
        height={size}
        fill="rgba(59,130,246,0.25)"
        stroke="none"
        pointerEvents="none"
        data-testid="half-fill"
        style={{ width: `${fillWidth}px` }}
      />

      {/* Section line (vertical centre) */}
      <line
        x1={cx}
        y1={0}
        x2={cx}
        y2={size}
        stroke="#1e3a5f"
        strokeWidth={strokeWidth * 2}
        strokeDasharray={`${3 / zoom} ${1 / zoom}`}
        pointerEvents="none"
      />

      {/* Arrow indicating pending side */}
      <text
        x={pendingCutSide === 1 ? cx + cx * 0.4 : cx - cx * 0.4}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fill="#1e3a5f"
        pointerEvents="none"
      >
        {pendingCutSide === 1 ? '→' : '←'}
      </text>

      {/* Clickable half-regions (on top so they capture events) */}
      <rect
        x={0}
        y={0}
        width={cx}
        height={size}
        fill="transparent"
        data-testid="half-side--1"
        onMouseEnter={() => onSideHover(-1)}
        onClick={() => onCommit(-1)}
        style={{ cursor: 'pointer' } as React.CSSProperties}
      />
      <rect
        x={cx}
        y={0}
        width={cx}
        height={size}
        fill="transparent"
        data-testid="half-side-1"
        onMouseEnter={() => onSideHover(1)}
        onClick={() => onCommit(1)}
        style={{ cursor: 'pointer' } as React.CSSProperties}
      />
    </g>
  );
}
