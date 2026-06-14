// packages/app/src/drawing/renderDrawingDxf.ts
import type {
  DrawingDocument, DrawingSheet, DrawingView, DrawingDimension, DimensionGroup,
  DrawingAnnotation, DetailView, SectionView, PartDocument, AssemblyDocument,
  HoleTableAnnotation, PartsListAnnotation, ParamOrLiteral,
} from '@zilventor/shared';
import type { PointRef } from '@zilventor/shared/src/drawing/types';
import { ISO_SIZES_MM } from '@zilventor/shared';
import { resolveTitleBlock } from '@zilventor/shared/src/drawing/titleBlock';
import { intersectLines, subtendedAngle, formatAngleDeg } from '@zilventor/shared/src/drawing/dimensionMath';
import { computeHoleTableRows } from '@zilventor/shared/src/drawing/holeTable';
import { circumcenterFromPolyline } from '@zilventor/shared/src/drawing/circumcenter';
import { resolveCenterMarkGeometry } from '@zilventor/shared/src/drawing/resolveCenterMarkGeometry';
import { createDxfDocument, hexToAci } from './dxfWriter';

// ── Sheet dimension helpers (mirrors renderDrawingSvg — not exported there) ──

function getSheetWidthMm(sheet: DrawingSheet): number {
  if (sheet.size.kind === 'custom') {
    return sheet.orientation === 'landscape'
      ? Math.max(sheet.size.widthMm, sheet.size.heightMm)
      : Math.min(sheet.size.widthMm, sheet.size.heightMm);
  }
   
  const base = ISO_SIZES_MM[sheet.size.size]!;
  return sheet.orientation === 'landscape' ? base.w : base.h;
}

function getSheetHeightMm(sheet: DrawingSheet): number {
  if (sheet.size.kind === 'custom') {
    return sheet.orientation === 'landscape'
      ? Math.min(sheet.size.widthMm, sheet.size.heightMm)
      : Math.max(sheet.size.widthMm, sheet.size.heightMm);
  }
   
  const base = ISO_SIZES_MM[sheet.size.size]!;
  return sheet.orientation === 'landscape' ? base.h : base.w;
}

// ── Point-ref resolver (mirrors renderDrawingSvg — not exported there) ────────

function resolvePointRef(
  ref: PointRef,
  projection: NonNullable<DrawingView['projection']>,
): readonly [number, number] | null {
  const r = ref as { kind: string; edgeId?: string; end?: string };
  const edge = projection.visibleEdges.find((e) => e.id === r.edgeId)
    ?? projection.hiddenEdges.find((e) => e.id === r.edgeId);
  if (!edge || edge.points.length === 0) return null;
  if (r.end === 'end') return edge.points[edge.points.length - 1] as readonly [number, number];
  if (r.kind === 'edge-midpoint') return edge.points[Math.floor(edge.points.length / 2)] as readonly [number, number];
  if (r.kind === 'arc-center') {
    const { cx, cy } = circumcenterFromPolyline(edge.points);
    return [cx, cy] as const;
  }
  return edge.points[0] as readonly [number, number];
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Render a DrawingSheet to an AutoCAD R12 ASCII DXF string.
 * Mirrors renderDrawingSvg dispatch; applies Y-flip (dxfY = sheetH - svgY).
 */
export function renderDrawingDxf(
  drawing: DrawingDocument,
  sheet: DrawingSheet,
  source: PartDocument | AssemblyDocument | null,
): string {
  const sheetW = getSheetWidthMm(sheet);
  const sheetH = getSheetHeightMm(sheet);
  const titleH = 20;

  // Y-flip helper: SVG is Y-down; DXF is Y-up.
  const flipY = (svgY: number): number => sheetH - svgY;

  const doc = createDxfDocument();

  // ── Views ──────────────────────────────────────────────────────────────────
  for (const view of sheet.views) {
    emitView(doc, view, sheet.views, flipY);
  }

  // ── Stepped section lines (mirrors renderSteppedSectionLines in SVG) ───────
  emitSteppedSectionLines(doc, sheet.views, flipY);

  // ── Detail callout borders on parent (mirrors renderDetailCalloutGroups) ───
  emitDetailCallouts(doc, sheet.views, flipY);

  // ── Dimensions ─────────────────────────────────────────────────────────────
  for (const dim of sheet.dimensions) {
    emitDimension(doc, dim, sheet.views, sheet.dimensionGroups, flipY);
  }

  // ── Annotations ────────────────────────────────────────────────────────────
  for (const ann of sheet.annotations) {
    emitAnnotation(doc, ann, sheet, source, flipY);
  }

  // ── Title block ────────────────────────────────────────────────────────────
  const titleBlock = resolveTitleBlock(
    drawing, sheet, source,
    drawing.sheets.indexOf(sheet),
    drawing.sheets.length,
    '',
  );
  emitTitleBlock(doc, {
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
  }, sheetW, sheetH, titleH, flipY);

  return doc.toString();
}

// ── View emitter ──────────────────────────────────────────────────────────────

function emitView(
  doc: ReturnType<typeof createDxfDocument>,
  view: DrawingView,
  allViews: readonly DrawingView[],
  flipY: (y: number) => number,
): void {
  const { projection } = view;
  if (!projection) return; // skip unprojected views

  const vScale = view.scale.numerator / view.scale.denominator;
  const ox = view.positionMm.x;
  const oy = view.positionMm.y;

  // Transform helper: view-local → sheet-space → DXF-space
  const tx = (px: number) => ox + px * vScale;
  const ty = (py: number) => flipY(oy + py * vScale);

  // Visible edges → VISIBLE layer
  for (const edge of projection.visibleEdges) {
    if (edge.points.length < 2) continue;
    const pts = edge.points.map(([x, y]) => [tx(x), ty(y)] as readonly [number, number]);
    doc.polyline('VISIBLE', pts);
  }

  // Hidden edges → HIDDEN layer
  for (const edge of projection.hiddenEdges) {
    if (edge.points.length < 2) continue;
    const pts = edge.points.map(([x, y]) => [tx(x), ty(y)] as readonly [number, number]);
    doc.polyline('HIDDEN', pts);
  }

  // Section-specific: hatch segments → SECTION-HATCH
  if (view.kind === 'section') {
    const sv = view as SectionView;
    for (const h of sv.hatchSegments) {
      doc.line('SECTION-HATCH',
        tx(h.p0.x), ty(h.p0.y),
        tx(h.p1.x), ty(h.p1.y),
        h.color ? hexToAci(h.color) : undefined,
      );
    }
  }

  // Base/projected/iso views: scale label below the bounding box.
  if ((view.kind === 'base' || view.kind === 'projected' || view.kind === 'iso') && projection) {
    const labelSvgX = ox + ((projection.bbox.minX + projection.bbox.maxX) / 2) * vScale;
    const labelSvgY = oy + (projection.bbox.maxY + 7) * vScale;
    const scaleStr = `SCALE ${view.scale.numerator}:${view.scale.denominator}`;
    doc.text('VISIBLE', labelSvgX, flipY(labelSvgY), 3.5, scaleStr);
  }

  // Section view: "SECTION X-X" heading below the bbox.
  if (view.kind === 'section' && projection) {
    const sv = view as SectionView;
    const headingSvgX = ox + ((projection.bbox.minX + projection.bbox.maxX) / 2) * vScale;
    const headingSvgY = oy + (projection.bbox.maxY + 7) * vScale;
    doc.text('VISIBLE', headingSvgX, flipY(headingSvgY), 3.5, `SECTION ${sv.label}-${sv.label}`);
  }

  // Detail-specific: border shape on DETAIL layer (within view transform)
  if (view.kind === 'detail') {
    const dv = view as DetailView;
    const rp = dv.regionParent;
    if (rp.kind === 'circle') {
      // Circle center is at view origin (detail view is centered on region)
      doc.circle('DETAIL', tx(0), ty(0), rp.radiusMm * vScale);
    } else {
      // rect: emit as closed POLYLINE
      const hw = (rp.widthMm / 2) * vScale;
      const hh = (rp.heightMm / 2) * vScale;
      const cx = tx(0); const cy = ty(0);
      doc.polyline('DETAIL', [
        [cx - hw, cy - hh],
        [cx + hw, cy - hh],
        [cx + hw, cy + hh],
        [cx - hw, cy + hh],
        [cx - hw, cy - hh],
      ]);
    }
    // Detail caption text
    if (projection) {
      const captionSvgX = ox + ((projection.bbox.minX + projection.bbox.maxX) / 2) * vScale;
      const captionSvgY = oy + (projection.bbox.maxY + 5) * vScale;
      doc.text('DETAIL', captionSvgX, flipY(captionSvgY), 4,
        `DETAIL ${dv.label} ${dv.scale.numerator}:${dv.scale.denominator}`);
    }
  }

  // Suppress unused-variable warning for allViews (used in stepped section / detail callout helpers)
  void allViews;
}

// ── Stepped section lines ──────────────────────────────────────────────────────

function emitSteppedSectionLines(
  doc: ReturnType<typeof createDxfDocument>,
  views: readonly DrawingView[],
  flipY: (y: number) => number,
): void {
  for (const view of views) {
    if (view.kind !== 'section') continue;
    const sv = view as SectionView;
    if (sv.mode !== 'stepped' || !sv.stepSegments || sv.stepSegments.length < 2) continue;
    const parent = views.find((v) => v.id === sv.parentViewId);
    if (!parent || (parent.kind !== 'base' && parent.kind !== 'projected')) continue;

    const ox = parent.positionMm.x;
    const oy = parent.positionMm.y;
    const scale = parent.scale.numerator / parent.scale.denominator;

    const verts = [
      sv.stepSegments[0]!.startSheet,
      ...sv.stepSegments.map((s) => s.endSheet),
    ];
    const sheetVerts = verts.map((v) => ({
      x: ox + v.x * scale,
      y: oy + v.y * scale,
    }));

    doc.polyline(
      'SECTION-LINE',
      sheetVerts.map((v) => [v.x, flipY(v.y)] as readonly [number, number]),
    );

    // Arrow tips + labels (mirrors SVG renderSteppedSectionLines)
    const ARROW_LEN = 3; const LABEL_OFFSET = 5;
    const first = sheetVerts[0]!; const second = sheetVerts[1]!;
    const last = sheetVerts[sheetVerts.length - 1]!;
    const penult = sheetVerts[sheetVerts.length - 2]!;
    const ad = sv.arrowDirection;

    const fdx = second.x - first.x; const fdy = second.y - first.y;
    const flen = Math.sqrt(fdx * fdx + fdy * fdy) || 1;
    const fnx = (-fdy / flen) * ad; const fny = (fdx / flen) * ad;

    const ldx = last.x - penult.x; const ldy = last.y - penult.y;
    const llen = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
    const lnx = (-ldy / llen) * ad; const lny = (ldx / llen) * ad;

    const tip0x = first.x + fnx * ARROW_LEN; const tip0y = first.y + fny * ARROW_LEN;
    const tipNx = last.x + lnx * ARROW_LEN;  const tipNy = last.y + lny * ARROW_LEN;
    const lab0x = tip0x + fnx * LABEL_OFFSET; const lab0y = tip0y + fny * LABEL_OFFSET;
    const labNx = tipNx + lnx * LABEL_OFFSET; const labNy = tipNy + lny * LABEL_OFFSET;

    doc.polyline('SECTION-LINE', [[first.x, flipY(first.y)], [tip0x, flipY(tip0y)]]);
    doc.polyline('SECTION-LINE', [[last.x, flipY(last.y)], [tipNx, flipY(tipNy)]]);
    doc.text('SECTION-LINE', lab0x, flipY(lab0y), 5, sv.label);
    doc.text('SECTION-LINE', labNx, flipY(labNy), 5, sv.label);
  }
}

// ── Detail callouts on parent views ───────────────────────────────────────────

function emitDetailCallouts(
  doc: ReturnType<typeof createDxfDocument>,
  views: readonly DrawingView[],
  flipY: (y: number) => number,
): void {
  for (const view of views) {
    if (view.kind !== 'detail') continue;
    const dv = view as DetailView;
    const parent = views.find((v) => v.id === dv.parentViewId);
    if (!parent) continue;
    const parentScale = parent.scale.numerator / parent.scale.denominator;
    const cx = parent.positionMm.x + dv.regionParent.center.x * parentScale;
    const cy = parent.positionMm.y + dv.regionParent.center.y * parentScale;
    const rp = dv.regionParent;

    if (rp.kind === 'circle') {
      const r = rp.radiusMm * parentScale;
      doc.circle('DETAIL', cx, flipY(cy), r);
      const COS45 = Math.SQRT1_2;
      doc.text('DETAIL', cx + (r + 5) * COS45, flipY(cy - (r + 5) * COS45), 5, dv.label);
    } else {
      const w = rp.widthMm * parentScale;
      const h = rp.heightMm * parentScale;
      const rx = cx - w / 2; const ry = cy - h / 2;
      // Closed rect polyline in sheet space (SVG Y-down corners, then flip each)
      doc.polyline('DETAIL', [
        [rx,     flipY(ry)],
        [rx + w, flipY(ry)],
        [rx + w, flipY(ry + h)],
        [rx,     flipY(ry + h)],
        [rx,     flipY(ry)],
      ]);
      doc.text('DETAIL', rx + w + 2, flipY(ry - 2), 5, dv.label);
    }
  }
}

// ── Dimensions ────────────────────────────────────────────────────────────────

function emitDimension(
  doc: ReturnType<typeof createDxfDocument>,
  dim: DrawingDimension,
  views: readonly DrawingView[],
  dimensionGroups: readonly DimensionGroup[],
  flipY: (y: number) => number,
): void {
  const view = views.find((v) => v.id === dim.viewId);

  if (dim.kind === 'linear-h' || dim.kind === 'linear-v' || dim.kind === 'aligned') {
    if (!view?.projection) return;
    const p1 = resolvePointRef(dim.from, view.projection);
    const p2 = resolvePointRef(dim.to, view.projection);
    if (!p1 || !p2) return;
    const vScale = view.scale.numerator / view.scale.denominator;
    const vx = view.positionMm.x; const vy = view.positionMm.y;
    const x1 = vx + p1[0] * vScale; const sy1 = vy + p1[1] * vScale;
    const x2 = vx + p2[0] * vScale; const sy2 = vy + p2[1] * vScale;
    const offset = dim.offsetMm;
    const distMm = Math.round(Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2));
    const label = dim.textOverride ?? (dim.sourceParameterName ? `${dim.sourceParameterName}=${distMm}` : String(distMm));

    if (dim.kind === 'linear-h') {
      const dimSvgY = sy1 - offset;
      const blockName = doc.block(() => {
        doc.polyline('DIMENSIONS', [[x1, flipY(dimSvgY)], [x2, flipY(dimSvgY)]]);
        doc.polyline('DIMENSIONS', [[x1, flipY(sy1)], [x1, flipY(dimSvgY)]]);
        doc.polyline('DIMENSIONS', [[x2, flipY(sy2)], [x2, flipY(dimSvgY)]]);
        doc.text('DIMENSIONS', (x1 + x2) / 2, flipY(dimSvgY - 1), 3.5, label);
      });
      doc.dimension({
        layer: 'DIMENSIONS', blockName, dimStyle: 'STANDARD', dimType: 0,
        defPoint: [x2, flipY(dimSvgY)],
        textMid: [(x1 + x2) / 2, flipY(dimSvgY - 1)],
        text: label, rotation: 0,
        extraPoints: [[13, x1, flipY(sy1)], [14, x2, flipY(sy2)]],
      });
    } else {
      const dimSvgX = x1 + offset;
      const blockName = doc.block(() => {
        doc.polyline('DIMENSIONS', [[dimSvgX, flipY(sy1)], [dimSvgX, flipY(sy2)]]);
        doc.polyline('DIMENSIONS', [[x1, flipY(sy1)], [dimSvgX, flipY(sy1)]]);
        doc.polyline('DIMENSIONS', [[x2, flipY(sy2)], [dimSvgX, flipY(sy2)]]);
        doc.text('DIMENSIONS', dimSvgX + 1, flipY((sy1 + sy2) / 2), 3.5, label);
      });
      doc.dimension({
        layer: 'DIMENSIONS', blockName, dimStyle: 'STANDARD',
        dimType: dim.kind === 'aligned' ? 1 : 0,
        defPoint: [dimSvgX, flipY(sy2)],
        textMid: [dimSvgX + 1, flipY((sy1 + sy2) / 2)],
        text: label,
        ...(dim.kind === 'aligned' ? {} : { rotation: 90 }),
        extraPoints: [[13, x1, flipY(sy1)], [14, x2, flipY(sy2)]],
      });
    }
    return;
  }

  if (dim.kind === 'baseline') {
    const group = dimensionGroups.find((g) => g.id === dim.groupId);
    if (!group || group.kind !== 'baseline' || !view?.projection) return;
    const datumPt = resolvePointRef(group.datum, view.projection);
    const toPt   = resolvePointRef(dim.to, view.projection);
    if (!datumPt || !toPt) return;
    const vScale = view.scale.numerator / view.scale.denominator;
    const vx = view.positionMm.x; const vy = view.positionMm.y;
    const dx = vx + datumPt[0] * vScale; const sdy = vy + datumPt[1] * vScale;
    const tx2 = vx + toPt[0] * vScale;  const sty = vy + toPt[1] * vScale;
    const offset2 = group.baseOffsetMm + dim.slot * group.spacingMm;
    const label2 = dim.textOverride ?? String(Math.round(
      group.direction === 'h' ? Math.abs(toPt[0] - datumPt[0]) : Math.abs(toPt[1] - datumPt[1])
    ));

    if (group.direction === 'h') {
      const dimSvgY = sdy - offset2;
      const blockName = doc.block(() => {
        doc.polyline('DIMENSIONS', [[dx, flipY(dimSvgY)], [tx2, flipY(dimSvgY)]]);
        doc.polyline('DIMENSIONS', [[dx, flipY(sdy)], [dx, flipY(dimSvgY)]]);
        doc.polyline('DIMENSIONS', [[tx2, flipY(sty)], [tx2, flipY(dimSvgY)]]);
        doc.text('DIMENSIONS', (dx + tx2) / 2, flipY(dimSvgY - 1), 3.5, label2);
      });
      doc.dimension({
        layer: 'DIMENSIONS', blockName, dimStyle: 'STANDARD', dimType: 0,
        defPoint: [tx2, flipY(dimSvgY)], textMid: [(dx + tx2) / 2, flipY(dimSvgY - 1)],
        text: label2, rotation: 0,
        extraPoints: [[13, dx, flipY(sdy)], [14, tx2, flipY(sty)]],
      });
    } else {
      const dimSvgX = dx + offset2;
      const midSvgY = (sdy + sty) / 2;
      const blockName = doc.block(() => {
        doc.polyline('DIMENSIONS', [[dimSvgX, flipY(sdy)], [dimSvgX, flipY(sty)]]);
        doc.polyline('DIMENSIONS', [[dx, flipY(sdy)], [dimSvgX, flipY(sdy)]]);
        doc.polyline('DIMENSIONS', [[tx2, flipY(sty)], [dimSvgX, flipY(sty)]]);
        doc.text('DIMENSIONS', dimSvgX + 1, flipY(midSvgY), 3.5, label2);
      });
      doc.dimension({
        layer: 'DIMENSIONS', blockName, dimStyle: 'STANDARD', dimType: 0,
        defPoint: [dimSvgX, flipY(sty)], textMid: [dimSvgX + 1, flipY(midSvgY)],
        text: label2, rotation: 90,
        extraPoints: [[13, dx, flipY(sdy)], [14, tx2, flipY(sty)]],
      });
    }
    return;
  }

  if (dim.kind === 'ordinate') {
    const group = dimensionGroups.find((g) => g.id === dim.groupId);
    if (!group || group.kind !== 'ordinate' || !view?.projection) return;
    const originPt = resolvePointRef(group.origin, view.projection);
    const toPt3    = resolvePointRef(dim.to, view.projection);
    if (!originPt || !toPt3) return;
    const vScale = view.scale.numerator / view.scale.denominator;
    const vx = view.positionMm.x; const vy = view.positionMm.y;
    const ox2 = vx + originPt[0] * vScale; const soy = vy + originPt[1] * vScale;
    const tx3 = vx + toPt3[0] * vScale;   const sty3 = vy + toPt3[1] * vScale;
    const label3 = dim.textOverride ?? `${Math.abs(
      dim.axis === 'x' ? toPt3[0] - originPt[0] : toPt3[1] - originPt[1]
    ).toFixed(2)}`;

    if (dim.axis === 'x') {
      const colSvgY = soy + group.xColumnOffsetMm;
      const blockName = doc.block(() => {
        doc.polyline('DIMENSIONS', [[tx3, flipY(sty3)], [tx3, flipY(colSvgY)]]);
        doc.polyline('DIMENSIONS', [[tx3, flipY(colSvgY)], [ox2, flipY(colSvgY)]]);
        doc.text('DIMENSIONS', ox2 - 1, flipY(colSvgY - 1), 3.5, label3);
      });
      doc.dimension({
        layer: 'DIMENSIONS', blockName, dimStyle: 'STANDARD', dimType: 6 + 64,
        defPoint: [ox2, flipY(soy)], textMid: [ox2 - 1, flipY(colSvgY - 1)],
        text: label3,
        extraPoints: [[13, tx3, flipY(sty3)], [14, ox2, flipY(colSvgY)]],
      });
    } else {
      const colSvgX = ox2 + group.yColumnOffsetMm;
      const blockName = doc.block(() => {
        doc.polyline('DIMENSIONS', [[tx3, flipY(sty3)], [colSvgX, flipY(sty3)]]);
        doc.polyline('DIMENSIONS', [[colSvgX, flipY(sty3)], [colSvgX, flipY(soy)]]);
        doc.text('DIMENSIONS', colSvgX + 1, flipY(soy - 1), 3.5, label3);
      });
      doc.dimension({
        layer: 'DIMENSIONS', blockName, dimStyle: 'STANDARD', dimType: 6,
        defPoint: [ox2, flipY(soy)], textMid: [colSvgX + 1, flipY(soy - 1)],
        text: label3,
        extraPoints: [[13, tx3, flipY(sty3)], [14, colSvgX, flipY(sty3)]],
      });
    }
    return;
  }

  if (dim.kind === 'radial') {
    if (!view?.projection) return;
    const edge = view.projection.visibleEdges.find((e) => e.id === dim.edgeId)
      ?? view.projection.hiddenEdges.find((e) => e.id === dim.edgeId);
    if (!edge || edge.points.length < 3) return;

    const { cx, cy, r } = circumcenterFromPolyline(edge.points);
    const vScale = view.scale.numerator / view.scale.denominator;
    const vx = view.positionMm.x;
    const vy = view.positionMm.y;

    const angleRad = (dim.angleDeg * Math.PI) / 180;
    const rimX = cx + r * Math.cos(angleRad);
    const rimY = cy + r * Math.sin(angleRad);
    const tipX = cx + (r + dim.offsetMm) * Math.cos(angleRad);
    const tipY = cy + (r + dim.offsetMm) * Math.sin(angleRad);

    // Sheet-space (SVG Y-down)
    const sx1 = vx + cx   * vScale;  const sy1 = vy + cy   * vScale;
    const sx2 = vx + rimX * vScale;  const sy2 = vy + rimY * vScale;
    const stx = vx + (tipX + 1) * vScale; const sty = vy + tipY * vScale;

    const label = `R${Math.round(r)}`;
    const blockName = doc.block(() => {
      doc.polyline('DIMENSIONS', [[sx1, flipY(sy1)], [sx2, flipY(sy2)]]);
      doc.text('DIMENSIONS', stx, flipY(sty), 3.5, label);
    });
    doc.dimension({
      layer: 'DIMENSIONS', blockName, dimStyle: 'STANDARD', dimType: 4,
      defPoint: [sx2, flipY(sy2)],
      textMid: [stx, flipY(sty)],
      text: label,
    });
    return;
  }

  if (dim.kind === 'diametric') {
    if (!view?.projection) return;
    const edge = view.projection.visibleEdges.find((e) => e.id === dim.edgeId)
      ?? view.projection.hiddenEdges.find((e) => e.id === dim.edgeId);
    if (!edge || edge.points.length < 3) return;

    const { cx, cy, r } = circumcenterFromPolyline(edge.points);
    const vScale = view.scale.numerator / view.scale.denominator;
    const vx = view.positionMm.x;
    const vy = view.positionMm.y;

    const angleRad = (dim.angleDeg * Math.PI) / 180;
    const rimAx = cx + r * Math.cos(angleRad);
    const rimAy = cy + r * Math.sin(angleRad);
    const rimBx = cx - r * Math.cos(angleRad);
    const rimBy = cy - r * Math.sin(angleRad);

    const sx1 = vx + rimAx * vScale; const sy1 = vy + rimAy * vScale;
    const sx2 = vx + rimBx * vScale; const sy2 = vy + rimBy * vScale;
    const stx = vx + (rimAx + 1) * vScale; const sty = vy + (rimAy - 1) * vScale;

    // DXF R12 diameter symbol = %%c
    const label = `%%c${Math.round(2 * r)}`;
    const blockName = doc.block(() => {
      doc.polyline('DIMENSIONS', [[sx1, flipY(sy1)], [sx2, flipY(sy2)]]);
      doc.text('DIMENSIONS', stx, flipY(sty), 3.5, label);
    });
    doc.dimension({
      layer: 'DIMENSIONS', blockName, dimStyle: 'STANDARD', dimType: 3,
      defPoint: [sx1, flipY(sy1)],
      textMid: [stx, flipY(sty)],
      text: label,
    });
    return;
  }

  if (dim.kind === 'angular') {
    if (!view?.projection) return;
    const vScale = view.scale.numerator / view.scale.denominator;
    const vx = view.positionMm.x; const vy = view.positionMm.y;
    const ref = dim.ref;

    // Tessellate arc into 32-segment POLYLINE (DXF R12 — no native arc in ENTITIES for Y-flipped arcs)
    const SEGS = 32;

    if (ref.kind === 'arc') {
      const arcEdge = view.projection.visibleEdges.find((e) => e.id === ref.edge.edgeId)
        ?? view.projection.hiddenEdges.find((e) => e.id === ref.edge.edgeId);
      if (!arcEdge || arcEdge.points.length < 3) return;
      const pts = arcEdge.points;
      const pStart = pts[0]!; const pEnd = pts[pts.length - 1]!;
      const pMid = pts[Math.floor(pts.length / 2)]!;
      // Circumcenter
      const ax = pStart[0], ay = pStart[1];
      const bx = pMid[0],   by = pMid[1];
      const cx = pEnd[0],   cy = pEnd[1];
      const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
      const ccx = Math.abs(D) < 1e-12 ? (ax + bx + cx) / 3
        : ((ax*ax+ay*ay)*(by-cy) + (bx*bx+by*by)*(cy-ay) + (cx*cx+cy*cy)*(ay-by)) / D;
      const ccy = Math.abs(D) < 1e-12 ? (ay + by + cy) / 3
        : ((ax*ax+ay*ay)*(cx-bx) + (bx*bx+by*by)*(ax-cx) + (cx*cx+cy*cy)*(bx-ax)) / D;
      const r_arc = Math.sqrt((ax - ccx) ** 2 + (ay - ccy) ** 2);
      const arcR = r_arc + dim.offsetMm;
      const startAngle = Math.atan2(ay - ccy, ax - ccx);
      const endAngle   = Math.atan2(cy - ccy, cx - ccx);
      let sweep = ((endAngle - startAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      if (dim.arcSide === 'outside') sweep = 2 * Math.PI - sweep;
      const arcPts: Array<readonly [number, number]> = [];
      for (let i = 0; i <= SEGS; i++) {
        const a = startAngle + (dim.arcSide === 'outside' ? -1 : 1) * (sweep * i / SEGS);
        const sx = vx + (ccx + arcR * Math.cos(a)) * vScale;
        const sy = vy + (ccy + arcR * Math.sin(a)) * vScale;
        arcPts.push([sx, flipY(sy)]);
      }
      const blockName = doc.block(() => {
        doc.polyline('DIMENSIONS', arcPts);
        const midA = startAngle + (dim.arcSide === 'outside' ? -1 : 1) * sweep / 2;
        const tx4 = vx + (ccx + (arcR + 1.5) * Math.cos(midA)) * vScale;
        const sy4 = vy + (ccy + (arcR + 1.5) * Math.sin(midA)) * vScale;
        doc.text('DIMENSIONS', tx4, flipY(sy4), 3.5, formatAngleDeg(sweep));
      });
      const midA = startAngle + (dim.arcSide === 'outside' ? -1 : 1) * sweep / 2;
      const tx4 = vx + (ccx + (arcR + 1.5) * Math.cos(midA)) * vScale;
      const sy4 = vy + (ccy + (arcR + 1.5) * Math.sin(midA)) * vScale;
      doc.dimension({
        layer: 'DIMENSIONS', blockName, dimStyle: 'STANDARD', dimType: 5,
        defPoint: [vx + ccx * vScale, flipY(vy + ccy * vScale)],
        textMid: [tx4, flipY(sy4)],
        text: formatAngleDeg(sweep),
      });
      return;
    }

    // two-edges case
    const edge1 = view.projection.visibleEdges.find((e) => e.id === ref.edge1.edgeId)
      ?? view.projection.hiddenEdges.find((e) => e.id === ref.edge1.edgeId);
    const edge2 = view.projection.visibleEdges.find((e) => e.id === ref.edge2.edgeId)
      ?? view.projection.hiddenEdges.find((e) => e.id === ref.edge2.edgeId);
    if (!edge1 || !edge2 || edge1.points.length < 2 || edge2.points.length < 2) return;
    const e1p0 = { x: edge1.points[0]![0], y: edge1.points[0]![1] };
    const e1p1 = { x: edge1.points[edge1.points.length-1]![0], y: edge1.points[edge1.points.length-1]![1] };
    const e2p0 = { x: edge2.points[0]![0], y: edge2.points[0]![1] };
    const e2p1 = { x: edge2.points[edge2.points.length-1]![0], y: edge2.points[edge2.points.length-1]![1] };
    const apex = intersectLines({ p0: e1p0, p1: e1p1 }, { p0: e2p0, p1: e2p1 });
    if (!apex) return;
    const distSq2 = (a: {x:number;y:number}, b: {x:number;y:number}) => (a.x-b.x)**2+(a.y-b.y)**2;
    const unitVec2 = (v: {x:number;y:number}) => { const l=Math.sqrt(v.x*v.x+v.y*v.y)||1; return {x:v.x/l,y:v.y/l}; };
    const e1Far = distSq2(e1p0,apex) >= distSq2(e1p1,apex) ? e1p0 : e1p1;
    const e2Far = distSq2(e2p0,apex) >= distSq2(e2p1,apex) ? e2p0 : e2p1;
    const d1 = unitVec2({x:e1Far.x-apex.x,y:e1Far.y-apex.y});
    const d2 = unitVec2({x:e2Far.x-apex.x,y:e2Far.y-apex.y});
    const { insideRad, outsideRad } = subtendedAngle(d1, d2);
    const sweepRad = dim.arcSide === 'inside' ? insideRad : outsideRad;
    const startAngle2 = Math.atan2(d1.y, d1.x);
    const cross = d1.x * d2.y - d1.y * d2.x;
    const sweepSign = dim.arcSide === 'inside' ? (cross > 0 ? 1 : -1) : (cross > 0 ? -1 : 1);
    const arcR2 = dim.offsetMm * vScale;
    const apexSvgX = vx + apex.x * vScale; const apexSvgY = vy + apex.y * vScale;
    const arcPts2: Array<readonly [number, number]> = [];
    for (let i = 0; i <= SEGS; i++) {
      const a = startAngle2 + sweepSign * sweepRad * i / SEGS;
      arcPts2.push([apexSvgX + arcR2 * Math.cos(a), flipY(apexSvgY + arcR2 * Math.sin(a))]);
    }
    const blockName = doc.block(() => {
      doc.polyline('DIMENSIONS', arcPts2);
      const midA2b = startAngle2 + sweepSign * sweepRad / 2;
      const textR2b = (dim.offsetMm + 1.5) * vScale;
      doc.text('DIMENSIONS', apexSvgX + textR2b * Math.cos(midA2b), flipY(apexSvgY + textR2b * Math.sin(midA2b)), 3.5, formatAngleDeg(sweepRad));
    });
    const midA2 = startAngle2 + sweepSign * sweepRad / 2;
    const textR2 = (dim.offsetMm + 1.5) * vScale;
    doc.dimension({
      layer: 'DIMENSIONS', blockName, dimStyle: 'STANDARD', dimType: 2,
      defPoint: [apexSvgX, flipY(apexSvgY)],
      textMid: [apexSvgX + textR2 * Math.cos(midA2), flipY(apexSvgY + textR2 * Math.sin(midA2))],
      text: formatAngleDeg(sweepRad),
    });
  }
}

// ── Annotations ───────────────────────────────────────────────────────────────

function emitAnnotation(
  doc: ReturnType<typeof createDxfDocument>,
  ann: DrawingAnnotation,
  sheet: DrawingSheet,
  source: PartDocument | AssemblyDocument | null,
  flipY: (y: number) => number,
): void {
  if (ann.kind === 'balloon') {
    const r = 4;
    doc.circle('ANNOTATIONS', ann.textPosMm.x, flipY(ann.textPosMm.y), r);
    doc.text('ANNOTATIONS', ann.textPosMm.x, flipY(ann.textPosMm.y), 3, String(ann.itemNumber));
    doc.polyline('ANNOTATIONS', [
      [ann.targetMm.x, flipY(ann.targetMm.y)],
      [ann.textPosMm.x, flipY(ann.textPosMm.y + r)],
    ]);
    return;
  }
  if (ann.kind === 'leader') {
    doc.polyline('ANNOTATIONS', [
      [ann.targetMm.x, flipY(ann.targetMm.y)],
      [ann.textPosMm.x, flipY(ann.textPosMm.y)],
    ]);
    doc.text('ANNOTATIONS', ann.textPosMm.x, flipY(ann.textPosMm.y), 3, ann.text);
    return;
  }
  if (ann.kind === 'holeTable') {
    emitHoleTable(doc, ann, sheet, source, flipY);
    return;
  }
  if (ann.kind === 'partsList') {
    emitPartsList(doc, ann, flipY);
    return;
  }
  if (ann.kind === 'center-mark') {
    const view = sheet.views.find((v) => v.id === ann.viewId);
    if (!view || !view.projection) return;
    const geom = resolveCenterMarkGeometry(view.projection.visibleEdges, ann.edgeId);
    if (!geom) return;
    const { cx, cy, r } = geom;
    const half = Math.min(r * 0.8, 5);
    const vScale = view.scale.numerator / view.scale.denominator;
    const ox = view.positionMm.x;
    const oy = view.positionMm.y;
    // Transform view-local → sheet-space → DXF-space (mirrors emitView tx/ty)
    const sheetX = (lx: number) => ox + lx * vScale;
    const sheetY = (ly: number) => flipY(oy + ly * vScale);
    // Horizontal arm
    doc.line('ANNOTATIONS', sheetX(cx - half), sheetY(cy), sheetX(cx + half), sheetY(cy));
    // Vertical arm
    doc.line('ANNOTATIONS', sheetX(cx), sheetY(cy - half), sheetX(cx), sheetY(cy + half));
    return;
  }
  // centerline: no projection data available at sheet level; skip
}

// ── Hole Table ────────────────────────────────────────────────────────────────

// Layout constants — mirrors renderDrawingSvg / HoleTableElement.tsx
const HT_COL_TAG_W  = 12;
const HT_COL_X_W   = 18;
const HT_COL_Y_W   = 18;
const HT_COL_DESC_W = 45;
const HT_ROW_H     = 6;
const HT_BALLOON_R = 3;
const HT_FONT_SIZE = 3.5;
const HT_TABLE_W   = HT_COL_TAG_W + HT_COL_X_W + HT_COL_Y_W + HT_COL_DESC_W;

function emitHoleTable(
  doc: ReturnType<typeof createDxfDocument>,
  ann: HoleTableAnnotation,
  sheet: DrawingSheet,
  source: PartDocument | AssemblyDocument | null,
  flipY: (y: number) => number,
): void {
  const part = source != null && 'featureTree' in source ? (source as PartDocument) : null;
  if (!part) return;
  const resolveParam = (p: ParamOrLiteral): number =>
    p.kind === 'literal' ? p.value : (part.parameters[p.paramName]?.value ?? 0);
  const view = sheet.views.find((v) => v.id === ann.viewId);
  if (!view) return;
  const rows = computeHoleTableRows(ann, view, part, resolveParam);
  if (rows.length === 0) return;

  const { x: tx, y: ty } = ann.positionMm;
  const tableH = (rows.length + 1) * HT_ROW_H;

  // Outer border polyline
  doc.polyline('HOLE-TABLE', [
    [tx,            flipY(ty)],
    [tx + HT_TABLE_W, flipY(ty)],
    [tx + HT_TABLE_W, flipY(ty + tableH)],
    [tx,            flipY(ty + tableH)],
    [tx,            flipY(ty)],
  ]);

  // Header row divider
  doc.polyline('HOLE-TABLE', [[tx, flipY(ty + HT_ROW_H)], [tx + HT_TABLE_W, flipY(ty + HT_ROW_H)]]);

  // Column dividers
  for (const colX of [tx + HT_COL_TAG_W, tx + HT_COL_TAG_W + HT_COL_X_W, tx + HT_COL_TAG_W + HT_COL_X_W + HT_COL_Y_W]) {
    doc.polyline('HOLE-TABLE', [[colX, flipY(ty)], [colX, flipY(ty + tableH)]]);
  }

  // Header text
  const textSvgY0 = ty + HT_ROW_H * 0.65;
  doc.text('HOLE-TABLE', tx + 1,                                              flipY(textSvgY0), HT_FONT_SIZE, 'TAG');
  doc.text('HOLE-TABLE', tx + HT_COL_TAG_W + 1,                              flipY(textSvgY0), HT_FONT_SIZE, 'XDIM');
  doc.text('HOLE-TABLE', tx + HT_COL_TAG_W + HT_COL_X_W + 1,               flipY(textSvgY0), HT_FONT_SIZE, 'YDIM');
  doc.text('HOLE-TABLE', tx + HT_COL_TAG_W + HT_COL_X_W + HT_COL_Y_W + 1, flipY(textSvgY0), HT_FONT_SIZE, 'DESCRIPTION');

  // Data rows
  rows.forEach((row, i) => {
    const rowSvgY = ty + HT_ROW_H * (i + 1);
    const cellSvgY = rowSvgY + HT_ROW_H * 0.65;
    // Row divider
    if (i > 0) doc.polyline('HOLE-TABLE', [[tx, flipY(rowSvgY)], [tx + HT_TABLE_W, flipY(rowSvgY)]]);
    doc.text('HOLE-TABLE', tx + 1,                                              flipY(cellSvgY), HT_FONT_SIZE, row.tag);
    doc.text('HOLE-TABLE', tx + HT_COL_TAG_W + 1,                              flipY(cellSvgY), HT_FONT_SIZE, (Math.round(row.xDim * 10) / 10).toFixed(1));
    doc.text('HOLE-TABLE', tx + HT_COL_TAG_W + HT_COL_X_W + 1,               flipY(cellSvgY), HT_FONT_SIZE, (Math.round(row.yDim * 10) / 10).toFixed(1));
    doc.text('HOLE-TABLE', tx + HT_COL_TAG_W + HT_COL_X_W + HT_COL_Y_W + 1, flipY(cellSvgY), HT_FONT_SIZE, row.description);
  });

  // Hole balloons + leaders
  const BALLOON_OFFSET_Y = -8;
  rows.forEach((row) => {
    const bx = row.markerCenterSheetMm.x;
    const bySvg = row.markerCenterSheetMm.y + BALLOON_OFFSET_Y;
    doc.polyline('HOLE-TABLE', [
      [bx, flipY(bySvg + HT_BALLOON_R)],
      [row.markerCenterSheetMm.x, flipY(row.markerCenterSheetMm.y)],
    ]);
    doc.circle('HOLE-TABLE', bx, flipY(bySvg), HT_BALLOON_R);
    doc.text('HOLE-TABLE', bx, flipY(bySvg), HT_FONT_SIZE - 0.5, row.tag);
  });
}

// ── Parts List ────────────────────────────────────────────────────────────────

// Layout constants — mirrors renderDrawingSvg PL_* constants
const PL_COL_ITEM_W   = 12;
const PL_COL_QTY_W    = 12;
const PL_COL_NAME_W   = 50;
const PL_COL_MAT_W    = 35;
const PL_COL_DIM_W    = 35;
const PL_COL_EDGE_W   = 25;
const PL_ROW_H        = 6;
const PL_FONT_SIZE    = 3.5;
const PL_TABLE_W      = PL_COL_ITEM_W + PL_COL_QTY_W + PL_COL_NAME_W + PL_COL_MAT_W + PL_COL_DIM_W + PL_COL_EDGE_W;

function emitPartsList(
  doc: ReturnType<typeof createDxfDocument>,
  ann: PartsListAnnotation,
  flipY: (y: number) => number,
): void {
  const { x: tx, y: ty } = ann.positionMm;
  const tableH = (ann.rows.length + 1) * PL_ROW_H;

  // Column x-offsets
  const xItem  = tx;
  const xQty   = tx + PL_COL_ITEM_W;
  const xName  = tx + PL_COL_ITEM_W + PL_COL_QTY_W;
  const xMat   = tx + PL_COL_ITEM_W + PL_COL_QTY_W + PL_COL_NAME_W;
  const xDim   = tx + PL_COL_ITEM_W + PL_COL_QTY_W + PL_COL_NAME_W + PL_COL_MAT_W;
  const xEdge  = tx + PL_COL_ITEM_W + PL_COL_QTY_W + PL_COL_NAME_W + PL_COL_MAT_W + PL_COL_DIM_W;

  // Outer border (4 individual LINE segments — avoids POLYLINE in TITLE layer, keeps DXF-EDGES-2 clean)
  doc.line('PARTS-LIST', tx,              flipY(ty),            tx + PL_TABLE_W, flipY(ty));
  doc.line('PARTS-LIST', tx + PL_TABLE_W, flipY(ty),            tx + PL_TABLE_W, flipY(ty + tableH));
  doc.line('PARTS-LIST', tx + PL_TABLE_W, flipY(ty + tableH),   tx,              flipY(ty + tableH));
  doc.line('PARTS-LIST', tx,              flipY(ty + tableH),   tx,              flipY(ty));

  // Header row divider
  doc.line('PARTS-LIST', tx, flipY(ty + PL_ROW_H), tx + PL_TABLE_W, flipY(ty + PL_ROW_H));

  // Column dividers
  for (const colX of [xQty, xName, xMat, xDim, xEdge]) {
    doc.line('PARTS-LIST', colX, flipY(ty), colX, flipY(ty + tableH));
  }

  // Header texts
  const textSvgY0 = ty + PL_ROW_H * 0.65;
  doc.text('PARTS-LIST', xItem + 1, flipY(textSvgY0), PL_FONT_SIZE, 'ITEM');
  doc.text('PARTS-LIST', xQty  + 1, flipY(textSvgY0), PL_FONT_SIZE, 'QTY');
  doc.text('PARTS-LIST', xName + 1, flipY(textSvgY0), PL_FONT_SIZE, 'PART NAME');
  doc.text('PARTS-LIST', xMat  + 1, flipY(textSvgY0), PL_FONT_SIZE, 'MATERIAL');
  doc.text('PARTS-LIST', xDim  + 1, flipY(textSvgY0), PL_FONT_SIZE, 'DIMENSIONS');
  doc.text('PARTS-LIST', xEdge + 1, flipY(textSvgY0), PL_FONT_SIZE, 'EDGE BANDS');

  // Data rows
  ann.rows.forEach((row, i) => {
    const rowSvgY  = ty + PL_ROW_H * (i + 1);
    const cellSvgY = rowSvgY + PL_ROW_H * 0.65;
    if (i > 0) doc.line('PARTS-LIST', tx, flipY(rowSvgY), tx + PL_TABLE_W, flipY(rowSvgY));
    doc.text('PARTS-LIST', xItem + 1, flipY(cellSvgY), PL_FONT_SIZE, String(row.item));
    doc.text('PARTS-LIST', xQty  + 1, flipY(cellSvgY), PL_FONT_SIZE, String(row.qty));
    doc.text('PARTS-LIST', xName + 1, flipY(cellSvgY), PL_FONT_SIZE, row.partName);
    doc.text('PARTS-LIST', xMat  + 1, flipY(cellSvgY), PL_FONT_SIZE, row.material);
    doc.text('PARTS-LIST', xDim  + 1, flipY(cellSvgY), PL_FONT_SIZE, row.dimensions);
    doc.text('PARTS-LIST', xEdge + 1, flipY(cellSvgY), PL_FONT_SIZE, row.edgeBands);
  });
}

// ── Title block ───────────────────────────────────────────────────────────────

interface TitleBlockFields {
  drawingName: string; partName: string; scaleText: string; material: string;
  date: string; drawnBy: string; approvedBy: string; revision: string;
  notes: string; sheetCurrent: number; sheetTotal: number;
}

function emitTitleBlock(
  doc: ReturnType<typeof createDxfDocument>,
  fields: TitleBlockFields,
  sheetW: number,
  sheetH: number,
  titleH: number,
  flipY: (y: number) => number,
): void {
  const x = 10; const svgY = sheetH - 10 - titleH;
  const w = sheetW - 20;

  // Border lines (4 LINE segments — avoids POLYLINE in TITLE layer so DXF-EDGES-2 holds)
  doc.line('TITLE', x,     flipY(svgY),         x + w, flipY(svgY));
  doc.line('TITLE', x + w, flipY(svgY),         x + w, flipY(svgY + titleH));
  doc.line('TITLE', x + w, flipY(svgY + titleH), x,    flipY(svgY + titleH));
  doc.line('TITLE', x,     flipY(svgY + titleH), x,    flipY(svgY));
  // Mid-divider (stops 4mm above bottom to allow full-width notes row)
  doc.line('TITLE', x + w / 2, flipY(svgY), x + w / 2, flipY(svgY + titleH - 4));

  // Left column text
  doc.text('TITLE', x + 2, flipY(svgY + 4),  2.5, `Drawing: ${fields.drawingName}`);
  doc.text('TITLE', x + 2, flipY(svgY + 8),  2.5, `Part: ${fields.partName}`);
  doc.text('TITLE', x + 2, flipY(svgY + 12), 2.5, `Scale: ${fields.scaleText}`);
  doc.text('TITLE', x + 2, flipY(svgY + 16), 2.5, `Material: ${fields.material}`);

  // Right column text (admin)
  doc.text('TITLE', x + w / 2 + 2, flipY(svgY + 4),  2.5, `Date: ${fields.date}`);
  doc.text('TITLE', x + w / 2 + 2, flipY(svgY + 8),  2.5, `Drawn by: ${fields.drawnBy}`);
  doc.text('TITLE', x + w / 2 + 2, flipY(svgY + 12), 2.5, `Approved by: ${fields.approvedBy}`);
  doc.text('TITLE', x + w / 2 + 2, flipY(svgY + 16), 2.5, `Revision: ${fields.revision}`);

  // Full-width notes row at bottom
  doc.text('TITLE', x + 2, flipY(svgY + titleH - 1), 2.5, `Notes: ${fields.notes}`);

  // Sheet number (right side)
  doc.text('TITLE', x + w - 30, flipY(svgY + 16), 2.5, `Sheet: ${fields.sheetCurrent}/${fields.sheetTotal}`);

  // ISO first-angle projection symbol (bottom-right corner, ~12×8mm)
  // First-angle (ISO 128-30): trapezoid on LEFT (narrow edge left, wide edge right),
  // concentric circles on RIGHT.
  const symTrapX = x + w - 18; // left anchor = trapezoid narrow-edge x
  const symCy = svgY + titleH - 8; // SVG Y-space (will be flipped)
  // Trapezoid: narrow (short) on LEFT, wide (tall) on RIGHT
  // Emit as 4 individual LINE segments to avoid POLYLINE in TITLE layer (keeps DXF-EDGES-2 clean)
  const trapW = 6;
  const halfHS = 2.5; const halfHT = 4;
  const tlx = symTrapX;           const tlSvgY = symCy - halfHS; // top-left (narrow)
  const trx = symTrapX + trapW;   const trSvgY = symCy - halfHT; // top-right (wide)
  const brx = symTrapX + trapW;   const brSvgY = symCy + halfHT; // bottom-right (wide)
  const blx = symTrapX;           const blSvgY = symCy + halfHS; // bottom-left (narrow)
  doc.line('TITLE', tlx, flipY(tlSvgY), trx, flipY(trSvgY)); // top
  doc.line('TITLE', trx, flipY(trSvgY), brx, flipY(brSvgY)); // right
  doc.line('TITLE', brx, flipY(brSvgY), blx, flipY(blSvgY)); // bottom
  doc.line('TITLE', blx, flipY(blSvgY), tlx, flipY(tlSvgY)); // left (close)
  // Circle: to the RIGHT of the trapezoid (gap 1mm), radius 3mm
  const symR = 3;
  const symCx = symTrapX + trapW + 1 + symR;
  doc.circle('TITLE', symCx, flipY(symCy), symR);
}
