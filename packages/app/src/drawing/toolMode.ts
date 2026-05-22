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
  | 'detail'
  | 'break'      // Drawing F3
  | 'autoDim'   // Drawing F4 — auto-dimensioning from sketch parameters
  | 'baseline'  // Drawing F5 — baseline dimension group (manual)
  | 'ordinate'  // Drawing F5 — ordinate dimension group (manual)
  | 'angular'   // Drawing F5 — angular dimension (two-edges or arc)
  | 'pickSteppedSection';  // Drawing F1.2 — stepped section authoring

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
// Break tool sub-state
// ---------------------------------------------------------------------------
export type BreakToolState =
  | { stage: 'idle' }
  | { stage: 'pickParent' }
  | { stage: 'pickAxis'; viewId: string }
  | { stage: 'pickP0'; viewId: string; axis: 'x' | 'y' }
  | { stage: 'pickP1'; viewId: string; axis: 'x' | 'y'; coordA: number };

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
    }
  | {
      stage: 'pickCutSide';
      parentViewId: string;
      p0: { x: number; y: number };
      p1: { x: number; y: number };
      arrowDirection: -1 | 1;
      dropAt: { x: number; y: number };
      pendingCutSide: -1 | 1;
    };

// ---------------------------------------------------------------------------
// Stepped section tool sub-state (Drawing F1.2 — spec §6.1)
// ---------------------------------------------------------------------------
export type SteppedSectionToolState =
  | { stage: 'idle' }
  | { stage: 'pickParent' }
  | {
      stage: 'placing';
      parentViewId: string;
      vertices: readonly { x: number; y: number }[];   // grows on each click
      lockedAxis?: 'x' | 'y';                          // present once vertices.length >= 1
    };

interface ToolModeState {
  mode: ToolMode;
  pendingViewParams: PendingViewParams | null;
  sectionState: SectionToolState;
  detailState: DetailToolState;
  breakState: BreakToolState;
  sectionMode: 'full' | 'half';
  steppedSectionState: SteppedSectionToolState;

  setMode(mode: ToolMode): void;
  setPendingViewParams(p: PendingViewParams | null): void;
  reset(): void;

  // Section tool actions
  enterSectionMode(): void;
  sectionPickParent(viewId: string): void;
  sectionPickP0(point: { x: number; y: number }): void;
  sectionPickP1(point: { x: number; y: number }): void;
  sectionPickDrop(point: { x: number; y: number }, onDispatch: () => void): void;
  sectionPickCutSide(side: -1 | 1): void;
  sectionCommitCutSide(onDispatch: (cutSide: -1 | 1, dropAt: { x: number; y: number }) => void): void;
  sectionCancel(): void;
  setSectionMode(m: 'full' | 'half'): void;

  // Stepped-section tool actions (Drawing F1.2)
  enterSteppedSectionMode(): void;
  steppedPickParent(viewId: string): void;
  steppedClickVertex(point: { x: number; y: number }): void;
  steppedToggleLockedAxis(): void;
  steppedCommit(
    onDispatch: (
      segments: readonly { startSheet: { x: number; y: number }; endSheet: { x: number; y: number } }[],
    ) => void,
  ): void;
  steppedCancel(): void;

  // Break tool actions
  enterBreakMode(): void;
  breakPickParent(viewId: string): void;
  breakSetAxis(axis: 'x' | 'y'): void;
  breakPickP0(coord: number): void;
  breakPickP1(coord: number, onDispatch: (coordA: number, coordB: number) => void): void;
  breakCancel(): void;

  // Detail tool actions
  enterDetailMode(): void;
  detailPickParent(viewId: string): void;
  detailPickCenter(point: { x: number; y: number }): void;
  detailPickRadius(point: { x: number; y: number }): void;
  detailPickDrop(point: { x: number; y: number }, onDispatch: () => void): void;
  detailCancel(): void;
}

export const useToolModeStore = create<ToolModeState>((set, get) => ({
  mode: 'idle',
  pendingViewParams: null,
  sectionState: { stage: 'idle' },
  detailState: { stage: 'idle' },
  breakState: { stage: 'idle' },
  sectionMode: 'full',
  steppedSectionState: { stage: 'idle' },

  setMode(mode) {
    set({ mode });
  },

  setPendingViewParams(p) {
    set({ pendingViewParams: p });
  },

  reset() {
    set({ mode: 'idle', pendingViewParams: null, sectionState: { stage: 'idle' }, detailState: { stage: 'idle' }, breakState: { stage: 'idle' }, sectionMode: 'full', steppedSectionState: { stage: 'idle' } });
  },

  setSectionMode(m) {
    set({ sectionMode: m });
  },

  enterSectionMode() {
    set({ mode: 'section', sectionState: { stage: 'idle' } });
  },

  enterSteppedSectionMode() {
    set({ mode: 'pickSteppedSection', steppedSectionState: { stage: 'pickParent' } });
  },

  steppedPickParent(viewId) {
    const { steppedSectionState } = get();
    if (steppedSectionState.stage !== 'pickParent') {
      console.warn('steppedPickParent: expected stage=pickParent, got', steppedSectionState.stage);
      return;
    }
    set({
      steppedSectionState: {
        stage: 'placing',
        parentViewId: viewId,
        vertices: [],
        // lockedAxis omitted (exactOptionalPropertyTypes); set on first vertex click.
      },
    });
  },

  steppedClickVertex(point) {
    const { steppedSectionState } = get();
    if (steppedSectionState.stage !== 'placing') {
      console.warn('steppedClickVertex: expected stage=placing, got', steppedSectionState.stage);
      return;
    }
    const { vertices, lockedAxis, parentViewId } = steppedSectionState;
    if (vertices.length === 0) {
      // First vertex: commit as-is; default lockedAxis = 'x'.
      set({
        steppedSectionState: {
          stage: 'placing',
          parentViewId,
          vertices: [point],
          lockedAxis: 'x',
        },
      });
      return;
    }
    // Apply axis-lock projection per spec §6.3 step 3.
    const prev = vertices[vertices.length - 1]!;
    let snapped: { x: number; y: number };
    if (lockedAxis === 'x') {
      // X-locked → snap y to prev.y (motion only in X)
      snapped = { x: point.x, y: prev.y };
    } else if (lockedAxis === 'y') {
      // Y-locked → snap x to prev.x (motion only in Y)
      snapped = { x: prev.x, y: point.y };
    } else {
      snapped = point;  // unreachable in practice
    }
    // Flip axis-lock for the next segment.
    const nextLock: 'x' | 'y' = lockedAxis === 'x' ? 'y' : 'x';
    set({
      steppedSectionState: {
        stage: 'placing',
        parentViewId,
        vertices: [...vertices, snapped],
        lockedAxis: nextLock,
      },
    });
  },

  steppedToggleLockedAxis() {
    const { steppedSectionState } = get();
    if (steppedSectionState.stage !== 'placing') return;
    if (steppedSectionState.vertices.length !== 1) return;
    const flipped: 'x' | 'y' = steppedSectionState.lockedAxis === 'x' ? 'y' : 'x';
    set({
      steppedSectionState: {
        ...steppedSectionState,
        lockedAxis: flipped,
      },
    });
  },

  steppedCommit(onDispatch) {
    const { steppedSectionState } = get();
    if (steppedSectionState.stage !== 'placing') return;
    const { vertices } = steppedSectionState;
    if (vertices.length < 2) {
      console.warn('steppedCommit: need at least 2 vertices (1 jog); have', vertices.length);
      return;
    }
    const segments = vertices.slice(0, -1).map((v, i) => ({
      startSheet: { x: v.x, y: v.y },
      endSheet:   { x: vertices[i + 1]!.x, y: vertices[i + 1]!.y },
    }));
    set({ mode: 'idle', steppedSectionState: { stage: 'idle' } });
    onDispatch(segments);
  },

  steppedCancel() {
    const { steppedSectionState } = get();
    if (steppedSectionState.stage === 'placing' && steppedSectionState.vertices.length > 0) {
      // First Esc with vertices: clear vertices, stay in placing with same parent.
      set({
        steppedSectionState: {
          stage: 'placing',
          parentViewId: steppedSectionState.parentViewId,
          vertices: [],
          // lockedAxis omitted (exactOptionalPropertyTypes); reset.
        },
      });
      return;
    }
    // Vertices empty (or idle/pickParent): exit the tool entirely.
    set({ mode: 'idle', steppedSectionState: { stage: 'idle' } });
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

  sectionPickDrop(point, onDispatch) {
    const { sectionState, sectionMode } = get();
    if (sectionState.stage !== 'pickDrop') {
      console.warn('sectionPickDrop: expected stage=pickDrop, got', sectionState.stage);
      return;
    }
    if (sectionMode === 'half') {
      set({
        sectionState: {
          stage: 'pickCutSide',
          parentViewId: sectionState.parentViewId,
          p0: sectionState.p0,
          p1: sectionState.p1,
          arrowDirection: sectionState.arrowDirection,
          dropAt: point,
          pendingCutSide: 1,
        },
      });
    } else {
      onDispatch();
      set({ sectionState: { stage: 'idle' } });
    }
  },

  sectionPickCutSide(side) {
    const { sectionState } = get();
    if (sectionState.stage !== 'pickCutSide') return;
    set({ sectionState: { ...sectionState, pendingCutSide: side } });
  },

  sectionCommitCutSide(onDispatch) {
    const { sectionState } = get();
    if (sectionState.stage !== 'pickCutSide') return;
    const { pendingCutSide, dropAt } = sectionState;
    set({ mode: 'idle', sectionState: { stage: 'idle' } });
    onDispatch(pendingCutSide, dropAt);
  },

  sectionCancel() {
    const { sectionState, mode } = get();
    if (sectionState.stage === 'pickCutSide') {
      set({ sectionState: { stage: 'idle' } });
      return;
    }
    if (sectionState.stage === 'idle' && mode === 'section') {
      // Second ESC: exit section mode entirely
      set({ mode: 'idle', sectionState: { stage: 'idle' } });
    } else {
      set({ sectionState: { stage: 'idle' } });
    }
  },

  enterBreakMode() {
    set({ mode: 'break', breakState: { stage: 'pickParent' } });
  },

  breakPickParent(viewId) {
    const { breakState } = get();
    if (breakState.stage !== 'pickParent') {
      console.warn('breakPickParent: expected stage=pickParent, got', breakState.stage);
      return;
    }
    set({ breakState: { stage: 'pickAxis', viewId } });
  },

  breakSetAxis(axis) {
    const { breakState } = get();
    if (breakState.stage !== 'pickAxis') {
      console.warn('breakSetAxis: expected stage=pickAxis, got', breakState.stage);
      return;
    }
    set({ breakState: { stage: 'pickP0', viewId: breakState.viewId, axis } });
  },

  breakPickP0(coord) {
    const { breakState } = get();
    if (breakState.stage !== 'pickP0') {
      console.warn('breakPickP0: expected stage=pickP0, got', breakState.stage);
      return;
    }
    set({ breakState: { stage: 'pickP1', viewId: breakState.viewId, axis: breakState.axis, coordA: coord } });
  },

  breakPickP1(coord, onDispatch) {
    const { breakState } = get();
    if (breakState.stage !== 'pickP1') {
      console.warn('breakPickP1: expected stage=pickP1, got', breakState.stage);
      return;
    }
    const coordA = breakState.coordA;
    set({ mode: 'idle', breakState: { stage: 'idle' } });
    onDispatch(coordA, coord);
  },

  breakCancel() {
    const { breakState } = get();
    switch (breakState.stage) {
      case 'idle':
        break;
      case 'pickParent':
        set({ mode: 'idle', breakState: { stage: 'idle' } });
        break;
      case 'pickAxis':
        set({ breakState: { stage: 'pickParent' } });
        break;
      case 'pickP0':
        set({ breakState: { stage: 'pickAxis', viewId: breakState.viewId } });
        break;
      case 'pickP1':
        set({ breakState: { stage: 'pickP0', viewId: breakState.viewId, axis: breakState.axis } });
        break;
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

  detailPickRadius(point) {
    const { detailState } = get();
    if (detailState.stage !== 'pickRegionRadius') {
      console.warn('detailPickRadius: expected stage=pickRegionRadius, got', detailState.stage);
      return;
    }
    const dx = point.x - detailState.center.x;
    const dy = point.y - detailState.center.y;
    const radiusMm = Math.sqrt(dx * dx + dy * dy);
    set({
      detailState: {
        stage: 'pickDrop',
        parentViewId: detailState.parentViewId,
        center: detailState.center,
        radiusMm,
      },
    });
  },

  detailPickDrop(_point, onDispatch) {
    const { detailState } = get();
    if (detailState.stage !== 'pickDrop') {
      console.warn('detailPickDrop: expected stage=pickDrop, got', detailState.stage);
      return;
    }
    onDispatch();
    set({ mode: 'idle', detailState: { stage: 'idle' } });
  },

  detailCancel() {
    const { detailState, mode } = get();
    if (detailState.stage === 'idle' && mode === 'detail') {
      // Second ESC: exit detail mode entirely
      set({ mode: 'idle', detailState: { stage: 'idle' } });
    } else {
      // First ESC at any non-idle stage: back to idle, stay in detail mode
      set({ detailState: { stage: 'idle' } });
    }
  },
}));
