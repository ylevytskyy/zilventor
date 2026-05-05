// packages/app/src/drawing/toolMode.ts
import { create } from 'zustand';

export type ToolMode =
  | 'idle'
  | 'placeBase'
  | 'placeProjected'
  | 'placeIso'
  | 'addLinearH'
  | 'addLinearV'
  | 'addAligned'
  | 'addRadial'
  | 'addDiametric'
  | 'addCenterline'
  | 'addCenterMark'
  | 'addLeader'
  | 'addBalloon'
  | 'section'
  | 'detail';    // NEW — Drawing F2

export type PendingViewParams =
  | {
      kind: 'base';
      orientation: 'front' | 'top' | 'right' | 'back' | 'bottom' | 'left';
      scale: { n: number; d: number };
    }
  | {
      kind: 'projected';
      baseViewId: string;
      direction: 'top' | 'bottom' | 'left' | 'right';
    }
  | {
      kind: 'iso';
      corner: 'NE' | 'NW' | 'SE' | 'SW';
      scale: { n: number; d: number };
    };

// ---------------------------------------------------------------------------
// Detail tool sub-state
// ---------------------------------------------------------------------------
export type DetailToolState =
  | { stage: 'idle' }
  | { stage: 'pickRegionCenter'; parentViewId: string }
  | { stage: 'pickRegionRadius'; parentViewId: string; center: { x: number; y: number } }
  | {
      stage: 'pickDrop';
      parentViewId: string;
      center: { x: number; y: number };
      radiusMm: number;
    };

// ---------------------------------------------------------------------------
// Section tool sub-state
// ---------------------------------------------------------------------------
export type SectionToolState =
  | { stage: 'idle' }
  | { stage: 'pickP0'; parentViewId: string }
  | { stage: 'pickP1'; parentViewId: string; p0: { x: number; y: number } }
  | {
      stage: 'pickDrop';
      parentViewId: string;
      p0: { x: number; y: number };
      p1: { x: number; y: number };
      arrowDirection: -1 | 1;
    };

interface ToolModeState {
  mode: ToolMode;
  pendingViewParams: PendingViewParams | null;
  sectionState: SectionToolState;
  detailState: DetailToolState;

  setMode(mode: ToolMode): void;
  setPendingViewParams(p: PendingViewParams | null): void;
  reset(): void;

  // Section tool actions
  enterSectionMode(): void;
  sectionPickParent(viewId: string): void;
  sectionPickP0(point: { x: number; y: number }): void;
  sectionPickP1(point: { x: number; y: number }): void;
  sectionPickDrop(point: { x: number; y: number }, onDispatch: () => void): void;
  sectionCancel(): void;

  // Detail tool actions
  enterDetailMode(): void;
  detailPickParent(viewId: string): void;
  detailPickCenter(point: { x: number; y: number }): void;
}

export const useToolModeStore = create<ToolModeState>((set, get) => ({
  mode: 'idle',
  pendingViewParams: null,
  sectionState: { stage: 'idle' },
  detailState: { stage: 'idle' },

  setMode(mode) {
    set({ mode });
  },

  setPendingViewParams(p) {
    set({ pendingViewParams: p });
  },

  reset() {
    set({ mode: 'idle', pendingViewParams: null, sectionState: { stage: 'idle' }, detailState: { stage: 'idle' } });
  },

  enterSectionMode() {
    set({ mode: 'section', sectionState: { stage: 'idle' } });
  },

  sectionPickParent(viewId) {
    const { sectionState } = get();
    if (sectionState.stage !== 'idle') {
      console.warn('sectionPickParent: expected stage=idle, got', sectionState.stage);
      return;
    }
    set({ sectionState: { stage: 'pickP0', parentViewId: viewId } });
  },

  sectionPickP0(point) {
    const { sectionState } = get();
    if (sectionState.stage !== 'pickP0') {
      console.warn('sectionPickP0: expected stage=pickP0, got', sectionState.stage);
      return;
    }
    set({
      sectionState: {
        stage: 'pickP1',
        parentViewId: sectionState.parentViewId,
        p0: point,
      },
    });
  },

  sectionPickP1(point) {
    const { sectionState } = get();
    if (sectionState.stage !== 'pickP1') {
      console.warn('sectionPickP1: expected stage=pickP1, got', sectionState.stage);
      return;
    }
    set({
      sectionState: {
        stage: 'pickDrop',
        parentViewId: sectionState.parentViewId,
        p0: sectionState.p0,
        p1: point,
        arrowDirection: 1, // default; flip UI deferred to F-followup §12.1
      },
    });
  },

  sectionPickDrop(_point, onDispatch) {
    const { sectionState } = get();
    if (sectionState.stage !== 'pickDrop') {
      console.warn('sectionPickDrop: expected stage=pickDrop, got', sectionState.stage);
      return;
    }
    onDispatch();
    set({ sectionState: { stage: 'idle' } });
  },

  sectionCancel() {
    const { sectionState, mode } = get();
    if (sectionState.stage === 'idle' && mode === 'section') {
      // Second ESC: exit section mode entirely
      set({ mode: 'idle', sectionState: { stage: 'idle' } });
    } else {
      set({ sectionState: { stage: 'idle' } });
    }
  },

  enterDetailMode() {
    set({ mode: 'detail', detailState: { stage: 'idle' } });
  },

  detailPickParent(viewId) {
    const { detailState } = get();
    if (detailState.stage !== 'idle') {
      console.warn('detailPickParent: expected stage=idle, got', detailState.stage);
      return;
    }
    set({ detailState: { stage: 'pickRegionCenter', parentViewId: viewId } });
  },

  detailPickCenter(point) {
    const { detailState } = get();
    if (detailState.stage !== 'pickRegionCenter') {
      console.warn('detailPickCenter: expected stage=pickRegionCenter, got', detailState.stage);
      return;
    }
    set({
      detailState: {
        stage: 'pickRegionRadius',
        parentViewId: detailState.parentViewId,
        center: point,
      },
    });
  },
}));
