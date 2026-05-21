// packages/app/src/drawing/HalfSectionSidePreview.tsx
import React, { useEffect } from 'react';

export type Vec2 = { x: number; y: number };

export interface HalfSectionSidePreviewProps {
  sectionLine: { p0: Vec2; p1: Vec2 };
  pendingCutSide: -1 | 1;
  zoom: number;
  onSideHover: (side: -1 | 1) => void;
  onCommit: (side: -1 | 1) => void;
}

const MIN_FILL_PX = 20;
const PREVIEW_SIZE = 120;
const CX = PREVIEW_SIZE / 2;

export function HalfSectionSidePreview({
  sectionLine: _sl,
  pendingCutSide,
  zoom,
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

  const fillWidth = Math.max(MIN_FILL_PX, CX * zoom);
  const fillX = pendingCutSide === 1 ? CX : 0;

  return (
    <div style={{ position: 'absolute', pointerEvents: 'auto', userSelect: 'none' }} role="presentation">
      <svg
        width={PREVIEW_SIZE}
        height={PREVIEW_SIZE}
        style={{ display: 'block', cursor: 'pointer' }}
        aria-label="Half section side preview"
      >
        {/* Clickable half-regions */}
        <rect
          x={0}
          y={0}
          width={CX}
          height={PREVIEW_SIZE}
          fill="transparent"
          data-testid="half-side--1"
          onMouseEnter={() => onSideHover(-1)}
          onClick={() => onCommit(-1)}
        />
        <rect
          x={CX}
          y={0}
          width={CX}
          height={PREVIEW_SIZE}
          fill="transparent"
          data-testid="half-side-1"
          onMouseEnter={() => onSideHover(1)}
          onClick={() => onCommit(1)}
        />

        {/* Highlighted fill on active side */}
        <rect
          x={fillX}
          y={0}
          width={fillWidth}
          height={PREVIEW_SIZE}
          fill="rgba(59,130,246,0.25)"
          stroke="none"
          pointerEvents="none"
          data-testid="half-fill"
          style={{ width: `${fillWidth}px` }}
        />

        {/* Section line (vertical centre) */}
        <line
          x1={CX}
          y1={0}
          x2={CX}
          y2={PREVIEW_SIZE}
          stroke="#1e3a5f"
          strokeWidth={2}
          strokeDasharray="6 2"
          pointerEvents="none"
        />

        {/* Arrow indicating pending side */}
        <text
          x={pendingCutSide === 1 ? CX + 12 : CX - 12}
          y={PREVIEW_SIZE / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={14}
          fill="#1e3a5f"
          pointerEvents="none"
        >
          {pendingCutSide === 1 ? '→' : '←'}
        </text>
      </svg>
    </div>
  );
}
