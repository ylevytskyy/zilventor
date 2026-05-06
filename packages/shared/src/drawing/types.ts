// packages/shared/src/drawing/types.ts

import type { ProjectedGeometry, Edge2D } from './projectedGeometry';

// ---------------------------------------------------------------------------
// ISO sheet sizes (mm) — landscape orientation as listed; orientation field
// on DrawingSheet rotates them to portrait when needed.
// ---------------------------------------------------------------------------

export const ISO_SIZES_MM = {
  A0: { w: 1189, h: 841 },
  A1: { w:  841, h: 594 },
  A2: { w:  594, h: 420 },
  A3: { w:  420, h: 297 },
  A4: { w:  297, h: 210 },
} as const;

// ---------------------------------------------------------------------------
// Vec2 — reusable 2-D point in mm
// ---------------------------------------------------------------------------

export type Vec2 = { readonly x: number; readonly y: number };

// ---------------------------------------------------------------------------
// SheetSize
// ---------------------------------------------------------------------------

export type SheetSize =
  | { readonly kind: 'iso';    readonly size: 'A0' | 'A1' | 'A2' | 'A3' | 'A4' }
  | { readonly kind: 'custom'; readonly widthMm: number; readonly heightMm: number };

// ---------------------------------------------------------------------------
// DrawingSource
// ---------------------------------------------------------------------------

export type DrawingSource = {
  readonly partPath: string;              // project-relative path: 'parts/cabinet1.zipt'
  readonly sourceKind: 'part' | 'assembly';
};

// ---------------------------------------------------------------------------
// ViewScale  (e.g. 1:1 → { numerator: 1, denominator: 1 })
// ---------------------------------------------------------------------------

export type ViewScale = {
  readonly numerator: number;
  readonly denominator: number;
};

// ---------------------------------------------------------------------------
// BreakRegion — one axis-aligned band removed from a view (spec §5.1)
// ---------------------------------------------------------------------------

export type BreakRegion = {
  readonly id: string;           // nanoid(); stable across undo/redo
  readonly axis: 'x' | 'y';     // which axis the band is perpendicular to
  readonly coordA: number;       // view-local mm (pre-scale); lesser boundary
  readonly coordB: number;       // view-local mm (pre-scale); greater boundary; coordB > coordA ALWAYS
  readonly gapMm: number;        // visible gap on sheet after collapse; default 5
  readonly style: 'zigzag';      // wave/double deferred to F3.1; field exists for forward compat
};

// ---------------------------------------------------------------------------
// DrawingView union
// ---------------------------------------------------------------------------

export type BaseView = {
  readonly id: string;
  readonly kind: 'base';
  readonly positionMm: { readonly x: number; readonly y: number };
  readonly scale: ViewScale;
  readonly orientation: 'front' | 'top' | 'right' | 'back' | 'bottom' | 'left';
  readonly showHidden: boolean;
  readonly projection?: ProjectedGeometry;
  readonly inputFingerprint?: string;
};

export type ProjectedView = {
  readonly id: string;
  readonly kind: 'projected';
  readonly positionMm: { readonly x: number; readonly y: number };
  readonly baseViewId: string;
  readonly direction: 'top' | 'bottom' | 'left' | 'right';
  readonly scale: ViewScale;
  readonly showHidden: boolean;
  readonly projection?: ProjectedGeometry;
  readonly inputFingerprint?: string;
};

export type IsoView = {
  readonly id: string;
  readonly kind: 'iso';
  readonly positionMm: { readonly x: number; readonly y: number };
  readonly corner: 'NE' | 'NW' | 'SE' | 'SW';
  readonly scale: ViewScale;
  readonly showHidden: boolean;
  readonly projection?: ProjectedGeometry;
  readonly inputFingerprint?: string;
};

// ---------------------------------------------------------------------------
// HatchSegment — one hatch line in mm space (pre-scale), tagged by material
// ---------------------------------------------------------------------------

export type HatchSegment = {
  readonly p0: Vec2;
  readonly p1: Vec2;
  readonly materialId: string;
};

// ---------------------------------------------------------------------------
// SectionView — ANSI-style cut view derived from a parent BaseView
// ---------------------------------------------------------------------------

export type SectionView = {
  readonly id: string;
  readonly kind: 'section';
  readonly parentViewId: string;
  readonly sectionLine: { readonly p0: Vec2; readonly p1: Vec2 };
  readonly arrowDirection: -1 | 1;   // +1 = arrows point toward increasing Y
  readonly label: string;            // auto-allocated: 'A', 'B', …, 'AA', …
  readonly positionMm: Vec2;
  readonly scale: ViewScale;
  readonly showHidden: false;        // literal — ANSI convention: never show hidden in section
  readonly plane?: { readonly origin: { readonly x: number; readonly y: number; readonly z: number }; readonly normal: { readonly x: number; readonly y: number; readonly z: number } };
  readonly hatchSegments: readonly HatchSegment[];
  readonly fingerprint: string;      // SHA-256 of cut-plane + source geometry
  readonly projection?: {            // populated after first cut+project; absent until then
    readonly visibleEdges: readonly Edge2D[];
    readonly hiddenEdges: readonly Edge2D[];
    readonly bbox: { minX: number; minY: number; maxX: number; maxY: number };
  };
  readonly inputFingerprint?: string; // mirrors BaseView/ProjectedView stale-banner pattern
};

// ---------------------------------------------------------------------------
// RegionParent — circular region in parent view's local mm space (pre-scale)
// ---------------------------------------------------------------------------

export type RegionParent = {
  readonly center: Vec2;      // in parent view's local mm space (pre-scale)
  readonly radiusMm: number;  // in parent view's local mm space (pre-scale)
};

// ---------------------------------------------------------------------------
// DetailView — ANSI-style circular detail view clipped from a parent view
// ---------------------------------------------------------------------------

export type DetailView = {
  readonly id: string;
  readonly kind: 'detail';
  readonly parentViewId: string;
  readonly regionParent: RegionParent;  // circular region in parent-local mm space
  readonly label: string;               // auto-allocated from shared callout pool: 'A', 'B', …
  readonly positionMm: Vec2;            // sheet-space drop position
  readonly scale: ViewScale;            // default { numerator: 2, denominator: 1 } at create time
  readonly showHidden: boolean;         // inherited from parent at create time
  readonly projection?: {              // populated after first clip; absent until then
    readonly visibleEdges: readonly Edge2D[];
    readonly hiddenEdges: readonly Edge2D[];
    readonly bbox: { minX: number; minY: number; maxX: number; maxY: number };
  };
  readonly inputFingerprint?: string;  // djb2 of parentInputFingerprint + regionParent + scale
};

export type DrawingView =
  | BaseView
  | ProjectedView
  | IsoView
  | SectionView
  | DetailView;

// ---------------------------------------------------------------------------
// PointRef — used by dimensions to reference edge geometry
// ---------------------------------------------------------------------------

export type PointRef =
  | { readonly kind: 'edge-endpoint'; readonly edgeId: string; readonly end: 'start' | 'end' }
  | { readonly kind: 'edge-midpoint'; readonly edgeId: string }
  | { readonly kind: 'arc-center';    readonly edgeId: string };

// ---------------------------------------------------------------------------
// DrawingDimension union
// ---------------------------------------------------------------------------

export type DrawingDimension =
  | { readonly id: string; readonly kind: 'linear-h';  readonly viewId: string; readonly from: PointRef; readonly to: PointRef; readonly offsetMm: number }
  | { readonly id: string; readonly kind: 'linear-v';  readonly viewId: string; readonly from: PointRef; readonly to: PointRef; readonly offsetMm: number }
  | { readonly id: string; readonly kind: 'aligned';   readonly viewId: string; readonly from: PointRef; readonly to: PointRef; readonly offsetMm: number }
  | { readonly id: string; readonly kind: 'radial';    readonly viewId: string; readonly edgeId: string; readonly offsetMm: number; readonly angleDeg: number }
  | { readonly id: string; readonly kind: 'diametric'; readonly viewId: string; readonly edgeId: string; readonly offsetMm: number; readonly angleDeg: number };

// ---------------------------------------------------------------------------
// DrawingAnnotation union
// ---------------------------------------------------------------------------

export type DrawingAnnotation =
  | { readonly id: string; readonly kind: 'centerline';  readonly viewId: string; readonly edgeIdA: string; readonly edgeIdB: string }
  | { readonly id: string; readonly kind: 'center-mark'; readonly viewId: string; readonly edgeId: string }
  | { readonly id: string; readonly kind: 'leader';      readonly viewId: string; readonly targetMm: { readonly x: number; readonly y: number }; readonly textPosMm: { readonly x: number; readonly y: number }; readonly text: string }
  | { readonly id: string; readonly kind: 'balloon';     readonly viewId: string; readonly targetMm: { readonly x: number; readonly y: number }; readonly textPosMm: { readonly x: number; readonly y: number }; readonly itemNumber: number };

// ---------------------------------------------------------------------------
// TitleBlockOverrides — all fields optional; blanks fall back to auto-derived
// ---------------------------------------------------------------------------

export type TitleBlockOverrides = {
  readonly drawingName?: string;
  readonly partName?: string;
  readonly drawnBy?: string;
  readonly approvedBy?: string;
  readonly scaleText?: string;   // e.g. "1:5" — auto = primary base view's scale
  readonly date?: string;        // ISO yyyy-mm-dd
  readonly material?: string;
  readonly revision?: string;
  readonly notes?: string;
};

// ---------------------------------------------------------------------------
// DrawingSheet
// ---------------------------------------------------------------------------

export type DrawingSheet = {
  readonly id: string;
  readonly name: string;
  readonly size: SheetSize;
  readonly orientation: 'landscape' | 'portrait';
  readonly views: readonly DrawingView[];
  readonly dimensions: readonly DrawingDimension[];
  readonly annotations: readonly DrawingAnnotation[];
  readonly titleBlock: TitleBlockOverrides;
};

// ---------------------------------------------------------------------------
// DrawingDocument
// ---------------------------------------------------------------------------

export type DrawingDocument = {
  readonly id: string;
  readonly name: string;
  readonly units: 'mm';
  readonly source: DrawingSource;
  readonly properties: Record<string, string | number | boolean>;
  readonly sheets: readonly DrawingSheet[];
  readonly activeSheetId: string;
};
