import type { Feature, Parameter, Mesh, PartDocument, Result, KernelError, SketchPrimitive, TessellatedEdge, TessellatedFace, FaceName, WorkFeatureValue, AssemblyConstraintRef, EdgeName, BoundingBox, ProjectorInput } from '@zilventor/shared';
import { migrateManifest, type AnyManifest } from '@zilventor/shared';
import { loadOcct, type OcctInstance } from './occt/occtLoader';
import { executeTree } from './adapter/FeatureTree';
import { newPart, addFeature as addFeatureToPart, setParameter as setParameterOnPart, removeParameter as removeParameterFromPart, removeFeature as removeFeatureFromPart, addPrimitive as addPrimitiveToPart, removePrimitive as removePrimitiveFromPart } from './adapter/PartDocument';
import { disposeShape, type OcctShape } from './occt/SolidOps';
import { writeBRep, readBRep } from './occt/BRepIO';
import { readStep } from './occt/StepIO';
import { tessellate } from './occt/Tessellator';
import { getProjectorInput as getProjectorInputFn, type GetProjectorInputArgs } from './adapter/drawing/getProjectorInput';
import { packProject, unpackProject } from './storage/ProjectPacker';
import { writeToHandle, readFromHandle } from './storage/FileSystemAccess';
import { resolveRef, resolveCircularEdgeRef, realExtractorBundle, type PartLocalGeometry } from './assembly/AssemblyConstraintRefs';
import {
  cutBySectionPlane as kernelCutBySectionPlane,
  cutByStepSegments as kernelCutByStepSegments,
  cutLeavesBySectionPlane,
  cutLeavesByStepSegments,
  type Plane,
  type FaceTagMap as KernelFaceTagMap,
} from './section/cutBySectionPlane';
import { transformShapeByPose } from './occt/TransformOps';
import type { FaceTag } from '@zilventor/shared/src/drawing/projectSectionView';

/**
 * Result of a successful `execute` / `previewFeature` call. The mesh is the
 * tessellated output of the final solid in the tree; `featureErrors` carries
 * per-feature non-fatal errors (populated by the fillet branch in Sub-project
 * 3b — see `ExecutionResult` in FeatureTree.ts). It is present only when the
 * executor recorded at least one soft failure; callers should treat absence
 * and an empty map as equivalent.
 *
 * The Map is kept as-is because the direct in-process API is exercised by the
 * kernel's own integration tests; the Comlink-wrapped worker client already
 * serializes structured-cloneable values and Map is one of them
 * (https://developer.mozilla.org/docs/Web/API/Web_Workers_API/Structured_clone_algorithm).
 */
export type ExecuteResult = {
  mesh: Mesh;
  tessellatedEdges?: TessellatedEdge[];
  faceNames?: FaceName[];
  tessellatedFaces?: TessellatedFace[];
  featureErrors?: Map<string, KernelError>;
  workFeatures?: WorkFeatureValue[];
};

/** Serialized entry for one face tag (key + value). */
export type SerializedFaceTagEntry = [string, FaceTag];

/**
 * Serializable result of a section cut + in-worker tessellation.
 * The compound is tessellated on the worker side so no OCCT objects cross
 * the Comlink boundary.
 */
export type CutSectionResult =
  | { ok: true; projectorInput: ProjectorInput; faceTags: SerializedFaceTagEntry[] }
  | { ok: false; reason: 'tangent' | 'empty' };

export type KernelApi = {
  init(): Promise<void>;
  ping(input: string): Promise<{ reply: 'pong'; echo: string }>;
  createPart(name: string): Promise<string>;
  addFeature(partId: string, feature: Feature): Promise<void>;
  removeFeature(partId: string, featureId: string): Promise<void>;
  addPrimitive(partId: string, sketchId: string, primitive: SketchPrimitive): Promise<void>;
  removePrimitive(partId: string, sketchId: string, primitiveId: string): Promise<void>;
  setParameter(partId: string, param: Parameter): Promise<void>;
  deleteParameter(partId: string, name: string): Promise<void>;
  deletePart(partId: string): Promise<void>;
  execute(partId: string): Promise<Result<ExecuteResult, KernelError>>;
  previewFeature(partId: string, feature: Feature): Promise<Result<ExecuteResult, KernelError>>;
  getPart(partId: string): Promise<PartDocument | null>;
  save(partId: string, handle: FileSystemFileHandle, thumbnail?: Uint8Array): Promise<void>;
  saveToBytes(partId: string, thumbnail?: Uint8Array): Promise<Uint8Array>;
  load(handle: FileSystemFileHandle): Promise<string>;
  loadFromBytes(bytes: Uint8Array): Promise<string>;
  extractAssemblyRef(partId: string, ref: AssemblyConstraintRef): Promise<Result<PartLocalGeometry, KernelError>>;
  extractAssemblyCircularEdge(partId: string, edge: EdgeName): Promise<Result<PartLocalGeometry, KernelError>>;
  importStep(params: {
    stepBytes: ArrayBuffer;
    partName: string;
  }): Promise<{
    brepBlobId: string;
    triangleCount: number;
    boundingBox: BoundingBox;
    faceCount: number;
  }>;
  /** Returns projection-ready triangles+edges+bbox for a part or assembly.
   *
   *  For a part: pass `{ kind: 'part'; partId: string }`.  Returns null if
   *  the part's NamedShape is not cached — caller should call `execute` first.
   *
   *  For an assembly: pass `{ kind: 'assembly'; components: [...] }` with a
   *  pre-flattened list (suppressed/hidden components already excluded by the
   *  main-thread walker). All referenced partIds must be in the cache. */
  getProjectorInput(args: GetProjectorInputArgs): Promise<import('@zilventor/shared').ProjectorInput | null>;

  /**
   * Cut a part (by partId) with the given plane, tessellate the result in-worker,
   * and return a serializable ProjectorInput + face tags.
   * Returns { ok: false, reason } if the plane is tangent or misses the geometry.
   */
  cutBySectionPlane(partId: string, plane: Plane, arrowDirection: -1 | 1, splitPlane?: Plane, splitSide?: -1 | 1): Promise<CutSectionResult>;

  /**
   * Cut every part in a loaded assembly by the given plane, tessellate, and merge.
   * `asmId` is the partId that contains an AssemblyDocument (loaded via load/loadFromBytes).
   * Returns { ok: false, reason } if no part produces a cut result.
   */
  cutAssemblyBySectionPlane(asmId: string, plane: Plane, arrowDirection: -1 | 1, splitPlane?: Plane, splitSide?: -1 | 1): Promise<CutSectionResult>;

  /**
   * Cut a part (by partId) with a polyline of N axis-aligned half-spaces — one
   * per stepped-section segment (Drawing F1.2). Tessellates the result and
   * returns a serializable ProjectorInput + face tags.
   * Throws 'stepped-section-invariant-violated' when planes.length < 2 or > 8.
   * Returns { ok: false, reason: 'empty' } when the cumulative cut produces no solid.
   * Cut faces carry planeSource: 'section' uniformly; no 'tangent' return.
   */
  cutByStepSegments(partId: string, planes: readonly Plane[], arrowDirection: -1 | 1): Promise<CutSectionResult>;

  /**
   * Stepped-section assembly variant of cutByStepSegments. Cuts every cached
   * part in the assembly with the same N-segment polyline, merges per-component
   * results, and returns a serializable ProjectorInput + merged face tags.
   */
  cutAssemblyByStepSegments(asmId: string, planes: readonly Plane[], arrowDirection: -1 | 1): Promise<CutSectionResult>;

  /**
   * Pose-aware, components-based full/half-section cut for assembly sources.
   * Each component is cut at its posed position (bodyResolver builds a fresh copy
   * via transformShapeByPose). Replaces cutAssemblyBySectionPlane for drawings
   * that were reopened without an asmId.
   */
  cutAssemblyComponentsBySectionPlane(
    components: readonly { partId: string; pose: { translation: { x: number; y: number; z: number }; quaternion: readonly [number, number, number, number] } }[],
    plane: Plane, arrowDirection: -1 | 1, splitPlane?: Plane, splitSide?: -1 | 1,
  ): Promise<CutSectionResult>;

  /**
   * Pose-aware, components-based stepped-section cut for assembly sources.
   * Each component is cut at its posed position. Replaces cutAssemblyByStepSegments
   * for drawings that were reopened without an asmId.
   */
  cutAssemblyComponentsByStepSegments(
    components: readonly { partId: string; pose: { translation: { x: number; y: number; z: number }; quaternion: readonly [number, number, number, number] } }[],
    planes: readonly Plane[], arrowDirection: -1 | 1,
  ): Promise<CutSectionResult>;
};

export function createKernelApi(): KernelApi {
  let occt: OcctInstance | null = null;
  const parts = new Map<string, PartDocument>();
  /**
   * Per-part NamedShape cache. Populated after each successful `executeTree`
   * call (from `execute` or `saveToBytes`). The cached shape is kept alive so
   * that `extractAssemblyRef` / `extractAssemblyCircularEdge` can resolve face
   * handles by name without re-executing the tree.
   *
   * Ownership: when we replace a cached entry we dispose the old shape first.
   * When a part is deleted the entry is disposed and removed.
   */
  const namedShapeCache = new Map<string, import('./occt/FaceNaming').NamedShape>();
  /** Also cache the last work-feature values alongside the shape. */
  const workFeatureCache = new Map<string, import('@zilventor/shared').WorkFeatureValue[]>();
  /** Imported-STEP brep blob cache, keyed by ImportedFeature.bodyRef.
   *  Populated by `importStep` and by `loadFromBytes` (when restoring an
   *  imported part). Read by the ImportedFeature evaluator (Task 8) and
   *  walked by `saveToBytes` to write blobs back into the .zipt. */
  const importedShapeCache = new Map<string, OcctShape>();

  function updateNamedShapeCache(partId: string, ns: import('./occt/FaceNaming').NamedShape, wfs: import('@zilventor/shared').WorkFeatureValue[]): void {
    const prev = namedShapeCache.get(partId);
    if (prev) disposeShape(prev.shape);
    namedShapeCache.set(partId, ns);
    workFeatureCache.set(partId, wfs);
  }

  function registerImportedShape(bodyRef: string, shape: OcctShape): void {
    const prev = importedShapeCache.get(bodyRef);
    if (prev) disposeShape(prev);
    importedShapeCache.set(bodyRef, shape);
  }
  function lookupImportedShape(bodyRef: string): OcctShape | undefined {
    return importedShapeCache.get(bodyRef);
  }

  return {
    async init() {
      occt = await loadOcct();
    },

    async ping(input) {
      return { reply: 'pong', echo: input };
    },

    async createPart(name) {
      const p = newPart(name);
      parts.set(p.id, p);
      return p.id;
    },

    async addFeature(partId, feature) {
      const p = parts.get(partId);
      if (!p) throw new Error(`no part ${partId}`);
      parts.set(partId, addFeatureToPart(p, feature));
    },

    async removeFeature(partId, featureId) {
      const p = parts.get(partId);
      if (!p) throw new Error(`no part ${partId}`);
      parts.set(partId, removeFeatureFromPart(p, featureId));
    },

    async addPrimitive(partId, sketchId, primitive) {
      const p = parts.get(partId);
      if (!p) throw new Error(`no part ${partId}`);
      parts.set(partId, addPrimitiveToPart(p, sketchId, primitive));
    },

    async removePrimitive(partId, sketchId, primitiveId) {
      const p = parts.get(partId);
      if (!p) throw new Error(`no part ${partId}`);
      parts.set(partId, removePrimitiveFromPart(p, sketchId, primitiveId));
    },

    async setParameter(partId, param) {
      const p = parts.get(partId);
      if (!p) throw new Error(`no part ${partId}`);
      parts.set(partId, setParameterOnPart(p, param));
    },

    async deleteParameter(partId, name) {
      const p = parts.get(partId);
      if (!p) throw new Error(`no part ${partId}`);
      parts.set(partId, removeParameterFromPart(p, name));
    },

    async deletePart(partId) {
      const ns = namedShapeCache.get(partId);
      if (ns) disposeShape(ns.shape);
      namedShapeCache.delete(partId);
      workFeatureCache.delete(partId);
      parts.delete(partId);
    },

    async execute(partId) {
      if (!occt) throw new Error('kernel not initialized');
      const p = parts.get(partId);
      if (!p) throw new Error(`no part ${partId}`);
      const r = await executeTree(occt, p, lookupImportedShape);
      if (!r.ok) return r;
      // Cache the NamedShape (with live OCCT face handles) for assembly ref
      // resolution. The cache takes ownership of namedShape; do NOT dispose
      // finalSolid separately — updateNamedShapeCache disposes the prior entry.
      updateNamedShapeCache(partId, r.value.namedShape, r.value.workFeatures ?? []);
      return {
        ok: true,
        value: {
          mesh: r.value.mesh,
          ...(r.value.tessellatedEdges ? { tessellatedEdges: r.value.tessellatedEdges } : {}),
          ...(r.value.faceNames ? { faceNames: r.value.faceNames } : {}),
          ...(r.value.tessellatedFaces ? { tessellatedFaces: r.value.tessellatedFaces } : {}),
          ...(r.value.featureErrors ? { featureErrors: r.value.featureErrors } : {}),
          ...(r.value.workFeatures ? { workFeatures: r.value.workFeatures } : {})
        }
      };
    },

    async previewFeature(partId, feature) {
      if (!occt) throw new Error('kernel not initialized');
      const p = parts.get(partId);
      if (!p) throw new Error(`no part ${partId}`);
      // Virtual tree: stored part + scratch feature appended. No persistence.
      const virtual: PartDocument = { ...p, featureTree: [...p.featureTree, feature] };
      const r = await executeTree(occt, virtual, lookupImportedShape);
      if (!r.ok) return r;
      disposeShape(r.value.finalSolid);
      // Preview intentionally drops featureErrors: the scratch feature is the
      // only one that matters here, and a hard failure on it already surfaces
      // via the top-level `err` path. Historical soft failures in the stored
      // tree are reported when the user actually runs `execute`.
      return { ok: true, value: { mesh: r.value.mesh } };
    },

    async getPart(partId) {
      return parts.get(partId) ?? null;
    },

    async save(partId, handle, thumbnail) {
      const archive = await this.saveToBytes(partId, thumbnail);
      await writeToHandle(handle, archive);
    },

    async saveToBytes(partId, thumbnail) {
      if (!occt) throw new Error('kernel not initialized');
      const part = parts.get(partId);
      if (!part) throw new Error(`no part ${partId}`);

      // Re-run the feature tree to build the solid for BRep serialisation.
      const r = await executeTree(occt, part, lookupImportedShape);
      if (!r.ok) throw new Error(`execute failed before save: ${r.error.message}`);

      // Update the NamedShape cache before we do anything that might throw,
      // so the ref-extractor always has a fresh shape after a save. The cache
      // takes ownership; writeBRep reads the solid handle synchronously below,
      // so this order is safe.
      updateNamedShapeCache(partId, r.value.namedShape, r.value.workFeatures ?? []);

      // writeBRep reads r.value.finalSolid (alias to namedShape.shape) which
      // is still alive in the cache — do NOT call disposeShape here.
      const brep = writeBRep(occt, r.value.finalSolid);
      const blobs: Record<string, Uint8Array> = { main: brep };
      for (const f of part.featureTree) {
        if (f.kind === 'imported') {
          const cached = importedShapeCache.get(f.bodyRef);
          if (!cached) {
            throw new Error(`saveToBytes: imported feature ${f.id} bodyRef=${f.bodyRef} not in cache`);
          }
          blobs[f.bodyRef] = writeBRep(occt, cached);
        }
      }
      const manifest = {
        formatVersion: 1 as const,
        kind: 'part' as const,
        createdAt: new Date().toISOString(),
        appVersion: '0.0.0',
        document: {
          ...part,
          cachedGeometry: {
            brepBlobId: 'main',
            triangleCount: r.value.mesh.indices.length / 3,
            boundingBox: r.value.mesh.boundingBox
          }
        }
      };
      return await packProject({
        manifest,
        blobs,
        ...(thumbnail ? { thumbnail } : {})
      });
    },

    async load(handle) {
      if (!occt) throw new Error('kernel not initialized');
      const bytes = await readFromHandle(handle);
      const { manifest } = await unpackProject(bytes);
      const migrated = migrateManifest(manifest as AnyManifest);
      const part = (migrated as unknown as { document: PartDocument }).document;
      parts.set(part.id, part);
      return part.id;
    },

    async loadFromBytes(bytes) {
      if (!occt) throw new Error('kernel not initialized');
      const { manifest, blobs } = await unpackProject(bytes);
      const migrated = migrateManifest(manifest as AnyManifest);
      const part = (migrated as unknown as { document: PartDocument }).document;

      // Restore any imported-feature breps into the kernel cache
      for (const f of part.featureTree) {
        if (f.kind === 'imported') {
          const blob = blobs[f.bodyRef];
          if (!blob) {
            throw new Error(`loadFromBytes: imported feature ${f.id} bodyRef=${f.bodyRef} missing from .zipt blobs`);
          }
          const shape = readBRep(occt, blob);
          registerImportedShape(f.bodyRef, shape);
        }
      }

      parts.set(part.id, part);
      return part.id;
    },

    async extractAssemblyRef(partId, ref) {
      if (!occt) return { ok: false, error: { kind: 'invalidParameter' as const, message: 'kernel not initialized', correlationId: 'no-occt' } };
      if (!parts.has(partId)) return { ok: false, error: { kind: 'invalidParameter' as const, message: `no part ${partId}`, correlationId: partId } };
      // Use the cached NamedShape (populated by the most recent `execute` call).
      // If the cache is cold (part was never executed since load), fall back to
      // executing now and warming the cache.
      let ns = namedShapeCache.get(partId);
      let wfs = workFeatureCache.get(partId);
      if (!ns) {
        const p = parts.get(partId)!;
        const r = await executeTree(occt, p, lookupImportedShape);
        if (!r.ok) return r;
        updateNamedShapeCache(partId, r.value.namedShape, r.value.workFeatures ?? []);
        ns = r.value.namedShape;
        wfs = r.value.workFeatures ?? [];
      }
      const ex = realExtractorBundle(occt);
      const wfMap = new Map<string, import('@zilventor/shared').WorkFeatureValue>((wfs ?? []).map((w) => [w.featureId, w]));
      return resolveRef(ref, ns, wfMap, ex);
    },

    async importStep({ stepBytes, partName: _partName }) {
      if (!occt) throw new Error('kernel not initialized');
      const result = readStep(occt, stepBytes);
      // Tessellate so we can return triangleCount; the mesh itself is
      // recomputed later by execute() when the feature tree runs.
      const mesh = tessellate(occt, result.shape, { linearDeflection: 0.1 });
      const brepBlobId = `imp-${crypto.randomUUID()}`;
      registerImportedShape(brepBlobId, result.shape);
      return {
        brepBlobId,
        triangleCount: mesh.indices.length / 3,
        boundingBox: result.boundingBox,
        faceCount: result.faceCount,
      };
    },

    async extractAssemblyCircularEdge(partId, edge) {
      if (!occt) return { ok: false, error: { kind: 'invalidParameter' as const, message: 'kernel not initialized', correlationId: 'no-occt' } };
      if (!parts.has(partId)) return { ok: false, error: { kind: 'invalidParameter' as const, message: `no part ${partId}`, correlationId: partId } };
      // Same cache strategy as extractAssemblyRef.
      let ns = namedShapeCache.get(partId);
      if (!ns) {
        const p = parts.get(partId)!;
        const r = await executeTree(occt, p, lookupImportedShape);
        if (!r.ok) return r;
        updateNamedShapeCache(partId, r.value.namedShape, r.value.workFeatures ?? []);
        ns = r.value.namedShape;
      }
      const ex = realExtractorBundle(occt);
      return resolveCircularEdgeRef(edge, ns, ex);
    },

    async getProjectorInput(args) {
      if (!occt) throw new Error('kernel not initialized');
      const lookup = (id: string) => namedShapeCache.get(id);
      if (args.kind === 'part') {
        if (!namedShapeCache.has(args.partId)) return null;
        return getProjectorInputFn(occt, args, lookup);
      }
      // assembly: all parts must be cached — getProjectorInputFn throws if any is missing
      return getProjectorInputFn(occt, args, lookup);
    },

    async cutBySectionPlane(partId, plane, arrowDirection, splitPlane, splitSide) {
      if (!occt) throw new Error('kernel not initialized');
      const ns = namedShapeCache.get(partId);
      if (!ns) return { ok: false, reason: 'empty' as const };

      const srcBuilder = new occt.BRep_Builder();
      const srcComp = new occt.TopoDS_Compound();
      srcBuilder.MakeCompound(srcComp);
      srcBuilder.Add(srcComp, ns.shape.handle as never);
      srcBuilder.delete();

      const r = kernelCutBySectionPlane(occt, srcComp, plane, arrowDirection, splitPlane, splitSide);
      srcComp.delete();

      if (!r.ok) return r;

      const cutShape: OcctShape = { __brand: 'OcctShape', handle: r.compound };
      const mesh = tessellate(occt, cutShape, { linearDeflection: 0.05, angularDeflection: 0.3 });
      (r.compound as unknown as { delete?(): void }).delete?.();

      const triangles = buildTriangles(mesh);
      const projectorInput: ProjectorInput = {
        triangles,
        edges: [],
        bbox: mesh.boundingBox,
      };
      const faceTags = serializeFaceTags(r.faceTags);
      return { ok: true, projectorInput, faceTags };
    },

    async cutAssemblyBySectionPlane(asmId, plane, arrowDirection, splitPlane, splitSide) {
      if (!occt) throw new Error('kernel not initialized');

      const builder = new occt.BRep_Builder();
      const srcComp = new occt.TopoDS_Compound();
      builder.MakeCompound(srcComp);
      let anyAdded = false;

      for (const [, ns] of namedShapeCache) {
        builder.Add(srcComp, ns.shape.handle as never);
        anyAdded = true;
      }
      builder.delete();

      if (!anyAdded) {
        srcComp.delete();
        return { ok: false, reason: 'empty' as const };
      }

      const r = kernelCutBySectionPlane(occt, srcComp, plane, arrowDirection, splitPlane, splitSide);
      srcComp.delete();

      if (!r.ok) return r;

      const cutShape: OcctShape = { __brand: 'OcctShape', handle: r.compound };
      const mesh = tessellate(occt, cutShape, { linearDeflection: 0.05, angularDeflection: 0.3 });
      (r.compound as unknown as { delete?(): void }).delete?.();

      const triangles = buildTriangles(mesh);
      const projectorInput: ProjectorInput = {
        triangles,
        edges: [],
        bbox: mesh.boundingBox,
      };
      const faceTags = serializeFaceTags(r.faceTags);
      // asmId not used for compound building (all cached parts are included)
      void asmId;
      return { ok: true, projectorInput, faceTags };
    },

    async cutByStepSegments(partId, planes, arrowDirection) {
      if (!occt) throw new Error('kernel not initialized');
      const ns = namedShapeCache.get(partId);
      if (!ns) return { ok: false, reason: 'empty' as const };

      const srcBuilder = new occt.BRep_Builder();
      const srcComp = new occt.TopoDS_Compound();
      srcBuilder.MakeCompound(srcComp);
      srcBuilder.Add(srcComp, ns.shape.handle as never);
      srcBuilder.delete();

      const r = kernelCutByStepSegments(occt, srcComp, planes, arrowDirection);
      srcComp.delete();

      if (!r.ok) return r;

      const cutShape: OcctShape = { __brand: 'OcctShape', handle: r.compound };
      const mesh = tessellate(occt, cutShape, { linearDeflection: 0.05, angularDeflection: 0.3 });
      (r.compound as unknown as { delete?(): void }).delete?.();

      const triangles = buildTriangles(mesh);
      const projectorInput: ProjectorInput = {
        triangles,
        edges: [],
        bbox: mesh.boundingBox,
      };
      const faceTags = serializeFaceTags(r.faceTags);
      return { ok: true, projectorInput, faceTags };
    },

    async cutAssemblyByStepSegments(asmId, planes, arrowDirection) {
      if (!occt) throw new Error('kernel not initialized');

      const builder = new occt.BRep_Builder();
      const srcComp = new occt.TopoDS_Compound();
      builder.MakeCompound(srcComp);
      let anyAdded = false;

      for (const [, ns] of namedShapeCache) {
        builder.Add(srcComp, ns.shape.handle as never);
        anyAdded = true;
      }
      builder.delete();

      if (!anyAdded) {
        srcComp.delete();
        return { ok: false, reason: 'empty' as const };
      }

      const r = kernelCutByStepSegments(occt, srcComp, planes, arrowDirection);
      srcComp.delete();

      if (!r.ok) return r;

      const cutShape: OcctShape = { __brand: 'OcctShape', handle: r.compound };
      const mesh = tessellate(occt, cutShape, { linearDeflection: 0.05, angularDeflection: 0.3 });
      (r.compound as unknown as { delete?(): void }).delete?.();

      const triangles = buildTriangles(mesh);
      const projectorInput: ProjectorInput = {
        triangles,
        edges: [],
        bbox: mesh.boundingBox,
      };
      const faceTags = serializeFaceTags(r.faceTags);
      void asmId;
      return { ok: true, projectorInput, faceTags };
    },

    async cutAssemblyComponentsBySectionPlane(components, plane, arrowDirection, splitPlane, splitSide) {
      if (!occt) throw new Error('kernel not initialized');
      const bodyResolver = (partId: string, pose: { translation: { x: number; y: number; z: number }; quaternion: readonly [number, number, number, number] }) => {
        const ns = namedShapeCache.get(partId);
        return ns ? transformShapeByPose(occt!, ns.shape, pose) : null;
      };
      const r = cutLeavesBySectionPlane(occt, components, plane, arrowDirection,
        { bodyResolver, materialResolver: () => '' }, splitPlane, splitSide);
      if (!r.ok) return r;
      const cutShape: OcctShape = { __brand: 'OcctShape', handle: r.compound };
      const mesh = tessellate(occt, cutShape, { linearDeflection: 0.05, angularDeflection: 0.3 });
      (r.compound as unknown as { delete?(): void }).delete?.();
      const triangles = buildTriangles(mesh);
      const projectorInput: ProjectorInput = { triangles, edges: [], bbox: mesh.boundingBox };
      const faceTags = serializeFaceTags(r.faceTags);
      return { ok: true, projectorInput, faceTags };
    },

    async cutAssemblyComponentsByStepSegments(components, planes, arrowDirection) {
      if (!occt) throw new Error('kernel not initialized');
      const bodyResolver = (partId: string, pose: { translation: { x: number; y: number; z: number }; quaternion: readonly [number, number, number, number] }) => {
        const ns = namedShapeCache.get(partId);
        return ns ? transformShapeByPose(occt!, ns.shape, pose) : null;
      };
      const r = cutLeavesByStepSegments(occt, components, planes, arrowDirection,
        { bodyResolver, materialResolver: () => '' });
      if (!r.ok) return r;
      const cutShape: OcctShape = { __brand: 'OcctShape', handle: r.compound };
      const mesh = tessellate(occt, cutShape, { linearDeflection: 0.05, angularDeflection: 0.3 });
      (r.compound as unknown as { delete?(): void }).delete?.();
      const triangles = buildTriangles(mesh);
      const projectorInput: ProjectorInput = { triangles, edges: [], bbox: mesh.boundingBox };
      const faceTags = serializeFaceTags(r.faceTags);
      return { ok: true, projectorInput, faceTags };
    },
  };
}

function buildTriangles(mesh: Mesh): Array<[[number,number,number],[number,number,number],[number,number,number]]> {
  const triangles: Array<[[number,number,number],[number,number,number],[number,number,number]]> = [];
  const pos = mesh.positions;
  const idx = mesh.indices;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]! * 3;
    const b = idx[i + 1]! * 3;
    const c = idx[i + 2]! * 3;
    triangles.push([
      [pos[a]!, pos[a + 1]!, pos[a + 2]!],
      [pos[b]!, pos[b + 1]!, pos[b + 2]!],
      [pos[c]!, pos[c + 1]!, pos[c + 2]!],
    ]);
  }
  return triangles;
}

/** @internal — exported for unit-testing only. */
export function serializeFaceTags(kernelTags: KernelFaceTagMap): SerializedFaceTagEntry[] {
  const out: SerializedFaceTagEntry[] = [];
  for (const [key, val] of kernelTags) {
    out.push([key, {
      tag: val.tag,
      partId: val.partId,
      materialId: val.materialId,
      ...(val.polygon3D ? { polygon3D: val.polygon3D } : {}),
      ...(val.planeSource ? { planeSource: val.planeSource } : {}),
    }]);
  }
  return out;
}
