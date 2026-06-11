import { create } from 'zustand';
import type { AssemblyDocument, BooleanOperation, ChamferEdgeSpec, ComponentColor, ComponentInstance, DimensionConstraint, DrawingDocument, EdgeName, FaceName, FilletEdgeSpec, HoleFeature, KernelError, MaterialEntry, PartDocument, SketchConstraint, SketchParameter, SketchPrimitive, SweepFeature, WorkAxisFeature, WorkPlaneFeature, WorkPointFeature } from '@zilventor/shared';
import type { ComponentPath } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import type { DofStatus, PrimitiveCoordsDiff } from '@zilventor/sketcher-worker';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { ViewportRef } from '../viewport/Viewport';
import { createCommandBus, type CommandBus } from '../commands/CommandBus';
import { reprojectDetailRegion } from '../commands/reprojectDetailRegion';

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
  | 'dimension'
  | 'offset'
  | 'fillet'
  | 'chamfer'
  | 'trim'
  | 'extend'
  | 'project-geom';

export type ActiveDocument =
  | { kind: 'part';     document: PartDocument }
  | { kind: 'assembly'; document: AssemblyDocument }
  | { kind: 'drawing';  document: DrawingDocument };   // Sub-project 6

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

/**
 * Slot for the Panel feature dialog (T21). Two modes:
 * - 'part': empty active part — submit dispatches AddPanelFeatureCommand.
 * - 'assembly': assembly active — submit dispatches CreateAndPlacePanelCommand.
 * The dialog component reads `initial` for prefill and calls `onSubmit`/`onCancel`.
 */
export type PanelDialogState = {
  mode: 'part' | 'assembly';
  initial?: import('@zilventor/shared').PanelFeature;
  onSubmit: (panel: import('@zilventor/shared').PanelFeature) => void;
  onCancel: () => void;
};

export type CabinetDialogState = {
  template: 'baseCabinet';
  initial?: import('@zilventor/shared').BaseCabinetParams;
  onSubmit: (params: import('@zilventor/shared').BaseCabinetParams) => void;
  onCancel: () => void;
};

export type HardwareDialogState = {
  onSubmit: (skuId: string, qty: number) => void;
  onCancel: () => void;
};

export type NestDialogState = { kind: 'open' };

export type BoringDialogState = {
  onSubmit: (params: { confirmat: boolean; minifix: boolean; dowel: boolean }) => void;
  onCancel: () => void;
};

/** Slice-2 присадка: "Add Door" dialog. cabinetPath is the picked cabinet `.ziasm`. */
export type AddDoorDialogState = {
  cabinetPath: string;
  onSubmit: (params: {
    count: 'single' | 'double';
    overlay: 'full' | 'half' | 'inset';
    hingeSide: 'left' | 'right';
    thickness: number;
    reveal: number;
    clearance: number;
    centerReveal: number;
  }) => void;
  onCancel: () => void;
};

/** Slice-6 присадка: "Add Handles" dialog. cabinetPath is the picked cabinet `.ziasm`. */
export type AddDrawerHandleDialogState = {
  cabinetPath: string;
  onSubmit: (cc: 96 | 128 | 160) => void | Promise<void>;
  onCancel: () => void;
};

/** Slice-4 присадка: "Add Drawers" dialog. cabinetPath is the picked cabinet `.ziasm`. */
export type AddDrawerBankDialogState = {
  cabinetPath: string;
  /** Optional dims — used by the dialog's degenerate guard if provided. */
  dims?: { openW: number; openH: number };
  onSubmit: (params: {
    count: number;
    overlay: 'full' | 'half' | 'inset';
    thickness: number;
  }) => void;
  onCancel: () => void;
};

/**
 * Slice-2 присадка: система-32 shelf-pin dialog. `auto` recurses the active
 * assembly's side panels; `manual` targets one picked panel + chosen broad face.
 */
export type ShelfPinDialogState = {
  mode: 'auto' | 'manual';
  panelPath?: string;           // present only for mode:'manual' (the picked panel .zipt)
  face?: 'Top' | 'Bottom';      // present only for mode:'manual'
  onSubmit: (params: {
    pitch: number;
    diameter: number;
    depth: number;
    frontSetback: number;
    backSetback: number;
    topMargin: number;
    bottomMargin: number;
    columns: 1 | 2;
  }) => void;
  onCancel: () => void;
};

/** Handle returned by Viewport.beginOneComponentPick. App.tsx holds it and feeds .pick() on canvas click. */
export type OneComponentPickHandle = {
  pick: (clientX: number, clientY: number) => void;
  reset: () => void;
};

// Sub-project 6 Phase 8 — drawing dialogs
export type AddViewDialogKind = 'base' | 'projected' | 'iso';

type AppState = {
  kernel: KernelClient | null;
  bus: CommandBus;
  activeDocument: ActiveDocument | null;
  activePart: PartDocument | null;
  activeAssembly: AssemblyDocument | null;
  activeDrawing: DrawingDocument | null;         // Sub-project 6
  /** Kernel part id loaded from the drawing's source.partPath on drawing activation.
   *  Null when no drawing is active or the source part has not yet loaded.
   *  Set by loadDrawingSource (called from CreateDrawingCommand.apply / future reopen path).
   *  Preserved until the next drawing creation — NOT reset by drawingDocState() or
   *  setActiveDocument(), because drawingDocState() is called by every drawing edit
   *  command and nulling here would break projectViewFromSource for views placed after
   *  the first. */
  activeDrawingSourcePartId: string | null;
  /** djb2 hash of the raw OPFS bytes used to load the source part (set alongside
   *  activeDrawingSourcePartId by loadDrawingSource). Used by projectViewFromSource as
   *  inputFingerprint and by the B5 staleness useEffect to detect source edits.
   *  A kernel UUID is stable per-session, so djb2(kernelId) would NEVER detect edits —
   *  hashing the actual bytes is the correct content-based change-detector.
   *  Null when no drawing is active or the source part has not yet loaded.
   *  Preserved (not reset by drawingDocState/setActiveDocument) — same lifecycle as
   *  activeDrawingSourcePartId above. */
  activeDrawingSourceFingerprint: string | null;
  /** Kernel-loaded components for assembly-sourced drawings. Parallel to activeDrawingSourceFingerprint.
   *  Set by CreateDrawingCommand / activateDrawingDocument for assembly sourceKind.
   *  Null for part-sourced drawings and when no drawing is active.
   *  NOT reset by drawingDocState() — same lifecycle contract as activeDrawingSourcePartId. */
  activeDrawingSourceComponents: import('@zilventor/kernel/src/adapter/drawing/getProjectorInput').AssemblyComponentInput[] | null;
  /** partId → material color (hex) for the active assembly-sourced drawing's components.
   *  Parallel to activeDrawingSourceComponents; built by loadAssemblyForProjection from each
   *  component part's materials[0].color. Null for part-sourced drawings / no active drawing.
   *  NOT reset by drawingDocState() — same lifecycle contract as activeDrawingSourceComponents. */
  activeDrawingSourceComponentColors: Record<string, string> | null;
  /** The resolved source document (PartDocument | AssemblyDocument) for the active
   *  drawing. Used by DrawingTab's export buttons for title-block metadata + the
   *  'featureTree' in source part/assembly discriminator. Set wherever a drawing's
   *  source loads (CreateDrawingCommand, activateDrawingDocument). NOT reset by
   *  drawingDocState() / setActiveDocument — same lifecycle contract as
   *  activeDrawingSourcePartId. Null when no source is loaded → export buttons
   *  correctly stay disabled. */
  activeDrawingSourceDocument: PartDocument | AssemblyDocument | null;
  kernelReady: boolean;
  statusMessage: string;
  /** Non-null while a File→Open is in progress; drives the blocking FileOpenOverlay. */
  fileOpen: { fileName: string; startedAtMs: number } | null;
  /** Monotonic token; bumped on each open start and on cancel to invalidate stale opens. */
  fileOpenSeq: number;
  selectedFeatureId: string | null;
  viewport: ViewportRef | null;
  sketchMode: boolean;
  constructionMode: boolean;
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
  holePlacementMode: 'fromSketch' | 'linear' | 'concentric' | 'atFace';
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
  setActiveDrawing(d: DrawingDocument | null): void;
  updateDetailRegionLive(
    sheetId: string,
    detailViewId: string,
    region: import('@zilventor/shared').RegionParent,
  ): void;
  beginFileOpen(fileName: string): number;
  endFileOpen(token: number): void;
  cancelFileOpen(): void;
  setStatus(msg: string): void;
  setSelectedFeature(id: string | null): void;
  setViewport(v: ViewportRef | null): void;
  setSketchMode(mode: boolean, sketchId?: string | null): void;
  setConstructionMode(on: boolean): void;
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
  componentPatternDialogOpen: boolean;
  mirrorComponentDialogOpen: boolean;
  setComponentPatternDialogOpen(v: boolean): void;
  setMirrorComponentDialogOpen(v: boolean): void;
  circularPatternDialogOpen: boolean;
  setCircularPatternDialogOpen(v: boolean): void;

  placeComponentDialogOpen: boolean;
  editComponentDialogOpen: boolean;
  editingComponentId: string | null;
  editComponentInitialValues: ComponentInstance | null;
  selectedComponentPaths: ComponentPath[];
  /** Slice-3: currently selected bore id (null = nothing selected). */
  selectedBoreId: string | null;
  /** Slice-3: OPFS path of the part owning the selected bore (null = nothing selected). */
  selectedBorePartPath: string | null;
  /** Slice-3: select a bore; clears component selection (mutual exclusion). */
  setSelectedBore(boreId: string | null, partPath: string | null): void;
  componentDiagnostics: Array<{ componentId: string; message: string }>;
  bomTabActive: boolean;
  cutListTabActive: boolean;
  showComponentColors: boolean;
  showEdgeBands: boolean;
  showBores: boolean;
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
  setCutListTabActive: (v: boolean) => void;
  setShowComponentColors: (v: boolean) => void;
  setShowEdgeBands: (v: boolean) => void;
  setShowBores: (v: boolean) => void;
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
  setCutListItemNumber(rowKey: string, n: number): void;
  setCutListItemNumbers(map: Record<string, number>): void;
  setComponentDiagnostics(diags: Array<{ componentId: string; message: string }>): void;
  addMaterial(entry: MaterialEntry): void;
  updateMaterial(id: string, patch: Partial<Omit<MaterialEntry, 'id'>> & { clearSheetStock?: true; clearHatch?: true }): void;
  removeMaterial(id: string): void;
  addCustomTexture(def: import('@zilventor/shared').CustomTextureDef): void;
  removeCustomTexture(id: string): void;
  panelDialog: PanelDialogState | null;
  setPanelDialog(s: PanelDialogState | null): void;
  cabinetDialog: CabinetDialogState | null;
  setCabinetDialog(s: CabinetDialogState | null): void;
  hardwareDialog: HardwareDialogState | null;
  setHardwareDialog(s: HardwareDialogState | null): void;
  nestingTabActive: boolean;
  setNestingTabActive: (v: boolean) => void;
  nestDialog: NestDialogState | null;
  setNestDialog: (s: NestDialogState | null) => void;
  boringDialog: BoringDialogState | null;
  setBoringDialog: (s: BoringDialogState | null) => void;
  addDoorDialog: AddDoorDialogState | null;
  setAddDoorDialog: (s: AddDoorDialogState | null) => void;
  addDrawerBankDialog: AddDrawerBankDialogState | null;
  setAddDrawerBankDialog: (s: AddDrawerBankDialogState | null) => void;
  addDrawerHandleDialog: AddDrawerHandleDialogState | null;
  setAddDrawerHandleDialog: (s: AddDrawerHandleDialogState | null) => void;
  shelfPinDialog: ShelfPinDialogState | null;
  setShelfPinDialog: (s: ShelfPinDialogState | null) => void;
  /** Active one-component pick handle. App.tsx reads this in handleViewportPointer to feed .pick(). */
  oneComponentPickHandle: OneComponentPickHandle | null;
  setOneComponentPickHandle: (h: OneComponentPickHandle | null) => void;

  /**
   * Registered by App.tsx on mount; called by bore commands in apply() and revert()
   * to evict geometry + bore caches so undo/redo re-renders bore markers correctly.
   * Null in unit tests (no App mounted) — commands guard with `?.`.
   */
  boreCacheInvalidator: ((paths: string[]) => void) | null;
  setBoreCacheInvalidator: (fn: ((paths: string[]) => void) | null) => void;

  // Sub-project 6 Phase 8 — drawing dialog slots
  newDrawingDialogOpen: boolean;
  newDrawingSourcePath: string | null;
  newDrawingSourceKind: 'part' | 'assembly' | null;
  addViewDialogState: { kind: AddViewDialogKind } | null;
  setAddViewDialogOpen: (s: { kind: AddViewDialogKind } | null) => void;
  editTitleBlockDialogState: { sheetId: string; initialOverrides: Record<string, string> } | null;
  addDimensionDialogState: { sheetId: string; dim: import('@zilventor/shared').DrawingDimension; computedValue: number } | null;
  addLeaderTextDialogState: { sheetId: string; ann: Extract<import('@zilventor/shared').DrawingAnnotation, { kind: 'leader' }> } | null;

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
  activeDrawing: null,
  activeDrawingSourcePartId: null,
  activeDrawingSourceFingerprint: null,
  activeDrawingSourceComponents: null,
  activeDrawingSourceComponentColors: null,
  activeDrawingSourceDocument: null,
  kernelReady: false,
  statusMessage: 'Loading…',
  fileOpen: null,
  fileOpenSeq: 0,
  selectedFeatureId: null,
  viewport: null,
  sketchMode: false,
  constructionMode: false,
  activeSketchId: null,
  activeToolKind: null,
  selectedPrimitiveId: null,
  parametersPanelOpen: false,
  revolveDialogOpen: false,
  filletDialogOpen: false,
  setKernel: (k) => set({ kernel: k, kernelReady: true, statusMessage: 'Ready' }),
  setActiveDocument: (d) => set({
    activeDocument: d,
    activePart:     d?.kind === 'part'     ? d.document : null,
    activeAssembly: d?.kind === 'assembly' ? d.document : null,
    activeDrawing:  d?.kind === 'drawing'  ? d.document : null,
  }),
  setActiveDrawing: (d) => set({
    activeDocument: d ? { kind: 'drawing', document: d } : null,
    activePart:     null,
    activeAssembly: null,
    activeDrawing:  d,
  }),
  updateDetailRegionLive(sheetId, detailViewId, region) {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;
    const drawing = doc.document;
    const sheet = drawing.sheets.find(s => s.id === sheetId);
    if (!sheet) return;
    const detail = sheet.views.find(v => v.id === detailViewId);
    if (!detail || detail.kind !== 'detail') return;
    const parentView = sheet.views.find(v => v.id === (detail as import('@zilventor/shared').DetailView).parentViewId);
    if (!parentView || !parentView.projection) return;

    const next = reprojectDetailRegion(
      detail as import('@zilventor/shared').DetailView,
      parentView as typeof parentView & { projection: NonNullable<typeof parentView['projection']> },
      region,
    );
    const nextDoc: import('@zilventor/shared').DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map(s =>
        s.id === sheetId
          ? { ...s, views: s.views.map(v => v.id === detailViewId ? next : v) }
          : s
      ),
    };
    set({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
  },
  setActivePart: (p) => set({
    activeDocument: p ? { kind: 'part', document: p } : null,
    activePart: p,
    activeAssembly: null,
  }),
  beginFileOpen: (fileName) => {
    let token = 0;
    set((s) => {
      token = s.fileOpenSeq + 1;
      return { fileOpenSeq: token, fileOpen: { fileName, startedAtMs: Date.now() } };
    });
    return token;
  },
  endFileOpen: (token) => set((s) => (s.fileOpenSeq === token ? { fileOpen: null } : {})),
  cancelFileOpen: () => set((s) => ({ fileOpenSeq: s.fileOpenSeq + 1, fileOpen: null })),
  setStatus: (msg) => set({ statusMessage: msg }),
  setSelectedFeature: (id) => set({ selectedFeatureId: id }),
  setViewport: (v) => set({ viewport: v }),
  setSketchMode: (mode, sketchId = null) =>
    set({
      sketchMode: mode,
      activeSketchId: sketchId,
      activeToolKind: null,
      selectedPrimitiveId: null,
      constructionMode: false,
    }),
  setConstructionMode: (on) => set({ constructionMode: on }),
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
  componentPatternDialogOpen: false,
  mirrorComponentDialogOpen: false,
  setComponentPatternDialogOpen: (v) => set({ componentPatternDialogOpen: v }),
  setMirrorComponentDialogOpen: (v) => set({ mirrorComponentDialogOpen: v }),
  circularPatternDialogOpen: false,
  setCircularPatternDialogOpen: (v) => set({ circularPatternDialogOpen: v }),

  placeComponentDialogOpen: false,
  editComponentDialogOpen: false,
  editingComponentId: null,
  editComponentInitialValues: null,
  selectedComponentPaths: [],
  selectedBoreId: null,
  selectedBorePartPath: null,
  componentDiagnostics: [],
  bomTabActive: false,
  cutListTabActive: false,
  showComponentColors: false,
  showEdgeBands: typeof localStorage !== 'undefined' ? localStorage.getItem('showEdgeBands') !== 'false' : true,
  showBores: typeof localStorage !== 'undefined' ? localStorage.getItem('showBores') !== 'false' : true,
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
  setSelectedBore: (boreId, partPath) => set({
    selectedBoreId: boreId,
    selectedBorePartPath: partPath,
    selectedComponentPaths: [],
  }),
  selectComponentPaths: (paths) => set({
    selectedComponentPaths: [...paths],
    selectedBoreId: null,
    selectedBorePartPath: null,
  }),
  setBomTabActive: (v) => set({ bomTabActive: v }),
  setCutListTabActive: (v) => set({ cutListTabActive: v }),
  setShowComponentColors: (v) => set({ showComponentColors: v }),
  setShowEdgeBands: (v) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('showEdgeBands', String(v));
    set({ showEdgeBands: v });
  },
  setShowBores: (v) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('showBores', String(v));
    set({ showBores: v });
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
    const { clearSheetStock, clearHatch, ...rest } = patch as typeof patch & { clearSheetStock?: true; clearHatch?: true };
    const applyPatch = (m: MaterialEntry): MaterialEntry => {
      if (m.id !== id) return m;
      let merged: MaterialEntry = { ...m, ...rest };
      if (clearSheetStock) {
        const { sheetLengthMm: _l, sheetWidthMm: _w, ...stripped } = merged;
        merged = stripped as MaterialEntry;
      }
      if (clearHatch) {
        const { hatchAngleDeg: _a, hatchSpacingMm: _sp, ...stripped } = merged;
        merged = stripped as MaterialEntry;
      }
      return merged;
    };
    if (s.activeAssembly) {
      const next: AssemblyDocument = {
        ...s.activeAssembly,
        materials: s.activeAssembly.materials.map(applyPatch),
      };
      return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next };
    }
    if (s.activePart) {
      const next: PartDocument = {
        ...s.activePart,
        materials: s.activePart.materials.map(applyPatch),
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

  addCustomTexture: (def) => set((s) => {
    if (s.activeAssembly) {
      const next: AssemblyDocument = {
        ...s.activeAssembly,
        customTextures: [...(s.activeAssembly.customTextures ?? []), def],
      };
      return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next };
    }
    if (s.activePart) {
      const next: PartDocument = {
        ...s.activePart,
        customTextures: [...(s.activePart.customTextures ?? []), def],
      };
      return { activeDocument: { kind: 'part', document: next }, activePart: next };
    }
    return s;
  }),

  removeCustomTexture: (id) => set((s) => {
    if (s.activeAssembly) {
      const next: AssemblyDocument = {
        ...s.activeAssembly,
        customTextures: (s.activeAssembly.customTextures ?? []).filter((d) => d.id !== id),
      };
      return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next };
    }
    if (s.activePart) {
      const next: PartDocument = {
        ...s.activePart,
        customTextures: (s.activePart.customTextures ?? []).filter((d) => d.id !== id),
      };
      return { activeDocument: { kind: 'part', document: next }, activePart: next };
    }
    return s;
  }),

  panelDialog: null,
  setPanelDialog: (s) => set({ panelDialog: s }),
  cabinetDialog: null,
  setCabinetDialog: (s) => set({ cabinetDialog: s }),
  hardwareDialog: null,
  setHardwareDialog: (s) => set({ hardwareDialog: s }),
  nestingTabActive: false,
  setNestingTabActive: (v) => set({ nestingTabActive: v }),
  nestDialog: null,
  setNestDialog: (s) => set({ nestDialog: s }),
  boringDialog: null,
  setBoringDialog: (s) => set({ boringDialog: s }),
  addDoorDialog: null,
  setAddDoorDialog: (s) => set({ addDoorDialog: s }),
  addDrawerBankDialog: null,
  setAddDrawerBankDialog: (s) => set({ addDrawerBankDialog: s }),
  addDrawerHandleDialog: null,
  setAddDrawerHandleDialog: (s) => set({ addDrawerHandleDialog: s }),
  shelfPinDialog: null,
  setShelfPinDialog: (s) => set({ shelfPinDialog: s }),
  oneComponentPickHandle: null,
  setOneComponentPickHandle: (h) => set({ oneComponentPickHandle: h }),
  boreCacheInvalidator: null,
  setBoreCacheInvalidator: (fn) => set({ boreCacheInvalidator: fn }),

  // Sub-project 6 Phase 8 — drawing dialog slots
  newDrawingDialogOpen: false,
  newDrawingSourcePath: null,
  newDrawingSourceKind: null,
  addViewDialogState: null,
  setAddViewDialogOpen: (s) => set({ addViewDialogState: s }),
  editTitleBlockDialogState: null,
  addDimensionDialogState: null,
  addLeaderTextDialogState: null,

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
  setCutListItemNumber: (rowKey, n) => set((s) => {
    if (!s.activeAssembly) return s;
    const map = { ...s.activeAssembly.cutListItemNumbers };
    const collidingKey = Object.entries(map).find(([k, v]) => v === n && k !== rowKey)?.[0];
    if (collidingKey) {
      const max = Math.max(0, ...Object.values(map));
      map[collidingKey] = max + 1;
    }
    map[rowKey] = n;
    const next: AssemblyDocument = { ...s.activeAssembly, cutListItemNumbers: map };
    return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next };
  }),
  setCutListItemNumbers: (map) => set((s) => {
    if (!s.activeAssembly) return s;
    const next: AssemblyDocument = { ...s.activeAssembly, cutListItemNumbers: { ...map } };
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
    // atFace holes are baked by BakeBoresCommand and are not user-editable via HoleDialog;
    // fall back to 'fromSketch' so the dialog opens in a safe read-only-ish state.
    const displayMode: AppState['holePlacementMode'] =
      placement.kind === 'atFace' ? 'fromSketch' : placement.kind;
    return {
      ...s,
      holeDialogOpen: true,
      editingHoleId: id,
      holeInitialValues: feature,
      holePlacementMode: displayMode,
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

/** Returns the active DrawingDocument, or null when any other kind is active. */
export const selectActiveDrawing = (s: ReturnType<typeof useAppStore.getState>) =>
  s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
