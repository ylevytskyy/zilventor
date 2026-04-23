import { create } from 'zustand';
import type { PartDocument, SketchConstraint, SketchPrimitive } from '@zilventor/shared';
import type { DofStatus, PrimitiveCoordsDiff } from '@zilventor/sketcher-worker';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { ViewportRef } from '../viewport/Viewport';
import { createCommandBus, type CommandBus } from '../commands/CommandBus';

export type ToolKind = 'line' | 'rect' | 'circle' | 'arc' | 'spline';

type AppState = {
  kernel: KernelClient | null;
  bus: CommandBus;
  activePart: PartDocument | null;
  kernelReady: boolean;
  statusMessage: string;
  selectedFeatureId: string | null;
  viewport: ViewportRef | null;
  sketchMode: boolean;
  activeSketchId: string | null;
  activeToolKind: ToolKind | null;
  selectedPrimitiveId: string | null;
  sketchDof: DofStatus | null;
  setKernel(k: KernelClient): void;
  setActivePart(p: PartDocument | null): void;
  setStatus(msg: string): void;
  setSelectedFeature(id: string | null): void;
  setViewport(v: ViewportRef | null): void;
  setSketchMode(mode: boolean, sketchId?: string | null): void;
  setActiveToolKind(kind: ToolKind | null): void;
  setSelectedPrimitive(id: string | null): void;
  setSketchDof(v: DofStatus | null): void;
  addPrimitiveToActiveSketch(sketchId: string, p: SketchPrimitive): void;
  removePrimitiveFromActiveSketch(sketchId: string, primitiveId: string): void;
  applyCoordDiff(sketchId: string, diff: PrimitiveCoordsDiff[]): void;
  addConstraintToActiveSketch(sketchId: string, c: SketchConstraint): void;
  removeConstraintFromActiveSketch(sketchId: string, constraintId: string): void;
};

export const useAppStore = create<AppState>((set) => ({
  kernel: null,
  bus: createCommandBus(),
  activePart: null,
  kernelReady: false,
  statusMessage: 'Loading…',
  selectedFeatureId: null,
  viewport: null,
  sketchMode: false,
  activeSketchId: null,
  activeToolKind: null,
  selectedPrimitiveId: null,
  setKernel: (k) => set({ kernel: k, kernelReady: true, statusMessage: 'Ready' }),
  setActivePart: (p) => set({ activePart: p }),
  setStatus: (msg) => set({ statusMessage: msg }),
  setSelectedFeature: (id) => set({ selectedFeatureId: id }),
  setViewport: (v) => set({ viewport: v }),
  setSketchMode: (mode, sketchId = null) =>
    set({
      sketchMode: mode,
      activeSketchId: sketchId,
      activeToolKind: null,
      selectedPrimitiveId: null
    }),
  setActiveToolKind: (kind) => set({ activeToolKind: kind }),
  setSelectedPrimitive: (id) => set({ selectedPrimitiveId: id }),
  sketchDof: null,
  setSketchDof: (v) => set({ sketchDof: v }),
  addPrimitiveToActiveSketch: (sketchId, p) => set((state) => {
    const part = state.activePart;
    if (!part) return state;
    const tree = part.featureTree.map((f) =>
      f.kind === 'sketch' && f.id === sketchId
        ? { ...f, primitives: [...f.primitives, p] }
        : f
    );
    return { activePart: { ...part, featureTree: tree } };
  }),
  removePrimitiveFromActiveSketch: (sketchId, primitiveId) => set((state) => {
    const part = state.activePart;
    if (!part) return state;
    const tree = part.featureTree.map((f) =>
      f.kind === 'sketch' && f.id === sketchId
        ? { ...f, primitives: f.primitives.filter((p) => p.id !== primitiveId) }
        : f
    );
    return { activePart: { ...part, featureTree: tree } };
  }),
  applyCoordDiff: (sketchId, diff) => set((state) => {
    const part = state.activePart;
    if (!part) return state;
    const patchesById = new Map(diff.map((d) => [d.primitiveId, d.patch]));
    const tree = part.featureTree.map((f) => {
      if (f.kind !== 'sketch' || f.id !== sketchId) return f;
      return {
        ...f,
        primitives: f.primitives.map((p) => {
          const patch = patchesById.get(p.id);
          return patch ? ({ ...p, ...patch } as typeof p) : p;
        })
      };
    });
    return { activePart: { ...part, featureTree: tree } };
  }),
  addConstraintToActiveSketch: (sketchId, c) => set((state) => {
    const part = state.activePart;
    if (!part) return state;
    const tree = part.featureTree.map((f) =>
      f.kind === 'sketch' && f.id === sketchId
        ? { ...f, constraints: [...f.constraints, c] }
        : f
    );
    return { activePart: { ...part, featureTree: tree } };
  }),
  removeConstraintFromActiveSketch: (sketchId, constraintId) => set((state) => {
    const part = state.activePart;
    if (!part) return state;
    const tree = part.featureTree.map((f) =>
      f.kind === 'sketch' && f.id === sketchId
        ? { ...f, constraints: f.constraints.filter((c) => c.id !== constraintId) }
        : f
    );
    return { activePart: { ...part, featureTree: tree } };
  })
}));
