import type { DrawingDocument, DrawingSheet, DrawingView, DrawingAnnotation, DetailView, SectionView } from '@zilventor/shared';
import type { DrawingDimension, DimensionGroup } from '@zilventor/shared';
import type { PartDocument, AssemblyDocument } from '@zilventor/shared';
import type { HoleTableAnnotation } from '@zilventor/shared';
import type { ParamOrLiteral } from '@zilventor/shared';
import type { PointRef } from '@zilventor/shared/src/drawing/types';
import { resolveTitleBlock } from '@zilventor/shared/src/drawing/titleBlock';
import { intersectLines, subtendedAngle, formatAngleDeg } from '@zilventor/shared/src/drawing/dimensionMath';
import { computeHoleTableRows } from '@zilventor/shared/src/drawing/holeTable';

const ISO_SIZES_MM: Record<string, { w: number; h: number }> = {
  A0: { w: 1189, h: 841 },
  A1: { w: 841,  h: 594 },
  A2: { w: 594,  h: 420 },
  A3: { w: 420,  h: 297 },
  A4: { w: 297,  h: 210 },
};

/**
 * Returns standalone SVG markup for a single sheet.
 * The result is a self-contained <svg> string (no external dependencies).
 */
export function renderDrawingSvg(
  drawing: DrawingDocument,
  sheet: DrawingSheet,
  source: PartDocument | AssemblyDocument,
): string {
  const sheetW = getSheetWidthMm(sheet);
  const sheetH = getSheetHeightMm(sheet);
  const titleH = 20;

  const titleBlock = resolveTitleBlock(
    drawing,
    sheet,
    source,
    drawing.sheets.indexOf(sheet),
    drawing.sheets.length,
    '',
  );

  const viewGroups = sheet.views.map((v) => renderViewGroup(v)).join('\n');
  const calloutGroups = renderDetailCalloutGroups(sheet.views);
  const steppedSectionLineGroups = renderSteppedSectionLines(sheet.views);
  const dimGroups = sheet.dimensions.map((d) => renderDimensionGroup(d, sheet.views, sheet.dimensionGroups)).join('\n');
  const annGroups = sheet.annotations
    .map((a) => renderAnnotationGroup(a, sheet, source))
    .join('\n');
  const titleBlockSvg = renderTitleBlockSvg(
    {
      drawingName: titleBlock.drawingName,
      partName: titleBlock.partName,
      scaleText: titleBlock.scaleText,
      material: titleBlock.material,
      date: titleBlock.date,
      drawnBy: titleBlock.drawnBy,
      revision: titleBlock.revision,
      sheetCurrent: titleBlock.sheetNumber.current,
      sheetTotal: titleBlock.sheetNumber.total,
    },
    sheetW,
    sheetH,
    titleH,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 ${sheetW} ${sheetH}"
  width="${sheetW}mm"
  height="${sheetH}mm"
  preserveAspectRatio="xMidYMid meet"
  data-sheet-id="${escapeAttr(sheet.id)}">
  <rect x="10" y="10" width="${sheetW - 20}" height="${sheetH - 20 - titleH}"
    fill="white" stroke="#000" stroke-width="0.5"/>
${viewGroups}
${calloutGroups}
${steppedSectionLineGroups}
${dimGroups}
${annGroups}
${titleBlockSvg}
</svg>`;
}

/**
 * Drawing F1.2 — emit a <polyline data-role="stepped-section-line"> on the parent view
 * for every SectionView with mode === 'stepped'. The stepSegments are in the parent
 * view's local mm space; we transform them to sheet space using the parent view's
 * positionMm + scale (same convention as SectionLineOverlay.tsx live React canvas).
 *
 * TODO(F1.x): full/half section-line emission in renderDrawingSvg (out of scope for F1.2 —
 * the export path currently emits NO section-line decoration for full/half views; only
 * the hatched cut compound. The stepped branch added here is the first parent-view
 * section-line emission in the export pipeline.)
 */
function renderSteppedSectionLines(views: readonly DrawingView[]): string {
  const out: string[] = [];
  for (const view of views) {
    if (view.kind !== 'section') continue;
    const sv = view as SectionView;
    if (sv.mode !== 'stepped' || !sv.stepSegments || sv.stepSegments.length < 2) continue;
    const parent = views.find((v) => v.id === sv.parentViewId);
    if (!parent) continue;
    if (parent.kind !== 'base' && parent.kind !== 'projected') continue;

    const ox = parent.positionMm.x;
    const oy = parent.positionMm.y;
    const scale = parent.scale.numerator / parent.scale.denominator;
    const verts = [
      sv.stepSegments[0]!.startSheet,
      ...sv.stepSegments.map((s) => s.endSheet),
    ];
    const sheetVerts = verts.map((v) => ({ x: ox + v.x * scale, y: oy + v.y * scale }));
    const pointsAttr = sheetVerts.map((v) => `${v.x.toFixed(3)},${v.y.toFixed(3)}`).join(' ');

    // Arrow normals (mirror SectionLineOverlay.tsx logic).
    const first = sheetVerts[0]!;
    const second = sheetVerts[1]!;
    const last = sheetVerts[sheetVerts.length - 1]!;
    const penult = sheetVerts[sheetVerts.length - 2]!;
    const arrowDirection = sv.arrowDirection;

    const fdx = second.x - first.x;
    const fdy = second.y - first.y;
    const flen = Math.sqrt(fdx * fdx + fdy * fdy) || 1;
    const fnx = (-fdy / flen) * arrowDirection;
    const fny = ( fdx / flen) * arrowDirection;

    const ldx = last.x - penult.x;
    const ldy = last.y - penult.y;
    const llen = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
    const lnx = (-ldy / llen) * arrowDirection;
    const lny = ( ldx / llen) * arrowDirection;

    const ARROW_LEN = 3;
    const LABEL_OFFSET = 5;
    const tip0 = { x: first.x + fnx * ARROW_LEN, y: first.y + fny * ARROW_LEN };
    const tipN = { x: last.x + lnx * ARROW_LEN,  y: last.y + lny * ARROW_LEN };
    const lab0 = { x: tip0.x + fnx * LABEL_OFFSET, y: tip0.y + fny * LABEL_OFFSET };
    const labN = { x: tipN.x + lnx * LABEL_OFFSET, y: tipN.y + lny * LABEL_OFFSET };

    out.push(
      `  <g data-section-overlay="${escapeAttr(sv.id)}" data-mode="stepped">` +
      `\n    <polyline points="${pointsAttr}" fill="none" stroke="#000" stroke-width="0.7" stroke-dasharray="6 1.5 1.5 1.5" data-role="stepped-section-line" data-view-id="${escapeAttr(sv.id)}"/>` +
      `\n    <circle cx="${tip0.x.toFixed(3)}" cy="${tip0.y.toFixed(3)}" r="0.8" fill="#000" stroke="none" data-role="arrowhead" data-terminus="V0"/>` +
      `\n    <circle cx="${tipN.x.toFixed(3)}" cy="${tipN.y.toFixed(3)}" r="0.8" fill="#000" stroke="none" data-role="arrowhead" data-terminus="Vlast"/>` +
      `\n    <text x="${lab0.x.toFixed(3)}" y="${lab0.y.toFixed(3)}" font-size="5" font-family="sans-serif" text-anchor="middle" dominant-baseline="central">${escapeText(sv.label)}</text>` +
      `\n    <text x="${labN.x.toFixed(3)}" y="${labN.y.toFixed(3)}" font-size="5" font-family="sans-serif" text-anchor="middle" dominant-baseline="central">${escapeText(sv.label)}</text>` +
      `\n  </g>`,
    );
  }
  return out.join('\n');
}

function renderViewGroup(view: DrawingView): string {
  const vScale = view.scale.numerator / view.scale.denominator;
  const { projection } = view;

  const visibleLines = projection
    ? projection.visibleEdges.map((e) =>
        renderPolyline(
          e.points,
          'stroke="#000" stroke-width="0.35" fill="none"',
          `data-edge-id="${escapeAttr(e.id)}" data-view-id="${escapeAttr(view.id)}"`,
        )
      ).join('\n    ')
    : '<!-- no projection -->';

  const hiddenLines = projection
    ? projection.hiddenEdges.map((e) =>
        renderPolyline(
          e.points,
          'stroke="#555" stroke-width="0.18" stroke-dasharray="2 1" fill="none"',
          `data-edge-id="${escapeAttr(e.id)}" data-view-id="${escapeAttr(view.id)}" data-hidden="true"`,
        )
      ).join('\n    ')
    : '';

  const staleMarker = view.inputFingerprint == null
    ? `<text x="0" y="-2" font-size="3" fill="red" data-stale-marker="${escapeAttr(view.id)}">&#x26A0; Source changed</text>`
    : '';

  // Detail-specific: border circle + caption.
  let detailMarkup = '';
  if (view.kind === 'detail') {
    const dv = view as DetailView;
    // TODO(batch-5): add rect branch; for now circle arm only
    const borderR = dv.regionParent.kind === 'circle' ? dv.regionParent.radiusMm : 0;
    detailMarkup += `\n    <circle cx="0" cy="0" r="${borderR}" fill="none" stroke="#000" stroke-width="0.35" data-role="detail-border" data-view-id="${escapeAttr(dv.id)}"/>`;
    if (projection) {
      const captionX = (projection.bbox.minX + projection.bbox.maxX) / 2;
      const captionY = projection.bbox.maxY + 5;
      detailMarkup += `\n    <text x="${captionX}" y="${captionY}" font-size="4" font-family="sans-serif" text-anchor="middle" data-role="detail-caption" data-view-id="${escapeAttr(dv.id)}">DETAIL ${escapeText(dv.label)}<tspan x="${captionX}" dy="5" font-size="3.5">${dv.scale.numerator}:${dv.scale.denominator}</tspan></text>`;
    }
  }

  return `  <g transform="translate(${view.positionMm.x},${view.positionMm.y}) scale(${vScale})"
     data-view-id="${escapeAttr(view.id)}" data-view-kind="${view.kind}">
    ${staleMarker}
    ${visibleLines}
    ${hiddenLines}${detailMarkup}
  </g>`;
}

function renderDetailCalloutGroups(views: readonly DrawingView[]): string {
  const groups: string[] = [];
  for (const view of views) {
    if (view.kind !== 'detail') continue;
    const dv = view as DetailView;
    const parent = views.find((v) => v.id === dv.parentViewId);
    if (!parent) continue;
    const parentScale = parent.scale.numerator / parent.scale.denominator;
    const cx = parent.positionMm.x + dv.regionParent.center.x * parentScale;
    const cy = parent.positionMm.y + dv.regionParent.center.y * parentScale;
    // TODO(batch-5): add rect branch; for now circle arm only
    const r = (dv.regionParent.kind === 'circle' ? dv.regionParent.radiusMm : 0) * parentScale;
    const COS45 = Math.SQRT1_2;
    const labelX = cx + (r + 5) * COS45;
    const labelY = cy - (r + 5) * COS45;
    groups.push(
      `  <g data-detail-callout="${escapeAttr(dv.id)}">` +
      `\n    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#000" stroke-width="0.35" data-role="detail-callout-label" data-detail-id="${escapeAttr(dv.id)}"/>` +
      `\n    <text x="${labelX}" y="${labelY}" font-size="5" font-family="sans-serif" text-anchor="start" data-role="detail-callout-label" data-detail-id="${escapeAttr(dv.id)}">${escapeText(dv.label)}</text>` +
      `\n  </g>`,
    );
  }
  return groups.join('\n');
}

function renderPolyline(
  points: ReadonlyArray<readonly [number, number]>,
  style: string,
  attrs: string,
): string {
  if (points.length < 2) return '';
  const pts = points.map(([x, y]) => `${x},${y}`).join(' ');
  return `<polyline points="${pts}" ${style} ${attrs}/>`;
}

function renderDimensionGroup(
  dim: DrawingDimension,
  views: readonly DrawingView[],
  dimensionGroups: readonly DimensionGroup[],
): string {
  const view = views.find((v) => v.id === dim.viewId);

  if (dim.kind === 'linear-h' || dim.kind === 'linear-v' || dim.kind === 'aligned') {
    if (!view?.projection) return '';
    const p1 = resolvePointRef(dim.from, view.projection);
    const p2 = resolvePointRef(dim.to, view.projection);
    if (!p1 || !p2) return '';

    const vScale = view.scale.numerator / view.scale.denominator;
    const vx = view.positionMm.x;
    const vy = view.positionMm.y;
    const x1 = vx + p1[0] * vScale;
    const y1 = vy + p1[1] * vScale;
    const x2 = vx + p2[0] * vScale;
    const y2 = vy + p2[1] * vScale;
    const offset = dim.offsetMm;
    const distMm = Math.round(Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2));
    const midX = (x1 + x2) / 2;

    if (dim.kind === 'linear-h') {
      return `  <g data-dim-id="${escapeAttr(dim.id)}" data-dim-kind="linear-h" stroke="#00c" stroke-width="0.2" fill="none">
      <line x1="${x1}" y1="${y1 - offset}" x2="${x2}" y2="${y1 - offset}"/>
      <line x1="${x1}" y1="${y1}" x2="${x1}" y2="${y1 - offset}"/>
      <line x1="${x2}" y1="${y2}" x2="${x2}" y2="${y1 - offset}"/>
      <text x="${midX}" y="${y1 - offset - 1}" font-size="3.5" text-anchor="middle" fill="#00c" stroke="none">${distMm}</text>
    </g>`;
    } else {
      return `  <g data-dim-id="${escapeAttr(dim.id)}" data-dim-kind="${dim.kind}" stroke="#00c" stroke-width="0.2" fill="none">
      <line x1="${x1 + offset}" y1="${y1}" x2="${x1 + offset}" y2="${y2}"/>
      <line x1="${x1}" y1="${y1}" x2="${x1 + offset}" y2="${y1}"/>
      <line x1="${x2}" y1="${y2}" x2="${x1 + offset}" y2="${y2}"/>
      <text x="${x1 + offset + 1}" y="${(y1 + y2) / 2}" font-size="3.5" fill="#00c" stroke="none">${distMm}</text>
    </g>`;
    }
  }

  if (dim.kind === 'baseline') {
    const group = dimensionGroups.find((g) => g.id === dim.groupId);
    if (!group || group.kind !== 'baseline') return '';
    if (!view?.projection) return '';

    const datumPt = resolvePointRef(group.datum, view.projection);
    const toPt    = resolvePointRef(dim.to, view.projection);
    if (!datumPt || !toPt) return '';

    const vScale = view.scale.numerator / view.scale.denominator;
    const vx = view.positionMm.x;
    const vy = view.positionMm.y;

    const dx = vx + datumPt[0] * vScale;
    const dy = vy + datumPt[1] * vScale;
    const tx = vx + toPt[0] * vScale;
    const ty = vy + toPt[1] * vScale;

    const offset = group.baseOffsetMm + dim.slot * group.spacingMm;
    const midX = (dx + tx) / 2;

    if (group.direction === 'h') {
      const dimY = dy - offset;
      const distMm = Math.round(Math.abs(toPt[0] - datumPt[0]));
      return `  <g data-dim-id="${escapeAttr(dim.id)}" data-dim-kind="baseline" data-group-id="${escapeAttr(dim.groupId)}" data-slot="${dim.slot}" stroke="#00c" stroke-width="0.2" fill="none">
      <line x1="${dx}" y1="${dimY}" x2="${tx}" y2="${dimY}"/>
      <line x1="${dx}" y1="${dy}" x2="${dx}" y2="${dimY}"/>
      <line x1="${tx}" y1="${ty}" x2="${tx}" y2="${dimY}"/>
      <text x="${midX}" y="${dimY - 1}" font-size="3.5" text-anchor="middle" fill="#00c" stroke="none">${distMm}</text>
    </g>`;
    } else {
      const dimX = dx + offset;
      const midY = (dy + ty) / 2;
      const distMm = Math.round(Math.abs(toPt[1] - datumPt[1]));
      return `  <g data-dim-id="${escapeAttr(dim.id)}" data-dim-kind="baseline" data-group-id="${escapeAttr(dim.groupId)}" data-slot="${dim.slot}" stroke="#00c" stroke-width="0.2" fill="none">
      <line x1="${dimX}" y1="${dy}" x2="${dimX}" y2="${ty}"/>
      <line x1="${dx}" y1="${dy}" x2="${dimX}" y2="${dy}"/>
      <line x1="${tx}" y1="${ty}" x2="${dimX}" y2="${ty}"/>
      <text x="${dimX + 1}" y="${midY}" font-size="3.5" fill="#00c" stroke="none">${distMm}</text>
    </g>`;
    }
  }

  if (dim.kind === 'ordinate') {
    const group = dimensionGroups.find((g) => g.id === dim.groupId);
    if (!group || group.kind !== 'ordinate') return '';
    if (!view?.projection) return '';

    const originPt = resolvePointRef(group.origin, view.projection);
    const toPt     = resolvePointRef(dim.to, view.projection);
    if (!originPt || !toPt) return '';

    const vScale = view.scale.numerator / view.scale.denominator;
    const vx = view.positionMm.x;
    const vy = view.positionMm.y;

    const ox = vx + originPt[0] * vScale;
    const oy = vy + originPt[1] * vScale;
    const tx = vx + toPt[0] * vScale;
    const ty = vy + toPt[1] * vScale;

    let leg1x1: number, leg1y1: number, leg1x2: number, leg1y2: number;
    let leg2x1: number, leg2y1: number, leg2x2: number, leg2y2: number;
    let textX: number, textY: number;
    let delta: number;

    if (dim.axis === 'x') {
      // Vertical leg: from feature point up/down to column line Y
      const colY = oy + group.xColumnOffsetMm;
      leg1x1 = tx; leg1y1 = ty; leg1x2 = tx; leg1y2 = colY;
      // Horizontal leg: from elbow to text position
      leg2x1 = tx; leg2y1 = colY; leg2x2 = ox; leg2y2 = colY;
      textX = ox - 1; textY = colY - 1;
      delta = toPt[0] - originPt[0];
    } else {
      // Horizontal leg: from feature point left/right to column line X
      const colX = ox + group.yColumnOffsetMm;
      leg1x1 = tx; leg1y1 = ty; leg1x2 = colX; leg1y2 = ty;
      // Vertical leg: from elbow to text position
      leg2x1 = colX; leg2y1 = ty; leg2x2 = colX; leg2y2 = oy;
      textX = colX + 1; textY = oy - 1;
      delta = toPt[1] - originPt[1];
    }

    const label = `${Math.abs(delta).toFixed(2)}`;
    return `  <g data-dim-id="${escapeAttr(dim.id)}" data-dim-kind="ordinate" data-group-id="${escapeAttr(dim.groupId)}" data-axis="${dim.axis}" stroke="#00c" stroke-width="0.2" fill="none">
      <line x1="${leg1x1}" y1="${leg1y1}" x2="${leg1x2}" y2="${leg1y2}"/>
      <line x1="${leg2x1}" y1="${leg2y1}" x2="${leg2x2}" y2="${leg2y2}"/>
      <text x="${textX}" y="${textY}" font-size="3.5" fill="#00c" stroke="none">${label}</text>
    </g>`;
  }

  if (dim.kind === 'angular') {
    if (!view?.projection) return '';

    const vScale = view.scale.numerator / view.scale.denominator;
    const vx = view.positionMm.x;
    const vy = view.positionMm.y;
    const ref = dim.ref;

    if (ref.kind === 'arc') {
      // Arc edge: sweep angle of the arc itself
      const arcEdge = view.projection.visibleEdges.find((e) => e.id === ref.edge.edgeId)
        ?? view.projection.hiddenEdges.find((e) => e.id === ref.edge.edgeId);
      if (!arcEdge || arcEdge.points.length < 3) return '';

      // Estimate arc center, radius, start/end angles from first, mid, last polyline points
      const pts = arcEdge.points;
      const pStart = pts[0]!;
      const pEnd   = pts[pts.length - 1]!;
      const pMid   = pts[Math.floor(pts.length / 2)]!;

      // Arc center via circumcircle of 3 points
      const cx_arc = circumcenterX(pStart, pMid, pEnd);
      const cy_arc = circumcenterY(pStart, pMid, pEnd);
      const r_arc = Math.sqrt((pStart[0] - cx_arc) ** 2 + (pStart[1] - cy_arc) ** 2);

      const startAngle = Math.atan2(pStart[1] - cy_arc, pStart[0] - cx_arc);
      const endAngle   = Math.atan2(pEnd[1]   - cy_arc, pEnd[0]   - cx_arc);

      const arcR = r_arc + dim.offsetMm;  // outward from edge
      // insideSweepRad is the CCW sweep from startAngle to endAngle
      const insideSweepRad = normalizeAngle(endAngle - startAngle);
      // When arcSide=outside, we draw the complementary arc (the long way around)
      const isOutside = dim.arcSide === 'outside';
      const sweepRad = isOutside ? 2 * Math.PI - insideSweepRad : insideSweepRad;

      const asx = vx + (cx_arc + arcR * Math.cos(startAngle)) * vScale;
      const asy = vy + (cy_arc + arcR * Math.sin(startAngle)) * vScale;
      const aex = vx + (cx_arc + arcR * Math.cos(endAngle)) * vScale;
      const aey = vy + (cy_arc + arcR * Math.sin(endAngle)) * vScale;
      // largeArc=1 when the rendered sweep exceeds π
      const largeArc = sweepRad > Math.PI ? 1 : 0;
      // sweepFlag=1 draws CCW in SVG y-down coords (positive angle direction).
      // inside arc = CCW from start to end → sweepFlag=1.
      // outside arc = CW from start to end (going the long way backwards) → sweepFlag=0.
      const sweepFlag = isOutside ? 0 : 1;
      const arcRScaled = arcR * vScale;

      // Text position at midpoint of the drawn arc
      const midAngle = isOutside
        ? startAngle - (2 * Math.PI - insideSweepRad) / 2  // go CW by half of outside sweep
        : startAngle + insideSweepRad / 2;
      const textX = vx + (cx_arc + (arcR + 1.5) * Math.cos(midAngle)) * vScale;
      const textY = vy + (cy_arc + (arcR + 1.5) * Math.sin(midAngle)) * vScale;
      const label = formatAngleDeg(sweepRad);

      return `  <g data-dim-id="${escapeAttr(dim.id)}" data-dim-kind="angular" data-arc-side="${dim.arcSide}" stroke="#00c" stroke-width="0.2" fill="none">
      <path d="M ${asx} ${asy} A ${arcRScaled} ${arcRScaled} 0 ${largeArc} ${sweepFlag} ${aex} ${aey}"/>
      <text x="${textX}" y="${textY}" font-size="3.5" text-anchor="middle" fill="#00c" stroke="none">${label}</text>
    </g>`;
    }

    // two-edges case
    const edge1 = view.projection.visibleEdges.find((e) => e.id === ref.edge1.edgeId)
      ?? view.projection.hiddenEdges.find((e) => e.id === ref.edge1.edgeId);
    const edge2 = view.projection.visibleEdges.find((e) => e.id === ref.edge2.edgeId)
      ?? view.projection.hiddenEdges.find((e) => e.id === ref.edge2.edgeId);
    if (!edge1 || !edge2 || edge1.points.length < 2 || edge2.points.length < 2) return '';

    const e1p0 = { x: edge1.points[0]![0], y: edge1.points[0]![1] };
    const e1p1 = { x: edge1.points[edge1.points.length - 1]![0], y: edge1.points[edge1.points.length - 1]![1] };
    const e2p0 = { x: edge2.points[0]![0], y: edge2.points[0]![1] };
    const e2p1 = { x: edge2.points[edge2.points.length - 1]![0], y: edge2.points[edge2.points.length - 1]![1] };

    const apex = intersectLines({ p0: e1p0, p1: e1p1 }, { p0: e2p0, p1: e2p1 });

    if (!apex) {
      // Parallel edges fallback: text "—" at midpoint of bounding box
      const midX = vx + ((e1p0.x + e1p1.x + e2p0.x + e2p1.x) / 4) * vScale;
      const midY = vy + ((e1p0.y + e1p1.y + e2p0.y + e2p1.y) / 4) * vScale;
      return `  <g data-dim-id="${escapeAttr(dim.id)}" data-dim-kind="angular" data-arc-side="${dim.arcSide}" stroke="#00c" stroke-width="0.2" fill="none">
      <text x="${midX}" y="${midY}" font-size="3.5" text-anchor="middle" fill="#00c" stroke="none">—</text>
    </g>`;
    }

    // Direction vectors from apex toward each edge's far endpoint.
    // We must pick the endpoint that is NOT the apex (or farthest from it),
    // otherwise a reversed edge would give a zero-length direction vector.
    // Pick the endpoint of each edge that is farther from the apex.
    const e1FarPt = distSq(e1p0, apex) >= distSq(e1p1, apex) ? e1p0 : e1p1;
    const e2FarPt = distSq(e2p0, apex) >= distSq(e2p1, apex) ? e2p0 : e2p1;
    const d1 = unitVec({ x: e1FarPt.x - apex.x, y: e1FarPt.y - apex.y });
    const d2 = unitVec({ x: e2FarPt.x - apex.x, y: e2FarPt.y - apex.y });

    const { insideRad, outsideRad } = subtendedAngle(d1, d2);
    const sweepRad = dim.arcSide === 'inside' ? insideRad : outsideRad;
    const label = formatAngleDeg(sweepRad);

    const startAngle = Math.atan2(d1.y, d1.x);
    const endAngle   = Math.atan2(d2.y, d2.x);
    const arcR = dim.offsetMm;
    const arcRScaled = arcR * vScale;

    const apexSvgX = vx + apex.x * vScale;
    const apexSvgY = vy + apex.y * vScale;

    const asx = apexSvgX + arcRScaled * Math.cos(startAngle);
    const asy = apexSvgY + arcRScaled * Math.sin(startAngle);
    const aex = apexSvgX + arcRScaled * Math.cos(endAngle);
    const aey = apexSvgY + arcRScaled * Math.sin(endAngle);

    const largeArc = sweepRad > Math.PI ? 1 : 0;
    // Compute the signed cross product of d1 × d2 in screen y-down coordinates.
    // cross > 0 means d2 is CW from d1 (clockwise rotation in y-down space).
    // cross < 0 means d2 is CCW from d1.
    //
    // SVG sweepFlag=1 draws the arc in the positive-angle (CCW in y-down) direction.
    // For arcSide='inside':
    //   cross > 0 → d2 is CW from d1 → the "inside" (smaller) arc from d1→d2 goes CW → sweepFlag=1
    //   cross < 0 → d2 is CCW from d1 → the "inside" arc goes CCW → sweepFlag=0
    // arcSide='outside' flips the bit.
    const cross = d1.x * d2.y - d1.y * d2.x;
    const sweepFlag = dim.arcSide === 'inside'
      ? (cross > 0 ? 1 : 0)
      : (cross > 0 ? 0 : 1);

    const midAngle = startAngle + (dim.arcSide === 'inside' ? insideRad : outsideRad) / 2;
    const textR = arcR + 1.5;
    const textX = apexSvgX + textR * vScale * Math.cos(midAngle);
    const textY = apexSvgY + textR * vScale * Math.sin(midAngle);

    return `  <g data-dim-id="${escapeAttr(dim.id)}" data-dim-kind="angular" data-arc-side="${dim.arcSide}" stroke="#00c" stroke-width="0.2" fill="none">
      <path d="M ${asx} ${asy} A ${arcRScaled} ${arcRScaled} 0 ${largeArc} ${sweepFlag} ${aex} ${aey}"/>
      <text x="${textX}" y="${textY}" font-size="3.5" text-anchor="middle" fill="#00c" stroke="none">${label}</text>
    </g>`;
  }

  return '';
}

function distSq(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function unitVec(v: { x: number; y: number }): { x: number; y: number } {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len < 1e-12) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function normalizeAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r < 0) r += 2 * Math.PI;
  return r;
}

function circumcenterX(
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
): number {
  const ax = p0[0], ay = p0[1];
  const bx = p1[0], by = p1[1];
  const cx = p2[0], cy = p2[1];
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < 1e-12) return (ax + bx + cx) / 3;
  return ((ax*ax + ay*ay) * (by - cy) + (bx*bx + by*by) * (cy - ay) + (cx*cx + cy*cy) * (ay - by)) / D;
}

function circumcenterY(
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
): number {
  const ax = p0[0], ay = p0[1];
  const bx = p1[0], by = p1[1];
  const cx = p2[0], cy = p2[1];
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < 1e-12) return (ay + by + cy) / 3;
  return ((ax*ax + ay*ay) * (cx - bx) + (bx*bx + by*by) * (ax - cx) + (cx*cx + cy*cy) * (bx - ax)) / D;
}

// ---------------------------------------------------------------------------
// Drawing F6 — Hole Table annotation renderer (both render paths share computeHoleTableRows)
// ---------------------------------------------------------------------------

// Layout constants — mirrors HoleTableElement.tsx
const HT_COL_TAG_W   = 12;
const HT_COL_X_W     = 18;
const HT_COL_Y_W     = 18;
const HT_COL_DESC_W  = 45;
const HT_ROW_H       = 6;
const HT_BALLOON_R   = 3;
const HT_FONT_SIZE   = 3.5;
const HT_LEADER_COLOR = '#333';
const HT_GRID_COLOR   = '#222';
const HT_TABLE_W = HT_COL_TAG_W + HT_COL_X_W + HT_COL_Y_W + HT_COL_DESC_W;

function renderHoleTableAnnotation(
  ann: HoleTableAnnotation,
  sheet: DrawingSheet,
  source: PartDocument | AssemblyDocument,
): string {
  // Only PartDocument has featureTree; AssemblyDocument has `components` instead.
  // NOTE: neither document has a `kind` discriminant (verified packages/shared/src/types.ts:67,94),
  // so distinguish structurally via `'featureTree' in source`. Hole tables only apply to part drawings.
  const part = 'featureTree' in source ? (source as PartDocument) : null;
  if (!part) return '';

  const resolveParam = (p: ParamOrLiteral): number =>
    p.kind === 'literal'
      ? p.value
      : (part.parameters[p.paramName]?.value ?? 0);

  const view = sheet.views.find((v) => v.id === ann.viewId);
  if (!view) return '';

  // computeHoleTableRows is imported at the top of this file (NOT inline — see reconciliation note 4)
  const rows = computeHoleTableRows(ann, view, part, resolveParam);
  if (rows.length === 0) return '';

  const { x: tx, y: ty } = ann.positionMm;
  const xTag  = tx;
  const xX    = tx + HT_COL_TAG_W;
  const xY    = tx + HT_COL_TAG_W + HT_COL_X_W;
  const xDesc = tx + HT_COL_TAG_W + HT_COL_X_W + HT_COL_Y_W;

  const rowCount = rows.length + 1;
  const tableH   = rowCount * HT_ROW_H;

  // Build grid lines
  const gridParts: string[] = [];
  gridParts.push(`    <rect x="${tx}" y="${ty}" width="${HT_TABLE_W}" height="${tableH}" fill="white" stroke="${HT_GRID_COLOR}" stroke-width="0.3"/>`);
  // Header divider
  gridParts.push(`    <line x1="${tx}" y1="${ty + HT_ROW_H}" x2="${tx + HT_TABLE_W}" y2="${ty + HT_ROW_H}" stroke="${HT_GRID_COLOR}" stroke-width="0.3"/>`);
  // Row dividers
  for (let i = 1; i < rows.length; i++) {
    gridParts.push(`    <line x1="${tx}" y1="${ty + HT_ROW_H * (i + 1)}" x2="${tx + HT_TABLE_W}" y2="${ty + HT_ROW_H * (i + 1)}" stroke="${HT_GRID_COLOR}" stroke-width="0.15"/>`);
  }
  // Column dividers
  [xX, xY, xDesc].forEach((colX) => {
    gridParts.push(`    <line x1="${colX}" y1="${ty}" x2="${colX}" y2="${ty + tableH}" stroke="${HT_GRID_COLOR}" stroke-width="0.2"/>`);
  });

  // Header texts
  const textY0 = ty + HT_ROW_H * 0.65;
  gridParts.push(`    <text x="${xTag + 1}" y="${textY0}" font-size="${HT_FONT_SIZE}" fill="${HT_GRID_COLOR}" font-weight="bold">TAG</text>`);
  gridParts.push(`    <text x="${xX + 1}" y="${textY0}" font-size="${HT_FONT_SIZE}" fill="${HT_GRID_COLOR}" font-weight="bold">XDIM</text>`);
  gridParts.push(`    <text x="${xY + 1}" y="${textY0}" font-size="${HT_FONT_SIZE}" fill="${HT_GRID_COLOR}" font-weight="bold">YDIM</text>`);
  gridParts.push(`    <text x="${xDesc + 1}" y="${textY0}" font-size="${HT_FONT_SIZE}" fill="${HT_GRID_COLOR}" font-weight="bold">DESCRIPTION</text>`);

  // Data rows
  rows.forEach((row, i) => {
    const rowY = ty + HT_ROW_H * (i + 1);
    const cellY = rowY + HT_ROW_H * 0.65;
    gridParts.push(`    <text x="${xTag + 1}" y="${cellY}" font-size="${HT_FONT_SIZE}" fill="${HT_GRID_COLOR}">${escapeText(row.tag)}</text>`);
    gridParts.push(`    <text x="${xX + 1}" y="${cellY}" font-size="${HT_FONT_SIZE}" fill="${HT_GRID_COLOR}">${escapeText((Math.round(row.xDim * 10) / 10).toFixed(1))}</text>`);
    gridParts.push(`    <text x="${xY + 1}" y="${cellY}" font-size="${HT_FONT_SIZE}" fill="${HT_GRID_COLOR}">${escapeText((Math.round(row.yDim * 10) / 10).toFixed(1))}</text>`);
    gridParts.push(`    <text x="${xDesc + 1}" y="${cellY}" font-size="${HT_FONT_SIZE}" fill="${HT_GRID_COLOR}">${escapeText(row.description)}</text>`);
  });

  // Per-hole balloons + leaders
  const BALLOON_OFFSET_Y = -8;
  rows.forEach((row) => {
    const bx = row.markerCenterSheetMm.x;
    const by = row.markerCenterSheetMm.y + BALLOON_OFFSET_Y;
    // Leader
    gridParts.push(`    <line data-role="hole-leader" x1="${bx}" y1="${by + HT_BALLOON_R}" x2="${row.markerCenterSheetMm.x}" y2="${row.markerCenterSheetMm.y}" stroke="${HT_LEADER_COLOR}" stroke-width="0.25"/>`);
    // Balloon
    gridParts.push(`    <circle data-role="hole-balloon" cx="${bx}" cy="${by}" r="${HT_BALLOON_R}" fill="white" stroke="${HT_LEADER_COLOR}" stroke-width="0.3"/>`);
    gridParts.push(`    <text x="${bx}" y="${by + 1.2}" font-size="${HT_FONT_SIZE - 0.5}" text-anchor="middle" fill="${HT_LEADER_COLOR}">${escapeText(row.tag)}</text>`);
  });

  return `  <g data-ann-id="${escapeAttr(ann.id)}" data-ann-kind="holeTable">\n${gridParts.join('\n')}\n  </g>`;
}

function renderAnnotationGroup(
  ann: DrawingAnnotation,
  sheet: DrawingSheet,
  source: PartDocument | AssemblyDocument,
): string {
  if (ann.kind === 'holeTable') {
    return renderHoleTableAnnotation(ann, sheet, source);
  }
  if (ann.kind === 'balloon') {
    const r = 4;
    return `  <g data-ann-id="${escapeAttr(ann.id)}" data-ann-kind="balloon">
    <circle cx="${ann.textPosMm.x}" cy="${ann.textPosMm.y}" r="${r}" fill="white" stroke="#000" stroke-width="0.3"/>
    <text x="${ann.textPosMm.x}" y="${ann.textPosMm.y + 1.2}" font-size="3" text-anchor="middle" dominant-baseline="middle">${ann.itemNumber}</text>
    <line x1="${ann.targetMm.x}" y1="${ann.targetMm.y}" x2="${ann.textPosMm.x}" y2="${ann.textPosMm.y + r}" stroke="#000" stroke-width="0.3"/>
  </g>`;
  }
  if (ann.kind === 'leader') {
    return `  <g data-ann-id="${escapeAttr(ann.id)}" data-ann-kind="leader">
    <line x1="${ann.targetMm.x}" y1="${ann.targetMm.y}" x2="${ann.textPosMm.x}" y2="${ann.textPosMm.y}" stroke="#000" stroke-width="0.3"/>
    <text x="${ann.textPosMm.x}" y="${ann.textPosMm.y}" font-size="3">${escapeText(ann.text)}</text>
  </g>`;
  }
  if (ann.kind === 'centerline' || ann.kind === 'center-mark') {
    return `  <g data-ann-id="${escapeAttr(ann.id)}" data-ann-kind="${ann.kind}">
    <!-- centerline / center-mark geometry rendered by DrawingCanvas from projection data -->
  </g>`;
  }
  return '';
}

interface TitleBlockFields {
  drawingName: string;
  partName: string;
  scaleText: string;
  material: string;
  date: string;
  drawnBy: string;
  revision: string;
  sheetCurrent: number;
  sheetTotal: number;
}

function renderTitleBlockSvg(
  fields: TitleBlockFields,
  sheetW: number,
  sheetH: number,
  titleH: number,
): string {
  const x = 10;
  const y = sheetH - 10 - titleH;
  const w = sheetW - 20;
  return `  <g data-title-block="true">
    <rect x="${x}" y="${y}" width="${w}" height="${titleH}" fill="white" stroke="#000" stroke-width="0.3"/>
    <line x1="${x + w / 2}" y1="${y}" x2="${x + w / 2}" y2="${y + titleH}" stroke="#000" stroke-width="0.2"/>
    <text x="${x + 2}" y="${y + 4}"  font-size="2.5" fill="#333">Drawing: ${escapeText(fields.drawingName)}</text>
    <text x="${x + 2}" y="${y + 8}"  font-size="2.5" fill="#333">Part: ${escapeText(fields.partName)}</text>
    <text x="${x + 2}" y="${y + 12}" font-size="2.5" fill="#333">Scale: ${escapeText(fields.scaleText)}</text>
    <text x="${x + 2}" y="${y + 16}" font-size="2.5" fill="#333">Material: ${escapeText(fields.material)}</text>
    <text x="${x + w / 2 + 2}" y="${y + 4}"  font-size="2.5" fill="#333">Date: ${escapeText(fields.date)}</text>
    <text x="${x + w / 2 + 2}" y="${y + 8}"  font-size="2.5" fill="#333">Drawn by: ${escapeText(fields.drawnBy)}</text>
    <text x="${x + w / 2 + 2}" y="${y + 12}" font-size="2.5" fill="#333">Revision: ${escapeText(fields.revision)}</text>
    <text x="${x + w / 2 + 2}" y="${y + 16}" font-size="2.5" fill="#333">Sheet: ${fields.sheetCurrent}/${fields.sheetTotal}</text>
  </g>`;
}

function resolvePointRef(
  ref: PointRef,
  projection: NonNullable<DrawingView['projection']>,
): readonly [number, number] | null {
  const r = ref as { kind: string; edgeId?: string; end?: string };
  const edge = projection.visibleEdges.find((e) => e.id === r.edgeId)
    ?? projection.hiddenEdges.find((e) => e.id === r.edgeId);
  if (!edge || edge.points.length === 0) return null;
  if (r.end === 'end') return (edge.points[edge.points.length - 1] as readonly [number, number]);
  if (r.kind === 'edge-midpoint') return (edge.points[Math.floor(edge.points.length / 2)] as readonly [number, number]);
  return (edge.points[0] as readonly [number, number]);
}

function getSheetWidthMm(sheet: DrawingSheet): number {
  if (sheet.size.kind === 'custom') {
    return sheet.orientation === 'landscape'
      ? Math.max(sheet.size.widthMm, sheet.size.heightMm)
      : Math.min(sheet.size.widthMm, sheet.size.heightMm);
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const base = ISO_SIZES_MM[sheet.size.size]!;
  return sheet.orientation === 'landscape' ? base.w : base.h;
}

function getSheetHeightMm(sheet: DrawingSheet): number {
  if (sheet.size.kind === 'custom') {
    return sheet.orientation === 'landscape'
      ? Math.min(sheet.size.widthMm, sheet.size.heightMm)
      : Math.max(sheet.size.widthMm, sheet.size.heightMm);
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const base = ISO_SIZES_MM[sheet.size.size]!;
  return sheet.orientation === 'landscape' ? base.h : base.w;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
