import { create } from 'zustand';
import type { PartDocument } from '@zilventor/shared';
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
  setKernel(k: KernelClient): void;
  setActivePart(p: PartDocument | null): void;
  setStatus(msg: string): void;
  setSelectedFeature(id: string | null): void;
  setViewport(v: ViewportRef | null): void;
  setSketchMode(mode: boolean, sketchId?: string | null): void;
  setActiveToolKind(kind: ToolKind | null): void;
  setSelectedPrimitive(id: string | null): void;
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
  setSelectedPrimitive: (id) => set({ selectedPrimitiveId: id })
}));
