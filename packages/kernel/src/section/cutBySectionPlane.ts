import type { AssemblyDocument } from '@zilventor/shared';
import type { OcctInstance } from '../occt/occtLoader';
import type { OcctShape } from '../occt/SolidOps';
import type { Vec3 } from '@zilventor/shared';
import { hashFace, classifyFace, extractFaceBoundary3D } from './faceTag';
import { computeBoundingBox } from '../occt/SolidOps';
import { quatMultiply, quatRotateVec } from '../assembly/quat';

export type Plane = { origin: Vec3; normal: Vec3 };

// Half-space box dimensions (mm): face-coincident side has zero extent along normal.
const BOX_HALF = 2_000_000; // 2 km half-width in both transverse axes
const BOX_DEPTH = 1_000_000; // 1 km depth along the normal

/**
 * Build a 2km×2km×1km solid whose face at local Z=0 is coincident with
 * `plane`. The solid grows in the direction OPPOSITE to `arrowDirection*normal`.
 *
 * arrowDirection=1  → solid is on the -normal side of the plane
 * arrowDirection=-1 → solid is on the +normal side of the plane
 */
export function buildHalfSpace(
  oc: OcctInstance,
  plane: Plane,
  arrowDirection: -1 | 1
): OcctShape {
  // 1. Make a box at the OCCT origin: [0,BOX_HALF]×[0,BOX_HALF]×[0,BOX_DEPTH]
  const mk = new oc.BRepPrimAPI_MakeBox_2(BOX_HALF, BOX_HALF, BOX_DEPTH);
  const rawBox = mk.Shape();
  mk.delete();

  // 2. Translate so the Z=0 face is centred at the local origin.
  const tx = new oc.gp_Trsf_1();
  const tv = new oc.gp_Vec_4(-BOX_HALF / 2, -BOX_HALF / 2, 0);
  (tx as unknown as { SetTranslation_1(v: unknown): void }).SetTranslation_1(tv as never);
  const centred = new oc.BRepBuilderAPI_Transform_2(rawBox as never, tx as never, true as never);
  const centredShape = (centred as unknown as { Shape(): unknown }).Shape();
  (centred as unknown as { delete(): void }).delete();
  (tx as unknown as { delete(): void }).delete();
  (tv as unknown as { delete(): void }).delete();

  // 3. Compute the keep-direction: opposite to arrowDirection*normal.
  const { normal, origin } = plane;
  const sign = -arrowDirection as number;
  const nx = normal.x * sign;
  const ny = normal.y * sign;
  const nz = normal.z * sign;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;

  const keepDir = new oc.gp_Dir_4(nx / len, ny / len, nz / len);
  const orig    = new oc.gp_Pnt_3(origin.x, origin.y, origin.z);

  // gp_Ax3_4(origin, dir) → Z-axis = keepDir
  // NOTE: the plan used gp_Ax3_2(orig, keepDir) but in this OCCT build
  //       gp_Ax3_2 takes a gp_Ax2 argument. The correct ctor is gp_Ax3_4(gp_Pnt, gp_Dir).
  const worldAx3 = new oc.gp_Ax3_4(orig as never, keepDir as never);
  // gp_Ax3_1() = no-arg default: origin (0,0,0), Z-axis (0,0,1)
  // NOTE: the plan used gp_Ax3_4() (no-arg), but that ctor takes (gp_Pnt, gp_Dir).
  //       The correct no-arg ctor is gp_Ax3_1().
  const localAx3 = new oc.gp_Ax3_1();
  const align = new oc.gp_Trsf_1();
  (align as unknown as { SetTransformation_1(a: unknown, b: unknown): void })
    .SetTransformation_1(worldAx3 as never, localAx3 as never);

  const xform = new oc.BRepBuilderAPI_Transform_2(centredShape as never, align as never, true as never);
  const result = (xform as unknown as { Shape(): unknown }).Shape();
  (xform as unknown as { delete(): void }).delete();
  (align as unknown as { delete(): void }).delete();
  (localAx3 as unknown as { delete(): void }).delete();
  (worldAx3 as unknown as { delete(): void }).delete();
  (orig as unknown as { delete(): void }).delete();
  (keepDir as unknown as { delete(): void }).delete();
  (centredShape as unknown as { delete?(): void }).delete?.();

  return { __brand: 'OcctShape', handle: result };
}

// --- quarter-box helper for half-section ---

const QUARTER_BOX_EPS = 1.0; // mm overshoot to ensure full coverage

/**
 * Build an AABB that covers the quadrant to be subtracted in a half-section cut.
 * The box spans the portion of `source`'s bounding box that lies:
 *   - on the arrowDirection side of sectionPlane
 *   - on the splitSide side of splitPlane
 *
 * Axis-aligned section/split planes only. Works correctly for furniture-CAD
 * where all planes are aligned to a dominant axis.
 */
export function buildQuarterBox(
  oc: OcctInstance,
  source: OcctShape,
  sectionPlane: Plane,
  arrowDirection: -1 | 1,
  splitPlane: Plane,
  splitSide: -1 | 1,
): OcctShape {
  const [xmin, ymin, zmin, xmax, ymax, zmax] = computeBoundingBox(oc, source);
  const e = QUARTER_BOX_EPS;

  let lo = { x: xmin - e, y: ymin - e, z: zmin - e };
  let hi = { x: xmax + e, y: ymax + e, z: zmax + e };

  function clipToPlaneSide(
    bLo: { x: number; y: number; z: number },
    bHi: { x: number; y: number; z: number },
    plane: Plane,
    keepSign: number,
  ): { lo: { x: number; y: number; z: number }; hi: { x: number; y: number; z: number } } {
    const { normal: n, origin: o } = plane;
    const ax = Math.abs(n.x); const ay = Math.abs(n.y); const az = Math.abs(n.z);
    const lo2 = { ...bLo }; const hi2 = { ...bHi };
    if (ax >= ay && ax >= az) {
      if (keepSign * n.x > 0) { lo2.x = o.x; } else { hi2.x = o.x; }
    } else if (ay >= ax && ay >= az) {
      if (keepSign * n.y > 0) { lo2.y = o.y; } else { hi2.y = o.y; }
    } else {
      if (keepSign * n.z > 0) { lo2.z = o.z; } else { hi2.z = o.z; }
    }
    return { lo: lo2, hi: hi2 };
  }

  const r1 = clipToPlaneSide(lo, hi, sectionPlane, arrowDirection);
  const r2 = clipToPlaneSide(r1.lo, r1.hi, splitPlane, splitSide);
  lo = r2.lo; hi = r2.hi;

  const dx = Math.max(hi.x - lo.x, 0.001);
  const dy = Math.max(hi.y - lo.y, 0.001);
  const dz = Math.max(hi.z - lo.z, 0.001);

  const mk = new oc.BRepPrimAPI_MakeBox_2(dx, dy, dz);
  const rawBox = mk.Shape();
  mk.delete();

  const tx = new oc.gp_Trsf_1();
  const tv = new oc.gp_Vec_4(lo.x, lo.y, lo.z);
  (tx as unknown as { SetTranslation_1(v: unknown): void }).SetTranslation_1(tv as never);
  const xform = new oc.BRepBuilderAPI_Transform_2(rawBox as never, tx as never, true as never);
  const result = (xform as unknown as { Shape(): unknown }).Shape();
  (xform as unknown as { delete(): void }).delete();
  (tx as unknown as { delete(): void }).delete();
  (tv as unknown as { delete(): void }).delete();
  (rawBox as unknown as { delete?(): void }).delete?.();

  return { __brand: 'OcctShape', handle: result };
}

// --- types ---

export type FaceTagMap = Map<string, {
  tag: 'cut-face' | 'original-face';
  partId: string;
  materialId: string;
  polygon3D?: Vec3[];
  planeSource?: 'section' | 'split';  // present only on cut-face entries for half-section (F1.1)
}>;

export type Result =
  | { ok: true;  compound: unknown /* TopoDS_Compound */; faceTags: FaceTagMap }
  | { ok: false; reason: 'tangent' | 'empty' };

/**
 * Cut `source` compound by the half-space defined by `plane`/`arrowDirection`.
 *
 * 1. Build half-space solid (Task 5).
 * 2. BRepAlgoAPI_Cut_3 — source minus half-space.
 * 3. Walk result faces via TopExp_Explorer; classify each via classifyFace.
 * 4. Tangent detection: if the result volume equals the source volume within
 *    1e-6 relative tolerance, the plane was coincident with a face → 'tangent'.
 *    If the result compound has no solids → 'empty'.
 */
export function cutBySectionPlane(
  oc: OcctInstance,
  source: unknown /* TopoDS_Compound */,
  plane: Plane,
  arrowDirection: -1 | 1,
  splitPlane?: Plane,   // second cutting plane for half-section (omitted → full section)
  splitSide?: -1 | 1,  // which side of splitPlane to remove (omitted when splitPlane omitted)
): Result {
  if (splitPlane !== undefined) {
    // HALF-SECTION PATH: remove only the quadrant at the intersection of both
    // cutting half-spaces. We use a single BRepAlgoAPI_Cut against the quarter-box
    // (which is already clipped to the intersection of both planes' "remove" sides).
    if (splitSide === undefined) return { ok: false, reason: 'empty' };

    const sourceShape: OcctShape = { __brand: 'OcctShape', handle: source };
    const quarterBox = buildQuarterBox(oc, sourceShape, plane, arrowDirection, splitPlane, splitSide);
    const ra = new oc.Message_ProgressRange_1();
    const rb = new oc.Message_ProgressRange_1();
    let cut: unknown; let cutOk = false;
    try {
      const cutter = new oc.BRepAlgoAPI_Cut_3(source as never, quarterBox.handle as never, ra);
      cutter.Build(rb);
      if (cutter.IsDone()) { cut = cutter.Shape(); cutOk = true; }
      cutter.delete();
    } finally {
      ra.delete(); rb.delete();
      (quarterBox.handle as unknown as { delete(): void }).delete();
    }
    if (!cutOk) return { ok: false, reason: 'empty' };

    // Empty check
    const solidExpH = new oc.TopExp_Explorer_2(cut as never, oc.TopAbs_ShapeEnum.TopAbs_SOLID as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never);
    const hasSolidH = solidExpH.More();
    solidExpH.delete();
    if (!hasSolidH) { (cut as unknown as { delete?(): void }).delete?.(); return { ok: false, reason: 'empty' }; }

    // Tangent check: if the quarter-box misses the source, volume is unchanged
    const volSrcH  = shapeVolume(oc, source);
    const volCutH  = shapeVolume(oc, cut);
    if (volSrcH > 0 && Math.abs(volCutH - volSrcH) < Math.max(volSrcH, 1) * 1e-6) {
      (cut as unknown as { delete?(): void }).delete?.();
      return { ok: false, reason: 'tangent' };
    }

    // Classify faces — cut faces from sectionPlane get planeSource='section',
    // cut faces from splitPlane get planeSource='split', originals get no planeSource.
    const halfFaceTags: FaceTagMap = new Map();
    const faceExpH = new oc.TopExp_Explorer_2(cut as never, oc.TopAbs_ShapeEnum.TopAbs_FACE as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never);
    while (faceExpH.More()) {
      const face = faceExpH.Current();
      const key = hashFace(oc, face);
      if (classifyFace(oc, face, plane) === 'cut-face') {
        const polygon3D = extractFaceBoundary3D(oc, face);
        halfFaceTags.set(key, { tag: 'cut-face', partId: '', materialId: '', planeSource: 'section', ...(polygon3D.length ? { polygon3D } : {}) });
        faceExpH.Next(); continue;
      }
      if (classifyFace(oc, face, splitPlane) === 'cut-face') {
        const polygon3D = extractFaceBoundary3D(oc, face);
        halfFaceTags.set(key, { tag: 'cut-face', partId: '', materialId: '', planeSource: 'split', ...(polygon3D.length ? { polygon3D } : {}) });
        faceExpH.Next(); continue;
      }
      halfFaceTags.set(key, { tag: 'original-face', partId: '', materialId: '' });
      faceExpH.Next();
    }
    faceExpH.delete();

    return { ok: true, compound: cut, faceTags: halfFaceTags };
  }

  const halfSpace = buildHalfSpace(oc, plane, arrowDirection);
  const rangeCtor = new oc.Message_ProgressRange_1();
  const rangeBuild = new oc.Message_ProgressRange_1();

  let cut: unknown;
  let cutOk = false;
  try {
    const cutter = new oc.BRepAlgoAPI_Cut_3(
      source as never,
      halfSpace.handle as never,
      rangeCtor
    );
    cutter.Build(rangeBuild);
    const done = cutter.IsDone();
    if (done) {
      cut = cutter.Shape();
      cutOk = true;
    }
    cutter.delete();
  } finally {
    rangeCtor.delete();
    rangeBuild.delete();
    (halfSpace.handle as unknown as { delete(): void }).delete();
  }
  if (!cutOk) {
    return { ok: false, reason: 'empty' };
  }

  // --- empty check: any solid in result? ---
  const solidExplorer = new oc.TopExp_Explorer_2(
    cut as never,
    oc.TopAbs_ShapeEnum.TopAbs_SOLID as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  const hasSolid = solidExplorer.More();
  solidExplorer.delete();
  if (!hasSolid) {
    (cut as unknown as { delete?(): void }).delete?.();
    return { ok: false, reason: 'empty' };
  }

  // --- tangent check: volume unchanged from source? ---
  const volSource = shapeVolume(oc, source);
  const volResult = shapeVolume(oc, cut);
  const eps = Math.max(volSource, 1) * 1e-6;
  if (volSource > 0 && Math.abs(volResult - volSource) < eps) {
    (cut as unknown as { delete?(): void }).delete?.();
    return { ok: false, reason: 'tangent' };
  }

  // --- face classification ---
  const faceTags: FaceTagMap = new Map();
  const faceExp = new oc.TopExp_Explorer_2(
    cut as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  while (faceExp.More()) {
    const face = faceExp.Current();
    const key  = hashFace(oc, face);
    const tag  = classifyFace(oc, face, plane);
    const polygon3D = tag === 'cut-face' ? extractFaceBoundary3D(oc, face) : undefined;
    faceTags.set(key, { tag, partId: '', materialId: '', ...(polygon3D ? { polygon3D } : {}) });
    faceExp.Next();
  }
  faceExp.delete();

  return { ok: true, compound: cut, faceTags };
}

// --- internal volume helper ---
function shapeVolume(oc: OcctInstance, shape: unknown): number {
  const props = new oc.GProp_GProps_1();
  try {
    oc.BRepGProp.VolumeProperties_1(
      shape as never, props,
      true as never, false as never, false as never
    );
    return props.Mass();
  } finally {
    props.delete();
  }
}

// --- assembly cut ---

export type AssemblyBodyResolver = (partId: string, pose: {
  translation: { x: number; y: number; z: number };
  quaternion: readonly [number, number, number, number];
}) => OcctShape | null;

export type AssemblyCutOptions = {
  lookupSubAsm: (partPath: string) => AssemblyDocument | undefined;
  partPathToId: Map<string, string>;
  bodyResolver: AssemblyBodyResolver;
  materialResolver: (partId: string) => string;
};

/**
 * Cut every leaf part in `asm` by `plane`/`arrowDirection` and compose the
 * per-component results into a single compound + merged FaceTagMap.
 *
 * Components that produce { ok: false, reason: 'empty' } are silently skipped.
 * Components that produce 'tangent' are also skipped with a console.warn.
 *
 * The returned FaceTagMap carries { partId, materialId } on every entry so the
 * hatch renderer can look up material cross-section fill patterns.
 */
export function cutAssemblyBySectionPlane(
  oc: OcctInstance,
  asm: AssemblyDocument,
  plane: Plane,
  arrowDirection: -1 | 1,
  opts: AssemblyCutOptions,
  splitPlane?: Plane,   // second cutting plane for half-section (omitted → full section)
  splitSide?: -1 | 1,  // which side of splitPlane to remove (omitted when splitPlane omitted)
): Result {
  const leaves = flattenLeaves(asm, opts.lookupSubAsm, opts.partPathToId);

  const builder = new oc.BRep_Builder();
  const resultCompound = new oc.TopoDS_Compound();
  builder.MakeCompound(resultCompound);

  const mergedTags: FaceTagMap = new Map();
  let anyOk = false;

  for (const { partId, pose } of leaves) {
    const body = opts.bodyResolver(partId, pose);
    if (!body) continue;

    // Wrap body in compound for cutBySectionPlane
    const srcBuilder = new oc.BRep_Builder();
    const srcComp = new oc.TopoDS_Compound();
    srcBuilder.MakeCompound(srcComp);
    srcBuilder.Add(srcComp, body.handle as never);
    srcBuilder.delete();

    const r = cutBySectionPlane(oc, srcComp, plane, arrowDirection, splitPlane, splitSide);
    srcComp.delete();

    if (!r.ok) {
      if (r.reason === 'tangent') {
        console.warn(`cutAssemblyBySectionPlane: tangent plane on part ${partId}, skipping`);
      }
      continue;
    }

    anyOk = true;
    builder.Add(resultCompound, r.compound as never);
    (r.compound as unknown as { delete?(): void }).delete?.();

    const matId = opts.materialResolver(partId);
    for (const [key, val] of r.faceTags) {
      mergedTags.set(key, {
        tag: val.tag,
        partId,
        materialId: matId,
        ...(val.polygon3D ? { polygon3D: val.polygon3D } : {}),
        ...(val.planeSource ? { planeSource: val.planeSource } : {}),
      });
    }
  }

  builder.delete();

  if (!anyOk) {
    resultCompound.delete();
    return { ok: false, reason: 'empty' };
  }

  return { ok: true, compound: resultCompound, faceTags: mergedTags };
}

// Minimal inline leaf-walker
type Leaf = {
  partId: string;
  pose: { translation: { x: number; y: number; z: number }; quaternion: readonly [number, number, number, number] };
};

type LocalPose = Leaf['pose'];

const IDENTITY_POSE: LocalPose = { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] };

/** Compose parent and child poses: world = parent ∘ child. */
function composePoses(parent: LocalPose, child: LocalPose): LocalPose {
  const q = quatMultiply(
    parent.quaternion as [number, number, number, number],
    child.quaternion as [number, number, number, number],
  );
  const r = quatRotateVec(parent.quaternion as [number, number, number, number], child.translation);
  return {
    translation: {
      x: parent.translation.x + r.x,
      y: parent.translation.y + r.y,
      z: parent.translation.z + r.z,
    },
    quaternion: q,
  };
}

// ---------------------------------------------------------------------------
// cutByStepSegments (Drawing F1.2 — Stepped-section views)
// ---------------------------------------------------------------------------
//
// Spec §5.2 reference pseudocode — see
// docs/superpowers/specs/2026-05-22-drawing-f1.2-stepped-section-design.md
//
// function cutByStepSegments(oc, source, planes, arrowDirection):
//     if planes.length < 2: throw 'stepped-section-invariant-violated' (count < 2)
//     if planes.length > 8: throw 'stepped-section-invariant-violated' (count > 8)
//
//     running = source
//     mergedTags = empty FaceTagMap
//     anyCut = false
//
//     for i in 0 .. planes.length - 1:
//         plane = planes[i]
//         halfSpace = buildHalfSpace(oc, plane, arrowDirection)
//         result = BRepAlgoAPI_Cut_3(running, halfSpace.handle)
//         if !result.IsDone() or no solid in result:
//             return { ok: false, reason: 'empty' }
//
//         next = result.Shape()
//
//         if abs(volume(next) - volume(running)) < 1e-6 * volume(running):
//             // per-segment tangent: non-fatal — skip merge, keep running
//             release(next); release(halfSpace); continue
//
//         for face in faces(next):
//             key = hashFace(face)
//             if classifyFace(face, plane) === 'cut-face':
//                 mergedTags.set(key, { tag: 'cut-face', ..., planeSource: 'section' })
//                 continue
//             if mergedTags.has(key): continue   // preserve prior cut-face
//             mergedTags.set(key, { tag: 'original-face', ... })
//
//         release(running) unless i === 0; running = next; release(halfSpace)
//         anyCut = true
//
//     if !anyCut: return { ok: false, reason: 'empty' }
//     return { ok: true, compound: running, faceTags: mergedTags }
//
// Face-tag contract (spec §5 / B2 axis): every cut face from every segment
// carries planeSource: 'section' uniformly. The 'split' value (F1.1) is NEVER
// emitted by this code path.

/**
 * Cut `source` compound by a polyline of N axis-aligned half-spaces, one per
 * segment of an ANSI stepped section line. Runs N sequential BRepAlgoAPI_Cut_3
 * calls, reusing F1's `buildHalfSpace` per segment. All faces classified as
 * cut-faces by any segment carry `planeSource: 'section'`. See spec §5 for
 * the full face-tag contract.
 *
 * Throws 'stepped-section-invariant-violated' when planes.length < 2 or > 8.
 * Returns { ok: false, reason: 'empty' } when the cumulative cut produces no
 * solid or every segment is tangent.
 */
export function cutByStepSegments(
  oc: OcctInstance,
  source: unknown /* TopoDS_Compound */,
  planes: readonly Plane[],
  arrowDirection: -1 | 1,
): Result {
  if (planes.length < 2) {
    throw new Error(`stepped-section-invariant-violated: planes.length=${planes.length} < 2 (clause 2)`);
  }
  // Tasks 2.2–2.5 will extend this body with the count-> 8 guard, the main
  // BRepAlgoAPI_Cut_3 loop, the per-segment volume-tangent skip, the face
  // classifier, and the empty-cut handler.
  throw new Error('cutByStepSegments: loop body not yet implemented (Task 2.2)');
}

function flattenLeaves(
  asm: AssemblyDocument,
  lookupSubAsm: (path: string) => AssemblyDocument | undefined,
  partPathToId: Map<string, string>
): Leaf[] {
  const out: Leaf[] = [];
  function walk(doc: AssemblyDocument, parentPose: LocalPose, visited: Set<string>): void {
    for (const c of doc.components) {
      if (c.visible === false) continue;
      if ((c as { suppressed?: boolean }).suppressed) continue;
      const localPose: LocalPose = (c as { pose?: LocalPose }).pose ?? {
        translation: { x: c.position.x, y: c.position.y, z: c.position.z },
        quaternion: [0, 0, 0, 1] as const,
      };
      const worldPose = composePoses(parentPose, localPose);
      if (!c.partPath.endsWith('.ziasm')) {
        const partId = partPathToId.get(c.partPath);
        if (partId) out.push({ partId, pose: worldPose });
      } else {
        if (visited.has(c.partPath)) continue;
        const sub = lookupSubAsm(c.partPath);
        if (!sub) continue;
        walk(sub, worldPose, new Set([...visited, c.partPath]));
      }
    }
  }
  walk(asm, IDENTITY_POSE, new Set());
  return out;
}
