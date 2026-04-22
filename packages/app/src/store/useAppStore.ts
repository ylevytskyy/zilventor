import { create } from 'zustand';
import type { PartDocument } from '@zilventor/shared';
import type { KernelClient } from '../kernel-client/KernelClient';
import { createCommandBus, type CommandBus } from '../commands/CommandBus';

type AppState = {
  kernel: KernelClient | null;
  bus: CommandBus;
  activePart: PartDocument | null;
  kernelReady: boolean;
  statusMessage: string;
  selectedFeatureId: string | null;
  setKernel(k: KernelClient): void;
  setActivePart(p: PartDocument | null): void;
  setStatus(msg: string): void;
  setSelectedFeature(id: string | null): void;
};

export const useAppStore = create<AppState>((set) => ({
  kernel: null,
  bus: createCommandBus(),
  activePart: null,
  kernelReady: false,
  statusMessage: 'Loading…',
  selectedFeatureId: null,
  setKernel: (k) => set({ kernel: k, kernelReady: true, statusMessage: 'Ready' }),
  setActivePart: (p) => set({ activePart: p }),
  setStatus: (msg) => set({ statusMessage: msg }),
  setSelectedFeature: (id) => set({ selectedFeatureId: id })
}));
