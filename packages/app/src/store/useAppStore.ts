import { create } from 'zustand';
import type { AssemblyDocument, BooleanOperation, ChamferEdgeSpec, ComponentColor, ComponentInstance, DimensionConstraint, EdgeName, FaceName, FilletEdgeSpec, HoleFeature, KernelError, MaterialEntry, PartDocument, SketchConstraint, SketchParameter, SketchPrimitive, SweepFeature, WorkAxisFeature, WorkPlaneFeature, WorkPointFeature } from '@zilventor/shared';
import type { ComponentPath } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import type { DofStatus, PrimitiveCoordsDiff } from '@zilventor/sketcher-worker';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { ViewportRef } from '../viewport/Viewport';
import { createCommandBus, type CommandBus } from '../commands/CommandBus';

function omitColor(c: ComponentInstance): ComponentInstance {
  const { color: _color, ...rest } = c;
  return rest;
}

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

/**
 * Coordination types for work-feature picker routing.
 * Dialog calls `requestWorkFeaturePick` to arm a pick; App.tsx watches
 * `pendingWorkFeaturePick`, activates the matching picker, and routes the
 * viewport hit back to `setWorkFeaturePickResult`. The dialog reads from
 * `workFeaturePickResult` and updates its bound input slot.
 */
export type WorkFeaturePickKind = 'plane' | 'axis' | 'point';
export type WorkFeaturePickRequest = {
  kind: WorkFeaturePickKind;
  /** Identifies which slot in the dialog the result should populate (e.g. 'planeA', 'axisRef', 'pointA'). */
  role: string;
  /** Picker-specific mode token (e.g. 'workPlane', 'face', 'edge', 'workAxis', 'vertex', 'workPoint', 'cylindricalFace'). */
  mode: string;
};
export type WorkFeaturePickHitPlane =
  | { kind: 'face'; face: import('@zilventor/shared').FaceName }
  | { kind: 'workPlane'; featureId: string };
export type WorkFeaturePickHitAxis =
  | { kind: 'cylindricalFace'; face: import('@zilventor/shared').FaceName }
  | { kind: 'edge'; edge: import('@zilventor/shared').EdgeName }
  | { kind: 'workAxis'; featureId: string };
export type WorkFeaturePickHitPoint =
  | { kind: 'vertex'; edge: import('@zilventor/shared').EdgeName; end: 'start' | 'end' }
  | { kind: 'workPoint'; featureId: string };
export type WorkFeaturePickResultPayload =
  | { kind: 'plane'; role: string; hit: WorkFeaturePickHitPlane }
  | { kind: 'axis'; role: string; hit: WorkFeaturePickHitAxis }
  | { kind: 'point'; role: string; hit: WorkFeaturePickHitPoint };

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
  importFromInventorDialogOpen: boolean;
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
  workAxisDialogOpen: boolean;
  workAxisInitialValues: WorkAxisFeature | null;
  editingWorkAxisId: string | null;
  toggleWorkAxisDialog: (open: boolean) => void;
  resetWorkAxisDialog: () => void;
  openWorkAxisForEdit: (id: string) => void;
  workPlaneDialogOpen: boolean;
  workPlaneInitialValues: WorkPlaneFeature | null;
  editingWorkPlaneId: string | null;
  toggleWorkPlaneDialog: (open: boolean) => void;
  resetWorkPlaneDialog: () => void;
  openWorkPlaneForEdit: (id: string) => void;
  workPointDialogOpen: boolean;
  workPointInitialValues: WorkPointFeature | null;
  editingWorkPointId: string | null;
  toggleWorkPointDialog: (open: boolean) => void;
  resetWorkPointDialog: () => void;
  openWorkPointForEdit: (id: string) => void;
  setWorkFeatureVisible: (featureId: string, visible: boolean) => void;
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
  setImportFromInventorDialogOpen(v: boolean): void;

  placeComponentDialogOpen: boolean;
  editComponentDialogOpen: boolean;
  editingComponentId: string | null;
  editComponentInitialValues: ComponentInstance | null;
  selectedComponentPaths: ComponentPath[];
  componentDiagnostics: Array<{ componentId: string; message: string }>;
  bomTabActive: boolean;
  showComponentColors: boolean;
  showEdgeBands: boolean;
  // 4d additions (T18)
  subAssemblyDocs: Record<string, AssemblyDocument>;
  subAssemblyInnerPoses: Record<string, Map<string, { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] }>>;
  subAssemblyDiagnostics: Array<{ partPath: string; kind: 'cycle' | 'missing' | 'parse'; message: string }>;
  expandedSubAsmPaths: Set<string>;
  setSubAssemblyDocs: (next: Record<string, AssemblyDocument>) => void;
  setSubAssemblyInnerPoses: (next: Record<string, Map<string, { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] }>>) => void;
  setSubAssemblyDiagnostics: (next: Array<{ partPath: string; kind: 'cycle' | 'missing' | 'parse'; message: string }>) => void;
  toggleSubAsmExpanded: (key: string) => void;
  selectComponentPaths: (paths: ComponentPath[]) => void;
  setBomTabActive: (v: boolean) => void;
  setShowComponentColors: (v: boolean) => void;
  setShowEdgeBands: (v: boolean) => void;
  setColorOverride: (path: ComponentPath, color: ComponentColor | null) => void;
  setComponentFlexible: (componentId: string, flag: boolean) => void;

  openPlaceComponentDialog(): void;
  resetPlaceComponentDialog(): void;
  openEditComponentDialog(id: string): void;
  resetEditComponentDialog(): void;
  addComponent(instance: ComponentInstance): void;
  updateComponent(id: string, patch: Partial<ComponentInstance>): void;
  removeComponent(id: string): void;
  selectComponent(id: string | null): void;
  selectComponents(ids: string[]): void;
  setComponentColor(componentId: string, color: import('@zilventor/shared').ComponentColor | undefined): void;
  setAssemblyPaletteColor(name: string, hex: string): void;
  removeAssemblyPaletteColor(name: string): void;
  setBomItemNumber(rowKey: string, n: number): void;
  setBomItemNumbers(map: Record<string, number>): void;
  setComponentDiagnostics(diags: Array<{ componentId: string; message: string }>): void;
  addMaterial(entry: MaterialEntry): void;
  updateMaterial(id: string, patch: Partial<Omit<MaterialEntry, 'id'>>): void;
  removeMaterial(id: string): void;

  // 4b additions
  placeConstraintDialogOpen: boolean;
  placeConstraintMode: 'mate' | 'flush' | 'angle' | 'insert';
  editConstraintDialogOpen: boolean;
  editingConstraintId: string | null;
  editConstraintInitialValues: import('@zilventor/shared').AssemblyConstraint | null;
  selectedConstraintId: string | null;
  solverDirty: boolean;
  componentPoses: Map<string, { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] }>;
  solverDiagnostics: {
    dofCount: number;
    status: 'fully-constrained' | 'underconstrained' | 'over-constrained' | 'did-not-converge';
    perConstraint: Map<string, { residual: number; conflict: boolean; brokenRef: boolean }>;
    message?: string;
  };
  freeDofBasis: Float64Array | null;
  openPlaceConstraintDialog: (mode: 'mate' | 'flush' | 'angle' | 'insert') => void;
  resetPlaceConstraintDialog: () => void;
  openEditConstraintDialog: (id: string) => void;
  resetEditConstraintDialog: () => void;
  addAssemblyConstraint: (c: import('@zilventor/shared').AssemblyConstraint) => void;
  updateAssemblyConstraint: (id: string, patch: Partial<import('@zilventor/shared').AssemblyConstraint>) => void;
  removeAssemblyConstraint: (id: string) => void;
  toggleConstraintSuppression: (id: string) => void;
  toggleGrounded: (componentId: string) => void;
  selectConstraint: (id: string | null) => void;
  setSolverDirty: (v: boolean) => void;
  setSolverResult: (
    poses: Map<string, { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] }>,
    diagnostics: AppState['solverDiagnostics'],
    freeDofBasis: Float64Array | null,
  ) => void;

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
  pendingWorkFeaturePick: WorkFeaturePickRequest | null;
  workFeaturePickResult: WorkFeaturePickResultPayload | null;
  requestWorkFeaturePick: (req: WorkFeaturePickRequest) => void;
  setWorkFeaturePickResult: (result: WorkFeaturePickResultPayload) => void;
  clearWorkFeaturePick: () => void;
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
  importFromInventorDialogOpen: false,
  setImportFromInventorDialogOpen: (v) => set({ importFromInventorDialogOpen: v }),

  placeComponentDialogOpen: false,
  editComponentDialogOpen: false,
  editingComponentId: null,
  editComponentInitialValues: null,
  selectedComponentPaths: [],
  componentDiagnostics: [],
  bomTabActive: false,
  showComponentColors: false,
  showEdgeBands: typeof localStorage !== 'undefined' ? localStorage.getItem('showEdgeBands') !== 'false' : true,
  // 4d additions (T18)
  subAssemblyDocs: {},
  subAssemblyInnerPoses: {},
  subAssemblyDiagnostics: [],
  expandedSubAsmPaths: new Set<string>(),
  setSubAssemblyDocs: (next) => set({ subAssemblyDocs: next }),
  setSubAssemblyInnerPoses: (next) => set({ subAssemblyInnerPoses: next }),
  setSubAssemblyDiagnostics: (next) => set({ subAssemblyDiagnostics: next }),
  toggleSubAsmExpanded: (key) => set((s) => {
    const next = new Set(s.expandedSubAsmPaths);
    if (next.has(key)) next.delete(key); else next.add(key);
    return { expandedSubAsmPaths: next };
  }),
  selectComponentPaths: (paths) => set({ selectedComponentPaths: [...paths] }),
  setBomTabActive: (v) => set({ bomTabActive: v }),
  setShowComponentColors: (v) => set({ showComponentColors: v }),
  setShowEdgeBands: (v) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('showEdgeBands', String(v));
    set({ showEdgeBands: v });
  },
  setColorOverride: (path, color) => set((s) => {
    if (s.activeDocument?.kind !== 'assembly') return s;
    const next = { ...s.activeDocument.document.colorOverrides };
    const k = pathKey(path);
    if (color == null) delete next[k];
    else next[k] = color;
    const nextDoc: AssemblyDocument = { ...s.activeDocument.document, colorOverrides: next };
    return {
      activeDocument: { kind: 'assembly', document: nextDoc },
      activeAssembly: nextDoc,
    };
  }),
  setComponentFlexible: (componentId, flag) => set((s) => {
    if (s.activeDocument?.kind !== 'assembly') return s;
    const components = s.activeDocument.document.components.map((c) =>
      c.id === componentId ? { ...c, flexible: flag } : c,
    );
    const nextDoc: AssemblyDocument = { ...s.activeDocument.document, components };
    return {
      activeDocument: { kind: 'assembly', document: nextDoc },
      activeAssembly: nextDoc,
      solverDirty: true,
    };
  }),

  openPlaceComponentDialog: () => set({
    placeComponentDialogOpen: true,
    selectedComponentPaths: [],
  }),
  resetPlaceComponentDialog: () => set({ placeComponentDialogOpen: false }),

  openEditComponentDialog: (id) => set((s) => {
    const c = s.activeAssembly?.components.find((x) => x.id === id);
    return {
      editComponentDialogOpen: true,
      editingComponentId: id,
      editComponentInitialValues: c ?? null,
    };
  }),
  resetEditComponentDialog: () => set({
    editComponentDialogOpen: false,
    editingComponentId: null,
    editComponentInitialValues: null,
  }),

  addComponent: (instance) => set((s) => {
    if (!s.activeAssembly) return s;
    const next: AssemblyDocument = {
      ...s.activeAssembly,
      components: [...s.activeAssembly.components, instance],
      groundedComponentPaths: s.activeAssembly.groundedComponentPaths.length === 0
        ? [[instance.id]] : s.activeAssembly.groundedComponentPaths,
    };
    return {
      activeDocument: { kind: 'assembly', document: next },
      activeAssembly: next,
      solverDirty: true,
    };
  }),

  updateComponent: (id, patch) => set((s) => {
    if (!s.activeAssembly) return s;
    const next: AssemblyDocument = {
      ...s.activeAssembly,
      components: s.activeAssembly.components.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    };
    return {
      activeDocument: { kind: 'assembly', document: next },
      activeAssembly: next,
    };
  }),

  removeComponent: (id) => set((s) => {
    if (!s.activeAssembly) return s;
    const next: AssemblyDocument = {
      ...s.activeAssembly,
      components: s.activeAssembly.components.filter((c) => c.id !== id),
    };
    return {
      activeDocument: { kind: 'assembly', document: next },
      activeAssembly: next,
    };
  }),

  addMaterial: (entry) => set((s) => {
    if (s.activeAssembly) {
      const next: AssemblyDocument = {
        ...s.activeAssembly,
        materials: [...s.activeAssembly.materials, entry],
      };
      return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next };
    }
    if (s.activePart) {
      const next: PartDocument = {
        ...s.activePart,
        materials: [...s.activePart.materials, entry],
      };
      return { activeDocument: { kind: 'part', document: next }, activePart: next };
    }
    return s;
  }),

  updateMaterial: (id, patch) => set((s) => {
    if (s.activeAssembly) {
      const next: AssemblyDocument = {
        ...s.activeAssembly,
        materials: s.activeAssembly.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      };
      return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next };
    }
    if (s.activePart) {
      const next: PartDocument = {
        ...s.activePart,
        materials: s.activePart.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      };
      return { activeDocument: { kind: 'part', document: next }, activePart: next };
    }
    return s;
  }),

  removeMaterial: (id) => set((s) => {
    if (s.activeAssembly) {
      const next: AssemblyDocument = {
        ...s.activeAssembly,
        materials: s.activeAssembly.materials.filter((m) => m.id !== id),
      };
      return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next };
    }
    if (s.activePart) {
      const next: PartDocument = {
        ...s.activePart,
        materials: s.activePart.materials.filter((m) => m.id !== id),
      };
      return { activeDocument: { kind: 'part', document: next }, activePart: next };
    }
    return s;
  }),

  selectComponents: (ids) => set({ selectedComponentPaths: ids.map((id) => [id]) }),
  selectComponent: (id) => set({ selectedComponentPaths: id == null ? [] : [[id]] }),
  setComponentColor: (componentId, color) => set((s) => {
    if (!s.activeAssembly) return s;
    const next: AssemblyDocument = {
      ...s.activeAssembly,
      components: s.activeAssembly.components.map((c) =>
        c.id === componentId ? (color === undefined ? omitColor(c) : { ...c, color }) : c
      ),
    };
    return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next };
  }),
  setAssemblyPaletteColor: (name, hex) => set((s) => {
    if (!s.activeAssembly) return s;
    const next: AssemblyDocument = {
      ...s.activeAssembly,
      colors: { ...s.activeAssembly.colors, [name]: hex },
    };
    return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next };
  }),
  removeAssemblyPaletteColor: (name) => set((s) => {
    if (!s.activeAssembly) return s;
    const { [name]: _removed, ...rest } = s.activeAssembly.colors;
    const next: AssemblyDocument = { ...s.activeAssembly, colors: rest };
    return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next };
  }),
  setBomItemNumber: (rowKey, n) => set((s) => {
    if (!s.activeAssembly) return s;
    const map = { ...s.activeAssembly.bomItemNumbers };
    const collidingKey = Object.entries(map).find(([k, v]) => v === n && k !== rowKey)?.[0];
    if (collidingKey) {
      const max = Math.max(0, ...Object.values(map));
      map[collidingKey] = max + 1;
    }
    map[rowKey] = n;
    const next: AssemblyDocument = { ...s.activeAssembly, bomItemNumbers: map };
    return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next };
  }),
  setBomItemNumbers: (map) => set((s) => {
    if (!s.activeAssembly) return s;
    const next: AssemblyDocument = { ...s.activeAssembly, bomItemNumbers: { ...map } };
    return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next };
  }),
  setComponentDiagnostics: (diags) => set({ componentDiagnostics: diags }),

  // 4b additions
  placeConstraintDialogOpen: false,
  placeConstraintMode: 'mate',
  editConstraintDialogOpen: false,
  editingConstraintId: null,
  editConstraintInitialValues: null,
  selectedConstraintId: null,
  solverDirty: false,
  componentPoses: new Map(),
  solverDiagnostics: { dofCount: 0, status: 'fully-constrained', perConstraint: new Map() },
  freeDofBasis: null,

  openPlaceConstraintDialog: (mode) => set({ placeConstraintDialogOpen: true, placeConstraintMode: mode }),
  resetPlaceConstraintDialog: () => set({ placeConstraintDialogOpen: false }),
  openEditConstraintDialog: (id) => set((s) => {
    const c = s.activeAssembly?.constraints.find((x) => x.id === id) ?? null;
    return { editConstraintDialogOpen: true, editingConstraintId: id, editConstraintInitialValues: c };
  }),
  resetEditConstraintDialog: () => set({ editConstraintDialogOpen: false, editingConstraintId: null, editConstraintInitialValues: null }),

  addAssemblyConstraint: (c) => set((s) => {
    if (!s.activeAssembly) return s;
    const next = { ...s.activeAssembly, constraints: [...s.activeAssembly.constraints, c] };
    return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next, solverDirty: true };
  }),
  updateAssemblyConstraint: (id, patch) => set((s) => {
    if (!s.activeAssembly) return s;
    const next = { ...s.activeAssembly, constraints: s.activeAssembly.constraints.map((c) => c.id === id ? ({ ...c, ...patch } as any) : c) };
    return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next, solverDirty: true };
  }),
  removeAssemblyConstraint: (id) => set((s) => {
    if (!s.activeAssembly) return s;
    const next = { ...s.activeAssembly, constraints: s.activeAssembly.constraints.filter((c) => c.id !== id) };
    return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next, solverDirty: true };
  }),
  toggleConstraintSuppression: (id) => set((s) => {
    if (!s.activeAssembly) return s;
    const next = { ...s.activeAssembly, constraints: s.activeAssembly.constraints.map((c) => c.id === id ? { ...c, suppressed: !c.suppressed } : c) };
    return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next, solverDirty: true };
  }),
  toggleGrounded: (componentId) => set((s) => {
    if (!s.activeAssembly) return s;
    const target = [componentId];
    const targetKey = pathKey(target);
    const paths = s.activeAssembly.groundedComponentPaths;
    const has = paths.some((p) => pathKey(p) === targetKey);
    const nextPaths = has ? paths.filter((p) => pathKey(p) !== targetKey) : [...paths, target];
    const next = { ...s.activeAssembly, groundedComponentPaths: nextPaths };
    return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next, solverDirty: true };
  }),
  selectConstraint: (id) => set({ selectedConstraintId: id }),
  setSolverDirty: (v) => set({ solverDirty: v }),
  setSolverResult: (poses, diagnostics, freeDofBasis) => set({ componentPoses: poses, solverDiagnostics: diagnostics, freeDofBasis, solverDirty: false }),

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
  workAxisDialogOpen: false,
  workAxisInitialValues: null,
  editingWorkAxisId: null,
  toggleWorkAxisDialog: (open) => set({ workAxisDialogOpen: open }),
  resetWorkAxisDialog: () => set({ workAxisDialogOpen: false, workAxisInitialValues: null, editingWorkAxisId: null }),
  openWorkAxisForEdit: (id) => set((s) => {
    const f = s.activePart?.featureTree?.find((x: any) => x.id === id) as WorkAxisFeature | undefined;
    if (!f || f.kind !== 'workAxis') return { ...s, workAxisDialogOpen: true, editingWorkAxisId: id };
    return { ...s, workAxisDialogOpen: true, editingWorkAxisId: id, workAxisInitialValues: f };
  }),
  workPlaneDialogOpen: false,
  workPlaneInitialValues: null,
  editingWorkPlaneId: null,
  toggleWorkPlaneDialog: (open) => set({ workPlaneDialogOpen: open }),
  resetWorkPlaneDialog: () => set({ workPlaneDialogOpen: false, workPlaneInitialValues: null, editingWorkPlaneId: null }),
  openWorkPlaneForEdit: (id) => set((s) => {
    const f = s.activePart?.featureTree?.find((x: any) => x.id === id) as WorkPlaneFeature | undefined;
    if (!f || f.kind !== 'workPlane') return { ...s, workPlaneDialogOpen: true, editingWorkPlaneId: id };
    return { ...s, workPlaneDialogOpen: true, editingWorkPlaneId: id, workPlaneInitialValues: f };
  }),
  workPointDialogOpen: false,
  workPointInitialValues: null,
  editingWorkPointId: null,
  toggleWorkPointDialog: (open) => set({ workPointDialogOpen: open }),
  resetWorkPointDialog: () => set({ workPointDialogOpen: false, workPointInitialValues: null, editingWorkPointId: null }),
  openWorkPointForEdit: (id) => set((s) => {
    const f = s.activePart?.featureTree?.find((x: any) => x.id === id) as WorkPointFeature | undefined;
    if (!f || f.kind !== 'workPoint') return { ...s, workPointDialogOpen: true, editingWorkPointId: id };
    return { ...s, workPointDialogOpen: true, editingWorkPointId: id, workPointInitialValues: f };
  }),
  setWorkFeatureVisible: (featureId, visible) => set((s) => {
    const part = s.activePart;
    if (!part) return s;
    const tree = part.featureTree.map((f: any) =>
      f.id === featureId && (f.kind === 'workAxis' || f.kind === 'workPlane' || f.kind === 'workPoint')
        ? { ...f, visible }
        : f,
    );
    return { ...s, activePart: { ...part, featureTree: tree } };
  }),
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
  pendingWorkFeaturePick: null,
  workFeaturePickResult: null,
  requestWorkFeaturePick: (req) => set({ pendingWorkFeaturePick: req, workFeaturePickResult: null }),
  setWorkFeaturePickResult: (result) => set({ pendingWorkFeaturePick: null, workFeaturePickResult: result }),
  clearWorkFeaturePick: () => set({ pendingWorkFeaturePick: null, workFeaturePickResult: null }),
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
