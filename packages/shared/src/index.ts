export * from './result';
export * from './errors';
export * from './parameters';
export * from './types';
export * from './fileFormat';
export * from './constraints';
export { inferFromGeometry } from './inferFromGeometry';
export * from './componentPath';
export * from './partInfo';
export * from './material';
export * from './cutListRow';
export * from './panel-feature';
export * from './cabinets';
export type {
  HardwareCategory,
  HardwareEntry,
  HardwareFeature,
  HardwareRegistry,
  AttachPoint,
} from './hardware-feature';
export { isHardwareFeature } from './hardware-feature';
export type {
  NestInputRow, PlacedPanel, NestSheet, NestExclusion, NestExclusionReason, NestState,
  PackResult, PackAllResult,
} from './nesting';
export { packGuillotine, packAllMaterials, computeNestFingerprint } from './nesting';
// PointRef omitted from this re-export — collides with constraints.PointRef (sketcher anchor type).
// Drawing consumers must `import { PointRef } from '@zilventor/shared/drawing/types'` directly.
export { ISO_SIZES_MM } from './drawing/types';
export type { DrawingDocument, DrawingSource, DrawingSheet, SheetSize, DrawingView, BaseView, ProjectedView, IsoView, ViewScale, DrawingDimension, DrawingAnnotation, TitleBlockOverrides } from './drawing/types';
export type { ProjectedGeometry, Edge2D } from './drawing/projectedGeometry';
