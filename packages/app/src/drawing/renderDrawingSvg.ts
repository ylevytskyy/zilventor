import type { DrawingDocument, DrawingSheet, DrawingView, DrawingAnnotation, DetailView, SectionView } from '@zilventor/shared';
import type { DrawingDimension, DimensionGroup } from '@zilventor/shared';
import type { PartDocument, AssemblyDocument } from '@zilventor/shared';
import type { HoleTableAnnotation, PartsListAnnotation } from '@zilventor/shared';
import type { ParamOrLiteral } from '@zilventor/shared';
import type { PointRef } from '@zilventor/shared/src/drawing/types';
import { resolveTitleBlock } from '@zilventor/shared/src/drawing/titleBlock';
import { intersectLines, subtendedAngle, formatAngleDeg } from '@zilventor/shared/src/drawing/dimensionMath';
import { computeHoleTableRows } from '@zilventor/shared/src/drawing/holeTable';
import { circumcenterFromPolyline } from '@zilventor/shared/src/drawing/circumcenter';
import { underlayEntityToSvg } from './renderUnderlayEntity';

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
  source: PartDocument | AssemblyDocument | null,
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

  const underlayGroup = sheet.underlay
    ? renderUnderlayGroup(sheet)
    : '';
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
      approvedBy: titleBlock.approvedBy,
      revision: titleBlock.revision,
      notes: titleBlock.notes,
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
${underlayGroup}
${viewGroups}
${calloutGroups}
${steppedSectionLineGroups}
${dimGroups}
${annGroups}
${titleBlockSvg}
</svg>`;
}

/**
 * F3: Render the DXF underlay as a muted <g data-underlay> backdrop.
 * Must appear BEFORE view groups so it renders behind all views.
 */
function renderUnderlayGroup(sheet: DrawingSheet): string {
  const { underlay } = sheet;
  if (!underlay) return '';
  const entityLines = underlay.entities.map((e) => `    ${underlayEntityToSvg(e)}`).join('\n');
  return `  <g data-underlay="${escapeAttr(underlay.name)}" pointer-events="none">\n${entityLines}\n  </g>`;
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

  // Section-specific: material-colored hatch (mm space, inside the scaled group).
  let hatchMarkup = '';
  if (view.kind === 'section') {
    const sv = view as SectionView;
    for (const seg of sv.hatchSegments) {
      hatchMarkup += `\n    <line x1="${seg.p0.x}" y1="${seg.p0.y}" x2="${seg.p1.x}" y2="${seg.p1.y}" stroke="${escapeAttr(seg.color ?? '#000')}" stroke-width="0.25" data-role="hatch" data-material="${escapeAttr(seg.materialId)}"/>`;
    }
  }

  // Base/projected/iso views: scale label below the bounding box.
  let viewLabelMarkup = '';
  if (view.kind === 'base' || view.kind === 'projected' || view.kind === 'iso') {
    if (projection) {
      const labelX = (projection.bbox.minX + projection.bbox.maxX) / 2;
      const labelY = projection.bbox.maxY + 7;
      const scaleStr = `${view.scale.numerator}:${view.scale.denominator}`;
      viewLabelMarkup = `\n    <text x="${labelX}" y="${labelY}" font-size="3.5" font-family="sans-serif" text-anchor="middle" data-role="view-scale-label" data-view-id="${escapeAttr(view.id)}">SCALE ${escapeText(scaleStr)}</text>`;
    }
  }

  // Section view: "SECTION X-X" heading below the bbox.
  let sectionHeadingMarkup = '';
  if (view.kind === 'section') {
    const sv = view as SectionView;
    if (projection) {
      const headingX = (projection.bbox.minX + projection.bbox.maxX) / 2;
      const headingY = projection.bbox.maxY + 7;
      sectionHeadingMarkup = `\n    <text x="${headingX}" y="${headingY}" font-size="3.5" font-family="sans-serif" text-anchor="middle" data-role="section-heading" data-view-id="${escapeAttr(view.id)}">SECTION ${escapeText(sv.label)}-${escapeText(sv.label)}</text>`;
    }
  }

  // Detail-specific: border shape + caption.
  let detailMarkup = '';
  if (view.kind === 'detail') {
    const dv = view as DetailView;
    const rp = dv.regionParent;
    if (rp.kind === 'rect') {
      const hw = rp.widthMm / 2;
      const hh = rp.heightMm / 2;
      detailMarkup += `\n    <rect x="${-hw}" y="${-hh}" width="${rp.widthMm}" height="${rp.heightMm}" fill="none" stroke="#000" stroke-width="0.35" data-role="detail-border" data-view-id="${escapeAttr(dv.id)}"/>`;
    } else {
      // kind === 'circle'
      const borderR = rp.radiusMm;
      detailMarkup += `\n    <circle cx="0" cy="0" r="${borderR}" fill="none" stroke="#000" stroke-width="0.35" data-role="detail-border" data-view-id="${escapeAttr(dv.id)}"/>`;
    }
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
    ${hiddenLines}${hatchMarkup}${detailMarkup}${viewLabelMarkup}${sectionHeadingMarkup}
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
    const rp = dv.regionParent;

    let shapeMarkup: string;
    let labelX: number;
    let labelY: number;

    if (rp.kind === 'rect') {
      const w = rp.widthMm * parentScale;
      const h = rp.heightMm * parentScale;
      const rx = cx - w / 2;
      const ry = cy - h / 2;
      shapeMarkup = `<rect x="${rx}" y="${ry}" width="${w}" height="${h}" fill="none" stroke="#000" stroke-width="0.35" data-role="detail-callout-label" data-detail-id="${escapeAttr(dv.id)}"/>`;
      // Label at top-right corner of the rect
      labelX = rx + w + 2;
      labelY = ry - 2;
    } else {
      // kind === 'circle'
      const r = rp.radiusMm * parentScale;
      const COS45 = Math.SQRT1_2;
      shapeMarkup = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#000" stroke-width="0.35" data-role="detail-callout-label" data-detail-id="${escapeAttr(dv.id)}"/>`;
      labelX = cx + (r + 5) * COS45;
      labelY = cy - (r + 5) * COS45;
    }

    groups.push(
      `  <g data-detail-callout="${escapeAttr(dv.id)}">` +
      `\n    ${shapeMarkup}` +
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

      // Estimate arc center, radius, start/end angles from the polyline
      const pts = arcEdge.points;
      const pStart = pts[0]!;
      const pEnd   = pts[pts.length - 1]!;

      // Arc center via shared circumcenter util (first/mid/last selection)
      const { cx: cx_arc, cy: cy_arc, r: r_arc } = circumcenterFromPolyline(pts);

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

  if (dim.kind === 'radial') {
    if (!view?.projection) return '';
    const edge = view.projection.visibleEdges.find((e) => e.id === dim.edgeId)
      ?? view.projection.hiddenEdges.find((e) => e.id === dim.edgeId);
    if (!edge || edge.points.length < 3) return '';

    const { cx, cy, r } = circumcenterFromPolyline(edge.points);
    const vScale = view.scale.numerator / view.scale.denominator;
    const vx = view.positionMm.x;
    const vy = view.positionMm.y;

    const angleRad = (dim.angleDeg * Math.PI) / 180;
    // Leader: from center to rim point at angleDeg, then extends offsetMm beyond rim
    const rimX = cx + r * Math.cos(angleRad);
    const rimY = cy + r * Math.sin(angleRad);
    const tipX = cx + (r + dim.offsetMm) * Math.cos(angleRad);
    const tipY = cy + (r + dim.offsetMm) * Math.sin(angleRad);

    const sx1 = vx + cx  * vScale;
    const sy1 = vy + cy  * vScale;
    const sx2 = vx + rimX * vScale;
    const sy2 = vy + rimY * vScale;
    const tx  = vx + (tipX + 1) * vScale;
    const ty  = vy + tipY * vScale;

    const label = `R${Math.round(r)}`;
    return `  <g data-dim-id="${escapeAttr(dim.id)}" data-dim-kind="radial" stroke="#00c" stroke-width="0.2" fill="none">
      <line x1="${sx1}" y1="${sy1}" x2="${sx2}" y2="${sy2}"/>
      <text x="${tx}" y="${ty}" font-size="3.5" fill="#00c" stroke="none">${label}</text>
    </g>`;
  }

  if (dim.kind === 'diametric') {
    if (!view?.projection) return '';
    const edge = view.projection.visibleEdges.find((e) => e.id === dim.edgeId)
      ?? view.projection.hiddenEdges.find((e) => e.id === dim.edgeId);
    if (!edge || edge.points.length < 3) return '';

    const { cx, cy, r } = circumcenterFromPolyline(edge.points);
    const vScale = view.scale.numerator / view.scale.denominator;
    const vx = view.positionMm.x;
    const vy = view.positionMm.y;

    const angleRad = (dim.angleDeg * Math.PI) / 180;
    // Leader: spans full diameter through center along angleDeg direction
    const rimAx = cx + r * Math.cos(angleRad);
    const rimAy = cy + r * Math.sin(angleRad);
    const rimBx = cx - r * Math.cos(angleRad);
    const rimBy = cy - r * Math.sin(angleRad);

    const sx1 = vx + rimAx * vScale;
    const sy1 = vy + rimAy * vScale;
    const sx2 = vx + rimBx * vScale;
    const sy2 = vy + rimBy * vScale;
    // Text positioned just beyond rim A
    const tx  = vx + (rimAx + 1) * vScale;
    const ty  = vy + (rimAy - 1) * vScale;

    const label = `⌀${Math.round(2 * r)}`;
    return `  <g data-dim-id="${escapeAttr(dim.id)}" data-dim-kind="diametric" stroke="#00c" stroke-width="0.2" fill="none">
      <line x1="${sx1}" y1="${sy1}" x2="${sx2}" y2="${sy2}"/>
      <text x="${tx}" y="${ty}" font-size="3.5" fill="#00c" stroke="none">${label}</text>
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
  source: PartDocument | AssemblyDocument | null,
): string {
  // Only PartDocument has featureTree; AssemblyDocument has `components` instead.
  // NOTE: neither document has a `kind` discriminant (verified packages/shared/src/types.ts:67,94),
  // so distinguish structurally via `'featureTree' in source`. Hole tables only apply to part drawings.
  const part = source != null && 'featureTree' in source ? (source as PartDocument) : null;
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

// ---------------------------------------------------------------------------
// Parts List annotation renderer (Chunk E — type + renderers; rows are a snapshot)
// ---------------------------------------------------------------------------

// Layout constants — 6 columns: ITEM / QTY / PART NAME / MATERIAL / DIMENSIONS / EDGE BANDS
const PL_COL_ITEM_W   = 12;
const PL_COL_QTY_W    = 12;
const PL_COL_NAME_W   = 50;
const PL_COL_MAT_W    = 35;
const PL_COL_DIM_W    = 35;
const PL_COL_EDGE_W   = 25;
const PL_ROW_H        = 6;
const PL_FONT_SIZE    = 3.5;
const PL_GRID_COLOR   = '#222';
const PL_TABLE_W = PL_COL_ITEM_W + PL_COL_QTY_W + PL_COL_NAME_W + PL_COL_MAT_W + PL_COL_DIM_W + PL_COL_EDGE_W;

function renderPartsListAnnotation(ann: PartsListAnnotation): string {
  const { x: tx, y: ty } = ann.positionMm;
  const rowCount = ann.rows.length + 1; // header + data
  const tableH   = rowCount * PL_ROW_H;

  // Column x-offsets
  const xItem  = tx;
  const xQty   = tx + PL_COL_ITEM_W;
  const xName  = tx + PL_COL_ITEM_W + PL_COL_QTY_W;
  const xMat   = tx + PL_COL_ITEM_W + PL_COL_QTY_W + PL_COL_NAME_W;
  const xDim   = tx + PL_COL_ITEM_W + PL_COL_QTY_W + PL_COL_NAME_W + PL_COL_MAT_W;
  const xEdge  = tx + PL_COL_ITEM_W + PL_COL_QTY_W + PL_COL_NAME_W + PL_COL_MAT_W + PL_COL_DIM_W;

  const parts: string[] = [];

  // Outer border
  parts.push(`    <rect x="${tx}" y="${ty}" width="${PL_TABLE_W}" height="${tableH}" fill="white" stroke="${PL_GRID_COLOR}" stroke-width="0.3"/>`);
  // Header divider
  parts.push(`    <line x1="${tx}" y1="${ty + PL_ROW_H}" x2="${tx + PL_TABLE_W}" y2="${ty + PL_ROW_H}" stroke="${PL_GRID_COLOR}" stroke-width="0.3"/>`);
  // Row dividers
  for (let i = 1; i < ann.rows.length; i++) {
    parts.push(`    <line x1="${tx}" y1="${ty + PL_ROW_H * (i + 1)}" x2="${tx + PL_TABLE_W}" y2="${ty + PL_ROW_H * (i + 1)}" stroke="${PL_GRID_COLOR}" stroke-width="0.15"/>`);
  }
  // Column dividers
  [xQty, xName, xMat, xDim, xEdge].forEach((colX) => {
    parts.push(`    <line x1="${colX}" y1="${ty}" x2="${colX}" y2="${ty + tableH}" stroke="${PL_GRID_COLOR}" stroke-width="0.2"/>`);
  });

  // Header text
  const textY0 = ty + PL_ROW_H * 0.65;
  parts.push(`    <text x="${xItem + 1}" y="${textY0}" font-size="${PL_FONT_SIZE}" fill="${PL_GRID_COLOR}" font-weight="bold">ITEM</text>`);
  parts.push(`    <text x="${xQty  + 1}" y="${textY0}" font-size="${PL_FONT_SIZE}" fill="${PL_GRID_COLOR}" font-weight="bold">QTY</text>`);
  parts.push(`    <text x="${xName + 1}" y="${textY0}" font-size="${PL_FONT_SIZE}" fill="${PL_GRID_COLOR}" font-weight="bold">PART NAME</text>`);
  parts.push(`    <text x="${xMat  + 1}" y="${textY0}" font-size="${PL_FONT_SIZE}" fill="${PL_GRID_COLOR}" font-weight="bold">MATERIAL</text>`);
  parts.push(`    <text x="${xDim  + 1}" y="${textY0}" font-size="${PL_FONT_SIZE}" fill="${PL_GRID_COLOR}" font-weight="bold">DIMENSIONS</text>`);
  parts.push(`    <text x="${xEdge + 1}" y="${textY0}" font-size="${PL_FONT_SIZE}" fill="${PL_GRID_COLOR}" font-weight="bold">EDGE BANDS</text>`);

  // Data rows
  ann.rows.forEach((row, i) => {
    const rowY  = ty + PL_ROW_H * (i + 1);
    const cellY = rowY + PL_ROW_H * 0.65;
    parts.push(`    <text x="${xItem + 1}" y="${cellY}" font-size="${PL_FONT_SIZE}" fill="${PL_GRID_COLOR}">${escapeText(String(row.item))}</text>`);
    parts.push(`    <text x="${xQty  + 1}" y="${cellY}" font-size="${PL_FONT_SIZE}" fill="${PL_GRID_COLOR}">${escapeText(String(row.qty))}</text>`);
    parts.push(`    <text x="${xName + 1}" y="${cellY}" font-size="${PL_FONT_SIZE}" fill="${PL_GRID_COLOR}">${escapeText(row.partName)}</text>`);
    parts.push(`    <text x="${xMat  + 1}" y="${cellY}" font-size="${PL_FONT_SIZE}" fill="${PL_GRID_COLOR}">${escapeText(row.material)}</text>`);
    parts.push(`    <text x="${xDim  + 1}" y="${cellY}" font-size="${PL_FONT_SIZE}" fill="${PL_GRID_COLOR}">${escapeText(row.dimensions)}</text>`);
    parts.push(`    <text x="${xEdge + 1}" y="${cellY}" font-size="${PL_FONT_SIZE}" fill="${PL_GRID_COLOR}">${escapeText(row.edgeBands)}</text>`);
  });

  return `  <g data-ann-id="${escapeAttr(ann.id)}" data-ann-kind="partsList">\n${parts.join('\n')}\n  </g>`;
}

function renderAnnotationGroup(
  ann: DrawingAnnotation,
  sheet: DrawingSheet,
  source: PartDocument | AssemblyDocument | null,
): string {
  if (ann.kind === 'partsList') {
    return renderPartsListAnnotation(ann);
  }
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
  approvedBy: string;
  revision: string;
  notes: string;
  sheetCurrent: number;
  sheetTotal: number;
}

/**
 * ISO first-angle projection symbol (~12×8mm).
 * First-angle arrangement (European/ISO per ISO 128-30):
 * - TRAPEZOID on the LEFT: narrow (short) vertical edge on the left, wide (tall) edge on the right.
 * - CONCENTRIC CIRCLES on the RIGHT of the trapezoid.
 * The cone's large-diameter end (wide edge of trapezoid) faces right, toward the circles.
 * cx/cy here are the LEFT anchor of the glyph (trapezoid left edge x-center).
 */
function renderProjectionSymbolSvg(cx: number, cy: number): string {
  const r = 3;
  const trapW = 6;
  const halfHS = 2.5; // half-height at short (narrow/left) end
  const halfHT = 4;   // half-height at tall (wide/right) end
  // Trapezoid: narrow on LEFT, wide on RIGHT
  const trapX = cx;
  const tl = { x: trapX,         y: cy - halfHS }; // top-left (narrow side)
  const tr = { x: trapX + trapW, y: cy - halfHT }; // top-right (wide side)
  const br = { x: trapX + trapW, y: cy + halfHT }; // bottom-right (wide side)
  const bl = { x: trapX,         y: cy + halfHS }; // bottom-left (narrow side)
  const trapPath = `M ${tl.x} ${tl.y} L ${tr.x} ${tr.y} L ${br.x} ${br.y} L ${bl.x} ${bl.y} Z`;
  // Circle: to the RIGHT of the trapezoid (gap 1mm), radius 3mm
  const circleCx = trapX + trapW + 1 + r;
  return `\n  <g data-role="projection-symbol" data-projection="first-angle">
    <path d="${trapPath}" fill="none" stroke="#000" stroke-width="0.3"/>
    <circle cx="${circleCx}" cy="${cy}" r="${r}" fill="none" stroke="#000" stroke-width="0.3"/>
  </g>`;
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
  // Projection symbol: bottom-right corner of title block (~12×8mm glyph)
  // Circle center at x + w - 18, y + titleH - 8
  const symCx = x + w - 18;
  const symCy = y + titleH - 8;
  const projSymbol = renderProjectionSymbolSvg(symCx, symCy);
  // Notes row spans full width below the two-column admin section
  return `  <g data-title-block="true">
    <rect x="${x}" y="${y}" width="${w}" height="${titleH}" fill="white" stroke="#000" stroke-width="0.3"/>
    <line x1="${x + w / 2}" y1="${y}" x2="${x + w / 2}" y2="${y + titleH - 4}" stroke="#000" stroke-width="0.2"/>
    <text x="${x + 2}" y="${y + 4}"  font-size="2.5" fill="#333">Drawing: ${escapeText(fields.drawingName)}</text>
    <text x="${x + 2}" y="${y + 8}"  font-size="2.5" fill="#333">Part: ${escapeText(fields.partName)}</text>
    <text x="${x + 2}" y="${y + 12}" font-size="2.5" fill="#333">Scale: ${escapeText(fields.scaleText)}</text>
    <text x="${x + 2}" y="${y + 16}" font-size="2.5" fill="#333">Material: ${escapeText(fields.material)}</text>
    <text x="${x + w / 2 + 2}" y="${y + 4}"  font-size="2.5" fill="#333">Date: ${escapeText(fields.date)}</text>
    <text x="${x + w / 2 + 2}" y="${y + 8}"  font-size="2.5" fill="#333">Drawn by: ${escapeText(fields.drawnBy)}</text>
    <text x="${x + w / 2 + 2}" y="${y + 12}" font-size="2.5" fill="#333">Approved by: ${escapeText(fields.approvedBy)}</text>
    <text x="${x + w / 2 + 2}" y="${y + 16}" font-size="2.5" fill="#333">Revision: ${escapeText(fields.revision)}</text>
    <text x="${x + 2}" y="${y + titleH - 1}" font-size="2.5" fill="#333">Notes: ${escapeText(fields.notes)}</text>
    <text x="${x + w - 30}" y="${y + 16}" font-size="2.5" fill="#333">Sheet: ${fields.sheetCurrent}/${fields.sheetTotal}</text>${projSymbol}
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
  if (r.kind === 'arc-center') {
    const { cx, cy } = circumcenterFromPolyline(edge.points);
    return [cx, cy] as const;
  }
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
