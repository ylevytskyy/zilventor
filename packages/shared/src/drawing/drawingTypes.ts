// packages/shared/src/drawing/drawingTypes.ts
// Re-exports the Phase 1 drawing types (drawing/types.ts) with DrawingDocument
// extended to include `createdAt` (used by titleBlock resolver and future renderers).

export type {
  TitleBlockOverrides,
  ViewScale,
  DrawingView,
  DrawingSheet,
  DrawingSource,
  SheetSize,
  DrawingDimension,
  DrawingAnnotation,
  BaseView,
  ProjectedView,
  IsoView,
} from './types';

import type { DrawingSource, DrawingSheet } from './types';

/**
 * DrawingDocument extended with createdAt (ISO 8601).
 * The base types.ts DrawingDocument intentionally omits createdAt (it lives on
 * the ProjectFile wrapper). This local type adds it for the drawing renderer
 * which needs it to populate the title-block date field.
 */
export type DrawingDocument = {
  readonly id: string;
  readonly name: string;
  readonly units: 'mm';
  readonly source: DrawingSource;
  readonly properties: Record<string, string | number | boolean>;
  readonly sheets: readonly DrawingSheet[];
  readonly activeSheetId: string;
  readonly createdAt: string;
};
