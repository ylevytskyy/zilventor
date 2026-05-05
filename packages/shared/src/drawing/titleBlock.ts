// packages/shared/src/drawing/titleBlock.ts
import type { PartDocument, AssemblyDocument } from '../types';
import type { DrawingDocument, DrawingSheet, BaseView } from './drawingTypes';

export type ResolvedTitleBlock = {
  readonly drawingName: string;
  readonly partName: string;
  readonly drawnBy: string;
  readonly approvedBy: string;
  readonly scaleText: string;
  readonly date: string;
  readonly material: string;
  readonly revision: string;
  readonly notes: string;
  readonly sheetNumber: { readonly current: number; readonly total: number };
};

/**
 * Merge per-sheet TitleBlockOverrides with auto-derived values.
 * Override fields take precedence field-by-field; missing overrides fall back to auto.
 *
 * @param drawing      The DrawingDocument (name, createdAt, source).
 * @param sheet        The specific sheet being rendered.
 * @param allSheets    All sheets in the drawing (for n/N computation).
 * @param source       The resolved PartDocument or AssemblyDocument.
 */
export function resolveTitleBlock(
  drawing: DrawingDocument,
  sheet: DrawingSheet,
  allSheets: readonly DrawingSheet[],
  source: PartDocument | AssemblyDocument,
): ResolvedTitleBlock {
  const ov = sheet.titleBlock;

  // Auto-derive scale from primary (first) base view
  const baseView = sheet.views.find((v): v is BaseView => v.kind === 'base');
  const autoScale = baseView
    ? `${baseView.scale.numerator}:${baseView.scale.denominator}`
    : '1:1';

  // Auto-derive material: part gets first material name; assembly → empty
  const firstMaterial = 'materials' in source ? source.materials[0] : undefined;
  const autoMaterial = firstMaterial ? firstMaterial.name : '';

  // Auto-derive date from drawing.createdAt (ISO yyyy-mm-dd prefix)
  const autoDate = drawing.createdAt ? drawing.createdAt.slice(0, 10) : '';

  // Sheet n/N
  const sheetIndex = allSheets.findIndex(s => s.id === sheet.id);
  const sheetNumber = {
    current: sheetIndex >= 0 ? sheetIndex + 1 : 1,
    total: allSheets.length,
  };

  return {
    drawingName: ov.drawingName ?? drawing.name,
    partName: ov.partName ?? source.name,
    drawnBy: ov.drawnBy ?? '',
    approvedBy: ov.approvedBy ?? '',
    scaleText: ov.scaleText ?? autoScale,
    date: ov.date ?? autoDate,
    material: ov.material ?? autoMaterial,
    revision: ov.revision ?? '',
    notes: ov.notes ?? '',
    sheetNumber,
  };
}
