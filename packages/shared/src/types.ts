import type { SketchConstraint } from './constraints';
import type { SketchParameter, ParameterUnit } from './parameters';

/** @deprecated Use ParameterUnit from './parameters' */
export type UnitKind = ParameterUnit;

/** @deprecated Use SketchParameter from './parameters' */
export type Parameter = SketchParameter;

export type BoundingBox = readonly [number, number, number, number, number, number];

export type Mesh = {
  positions: Float32Array;
  indices: Uint32Array;
  boundingBox: BoundingBox;
};

export type SketchPrimitive =
  | { id: string; kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { id: string; kind: 'rectangle'; x: number; y: number; w: number; h: number }
  | { id: string; kind: 'circle'; cx: number; cy: number; r: number }
  | { id: string; kind: 'arc'; cx: number; cy: number; r: number; startAngle: number; endAngle: number }
  | { id: string; kind: 'spline'; controlPoints: ReadonlyArray<{ x: number; y: number }>; degree: 2 | 3; closed: boolean };

export type BooleanOperation = 'new' | 'join' | 'cut';

export type Feature =
  | { kind: 'sketch'; id: string; plane: 'XY' | 'XZ' | 'YZ'; primitives: SketchPrimitive[]; constraints: SketchConstraint[] }
  | { kind: 'extrude'; id: string; sketchRef: string; distanceParam: string; direction: 'forward' | 'symmetric'; operation: BooleanOperation }
  | { kind: 'revolve'; id: string; sketchRef: string; axisPrimitiveId: string; angleParam: string; direction: 'normal' | 'symmetric' | 'flipped'; operation: BooleanOperation }
  | FilletFeature
  | ChamferFeature
  | ShellFeature
  | LinearPatternFeature
  | MirrorFeature
  | HoleFeature;

export type CachedGeometry = {
  brepBlobId: string;
  triangleCount: number;
  boundingBox: BoundingBox;
};

export type PartDocument = {
  id: string;
  name: string;
  units: 'mm';
  parameters: Record<string, SketchParameter>;
  featureTree: Feature[];
  cachedGeometry?: CachedGeometry;
};

export type AssemblyDocument = { id: string; name: string };

export type ProjectFile = {
  formatVersion: 6;
  kind: 'part' | 'assembly';
  createdAt: string;
  appVersion: string;
  document: PartDocument | AssemblyDocument;
};

export type FaceName = {
  featureId: string;
  role: string;
  instance?: number;
};

export type EdgeName = {
  faceA: FaceName;
  faceB: FaceName;
};

function faceNameKey(f: FaceName): string {
  return `${f.featureId}|${f.role}|${f.instance ?? 0}`;
}

/**
 * Canonicalize the edge name so {A,B} and {B,A} compare structurally equal.
 * Sort by the string key.
 */
export function canonicalEdgeName(a: FaceName, b: FaceName): EdgeName {
  const [first, second] = faceNameKey(a) <= faceNameKey(b) ? [a, b] : [b, a];
  return { faceA: first, faceB: second };
}

export type Vec3 = { x: number; y: number; z: number };

export type TessellatedEdge = {
  edgeName: EdgeName;
  segments: Array<[Vec3, Vec3]>;
  faceNames: [FaceName, FaceName];
  dihedralAngle?: number;
};

export type TessellatedFace = {
  name: FaceName;
  /** Triangle index into the Mesh's indices array (0-based, in units of
   *  triangles, not indices). The three index values for this tri are at
   *  `indices[3*triIndex], 3*triIndex+1, 3*triIndex+2`.
   */
  triangleStart: number;
  triangleCount: number;
};

export type FilletSelectionMode = 'edge' | 'loop' | 'feature' | 'all-fillets' | 'all-rounds';

export type ParamOrLiteral =
  | { kind: 'param'; paramName: string }
  | { kind: 'literal'; value: number };

export type FilletEdgeSpec = {
  edgeId: EdgeName;
  selectionMode: FilletSelectionMode;
  radius: ParamOrLiteral;
  variableRadii?: {
    startRadius: ParamOrLiteral;
    endRadius: ParamOrLiteral;
  };
};

export type VertexSetback = {
  vertexId: { edges: EdgeName[] };
  perEdgeSetbacks: Array<{ edgeId: EdgeName; setback: ParamOrLiteral }>;
};

export type FilletFeature = {
  kind: 'fillet';
  id: string;
  mode: 'constant' | 'variable';
  edges: FilletEdgeSpec[];
  setbacks: VertexSetback[];
};

export type ChamferEdgeSpec = {
  edgeId: EdgeName;
  selectionMode: FilletSelectionMode;
  distance: ParamOrLiteral;
};

export type ChamferFeature = {
  kind: 'chamfer';
  id: string;
  edges: ChamferEdgeSpec[];
};

export type PatternAxis = 'x' | 'y' | 'z';

export type LinearPatternFeature = {
  kind: 'pattern-linear';
  id: string;
  /** Id of the extrude or revolve feature whose geometry is replicated. */
  sourceFeatureId: string;
  /** World-axis direction. Arbitrary directions (sketch edge / axis) are a
   *  follow-up — today's MVP ships with axis-only picks.
   */
  direction: PatternAxis;
  /** Spacing between consecutive copies (mm). */
  spacing: ParamOrLiteral;
  /** Total number of copies including the source (>= 1; 1 = no replication). */
  count: number;
};

export type MirrorPlane = 'xy' | 'yz' | 'xz';

export type MirrorFeature = {
  kind: 'mirror';
  id: string;
  /** Id of the extrude or revolve whose geometry is reflected. */
  sourceFeatureId: string;
  /** World coordinate plane across which to reflect. Arbitrary planes
   *  (sketch face / named face) are a follow-up.
   */
  plane: MirrorPlane;
};

export type ShellFeature = {
  kind: 'shell';
  id: string;
  /** Faces to remove (become openings in the shelled body). */
  facesToRemove: FaceName[];
  /** Positive = thicken outward; negative = hollow inward. Typical hollow
   * uses `{ kind: 'literal', value: -1 }` for a 1 mm wall.
   */
  thickness: ParamOrLiteral;
};

export type HolePlacement =
  | { kind: 'fromSketch'; sketchId: string }
  | {
      kind: 'linear';
      faceName: FaceName;
      refEdge1: EdgeName;
      offset1: ParamOrLiteral;
      refEdge2: EdgeName;
      offset2: ParamOrLiteral;
    }
  | { kind: 'concentric'; faceName: FaceName; circularEdgeName: EdgeName };

export type HoleProfile =
  | { kind: 'simple'; diameter: ParamOrLiteral }
  | {
      kind: 'counterbore';
      diameter: ParamOrLiteral;
      cboreDiameter: ParamOrLiteral;
      cboreDepth: ParamOrLiteral;
    }
  | {
      kind: 'countersink';
      diameter: ParamOrLiteral;
      cskDiameter: ParamOrLiteral;
      cskAngle: ParamOrLiteral;  // full included angle, default 82°
    };

export type HoleTermination =
  | { kind: 'distance'; depth: ParamOrLiteral }
  | { kind: 'throughAll' }
  | { kind: 'toFace'; targetFaceName: FaceName }
  | { kind: 'toNext' };

export type HoleFeature = {
  id: string;
  kind: 'hole';
  placement: HolePlacement;
  profile: HoleProfile;
  termination: HoleTermination;
  flipAxis: boolean;
};
