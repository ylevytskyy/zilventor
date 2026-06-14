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
export type { UvProjection } from './uv-projection';
export { panelUvProjection } from './uv-projection';
export * from './cabinets';
export * from './bore';
export * from './prisadkaFaceConventions';
export * from './shelfPinGrid';
export * from './doorMath';
export * from './hingeMath';
export * from './connectorCatalog';
export * from './jointMath';
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
export type { DrawingDocument, DrawingSource, DrawingSheet, SheetSize, DrawingView, BaseView, ProjectedView, IsoView, ViewScale, DrawingDimension, DrawingAnnotation, HoleTableAnnotation, PartsListAnnotation, PartsListRow, TitleBlockOverrides, SectionView, HatchSegment, Vec2, DetailView, RegionParent, BreakRegion, DimensionGroup, EdgeRef, StepSegment, UnderlayEntity, DxfUnderlay } from './drawing/types';
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
export { isArcEdge } from './drawing/isArcEdge';
export type { IsArcEdgeOptions } from './drawing/isArcEdge';
export { autoPlaceCenterMarks } from './drawing/autoPlaceCenterMarks';
export type { TextureDef } from './texture-def';
export { BUILTIN_TEXTURE_DEFS, findTextureDef } from './texture-def';
export type { CustomTextureDef } from './custom-texture-def';
export { isCustomTextureDef } from './custom-texture-def';
export type { ConnectorBomEntry } from './connectorBomCatalog';
export { CONNECTOR_BOM_CATALOG } from './connectorBomCatalog';
export type { ConnectorMember } from './connectorCoupling';
export { translateConnectorAlong } from './connectorCoupling';
// rotate is already re-exported via `export * from './jointMath'` — no separate line needed.
export { mergeBores } from './mergeBores';
export { boreGizmoAxis } from './boreGizmoAxis';
export { signedDragDeltaAlongAxis, GIZMO_AXIS_VIEW_PARALLEL_THRESHOLD } from './dragProjection';
export type { PointerRay } from './dragProjection';
export { clampDeltaToFaceExtents } from './clampDelta';
export * from './drawerConventions';
export type { DrawerSlideCtx } from './drawerSlideMath';
export { drawerSlideMath } from './drawerSlideMath';
export type { DrawerBoxPanel, DrawerBoxResult, BoxSlot, BoxOpening } from './drawerBoxMath';
export { drawerBoxMath } from './drawerBoxMath';
export type { ClashKind, ClashPair, ClashLeafMeta, ClashReportRow } from './clash';
export { buildClashReport, VOLUME_THRESHOLD_MM3, CLEARANCE_DEFAULT_MM, isSameCabinetCarcassNoise, CARCASS_ROLES } from './clash';
