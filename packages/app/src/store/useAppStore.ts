import { create } from 'zustand';
import type { AssemblyDocument, BooleanOperation, ChamferEdgeSpec, DimensionConstraint, EdgeName, FaceName, FilletEdgeSpec, HoleFeature, KernelError, PartDocument, SketchConstraint, SketchParameter, SketchPrimitive, SweepFeature } from '@zilventor/shared';
import type { DofStatus, PrimitiveCoordsDiff } from '@zilventor/sketcher-worker';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { ViewportRef } from '../viewport/Viewport';
import { createCommandBus, type CommandBus } from '../commands/CommandBus';

export type ToolKind =
  | 'select'
  | 'line' | 'rect' | 'circle' | 'arc' | 'spline'
  | 'constrain-coincident' | 'constrain-horizontal' | 'constrain-vertical'
  | 'constrain-parallel' | 'constrain-perpendicular' | 'constrain-tangent'
  | 'constrain-equal' | 'constrain-symmetric'
  | 'dimension';

export type ActiveDocument =
  | { kind: 'part'; document: PartDocument }
  | { kind: 'assembly'; document: AssemblyDocument };

type AppState = {
  kernel: KernelClient | null;
  bus: CommandBus;
  activeDocument: ActiveDocument | null;
  activePart: PartDocument | null;
  activeAssembly: AssemblyDocument | null;
  kernelReady: boolean;
  statusMessage: string;
  selectedFeatureId: string | null;
  viewport: ViewportRef | null;
  sketchMode: boolean;
  activeSketchId: string | null;
  activeToolKind: ToolKind | null;
  selectedPrimitiveId: string | null;
  sketchDof: DofStatus | null;
  parametersPanelOpen: boolean;
  revolveDialogOpen: boolean;
  filletDialogOpen: boolean;
  filletEdges: FilletEdgeSpec[];
  editingFilletId: string | null;
  filletInitialRadius: string | undefined;
  chamferDialogOpen: boolean;
  chamferEdges: ChamferEdgeSpec[];
  editingChamferId: string | null;
  chamferInitialDistance: string | undefined;
  shellDialogOpen: boolean;
  shellFacesToRemove: FaceName[];
  editingShellId: string | null;
  shellInitialThickness: string | undefined;
  linearPatternDialogOpen: boolean;
  mirrorDialogOpen: boolean;
  holeDialogOpen: boolean;
  holePlacementMode: 'fromSketch' | 'linear' | 'concentric';
  holeSketchId: string | null;
  holePlacementFace: FaceName | null;
  holeRefEdges: [EdgeName | null, EdgeName | null];
  holeCircularEdge: EdgeName | null;
  holeTargetFace: FaceName | null;
  editingHoleId: string | null;
  holeInitialValues: HoleFeature | null;
  openHoleForEdit: (id: string) => void;
  resetHoleDialog: () => void;
  toggleHoleDialog: (open: boolean) => void;
  sweepDialogOpen: boolean;
  sweepProfileSketchId: string | null;
  sweepPathSketchId: string | null;
  sweepOrientationKind: 'path' | 'parallel' | 'guideRail';
  sweepGuideRailSketchId: string | null;
  sweepOperation: BooleanOperation;
  editingSweepId: string | null;
  sweepInitialValues: SweepFeature | null;
  openSweepForEdit: (id: string) => void;
  resetSweepDialog: () => void;
  toggleSweepDialog: (open: boolean) => void;

  setKernel(k: KernelClient): void;
  setActiveDocument(d: ActiveDocument | null): void;
  setActivePart(p: PartDocument | null): void;
  setStatus(msg: string): void;
  setSelectedFeature(id: string | null): void;
  setViewport(v: ViewportRef | null): void;
  setSketchMode(mode: boolean, sketchId?: string | null): void;
  setActiveToolKind(kind: ToolKind | null): void;
  setSelectedPrimitive(id: string | null): void;
  setSketchDof(v: DofStatus | null): void;
  setParametersPanelOpen(v: boolean): void;
  setRevolveDialogOpen(v: boolean): void;
  setFilletDialogOpen(v: boolean): void;
  setFilletEdges(edges: FilletEdgeSpec[]): void;
  setEditingFilletId(id: string | null): void;
  setFilletInitialRadius(radius: string | undefined): void;
  openFilletForEdit(featureId: string): void;
  setChamferDialogOpen(v: boolean): void;
  setChamferEdges(edges: ChamferEdgeSpec[]): void;
  setEditingChamferId(id: string | null): void;
  setChamferInitialDistance(distance: string | undefined): void;
  openChamferForEdit(featureId: string): void;
  setShellDialogOpen(v: boolean): void;
  setShellFacesToRemove(faces: FaceName[]): void;
  toggleShellFace(face: FaceName): void;
  setEditingShellId(id: string | null): void;
  setShellInitialThickness(thickness: string | undefined): void;
  openShellForEdit(featureId: string): void;
  setLinearPatternDialogOpen(v: boolean): void;
  setMirrorDialogOpen(v: boolean): void;
  addPrimitiveToActiveSketch(sketchId: string, p: SketchPrimitive): void;
  removePrimitiveFromActiveSketch(sketchId: string, primitiveId: string): void;
  applyCoordDiff(sketchId: string, diff: PrimitiveCoordsDiff[]): void;
  addConstraintToActiveSketch(sketchId: string, c: SketchConstraint): void;
  removeConstraintFromActiveSketch(sketchId: string, constraintId: string): void;
  addDimensionToActiveSketch(sketchId: string, d: DimensionConstraint): void;
  removeDimensionFromActiveSketch(sketchId: string, dimensionId: string): void;
  updateDimensionValueInStore(sketchId: string, dimensionId: string, value: number): void;
  setParameterInStore(param: SketchParameter): void;
  highlightedConstraintIds: string[];
  setHighlightedConstraintIds(ids: string[]): void;
  featureErrors: Map<string, KernelError>;
  setFeatureErrors(m: Map<string, KernelError>): void;
};

export const useAppStore = create<AppState>((set) => ({
  kernel: null,
  bus: createCommandBus(),
  activeDocument: null,
  activePart: null,
  activeAssembly: null,
  kernelReady: false,
  statusMessage: 'Loading…',
  selectedFeatureId: null,
  viewport: null,
  sketchMode: false,
  activeSketchId: null,
  activeToolKind: null,
  selectedPrimitiveId: null,
  parametersPanelOpen: false,
  revolveDialogOpen: false,
  filletDialogOpen: false,
  setKernel: (k) => set({ kernel: k, kernelReady: true, statusMessage: 'Ready' }),
  setActiveDocument: (d) => set({
    activeDocument: d,
    activePart: d?.kind === 'part' ? d.document : null,
    activeAssembly: d?.kind === 'assembly' ? d.document : null,
  }),
  setActivePart: (p) => set({
    activeDocument: p ? { kind: 'part', document: p } : null,
    activePart: p,
    activeAssembly: null,
  }),
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
  setParametersPanelOpen: (v) => set({ parametersPanelOpen: v }),
  setRevolveDialogOpen: (v) => set({ revolveDialogOpen: v }),
  setFilletDialogOpen: (v) => set({ filletDialogOpen: v }),
  filletEdges: [],
  setFilletEdges: (edges) => set({ filletEdges: edges }),
  editingFilletId: null,
  setEditingFilletId: (id) => set({ editingFilletId: id }),
  filletInitialRadius: undefined,
  setFilletInitialRadius: (radius) => set({ filletInitialRadius: radius }),
  openFilletForEdit: (featureId) => {
    const state = useAppStore.getState();
    const part = state.activePart;
    if (!part) return;
    const feature = part.featureTree.find(
      (f): f is Extract<typeof f, { kind: 'fillet' }> => f.kind === 'fillet' && f.id === featureId
    );
    if (!feature) return;
    const firstEdge = feature.edges[0];
    const radiusSpec = firstEdge?.radius;
    let initialRadius: string | undefined;
    if (radiusSpec) {
      if (radiusSpec.kind === 'literal') {
        initialRadius = String(radiusSpec.value);
      } else {
        const param = part.parameters[radiusSpec.paramName];
        initialRadius = param?.expression ?? radiusSpec.paramName;
      }
    }
    set({
      editingFilletId: feature.id,
      filletEdges: feature.edges.map((e) => ({ ...e })),
      filletInitialRadius: initialRadius,
      filletDialogOpen: true,
    });
  },
  chamferDialogOpen: false,
  setChamferDialogOpen: (v) => set({ chamferDialogOpen: v }),
  chamferEdges: [],
  setChamferEdges: (edges) => set({ chamferEdges: edges }),
  editingChamferId: null,
  setEditingChamferId: (id) => set({ editingChamferId: id }),
  chamferInitialDistance: undefined,
  setChamferInitialDistance: (distance) => set({ chamferInitialDistance: distance }),
  openChamferForEdit: (featureId) => {
    const state = useAppStore.getState();
    const part = state.activePart;
    if (!part) return;
    const feature = part.featureTree.find(
      (f): f is Extract<typeof f, { kind: 'chamfer' }> => f.kind === 'chamfer' && f.id === featureId
    );
    if (!feature) return;
    const firstEdge = feature.edges[0];
    const distanceSpec = firstEdge?.distance;
    let initialDistance: string | undefined;
    if (distanceSpec) {
      if (distanceSpec.kind === 'literal') {
        initialDistance = String(distanceSpec.value);
      } else {
        const param = part.parameters[distanceSpec.paramName];
        initialDistance = param?.expression ?? distanceSpec.paramName;
      }
    }
    set({
      editingChamferId: feature.id,
      chamferEdges: feature.edges.map((e) => ({ ...e })),
      chamferInitialDistance: initialDistance,
      chamferDialogOpen: true,
    });
  },
  shellDialogOpen: false,
  setShellDialogOpen: (v) => set({ shellDialogOpen: v }),
  shellFacesToRemove: [],
  setShellFacesToRemove: (faces) => set({ shellFacesToRemove: faces }),
  toggleShellFace: (face) => set((state) => {
    const key = `${face.featureId}|${face.role}|${face.instance ?? 0}`;
    const current = state.shellFacesToRemove;
    const without = current.filter(
      (f) => `${f.featureId}|${f.role}|${f.instance ?? 0}` !== key
    );
    return {
      shellFacesToRemove: without.length === current.length ? [...current, face] : without
    };
  }),
  editingShellId: null,
  setEditingShellId: (id) => set({ editingShellId: id }),
  shellInitialThickness: undefined,
  setShellInitialThickness: (thickness) => set({ shellInitialThickness: thickness }),
  openShellForEdit: (featureId) => {
    const state = useAppStore.getState();
    const part = state.activePart;
    if (!part) return;
    const feature = part.featureTree.find(
      (f): f is Extract<typeof f, { kind: 'shell' }> => f.kind === 'shell' && f.id === featureId
    );
    if (!feature) return;
    let initialThickness: string | undefined;
    if (feature.thickness.kind === 'literal') {
      initialThickness = String(feature.thickness.value);
    } else {
      const param = part.parameters[feature.thickness.paramName];
      initialThickness = param?.expression ?? feature.thickness.paramName;
    }
    set({
      editingShellId: feature.id,
      shellFacesToRemove: feature.facesToRemove.map((f) => ({ ...f })),
      shellInitialThickness: initialThickness,
      shellDialogOpen: true,
    });
  },
  linearPatternDialogOpen: false,
  setLinearPatternDialogOpen: (v) => set({ linearPatternDialogOpen: v }),
  mirrorDialogOpen: false,
  setMirrorDialogOpen: (v) => set({ mirrorDialogOpen: v }),
  holeDialogOpen: false,
  holePlacementMode: 'fromSketch',
  holeSketchId: null,
  holePlacementFace: null,
  holeRefEdges: [null, null],
  holeCircularEdge: null,
  holeTargetFace: null,
  editingHoleId: null,
  holeInitialValues: null,
  openHoleForEdit: (id) => set((s) => {
    const feature = s.activePart?.featureTree?.find((f: any) => f.id === id) as HoleFeature | undefined;
    if (!feature || feature.kind !== 'hole') {
      return { ...s, holeDialogOpen: true, editingHoleId: id };
    }
    const placement = feature.placement;
    return {
      ...s,
      holeDialogOpen: true,
      editingHoleId: id,
      holeInitialValues: feature,
      holePlacementMode: placement.kind,
      holeSketchId: placement.kind === 'fromSketch' ? placement.sketchId : null,
      holePlacementFace:
        placement.kind === 'linear' ? placement.faceName :
        placement.kind === 'concentric' ? placement.faceName :
        null,
      holeRefEdges: placement.kind === 'linear'
        ? [placement.refEdge1, placement.refEdge2]
        : [null, null],
      holeCircularEdge: placement.kind === 'concentric' ? placement.circularEdgeName : null,
      holeTargetFace: feature.termination.kind === 'toFace' ? feature.termination.targetFaceName : null,
    };
  }),
  resetHoleDialog: () => set({
    holeDialogOpen: false,
    holePlacementMode: 'fromSketch',
    holeSketchId: null,
    holePlacementFace: null,
    holeRefEdges: [null, null],
    holeCircularEdge: null,
    holeTargetFace: null,
    editingHoleId: null,
    holeInitialValues: null,
  }),
  toggleHoleDialog: (open) => set({ holeDialogOpen: open }),
  sweepDialogOpen: false,
  sweepProfileSketchId: null,
  sweepPathSketchId: null,
  sweepOrientationKind: 'path',
  sweepGuideRailSketchId: null,
  sweepOperation: 'new',
  editingSweepId: null,
  sweepInitialValues: null,
  openSweepForEdit: (id) => set((s) => {
    const feature = s.activePart?.featureTree?.find((f: any) => f.id === id) as SweepFeature | undefined;
    if (!feature || feature.kind !== 'sweep') {
      return { ...s, sweepDialogOpen: true, editingSweepId: id };
    }
    return {
      ...s,
      sweepDialogOpen: true,
      editingSweepId: id,
      sweepInitialValues: feature,
      sweepProfileSketchId: feature.profileSketchId,
      sweepPathSketchId: feature.pathSketchId,
      sweepOrientationKind: feature.orientation.kind,
      sweepGuideRailSketchId: feature.orientation.kind === 'guideRail' ? feature.orientation.guideRailSketchId : null,
      sweepOperation: feature.operation,
    };
  }),
  resetSweepDialog: () => set((s) => ({
    ...s,
    sweepDialogOpen: false,
    sweepProfileSketchId: null,
    sweepPathSketchId: null,
    sweepOrientationKind: 'path',
    sweepGuideRailSketchId: null,
    sweepOperation: 'new',
    editingSweepId: null,
    sweepInitialValues: null,
  })),
  toggleSweepDialog: (open) => set((s) => ({ ...s, sweepDialogOpen: open })),

  highlightedConstraintIds: [],
  setHighlightedConstraintIds: (ids) => set({ highlightedConstraintIds: ids }),
  featureErrors: new Map(),
  setFeatureErrors: (m) => set({ featureErrors: m }),
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
  }),
  addDimensionToActiveSketch: (sketchId, d) => set((state) => {
    const part = state.activePart;
    if (!part) return state;
    const tree = part.featureTree.map((f) =>
      f.kind === 'sketch' && f.id === sketchId
        ? { ...f, constraints: [...f.constraints, d as SketchConstraint] }
        : f
    );
    return { activePart: { ...part, featureTree: tree } };
  }),
  removeDimensionFromActiveSketch: (sketchId, id) => set((state) => {
    const part = state.activePart;
    if (!part) return state;
    const tree = part.featureTree.map((f) =>
      f.kind === 'sketch' && f.id === sketchId
        ? { ...f, constraints: f.constraints.filter((c) => c.id !== id) }
        : f
    );
    return { activePart: { ...part, featureTree: tree } };
  }),
  updateDimensionValueInStore: (sketchId, id, value) => set((state) => {
    const part = state.activePart;
    if (!part) return state;
    const tree = part.featureTree.map((f) => {
      if (f.kind !== 'sketch' || f.id !== sketchId) return f;
      return {
        ...f,
        constraints: f.constraints.map((c) =>
          c.id === id && c.kind.startsWith('dim-')
            ? ({ ...c, value: { kind: 'literal', value } } as SketchConstraint)
            : c
        )
      };
    });
    return { activePart: { ...part, featureTree: tree } };
  }),
  setParameterInStore: (param) => set((state) => {
    const part = state.activePart;
    if (!part) return state;
    return {
      activePart: {
        ...part,
        parameters: { ...part.parameters, [param.name]: param }
      }
    };
  })
}));
