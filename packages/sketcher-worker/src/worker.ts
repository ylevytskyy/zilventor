import * as Comlink from 'comlink';
import type { SketchPrimitive, PointRef } from '@zilventor/shared';
import { GcsSystem } from './GcsSystem';
import { loadPlanegcs } from './planegcsLoader';
import { inferFromSnaps } from './inferFromSnaps';
import type { SketcherWorkerApi, SnapEvent } from './types';

let active: GcsSystem | null = null;

async function ensureSys(): Promise<GcsSystem> {
  if (!active) {
    const { createWrapper } = await loadPlanegcs();
    active = new GcsSystem(createWrapper());
  }
  return active;
}

const api: SketcherWorkerApi = {
  async loadSketch(args) { return (await ensureSys()).loadSketch(args); },
  async unloadSketch() {
    if (active) { await active.unloadSketch(); active = null; }
  },
  async addPrimitive(p)            { return (await ensureSys()).addPrimitive(p); },
  async removePrimitive(id)        { return (await ensureSys()).removePrimitive(id); },
  async updatePrimitive(id, patch) { return (await ensureSys()).updatePrimitive(id, patch); },
  async addConstraint(c)           { return (await ensureSys()).addConstraint(c); },
  async removeConstraint(id)       { return (await ensureSys()).removeConstraint(id); },
  async addDimension(constraint, resolvedValue) { return (await ensureSys()).addDimension(constraint, resolvedValue); },
  async removeDimension(id)                     { return (await ensureSys()).removeDimension(id); },
  async updateDimensionValue(id, resolvedValue) { return (await ensureSys()).updateDimensionValue(id, resolvedValue); },
  async beginDrag(ref: PointRef)   { return (await ensureSys()).beginDrag(ref); },
  async dragTo(x, y)               { return (await ensureSys()).dragTo(x, y); },
  async endDrag()                  { return (await ensureSys()).endDrag(); },
  async inferFromSnaps(p: SketchPrimitive, snapEvents: SnapEvent[]) {
    return inferFromSnaps(p, snapEvents);
  },
};

Comlink.expose(api);
