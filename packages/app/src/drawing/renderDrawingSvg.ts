import type { DrawingDocument, DrawingSheet, DrawingView, DrawingAnnotation } from '@zilventor/shared';
import type { DrawingDimension } from '@zilventor/shared';
import type { PartDocument, AssemblyDocument } from '@zilventor/shared';
import type { PointRef } from '@zilventor/shared/src/drawing/types';
import { resolveTitleBlock } from '@zilventor/shared/src/drawing/titleBlock';

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
  const dimGroups = sheet.dimensions.map((d) => renderDimensionGroup(d, sheet.views)).join('\n');
  const annGroups = sheet.annotations.map((a) => renderAnnotationGroup(a)).join('\n');
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
${dimGroups}
${annGroups}
${titleBlockSvg}
</svg>`;
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

  return `  <g transform="translate(${view.positionMm.x},${view.positionMm.y}) scale(${vScale})"
     data-view-id="${escapeAttr(view.id)}" data-view-kind="${view.kind}">
    ${staleMarker}
    ${visibleLines}
    ${hiddenLines}
  </g>`;
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
): string {
  const view = views.find((v) => v.id === dim.viewId);
  if (!view?.projection) return '';

  if (dim.kind === 'linear-h' || dim.kind === 'linear-v' || dim.kind === 'aligned') {
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
  return '';
}

function renderAnnotationGroup(ann: DrawingAnnotation): string {
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
