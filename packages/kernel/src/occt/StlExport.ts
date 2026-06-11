import type { OcctInstance } from './occtLoader';
import { computeBoundingBox, type OcctShape } from './SolidOps';
import { adaptiveLinearDeflection } from './Tessellator';

/** World pose: structural match to ExportPose (api.ts) / composedPoses (app). */
export type ExportPose = {
  translation: { x: number; y: number; z: number };
  quaternion: readonly [number, number, number, number];
};

/** A leaf the STL emitter consumes: a resolved shape + an optional world pose. */
export type StlExportLeaf = {
  shape: OcctShape;
  pose?: ExportPose;
};

/** A single emitted triangle, vertices already in world space, CCW outward. */
type Triangle = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

const ANGULAR_DEFLECTION = 0.5;

/**
 * Quaternion [x,y,z,w] + translation → a function mapping a face-local point to
 * world space. Mirrors `transformShapeByPose`'s row-major 3×3 derivation
 * (TransformOps.ts:49-67) but applied per-vertex on the JS side rather than via
 * BRepBuilderAPI_Transform — so the prototype shape is never mutated/baked.
 */
function poseVertexTransformer(
  pose: ExportPose | undefined,
): (x: number, y: number, z: number) => [number, number, number] {
  if (!pose) return (x, y, z) => [x, y, z];
  const [qx, qy, qz, qw] = pose.quaternion;
  const { x: tx, y: ty, z: tz } = pose.translation;
  const r00 = 1 - 2 * (qy * qy + qz * qz);
  const r01 = 2 * (qx * qy - qw * qz);
  const r02 = 2 * (qx * qz + qw * qy);
  const r10 = 2 * (qx * qy + qw * qz);
  const r11 = 1 - 2 * (qx * qx + qz * qz);
  const r12 = 2 * (qy * qz - qw * qx);
  const r20 = 2 * (qx * qz - qw * qy);
  const r21 = 2 * (qy * qz + qw * qx);
  const r22 = 1 - 2 * (qx * qx + qy * qy);
  return (x, y, z) => [
    r00 * x + r01 * y + r02 * z + tx,
    r10 * x + r11 * y + r12 * z + ty,
    r20 * x + r21 * y + r22 * z + tz,
  ];
}

/**
 * Tessellate one shape and collect world-space triangles. Vertices are
 * transformed first by the face's own TopLoc_Location (Tessellator.ts:256-261
 * idiom) and then by the leaf world pose. Faces flagged TopAbs_REVERSED
 * (Orientation_1() === 1, the in-repo idiom at WorkFeatureOps.ts:357) get their
 * 2nd/3rd vertices swapped so every emitted facet winds CCW around its outward
 * normal.
 */
function collectTriangles(oc: OcctInstance, leaf: StlExportLeaf): Triangle[] {
  const tris: Triangle[] = [];
  const bbox = computeBoundingBox(oc, leaf.shape);
  const linearDeflection = adaptiveLinearDeflection(bbox);
  const toWorld = poseVertexTransformer(leaf.pose);

  const meshTool = new oc.BRepMesh_IncrementalMesh_2(
    leaf.shape.handle as never,
    linearDeflection,
    false as never,
    ANGULAR_DEFLECTION,
    false as never,
  );
  const progress = new oc.Message_ProgressRange_1();
  meshTool.Perform_1(progress);
  progress.delete();

  const explorer = new oc.TopExp_Explorer_2(
    leaf.shape.handle as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
  );

  while (explorer.More()) {
    const faceShape = explorer.Current();
    const face = oc.TopoDS.Face_1(faceShape);
    // TopAbs_REVERSED: the OCCT binding returns an enum-wrapper object, not a plain integer.
    // We check `.value === 1` (REVERSED) rather than `=== 1` (the integer check fails at runtime
    // because the binding wraps enums in objects). The WorkFeatureOps.ts comment "=== 1" was a
    // TS cast that hid this; the actual runtime value is { value: 1 } for REVERSED.
    const oriVal = (face as { Orientation_1: () => { value?: number } | number }).Orientation_1();
    const reversed = (typeof oriVal === 'object' && oriVal !== null)
      ? (oriVal as { value?: number }).value === 1
      : oriVal === 1;
    const loc = new oc.TopLoc_Location_1();
    const triHandle = oc.BRep_Tool.Triangulation(face, loc, 0 as never);

    if (!triHandle.IsNull()) {
      const t = triHandle.get();
      const transformation = (loc as { Transformation: () => unknown }).Transformation();
      const nbNodes = t.NbNodes();
      const nbTris = t.NbTriangles();

      // Read & transform every node once (face-local loc → then world pose).
      const nodes: Array<[number, number, number]> = new Array(nbNodes);
      for (let i = 1; i <= nbNodes; i++) {
        const p = t.Node(i);
        (p as { Transform: (tr: unknown) => void }).Transform(transformation as never);
        nodes[i - 1] = toWorld(p.X(), p.Y(), p.Z());
        p.delete();
      }
      for (let i = 1; i <= nbTris; i++) {
        const tri = t.Triangle(i);
        const a = nodes[tri.Value(1) - 1]!;
        const b = nodes[tri.Value(2) - 1]!;
        const c = nodes[tri.Value(3) - 1]!;
        // Reversed faces: swap v2/v3 so the facet winds CCW around the outward normal.
        tris.push(reversed ? [a, c, b] : [a, b, c]);
        tri.delete();
      }
    }

    triHandle.delete();
    loc.delete();
    face.delete();
    faceShape.delete();
    explorer.Next();
  }
  explorer.delete();
  meshTool.delete();
  return tris;
}

/** Serialize world-space triangles into a binary STL (little-endian). */
function emitBinaryStl(tris: Triangle[]): Uint8Array {
  const bytes = new Uint8Array(84 + tris.length * 50);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(80, tris.length, true); // 80-byte header stays zero
  let off = 84;
  for (const [v0, v1, v2] of tris) {
    off += 12; // normal left as zero (consumers recompute from winding)
    for (const v of [v0, v1, v2]) {
      dv.setFloat32(off, v[0], true);
      dv.setFloat32(off + 4, v[1], true);
      dv.setFloat32(off + 8, v[2], true);
      off += 12;
    }
    dv.setUint16(off, 0, true); // attribute byte count
    off += 2;
  }
  return bytes;
}

/**
 * Build a binary STL from one or more resolved leaves. Each leaf's shape is
 * tessellated and its triangles are transformed into world space by the leaf
 * pose (identity when absent) and concatenated. Pure-OCCT: no parts/cache.
 *
 * API-wiring note: `exportStlPart` / `exportStlAssembly` on `KernelApi` are NOT
 * here — they belong to the api-wiring chunk (Phases 3&4 Task 2) which calls
 * `warmShapeForExport(partId)` then delegates to this function.
 *
 * `_opts` accepted for call-site symmetry with the api-wiring chunk; output is ALWAYS binary
 * this slice (ASCII STL is a non-goal §12), so the flag is ignored.
 */
export function exportStlBinary(oc: OcctInstance, leaves: readonly StlExportLeaf[], _opts?: { binary?: boolean }): Uint8Array {
  const all: Triangle[] = [];
  for (const leaf of leaves) {
    for (const tri of collectTriangles(oc, leaf)) all.push(tri);
  }
  return emitBinaryStl(all);
}
