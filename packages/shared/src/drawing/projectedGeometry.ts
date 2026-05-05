// packages/shared/src/drawing/projectedGeometry.ts

export type Edge2D = {
  readonly id: string;                                        // stable id: <viewId>_<edgeNameKey>_<runIndex>
  readonly kind: 'silhouette' | 'feature' | 'outline';        // line-weight tier
  readonly points: ReadonlyArray<readonly [number, number]>;  // polyline in part-mm space (pre-scale)
  readonly sourceFaceIds?: readonly string[];                 // back-references to FaceNaming for hover/selection
};

export type ProjectedGeometry = {
  readonly visibleEdges: readonly Edge2D[];
  readonly hiddenEdges:  readonly Edge2D[];
  readonly bbox: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  };
};
