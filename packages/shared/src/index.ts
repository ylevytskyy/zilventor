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
export type { DrawingDocument, DrawingSource, DrawingSheet, SheetSize, DrawingView, BaseView, ProjectedView, IsoView, ViewScale, DrawingDimension, DrawingAnnotation, HoleTableAnnotation, TitleBlockOverrides, SectionView, HatchSegment, Vec2, DetailView, RegionParent, BreakRegion, DimensionGroup, EdgeRef, StepSegment } from './drawing/types';
export type { ProjectedGeometry, Edge2D } from './drawing/projectedGeometry';

// drawing module (Sub-project 6)
export type { Mat4, ViewOrientation } from './drawing/viewMatrix';
export { buildViewMatrix, apply } from './drawing/viewMatrix';
export { buildDepthBuffer, adaptivePixelPitch } from './drawing/depthBuffer';
export type { Edge3D, ClassifiedEdges } from './drawing/edgeClassifier';
export { classifyEdges } from './drawing/edgeClassifier';
export type { ProjectorInput, EdgeMesh3D } from './drawing/projector';
export { projectView } from './drawing/projector';
export type { ViewSpec } from './drawing/fingerprint';
export { computeViewFingerprint, computeSourceGeometryHash } from './drawing/fingerprint';
export type { ResolvedTitleBlock } from './drawing/titleBlock';
export { resolveTitleBlock } from './drawing/titleBlock';
export { resolveSectionSource } from './drawing/resolveSectionSource';
export { deriveSectionPlane } from './drawing/sectionPlane';
export type { Plane } from './drawing/sectionPlane';
export { allocateCalloutLabel } from './drawing/sectionLabel';
export { fingerprintDetailView, fingerprintBreaksArray } from './drawing/fingerprint';
export { projectDetailView } from './drawing/projectDetailView';
export type { DetailViewInput, DetailViewOutput } from './drawing/projectDetailView';
export { applyBreaks } from './drawing/applyBreaks';
export type { ApplyBreaksResult } from './drawing/applyBreaks';
export { intersectLines, subtendedAngle, formatAngleDeg, computeBaselineMemberOffset, nextBaselineSlot } from './drawing/dimensionMath';
export type { Point2, Vec2D } from './drawing/dimensionMath';
export { circumcenterFromPolyline } from './drawing/circumcenter';
