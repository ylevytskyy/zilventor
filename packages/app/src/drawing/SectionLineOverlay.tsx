// packages/app/src/drawing/SectionLineOverlay.tsx
import React from 'react';
import type { BaseView, ProjectedView, SectionView } from '@zilventor/shared';

interface Props {
  parentView: BaseView | ProjectedView;
  sectionView: SectionView;
  /** Sheet zoom factor (default 1). Stroke widths divide by zoom to keep physical mm. */
  zoom?: number;
}

/** Arrow triangle length in parent-view mm. */
const ARROW_LEN_MM = 3;
/** Label offset beyond arrowhead tip, mm. */
const LABEL_OFFSET_MM = 5;
/** ANSI heavy section-line width in mm. */
const LINE_WIDTH_MM = 0.7;
/** Label font size in mm. */
const FONT_SIZE_MM = 5;

function arrowheadPath(tip: { x: number; y: number }, dir: { x: number; y: number }): string {
  // dir is the unit vector pointing FROM the line terminus TOWARD the arrow tip
  const len = ARROW_LEN_MM;
  const half = len * 0.4;
  // tip is the arrowhead point; base is inward along -dir
  const bx = tip.x - dir.x * len;
  const by = tip.y - dir.y * len;
  // perpendicular left/right of dir
  const lx = bx - dir.y * half;
  const ly = by + dir.x * half;
  const rx = bx + dir.y * half;
  const ry = by - dir.x * half;
  return `M${tip.x},${tip.y} L${lx},${ly} L${rx},${ry} Z`;
}

export function SectionLineOverlay({ parentView, sectionView, zoom = 1 }: Props) {
  const { sectionLine, arrowDirection, label } = sectionView;
  const { p0, p1 } = sectionLine;

  // Translate to parent-view coordinate space (account for parent view position)
  const ox = parentView.positionMm.x;
  const oy = parentView.positionMm.y;
  const scale = parentView.scale.numerator / parentView.scale.denominator;

  // Section line endpoints in sheet space
  const sp0 = { x: ox + p0.x * scale, y: oy + p0.y * scale };
  const sp1 = { x: ox + p1.x * scale, y: oy + p1.y * scale };

  // Unit vector along the line (p0→p1)
  const dx = sp1.x - sp0.x;
  const dy = sp1.y - sp0.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;

  // Normal perpendicular to the line, scaled by arrowDirection sign
  const nx = -uy * arrowDirection;
  const ny = ux * arrowDirection;

  // Arrowhead tips: arrowDirection side of each terminus
  const tip0 = { x: sp0.x + nx * ARROW_LEN_MM, y: sp0.y + ny * ARROW_LEN_MM };
  const tip1 = { x: sp1.x + nx * ARROW_LEN_MM, y: sp1.y + ny * ARROW_LEN_MM };

  // Label positions: LABEL_OFFSET_MM beyond arrowhead tips
  const lx0 = tip0.x + nx * LABEL_OFFSET_MM;
  const ly0 = tip0.y + ny * LABEL_OFFSET_MM;
  const lx1 = tip1.x + nx * LABEL_OFFSET_MM;
  const ly1 = tip1.y + ny * LABEL_OFFSET_MM;

  const strokeWidth = LINE_WIDTH_MM / zoom;
  const fontSize = FONT_SIZE_MM / zoom;

  return (
    <g data-section-overlay={sectionView.id}>
      {/* ANSI heavy dashed section line */}
      <line
        x1={sp0.x} y1={sp0.y}
        x2={sp1.x} y2={sp1.y}
        stroke="black"
        strokeWidth={strokeWidth}
        strokeDasharray="6 1.5 1.5 1.5"
      />
      {/* Arrowhead at p0 */}
      <path
        d={arrowheadPath(tip0, { x: nx, y: ny })}
        fill="black"
        stroke="none"
        data-role="arrowhead"
        data-terminus="p0"
      />
      {/* Arrowhead at p1 */}
      <path
        d={arrowheadPath(tip1, { x: nx, y: ny })}
        fill="black"
        stroke="none"
        data-role="arrowhead"
        data-terminus="p1"
      />
      {/* Label at p0 terminus */}
      <text
        x={lx0} y={ly0}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fontFamily="sans-serif"
      >
        {label}
      </text>
      {/* Label at p1 terminus */}
      <text
        x={lx1} y={ly1}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fontFamily="sans-serif"
      >
        {label}
      </text>
    </g>
  );
}
