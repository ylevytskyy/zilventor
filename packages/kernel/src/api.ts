import type { Feature, Parameter, Mesh, PartDocument, Result, KernelError } from '@zilventor/shared';
import { migrateManifest, type AnyManifest } from '@zilventor/shared';
import { loadOcct, type OcctInstance } from './occt/occtLoader';
import { executeTree } from './adapter/FeatureTree';
import { newPart, addFeature as addFeatureToPart, setParameter as setParameterOnPart, removeParameter as removeParameterFromPart } from './adapter/PartDocument';
import { disposeShape } from './occt/SolidOps';
import { writeBRep } from './occt/BRepIO';
import { packProject, unpackProject } from './storage/ProjectPacker';
import { writeToHandle, readFromHandle } from './storage/FileSystemAccess';

export type ExecuteResult = { mesh: Mesh };

export type KernelApi = {
  init(): Promise<void>;
  ping(input: string): Promise<{ reply: 'pong'; echo: string }>;
  createPart(name: string): Promise<string>;
  addFeature(partId: string, feature: Feature): Promise<void>;
  setParameter(partId: string, param: Parameter): Promise<void>;
  deleteParameter(partId: string, name: string): Promise<void>;
  execute(partId: string): Promise<Result<ExecuteResult, KernelError>>;
  getPart(partId: string): Promise<PartDocument | null>;
  save(partId: string, handle: FileSystemFileHandle): Promise<void>;
  load(handle: FileSystemFileHandle): Promise<string>;
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

    async execute(partId) {
      if (!occt) throw new Error('kernel not initialized');
      const p = parts.get(partId);
      if (!p) throw new Error(`no part ${partId}`);
      const r = await executeTree(occt, p);
      if (!r.ok) return r;
      // Dispose the solid — we only ship the mesh across the worker boundary.
      disposeShape(r.value.finalSolid);
      return { ok: true, value: { mesh: r.value.mesh } };
    },

    async getPart(partId) {
      return parts.get(partId) ?? null;
    },

    async save(partId, handle) {
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
        const archive = await packProject({ manifest, blobs: { main: brep } });
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
    }
  };
}
