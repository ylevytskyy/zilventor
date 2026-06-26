import type { OcctInstance } from './occtLoader';
import type { EdgeName, FaceName, PanelEdgeKey } from '@zilventor/shared';
import { canonicalEdgeName } from '@zilventor/shared';

/**
 * Result of `buildPanelBox`.
 *
 * - `shape` is the raw OCCT TopoDS_Solid handle (caller-owned; pass it
 *   into a `NamedShape`/feature evaluator the same way other ops do).
 * - `bbox` is the axis-aligned bounding box, computed analytically from
 *   the input dimensions (cheap and exact for the panel's centered box).
 * - `faceNames` maps the six panel face roles to canonical `FaceName`s
 *   under the convention Top=+Z, Bottom=-Z, Front=+Y, Back=-Y,
 *   Left=-X, Right=+X.
 * - `edgeNames` maps the four top-rim edge keys to canonical `EdgeName`s
 *   ({ Top, Front | Back | Left | Right }).
 */
export interface PanelBoxResult {
  shape: unknown;
  bbox: [number, number, number, number, number, number];
  faceNames: Record<'Top' | 'Bottom' | 'Front' | 'Back' | 'Left' | 'Right', FaceName>;
  edgeNames: Record<PanelEdgeKey, EdgeName>;
}

/** Stable feature id for the panel — face/edge names depend only on
 *  spatial classification, never on OCCT-internal identifiers, so the
 *  same dimensions always yield the same canonical names. */
const PANEL_FEATURE_ID = 'panel';

type FaceRole = 'Top' | 'Bottom' | 'Front' | 'Back' | 'Left' | 'Right';

const FACE_ROLES: readonly FaceRole[] = ['Top', 'Bottom', 'Front', 'Back', 'Left', 'Right'];

const namedFace = (role: FaceRole): FaceName => ({
  featureId: PANEL_FEATURE_ID,
  role,
  instance: 0,
});

/**
 * Build an axis-aligned panel box centered on origin in X/Y with bottom
 * face on Z=0. Uses the `BRepPrimAPI_MakeBox_4(P1, P2)` two-corner
 * overload, then classifies the six faces by face-centroid offset from
 * the box center and the four top-rim edges by face-pair adjacency.
 *
 * When `outline` is provided (≥ 3 vertices), builds a prism instead:
 * the polygon is extruded along +Z by `thickness`. Only Top and Bottom
 * face names are populated; side faces are left unnamed. The `bbox` is
 * the conservative axis-aligned bounding rectangle of the dims (not the
 * polygon's true AABB), matching the cut-list convention.
 *
 * Throws when any dimension is non-positive (test asserts via /positive/).
 * Throws when `outline` is provided but has fewer than 3 vertices.
 *
 * Lifecycle:
 *   - The two `gp_Pnt_3` corners and the `BRepPrimAPI_MakeBox_4` are
 *     allocated and disposed locally.
 *   - The returned `shape` is caller-owned; clean up with the same
 *     `disposeShape` helper used elsewhere (or wrap in a NamedShape).
 *   - All face/edge handles produced during exploration are disposed
 *     except the ones we hand back as part of the OCCT shape graph.
 */
export function buildPanelBox(
  occt: OcctInstance,
  dims: { length: number; width: number; thickness: number },
  outline?: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): PanelBoxResult {
  const { length: L, width: W, thickness: T } = dims;
  if (L <= 0 || W <= 0 || T <= 0) {
    throw new Error(`Panel dimensions must be positive (got L=${L}, W=${W}, T=${T})`);
  }

  // Outline path: build a prism from the polygon instead of a rectangular box.
  if (outline !== undefined) {
    if (outline.length < 3) {
      throw new Error(`Panel outline must have at least 3 vertices (got ${outline.length})`);
    }
    return buildOutlinePrism(occt, dims, outline);
  }

  const halfL = L / 2;
  const halfW = W / 2;

  const p1 = new occt.gp_Pnt_3(-halfL, -halfW, 0);
  const p2 = new occt.gp_Pnt_3(halfL, halfW, T);
  const builder = new (occt as unknown as {
    BRepPrimAPI_MakeBox_4: new (a: unknown, b: unknown) => {
      Shape: () => unknown;
      delete: () => void;
    };
  }).BRepPrimAPI_MakeBox_4(p1 as never, p2 as never);
  const shape = builder.Shape();
  builder.delete();
  (p1 as unknown as { delete: () => void }).delete();
  (p2 as unknown as { delete: () => void }).delete();

  const faceByRole = classifyPanelFaces(occt, shape);
  const faceNames: PanelBoxResult['faceNames'] = {
    Top: namedFace('Top'),
    Bottom: namedFace('Bottom'),
    Front: namedFace('Front'),
    Back: namedFace('Back'),
    Left: namedFace('Left'),
    Right: namedFace('Right'),
  };

  const edgeNames = classifyPanelEdges(occt, shape, faceByRole, faceNames);

  return {
    shape,
    bbox: [-halfL, -halfW, 0, halfL, halfW, T],
    faceNames,
    edgeNames,
  };
}

/**
 * Build a prismatic solid from an arbitrary closed polygon outline.
 *
 * The outline vertices are in panel-local coords (top-left = (0,0),
 * x = length axis, y = width axis). They are offset to centered coords
 * (x - L/2, y - W/2) before building the wire, so the prism is centred
 * on the origin in X/Y with its bottom at Z=0, matching the rect path.
 *
 * Winding order: the pentagon test polygon is CCW (viewed from +Z), which
 * produces a face with +Z normal — extruding by +Z gives a valid solid.
 * If a caller supplies CW vertices, OCCT may still produce a valid solid
 * (BRepPrimAPI_MakePrism handles both orientations), but the empirical
 * winding resolution is documented in task-4-report.md.
 *
 * OCCT binding notes (all verified against working code in SketchOps.ts
 * and ExtrudeFeature.ts):
 *   - `gp_Pnt_3(x, y, z)` — three-real ctor (SketchOps.ts:76)
 *   - `BRepBuilderAPI_MakeEdge_3(p1, p2)` — two-point ctor (SketchOps.ts:81)
 *   - `BRepBuilderAPI_MakeWire_1()` — default ctor, Add_1(edge) (SketchOps.ts:91)
 *   - `BRepBuilderAPI_MakeFace_15(wire, onlyPlane)` — wire→face (ExtrudeFeature.ts:65)
 *   - `gp_Vec_4(x, y, z)` — three-real vector ctor (ExtrudeFeature.ts:72)
 *   - `BRepPrimAPI_MakePrism_1(shape, vec, copy, canonize)` (ExtrudeFeature.ts:74)
 *
 * Only Top and Bottom face names are emitted; side faces are unnamed.
 * edgeNames is empty (no top-rim edge classification for non-rect panels).
 */
function buildOutlinePrism(
  occt: OcctInstance,
  dims: { length: number; width: number; thickness: number },
  outline: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): PanelBoxResult {
  const { length: L, width: W, thickness: T } = dims;
  const halfL = L / 2;
  const halfW = W / 2;

  // Build centered points: outline coords are (0,0)→(L,W) panel space;
  // subtract (L/2, W/2) to centre the prism on origin.
  const pts = outline.map(v => new occt.gp_Pnt_3(v.x - halfL, v.y - halfW, 0));

  // Build one edge per adjacent vertex pair, closing the polygon.
  const mkEdges = pts.map((p, i) => {
    const next = pts[(i + 1) % pts.length]!;
    return new occt.BRepBuilderAPI_MakeEdge_3(p as never, next as never);
  });
  const edges = mkEdges.map(mk => mk.Edge());

  // Wire from all edges.
  const mkWire = new occt.BRepBuilderAPI_MakeWire_1();
  for (const e of edges) mkWire.Add_1(e as never);
  const wire = mkWire.Wire();

  // Dispose builders and intermediates (edge topology is copied into wire).
  mkWire.delete();
  for (const mk of mkEdges) mk.delete();
  for (const e of edges) (e as unknown as { delete: () => void }).delete();
  for (const p of pts) (p as unknown as { delete: () => void }).delete();

  // Planar face from closed wire (onlyPlane=true: infer support from wire).
  const mkFace = new occt.BRepBuilderAPI_MakeFace_15(wire as never, true as never);
  const face = mkFace.Face();
  mkFace.delete();
  (wire as unknown as { delete: () => void }).delete();

  // Extrude along +Z by thickness.
  const vec = new occt.gp_Vec_4(0, 0, T);
  const mkPrism = new occt.BRepPrimAPI_MakePrism_1(
    face as never,
    vec as never,
    false as never,  // Copy=false: we own `face` and drop it next
    true as never,   // Canonize=true: downgrade to simpler shape type when possible
  );
  const shape = mkPrism.Shape();
  mkPrism.delete();
  (face as unknown as { delete: () => void }).delete();
  vec.delete();

  // Only Top and Bottom are named; side faces are left for future classification.
  // The cast suppresses TypeScript's requirement for the full 6-role record —
  // callers that need side-face names must check for undefined at runtime.
  return {
    shape,
    bbox: [-halfL, -halfW, 0, halfL, halfW, T],
    faceNames: {
      Top: namedFace('Top'),
      Bottom: namedFace('Bottom'),
    } as unknown as PanelBoxResult['faceNames'],
    edgeNames: {} as unknown as Record<PanelEdgeKey, EdgeName>,
  };
}

/**
 * Walk every TopAbs_FACE in `shape` and bucket each face handle under
 * the role implied by its outward direction. Rather than fighting OCCT's
 * face-orientation bookkeeping, we classify by face *centroid position*
 * relative to the box center: an axis-aligned box has each face centred
 * on one face plane, so the dominant axis of `(centroid − boxCenter)`
 * uniquely picks the role. This is robust regardless of whether OCCT
 * marks a particular face FORWARD or REVERSED in TopExp iteration.
 *
 * Throws if classification is ambiguous — should never happen for the
 * `BRepPrimAPI_MakeBox` output we just built and indicates a precondition
 * break (e.g., caller passed a non-axis-aligned shape).
 */
function classifyPanelFaces(occt: OcctInstance, shape: unknown): Record<FaceRole, unknown> {
  const ocAny = occt as unknown as {
    TopExp_Explorer_2: new (s: unknown, type: unknown, avoid: unknown) => {
      More: () => boolean;
      Current: () => unknown;
      Next: () => void;
      delete: () => void;
    };
    TopAbs_ShapeEnum: { TopAbs_FACE: unknown; TopAbs_SHAPE: unknown };
    GProp_GProps_1: new () => {
      CentreOfMass: () => { X: () => number; Y: () => number; Z: () => number };
      delete: () => void;
    };
    BRepGProp: {
      SurfaceProperties_1: (s: unknown, p: unknown, eps: number, useTri: boolean) => void;
    };
    Bnd_Box_1: new () => {
      CornerMin: () => { X: () => number; Y: () => number; Z: () => number };
      CornerMax: () => { X: () => number; Y: () => number; Z: () => number };
      delete: () => void;
    };
    BRepBndLib: { Add: (s: unknown, b: unknown, useTri: unknown) => void };
  };

  // Compute box center analytically from its bounding box. Cheap and exact.
  const bb = new ocAny.Bnd_Box_1();
  ocAny.BRepBndLib.Add(shape, bb, false as never);
  const cmin = bb.CornerMin();
  const cmax = bb.CornerMax();
  const cx = (cmin.X() + cmax.X()) / 2;
  const cy = (cmin.Y() + cmax.Y()) / 2;
  const cz = (cmin.Z() + cmax.Z()) / 2;
  (cmin as unknown as { delete: () => void }).delete();
  (cmax as unknown as { delete: () => void }).delete();
  bb.delete();

  const out: Partial<Record<FaceRole, unknown>> = {};
  const explorer = new ocAny.TopExp_Explorer_2(
    shape,
    ocAny.TopAbs_ShapeEnum.TopAbs_FACE,
    ocAny.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  try {
    while (explorer.More()) {
      const rawFace = explorer.Current();
      const props = new ocAny.GProp_GProps_1();
      try {
        ocAny.BRepGProp.SurfaceProperties_1(rawFace, props, 1e-7, false);
        const com = props.CentreOfMass();
        const dx = com.X() - cx;
        const dy = com.Y() - cy;
        const dz = com.Z() - cz;
        (com as unknown as { delete: () => void }).delete();
        const role = roleFromOffset(dx, dy, dz);
        if (!role) {
          throw new Error(
            `Panel face centroid offset (${dx}, ${dy}, ${dz}) does not align with any axis`,
          );
        }
        if (out[role]) {
          throw new Error(`Two panel faces classified as ${role} — input is not axis-aligned`);
        }
        out[role] = rawFace;
      } finally {
        props.delete();
      }
      explorer.Next();
    }
  } finally {
    explorer.delete();
  }

  for (const role of FACE_ROLES) {
    if (!out[role]) {
      throw new Error(`Panel face ${role} not found after classification`);
    }
  }
  return out as Record<FaceRole, unknown>;
}

/** Classify a centroid-offset (face_centroid − box_center) into one of
 *  the six panel face roles by picking the dominant axis and its sign.
 *  Returns null if no axis dominates (unreachable for an axis-aligned
 *  box but lets callers surface a defensive error). */
function roleFromOffset(dx: number, dy: number, dz: number): FaceRole | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);
  const eps = 1e-6;
  if (az >= ax && az >= ay && az > eps) return dz > 0 ? 'Top' : 'Bottom';
  if (ay >= ax && ay >= az && ay > eps) return dy > 0 ? 'Front' : 'Back';
  if (ax >= ay && ax >= az && ax > eps) return dx > 0 ? 'Right' : 'Left';
  return null;
}

/**
 * For each top-rim edge key (front/back/left/right), find the unique
 * edge that is shared between the Top face and the corresponding side
 * face. Walks Top's edges via TopExp_Explorer and matches against the
 * side face's edges using TopoDS_Shape.IsSame (same idiom as
 * FaceNaming.resolveEdge).
 *
 * The returned `EdgeName` is canonicalised so { Top, Front } compares
 * equal to { Front, Top } — matching the rest of the naming infra.
 */
function classifyPanelEdges(
  occt: OcctInstance,
  _shape: unknown,
  faceByRole: Record<FaceRole, unknown>,
  faceNames: PanelBoxResult['faceNames'],
): Record<PanelEdgeKey, EdgeName> {
  const ocAny = occt as unknown as {
    TopExp_Explorer_2: new (s: unknown, type: unknown, avoid: unknown) => {
      More: () => boolean;
      Current: () => unknown;
      Next: () => void;
      delete: () => void;
    };
    TopAbs_ShapeEnum: { TopAbs_EDGE: unknown; TopAbs_SHAPE: unknown };
  };

  const collectEdges = (face: unknown): unknown[] => {
    const edges: unknown[] = [];
    const expl = new ocAny.TopExp_Explorer_2(
      face,
      ocAny.TopAbs_ShapeEnum.TopAbs_EDGE,
      ocAny.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (expl.More()) {
      edges.push(expl.Current());
      expl.Next();
    }
    expl.delete();
    return edges;
  };

  const findSharedEdge = (a: unknown, b: unknown): boolean => {
    const edgesA = collectEdges(a);
    const edgesB = collectEdges(b);
    let found = false;
    for (const eA of edgesA) {
      for (const eB of edgesB) {
        if ((eA as { IsSame?: (other: unknown) => boolean }).IsSame?.(eB as never)) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    for (const e of edgesA) (e as { delete?: () => void }).delete?.();
    for (const e of edgesB) (e as { delete?: () => void }).delete?.();
    return found;
  };

  const top = faceByRole.Top;
  const sidePairs: Array<{ key: PanelEdgeKey; sideRole: FaceRole }> = [
    { key: 'front', sideRole: 'Front' },
    { key: 'back', sideRole: 'Back' },
    { key: 'left', sideRole: 'Left' },
    { key: 'right', sideRole: 'Right' },
  ];

  const out: Partial<Record<PanelEdgeKey, EdgeName>> = {};
  for (const { key, sideRole } of sidePairs) {
    if (!findSharedEdge(top, faceByRole[sideRole])) {
      throw new Error(`Panel: no shared edge between Top and ${sideRole}`);
    }
    out[key] = canonicalEdgeName(faceNames.Top, faceNames[sideRole]);
  }

  return out as Record<PanelEdgeKey, EdgeName>;
}
