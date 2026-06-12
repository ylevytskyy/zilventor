import type { Feature, Parameter, Mesh, PartDocument, Result, KernelError, SketchPrimitive, TessellatedEdge, TessellatedFace, FaceName, WorkFeatureValue, AssemblyConstraintRef, EdgeName, BoundingBox, ProjectorInput, MaterialEntry, CustomTextureDef } from '@zilventor/shared';
import { migrateManifest, CURRENT_FORMAT_VERSION, type AnyManifest } from '@zilventor/shared';
import { loadOcct, type OcctInstance } from './occt/occtLoader';
import { executeTree } from './adapter/FeatureTree';
import { newPart, addFeature as addFeatureToPart, setParameter as setParameterOnPart, removeParameter as removeParameterFromPart, removeFeature as removeFeatureFromPart, addPrimitive as addPrimitiveToPart, removePrimitive as removePrimitiveFromPart } from './adapter/PartDocument';
import { disposeShape, computeBoundingBox, type OcctShape } from './occt/SolidOps';
import { writeBRep, readBRep } from './occt/BRepIO';
import { readStep, splitImportedShapeHelper } from './occt/StepIO';
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
import { transformShapeByPose, mirrorShape } from './occt/TransformOps';
import type { FaceTag } from '@zilventor/shared/src/drawing/projectSectionView';
import { exportStepDoc, IDENTITY_POSE, type KernelExportLeaf, type ExportPose } from './occt/StepExport';
import { exportStlBinary, type StlExportLeaf } from './occt/StlExport';

// Re-export pose + leaf types so the app and commands can import them from '@zilventor/kernel/src/api'.
export type { ExportPose, StlExportLeaf };

/** App→kernel assembly leaf. color is pre-resolved to 0–1 RGB app-side. */
export type ExportLeaf = {
  partId: string;
  name: string;
  pose: ExportPose;
  color?: readonly [number, number, number];
  /**
   * PC-1: Populated by resolveExportLeaves so checkInterference (Task 3) can
   * read partId, pose, name, AND componentPath from the same array — no zip needed.
   * ComponentPath = ReadonlyArray<string> from @zilventor/shared/componentPath.
   */
  componentPath?: import('@zilventor/shared').ComponentPath;
  /**
   * C1: Furniture role from ComponentInstance.role — threaded through for the
   * carcass-noise filter in runInterferenceCheck (suppresses same-cabinet
   * structural-panel false clashes).
   */
  role?: string;
};

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
  setMaterials(partId: string, materials: MaterialEntry[]): Promise<void>;
  /** Register raw JPEG bytes for a custom texture blob. Must be called before
   *  `saveToBytes` for any part that references this blobId in its
   *  `customTextures` array. Stores a defensive copy. */
  registerCustomTexture(blobId: string, bytes: Uint8Array): Promise<void>;
  /** Update the `customTextures` list stored on the part.  Throws if the
   *  partId is unknown. */
  setCustomTextures(partId: string, defs: CustomTextureDef[]): Promise<void>;
  deletePart(partId: string): Promise<void>;
  execute(partId: string): Promise<Result<ExecuteResult, KernelError>>;
  previewFeature(partId: string, feature: Feature): Promise<Result<ExecuteResult, KernelError>>;
  getPart(partId: string): Promise<PartDocument | null>;
  save(partId: string, handle: FileSystemFileHandle, thumbnail?: Uint8Array): Promise<void>;
  saveToBytes(partId: string, thumbnail?: Uint8Array): Promise<Uint8Array>;
  load(handle: FileSystemFileHandle): Promise<string>;
  loadFromBytes(bytes: Uint8Array): Promise<string>;
  /** Direct-insert a fully-constructed PartDocument into the kernel's parts map.
   *  Used by the stand-alone STEP importer, where the imported brep blob is
   *  already in the kernel's importedShapeCache (populated by importStep) and
   *  no archive round-trip is needed. Throws if the kernel is not initialized
   *  or if a part with the same id is already registered. */
  registerPart(part: PartDocument): Promise<void>;
  /**
   * Create a new part whose geometry is `sourcePartId` mirrored across its
   * local YZ plane (S = diag(-1,1,1)). The mirrored BREP blob is registered
   * in importedShapeCache; the new PartDocument is registered in parts.
   * Returns the new partId and brepBlobId so the caller can save to OPFS.
   *
   * The source part must have been executed (namedShapeCache warm) or be
   * executable. Throws if sourcePartId is unknown or execute fails.
   */
  mirrorPart(sourcePartId: string): Promise<{ partId: string; brepBlobId: string }>;
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
    solidCount: number;
    /** Per-solid surface colors (#rrggbb or null), index-aligned with the
     *  TopExp_Explorer enumeration. Exposed so single-part callers can read
     *  the first solid color without a separate splitImportedShape round-trip.
     *  The full array is also cached internally for splitImportedShape. */
    solidColors: (string | null)[];
  }>;
  /**
   * Splits a previously-imported compound (looked up by brepBlobId in
   * importedShapeCache) into individual solid blobs + one merged surfaces blob.
   * Each result blob is registered in importedShapeCache. Throws if brepBlobId
   * is not cached, or if the compound has zero geometry.
   */
  splitImportedShape(brepBlobId: string): Promise<{
    solids: Array<{ brepBlobId: string; boundingBox: BoundingBox; color?: string }>;
    surfaces: { brepBlobId: string; boundingBox: BoundingBox } | null;
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
  /** Export a single registered part as a 1-leaf XCAF STEP doc (identity pose, no color). */
  exportStepPart(partId: string): Promise<Uint8Array>;
  /** Export an assembly: un-posed prototype per distinct partId, posed component per leaf. */
  exportStepAssembly(leaves: readonly ExportLeaf[], opts?: { name?: string }): Promise<Uint8Array>;
  /** Export a single part as binary STL (re-executes if cache is cold). */
  exportStlPart(partId: string, opts?: { binary?: boolean }): Promise<Uint8Array>;
  /** Export an assembly as binary STL (re-executes leaves if cache is cold). */
  exportStlAssembly(leaves: readonly ExportLeaf[], opts?: { binary?: boolean }): Promise<Uint8Array>;
  /**
   * SC-1/SC-2/SC-3/SC-4/SC-5: AABB broad-phase + Common/Distance narrow-phase
   * interference/clearance check for a flat list of posed leaves.
   * Returns only pairs with real penetration (volume > volumeThreshold) or
   * near-misses (0 < dist ≤ clearanceThreshold). Touching faces fall through
   * both filters and produce no result — the volume threshold is load-bearing for this.
   * Per-pair try/catch: degenerate pairs are skipped and logged, run continues.
   */
  checkInterference(
    leaves: ReadonlyArray<{ partId: string; pose: { translation: { x: number; y: number; z: number }; quaternion: readonly [number, number, number, number] } }>,
    opts: { volumeThreshold: number; clearanceThreshold: number },
  ): Promise<import('@zilventor/shared').ClashPair[]>;
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
  /** Per-import solid colors, keyed by the whole-compound brepBlobId returned
   *  by importStep. Consumed by splitImportedShape (separate round-trip). */
  const importedColorCache = new Map<string, (string | null)[]>();
  /** Kernel-global registry of custom texture JPEG bytes, keyed by blobId.
   *  Populated by `registerCustomTexture`; walked by `saveToBytes` to embed
   *  `textures/<id>.jpg` entries; populated by `loadFromBytes` on restore. */
  const customTextureBlobs = new Map<string, Uint8Array>();

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

  /**
   * Ensure namedShapeCache has a warm entry for `partId`. If the cache is cold
   * (e.g., after `loadFromBytes` which populates `parts` but NOT the cache),
   * re-executes the feature tree and warms the cache. Lifted verbatim from the
   * extractAssemblyRef / mirrorPart cold-cache pattern (api.ts:519-528 / :467-474).
   */
  async function warmShapeForExport(partId: string): Promise<import('./occt/FaceNaming').NamedShape> {
    let ns = namedShapeCache.get(partId);
    if (!ns) {
      const p = parts.get(partId);
      if (!p) throw new Error(`export: leaf part ${partId} not loaded`);
      const r = await executeTree(occt!, p, lookupImportedShape);
      if (!r.ok) throw new Error(`export: execute failed for ${partId}: ${r.error.message}`);
      updateNamedShapeCache(partId, r.value.namedShape, r.value.workFeatures ?? []);
      ns = r.value.namedShape;
    }
    return ns;
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

    async setMaterials(partId, materials) {
      const p = parts.get(partId);
      if (!p) throw new Error(`setMaterials: unknown partId ${partId}`);
      parts.set(partId, { ...p, materials: [...materials] });
    },

    async registerCustomTexture(blobId, bytes) {
      customTextureBlobs.set(blobId, bytes.slice());
    },

    async setCustomTextures(partId, defs) {
      const p = parts.get(partId);
      if (!p) throw new Error(`setCustomTextures: unknown partId ${partId}`);
      parts.set(partId, { ...p, customTextures: [...defs] });
    },

    async deletePart(partId) {
      const ns = namedShapeCache.get(partId);
      if (ns) disposeShape(ns.shape);
      namedShapeCache.delete(partId);
      workFeatureCache.delete(partId);

      // K3: evict importedShapeCache entries for bodyRefs that belong ONLY to this
      // part (no other active part references them). This prevents unbounded Map growth
      // when imported parts are repeatedly created and deleted.
      //
      // OCCT SAFETY: we only evict the Map entry (and dispose the OCCT shape) when we
      // can prove the bodyRef has a ref-count of zero across all remaining parts after
      // this deletion. If another active part still references the same bodyRef, we skip
      // eviction entirely — the shape stays alive for that part's executeTree calls.
      //
      // UNDO/REDO CAVEAT: application-level undo (e.g. ImportStepAsComponentCommand)
      // may call registerPart() with the same brepBlobId after deletePart(). If the
      // Map entry was evicted here, that redo path would fail on the next execute() call.
      // To preserve undo/redo, we only evict when the ref-count across remaining parts
      // drops to zero — meaning no existing part (even post-undo) could reference it.
      // Any undo command that relies on the blob surviving deletePart must either keep
      // its own bytes and call loadFromBytes, or hold a reference via another registered
      // part.
      const partToDelete = parts.get(partId);
      if (partToDelete) {
        // Collect bodyRefs used by the part being deleted.
        const deletedRefs = new Set<string>();
        for (const f of partToDelete.featureTree) {
          if (f.kind === 'imported') deletedRefs.add(f.bodyRef);
        }
        if (deletedRefs.size > 0) {
          // Count how many remaining parts (excluding the one being deleted) still reference each bodyRef.
          const remaining = new Set<string>();
          for (const [pid, p] of parts.entries()) {
            if (pid === partId) continue;
            for (const f of p.featureTree) {
              if (f.kind === 'imported') remaining.add(f.bodyRef);
            }
          }
          // Evict only refs that have zero remaining references.
          for (const ref of deletedRefs) {
            if (!remaining.has(ref)) {
              const shape = importedShapeCache.get(ref);
              if (shape) disposeShape(shape);
              importedShapeCache.delete(ref);
              importedColorCache.delete(ref);
            }
          }
        }
      }

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
        formatVersion: CURRENT_FORMAT_VERSION,
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
      // Collect custom-texture JPEG bytes referenced by this part.
      const textures: Record<string, Uint8Array> = {};
      for (const ct of (part.customTextures ?? [])) {
        for (const ref of [ct.albedoBlobId, ct.normalBlobId, ct.roughnessBlobId]) {
          if (!ref) continue;
          const b = customTextureBlobs.get(ref);
          if (!b) throw new Error(`saveToBytes: custom texture blob ${ref} not in registry`);
          textures[ref] = b;
        }
      }

      return await packProject({
        manifest,
        blobs,
        ...(Object.keys(textures).length ? { textures } : {}),
        ...(thumbnail ? { thumbnail } : {}),
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
      const { manifest, blobs, textures } = await unpackProject(bytes);
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

      // Restore custom-texture JPEG bytes into the kernel registry.
      if (textures) {
        for (const [id, b] of Object.entries(textures)) customTextureBlobs.set(id, b);
      }

      parts.set(part.id, part);
      return part.id;
    },

    async registerPart(part) {
      if (!occt) throw new Error('kernel not initialized');
      if (parts.has(part.id)) throw new Error(`registerPart: part ${part.id} is already registered`);
      parts.set(part.id, part);
    },

    async mirrorPart(sourcePartId) {
      if (!occt) throw new Error('kernel not initialized');
      const srcPart = parts.get(sourcePartId);
      if (!srcPart) throw new Error(`mirrorPart: unknown part ${sourcePartId}`);

      // Ensure namedShape is warm; execute if needed
      let ns = namedShapeCache.get(sourcePartId);
      if (!ns) {
        const r = await executeTree(occt, srcPart, lookupImportedShape);
        if (!r.ok) throw new Error(`mirrorPart: execute failed for ${sourcePartId}: ${r.error.message}`);
        updateNamedShapeCache(sourcePartId, r.value.namedShape, r.value.workFeatures ?? []);
        ns = r.value.namedShape;
      }

      // mirrorShape(oc, shape, 'yz') reflects X axis → S = diag(-1,1,1)
      // Static import at line 22: import { transformShapeByPose, mirrorShape } from './occt/TransformOps'
      const mirrored = mirrorShape(occt, ns.shape, 'yz');
      const brepBlobId = `mirror-${crypto.randomUUID()}`;
      registerImportedShape(brepBlobId, mirrored);

      const newId = crypto.randomUUID();
      const featureId = `mirror-body-${newId}`;

      // Inline the 7 origin work-features (mirrors ORIGIN_FEATURES from app/src/import/originFeatures.ts)
      // Kernel cannot import from app — inline directly.
      const originFeatures: PartDocument['featureTree'] = [
        { kind: 'workAxis',  id: 'origin.X',  visible: false, source: { mode: 'origin', axis: 'X' } },
        { kind: 'workAxis',  id: 'origin.Y',  visible: false, source: { mode: 'origin', axis: 'Y' } },
        { kind: 'workAxis',  id: 'origin.Z',  visible: false, source: { mode: 'origin', axis: 'Z' } },
        { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
        { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } },
        { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } },
        { kind: 'workPoint', id: 'origin.O',  visible: false, source: { mode: 'origin' } },
      ];
      const mirrorPartDoc: PartDocument = {
        id: newId,
        name: `${srcPart.name}_mirror`,
        units: 'mm',
        parameters: {},
        featureTree: [
          ...originFeatures,
          { kind: 'imported', id: featureId, sourceStep: `${srcPart.name}_mirror`, bodyRef: brepBlobId },
        ],
        properties: {},
        materials: [],
        hardware: [],
      };
      parts.set(newId, mirrorPartDoc);
      return { partId: newId, brepBlobId };
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

    // --- STEP export (Phase 3/4) ---
    // Cold-cache fallback: namedShapeCache is NOT warmed by loadFromBytes,
    // so every export re-executes when cold (pattern lifted from
    // extractAssemblyRef:519-528 / mirrorPart:467-474). Throws on unknown part.
    async exportStepPart(partId) {
      if (!occt) throw new Error('kernel not initialized');
      const ns = await warmShapeForExport(partId);
      const p = parts.get(partId)!;
      const leaf: KernelExportLeaf = { shape: ns.shape, protoKey: partId, name: p.name, pose: IDENTITY_POSE };
      return exportStepDoc(occt, [leaf]);
    },

    async exportStepAssembly(leaves, _opts) {
      if (!occt) throw new Error('kernel not initialized');
      if (leaves.length === 0) throw new Error('exportStepAssembly: no leaves');
      const kernelLeaves: KernelExportLeaf[] = [];
      for (const leaf of leaves) {
        const ns = await warmShapeForExport(leaf.partId);
        kernelLeaves.push({
          shape: ns.shape,
          protoKey: leaf.partId,
          name: leaf.name,
          pose: leaf.pose,
          ...(leaf.color ? { color: leaf.color } : {}),
        });
      }
      return exportStepDoc(occt, kernelLeaves);
    },

    // --- STL export (Phase 1/2) ---
    // STL methods honor opts?.binary (true/absent → binary; ASCII is a non-goal).
    async exportStlPart(partId, opts) {
      if (!occt) throw new Error('kernel not initialized');
      const ns = await warmShapeForExport(partId);
      const stlLeaf: StlExportLeaf = { shape: ns.shape, pose: IDENTITY_POSE };
      return exportStlBinary(occt, [stlLeaf], { binary: opts?.binary !== false });
    },

    async exportStlAssembly(leaves, opts) {
      if (!occt) throw new Error('kernel not initialized');
      if (leaves.length === 0) throw new Error('exportStlAssembly: no leaves');
      const stlLeaves: StlExportLeaf[] = [];
      for (const leaf of leaves) {
        const ns = await warmShapeForExport(leaf.partId);
        stlLeaves.push({ shape: ns.shape, pose: leaf.pose });
      }
      return exportStlBinary(occt, stlLeaves, { binary: opts?.binary !== false });
    },

    async importStep({ stepBytes, partName: _partName }) {
      if (!occt) throw new Error('kernel not initialized');
      const result = readStep(occt, stepBytes);
      // triangleCount is always 0 — tessellation was removed because no
      // caller reads it and the render mesh is recomputed by executeTree.
      const brepBlobId = `imp-${crypto.randomUUID()}`;
      registerImportedShape(brepBlobId, result.shape);
      importedColorCache.set(brepBlobId, result.solidColors);
      return {
        brepBlobId,
        triangleCount: 0,
        boundingBox: result.boundingBox,
        faceCount: result.faceCount,
        solidCount: result.solidCount,
        solidColors: result.solidColors,
      };
    },

    async splitImportedShape(brepBlobId) {
      if (!occt) throw new Error('kernel not initialized');
      const cached = importedShapeCache.get(brepBlobId);
      if (!cached) throw new Error(`splitImportedShape: brepBlobId '${brepBlobId}' not in importedShapeCache`);
      const solidColors = importedColorCache.get(brepBlobId);
      const result = splitImportedShapeHelper(occt, cached, solidColors);
      // K3: the original compound (brepBlobId) is intentionally NOT evicted here.
      // ExplodeIntoAssemblyCommand.apply() calls splitImportedShape on the original
      // compound; its redo path calls apply() again after revert() — which calls
      // deletePart() on the exploded children. After revert, the original part is still
      // registered (the prior active document is restored), so the deletePart() ref-count
      // check above keeps the compound alive. When redo fires, splitImportedShape succeeds
      // because the original compound is still in cache.
      // The per-solid and surfaces blobs registered below are the new children.
      const solids = result.solids.map((s) => {
        registerImportedShape(s.brepBlobId, s.shape);
        return { brepBlobId: s.brepBlobId, boundingBox: s.boundingBox, ...(s.color ? { color: s.color } : {}) };
      });
      let surfaces: { brepBlobId: string; boundingBox: BoundingBox } | null = null;
      if (result.surfaces) {
        const surfacesBbox = computeBoundingBox(occt, result.surfaces.shape);
        registerImportedShape(result.surfaces.brepBlobId, result.surfaces.shape);
        surfaces = { brepBlobId: result.surfaces.brepBlobId, boundingBox: surfacesBbox };
      }
      return { solids, surfaces };
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

    async checkInterference(leaves, opts) {
      if (!occt) throw new Error('kernel not initialized');
      if (leaves.length < 2) return [];

      const oc = occt as any;

      // Step 1: Warm all shapes and compute world-posed copies + AABBs.
      type ShapeEntry = {
        posedShape: OcctShape;
        aabb: [number, number, number, number, number, number]; // xmin,ymin,zmin,xmax,ymax,zmax
      };
      const entries: (ShapeEntry | null)[] = [];

      for (const leaf of leaves) {
        try {
          const ns = await warmShapeForExport(leaf.partId);
          const posedShape = transformShapeByPose(occt!, ns.shape, leaf.pose);
          // computeBoundingBox returns [xmin,ymin,zmin,xmax,ymax,zmax] directly.
          const aabb = computeBoundingBox(occt!, posedShape);
          entries.push({ posedShape, aabb });
        } catch (e) {
          console.warn(`checkInterference: skipping leaf ${leaf.partId}: ${(e as Error).message}`);
          entries.push(null);
        }
      }

      // Helper: AABBs overlap when each axis overlaps (expanded by clearanceThreshold).
      function aabbsOverlap(
        a: [number,number,number,number,number,number],
        b: [number,number,number,number,number,number],
        expand: number,
      ): boolean {
        return (
          a[0] - expand <= b[3] && a[3] + expand >= b[0] &&
          a[1] - expand <= b[4] && a[4] + expand >= b[1] &&
          a[2] - expand <= b[5] && a[5] + expand >= b[2]
        );
      }

      // Helper: volume of a shape via BRepGProp.VolumeProperties_1 (SC-3).
      function shapeVol(handle: unknown): number {
        const props = new oc.GProp_GProps_1();
        try {
          oc.BRepGProp.VolumeProperties_1(handle, props, true, false, false);
          return props.Mass();
        } finally {
          props.delete?.();
        }
      }

      const results: import('@zilventor/shared').ClashPair[] = [];

      for (let i = 0; i < entries.length; i++) {
        const ei = entries[i];
        if (!ei) continue;
        for (let j = i + 1; j < entries.length; j++) {
          const ej = entries[j];
          if (!ej) continue;

          // Broad-phase: skip if AABBs don't overlap even with expansion.
          if (!aabbsOverlap(ei.aabb, ej.aabb, opts.clearanceThreshold)) continue;

          try {
            // SC-5: each OCCT object is declared before its allocation so the
            // finally block can dispose it unconditionally on ALL paths —
            // including exceptions, !IsDone() continue, and normal completion.
            // SC-5: declare all per-pair OCCT handles up-front so the finally
            // block can dispose them unconditionally on ALL paths — exception,
            // !IsDone() continue, and normal completion.
            // eslint-disable-next-line prefer-const
            let rangeCtor: { delete?(): void } | null = null;
            let rangeBuild: { delete?(): void } | null = null;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let common: any | null = null;
            let distRange: { delete?(): void } | null = null;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let extrema: any | null = null;
            try {
              // SC-1: BRepAlgoAPI_Common_3 + explicit Build (two separate ProgressRange objects).
              rangeCtor = new oc.Message_ProgressRange_1();
              rangeBuild = new oc.Message_ProgressRange_1();
              common = new oc.BRepAlgoAPI_Common_3(
                ei.posedShape.handle as never,
                ej.posedShape.handle as never,
                rangeCtor,
              );
              common.Build(rangeBuild);

              let isInterference = false;
              // SC-3: guard HasErrors before volume check.
              if (!common.HasErrors()) {
                const commonShape = common.Shape();
                // SC-3: check for solid via TopExp_Explorer (mirroring BooleanOps.ts).
                const explorer = new oc.TopExp_Explorer_2(
                  commonShape as never,
                  oc.TopAbs_ShapeEnum.TopAbs_SOLID as never,
                  oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
                );
                const hasSolid = explorer.More();
                explorer.delete?.();

                if (hasSolid) {
                  const vol = shapeVol(commonShape);
                  if (vol > opts.volumeThreshold) {
                    isInterference = true;
                    results.push({ aIndex: i, bIndex: j, kind: 'interference', volume: vol });
                  }
                }
                (commonShape as { delete?: () => void }).delete?.();
              }

              // Only check clearance if NOT interference (SC-13a precedence).
              if (!isInterference) {
                // SC-2: BRepExtrema_DistShapeShape — _1() + LoadS1/LoadS2 + Perform + IsDone (PC-3).
                distRange = new oc.Message_ProgressRange_1();
                extrema = new oc.BRepExtrema_DistShapeShape_1();
                extrema.LoadS1(ei.posedShape.handle as never);
                extrema.LoadS2(ej.posedShape.handle as never);
                extrema.Perform(distRange);
                // PC-3: guard IsDone() before Value() — failed Perform returns garbage, not throw.
                if (!extrema.IsDone()) {
                  // finally disposes distRange + extrema before the continue.
                  continue;
                }
                const dist: number = extrema.Value();
                // Value() returns 0 for touching/overlapping; only report strictly positive.
                if (dist > 0 && dist <= opts.clearanceThreshold) {
                  results.push({ aIndex: i, bIndex: j, kind: 'clearance', distance: dist });
                }
              }
            } finally {
              // SC-5: dispose every per-pair OCCT object on ALL paths
              // (exception, !IsDone() continue, and normal completion).
              rangeCtor?.delete?.();
              rangeBuild?.delete?.();
              common?.delete?.();
              distRange?.delete?.();
              extrema?.delete?.();
            }
          } catch (e) {
            console.warn(`checkInterference: pair (${i},${j}) threw, skipping: ${(e as Error).message}`);
          }
        }
      }

      // SC-5: dispose all posed copies after processing all pairs.
      for (const entry of entries) {
        if (entry) {
          (entry.posedShape.handle as { delete?: () => void }).delete?.();
        }
      }

      return results;
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
