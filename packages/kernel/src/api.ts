import type { Feature, Parameter, Mesh, PartDocument, Result, KernelError } from '@zilventor/shared';
import { loadOcct, type OcctInstance } from './occt/occtLoader';
import { executeTree } from './adapter/FeatureTree';
import { newPart, addFeature as addFeatureToPart, setParameter as setParameterOnPart, removeParameter as removeParameterFromPart } from './adapter/PartDocument';
import { disposeShape } from './occt/SolidOps';

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
    }
  };
}
