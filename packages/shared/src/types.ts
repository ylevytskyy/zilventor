import type { SketchConstraint } from './constraints';
import type { SketchParameter, ParameterUnit } from './parameters';
import type { ComponentPath, ComponentPathKey } from './componentPath';
import type { PanelFeature } from './panel-feature';
import type { MaterialEntry } from './material';
import type { HardwareEntry, HardwareFeature } from './hardware-feature';
import type { NestState } from './nesting/nestState';
import type { DrawingDocument } from './drawing/types';
import type { CustomTextureDef } from './custom-texture-def';
import type { BoreOp } from './bore';
import type { GrooveFeature } from './groove';
import type { ShelfPinParams } from './shelfPinGrid';
import type { PanelRole } from './cabinets/types';

/** @deprecated Use ParameterUnit from './parameters' */
export type UnitKind = ParameterUnit;

/** @deprecated Use SketchParameter from './parameters' */
export type Parameter = SketchParameter;

export type BoundingBox = readonly [number, number, number, number, number, number];

export type Mesh = {
  positions: Float32Array;
  indices: Uint32Array;
  boundingBox: BoundingBox;
  uv?: Float32Array;
};

export type SketchPrimitive =
  | { id: string; kind: 'line'; x1: number; y1: number; x2: number; y2: number; construction?: boolean }
  | { id: string; kind: 'rectangle'; x: number; y: number; w: number; h: number; construction?: boolean }
  | { id: string; kind: 'circle'; cx: number; cy: number; r: number; construction?: boolean }
  | { id: string; kind: 'arc'; cx: number; cy: number; r: number; startAngle: number; endAngle: number; construction?: boolean }
  | { id: string; kind: 'spline'; controlPoints: ReadonlyArray<{ x: number; y: number }>; degree: 2 | 3; closed: boolean; construction?: boolean };

export type BooleanOperation = 'new' | 'join' | 'cut';

export type ImportedFeature = {
  kind: 'imported';
  id: string;
  /** Source filename of the originating STEP, for diagnostics only. */
  sourceStep: string;
  /** Blob id of the cached B-rep body. The kernel keeps a runtime
   *  cache keyed by this id; ProjectPacker (un)packs it on save/load. */
  bodyRef: string;
  /** Per-body color (#rrggbb) read from the STEP XCAF data, if any. */
  color?: string;
};

export type Feature =
  | { kind: 'sketch'; id: string; plane: WorkPlaneRef; primitives: SketchPrimitive[]; constraints: SketchConstraint[] }
  | { kind: 'extrude'; id: string; sketchRef: string; distanceParam: string; direction: 'forward' | 'symmetric'; operation: BooleanOperation }
  | { kind: 'revolve'; id: string; sketchRef: string; axisPrimitiveId: string; angleParam: string; direction: 'normal' | 'symmetric' | 'flipped'; operation: BooleanOperation }
  | FilletFeature
  | ChamferFeature
  | ShellFeature
  | LinearPatternFeature
  | MirrorFeature
  | HoleFeature
  | SweepFeature
  | WorkAxisFeature
  | WorkPlaneFeature
  | WorkPointFeature
  | ImportedFeature
  | PanelFeature
  | GrooveFeature
  | HardwareFeature;

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
  properties: Record<string, string | number | boolean>;
  materials: MaterialEntry[];
  hardware: HardwareEntry[];
  customTextures?: CustomTextureDef[];
  /** Intrinsic part color (e.g. from STEP import). Default render color in
   *  part view; seeds ComponentInstance.color on explode/insert. User
   *  colorOverrides still win. */
  color?: ComponentColor;
  /** Intrinsic hardware-boring map (присадка). Default []/absent. Additive v21. */
  bores?: BoreOp[];
  /** ConnectorIds (or shelf-pin bore ids) deleted by the user; regeneration must not
   *  resurrect them.
   *  Absent-not-empty contract (exactOptionalPropertyTypes): never write []. */
  suppressedConnectorIds?: string[];
  /** The система-32 grid params last used to drill this panel's shelf-pin bores.
   *  Persisted by GenerateShelfPinBoresCommand so a later start-offset tweak can
   *  re-run the grid without resetting custom pitch/setbacks. Additive, no migration. */
  shelfPinParams?: ShelfPinParams;
  /** Conditional parameter rules (iLogic-equivalent). When a parameter named in a
   *  rule's `trigger` list changes, the rule's `condition` is evaluated against the
   *  current parameter snapshot and, if true, its `thenSet` assignments are applied
   *  before the next execute. Injected as [] at format v28.
   *  Absent-not-empty contract (exactOptionalPropertyTypes): never write []. */
  rules?: Rule[];
  /** Feature ids suppressed from the regenerated build (iLogic-equivalent feature
   *  suppression). `executeTree` skips any feature whose id appears here, in both
   *  the pre-scan classification loop and the main build loop. Mirror of
   *  suppressedConnectorIds; injected as [] at format v29.
   *  Absent-not-empty contract (exactOptionalPropertyTypes): never write []. */
  suppressedFeatureIds?: string[];
  /** Named iPart configurations (design table). Each configuration maps parameter
   *  names to expressions; activating one bulk-sets those parameters. Injected as []
   *  at format v30.
   *  Absent-not-empty contract (exactOptionalPropertyTypes): never write []. */
  configurations?: Configuration[];
};

/** A named iPart configuration: parameter name → expression overrides applied
 *  together when the configuration is activated. (Milestone 2.5) */
export type Configuration = {
  name: string;
  values: Record<string, string>;
};

/** A single `target = expression` assignment applied when a rule fires. */
export type RuleAssignment = {
  /** Name of the parameter to set. */
  target: string;
  /** Expression evaluated against the current parameter snapshot (see evaluateRule). */
  expression: string;
};

/** A conditional parameter rule (iLogic-equivalent). */
export type Rule = {
  id: string;
  /** Parameter names whose change fires this rule. */
  trigger: string[];
  /** Boolean expression; when it evaluates truthy, `thenSet` is applied. */
  condition: string;
  /** Assignments applied (in order) when `condition` is true. */
  thenSet: RuleAssignment[];
  /** Feature ids toggled by this rule: suppressed when `condition` is true,
   *  un-suppressed when false (so one rule is a clean parametric on/off toggle).
   *  Absent when the rule sets parameters only. (Milestone 2.4) */
  thenSuppress?: string[];
};

export type ComponentColor =
  | { kind: 'palette'; name: string }
  | { kind: 'hex'; hex: string };

/** Door overlay/hinge spec; present only on role:'door' components. Additive v22. */
export type DoorSpec = {
  overlay: 'full' | 'half' | 'inset';
  hingeSide: 'left' | 'right';                 // which vertical edge carries the cups
  pair: 'single' | 'pairLeft' | 'pairRight';   // double-door membership
  hingeCount: number;                          // resolved at creation (auto from height)
};

/** Drawer bank spec; present only on role:'drawerFront'|'drawerBox' components. Additive v24. */
export type DrawerSpec = {
  overlay: 'full' | 'half' | 'inset';
  index: number;   // 0-based slot index within the bank
  count: number;   // total number of drawers in the bank
};

export type ComponentInstance = {
  id: string;
  partPath: string;
  position: { x: number; y: number; z: number };
  rotation: { rx: number; ry: number; rz: number };
  visible: boolean;
  pose?: { translation: Vec3; quaternion: [number, number, number, number] };
  color?: ComponentColor;
  flexible?: boolean;
  /** Carcass role for auto-присадка generation; populated by CreateCabinetCommand. Additive v21.
   *  doorStile/doorRail/doorCenterPanel are the members of a framed (shaker) door's
   *  nested .ziasm — Additive v27. */
  role?: PanelRole | 'drawerFront' | 'drawerBox' | 'drawerHandle' | 'drawerSlide' | 'doorStile' | 'doorRail' | 'doorCenterPanel';
  /** Door overlay/hinge spec; present only on role:'door' components. Additive v22. */
  doorSpec?: DoorSpec;
  /** Drawer bank spec; present only on role:'drawerFront'|'drawerBox' components. Additive v24. */
  drawerSpec?: DrawerSpec;
};

export type AssemblyDocument = {
  id: string;
  name: string;
  units: 'mm';
  parameters: Record<string, SketchParameter>;
  components: ComponentInstance[];
  constraints: AssemblyConstraint[];
  groundedComponentPaths: ComponentPath[];
  colors: Record<string, string>;
  bomItemNumbers: Record<string, number>;
  cutListItemNumbers: Record<string, number>;
  colorOverrides: Record<ComponentPathKey, ComponentColor>;
  properties: Record<string, string | number | boolean>;
  materials: MaterialEntry[];
  hardware: HardwareEntry[];
  customTextures?: CustomTextureDef[];
  nest?: NestState;
};

export type AssemblyConstraintRef =
  | { kind: 'face';  componentPath: ComponentPath; face: FaceName }
  | { kind: 'axis';  componentPath: ComponentPath; axis:
        | { source: 'cylindricalFace'; face: FaceName }
        | { source: 'edge'; edge: EdgeName }
        | { source: 'workAxis'; featureId: string } }
  | { kind: 'point'; componentPath: ComponentPath; point:
        | { source: 'vertex'; edge: EdgeName; end: 'start' | 'end' }
        | { source: 'workPoint'; featureId: string } };

export type AssemblyConstraint =
  | { id: string; kind: 'mate';   refA: AssemblyConstraintRef; refB: AssemblyConstraintRef; offset: ParamOrLiteral; suppressed: boolean }
  | { id: string; kind: 'flush';  refA: AssemblyConstraintRef; refB: AssemblyConstraintRef; offset: ParamOrLiteral; suppressed: boolean }
  | { id: string; kind: 'angle';  refA: AssemblyConstraintRef; refB: AssemblyConstraintRef; angle:  ParamOrLiteral; suppressed: boolean }
  | { id: string; kind: 'insert';
      refA: { componentPath: ComponentPath; circularEdge: EdgeName };
      refB: { componentPath: ComponentPath; circularEdge: EdgeName };
      offset: ParamOrLiteral; suppressed: boolean }
  | { id: string; kind: 'tangent';
      refA: AssemblyConstraintRef;
      refB: AssemblyConstraintRef;
      radius?: ParamOrLiteral;   // cyl↔plane: cylinder radius
      r1?: ParamOrLiteral;       // cyl↔cyl: radius of cylinder A
      r2?: ParamOrLiteral;       // cyl↔cyl: radius of cylinder B
      suppressed: boolean };

// Union includes every version the migration table can currently produce — when CURRENT_FORMAT_VERSION
// bumps, add the new literal here too. Persisted files always migrate to CURRENT_FORMAT_VERSION at load.
export type ProjectFile =
  | { formatVersion: 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26; kind: 'part';     createdAt: string; appVersion: string; document: PartDocument }
  | { formatVersion: 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26; kind: 'assembly'; createdAt: string; appVersion: string; document: AssemblyDocument }
  | { formatVersion: 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26;                                  kind: 'drawing';  createdAt: string; appVersion: string; document: DrawingDocument };

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
  | { kind: 'concentric'; faceName: FaceName; circularEdgeName: EdgeName }
  | { kind: 'atFace'; faceName: FaceName; points: ReadonlyArray<{ u: number; v: number }>; axis: 'into-face' };

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

export type SweepOrientation =
  | { kind: 'path' }
  | { kind: 'parallel' }
  | { kind: 'guideRail'; guideRailSketchId: string };

export type SweepFeature = {
  id: string;
  kind: 'sweep';
  profileSketchId: string;
  pathSketchId: string;
  orientation: SweepOrientation;
  operation: BooleanOperation;
};

export type WorkAxisRef =
  | { source: 'cylindricalFace'; face: FaceName }
  | { source: 'edge'; edge: EdgeName }
  | { source: 'workAxis'; featureId: string };

export type WorkPlaneRef =
  | { source: 'face'; face: FaceName }
  | { source: 'workPlane'; featureId: string };

export type WorkPointRef =
  | { source: 'vertex'; edge: EdgeName; end: 'start' | 'end' }
  | { source: 'workPoint'; featureId: string };

export type WorkAxisFeature = {
  kind: 'workAxis'; id: string; name?: string; visible: boolean;
  source:
    | { mode: 'cylindricalFace'; face: FaceName }
    | { mode: 'twoPoints'; pointA: WorkPointRef; pointB: WorkPointRef }
    | { mode: 'edge'; edge: EdgeName }
    | { mode: 'twoPlanes'; planeA: WorkPlaneRef; planeB: WorkPlaneRef }
    | { mode: 'normalToPlaneThroughPoint'; plane: WorkPlaneRef; point: WorkPointRef }
    | { mode: 'origin'; axis: 'X' | 'Y' | 'Z' };
};

export type WorkPlaneFeature = {
  kind: 'workPlane'; id: string; name?: string; visible: boolean;
  source:
    | { mode: 'offsetFromPlane'; plane: WorkPlaneRef; offset: ParamOrLiteral }
    | { mode: 'threePoints'; points: [WorkPointRef, WorkPointRef, WorkPointRef] }
    | { mode: 'axisAtAngleToPlane'; axis: WorkAxisRef; plane: WorkPlaneRef; angle: ParamOrLiteral }
    | { mode: 'tangentToSurfaceParallelToPlane'; face: FaceName; plane: WorkPlaneRef }
    | { mode: 'axisPerpendicularToPlane'; axis: WorkAxisRef; plane: WorkPlaneRef }
    | { mode: 'midplane'; planeA: WorkPlaneRef; planeB: WorkPlaneRef }
    | { mode: 'origin'; plane: 'XY' | 'YZ' | 'XZ' };
};

export type WorkPointFeature = {
  kind: 'workPoint'; id: string; name?: string; visible: boolean;
  source:
    | { mode: 'vertex'; edge: EdgeName; end: 'start' | 'end' }
    | { mode: 'midpointOfEdge'; edge: EdgeName }
    | { mode: 'centerOfArc'; face: FaceName }
    | { mode: 'axisIntersectsPlane'; axis: WorkAxisRef; plane: WorkPlaneRef }
    | { mode: 'threePlanes'; planes: [WorkPlaneRef, WorkPlaneRef, WorkPlaneRef] }
    | { mode: 'origin' };
};

export type WorkFeatureValue =
  | { featureId: string; kind: 'axis'; origin: Vec3; direction: Vec3 }
  | { featureId: string; kind: 'plane'; origin: Vec3; normal: Vec3 }
  | { featureId: string; kind: 'point'; position: Vec3 };

/**
 * Extract the origin-plane literal ('XY' | 'YZ' | 'XZ') from a WorkPlaneRef
 * if it points at an origin work plane. Returns null otherwise.
 *
 * Used by feature evaluators that haven't yet been ported to the full
 * resolveWorkPlaneRef chain (Plan Tasks 8-14). After 3c is complete
 * this helper can be removed in favor of the full resolver.
 */
export function originPlaneLiteralOf(ref: WorkPlaneRef): 'XY' | 'YZ' | 'XZ' | null {
  if (ref.source !== 'workPlane') return null;
  if (ref.featureId === 'origin.XY') return 'XY';
  if (ref.featureId === 'origin.YZ') return 'YZ';
  if (ref.featureId === 'origin.XZ') return 'XZ';
  return null;
}

export function isImportedPart(doc: PartDocument): boolean {
  const nonOrigin = doc.featureTree.filter((f) => !(typeof f.id === 'string' && f.id.startsWith('origin.')));
  return nonOrigin.length === 1 && nonOrigin[0]!.kind === 'imported';
}
