/**
 * renderUnderlayEntity.ts — F3/F4 DXF underlay entity → SVG string conversion.
 *
 * Used by:
 *   - renderDrawingSvg.ts (SVG export)
 *   - DrawingCanvas.tsx (live canvas, via renderUnderlayEntityJsx)
 *
 * Style: stroke #9ca3af (~gray-400), stroke-width 0.2mm, fill none, opacity 0.5.
 * Arc entities use an SVG <path> A command derived from center/radius/angles in degrees.
 */

import type { UnderlayEntity } from '@zilventor/shared';

/**
 * Options for underlayEntityToSvg.
 * yFlipped: when true, the parent group has scale(1,-1); text elements need a counter-flip
 * so their glyphs appear upright (not upside-down). Geometry entities are unaffected.
 */
export type UnderlayEntitySvgOpts = {
  /** When true, apply scale(1,-1) counter-transform on text so it reads correctly. */
  yFlipped?: boolean;
};

/**
 * Convert a UnderlayEntity to an SVG element string.
 * Coordinates are in mm (sheet space — callers apply no further transform).
 *
 * @param entity  The DXF underlay entity to render.
 * @param opts    Optional rendering options (e.g. yFlipped for counter-scale on text).
 */
export function underlayEntityToSvg(entity: UnderlayEntity, opts?: UnderlayEntitySvgOpts): string {
  const style = 'stroke="#9ca3af" stroke-width="0.2" fill="none" opacity="0.5"';

  switch (entity.kind) {
    case 'line':
      return `<line x1="${fmt(entity.x1)}" y1="${fmt(entity.y1)}" x2="${fmt(entity.x2)}" y2="${fmt(entity.y2)}" ${style}/>`;

    case 'polyline': {
      const pts = entity.points.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ');
      if (entity.closed) {
        return `<polygon points="${pts}" ${style}/>`;
      }
      return `<polyline points="${pts}" ${style}/>`;
    }

    case 'circle':
      return `<circle cx="${fmt(entity.cx)}" cy="${fmt(entity.cy)}" r="${fmt(entity.r)}" ${style}/>`;

    case 'arc': {
      const path = arcToPathD(entity.cx, entity.cy, entity.r, entity.startAngle, entity.endAngle);
      return `<path d="${path}" ${style}/>`;
    }

    case 'text': {
      // Counter-flip for text when parent group has scale(1,-1):
      // Without counter-flip, glyphs would appear upside-down.
      // The fix: apply translate(x,y) scale(1,-1) translate(-x,-y) = scale(1,-1) centered at (x,y).
      // This cancels the parent y-flip for the glyph bounding box.
      let transform: string;
      if (opts?.yFlipped) {
        const cx = fmt(entity.x);
        const cy = fmt(entity.y);
        if (entity.rotation !== 0) {
          // Combine counter-flip + rotation: rotate first (DXF rotation is CCW y-up, negate for y-down),
          // then counter-flip at the anchor point.
          transform = ` transform="translate(${cx},${cy}) scale(1,-1) rotate(${fmt(-entity.rotation)}) translate(-${cx},-${cy})"`;
        } else {
          transform = ` transform="translate(${cx},${cy}) scale(1,-1) translate(-${cx},-${cy})"`;
        }
      } else {
        transform = entity.rotation !== 0
          ? ` transform="rotate(${fmt(-entity.rotation)} ${fmt(entity.x)} ${fmt(entity.y)})"`
          : '';
      }
      return `<text x="${fmt(entity.x)}" y="${fmt(entity.y)}" font-size="${fmt(entity.height)}" font-family="sans-serif" stroke="none" fill="#9ca3af" opacity="0.5"${transform}>${escapeText(entity.value)}</text>`;
    }
  }
}

/**
 * Convert center/radius/startAngle/endAngle (degrees) to an SVG arc path `d` attribute.
 * Uses the SVG `A` (elliptical arc) command.
 * In SVG, angles increase clockwise (y-axis down). The DXF arc is CCW in math coords
 * (y-up), which maps to CW in SVG. We render the CCW interpretation in SVG y-down
 * by using sweep-flag=0 (CW in SVG y-down = counter-clockwise in math).
 *
 * Wait — DXF arcs are CCW in world coords (y-up). In SVG (y-down), the same arc appears
 * CW. SVG sweep-flag=1 draws CW in y-down, sweep-flag=0 draws CCW in y-down.
 * We want the arc to look like the DXF arc: CCW in y-up = CW in y-down → sweep-flag=1.
 *
 * large-arc-flag = 1 when sweep > 180°.
 */
export function arcToPathD(
  cx: number, cy: number, r: number,
  startAngleDeg: number, endAngleDeg: number,
): string {
  const toRad = (d: number) => (d * Math.PI) / 180;

  // Normalize to CCW sweep (DXF convention: end is CCW from start)
  let sweep = endAngleDeg - startAngleDeg;
  if (sweep <= 0) sweep += 360;           // ensure positive CCW sweep

  const startRad = toRad(startAngleDeg);
  const endRad   = toRad(endAngleDeg);

  const sx = cx + r * Math.cos(startRad);
  const sy = cy + r * Math.sin(startRad);
  const ex = cx + r * Math.cos(endRad);
  const ey = cy + r * Math.sin(endRad);

  const largeArc = sweep > 180 ? 1 : 0;
  // SVG sweep-flag=1 → CW in y-down = CCW in y-up (DXF convention)
  const sweepFlag = 1;

  return `M ${fmt(sx)} ${fmt(sy)} A ${fmt(r)} ${fmt(r)} 0 ${largeArc} ${sweepFlag} ${fmt(ex)} ${fmt(ey)}`;
}

/** Format a number for SVG attribute output (max 4 decimal places, trailing zeros stripped). */
function fmt(n: number): string {
  // toFixed(4) then strip trailing zeros
  const s = n.toFixed(4).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
