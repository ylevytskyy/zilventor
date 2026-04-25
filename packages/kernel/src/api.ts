import type { Feature, Parameter, Mesh, PartDocument, Result, KernelError, SketchPrimitive, TessellatedEdge, TessellatedFace, FaceName } from '@zilventor/shared';
import { migrateManifest, type AnyManifest } from '@zilventor/shared';
import { loadOcct, type OcctInstance } from './occt/occtLoader';
import { executeTree } from './adapter/FeatureTree';
import { newPart, addFeature as addFeatureToPart, setParameter as setParameterOnPart, removeParameter as removeParameterFromPart, removeFeature as removeFeatureFromPart, addPrimitive as addPrimitiveToPart, removePrimitive as removePrimitiveFromPart } from './adapter/PartDocument';
import { disposeShape } from './occt/SolidOps';
import { writeBRep } from './occt/BRepIO';
import { packProject, unpackProject } from './storage/ProjectPacker';
import { writeToHandle, readFromHandle } from './storage/FileSystemAccess';

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
};

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
  load(handle: FileSystemFileHandle): Promise<string>;
  loadFromBytes(bytes: Uint8Array): Promise<string>;
};

export function createKernelApi(): KernelApi {
  let occt: OcctInstance | null = null;
  const parts = new Map<string, PartDocument>();

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
      parts.delete(partId);
    },

    async execute(partId) {
      if (!occt) throw new Error('kernel not initialized');
      const p = parts.get(partId);
      if (!p) throw new Error(`no part ${partId}`);
      const r = await executeTree(occt, p);
      if (!r.ok) return r;
      // Dispose the solid — we only ship the mesh across the worker boundary.
      disposeShape(r.value.finalSolid);
      return {
        ok: true,
        value: {
          mesh: r.value.mesh,
          ...(r.value.tessellatedEdges ? { tessellatedEdges: r.value.tessellatedEdges } : {}),
          ...(r.value.faceNames ? { faceNames: r.value.faceNames } : {}),
          ...(r.value.tessellatedFaces ? { tessellatedFaces: r.value.tessellatedFaces } : {}),
          ...(r.value.featureErrors ? { featureErrors: r.value.featureErrors } : {})
        }
      };
    },

    async previewFeature(partId, feature) {
      if (!occt) throw new Error('kernel not initialized');
      const p = parts.get(partId);
      if (!p) throw new Error(`no part ${partId}`);
      // Virtual tree: stored part + scratch feature appended. No persistence.
      const virtual: PartDocument = { ...p, featureTree: [...p.featureTree, feature] };
      const r = await executeTree(occt, virtual);
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
      if (!occt) throw new Error('kernel not initialized');
      const part = parts.get(partId);
      if (!part) throw new Error(`no part ${partId}`);

      // Re-run the feature tree to build the cached solid
      const r = await executeTree(occt, part);
      if (!r.ok) throw new Error(`execute failed before save: ${r.error.message}`);

      try {
        const brep = writeBRep(occt, r.value.finalSolid);
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
        const archive = await packProject({
          manifest,
          blobs: { main: brep },
          ...(thumbnail ? { thumbnail } : {})
        });
        await writeToHandle(handle, archive);
      } finally {
        disposeShape(r.value.finalSolid);
      }
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
      const { manifest } = await unpackProject(bytes);
      const migrated = migrateManifest(manifest as AnyManifest);
      const part = (migrated as unknown as { document: PartDocument }).document;
      parts.set(part.id, part);
      return part.id;
    }
  };
}
