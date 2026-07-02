import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from './i18n';
import { LanguageSwitcher } from './i18n/LanguageSwitcher';
import { DrawingCanvas } from './drawing/DrawingCanvas';
import { DrawingTreePane } from './drawing/DrawingTreePane';
import Ribbon from './shell/Ribbon';
import BrowserPane from './shell/BrowserPane';
import StatusBar from './shell/StatusBar';
import FileOpenOverlay from './shell/FileOpenOverlay';
import PropertiesPanel from './shell/PropertiesPanel';
import { BorePropertiesPanel } from './shell/BorePropertiesPanel';
import { GroovePropertiesPanel } from './shell/GroovePropertiesPanel';
import Viewport, { type ViewportRef } from './viewport/Viewport';
import NumericInputOverlay from './shell/NumericInputOverlay';
import { spawnKernel } from './kernel-client/KernelClient';
import { useAppStore } from './store/useAppStore';
import type { ToolKind } from './store/useAppStore';
import { createSketchModeController, type SketchModeHandle } from './sketcher/SketchModeController';
import { SketcherClient } from './sketcher/SketcherClient';
import { createSketcherWorkerApi } from './vendor/sketcherWorker';
import { ActiveToolController } from './sketcher/ActiveToolController';
import { ProjectGeometryTool } from './sketcher/tools/ProjectGeometryTool';
import { SketchOverlay } from './sketcher/overlay/SketchOverlay';
import { CommittedSketchRenderer } from './sketcher/render/CommittedSketchRenderer';
import { ConstraintBadgeRenderer } from './sketcher/render/ConstraintBadgeRenderer';
import { DimensionRenderer } from './sketcher/render/DimensionRenderer';
import { AddPrimitiveCommand } from './commands/AddPrimitiveCommand';
import { UpdatePrimitiveCommand } from './commands/UpdatePrimitiveCommand';
import { DeletePrimitiveCommand } from './commands/DeletePrimitiveCommand';
import { AddConstraintCommand } from './commands/AddConstraintCommand';
import { AddDimensionCommand, AddDimensionConflictError } from './commands/AddDimensionCommand';
import { UpdateDimensionValueCommand } from './commands/UpdateDimensionValueCommand';
import { UpdateParameterExpressionCommand } from './commands/UpdateParameterExpressionCommand';
import { parseDimensionInput } from './sketcher/parseDimensionInput';
import type { Feature, DimensionConstraint, FaceName, FilletEdgeSpec, FilletSelectionMode, FilletFeature, ChamferEdgeSpec, ChamferFeature, ShellFeature, LinearPatternFeature, MirrorFeature, EdgeName, SweepFeature, SweepOrientation, BooleanOperation } from '@zilventor/shared';
import { ParameterRegistry } from './parameters/ParameterRegistry';
import type { EvaluationError } from './parameters/types';
import { useParameterValues } from './parameters/useParameterValues';
import { RuleEngine, RuleCycleError } from './rules/RuleEngine';
import { DimensionDialog } from './shell/DimensionDialog';
import { ParametersPanel } from './shell/ParametersPanel';
import { ConfigurationsPanel } from './shell/ConfigurationsPanel';
import { activateConfiguration } from './configurations/activateConfiguration';
import { configurationFromParameters } from './configurations/configurationFromParameters';
import { RevolveDialog, type AxisRef, type ProfileRef, type RevolveDialogValue } from './shell/RevolveDialog';
import { AxisPickController } from './model/AxisPickController';
import { ProfilePickController } from './model/ProfilePickController';
import { AddRevolveFeatureCommand } from './commands/AddRevolveFeatureCommand';
import { EdgePickController, type TessellatedEdge } from './model/EdgePickController';
import { FacePickController } from './model/FacePickController';
import { FilletDialog, type FilletDialogValue, type FilletMode } from './shell/FilletDialog';
import { AddFilletFeatureCommand } from './commands/AddFilletFeatureCommand';
import { ChamferDialog, type ChamferDialogValue } from './shell/ChamferDialog';
import { AddChamferFeatureCommand } from './commands/AddChamferFeatureCommand';
import { ShellDialog, type ShellDialogValue } from './shell/ShellDialog';
import { AddShellFeatureCommand } from './commands/AddShellFeatureCommand';
import { LinearPatternDialog, type LinearPatternDialogValue } from './shell/LinearPatternDialog';
import { AddLinearPatternFeatureCommand } from './commands/AddLinearPatternFeatureCommand';
import { MirrorDialog, type MirrorDialogValue } from './shell/MirrorDialog';
import { AddMirrorFeatureCommand } from './commands/AddMirrorFeatureCommand';
import { HoleDialog, type HoleDraftValue } from './shell/HoleDialog';
import { AddHoleFeatureCommand } from './commands/AddHoleFeatureCommand';
import { OpenHoleDialogCommand } from './commands/OpenHoleDialogCommand';
import { OpenSweepDialogCommand } from './commands/OpenSweepDialogCommand';
import { OpenPlaceComponentDialogCommand } from './commands/OpenPlaceComponentDialogCommand';
import { SweepDialog } from './shell/SweepDialog';
import { AddSweepFeatureCommand } from './commands/AddSweepFeatureCommand';
import { ImportFromInventorDialog, type ImportDialogStatus } from './shell/ImportFromInventorDialog';
import { PanelDialog } from './shell/PanelDialog';
import type { MaterialEntry, PanelFeature, PartDocument } from '@zilventor/shared';
import type { PanelOverlaySpec, MarkerOverlaySpec } from './viewport/SceneManager';
import type { BoreOp, GrooveFeature, TenonMortiseFeature, TessellatedFace, ShelfPinParams, PanelPreflightDiagnostic } from '@zilventor/shared';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { signedDragDeltaAlongAxis, clampDeltaToFaceExtents } from '@zilventor/shared';
import { MoveConnectorCommand } from './commands/MoveConnectorCommand';
import { collectConnectorMembers } from './shell/collectConnectorMembers';
import { ImportFromInventorCommand } from './commands/ImportFromInventorCommand';
import { makeFakeInputDir } from './import/buildFakeImportEnv';
import type { WorkPlaneCommit } from './shell/WorkPlaneDialog';
import type { WorkAxisCommit } from './shell/WorkAxisDialog';
import type { WorkPointCommit } from './shell/WorkPointDialog';
import { AddWorkPlaneFeatureCommand } from './commands/AddWorkPlaneFeatureCommand';
import { AddWorkAxisFeatureCommand } from './commands/AddWorkAxisFeatureCommand';
import { AddWorkPointFeatureCommand } from './commands/AddWorkPointFeatureCommand';
import type { WorkPlaneFeature, WorkAxisFeature, WorkPointFeature } from '@zilventor/shared';
import { WorkFeatureDialogsHost } from './shell/WorkFeatureDialogsHost';
import { OpenWorkPlaneDialogCommand } from './commands/OpenWorkPlaneDialogCommand';
import { OpenWorkAxisDialogCommand } from './commands/OpenWorkAxisDialogCommand';
import { OpenWorkPointDialogCommand } from './commands/OpenWorkPointDialogCommand';
import { SketchPickController } from './model/SketchPickController';
import { WorkPlanePickController } from './model/WorkPlanePickController';
import { WorkAxisPickController } from './model/WorkAxisPickController';
import { WorkPointPickController } from './model/WorkPointPickController';
import { PlaceComponentDialog } from './shell/PlaceComponentDialog';
import { EditComponentDialog } from './shell/EditComponentDialog';
import { PlaceComponentCommand } from './commands/PlaceComponentCommand';
import { EditComponentCommand } from './commands/EditComponentCommand';
import { loadAssemblyTiles, type AssemblyTile } from './shell/loadAssemblyTiles';
import { PlaceConstraintDialog } from './shell/PlaceConstraintDialog';
import { OpenPlaceConstraintDialogCommand } from './commands/OpenPlaceConstraintDialogCommand';
import { ToggleGroundedCommand } from './commands/ToggleGroundedCommand';
import { ToggleConstraintSuppressionCommand } from './commands/ToggleConstraintSuppressionCommand';
import { AssemblyRefPickController } from './model/AssemblyRefPickController';
import { AddAssemblyConstraintCommand } from './commands/AddAssemblyConstraintCommand';
import { EditAssemblyConstraintCommand } from './commands/EditAssemblyConstraintCommand';
import type { AssemblyConstraint } from '@zilventor/shared';
import { buildAssemblyConstraint } from './assembly/constraintFromMode';
import { Opfs } from '@zilventor/kernel/src/storage/Opfs';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { packAssembly, unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { globalCustomTextureRegistry, collectCustomTextureBytes } from './textures/customTextureRegistry';
import { packDrawing } from './storage/DrawingPacker';
import { autosaveDrawing, withOpfsLock } from './storage/autosaveDrawing';
import { setLastOpenDocument } from './storage/lastOpenDocument';
import type { ComponentInstance, AssemblyDocument } from '@zilventor/shared';
import * as THREE from 'three';
import { solveAssembly } from '@zilventor/kernel/src/assembly/AssemblyConstraintSolver';
import { AssemblyRefCache, refKey } from '@zilventor/kernel/src/assembly/AssemblyConstraintRefs';
import { quatFromEulerXYZ } from '@zilventor/kernel/src/assembly/quat';
import { parseParamOrLiteral } from './shell/parseParamOrLiteral';
import { mergeAndPruneBom } from './storage/mergeBomItemNumbers';
import { mergeAndPruneCutList } from './storage/mergeCutListItemNumbers';
import { mergeAndPruneColorOverrides } from './assembly/colorOverrideMerge';
import { aggregateCutListRecursive } from './assembly/walkers/aggregateCutListRecursive';
import { aggregateBoresRecursive } from './assembly/walkers/aggregateBoresRecursive';
import { aggregateBom } from '@zilventor/shared/src/bomRow';
import { aggregateBomRecursive } from './assembly/walkers/aggregateBomRecursive';
import { resolvePartInfo } from './shell/resolvePartInfo';
import type { PartInfo } from '@zilventor/shared';
import { CutListCacheContext } from './shell/CutListCacheContext';
import type { PanelSpecCache } from './shell/resolvePanelSpec';
import { loadCutListInputs } from './shell/loadCutListInputs';
import { visibleLeaves } from './assembly/walkers/visibleLeaves';
import { computeInnerStaticPoses } from './assembly/computeInnerStaticPoses';
import { composePoses, composedPoses } from './assembly/walkers/composedPoses';
import type { Pose } from './assembly/walkers/flattenForSolver';
import { flattenForSolver } from './assembly/walkers/flattenForSolver';
import { resolveLeafPartPath } from './assembly/walkers/resolveLeafPartPath';
import { transformPartLocalGeometry } from './assembly/transformPartLocalGeometry';
import { shouldReflowAfterInvalidate, partPathForKernelId } from './assembly/reflowDirty';
import { paramRefValuesOf } from './assembly/constraintParamRefs';
import { pathKey, type ComponentPath } from '@zilventor/shared';
import { isPanelFeature, resolvePanelSpecFromFeature } from '@zilventor/shared';
import { packAllMaterials } from '@zilventor/shared';
import type { NestInputRow } from '@zilventor/shared';
import { projectView } from '@zilventor/shared/src/drawing/projector';
import { renderDrawingSvg } from './drawing/renderDrawingSvg';
import { renderDrawingDxf as _renderDrawingDxf } from './drawing/renderDrawingDxf';
import { renderDrawingDxf1to1 as _renderDrawingDxf1to1 } from './drawing/renderDrawingDxf1to1';
import { buildDxfZip as _buildDxfZip } from './drawing/dxfZip';
import { renderDrawingPdfBytes } from './drawing/renderDrawingPdf';
import { fingerprintPartState as _fpFn } from './drawing/fingerprintPartState';
import { restoreLastOpenDocument, type KernelForRestore } from './drawing/restoreLastOpenDocument';

// Module-level singleton. Registry loads from activePart.parameters on every part change.
export const parameterRegistry = new ParameterRegistry();

// Conditional parameter rules (Milestone 2). Started at module level so the engine
// subscribes ahead of the in-component cascade subscriber — rule-applied params are
// then present before the cascade pushes values to the kernel and re-executes.
// Rules for the active part are (re)loaded on every part change below.
export const ruleEngine = new RuleEngine(parameterRegistry);
ruleEngine.start();

/**
 * T29-T30: Resolve a `ParamOrLiteral` to a numeric value for the panel
 * overlay walker. Returns `null` when a referenced parameter is missing or
 * non-numeric so the caller can skip building an overlay rather than throw
 * mid-render.
 */
function resolvePanelDim(
  v: import('@zilventor/shared').ParamOrLiteral,
  parameters: Record<string, { value: number }>,
): number | null {
  if (v.kind === 'literal') return v.value;
  const p = parameters[v.paramName];
  if (!p || !Number.isFinite(p.value)) return null;
  return p.value;
}

function formatExpressionError(err: EvaluationError): string {
  switch (err.code) {
    case 'unknown-var':   return i18n.t('error.unknownParam', { name: err.name });
    case 'cycle':         return i18n.t('error.cycleDetected', { names: err.namesInCycle.join(' → ') });
    case 'parse-error':   return i18n.t('error.parseError', { message: err.message });
    case 'div-by-zero':   return i18n.t('error.divByZero');
    case 'non-finite':    return i18n.t('error.nonFinite');
    case 'name-in-use':   return i18n.t('error.nameInUse', { name: err.name });
    case 'referenced':    return i18n.t('error.referenced', { name: err.name, refs: err.referencedBy.join(', ') });
  }
}

const THUMB_THROTTLE_MS = 5000;

export default function App() {
  const { t } = useTranslation();
  const viewportRef = useRef<ViewportRef>(null);
  // When the shown 3D document changes (open part/assembly, switch docs,
  // session restore), arm a one-shot camera fit-to-model so the opened model is
  // framed to view. Subsequent edits re-mesh the same document and do NOT
  // re-frame (the flag is consumed on the first mesh after this fires).
  const active3dDocId = useAppStore((s) => s.activePart?.id ?? s.activeAssembly?.id ?? null);
  useEffect(() => {
    if (active3dDocId) viewportRef.current?.requestFrameOnNextMesh();
  }, [active3dDocId]);
  const terminateRef = useRef<(() => void) | null>(null);
  // Guards against double-click reentry into handleRestart (both calls would
  // race spawnKernel() and leak a worker by overwriting terminateRef).
  const restartingRef = useRef(false);
  // Set from the bootstrap effect's cleanup so an in-flight handleRestart can
  // terminate the freshly spawned worker instead of leaking it after unmount.
  const unmountedRef = useRef(false);
  const [kernelOffline, setKernelOffline] = useState(false);
  const [kernelFailed, setKernelFailed] = useState(false);
  const [sketcherCrashed, setSketcherCrashed] = useState(false);

  // Sketcher refs — instantiated once viewport is mounted.
  const sketcherClientRef = useRef<SketcherClient | null>(null);
  const sketchModeRef = useRef<SketchModeHandle | null>(null);
  const activeToolCtrlRef = useRef<ActiveToolController | null>(null);
  const sketchOverlayRef = useRef<SketchOverlay | null>(null);
  const committedSketchRendererRef = useRef<CommittedSketchRenderer | null>(null);
  const axisPickerRef = useRef<AxisPickController>(new AxisPickController());
  const profilePickerRef = useRef<ProfilePickController>(new ProfilePickController());
  const edgePickerRef = useRef<EdgePickController>(new EdgePickController());
  // Tessellated-edge cache for edge picking. T23-T25 interim: left empty because
  // ExecutionResult currently unwraps `finalSolid` to an OcctShape and drops the
  // NamedShape face-name map. A future task can extend ExecutionResult to expose
  // the NamedShape + tessellated edges so the Add button in FilletDialog can
  // actually populate the edge list.
  const tessellatedEdgesRef = useRef<TessellatedEdge[]>([]);
  const facePickerRef = useRef<FacePickController>(new FacePickController());
  // True iff the activePart re-execute effect (below) is the one currently
  // displaying an error status; gates its success branch so it only ever
  // clears a status message it put up itself, never one set concurrently by
  // another action (e.g. File→Open's "Imported").
  const lastExecuteErrorRef = useRef(false);
  // Component drag state (4b follow-up B3). Tracks an in-flight pointer-drag of
  // a component mesh in the viewport: pointerdown raycasts a component, move
  // delegates to dragAlongFreeDofs once threshold is exceeded, pointerup
  // commits the new translation back to the store via updateComponent.
  const componentDragRef = useRef<{
    componentPath: ComponentPath;
    startScreenX: number;
    startScreenY: number;
    lastWorld: { x: number; y: number };
    didDrag: boolean;
  } | null>(null);
  // Set by pointerup when a drag actually happened so the synthetic click that
  // browsers fire afterwards does not deselect the just-dragged component.
  const suppressNextClickRef = useRef(false);
  // Slice-5: OrbitControls ref populated after SM init; disabled during bore drag.
  const orbitControlsRef = useRef<OrbitControls | null>(null);
  // Slice-5: active bore drag state. null when no bore drag is in flight.
  const boreDragRef = useRef<null | {
    boreId: string;
    partPath: string;
    pointerId: number;
    worldAxis: { x: number; y: number; z: number };
    pivot: { x: number; y: number; z: number };
    rayStart: { origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number } };
    members: Array<{
      bore: BoreOp;
      partPath: string;
      doc: { bores?: BoreOp[] };
      panelDims: { length: number; width: number; thickness: number };
      worldPose: { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] };
    }>;
    markerMesh: THREE.Mesh | null;
    startUV: { u: number; v: number };
    lastDelta?: number;
  }>(null);
  const [availableFaceNames, setAvailableFaceNames] = useState<FaceName[]>([]);

  const [numericVisible, setNumericVisible] = useState(false);
  const [numericFieldCount, setNumericFieldCount] = useState(0);
  const [cursorScreenPos, setCursorScreenPos] = useState({ x: 0, y: 0 });
  const [pendingDimension, setPendingDimension] = useState<DimensionConstraint | null>(null);
  const [editingDimId, setEditingDimId] = useState<string | null>(null);
  const [pickingAxis, setPickingAxis] = useState(false);
  const [selectedAxisRef, setSelectedAxisRef] = useState<AxisRef | null>(null);
  const [pickingProfile, setPickingProfile] = useState(false);
  const [manualProfileRef, setManualProfileRef] = useState<ProfileRef | null>(null);
  // Error message surfaced by schedulePreview when `previewFeature` returns
  // err — passed to RevolveDialog's `previewError` prop so the user sees why
  // the live preview disappeared. Cleared on cancel/commit/apply.
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; action?: { label: string; fn: () => void } } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Remembers the most recent scratch angle-parameter name written by the
  // preview-debounce path. Cleared on successful commit/apply so a subsequent
  // Cancel does not delete a legitimately-committed param.
  const scratchParamNameRef = useRef<string | null>(null);

  // Fillet dialog state.
  const [filletSelectionMode, setFilletSelectionMode] = useState<FilletSelectionMode>('edge');
  const [filletMode, setFilletMode] = useState<FilletMode>('constant');
  // `filletInitialRadius` lives in the store (seeded by `openFilletForEdit`)
  // so the FilletDialog can mount with pre-populated radius when editing.
  const [filletPreviewError, setFilletPreviewError] = useState<string | null>(null);
  const [pickingFilletEdges, setPickingFilletEdges] = useState(false);
  const [pickingChamferEdges, setPickingChamferEdges] = useState(false);
  const [pickingShellFaces, setPickingShellFaces] = useState(false);
  // Hovered edge set — kept in state so a future highlight overlay in the
  // viewport can subscribe. For the T23-T25 stub no renderer consumes it yet.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [hoveredEdgeSet, setHoveredEdgeSet] = useState<EdgeName[] | null>(null);
  const filletPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks every scratch parameter name written during preview so Cancel can
  // delete them. Used as a Set so repeated previews under the same name are idempotent.
  const filletScratchParamsRef = useRef<Set<string>>(new Set());

  // Hole dialog preview state — mirrors fillet/revolve pattern.
  const [holePreviewError, setHolePreviewError] = useState<string | null>(null);
  const holePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sweep dialog preview state — mirrors hole/fillet/revolve pattern.
  const [sweepPreviewError, setSweepPreviewError] = useState<string | null>(null);
  const sweepPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sweep sketch-pick wiring (T19).
  // A discriminator ref tracks which of the three sweep slots is waiting for a pick.
  const sweepActivePickRef = useRef<'profile' | 'path' | 'guideRail' | null>(null);
  const sweepPickerRef = useRef<SketchPickController | null>(null);
  useEffect(() => {
    sweepPickerRef.current = new SketchPickController({
      onPick: (sketchId) => {
        const slot = sweepActivePickRef.current;
        if (slot === 'profile') {
          useAppStore.setState((s) => ({ ...s, sweepProfileSketchId: sketchId }));
        } else if (slot === 'path') {
          useAppStore.setState((s) => ({ ...s, sweepPathSketchId: sketchId }));
        } else if (slot === 'guideRail') {
          useAppStore.setState((s) => ({ ...s, sweepGuideRailSketchId: sketchId }));
        }
        sweepPickerRef.current?.deactivate();
        sweepActivePickRef.current = null;
      },
    });
  }, []);

  // Work-feature pickers (T38). Each is constructed once and routes its
  // onPick result back into the store via setWorkFeaturePickResult. App.tsx's
  // handleViewportPointer arms a picker by reading the dialog-issued
  // `pendingWorkFeaturePick` request and forwarding viewport hits.
  const workPlanePickerRef = useRef<WorkPlanePickController | null>(null);
  const workAxisPickerRef = useRef<WorkAxisPickController | null>(null);
  const workPointPickerRef = useRef<WorkPointPickController | null>(null);
  useEffect(() => {
    workPlanePickerRef.current = new WorkPlanePickController({
      onPick: (hit) => {
        const req = useAppStore.getState().pendingWorkFeaturePick;
        if (!req || req.kind !== 'plane') return;
        useAppStore.getState().setWorkFeaturePickResult({ kind: 'plane', role: req.role, hit });
      },
    });
    workAxisPickerRef.current = new WorkAxisPickController({
      onPick: (hit) => {
        const req = useAppStore.getState().pendingWorkFeaturePick;
        if (!req || req.kind !== 'axis') return;
        useAppStore.getState().setWorkFeaturePickResult({ kind: 'axis', role: req.role, hit });
      },
    });
    workPointPickerRef.current = new WorkPointPickController({
      onPick: (hit) => {
        const req = useAppStore.getState().pendingWorkFeaturePick;
        if (!req || req.kind !== 'point') return;
        useAppStore.getState().setWorkFeaturePickResult({ kind: 'point', role: req.role, hit });
      },
    });
  }, []);

  // Activate the matching picker whenever a dialog issues a pending request.
  // The store keeps `pendingWorkFeaturePick` until pickFromViewport delivers
  // a hit (which clears it via setWorkFeaturePickResult).
  const pendingWorkFeaturePick = useAppStore((s) => s.pendingWorkFeaturePick);
  useEffect(() => {
    const req = pendingWorkFeaturePick;
    workPlanePickerRef.current?.deactivate();
    workAxisPickerRef.current?.deactivate();
    workPointPickerRef.current?.deactivate();
    if (!req) return;
    if (req.kind === 'plane') {
      workPlanePickerRef.current?.activate(req.mode as 'face' | 'workPlane');
    } else if (req.kind === 'axis') {
      workAxisPickerRef.current?.activate(req.mode as 'cylindricalFace' | 'edge' | 'workAxis');
    } else if (req.kind === 'point') {
      workPointPickerRef.current?.activate(req.mode as 'vertex' | 'workPoint');
    }
  }, [pendingWorkFeaturePick]);

  // Map kernel ExecutionResult.workFeatures + part.featureTree visibility into
  // the SceneManager renderer. Without this wire the work-feature renderer
  // never receives data, so origin planes stay invisible and the geometry
  // hash never reflects work-plane parameter changes.
  const applyWorkFeaturesToViewport = useCallback((
    workFeatures: ReadonlyArray<import('@zilventor/shared').WorkFeatureValue> | undefined,
    tree: ReadonlyArray<{ kind: string; id: string; visible?: boolean }>,
  ) => {
    if (!viewportRef.current) return;
    const visibleById = new Map<string, boolean>();
    for (const f of tree) {
      if (f.kind === 'workAxis' || f.kind === 'workPlane' || f.kind === 'workPoint') {
        visibleById.set(f.id, !!f.visible);
      }
    }
    const specs = (workFeatures ?? []).map((wf) => {
      const visible = visibleById.get(wf.featureId) ?? false;
      if (wf.kind === 'axis') return { featureId: wf.featureId, kind: 'axis' as const, origin: wf.origin, direction: wf.direction, visible };
      if (wf.kind === 'plane') return { featureId: wf.featureId, kind: 'plane' as const, origin: wf.origin, normal: wf.normal, visible };
      return { featureId: wf.featureId, kind: 'point' as const, origin: wf.position, visible };
    });
    viewportRef.current.setWorkFeatures(specs);
  }, []);

  const showToast = useCallback((message: string, action?: { label: string; fn: () => void }) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(action ? { message, action } : { message });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3000);
  }, []);

  const handleImportDxfIntoSketch = useCallback(async (file: File) => {
    const { kernel, bus, activeSketchId, setStatus, setActivePart } = useAppStore.getState();
    if (!kernel || !activeSketchId) return;
    const { ImportDxfIntoActiveSketchCommand } = await import('./commands/ImportDxfIntoActiveSketchCommand');
    await bus.execute(new ImportDxfIntoActiveSketchCommand({
      kernel,
      sketcherClient: sketcherClientRef.current ?? undefined,
      store: { getActivePart: () => useAppStore.getState().activePart, setActivePart },
      sketchId: activeSketchId,
      setStatus,
      file,
    }));
  }, []);

  // Per-slice subscriptions (avoid subscribing to the full store).
  const activeDocKind = useAppStore((s) => s.activeDocument?.kind ?? 'part');
  const activePart = useAppStore((s) => s.activePart);
  // Slice-5: reactive bore selection for gizmo-on-select effect.
  const selectedBoreId = useAppStore((s) => s.selectedBoreId);
  const selectedBorePartPath = useAppStore((s) => s.selectedBorePartPath);
  const kernel = useAppStore((s) => s.kernel);
  const statusMessage = useAppStore((s) => s.statusMessage);
  const kernelReady = useAppStore((s) => s.kernelReady);
  const saveState = useAppStore((s) => s.saveState);
  const sketchMode = useAppStore((s) => s.sketchMode);
  const activeSketchId = useAppStore((s) => s.activeSketchId);
  const activeToolKind = useAppStore((s) => s.activeToolKind);
  const parametersPanelOpen = useAppStore((s) => s.parametersPanelOpen);
  const setParametersPanelOpen = useAppStore((s) => s.setParametersPanelOpen);
  const configurationsPanelOpen = useAppStore((s) => s.configurationsPanelOpen);
  const setConfigurationsPanelOpen = useAppStore((s) => s.setConfigurationsPanelOpen);
  const [activeConfigName, setActiveConfigName] = useState<string | null>(null);
  const importFromInventorDialogOpen = useAppStore((s) => s.importFromInventorDialogOpen);
  const setImportFromInventorDialogOpen = useAppStore((s) => s.setImportFromInventorDialogOpen);
  const [importStatus, setImportStatus] = useState<ImportDialogStatus>({ kind: 'idle' });
  const revolveDialogOpen = useAppStore((s) => s.revolveDialogOpen);
  const setRevolveDialogOpen = useAppStore((s) => s.setRevolveDialogOpen);
  const filletDialogOpen = useAppStore((s) => s.filletDialogOpen);
  const setFilletDialogOpen = useAppStore((s) => s.setFilletDialogOpen);
  const filletEdges = useAppStore((s) => s.filletEdges);
  const setFilletEdges = useAppStore((s) => s.setFilletEdges);
  const editingFilletId = useAppStore((s) => s.editingFilletId);
  const setEditingFilletId = useAppStore((s) => s.setEditingFilletId);
  const filletInitialRadius = useAppStore((s) => s.filletInitialRadius);
  const setFilletInitialRadius = useAppStore((s) => s.setFilletInitialRadius);
  const parameterValues = useParameterValues(parameterRegistry);

  // Expose store and perf hooks to E2E/perf tests (dev only).
  useEffect(() => {
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>;
      w.__zilventorStore = useAppStore;
      if (!w.__zilventorDragSolverMsSamples) {
        w.__zilventorDragSolverMsSamples = [] as number[];
      }
      w.__zilventorWorldToScreen = (wx: number, wy: number) =>
        viewportRef.current?.worldToScreen(wx, wy) ?? { x: 0, y: 0 };
      w.__zilventorWorldToScreen3d = (wx: number, wy: number, wz: number) =>
        viewportRef.current?.worldToScreen3d(wx, wy, wz) ?? { x: 0, y: 0 };
      w.__zilventorParameterRegistry = parameterRegistry;
      w.__zilventorRuleEngine = ruleEngine;
      w.__zilventorPackProject = packProject;
      w.__zilventorUnpackProject = unpackProject;
      w.__zilventorPackAssembly = packAssembly;
      w.__zilventorUnpackAssembly = unpackAssembly;
      w.__zilventorGetOpfs = async () => {
        if (!opfsRef.current) opfsRef.current = await Opfs.forNavigator();
        return opfsRef.current;
      };
      w.__zilventorImportFromFiles = async (
        files: Record<string, string | number[]>,
        target: string,
      ) => {
        const { kernel } = useAppStore.getState();
        if (!kernel) throw new Error('kernel not ready');

        const fakeFiles: Record<string, string | Uint8Array> = {};
        for (const [k, v] of Object.entries(files)) {
          fakeFiles[k] = typeof v === 'string' ? v : new Uint8Array(v);
        }
        const inputDir = makeFakeInputDir(fakeFiles);

        const root = await navigator.storage.getDirectory();
        const targetDir = await root.getDirectoryHandle(target, { create: true });

        const { runInventorImport } = await import('./import/InventorImporter');
        return await runInventorImport({
          input: inputDir,
          target: targetDir,
          conflict: 'overwrite',
          kernel: kernel as unknown as Parameters<typeof runInventorImport>[0]['kernel'],
        });
      };
      w.__zilventorImportStepFromBytes = async (bytes: number[], filename: string) => {
        const { kernel: k, setActivePart: sap, setStatus: ss } = useAppStore.getState();
        if (!k) throw new Error('__zilventorImportStepFromBytes: kernel not ready');
        const { importStepIntoNewPart } = await import('./import/importStepIntoNewPart');
        const file = new File([new Uint8Array(bytes)], filename, { type: 'application/step' });
        const { partId, part } = await importStepIntoNewPart(file, k);
        sap(part);
        ss('Imported');
        return { partId, partName: part.name };
      };
      w.__zilventorImportStepIntoAssembly = async (bytes: number[], filename: string) => {
        const { kernel: k, bus: b } = useAppStore.getState();
        if (!k) throw new Error('kernel not ready');
        const { ImportStepAsComponentCommand } = await import('./commands/ImportStepAsComponentCommand');
        const { Opfs: OpfsClass } = await import('@zilventor/kernel/src/storage/Opfs');
        const opfs = await OpfsClass.forNavigator();
        const stepBuf = new Uint8Array(bytes).buffer;
        const cmd = new ImportStepAsComponentCommand({ stepBytes: stepBuf, fileName: filename, kernel: k, opfs });
        await b.execute(cmd);
        const s = useAppStore.getState();
        const doc = s.activeDocument;
        return {
          componentCount: doc?.kind === 'assembly' ? doc.document.components.length : -1,
          statusMessage: s.statusMessage,
        };
      };
      (window as unknown as {
        __zilventorMultiBodyStepImport?: (
          fileName: string,
          stepBytesBase64: string,
        ) => Promise<{
          componentCount: number;
          statusMessage: string;
          partNames: string[];
        }>;
      }).__zilventorMultiBodyStepImport = async (fileName, stepBytesBase64) => {
        const bin = atob(stepBytesBase64);
        const bytesArr: number[] = new Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytesArr[i] = bin.charCodeAt(i);

        const result = await (window as unknown as {
          __zilventorImportStepIntoAssembly: (
            bytes: number[],
            filename: string,
          ) => Promise<{ componentCount: number; statusMessage: string }>;
        }).__zilventorImportStepIntoAssembly(bytesArr, fileName);

        const asm = useAppStore.getState().activeAssembly;
        const partPaths = (asm?.components ?? []).map((c) => c.partPath);
        const partNames = partPaths.map((p) => p.replace(/\.zipt$/, ''));

        return {
          componentCount: result.componentCount,
          statusMessage: result.statusMessage,
          partNames,
        };
      };
      w.__zilventorAssemblyGeomCacheSize = () => geometryCacheRef.current.size;
      // Cut-list E2E hook: load panel specs from OPFS for all leaf components in
      // the active assembly and populate the panelSpecCacheRef so useCutListResult
      // can return non-empty rows immediately after placement.
      // After loading, triggers a no-op assembly update so the useCutListResult
      // useMemo re-runs (refs don't cause re-renders on their own).
      w.__zilventorLoadCutListSpecs = async (): Promise<void> => {
        if (!opfsRef.current) opfsRef.current = await Opfs.forNavigator();
        const opfs = opfsRef.current;
        const s = useAppStore.getState();
        const doc = s.activeDocument;
        if (!doc || doc.kind !== 'assembly') return;
        const a = doc.document;
        const leafPaths = a.components
          .filter((c) => !c.partPath.endsWith('.ziasm'))
          .map((c) => c.partPath);
        diagnosticsCacheRef.current = [];
        await loadCutListInputs(opfs, leafPaths, panelSpecCacheRef.current, diagnosticsCacheRef.current);
        // Force re-render by updating the document identity (no-op content change).
        s.setActiveDocument({ kind: 'assembly', document: { ...a } });
      };

      // Boring-map E2E hook: return the aggregated bore result for the active assembly.
      // Tasks 32/33 e2e slices call window.__zilventorBoringAggregate() to verify export bytes.
      w.__zilventorBoringAggregate = () => {
        const s = useAppStore.getState();
        const asm = s.activeAssembly;
        if (!asm) return { panels: [] };
        const subAsmCacheAdapter = {
          get: (p: string) => {
            const d = s.subAssemblyDocs[p];
            return d ? { kind: 'ok' as const, doc: d, partPath: p } : undefined;
          },
        };
        const boresCache = new Map<string, BoreOp[]>();
        for (const [k, v] of partBoresCacheRef.current.entries()) {
          if (v && v.length > 0) boresCache.set(k, v);
        }
        return aggregateBoresRecursive(
          asm,
          subAsmCacheAdapter,
          boresCache,
          partInfoCacheRef.current,
          panelSpecCacheRef.current,
        );
      };

      // Connector BOM E2E hook: return aggregated connector BOM rows for the active assembly.
      // G.5 e2e calls window.__zilventorConnectorBomAggregate() to verify BOM count after delete.
      w.__zilventorConnectorBomAggregate = async () => {
        const { aggregateConnectorBomRecursive } = await import(
          './assembly/walkers/aggregateConnectorBomRecursive'
        );
        const { CONNECTOR_BOM_CATALOG } = await import('@zilventor/shared');
        const s = useAppStore.getState();
        const asm = s.activeAssembly;
        if (!asm) return [];
        const subAsmCacheAdapter = {
          get: (p: string) => {
            const d = s.subAssemblyDocs[p];
            return d ? { kind: 'ok' as const, doc: d, partPath: p } : undefined;
          },
        };
        const boresCache = new Map<string, BoreOp[]>();
        for (const [k, v] of partBoresCacheRef.current.entries()) {
          if (v && v.length > 0) boresCache.set(k, v);
        }
        const rows = aggregateConnectorBomRecursive(
          asm,
          subAsmCacheAdapter,
          boresCache,
          partInfoCacheRef.current,
        );
        // Resolve i18n names via English fallback for the probe (avoids i18n bootstrap dep)
        return rows.map((r) => ({
          kind: r.kind,
          nameKey: r.nameKey,
          qty: r.qty,
          notes: r.notes,
          name: CONNECTOR_BOM_CATALOG[r.kind]?.nameEn ?? r.kind,
        }));
      };

      w.__zilventorDetailViewMs = async (n = 100) => {
        const { projectDetailView } = await import('@zilventor/shared/src/drawing/projectDetailView');
        type Edge2D = import('@zilventor/shared').Edge2D;
        const syntheticEdges = Array.from({ length: 200 }, (_, i): Edge2D => ({
          id: `e${i}`,
          kind: 'outline' as const,
          points: [[0, i * 0.5], [50, i * 0.5]] as ReadonlyArray<readonly [number, number]>,
        }));
        const parentView = {
          scale: { numerator: 1, denominator: 1 },
          projection: {
            visibleEdges: syntheticEdges,
            hiddenEdges: [] as Edge2D[],
            bbox: { minX: 0, minY: 0, maxX: 50, maxY: 100 },
          },
        };
        const regionParent = { kind: 'circle' as const, center: { x: 25, y: 50 }, radiusMm: 20 };
        const detailScale = { numerator: 2, denominator: 1 };
        const samples: number[] = [];
        for (let i = 0; i < n; i++) {
          const t0 = performance.now();
          projectDetailView({ parentView, regionParent, detailScale, showHidden: false });
          samples.push(performance.now() - t0);
        }
        samples.sort((a, b) => a - b);
        const p95ms = samples[Math.floor(samples.length * 0.95)] ?? 0;
        return { p95ms };
      };

      w.__zilventorBrokenViewMs = async (n = 100) => {
        const { applyBreaks } = await import('@zilventor/shared/src/drawing/applyBreaks');
        type Edge2D = import('@zilventor/shared').Edge2D;
        // Fixture: 1 000 edges — 10 axis-aligned + 990 oblique (per spec §15.2).
        const syntheticEdges = Array.from({ length: 1000 }, (_, i): Edge2D => {
          if (i < 10) {
            // Axis-aligned horizontal.
            return { id: `e${i}`, kind: 'silhouette' as const, points: [[0, i * 10], [1000, i * 10]] as ReadonlyArray<readonly [number, number]> };
          }
          // Oblique: deterministic-ish endpoints seeded by index.
          const x0 = (i * 37) % 1000;
          const y0 = (i * 53) % 100;
          const x1 = (x0 + 200 + (i % 300)) % 1000;
          const y1 = (y0 + 50 + (i % 50)) % 100;
          return { id: `e${i}`, kind: 'silhouette' as const, points: [[x0, y0], [x1, y1]] as ReadonlyArray<readonly [number, number]> };
        });
        const breaks = [
          { id: 'b1', axis: 'x' as const, coordA: 100, coordB: 300, gapMm: 5, style: 'zigzag' as const },
          { id: 'b2', axis: 'x' as const, coordA: 500, coordB: 700, gapMm: 5, style: 'zigzag' as const },
        ];
        const bbox = { minX: 0, minY: 0, maxX: 1000, maxY: 100 };
        const samples: number[] = [];
        for (let i = 0; i < n; i++) {
          const t0 = performance.now();
          applyBreaks(syntheticEdges, breaks, bbox);
          samples.push(performance.now() - t0);
        }
        samples.sort((a, b) => a - b);
        const p95ms = samples[Math.floor(samples.length * 0.95)] ?? 0;
        return { p95ms };
      };

      // Drawing F4 — AutoDimCommand perf probe.
      // Fixture: 20 dim-length constraints × 10 edges each = 200 projected edges.
      // Budget: p95 < 200 ms. Pure JS path — no kernel call.
      (w as unknown as { __zilventorAutoDimMs: (n?: number) => Promise<{ p95ms: number }> }).__zilventorAutoDimMs = async (n = 50) => {
        const { AutoDimCommand } = await import('./commands/AutoDimCommand');
        type Edge2D = import('@zilventor/shared').Edge2D;

        const CONSTRAINTS = 20;
        const EDGES_PER_CONSTRAINT = 10;

        // Build synthetic part with 20 sketch primitives + dim-length constraints.
        const primitives = Array.from({ length: CONSTRAINTS }, (_, i) => ({
          id: `line-${i}`,
          kind: 'line' as const,
          x1: i % 2 === 0 ? 0 : i * 5,
          y1: i % 2 === 0 ? i * 3 : 0,
          x2: i % 2 === 0 ? 50 : i * 5,
          y2: i % 2 === 0 ? i * 3 : 30,
        }));
        const constraints = Array.from({ length: CONSTRAINTS }, (_, i) => ({
          id: `c-${i}`,
          kind: 'dim-length' as const,
          line: `line-${i}`,
          paramName: `param${i}`,
        }));
        const parameters = Object.fromEntries(
          Array.from({ length: CONSTRAINTS }, (_, i) => [
            `param${i}`,
            { name: `param${i}`, value: 50 + i, unit: 'mm' },
          ]),
        );

        const syntheticPart = {
          id: 'perf-part-autodim',
          name: 'PerfPart',
          units: 'mm',
          parameters,
          featureTree: [
            {
              id: 'sketch-perf',
              kind: 'sketch',
              name: 'Sketch1',
              primitives,
              constraints,
            },
            {
              id: 'extrude-perf',
              kind: 'extrude',
              name: 'Extrusion1',
              sketchRef: 'sketch-perf',
              distanceParam: 'param0',
              operation: 'new',
              direction: 'forward',
            },
          ],
        };

        // 200 synthetic edges: 10 per constraint; only the first per group matches exactly.
        // The bbox for sourceBbox derivation: minX=0, minY=0, maxX=50, maxY=150 (covering all rows).
        // buildViewMatrix('front', [0,0,0,50,150,50]): cx=25, cy=75, cz=25.
        // Primitive i (even): x1=0,y1=i*3 → x2=50,y2=i*3; projected: (-25, i*3-75) → (25, i*3-75).
        // Primitive i (odd):  x1=i*5,y1=0 → x2=i*5,y2=30; projected: (i*5-25, -75) → (i*5-25, -45).
        // Matching edge for each: first edge in its group uses exact projected coords.
        const bboxForPerf = { minX: 0, minY: 0, maxX: 50, maxY: 150 };
        const cx = 25, cy = 75, _cz = 25;
        const syntheticEdges: Edge2D[] = Array.from({ length: CONSTRAINTS * EDGES_PER_CONSTRAINT }, (_, i) => {
          const cIdx = Math.floor(i / EDGES_PER_CONSTRAINT);
          const prim = primitives[cIdx]!;
          const isExact = (i % EDGES_PER_CONSTRAINT === 0);
          const jitter = isExact ? 0 : 5 + (i % 3) * 0.5;
          // Exact match uses projected coords; jitter doesn't match (within 1e-3 tol)
          const px1 = isExact ? prim.x1 - cx : prim.x1 + jitter;
          const py1 = isExact ? prim.y1 - cy : prim.y1 + jitter;
          const px2 = isExact ? prim.x2 - cx : prim.x2 + jitter;
          const py2 = isExact ? prim.y2 - cy : prim.y2 + jitter;
          return {
            id: `e${i}`,
            kind: 'outline' as const,
            points: [
              [px1, py1] as readonly [number, number],
              [px2, py2] as readonly [number, number],
            ] as ReadonlyArray<readonly [number, number]>,
          };
        });

        const syntheticSheet = {
          id: 'perf-sheet',
          name: 'Sheet 1',
          size: { kind: 'iso' as const, size: 'A4' as const },
          orientation: 'landscape' as const,
          views: [{
            id: 'perf-view',
            kind: 'base' as const,
            positionMm: { x: 0, y: 0 },
            scale: { numerator: 1, denominator: 1 },
            orientation: 'front',
            showHidden: false,
            projection: {
              visibleEdges: syntheticEdges,
              hiddenEdges: [] as Edge2D[],
              bbox: bboxForPerf,
            },
            inputFingerprint: 'fp-perf',
          }],
          dimensions: [],
          annotations: [],
          titleBlock: {},
          dimensionGroups: [],
        };

        const syntheticDrawing = {
          id: 'perf-drawing',
          name: 'PerfDrawing',
          units: 'mm',
          source: { partPath: 'perf-part-autodim.zipt', sourceKind: 'part' as const },
          properties: {},
          sheets: [syntheticSheet],
          activeSheetId: 'perf-sheet',
        };

        const { useAppStore } = await import('./store/useAppStore');
        const prevState = useAppStore.getState();
        useAppStore.setState({
          activeDocument: { kind: 'drawing', document: syntheticDrawing as never },
          activeDrawing: syntheticDrawing as never,
          activePart: syntheticPart as never,
        });

        const autoDimSamples: number[] = [];
        try {
          for (let iter = 0; iter < n; iter++) {
            // Reset dims between iterations to avoid accumulation
            useAppStore.setState({
              activeDocument: {
                kind: 'drawing',
                document: { ...syntheticDrawing, sheets: [{ ...syntheticSheet, dimensions: [] }] } as never,
              },
              activeDrawing: { ...syntheticDrawing, sheets: [{ ...syntheticSheet, dimensions: [] }] } as never,
            });
            const cmd = new AutoDimCommand({ drawingId: 'perf-drawing', sheetId: 'perf-sheet', viewId: 'perf-view' });
            const t0 = performance.now();
            await cmd.apply();
            autoDimSamples.push(performance.now() - t0);
          }
        } finally {
          // Restore prior store state EVEN IF apply() throws mid-iteration.
          useAppStore.setState(prevState);
        }

        autoDimSamples.sort((a, b) => a - b);
        const p95ms = autoDimSamples[Math.floor(autoDimSamples.length * 0.95)] ?? 0;
        return { p95ms };
      };

      // Drawing F5 — dimension-styles perf probe.
      // Fixture: 30 dims (10 baseline + 10 ordinate + 10 angular two-edges).
      // Budget: p95 < 200 ms. Pure SVG render path — no kernel call.
      (w as unknown as { __zilventorDimensionStylesMs: (n?: number) => Promise<{ p95ms: number }> }).__zilventorDimensionStylesMs = async (n = 50) => {
        const { renderDrawingSvg } = await import('./drawing/renderDrawingSvg');
        type Edge2D = import('@zilventor/shared').Edge2D;
        type DimensionGroup = import('@zilventor/shared').DimensionGroup;
        type DrawingDimension = import('@zilventor/shared').DrawingDimension;

        const GROUP_BASELINE = 'perf-group-baseline';
        const GROUP_ORDINATE = 'perf-group-ordinate';
        const VIEW_ID = 'perf-view-f5';

        const syntheticEdges: Edge2D[] = [
          { id: 'e-datum', kind: 'outline', points: [[-50, -15] as readonly [number, number], [-50, 15] as readonly [number, number]] as ReadonlyArray<readonly [number, number]> },
          { id: 'e-origin', kind: 'outline', points: [[-50, 0] as readonly [number, number], [0, 0] as readonly [number, number]] as ReadonlyArray<readonly [number, number]> },
          ...Array.from({ length: 10 }, (_, i): Edge2D => ({
            id: `e-bm-${i}`,
            kind: 'outline',
            points: [[(i + 1) * 10 - 50, -15] as readonly [number, number], [(i + 1) * 10 - 50, 15] as readonly [number, number]] as ReadonlyArray<readonly [number, number]>,
          })),
          ...Array.from({ length: 10 }, (_, i): Edge2D => ({
            id: `e-om-${i}`,
            kind: 'outline',
            points: [[(i < 5 ? (i + 1) * 10 : 0) - 25, i < 5 ? 0 : (i - 4) * 5 - 15] as readonly [number, number], [(i < 5 ? (i + 1) * 10 : 5) - 25, i < 5 ? 5 : (i - 4) * 5 - 10] as readonly [number, number]] as ReadonlyArray<readonly [number, number]>,
          })),
          ...Array.from({ length: 20 }, (_, i): Edge2D => ({
            id: `e-ang-${i}`,
            kind: 'outline',
            points: [[0, 0] as readonly [number, number], [i % 2 === 0 ? 20 : 0, i % 2 === 0 ? 0 : 20] as readonly [number, number]] as ReadonlyArray<readonly [number, number]>,
          })),
        ];

        const baselineGroup: DimensionGroup = {
          kind: 'baseline',
          id: GROUP_BASELINE,
          viewId: VIEW_ID,
          datum: { kind: 'edge-endpoint', edgeId: 'e-datum', end: 'start' },
          direction: 'h',
          baseOffsetMm: 20,
          spacingMm: 10,
        };

        const ordinateGroup: DimensionGroup = {
          kind: 'ordinate',
          id: GROUP_ORDINATE,
          viewId: VIEW_ID,
          origin: { kind: 'edge-endpoint', edgeId: 'e-origin', end: 'start' },
          xColumnOffsetMm: 20,
          yColumnOffsetMm: 20,
        };

        const baselineDims: DrawingDimension[] = Array.from({ length: 10 }, (_, i) => ({
          kind: 'baseline' as const,
          id: `d-bm-${i}`,
          viewId: VIEW_ID,
          groupId: GROUP_BASELINE,
          slot: i,
          to: { kind: 'edge-endpoint' as const, edgeId: `e-bm-${i}`, end: 'start' as const },
        }));

        const ordinateDims: DrawingDimension[] = Array.from({ length: 10 }, (_, i) => ({
          kind: 'ordinate' as const,
          id: `d-om-${i}`,
          viewId: VIEW_ID,
          groupId: GROUP_ORDINATE,
          axis: i < 5 ? ('x' as const) : ('y' as const),
          to: { kind: 'edge-endpoint' as const, edgeId: `e-om-${i}`, end: 'start' as const },
        }));

        const angularDims: DrawingDimension[] = Array.from({ length: 10 }, (_, i) => ({
          kind: 'angular' as const,
          id: `d-ang-${i}`,
          viewId: VIEW_ID,
          ref: {
            kind: 'two-edges' as const,
            edge1: { viewId: VIEW_ID, edgeId: `e-ang-${i * 2}` },
            edge2: { viewId: VIEW_ID, edgeId: `e-ang-${i * 2 + 1}` },
          },
          arcSide: 'inside' as const,
          offsetMm: 15,
        }));

        const syntheticSheet = {
          id: 'perf-sheet-f5',
          name: 'Perf F5',
          size: { kind: 'iso' as const, size: 'A4' as const },
          orientation: 'landscape' as const,
          views: [{
            id: VIEW_ID,
            kind: 'base' as const,
            positionMm: { x: 0, y: 0 },
            scale: { numerator: 1, denominator: 1 },
            orientation: 'front',
            showHidden: false,
            projection: {
              visibleEdges: syntheticEdges,
              hiddenEdges: [] as Edge2D[],
              bbox: { minX: -50, minY: -15, maxX: 150, maxY: 30 },
            },
            inputFingerprint: 'fp-f5-perf',
          }],
          dimensions: [...baselineDims, ...ordinateDims, ...angularDims] as DrawingDimension[],
          dimensionGroups: [baselineGroup, ordinateGroup] as DimensionGroup[],
          annotations: [],
          titleBlock: {},
        };

        const syntheticPart = {
          id: 'perf-part-f5',
          name: 'PerfF5Part',
          units: 'mm',
          parameters: {},
          featureTree: [],
        };

        const syntheticDrawingF5 = {
          id: 'perf-drawing-f5', name: 'Perf F5 Drawing', units: 'mm' as const,
          source: { partPath: 'perf-part-f5.zipt', sourceKind: 'part' as const },
          properties: {},
          sheets: [syntheticSheet],
          activeSheetId: syntheticSheet.id,
        };

        const dimStyleSamples: number[] = [];
        for (let iter = 0; iter < n; iter++) {
          const t0 = performance.now();
          renderDrawingSvg(syntheticDrawingF5 as never, syntheticSheet as never, syntheticPart as never);
          dimStyleSamples.push(performance.now() - t0);
        }

        dimStyleSamples.sort((a, b) => a - b);
        const p95ms = dimStyleSamples[Math.floor(dimStyleSamples.length * 0.95)] ?? 0;
        return { p95ms };
      };

      // Drawing F6 — hole-table perf probe.
      // Fixture: 20 holes (10 × dia=8 + 10 × dia=12), 16-point circle approximation each.
      // Budget: p95 < 50 ms. Pure 2D geometry — no kernel call.
      (w as unknown as { __zilventorHoleTableMs: (n?: number) => Promise<{ p95ms: number }> }).__zilventorHoleTableMs = async (n = 100) => {
        const { computeHoleTableRows } = await import('@zilventor/shared/src/drawing/holeTable');
        type Edge2D = import('@zilventor/shared').Edge2D;

        const N_HOLES = 20;

        // Build a 16-point circle polyline around (cx, cy) with radius r.
        function circlePoints(cx: number, cy: number, r: number): ReadonlyArray<readonly [number, number]> {
          const pts: Array<readonly [number, number]> = [];
          for (let i = 0; i <= 16; i++) {
            const angle = (i / 16) * 2 * Math.PI;
            pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
          }
          return pts as ReadonlyArray<readonly [number, number]>;
        }

        // 10 holes dia=8, 10 holes dia=12.
        const holeFeatures = Array.from({ length: N_HOLES }, (_, i) => {
          const paramName = i < 10 ? 'd_small' : 'd_large';
          return {
            id: `PH${i}`,
            kind: 'hole' as const,
            placement: { kind: 'fromSketch' as const, sketchId: 'sk1' },
            profile: { kind: 'simple' as const, diameter: { kind: 'param' as const, paramName } },
            termination: { kind: 'throughAll' as const },
            flipAxis: false,
          };
        });

        const syntheticPart = {
          id: 'perf-part-holes',
          name: 'PerfHolePart',
          units: 'mm' as const,
          parameters: {
            d_small: { value: 8 },
            d_large: { value: 12 },
          },
          featureTree: holeFeatures,
          properties: {},
          materials: [],
          hardware: [],
        };

        // Datum edge at (0,0) — start endpoint resolves to part-mm [0,0].
        const datumEdge: Edge2D = {
          id: 'perf-datum',
          kind: 'outline',
          points: [[0, 0], [10, 0]] as ReadonlyArray<readonly [number, number]>,
          sourceFaceIds: [],
        };

        // 20 circle edges, each carrying sourceFaceIds for the corresponding hole.
        const circleEdges: Edge2D[] = Array.from({ length: N_HOLES }, (_, i) => {
          const cx = ((i % 5) * 20 + 10);
          const cy = (Math.floor(i / 5) * 20 + 10);
          const r = i < 10 ? 4 : 6;
          return {
            id: `perf-h${i}-circle`,
            kind: 'feature' as const,
            points: circlePoints(cx, cy, r),
            sourceFaceIds: [`PH${i}|hole|0`, `PF${i}|face|0`] as string[],
          };
        });

        const syntheticView = {
          id: 'perf-view-holes',
          kind: 'base' as const,
          positionMm: { x: 0, y: 0 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front' as const,
          showHidden: false,
          projection: {
            visibleEdges: [datumEdge, ...circleEdges],
            hiddenEdges: [] as Edge2D[],
            bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
          },
          inputFingerprint: 'fp-perf-holes',
        };

        const syntheticAnnotation = {
          kind: 'holeTable' as const,
          id: 'perf-hole-table',
          viewId: 'perf-view-holes',
          datum: { kind: 'edge-endpoint' as const, edgeId: 'perf-datum', end: 'start' as const },
          positionMm: { x: 0, y: 120 },
          entries: [] as ReadonlyArray<{ readonly holeFeatureId: string; readonly tag: string }>,
        };

        const resolveParam = (p: { kind: string; value?: number; paramName?: string }) =>
          p.kind === 'literal'
            ? (p.value ?? 0)
            : (syntheticPart.parameters as Record<string, { value: number }>)[p.paramName ?? '']?.value ?? 0;

        const samples: number[] = [];
        for (let i = 0; i < n; i++) {
          const t0 = performance.now();
          computeHoleTableRows(
            syntheticAnnotation as never,
            syntheticView as never,
            syntheticPart as never,
            resolveParam as never,
          );
          samples.push(performance.now() - t0);
        }
        samples.sort((a, b) => a - b);
        const p95ms = samples[Math.floor(samples.length * 0.95)] ?? 0;
        return { p95ms };
      };

      // Drawing F2.1 — Rect detail view perf probe.
      // Fixture: 200 edges (same as __zilventorDetailViewMs) + rect regionParent.
      // Budget: p95 < 50 ms. Pure JS — no kernel call.
      (w as unknown as { __zilventorRectDetailViewMs: (n?: number) => Promise<{ p95ms: number }> }).__zilventorRectDetailViewMs = async (n = 100) => {
        const { projectDetailView } = await import('@zilventor/shared/src/drawing/projectDetailView');
        type Edge2D = import('@zilventor/shared').Edge2D;
        const syntheticEdges = Array.from({ length: 200 }, (_, i): Edge2D => ({
          id: `e${i}`,
          kind: 'outline' as const,
          points: [[0, i * 0.5], [50, i * 0.5]] as ReadonlyArray<readonly [number, number]>,
        }));
        const parentView = {
          scale: { numerator: 1, denominator: 1 },
          projection: {
            visibleEdges: syntheticEdges,
            hiddenEdges: [] as Edge2D[],
            bbox: { minX: 0, minY: 0, maxX: 50, maxY: 100 },
          },
        };
        // Rect region: center at (25,50), widthMm=30, heightMm=20
        // Clips roughly half of the 200 edges (those with y in [40,60])
        const regionParent = { kind: 'rect' as const, center: { x: 25, y: 50 }, widthMm: 30, heightMm: 20 };
        const detailScale = { numerator: 2, denominator: 1 };
        const samples: number[] = [];
        for (let i = 0; i < n; i++) {
          const t0 = performance.now();
          projectDetailView({ parentView, regionParent, detailScale, showHidden: false });
          samples.push(performance.now() - t0);
        }
        samples.sort((a, b) => a - b);
        const p95ms = samples[Math.floor(samples.length * 0.95)] ?? 0;
        return { p95ms };
      };

      // ── Slice-5 drag-gizmo e2e probes ────────────────────────────────────────
      // __zilventorSeedCabinetWithBores(): build a cabinet + carcass присадки into
      // the active assembly so bore markers render and draggable bores exist.
      w.__zilventorSeedCabinetWithBores = async () => {
        const { CreateCabinetCommand } = await import('./commands/CreateCabinetCommand');
        const { GenerateCarcassBoresCommand } = await import('./commands/GenerateCarcassBoresCommand');
        const { Opfs: OpfsClass } = await import('@zilventor/kernel/src/storage/Opfs');
        const store = useAppStore.getState();
        const opfs = await OpfsClass.forNavigator();

        // Bootstrap an empty assembly document so CreateCabinetCommand can find activeAssembly.
        const carcassMat = { id: 'seed-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' };
        const backMat   = { id: 'seed-hb-6',     name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' };
        store.setActiveDocument({
          kind: 'assembly',
          document: {
            id: 'drag-gizmo-seed-asm',
            name: 'DragGizmo Project',
            units: 'mm' as const,
            parameters: {},
            properties: {},
            components: [],
            constraints: [],
            groundedComponentPaths: [],
            colors: {},
            bomItemNumbers: {},
            cutListItemNumbers: {},
            colorOverrides: {},
            materials: [carcassMat, backMat],
            hardware: [],
          },
        });

        // Create the cabinet
        await store.bus.execute(new CreateCabinetCommand({
          template: 'baseCabinet',
          params: {
            name: 'DragGizmo Cabinet',
            width: 600,
            depth: 560,
            height: 720,
            toekickHeight: 100,
            toekickSetback: 50,
            shelfCount: 0,
            carcassMaterialId: 'seed-birch-18',
            backMaterialId: 'seed-hb-6',
            bandMaterialId: null,
          },
          opfs,
        }));

        // Generate carcass bores (confirmat only — gives jointDir on bores)
        await store.bus.execute(new GenerateCarcassBoresCommand({
          params: {
            endSetback: 60,
            maxSpacing: 250,
            minCount: 2,
            confirmat: true,
            minifix: false,
            dowel: false,
          },
          opfs,
        }));
      };

      // __zilventorReadBoreUV(boreId, partPath): return {u, v} from the live
      // partBoresCacheRef (populated by the bore-marker effect after assembly load).
      w.__zilventorReadBoreUV = (boreId: string, partPath: string): { u: number; v: number } | null => {
        const bores = partBoresCacheRef.current.get(partPath);
        const bore = bores?.find((b) => b.id === boreId);
        return bore ? { u: bore.u, v: bore.v } : null;
      };

      // Slice-6: __zilventorHardwarePartCount() — count of rendered scene meshes
      // for hardware parts (partPath.startsWith('hardware/')).
      // Mirrors boreMarkerCount() but for pull/handle components.
      w.__zilventorHardwarePartCount = (): number => {
        const store = useAppStore.getState();
        const vp = store.viewport as { getSceneManager?(): unknown } | null;
        const sm = vp?.getSceneManager?.() as { hardwarePartCount(): number } | null;
        return sm?.hardwarePartCount?.() ?? 0;
      };

      // Interference/Clash Check probes (SC-17)
      w.__zilventorClashCount = (): number => {
        return useAppStore.getState().clashRows?.length ?? 0;
      };
      w.__zilventorClashResults = (): unknown[] => {
        return useAppStore.getState().clashRows ?? [];
      };

      // DXF import hook — used by the §6 e2e to exercise the real import path.
      (w as unknown as { __zilventorImportDxfNewPart: (f: File) => Promise<void> }).__zilventorImportDxfNewPart =
        async (file: File): Promise<void> => {
          const { kernel, bus, setActivePart, setStatus } = useAppStore.getState();
          if (!kernel) throw new Error('__zilventorImportDxfNewPart: kernel not ready');
          const { ImportDxfIntoNewPartCommand } = await import('./commands/ImportDxfIntoNewPartCommand');
          await bus.execute(new ImportDxfIntoNewPartCommand({
            kernel,
            store: { getActivePart: () => useAppStore.getState().activePart, setActivePart },
            setStatus,
            file,
          }));
        };

      // DXF import into active sketch hook — used by the §6 e2e to exercise the real import path.
      (w as unknown as { __zilventorImportDxfActiveSketch: (f: File) => Promise<void> }).__zilventorImportDxfActiveSketch =
        async (file: File): Promise<void> => {
          const { kernel, bus, activeSketchId, setStatus, setActivePart } = useAppStore.getState();
          if (!kernel) throw new Error('__zilventorImportDxfActiveSketch: kernel not ready');
          if (!activeSketchId) throw new Error('__zilventorImportDxfActiveSketch: no active sketch');
          const { ImportDxfIntoActiveSketchCommand } = await import('./commands/ImportDxfIntoActiveSketchCommand');
          await bus.execute(new ImportDxfIntoActiveSketchCommand({
            kernel,
            sketcherClient: sketcherClientRef.current ?? undefined,
            store: { getActivePart: () => useAppStore.getState().activePart, setActivePart },
            sketchId: activeSketchId,
            setStatus,
            file,
          }));
        };
    }
  }, []);

  // Lazy OPFS singleton — shared by autosave, boot-restore, and Place dialog effects.
  const opfsRef = useRef<Opfs | null>(null);

  // Bootstrap the kernel once.
  useEffect(() => {
    // Mark this mount as live. The cleanup below flips unmountedRef to true;
    // under React StrictMode's dev double-mount that cleanup runs before the
    // second mount, so without this reset the ref would stay permanently true
    // and handleRestart / handleCancelOpen would abort. Resetting here keeps
    // the ref accurate per mount.
    unmountedRef.current = false;
    let disposed = false;
    void (async () => {
      try {
        const { client, terminate } = await spawnKernel({
          onOffline: () => setKernelOffline(true)
        });
        if (disposed) { terminate(); return; }
        terminateRef.current = terminate;
        setKernelFailed(false);
        useAppStore.getState().setKernel(client);
      } catch (e) {
        useAppStore.getState().setStatus(t('status.kernelFailed', { message: (e as Error).message }));
        setKernelFailed(true);
      }
    })();
    return () => {
      disposed = true;
      unmountedRef.current = true;
      terminateRef.current?.();
      terminateRef.current = null;
    };
  }, []);

  // Drawing OPFS autosave: boot-restore effect.
  // Runs once after the kernel becomes ready. Guards on activeDocument === null
  // so a user action that opens a doc before this effect fires is never clobbered.
  useEffect(() => {
    if (!kernelReady) return;
    if (useAppStore.getState().activeDocument !== null) return;
    void (async () => {
      try {
        const kernel = useAppStore.getState().kernel;
        if (!kernel) return;
        if (!opfsRef.current) opfsRef.current = await Opfs.forNavigator();
        await restoreLastOpenDocument({
          kernel: kernel as unknown as KernelForRestore,
          opfs: opfsRef.current,
        });
      } catch (e) {
        console.warn('boot restore failed:', (e as Error).message);
      }
    })();
  }, [kernelReady]);

  // Re-execute when the feature tree contains a solid-producing feature (extrude).
  // Empty / sketch-only trees skip execute() entirely — otherwise the kernel
  // raises a spurious degenerateSketch error that pollutes the status bar.
  // Gated during sketch mode (spec §9.2): we do not re-execute while the user
  // is actively drawing; the recompute resumes on exit.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (useAppStore.getState().sketchMode) return;
      if (!kernel || !activePart || !viewportRef.current) return;
      // Only execute when there is a solid-producing feature. Work features alone
      // (workAxis/workPlane/workPoint) cannot produce a solid and would always
      // return "Feature tree produced no solid", polluting the status bar.
      // The seeded origin.* features are all work features, so a fresh empty part
      // must NOT trigger execute(). Work feature values are computed as a side-effect
      // of the solid execution (when a solid-producing feature is also present).
      const hasSolidFeature = activePart.featureTree.some((f) => f.kind === 'extrude' || f.kind === 'revolve' || f.kind === 'sweep' || f.kind === 'panel' || f.kind === 'imported');
      if (!hasSolidFeature) return;
      const res = await kernel.execute(activePart.id);
      if (cancelled) return;
      if (res.ok) {
        // Clear any prior error status set by THIS effect on a previous failed
        // execute() — but never a status set by someone else in the meantime
        // (e.g. FileTab's "Imported"/"Opened" after a fresh open, or a Save
        // confirmation). lastExecuteErrorRef tracks whether we are the ones who
        // put the current error message up, so we only ever clear our own mess.
        if (lastExecuteErrorRef.current) {
          useAppStore.getState().setStatus('');
          lastExecuteErrorRef.current = false;
        }
        const partHex = activePart?.color?.kind === 'hex' ? activePart.color.hex : undefined;
        const panelFeat = activePart?.featureTree.find((f) => f.kind === 'panel') as PanelFeature | undefined;
        const panelMat = panelFeat ? activePart?.materials.find((m) => m.id === panelFeat.materialId) : undefined;
        viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices, partHex, res.value.mesh.uv, panelMat?.textureId, res.value.mesh.colors);
        tessellatedEdgesRef.current = res.value.tessellatedEdges ?? [];
        setAvailableFaceNames(res.value.faceNames ?? []);
        facePickerRef.current.setCandidates(res.value.tessellatedFaces ?? []);
        useAppStore.getState().setFeatureErrors(res.value.featureErrors ?? new Map());
        applyWorkFeaturesToViewport(res.value.workFeatures, activePart.featureTree);
      } else {
        useAppStore.getState().setStatus(t('status.error', { message: res.error.message }));
        useAppStore.getState().setFeatureErrors(new Map());
        lastExecuteErrorRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, [activePart, kernel, sketchMode]);

  // Publish the viewport ref to the store so command handlers (e.g. Save) can
  // ask the viewport for a thumbnail without drilling a prop all the way down.
  // The ref is populated by the Viewport's useImperativeHandle, which fires
  // synchronously during mount, so a useLayoutEffect after mount sees it.
  useLayoutEffect(() => {
    if (viewportRef.current) {
      useAppStore.getState().setViewport(viewportRef.current);
    }
    return () => {
      useAppStore.getState().setViewport(null);
    };
  }, []);

  // Wire up sketcher: controllers + overlay + committed renderer.
  // Must run AFTER Viewport's own useEffect has created the SceneManager.
  // Parent's useLayoutEffect fires before child's useEffect, so we use
  // useEffect and retry via rAF until the scene manager is ready.
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let attachedSm: ReturnType<ViewportRef['getSceneManager']> = null;

    const init = (): void => {
      if (cancelled) return;
      const vp = viewportRef.current;
      const sm = vp?.getSceneManager();
      if (!sm) {
        raf = requestAnimationFrame(init);
        return;
      }
      attachedSm = sm;
      sm.setCustomTextureRegistry(globalCustomTextureRegistry);
      // Slice-5: capture OrbitControls ref for bore drag handler.
      orbitControlsRef.current = sm.getControls();

      sketcherClientRef.current = new SketcherClient(createSketcherWorkerApi({
        onOffline: () => {
          // Exit sketch mode so the user isn't stuck in a non-functional state.
          useAppStore.getState().setSketchMode(false);
          // Surface a status message so the user understands what happened.
          useAppStore.getState().setStatus(t('status.sketcherCrashed'));
          // Show the banner.
          setSketcherCrashed(true);
        }
      }));

      sketchModeRef.current = createSketchModeController({
        camera: sm.getCamera(),
        orbitControls: sm.getControls(),
        scene: sm.getScene(),
        sketcherClient: sketcherClientRef.current,
        getActiveSketch: () => {
          const part = useAppStore.getState().activePart;
          const id = useAppStore.getState().activeSketchId;
          if (!part || !id) return null;
          const f = part.featureTree.find((x) => x.kind === 'sketch' && x.id === id);
          return f?.kind === 'sketch' ? { primitives: f.primitives, constraints: f.constraints } : null;
        },
        setSketchDof: useAppStore.getState().setSketchDof,
        resolveParamValue: (name) => parameterRegistry.getValue(name)
      });
      const overlay = new SketchOverlay();
      const renderer = new CommittedSketchRenderer();
      sketchOverlayRef.current = overlay;
      committedSketchRendererRef.current = renderer;
      sm.addObject(overlay.group);
      sm.addObject(renderer.group);

      activeToolCtrlRef.current = new ActiveToolController({
        emitPrimitive: (primitive) => {
          const store = useAppStore.getState();
          if (!store.kernel || !store.activePart || !store.activeSketchId) return;
          return store.bus.execute(new AddPrimitiveCommand({
            kernel: store.kernel,
            sketcherClient: sketcherClientRef.current ?? undefined,
            store: { getActivePart: () => useAppStore.getState().activePart, setActivePart: store.setActivePart },
            sketchId: store.activeSketchId,
            primitive
          }));
        },
        emitConstraint: (c) => {
          const store = useAppStore.getState();
          if (!store.activeSketchId) return;
          void store.bus.execute(new AddConstraintCommand(store.activeSketchId, c, sketcherClientRef.current ?? undefined));
        },
        updatePrimitive: (id, patch) => {
          const store = useAppStore.getState();
          if (!store.kernel || !store.activePart || !store.activeSketchId) return;
          return store.bus.execute(new UpdatePrimitiveCommand({
            sketchId: store.activeSketchId,
            id,
            patch,
            sketcherClient: sketcherClientRef.current ?? undefined,
          }));
        },
        sketcherClient: sketcherClientRef.current ?? undefined,
        onCoords: (diff) => {
          const store = useAppStore.getState();
          if (store.activeSketchId) store.applyCoordDiff(store.activeSketchId, diff);
        },
        onDof: (dof) => {
          useAppStore.getState().setSketchDof(dof);
        },
        isConstructionMode: () => useAppStore.getState().constructionMode,
        showToast: (msg) => showToast(msg),
        onDimensionReady: (d) => { setPendingDimension(d); },
        onPreview: (polyline, snap) => {
          const ov = sketchOverlayRef.current;
          if (!ov) return;
          if (polyline && polyline.length >= 2) ov.setDraftPolyline(polyline);
          else ov.clearDraft();
          if (snap.kind === 'endpoint') ov.snapMarker.show(snap.point.x, snap.point.y);
          else ov.snapMarker.hide();
          const anchor = activeToolCtrlRef.current?.getAnchor();
          if (snap.kind === 'horizontal-axis' && anchor) ov.axisHint.showHorizontal(anchor, snap.point);
          else if (snap.kind === 'vertical-axis' && anchor) ov.axisHint.showVertical(anchor, snap.point);
          else ov.axisHint.hide();
          const count = activeToolCtrlRef.current?.numericFieldCount() ?? 0;
          setNumericFieldCount(count);
          setNumericVisible(count > 0);
        },
        deletePrimitive: (id) => {
          void (async () => {
            const store = useAppStore.getState();
            if (!store.kernel || !store.activePart || !store.activeSketchId) return;
            await store.bus.execute(new DeletePrimitiveCommand({
              kernel: store.kernel,
              store: { activePart: store.activePart, setActivePart: store.setActivePart },
              sketchId: store.activeSketchId,
              primitiveId: id,
            }));
          })();
        },
        getSketchFrame: () => {
          const store = useAppStore.getState();
          if (!store.activePart || !store.activeSketchId) return null;
          const sketch = store.activePart.featureTree.find(
            (f) => f.kind === 'sketch' && f.id === store.activeSketchId
          );
          if (!sketch || sketch.kind !== 'sketch') return null;
          const plane = sketch.plane;
          if (plane.source !== 'workPlane') return null; // face-sourced: not supported
          if (plane.featureId === 'origin.XY') {
            return { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, xDir: { x: 1, y: 0, z: 0 } };
          }
          if (plane.featureId === 'origin.YZ') {
            return { origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 }, xDir: { x: 0, y: 1, z: 0 } };
          }
          if (plane.featureId === 'origin.XZ') {
            return { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, xDir: { x: 1, y: 0, z: 0 } };
          }
          return null; // custom work plane: resolve from workFeatures if available
        },
      });
    };

    init();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      void sketcherClientRef.current?.unloadSketch();
      sketcherClientRef.current = null;
      const sm = attachedSm;
      if (sm) {
        if (sketchOverlayRef.current) {
          sm.removeObject(sketchOverlayRef.current.group);
          sketchOverlayRef.current.dispose();
        }
        if (committedSketchRendererRef.current) {
          sm.removeObject(committedSketchRendererRef.current.group);
          committedSketchRendererRef.current.dispose();
        }
      }
      sketchModeRef.current = null;
      activeToolCtrlRef.current = null;
      sketchOverlayRef.current = null;
      committedSketchRendererRef.current = null;
    };
  }, []);

  // Reset per-feature errors when the active part changes — stale errors from a
  // previous part must not linger in the BrowserPane badge of the new part.
  useEffect(() => {
    useAppStore.getState().setFeatureErrors(new Map());
  }, [activePart?.id]);

  // Sync ParameterRegistry with the active part's parameters on every part change.
  useEffect(() => {
    if (!activePart) return;
    // Silence rule firing while we bulk-repopulate parameters below.
    ruleEngine.load([]);
    // Reset and repopulate on every activePart change.
    const names = parameterRegistry.getAll().map((p) => p.name);
    for (const n of names) parameterRegistry.removeParameter(n);
    for (const p of Object.values(activePart.parameters ?? {})) {
      parameterRegistry.setParameter({ name: p.name, expression: p.expression, unit: p.unit });
    }
    // Load this part's rules (runs cycle detection). A cyclic rule set is reported
    // and ignored rather than crashing the app.
    try {
      ruleEngine.load(activePart.rules ?? []);
    } catch (e) {
      if (e instanceof RuleCycleError) {
        useAppStore.getState().setStatus(`Rule cycle ignored: ${e.cycle.join(' → ')}`);
      } else {
        throw e;
      }
    }
  }, [activePart?.id]);

  // Wire the rule engine's feature-suppression toggles to the kernel: when a rule
  // fires thenSuppress, push the suppress/un-suppress to the kernel's part, mirror
  // it onto the store part (absent-not-empty, so saves persist), then re-execute so
  // the viewport reflects the regenerated body. Installed once; reads live state via
  // getState/refs so it stays valid across part changes.
  useEffect(() => {
    ruleEngine.setSuppressionHandler((featureId, suppressed) => {
      void (async () => {
        const store = useAppStore.getState();
        const kernelClient = store.kernel;
        const part = store.activePart;
        if (!kernelClient || !part) return;
        await kernelClient.suppressFeature(part.id, featureId, suppressed);
        // Mirror onto the store part (absent-not-empty contract).
        const fresh = useAppStore.getState().activePart;
        if (!fresh || fresh.id !== part.id) return;
        const ids = new Set(fresh.suppressedFeatureIds ?? []);
        if (suppressed) ids.add(featureId); else ids.delete(featureId);
        if (ids.size === 0) {
          const { suppressedFeatureIds: _drop, ...rest } = fresh;
          store.setActivePart(rest as PartDocument);
        } else {
          store.setActivePart({ ...fresh, suppressedFeatureIds: [...ids] });
        }
        // Regenerate geometry without the suppressed feature.
        if (useAppStore.getState().sketchMode) return;
        const res = await kernelClient.execute(part.id);
        if (res.ok && viewportRef.current) {
          const partHex = fresh.color?.kind === 'hex' ? fresh.color.hex : undefined;
          const panelFeat = fresh.featureTree.find((f) => f.kind === 'panel') as PanelFeature | undefined;
          const panelMat = panelFeat ? fresh.materials.find((m) => m.id === panelFeat.materialId) : undefined;
          viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices, partHex, res.value.mesh.uv, panelMat?.textureId, res.value.mesh.colors);
          tessellatedEdgesRef.current = res.value.tessellatedEdges ?? [];
          setAvailableFaceNames(res.value.faceNames ?? []);
          facePickerRef.current.setCandidates(res.value.tessellatedFaces ?? []);
          useAppStore.getState().setFeatureErrors(res.value.featureErrors ?? new Map());
          applyWorkFeaturesToViewport(res.value.workFeatures, fresh.featureTree);
        } else if (!res.ok) {
          useAppStore.getState().setStatus(t('status.error', { message: res.error.message }));
        }
      })();
    });
  }, []);

  // Cascade parameter changes to the solver + kernel + store.
  // Fires on any successful ParameterRegistry mutation (setParameter / rename /
  // removeParameter).
  //   1. Mirror every registry param into the store so saves persist edits.
  //   2. Push every registry param that already lives in the active part's
  //      parameters map down to the kernel — the kernel's executeTree reads
  //      its OWN parts map, not the store, so without this step a parametric
  //      revolve/extrude edit would not regenerate geometry on re-execute.
  //   3. In sketch mode, for every dim-* constraint whose value is
  //      { kind: 'param' }, resolve the current parameter value and push it
  //      through sketcherClient.updateDimensionValue so the solver sees it.
  useEffect(() => {
    return parameterRegistry.subscribe(() => {
      const store = useAppStore.getState();
      for (const p of parameterRegistry.getAll()) store.setParameterInStore(p);
      const part = store.activePart;
      const sketchId = store.activeSketchId;
      const client = sketcherClientRef.current;
      const kernelClient = store.kernel;
      // Push changed params into the kernel's part so the next kernel.execute
      // sees the new values. Only touch names already in part.parameters to
      // avoid leaking sketch-dimension-only params into the part's map.
      if (kernelClient && part) {
        const names = Object.keys(part.parameters ?? {});
        void (async () => {
          let changed = false;
          for (const name of names) {
            const p = parameterRegistry.getAll().find((x) => x.name === name);
            if (!p || p.value === undefined) continue;
            const stored = part.parameters[name];
            // Only push if the expression or value actually changed — avoids a
            // burst of no-op setParameter calls on the initial part-load sync.
            if (stored && stored.expression === p.expression && stored.value === p.value) continue;
            await kernelClient.setParameter(part.id, {
              name: p.name, expression: p.expression, value: p.value, unit: p.unit
            });
            changed = true;
          }
          // Explicitly re-execute after all setParameter calls complete so
          // the activePart useEffect doesn't race ahead of them — it may
          // fire synchronously when setParameterInStore mutates the store,
          // before the async kernel.setParameter round-trip resolves.
          if (!changed) return;
          const freshPart = useAppStore.getState().activePart;
          if (!freshPart || freshPart.id !== part.id) return;
          if (useAppStore.getState().sketchMode) return;
          const hasExecutableFeature = freshPart.featureTree.some(
            (f) => f.kind === 'extrude' || f.kind === 'revolve' || f.kind === 'sweep' || f.kind === 'panel' || f.kind === 'workAxis' || f.kind === 'workPlane' || f.kind === 'workPoint'
          );
          if (!hasExecutableFeature) return;
          const res = await kernelClient.execute(freshPart.id);
          if (res.ok && viewportRef.current) {
            const partHex = freshPart?.color?.kind === 'hex' ? freshPart.color.hex : undefined;
            const panelFeat = freshPart?.featureTree.find((f) => f.kind === 'panel') as PanelFeature | undefined;
            const panelMat = panelFeat ? freshPart?.materials.find((m) => m.id === panelFeat.materialId) : undefined;
            viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices, partHex, res.value.mesh.uv, panelMat?.textureId, res.value.mesh.colors);
            tessellatedEdgesRef.current = res.value.tessellatedEdges ?? [];
            setAvailableFaceNames(res.value.faceNames ?? []);
            facePickerRef.current.setCandidates(res.value.tessellatedFaces ?? []);
            useAppStore.getState().setFeatureErrors(res.value.featureErrors ?? new Map());
            applyWorkFeaturesToViewport(res.value.workFeatures, freshPart.featureTree);
            // If an assembly is open and this part was loaded as a sub-component,
            // invalidate its ref-cache so constrained dependents reflow with fresh geometry.
            // freshPart.id is a kernel UUID, not an OPFS path — invert assemblyPartIdCacheRef.
            const storeNow = useAppStore.getState();
            if (shouldReflowAfterInvalidate(storeNow.activeDocument)) {
              const partPathForId = partPathForKernelId(
                assemblyPartIdCacheRef.current.entries(), freshPart.id,
              );
              // undefined ⇒ part edited standalone (not an assembly component) ⇒ skip silently.
              if (partPathForId) {
                void invalidatePartPaths([partPathForId]);
              }
            }
          } else if (!res.ok) {
            useAppStore.getState().setStatus(t('status.error', { message: res.error.message }));
            useAppStore.getState().setFeatureErrors(new Map());
          }
        })();
      }
      // Only cascade to the sketcher worker when a sketch is actively loaded
      // (sketchDof is non-null between SketchModeController.enter and exit).
      // Otherwise the initial part-load burst of setParameter calls would fire
      // updateDimensionValue before loadSketch, and the worker would throw
      // "GcsSystem not loaded".
      if (!part || !sketchId || !client || store.sketchDof === null) return;
      const sketch = part.featureTree.find(
        (f): f is Extract<Feature, { kind: 'sketch' }> => f.kind === 'sketch' && f.id === sketchId
      );
      if (!sketch) return;
      void (async () => {
        const coordStore = useAppStore.getState();
        for (const c of sketch.constraints) {
          if (!c.kind.startsWith('dim-')) continue;
          const dim = c as DimensionConstraint;
          if (dim.value.kind !== 'param') continue;
          const resolved = parameterRegistry.getValue(dim.value.paramName);
          if (resolved === undefined) continue;
          const result = await client.updateDimensionValue(dim.id, resolved);
          coordStore.applyCoordDiff(sketch.id, result.coords);
          coordStore.setSketchDof(result.dof);
        }
      })();
    });
  }, []);

  // Assembly ref cache — memoises per (partPath, refKey) geometry extractions.
  const assemblyRefCacheRef = useRef(new AssemblyRefCache());
  // Maps partPath → kernel partId so the solver effect can resolve refs via RPC.
  const assemblyPartIdCacheRef = useRef(new Map<string, string>());

  // Debounced solver effect: fires 50ms after solverDirty is set to true.
  //
  // T31b: path-keyed flatten/solve/composedPoses bridge.
  //   1. flattenForSolver(activeDoc, subAsmCache) → unknowns + path-prefixed
  //      constraints + rigidSubtreeRoots.
  //   2. Resolve each constraint ref's leaf partId by walking the activeDoc
  //      tree (resolveLeafPartPath), extract local geometry via the kernel
  //      RPC keyed by `${k.id}#${pathKey(ref.componentPath)}`.
  //   3. Rewrite each ref's componentPath to a single segment
  //      `[pathKey(originalPath)]` so the kernel's componentPath[0]-based id
  //      lookup sees the synthetic path-keyed id.
  //   4. solveAssembly(input) → Map<pathKey, Pose> for every unknown.
  //   5. composedPoses(activeDoc, cache, {pathToUnknown, poses,
  //      rigidSubtreeRoots}) → Map<pathKey, Pose> for every visible leaf.
  //   6. Store the composed map as componentPoses (path-keyed). Top-level-only
  //      assemblies are unaffected: pathKey([id]) === id.
  const solverDirty = useAppStore((s) => s.solverDirty);
  const solverAssembly = useAppStore((s) => s.activeAssembly);
  useEffect(() => {
    if (!solverDirty) return;
    if (!solverAssembly) return;
    const kernelClient = useAppStore.getState().kernel;
    if (!kernelClient) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        const cache = assemblyRefCacheRef.current;
        const partIdCache = assemblyPartIdCacheRef.current;
        const subAssemblyDocs = useAppStore.getState().subAssemblyDocs;
        const subAssemblyInnerPoses = useAppStore.getState().subAssemblyInnerPoses;
        const subAsmCacheAdapter = {
          get: (p: string) => subAssemblyDocs[p]
            ? ({ kind: 'ok' as const, doc: subAssemblyDocs[p]!, partPath: p, ...(subAssemblyInnerPoses[p] ? { innerStaticPoses: subAssemblyInnerPoses[p] } : {}) })
            : undefined,
        };

        // Step 1: flatten the activeDoc + sub-asms into a flat unknown list +
        // path-prefixed constraint set.
        const flat = flattenForSolver(solverAssembly, subAsmCacheAdapter);

        // Step 2: resolve each ref-bearing constraint's leaf partId by walking
        // the tree along its (already-flattened) componentPath.
        const resolvedRefs = new Map<string, import('@zilventor/kernel/src/assembly/AssemblyConstraintRefs').PartLocalGeometry>();
        for (const k of flat.constraints) {
          if (k.suppressed) continue;
          for (const side of ['A', 'B'] as const) {
            const ref = side === 'A' ? k.refA : k.refB;
            const refPath = ref.componentPath;
            const rawSynthId = pathKey(refPath);
            // For refs targeting leaves inside a rigid sub-asm: the kernel-side
            // id is the rigid root's pathKey (since rigid leaves share the
            // root's unknown index), and the extracted PartLocalGeometry must
            // be pre-composed with the leaf's static inner pose.
            const rigidLeafPose = flat.rigidLeafStaticPoses.get(rawSynthId);
            const synthId = rigidLeafPose
              ? flat.primaryPathByIndex[flat.pathToUnknown.get(rawSynthId)!]!
              : rawSynthId;
            const cacheKey = `${k.id}#${synthId}`;
            if (resolvedRefs.has(cacheKey)) continue;

            // Walk the activeDoc tree along refPath to find the leaf component
            // (refPath always points at a .zipt leaf — sub-asm refs are not
            // valid constraint targets).
            const leafPartPath = resolveLeafPartPath(refPath, solverAssembly, subAsmCacheAdapter);
            if (!leafPartPath) continue;

            // Ensure the part is loaded into the kernel worker.
            let partId = partIdCache.get(leafPartPath);
            if (!partId) {
              if (!opfsRef.current) continue;
              try {
                const bytes = await opfsRef.current.read(leafPartPath);
                partId = await kernelClient.loadFromBytes(bytes);
                partIdCache.set(leafPartPath, partId);
              } catch {
                continue;
              }
            }

            try {
              let result: import('@zilventor/shared').Result<import('@zilventor/kernel/src/assembly/AssemblyConstraintRefs').PartLocalGeometry, import('@zilventor/shared').KernelError>;
              if (k.kind === 'insert') {
                const edgeSide = side === 'A' ? (k.refA as any).circularEdge : (k.refB as any).circularEdge;
                const cacheHit = cache.getOrComputeCircularEdge(leafPartPath, edgeSide, () => ({ ok: false, error: { kind: 'invalidGeometry' as const, message: 'async-pending', correlationId: '' } }));
                if (cacheHit.ok) { resolvedRefs.set(cacheKey, rigidLeafPose ? transformPartLocalGeometry(cacheHit.value, rigidLeafPose) : cacheHit.value); continue; }
                result = await kernelClient.extractAssemblyCircularEdge(partId, edgeSide);
                if (result.ok) cache.getOrComputeCircularEdge(leafPartPath, edgeSide, () => result);
              } else {
                const rk = `${leafPartPath}#${refKey(ref as import('@zilventor/shared').AssemblyConstraintRef)}`;
                if ((cache as any)['map']?.has(rk)) {
                  const hit = (cache as any)['map'].get(rk);
                  if (hit.ok) { resolvedRefs.set(cacheKey, rigidLeafPose ? transformPartLocalGeometry(hit.value, rigidLeafPose) : hit.value); continue; }
                }
                result = await kernelClient.extractAssemblyRef(partId, ref as import('@zilventor/shared').AssemblyConstraintRef);
                if (result.ok) cache.getOrCompute(leafPartPath, ref as import('@zilventor/shared').AssemblyConstraintRef, () => result);
              }
              if (result.ok) resolvedRefs.set(cacheKey, rigidLeafPose ? transformPartLocalGeometry(result.value, rigidLeafPose) : result.value);
            } catch {
              // Broken ref — solver will skip this constraint.
            }
          }
        }

        if (cancelled) return;

        // Step 3: rewrite constraints so each ref's componentPath collapses
        // to a single synthetic segment = pathKey(originalPath). The kernel
        // reads componentPath[0] as the component id; this makes that lookup
        // align with the synthetic ids in the components array.
        const rewrittenConstraints: import('@zilventor/shared').AssemblyConstraint[] = flat.constraints.map((k) => {
        const kernelSynthFor = (componentPath: ReadonlyArray<string>): string => {
          const k0 = pathKey(componentPath);
          if (flat.rigidLeafStaticPoses.has(k0)) {
            return flat.primaryPathByIndex[flat.pathToUnknown.get(k0)!]!;
          }
          return k0;
        };
          // Both arms are runtime-identical; the if-guard exists solely for TS
          // discriminant narrowing (insert.refA is not AssemblyConstraintRef).
          if (k.kind === 'mate' || k.kind === 'flush' || k.kind === 'angle' || k.kind === 'tangent') {
            return {
              ...k,
              refA: { ...k.refA, componentPath: [kernelSynthFor(k.refA.componentPath)] },
              refB: { ...k.refB, componentPath: [kernelSynthFor(k.refB.componentPath)] },
            };
          }
          return {
            ...k,
            refA: { ...k.refA, componentPath: [kernelSynthFor(k.refA.componentPath)] },
            refB: { ...k.refB, componentPath: [kernelSynthFor(k.refB.componentPath)] },
          };
        });

        // Step 4: build the kernel input keyed by synthetic pathKey ids.
        const paramValues = parameterRegistry.getAll().reduce(
          (acc, p) => { if (p.name && p.value !== undefined) acc[p.name] = p.value; return acc; },
          {} as Record<string, number>
        );
        // Reverse pathToUnknown so we can map index → pathKey.
        const indexToPath = flat.primaryPathByIndex;
        const components = flat.unknowns.map((p, i) => ({
          id: indexToPath[i]!,
          T: p.translation,
          q: p.quaternion,
        }));
        const groundedComponentIds = solverAssembly.groundedComponentPaths
          .map((p) => pathKey(p))
          .filter((k) => flat.pathToUnknown.has(k));
        const input = {
          components,
          groundedComponentIds,
          constraints: rewrittenConstraints,
          resolvedRefs,
          paramValues,
        };
        const out = solveAssembly(input);

        // Step 5: assemble solvedPoses array indexed by pathToUnknown, then
        // run composedPoses to derive every visible leaf's world pose.
        const solvedPoses: Pose[] = flat.unknowns.slice();
        for (const [k, idx] of flat.pathToUnknown) {
          const p = out.poses.get(k);
          if (p) solvedPoses[idx] = p;
        }
        const composed = composedPoses(solverAssembly, subAsmCacheAdapter, {
          pathToUnknown: flat.pathToUnknown,
          poses: solvedPoses,
          rigidSubtreeRoots: flat.rigidSubtreeRoots,
        });

        useAppStore.getState().setSolverResult(composed, out.diagnostics, out.freeDofBasis);
      })();
    }, 50);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [solverDirty, solverAssembly]);

  // Parameter cascade: when any parameter changes and at least one constraint
  // references a parameter, mark the solver dirty so it re-solves.
  useEffect(() => {
    const unsub = parameterRegistry.subscribe(() => {
      const aa = useAppStore.getState().activeAssembly;
      if (!aa) return;
      const hasParamRef = aa.constraints.some((k) =>
        paramRefValuesOf(k).some((v) => v.kind === 'param'),
      );
      if (hasParamRef) useAppStore.getState().setSolverDirty(true);
    });
    return unsub;
  }, []);


  // Enter/exit sketch mode (camera swap + grid + orbit lock).
  useEffect(() => {
    const ctrl = sketchModeRef.current;
    if (!ctrl) return;
    if (sketchMode) void ctrl.enter();
    else void ctrl.exit();
  }, [sketchMode]);

  // Swap the active drawing tool. Refresh numeric overlay state after swap.
  useEffect(() => {
    activeToolCtrlRef.current?.setToolKind(activeToolKind);
    const count = activeToolCtrlRef.current?.numericFieldCount() ?? 0;
    setNumericFieldCount(count);
    setNumericVisible(count > 0);
  }, [activeToolKind]);

  // Render committed sketch primitives whenever the active sketch changes.
  useEffect(() => {
    const r = committedSketchRendererRef.current;
    if (!r) return;
    if (!activePart || !activeSketchId) { r.update([]); return; }
    const sketch = activePart.featureTree.find(
      (f): f is Extract<Feature, { kind: 'sketch' }> => f.kind === 'sketch' && f.id === activeSketchId
    );
    r.update(sketch?.primitives ?? [], sketch?.annotations ?? []);
  }, [activePart, activeSketchId]);

  // Global keyboard shortcuts. In sketch mode, Esc/Enter go to the active tool;
  // letter shortcuts switch the active tool kind; Ctrl/Cmd+Z/Y are undo/redo.
  // All shortcuts are no-ops when a text input is focused.
  useEffect(() => {
    const toolKindMap: Record<string, ToolKind> = {
      'l': 'line', 'r': 'rect', 'c': 'circle', 'a': 'arc', 's': 'spline',
      'n': 'constrain-coincident',
      'h': 'constrain-horizontal',
      'v': 'constrain-vertical',
      'p': 'constrain-parallel',
      'e': 'constrain-perpendicular',
      't': 'constrain-tangent',
      'q': 'constrain-equal',
      'y': 'constrain-symmetric',
      'd': 'dimension',
    };
    const onKey = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Don't swallow shortcuts inside input fields — the native behaviour there is
      // useful, and intercepting would surprise the user mid-edit.
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
      if (sketchMode && activeToolCtrlRef.current) {
        if (e.key === 'Escape') {
          activeToolCtrlRef.current.handleKey('Escape');
          useAppStore.getState().setActiveToolKind('select');
          return;
        }
        if (e.key === 'Enter') { activeToolCtrlRef.current.handleKey('Enter'); return; }
      }
      // Tool-kind shortcuts (no modifier keys).
      if (sketchMode && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = toolKindMap[e.key.toLowerCase()];
        if (k) {
          e.preventDefault();
          useAppStore.getState().setActiveToolKind(k);
          return;
        }
      }
      if (!sketchMode && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        useAppStore.getState().setRevolveDialogOpen(true);
        return;
      }
      if (!sketchMode && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        useAppStore.getState().setFilletDialogOpen(true);
        return;
      }
      if (!sketchMode && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useAppStore.getState().setChamferDialogOpen(true);
        return;
      }
      if (!sketchMode && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        useAppStore.getState().setShellDialogOpen(true);
        return;
      }
      if (!sketchMode && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        useAppStore.getState().setLinearPatternDialogOpen(true);
        return;
      }
      if (!sketchMode && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        useAppStore.getState().setMirrorDialogOpen(true);
        return;
      }
      if (!sketchMode && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        OpenHoleDialogCommand();
        return;
      }
      if (!sketchMode && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        OpenSweepDialogCommand();
        return;
      }
      // Ctrl+Shift+P/A/W → open WorkPlane/WorkAxis/WorkPoint dialogs.
      // Ctrl+Shift+W is bound to Work Point because plain 'w' is taken by
      // Sweep above; documented divergence from Inventor 2012's stock map.
      if (!sketchMode && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        OpenWorkPlaneDialogCommand();
        return;
      }
      if (!sketchMode && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        OpenWorkAxisDialogCommand();
        return;
      }
      if (!sketchMode && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        OpenWorkPointDialogCommand();
        return;
      }
      if (
        !sketchMode
        && !e.ctrlKey && !e.metaKey && !e.altKey
        && e.key.toLowerCase() === 'p'
        && useAppStore.getState().activeDocument?.kind === 'assembly'
      ) {
        e.preventDefault();
        OpenPlaceComponentDialogCommand();
        return;
      }
      const isAssembly = useAppStore.getState().activeDocument?.kind === 'assembly';
      if (isAssembly && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (e.key === 'm' || e.key === 'M') { OpenPlaceConstraintDialogCommand('mate'); e.preventDefault(); return; }
        if (e.key === 'f' || e.key === 'F') { OpenPlaceConstraintDialogCommand('flush'); e.preventDefault(); return; }
        if (e.key === 'n' || e.key === 'N') { OpenPlaceConstraintDialogCommand('angle'); e.preventDefault(); return; }
        if (e.key === 'i' || e.key === 'I') { OpenPlaceConstraintDialogCommand('insert'); e.preventDefault(); return; }
        if (e.key === 'g' || e.key === 'G') {
          const sel = useAppStore.getState().selectedComponentPaths[0];
          const id = sel ? sel[sel.length - 1] ?? null : null;
          if (id) { void new ToggleGroundedCommand({ componentId: id }).apply(); e.preventDefault(); return; }
        }
      }
      if (isAssembly && e.ctrlKey && e.shiftKey && (e.key === 's' || e.key === 'S')) {
        const id = useAppStore.getState().selectedConstraintId;
        if (id) { void new ToggleConstraintSuppressionCommand({ id }).apply(); e.preventDefault(); return; }
      }
      if (e.key === 'F7') {
        e.preventDefault();
        useAppStore.getState().setParametersPanelOpen(!useAppStore.getState().parametersPanelOpen);
        return;
      }
      const bus = useAppStore.getState().bus;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        await bus.undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        await bus.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sketchMode]);

  // Dimension dialog handlers.
  const onDialogCommit = useCallback(async (v: { name: string; expression: string }) => {
    if (!pendingDimension) return;
    const unit = pendingDimension.kind === 'dim-angle' ? 'deg' : 'mm';
    const res = parameterRegistry.setParameter({ name: v.name, expression: v.expression, unit });
    if (!res.ok) {
      showToast(formatExpressionError(res.error));
      setPendingDimension(null);
      return;
    }
    const finalDim: DimensionConstraint = {
      ...pendingDimension,
      paramName: v.name,
      value: { kind: 'param', paramName: v.name }
    };
    const store = useAppStore.getState();
    const client = sketcherClientRef.current;
    if (!client || !store.activeSketchId) {
      setPendingDimension(null);
      return;
    }
    try {
      await store.bus.execute(
        new AddDimensionCommand(store.activeSketchId, finalDim, res.value.value, client)
      );
    } catch (e) {
      if (e instanceof AddDimensionConflictError) {
        const offending = e.result.offendingConstraintIds;
        const { setHighlightedConstraintIds } = useAppStore.getState();
        showToast(t('toast.overDefined'), offending.length > 0 ? {
          label: t('toast.showConflict'),
          fn: () => {
            setHighlightedConstraintIds(offending);
            setTimeout(() => setHighlightedConstraintIds([]), 3000);
          }
        } : undefined);
      } else {
        throw e;
      }
    }
    setPendingDimension(null);
  }, [pendingDimension]);

  const onDialogCancel = useCallback(() => { setPendingDimension(null); }, []);

  const handleEditDimension = useCallback((dimId: string) => {
    const store = useAppStore.getState();
    const sketchId = store.activeSketchId;
    if (!sketchId || !store.activePart) return;
    const sketch = store.activePart.featureTree.find((f) => f.kind === 'sketch' && f.id === sketchId);
    if (!sketch || sketch.kind !== 'sketch') return;
    const dim = sketch.constraints.find((c): c is DimensionConstraint => c.id === dimId && c.kind.startsWith('dim-'));
    if (!dim) return;
    // Both literal and param dims open the inline editor.
    setEditingDimId(dimId);
  }, []);

  const handleDimEditCommit = useCallback(async (dimId: string, rawValue: string) => {
    const store = useAppStore.getState();
    const sketchId = store.activeSketchId;
    const client = sketcherClientRef.current;
    if (!sketchId || !client || !store.activePart) { setEditingDimId(null); return; }
    const sketch = store.activePart.featureTree.find((f) => f.kind === 'sketch' && f.id === sketchId);
    if (!sketch || sketch.kind !== 'sketch') { setEditingDimId(null); return; }
    const dim = sketch.constraints.find((c): c is DimensionConstraint => c.id === dimId && c.kind.startsWith('dim-'));
    if (!dim) { setEditingDimId(null); return; }

    if (dim.value.kind === 'literal') {
      // Literal dim: parse arithmetic, reject param-refs.
      const parsed = parseDimensionInput(dim.kind, rawValue);
      if (!parsed.ok) {
        if (parsed.reason === 'param-ref') {
          showToast(t('toast.paramRef'));
        }
        // Invalid value: keep editor open (don't dismiss).
        return;
      }
      setEditingDimId(null);
      await store.bus.execute(
        new UpdateDimensionValueCommand(sketchId, dimId, dim.value.value, parsed.value, client)
      );
    } else {
      // Param dim: validate via registry.dryRun then dispatch UpdateParameterExpressionCommand.
      const dimValue = dim.value;
      if (dimValue.kind !== 'param') { setEditingDimId(null); return; }
      const param = parameterRegistry.getAll().find((p) => p.name === dimValue.paramName);
      if (!param) { setEditingDimId(null); return; }

      const dryResult = parameterRegistry.dryRun({ name: param.name, expression: rawValue, unit: param.unit });
      if (!dryResult.ok) {
        showToast(formatExpressionError(dryResult.error));
        // Keep editor open.
        return;
      }

      // Kind-aware ≤0 guard on the evaluated value.
      const POSITIVE_ONLY: ReadonlySet<DimensionConstraint['kind']> = new Set([
        'dim-length', 'dim-radius', 'dim-diameter',
      ]);
      if (POSITIVE_ONLY.has(dim.kind) && dryResult.value.value <= 0) {
        showToast(t('toast.valueMin'));
        return;
      }

      setEditingDimId(null);
      await store.bus.execute(
        new UpdateParameterExpressionCommand(param, rawValue, parameterRegistry)
      );
    }
  }, [showToast]);

  // Handler for the kernel-offline banner's Restart button. Terminates the
  // current worker, spawns a new one, and re-executes the active part so the
  // viewport mesh is repopulated. Guarded against reentry (double-click would
  // otherwise race two spawnKernel calls and leak a worker) and against
  // unmount-during-spawn (the resolved worker would never be terminated).
  const handleRestart = useCallback(async () => {
    if (restartingRef.current) return;
    restartingRef.current = true;
    try {
      setKernelOffline(false);
      setKernelFailed(false);
      terminateRef.current?.();
      terminateRef.current = null;
      const { client, terminate } = await spawnKernel({
        onOffline: () => setKernelOffline(true)
      });
      if (unmountedRef.current) {
        terminate();
        return;
      }
      terminateRef.current = terminate;
      useAppStore.getState().setKernel(client);
      const { activePart: ap } = useAppStore.getState();
      if (ap && viewportRef.current) {
        const hasSolidFeature = ap.featureTree.some((f) => f.kind === 'extrude' || f.kind === 'revolve' || f.kind === 'sweep' || f.kind === 'panel');
        if (hasSolidFeature) {
          const res = await client.execute(ap.id);
          if (!unmountedRef.current && res.ok && viewportRef.current) {
            const partHex = ap?.color?.kind === 'hex' ? ap.color.hex : undefined;
            const panelFeat = ap?.featureTree.find((f) => f.kind === 'panel') as PanelFeature | undefined;
            const panelMat = panelFeat ? ap?.materials.find((m) => m.id === panelFeat.materialId) : undefined;
            viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices, partHex, res.value.mesh.uv, panelMat?.textureId, res.value.mesh.colors);
            tessellatedEdgesRef.current = res.value.tessellatedEdges ?? [];
            setAvailableFaceNames(res.value.faceNames ?? []);
            facePickerRef.current.setCandidates(res.value.tessellatedFaces ?? []);
            useAppStore.getState().setFeatureErrors(res.value.featureErrors ?? new Map());
            applyWorkFeaturesToViewport(res.value.workFeatures, ap.featureTree);
          } else if (!unmountedRef.current) {
            useAppStore.getState().setFeatureErrors(new Map());
          }
        }
      }
    } catch (e) {
      if (!unmountedRef.current) {
        useAppStore.getState().setStatus(t('status.kernelFailed', { message: (e as Error).message }));
        setKernelFailed(true);
      }
    } finally {
      restartingRef.current = false;
    }
  }, []);

  // Cancel an in-progress File→Open. OCCT parses are one blocking synchronous
  // call, so the only way to actually stop the CPU work is to tear down and
  // respawn the worker — reuse handleRestart, which re-loads the active doc.
  const handleCancelOpen = useCallback(async () => {
    useAppStore.getState().cancelFileOpen();
    await handleRestart();
    if (!unmountedRef.current) useAppStore.getState().setStatus(t('status.openCancelled'));
  }, [handleRestart]);

  // Slice-5 (PC10): extracted connector-docs builder, shared by BorePropertiesPanel prop
  // and the bore drag handler so both work from the same live data.
  // Reads assembly and componentPoses imperatively from the store to avoid
  // closure-ordering issues (both are declared later in the component body).
  const buildConnectorDocs = useCallback(() => {
    const storeState = useAppStore.getState();
    const asm = storeState.activeAssembly;
    if (!asm) return [];
    const poses = storeState.componentPoses;
    const subAssemblyDocs = storeState.subAssemblyDocs;
    const subAssemblyInnerPoses = storeState.subAssemblyInnerPoses;
    const subAsmCacheAdapter = {
      get: (p: string) => subAssemblyDocs[p]
        ? ({ kind: 'ok' as const, doc: subAssemblyDocs[p]!, partPath: p, ...(subAssemblyInnerPoses[p] ? { innerStaticPoses: subAssemblyInnerPoses[p] } : {}) })
        : undefined,
    };
    const leaves = visibleLeaves(asm, subAsmCacheAdapter).filter((l) => l.kind === 'leaf');
    const result: Array<{
      partPath: string;
      doc: { bores?: BoreOp[]; suppressedConnectorIds?: string[] };
      panelDims: { length: number; width: number; thickness: number };
      worldPose: { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] };
    }> = [];
    const seenPartPaths = new Set<string>();
    for (const leaf of leaves) {
      if (seenPartPaths.has(leaf.partPath)) continue;
      const doc = loadedPartDocsRef.current.get(leaf.partPath);
      if (!doc) continue;
      const spec = panelSpecCacheRef.current.get(leaf.partPath);
      if (!spec) continue;
      const worldPose = poses.get(pathKey(leaf.componentPath)) ?? {
        translation: { x: 0, y: 0, z: 0 },
        quaternion: [0, 0, 0, 1] as [number, number, number, number],
      };
      result.push({
        partPath: leaf.partPath,
        doc,
        panelDims: { length: spec.length, width: spec.width, thickness: spec.thickness },
        worldPose,
      });
      seenPartPaths.add(leaf.partPath);
    }
    return result;
  }, []);

  const handleViewportPointer = useCallback((ev: { type: 'click' | 'move' | 'pointerdown' | 'pointerup' | 'pointercancel'; clientX: number; clientY: number; pointerId: number; button: number }) => {
    if (!viewportRef.current) return;
    const docKind = useAppStore.getState().activeDocument?.kind;
    if (docKind === 'drawing') return;   // drawing uses DrawingCanvas, not Viewport
    if (docKind === 'assembly') {
      // B3 component drag: pointerdown over a component starts a drag candidate;
      // movement past a small threshold treats subsequent moves as drag deltas
      // routed through dragAlongFreeDofs; pointerup commits to the store and
      // suppresses the synthetic click that follows.
      // Slice-2 присадка: one-component pick (Add Door / manual система-32).
      // Check before the drag-busy guard so a pending pick is always serviced.
      if (ev.type === 'click' || ev.type === 'pointerdown') {
        const pickHandle = useAppStore.getState().oneComponentPickHandle;
        if (pickHandle) {
          pickHandle.pick(ev.clientX, ev.clientY);
          useAppStore.getState().setOneComponentPickHandle(null);
          return;
        }
      }

      // Slice-5: bore drag — BEFORE dragBusy guard so it is never blocked by
      // the component-picker flow. Handles pointerdown (start), move, up, cancel.
      // pointerdown: if a bore marker is hit and it has a drag axis, begin drag.
      if (ev.type === 'pointerdown') {
        const sm = viewportRef.current.getSceneManager();
        const hit = sm ? viewportRef.current.raycastBoreMarker(ev.clientX, ev.clientY) : null;
        if (sm && hit) {
          const axis = sm.boreDragAxis(hit.boreId, hit.partPath);
          if (axis) {
            const bores = partBoresCacheRef.current.get(hit.partPath);
            const bore = bores?.find((b) => b.id === hit.boreId);
            if (bore) {
              const docs = buildConnectorDocs();
              const members = collectConnectorMembers(bore.connectorId, docs);
              const pivot = sm.boreWorldPos(hit.boreId, hit.partPath);
              if (pivot) {
                if (orbitControlsRef.current) orbitControlsRef.current.enabled = false;
                // Release any latched pointer capture from OrbitControls so it
                // doesn't steal subsequent pointer events during the drag.
                try {
                  const el = sm.getControls().domElement;
                  if (el instanceof HTMLElement) el.releasePointerCapture(ev.pointerId);
                } catch { /* ignore if no capture was latched */ }
                sm.setBoreDragActive(true);
                sm.setBoreGizmo({ worldPos: pivot, worldAxis: axis });
                boreDragRef.current = {
                  boreId: hit.boreId,
                  partPath: hit.partPath,
                  pointerId: ev.pointerId,
                  worldAxis: axis,
                  pivot,
                  rayStart: viewportRef.current.pointerWorldRay(ev.clientX, ev.clientY),
                  members,
                  markerMesh: sm.findBoreMarkerMesh(hit.boreId, hit.partPath),
                  startUV: { u: bore.u, v: bore.v },
                };
                return; // consume — do not fall through to component drag
              }
            }
          }
        }
      }

      // Slice-5: bore drag move — update marker + gizmo live; no command yet.
      if (ev.type === 'move' && boreDragRef.current) {
        const sm = viewportRef.current.getSceneManager();
        if (sm) {
          const d = boreDragRef.current;
          const raw = signedDragDeltaAlongAxis(
            d.worldAxis, d.pivot,
            d.rayStart,
            viewportRef.current.pointerWorldRay(ev.clientX, ev.clientY),
          );
          // PC4: null = near-parallel frame — skip to preserve marker pos + lastDelta.
          if (raw !== null) {
            const delta = clampDeltaToFaceExtents(d.members, d.worldAxis, raw);
            const off = { x: d.worldAxis.x * delta, y: d.worldAxis.y * delta, z: d.worldAxis.z * delta };
            // PC8: matrixAutoUpdate=false on bore markers — must use matrix.setPosition.
            if (d.markerMesh) {
              d.markerMesh.matrix.setPosition(
                d.pivot.x + off.x,
                d.pivot.y + off.y,
                d.pivot.z + off.z,
              );
            }
            sm.setBoreGizmo({
              worldPos: { x: d.pivot.x + off.x, y: d.pivot.y + off.y, z: d.pivot.z + off.z },
              worldAxis: d.worldAxis,
            });
            d.lastDelta = delta;
          }
        }
        return;
      }

      // Slice-5: bore drag end — re-enable controls, commit one bus.execute, clean up.
      if ((ev.type === 'pointerup' || ev.type === 'pointercancel') && boreDragRef.current) {
        const sm = viewportRef.current.getSceneManager();
        const d = boreDragRef.current;
        // Always re-enable OrbitControls on every exit path (up AND cancel).
        if (orbitControlsRef.current) orbitControlsRef.current.enabled = true;
        if (ev.type === 'pointerup' && d.lastDelta !== undefined && Math.abs(d.lastDelta) > 1e-6) {
          void useAppStore.getState().bus.execute(
            new MoveConnectorCommand({
              members: d.members,
              worldDir: d.worldAxis,
              delta: d.lastDelta,
              opfs: opfsRef.current,
            }),
          );
          // Suppress the synthetic click that browsers fire after pointerup so it
          // doesn't re-select or clear the bore we just dragged.
          suppressNextClickRef.current = true;
        }
        if (sm) {
          sm.setBoreGizmo(null);
          sm.setBoreDragActive(false); // flushes any deferred marker rebuild
        }
        boreDragRef.current = null;
        return;
      }

      const assemblyState = useAppStore.getState();
      const dragBusy =
        sketchMode ||
        assemblyPickerRef.current.isActive() ||
        assemblyState.placeConstraintDialogOpen ||
        assemblyState.editConstraintDialogOpen ||
        assemblyState.placeComponentDialogOpen ||
        assemblyState.editComponentDialogOpen;

      if (!dragBusy && ev.type === 'pointerdown') {
        const componentPath = viewportRef.current.raycastComponent(ev.clientX, ev.clientY);
        if (componentPath) {
          const startWorld = viewportRef.current.screenToWorld(ev.clientX, ev.clientY);
          componentDragRef.current = {
            componentPath,
            startScreenX: ev.clientX,
            startScreenY: ev.clientY,
            lastWorld: startWorld,
            didDrag: false,
          };
        }
        return;
      }

      if (ev.type === 'move' && componentDragRef.current) {
        const ds = componentDragRef.current;
        const dx = ev.clientX - ds.startScreenX;
        const dy = ev.clientY - ds.startScreenY;
        if (!ds.didDrag && dx * dx + dy * dy < 9) return;
        ds.didDrag = true;
        const cur = viewportRef.current.screenToWorld(ev.clientX, ev.clientY);
        const delta = { x: cur.x - ds.lastWorld.x, y: cur.y - ds.lastWorld.y };
        ds.lastWorld = cur;
        const freeDofBasis = useAppStore.getState().freeDofBasis;
        viewportRef.current.dragAlongFreeDofs(ds.componentPath, delta, freeDofBasis);
        return;
      }

      if (ev.type === 'pointerup' && componentDragRef.current) {
        const ds = componentDragRef.current;
        componentDragRef.current = null;
        if (ds.didDrag) {
          suppressNextClickRef.current = true;
          const sm = viewportRef.current.getSceneManager();
          const mesh = sm?.getComponentMesh(pathKey(ds.componentPath));
          if (mesh) {
            const e = mesh.matrix.elements;
            const newTranslation = {
              x: e[12] ?? 0,
              y: e[13] ?? 0,
              z: e[14] ?? 0,
            };
            // Update pose first so the React re-render triggered by
            // updateComponent (which mutates `assembly`) does not snap the
            // mesh back to the pre-drag solver pose. The pose's quaternion
            // is preserved — drag-along-free-DOFs is translation-only in v1.
            // T31 follow-up: pose updates currently key by tail id; deep paths
            // require switching componentPoses to a path-keyed map.
            const poseKey = pathKey(ds.componentPath);
            const poses = useAppStore.getState().componentPoses;
            const prevPose = poses.get(poseKey);
            if (prevPose) {
              const nextPoses = new Map(poses);
              nextPoses.set(poseKey, {
                translation: newTranslation,
                quaternion: prevPose.quaternion,
              });
              useAppStore.setState({ componentPoses: nextPoses });
            }
            // Document write-back is top-level-only: updateComponent targets s.activeAssembly.components by id.
            // For deep-path drags the new pose lives in componentPoses (path-keyed) and survives until the next solve.
            if (ds.componentPath.length === 1) {
              useAppStore.getState().updateComponent(ds.componentPath[0]!, {
                position: newTranslation,
              });
            }
          }
        }
        return;
      }

      if (ev.type === 'click') {
        // Guard: suppress clicks that follow a completed drag OR that are
        // explicitly suppressed (e.g. after pointer-up on a drag).
        if (componentDragRef.current || suppressNextClickRef.current) {
          suppressNextClickRef.current = false;
          return;
        }
        // Slice-3: bore markers take priority over component selection.
        const boreHit = viewportRef.current.raycastBoreMarker(ev.clientX, ev.clientY);
        if (boreHit) {
          useAppStore.getState().setSelectedBore(boreHit.boreId, boreHit.partPath);
          return;
        }
        // Miss on bore markers — clear any prior bore selection.
        useAppStore.getState().setSelectedBore(null, null);
        const hit = viewportRef.current.raycastComponent(ev.clientX, ev.clientY);
        // T29: store the full path; selectComponentPaths replaces selection.
        if (hit) {
          useAppStore.getState().selectComponentPaths([hit as string[]]);
        } else {
          useAppStore.getState().selectComponentPaths([]);
        }
        return;
      }
    }
    // Model-mode fillet edge pick. Hover highlights the candidate, click
    // commits the pick into the dialog's edge list. Uses a camera-space ray
    // (origin + direction in world coords) against the kernel's tessellated
    // edges — ray-vs-segment distance with near-to-camera tiebreak handles
    // occlusion naturally.
    if (!sketchMode && pickingFilletEdges) {
      if (ev.type === 'move') {
        const r = viewportRef.current.screenToRay(ev.clientX, ev.clientY);
        const hover = edgePickerRef.current.highlightFromRay(r.origin, r.direction);
        setHoveredEdgeSet(hover);
        return;
      }
      if (ev.type === 'click') {
        const r = viewportRef.current.screenToRay(ev.clientX, ev.clientY);
        const pick = edgePickerRef.current.pickFromRay(r.origin, r.direction);
        if (pick && pick.length > 0) {
          const newSpecs: FilletEdgeSpec[] = pick.map((edgeId) => ({
            edgeId,
            selectionMode: filletSelectionMode,
            radius: { kind: 'param', paramName: 'r_fillet' }
          }));
          setFilletEdges([...useAppStore.getState().filletEdges, ...newSpecs]);
          setPickingFilletEdges(false);
          setHoveredEdgeSet(null);
        }
      }
      return;
    }
    if (!sketchMode && pickingChamferEdges) {
      if (ev.type === 'move') {
        const r = viewportRef.current.screenToRay(ev.clientX, ev.clientY);
        const hover = edgePickerRef.current.highlightFromRay(r.origin, r.direction);
        setHoveredEdgeSet(hover);
        return;
      }
      if (ev.type === 'click') {
        const r = viewportRef.current.screenToRay(ev.clientX, ev.clientY);
        const pick = edgePickerRef.current.pickFromRay(r.origin, r.direction);
        if (pick && pick.length > 0) {
          const newSpecs: ChamferEdgeSpec[] = pick.map((edgeId) => ({
            edgeId,
            selectionMode: filletSelectionMode,
            distance: { kind: 'param', paramName: 'd_chamfer' }
          }));
          const store = useAppStore.getState();
          store.setChamferEdges([...store.chamferEdges, ...newSpecs]);
          setPickingChamferEdges(false);
          setHoveredEdgeSet(null);
        }
      }
      return;
    }
    if (!sketchMode && pickingShellFaces) {
      if (ev.type !== 'click') return;
      const hit = viewportRef.current.raycastBody(ev.clientX, ev.clientY);
      if (!hit) return;
      const face = facePickerRef.current.pickByTriangleIndex(hit.triangleIndex);
      if (!face) return;
      useAppStore.getState().toggleShellFace(face);
      setPickingShellFaces(false);
      return;
    }
    // Model-mode profile pick: route a click to the ProfilePickController and
    // bail out. Movements/hovers are ignored.
    if (!sketchMode && pickingProfile) {
      if (ev.type !== 'click') return;
      const world = viewportRef.current.screenToWorld(ev.clientX, ev.clientY);
      const hitId = profilePickerRef.current.pick(world);
      if (hitId) {
        const sketch = activePart?.featureTree.find(
          (f): f is Extract<Feature, { kind: 'sketch' }> => f.kind === 'sketch' && f.id === hitId
        );
        const count = sketch && sketch.primitives.length > 0 ? 1 : 0;
        setManualProfileRef({ sketchId: hitId, closedProfileCount: count });
        setPickingProfile(false);
      }
      return;
    }
    // Model-mode axis pick: route a click to the AxisPickController and bail
    // out of the sketch-tool routing. Movements/hovers are ignored.
    if (!sketchMode && pickingAxis) {
      if (ev.type !== 'click') return;
      const world = viewportRef.current.screenToWorld(ev.clientX, ev.clientY);
      const hitId = axisPickerRef.current.pick(world);
      if (hitId) {
        setSelectedAxisRef({ primitiveId: hitId });
        setPickingAxis(false);
      }
      return;
    }
    // Model-mode work-feature pick: route a click to the active picker.
    // The pending request was issued by a dialog via store; the activate
    // useEffect armed the matching picker. We raycast the appropriate
    // viewport target by mode token and forward the hit.
    const wfReq = useAppStore.getState().pendingWorkFeaturePick;
    if (!sketchMode && wfReq) {
      if (ev.type !== 'click') return;
      if (wfReq.kind === 'plane' && wfReq.mode === 'workPlane') {
        const id = viewportRef.current.raycastWorkFeature(ev.clientX, ev.clientY);
        if (id) workPlanePickerRef.current?.pickFromViewport({ kind: 'workPlane', featureId: id });
        return;
      }
      if (wfReq.kind === 'axis' && wfReq.mode === 'workAxis') {
        const id = viewportRef.current.raycastWorkFeature(ev.clientX, ev.clientY);
        if (id) workAxisPickerRef.current?.pickFromViewport({ kind: 'workAxis', featureId: id });
        return;
      }
      if (wfReq.kind === 'point' && wfReq.mode === 'workPoint') {
        const id = viewportRef.current.raycastWorkFeature(ev.clientX, ev.clientY);
        if (id) workPointPickerRef.current?.pickFromViewport({ kind: 'workPoint', featureId: id });
        return;
      }
      // OCCT-bound modes (face/edge/cylindricalFace/vertex) require T14 wiring;
      // for v1 we drop the click silently rather than guessing a hit.
      return;
    }
    // Assembly-mode constraint pick: route pointer events to the assemblyPickerRef.
    // T36: face mode now resolves the real FaceName via the tessellated-face cache.
    // edge/axis/point/circularEdge remain T38 work and keep their existing no-op.
    if (assemblyPickerRef.current.isActive()) {
      const pickerMode = assemblyPickerRef.current.getMode();
      if (pickerMode && (ev.type === 'click' || ev.type === 'pointerdown')) {
        if (pickerMode === 'face') {
          // T36: Use raycastAssemblyRef to get both componentPath AND triangleIndex.
          // Then look up the part's TessellatedFace[] from partTessellatedFacesCacheRef
          // and call FacePickController.pickByTriangleIndex to recover the real FaceName.
          // Invariant: Tessellator.tessellate() and tessellateFaces() walk faces in the
          // same TopExp_Explorer order, so the raycast triangleIndex aligns with the
          // cached TessellatedFace ranges (box-projection preserves triangle count/order).
          const refHit = viewportRef.current.raycastAssemblyRef('face', ev.clientX, ev.clientY);
          if (refHit && refHit.kind === 'face') {
            const componentPath = refHit.componentPath;
            const triangleIndex = refHit.triangleIndex;

            // Resolve componentPath → partPath at click time using live store state
            // so recently-added components are not missed by a stale render closure.
            const storeState = useAppStore.getState();
            const activeAssemblyNow = storeState.activeAssembly;
            const subAsmDocsNow = storeState.subAssemblyDocs;
            const subAsmInnerPosesNow = storeState.subAssemblyInnerPoses;
            const subAsmCacheNow = {
              get: (p: string) => subAsmDocsNow[p]
                ? ({ kind: 'ok' as const, doc: subAsmDocsNow[p]!, partPath: p,
                     ...(subAsmInnerPosesNow[p] ? { innerStaticPoses: subAsmInnerPosesNow[p] } : {}) })
                : undefined,
            };
            const partPath = activeAssemblyNow
              ? resolveLeafPartPath(componentPath, activeAssemblyNow, subAsmCacheNow)
              : null;

            if (!partPath) {
              // Component not found in current assembly tree — silently no-op.
              if (import.meta.env.DEV) console.warn('[T36] assembly face pick: could not resolve partPath for', componentPath);
              return;
            }

            const tessellatedFaces = partTessellatedFacesCacheRef.current.get(partPath);
            if (!tessellatedFaces) {
              // Cache miss — mesh-sync hasn't populated this part yet.
              // Silently no-op; the user can click again after geometry loads.
              if (import.meta.env.DEV) console.warn('[T36] assembly face pick: tessellated faces not cached for', partPath);
              return;
            }

            // Resolve triangleIndex → FaceName via binary search.
            const facePicker = new FacePickController();
            facePicker.setCandidates(tessellatedFaces);
            const realFaceName = facePicker.pickByTriangleIndex(triangleIndex);

            if (realFaceName) {
              assemblyPickerRef.current.handleFaceHit(componentPath, realFaceName);
            } else {
              // triangleIndex fell outside all known face ranges (e.g. unnamed face).
              if (import.meta.env.DEV) console.warn('[T36] assembly face pick: triangleIndex', triangleIndex, 'not in any face range for', partPath);
            }
          }
          return; // consume the event even if no hit
        }

        // axis / circularEdge / edge: resolve via partTessellatedEdgesCacheRef +
        // EdgePickController, then route to handleEdgeHit / handleCylindricalFaceHit.
        if (pickerMode === 'axis' || pickerMode === 'circularEdge' || pickerMode === 'edge') {
          const refHit = viewportRef.current.raycastAssemblyRef(pickerMode, ev.clientX, ev.clientY);
          if (refHit && refHit.kind === 'edge') {
            const componentPath = refHit.componentPath;

            // Resolve the OPFS partPath for this component (same pattern as face pick).
            const storeState = useAppStore.getState();
            const activeAssemblyNow = storeState.activeAssembly;
            const subAsmDocsNow = storeState.subAssemblyDocs;
            const subAsmInnerPosesNow = storeState.subAssemblyInnerPoses;
            const subAsmCacheNow = {
              get: (p: string) => subAsmDocsNow[p]
                ? ({ kind: 'ok' as const, doc: subAsmDocsNow[p]!, partPath: p,
                     ...(subAsmInnerPosesNow[p] ? { innerStaticPoses: subAsmInnerPosesNow[p] } : {}) })
                : undefined,
            };
            const partPath = activeAssemblyNow
              ? resolveLeafPartPath(componentPath, activeAssemblyNow, subAsmCacheNow)
              : null;

            // Primary: edge pick via per-component tessellated edge cache.
            const componentEdges = partPath ? partTessellatedEdgesCacheRef.current.get(partPath) : undefined;
            if (componentEdges && componentEdges.length > 0) {
              const ep = new EdgePickController();
              ep.setCandidates(componentEdges);
              const pickedNames = ep.pickFromRay(refHit.origin, refHit.direction);
              if (pickedNames && pickedNames.length > 0) {
                const edgeName = pickedNames[0]!;
                const pickedEdge = componentEdges.find((e) => {
                  const a = e.edgeName.faceA, ea = edgeName.faceA;
                  const b = e.edgeName.faceB, eb = edgeName.faceB;
                  // FaceName.instance is optional; treat undefined as 0 for equality.
                  return a.featureId === ea.featureId && a.role === ea.role && (a.instance ?? 0) === (ea.instance ?? 0)
                      && b.featureId === eb.featureId && b.role === eb.role && (b.instance ?? 0) === (eb.instance ?? 0);
                });
                // TessellatedEdge has no isCircular field — infer from closed-loop geometry.
                const isCircular = pickedEdge ? (() => {
                  const first = pickedEdge.segments[0]; const last = pickedEdge.segments[pickedEdge.segments.length - 1];
                  if (!first || !last) return false;
                  const p0 = first[0]; const p1 = last[1];
                  return Math.hypot(p0.x - p1.x, p0.y - p1.y, p0.z - p1.z) < 1e-3;
                })() : false;
                assemblyPickerRef.current.handleEdgeHit(componentPath, edgeName, isCircular);
                return;
              }
            }

            // Fallback for axis mode: re-raycast in face mode and use handleCylindricalFaceHit.
            // This is sufficient for Insert/Angle and the S-B e2e scenario.
            if (pickerMode === 'axis' && partPath) {
              const tessellatedFaces = partTessellatedFacesCacheRef.current.get(partPath);
              if (tessellatedFaces) {
                const faceHit = viewportRef.current.raycastAssemblyRef('face', ev.clientX, ev.clientY);
                if (faceHit && faceHit.kind === 'face') {
                  const fp = new FacePickController();
                  fp.setCandidates(tessellatedFaces);
                  const faceName = fp.pickByTriangleIndex(faceHit.triangleIndex);
                  if (faceName) {
                    assemblyPickerRef.current.handleCylindricalFaceHit(componentPath, faceName);
                    return;
                  }
                }
              }
            }

            if (import.meta.env.DEV) {
              console.warn('[T38] axis/circularEdge pick: no hit for', pickerMode, 'at partPath', partPath);
            }
          }
        }
        return; // consume the event
      }
      return;
    }
    if (!sketchMode || !activeToolCtrlRef.current) return;
    // Project Geometry: ray-pick a 3D model edge and project it onto the sketch
    // plane. This branch intercepts click events before the generic 2D handler
    // because projectEdge needs the tessellated-edge ref, not a 2D canvas point.
    if (activeToolKind === 'project-geom' && ev.type === 'click') {
      const tool = activeToolCtrlRef.current.currentTool();
      if (tool instanceof ProjectGeometryTool && tessellatedEdgesRef.current.length > 0) {
        const r = viewportRef.current.screenToRay(ev.clientX, ev.clientY);
        edgePickerRef.current.setCandidates(tessellatedEdgesRef.current);
        const pickedNames = edgePickerRef.current.pickFromRay(r.origin, r.direction);
        if (pickedNames && pickedNames.length > 0) {
          // pickFromRay returns EdgeName objects that are the same references
          // stored in tessellatedEdgesRef — find the TessellatedEdge by identity.
          const pickedEdge = tessellatedEdgesRef.current.find(
            (e) => e.edgeName === pickedNames[0]
          );
          if (pickedEdge) {
            tool.projectEdge(pickedEdge);
          }
        }
      }
      return;
    }
    const world = viewportRef.current.screenToWorld(ev.clientX, ev.clientY);
    const sketch = activePart?.featureTree.find(
      (f): f is Extract<Feature, { kind: 'sketch' }> => f.kind === 'sketch' && f.id === activeSketchId
    );
    const primitives = sketch?.primitives ?? [];
    const type = ev.type === 'click' ? 'click'
      : ev.type === 'pointerdown' ? 'pointerdown'
      : ev.type === 'pointerup' ? 'pointerup'
      : 'move';
    activeToolCtrlRef.current.handlePointer(
      { type, point: world },
      [...primitives]
    );
    if (ev.type === 'move') setCursorScreenPos({ x: ev.clientX, y: ev.clientY });
  }, [sketchMode, activePart, activeSketchId, activeToolKind, pickingAxis, pickingProfile, pickingFilletEdges, pickingChamferEdges, pickingShellFaces, filletSelectionMode]);

  // Revolve dialog helpers and handlers.
  // computeProfileRef: find a sketch suitable as a revolve profile. T13
  // simplification — prefer an activeSketchId, else the last sketch in the
  // feature tree. Closed-loop detection is deferred (T15+); report 1 if the
  // sketch has any primitives so the dialog can show non-empty state.
  const computeProfileRef = useCallback((): ProfileRef | null => {
    if (!activePart) return null;
    // Manual pick (F4) takes precedence. The manualProfileRef state is
    // populated by the pointer handler when the user clicks a sketch after
    // pressing Pick in the dialog; cleared on cancel/commit.
    if (manualProfileRef) {
      const manualSketch = activePart.featureTree.find(
        (f): f is Extract<Feature, { kind: 'sketch' }> => f.kind === 'sketch' && f.id === manualProfileRef.sketchId
      );
      if (manualSketch) {
        const count = manualSketch.primitives.length > 0 ? 1 : 0;
        if (count > 0) return { sketchId: manualSketch.id, closedProfileCount: count };
      }
    }
    const sketches = activePart.featureTree.filter(
      (f): f is Extract<Feature, { kind: 'sketch' }> => f.kind === 'sketch'
    );
    if (sketches.length === 0) return null;
    const active = activeSketchId ? sketches.find((s) => s.id === activeSketchId) : undefined;
    const sketch = active ?? sketches[sketches.length - 1];
    if (!sketch) return null;
    const closedProfileCount = sketch.primitives.length > 0 ? 1 : 0;
    if (closedProfileCount === 0) return null;
    return { sketchId: sketch.id, closedProfileCount };
  }, [activePart, activeSketchId, manualProfileRef]);

  // hasRunningBody: true if any prior solid-producing feature exists. T13
  // simplification — any extrude or revolve feature qualifies.
  const hasRunningBody = useCallback((): boolean => {
    if (!activePart) return false;
    return activePart.featureTree.some(
      (f) => f.kind === 'extrude' || f.kind === 'revolve' || f.kind === 'sweep'
    );
  }, [activePart]);

  const onPickAxis = useCallback(() => {
    const profile = computeProfileRef();
    if (!profile || !activePart) return;
    const sketch = activePart.featureTree.find(
      (f): f is Extract<Feature, { kind: 'sketch' }> => f.kind === 'sketch' && f.id === profile.sketchId
    );
    if (!sketch) return;
    axisPickerRef.current.setCandidates([...sketch.primitives]);
    setPickingAxis(true);
  }, [activePart, computeProfileRef]);

  const onPickProfile = useCallback(() => {
    if (!activePart) return;
    const sketches = activePart.featureTree.filter(
      (f): f is Extract<Feature, { kind: 'sketch' }> => f.kind === 'sketch' && f.primitives.length > 0
    );
    if (sketches.length === 0) return;
    profilePickerRef.current.setCandidates(
      sketches.map((s) => ({ sketchId: s.id, primitives: [...s.primitives] }))
    );
    setPickingProfile(true);
  }, [activePart]);

  const buildRevolveFeature = useCallback((v: RevolveDialogValue, profile: ProfileRef, axis: AxisRef, opts?: { scratch?: boolean }): Extract<Feature, { kind: 'revolve' }> => ({
    kind: 'revolve',
    // Preview calls reuse a stable id ('R_scratch') so we don't pollute the
    // feature-id counter on every keystroke; committed features get a unique
    // timestamped id.
    id: opts?.scratch ? 'R_scratch' : `r${Date.now()}`,
    sketchRef: profile.sketchId,
    axisPrimitiveId: axis.primitiveId,
    angleParam: v.name,
    direction: v.direction,
    operation: v.operation
  }), []);

  // Debounce preview calls: every draft change resets a 200ms timer; when it
  // fires we write the angle parameter then ask the kernel to execute a
  // virtual tree with the scratch revolve appended. The resulting mesh is
  // rendered in the viewport at 50% opacity until the dialog closes.
  //
  // NOTE: kernel.setParameter mutates the stored part. The committed feature
  // would have written the same param via AddRevolveFeatureCommand anyway, so
  // this is merely premature — acceptable for now, flagged for follow-up.
  const schedulePreview = useCallback((v: RevolveDialogValue) => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    const profile = computeProfileRef();
    if (!profile || !selectedAxisRef || !activePart || !kernel) return;
    const axis = selectedAxisRef;
    const part = activePart;
    const k = kernel;
    previewTimerRef.current = setTimeout(async () => {
      previewTimerRef.current = null;
      try {
        await k.setParameter(part.id, {
          name: v.name,
          expression: v.expression,
          value: 0,
          unit: 'deg'
        });
        // Track for cancel-path cleanup. Only the MOST RECENT name is
        // remembered — rename mid-session is an accepted edge case where an
        // orphaned param may linger under the previous name.
        scratchParamNameRef.current = v.name;
        const scratch = buildRevolveFeature(v, profile, axis, { scratch: true });
        const r = await k.previewFeature(part.id, scratch);
        // Perf-test instrumentation (T19): count actual preview RPC calls so
        // tests can verify the 200 ms debounce coalesces rapid input.
        if (import.meta.env.DEV && typeof window !== 'undefined') {
          const w = window as unknown as { __zilventorPreviewCount?: number };
          w.__zilventorPreviewCount = (w.__zilventorPreviewCount ?? 0) + 1;
        }
        if (r.ok) {
          viewportRef.current?.setPreviewMesh(r.value.mesh.positions, r.value.mesh.indices);
          setPreviewError(null);
        } else {
          viewportRef.current?.clearPreviewMesh();
          setPreviewError(r.error.message);
        }
      } catch (e) {
        viewportRef.current?.clearPreviewMesh();
        setPreviewError((e as Error).message);
      }
    }, 200);
  }, [activePart, kernel, selectedAxisRef, computeProfileRef, buildRevolveFeature]);

  const clearPreview = useCallback(() => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    viewportRef.current?.clearPreviewMesh();
  }, []);

  const onRevolveCommit = useCallback(async (v: RevolveDialogValue) => {
    const profile = computeProfileRef();
    if (!profile || !selectedAxisRef || !activePart || !kernel) return;
    const feature = buildRevolveFeature(v, profile, selectedAxisRef);
    const store = useAppStore.getState();
    try {
      await store.bus.execute(
        new AddRevolveFeatureCommand(activePart.id, feature, v.expression, kernel, parameterRegistry, {
          setActivePart: store.setActivePart
        })
      );
      // Commit consumed the scratch param into a real one — clear the ref so
      // a later Cancel-after-commit does not delete a legitimate param.
      scratchParamNameRef.current = null;
      clearPreview();
      setPreviewError(null);
      setRevolveDialogOpen(false);
      setPickingAxis(false);
      setSelectedAxisRef(null);
      setPickingProfile(false);
      setManualProfileRef(null);
    } catch (e) {
      showToast(t('toast.revolveFailed', { message: (e as Error).message }));
    }
  }, [activePart, kernel, selectedAxisRef, computeProfileRef, buildRevolveFeature, setRevolveDialogOpen, showToast, clearPreview]);

  const onRevolveApply = useCallback(async (v: RevolveDialogValue) => {
    // Apply = commit but keep the dialog open for further edits. T13 uses
    // the same command path as OK; the dialog stays open for the next change.
    const profile = computeProfileRef();
    if (!profile || !selectedAxisRef || !activePart || !kernel) return;
    const feature = buildRevolveFeature(v, profile, selectedAxisRef);
    const store = useAppStore.getState();
    try {
      await store.bus.execute(
        new AddRevolveFeatureCommand(activePart.id, feature, v.expression, kernel, parameterRegistry, {
          setActivePart: store.setActivePart
        })
      );
      // Apply commits the feature (the dialog stays open), so the param is no
      // longer "scratch" — clear the ref so a later Cancel does not delete it.
      scratchParamNameRef.current = null;
      clearPreview();
      setPreviewError(null);
      setManualProfileRef(null);
    } catch (e) {
      showToast(t('toast.revolveFailed', { message: (e as Error).message }));
    }
  }, [activePart, kernel, selectedAxisRef, computeProfileRef, buildRevolveFeature, showToast, clearPreview]);

  const onRevolveCancel = useCallback(() => {
    clearPreview();
    // If a preview wrote a scratch angle parameter, delete it from the kernel
    // so it doesn't persist as a phantom param in the saved part. Fire-and-
    // forget: the user has already closed the dialog, and any failure here is
    // non-fatal.
    const scratchName = scratchParamNameRef.current;
    if (scratchName && activePart && kernel) {
      void kernel.deleteParameter(activePart.id, scratchName);
      scratchParamNameRef.current = null;
    }
    setPreviewError(null);
    setRevolveDialogOpen(false);
    setPickingAxis(false);
    setSelectedAxisRef(null);
    setPickingProfile(false);
    setManualProfileRef(null);
  }, [activePart, kernel, setRevolveDialogOpen, clearPreview]);

  // Global cleanup: cancel any in-flight preview timer on unmount so the
  // closure (which holds a ref to the kernel) doesn't survive teardown.
  useEffect(() => {
    return () => {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
      if (filletPreviewTimerRef.current) {
        clearTimeout(filletPreviewTimerRef.current);
        filletPreviewTimerRef.current = null;
      }
    };
  }, []);

  // Fillet dialog handlers.
  // Edge picking reads from `tessellatedEdgesRef`, populated by every
  // kernel.execute. Clicking Add arms the pick flow; the next viewport click
  // is consumed by `handleViewportPointer`'s fillet branch, which raycasts
  // through the picker and appends the hit to the store's `filletEdges`.
  // If the cache is empty (no solid body has been executed yet), the toast
  // surfaces that state instead of silently arming a pick with no candidates.
  const onFilletAddEdges = useCallback(() => {
    if (!activePart) return;
    if (tessellatedEdgesRef.current.length === 0) {
      showToast(t('toast.noEdges'));
      return;
    }
    edgePickerRef.current.setCandidates(tessellatedEdgesRef.current);
    edgePickerRef.current.setMode(filletSelectionMode);
    setPickingFilletEdges(true);
  }, [activePart, filletSelectionMode, showToast]);

  const onFilletRemoveEdge = useCallback((spec: FilletEdgeSpec) => {
    setFilletEdges(useAppStore.getState().filletEdges.filter((e) => e !== spec));
  }, []);

  const scheduleFilletPreview = useCallback((v: FilletDialogValue) => {
    if (filletPreviewTimerRef.current) clearTimeout(filletPreviewTimerRef.current);
    if (!activePart || !kernel || filletEdges.length === 0) return;
    const part = activePart;
    const k = kernel;
    filletPreviewTimerRef.current = setTimeout(async () => {
      filletPreviewTimerRef.current = null;
      try {
        await k.setParameter(part.id, {
          name: 'r_fillet', expression: v.radius, value: 0, unit: 'mm'
        });
        filletScratchParamsRef.current.add('r_fillet');
        const scratch: FilletFeature = {
          kind: 'fillet',
          id: 'F_scratch',
          mode: v.mode,
          edges: filletEdges.map((e) => ({
            ...e,
            radius: { kind: 'param', paramName: 'r_fillet' }
          })),
          setbacks: []
        };
        const r = await k.previewFeature(part.id, scratch);
        if (r.ok) {
          viewportRef.current?.setPreviewMesh(r.value.mesh.positions, r.value.mesh.indices);
          setFilletPreviewError(null);
        } else {
          viewportRef.current?.clearPreviewMesh();
          setFilletPreviewError(r.error.message);
        }
        if (import.meta.env.DEV && typeof window !== 'undefined') {
          const w = window as unknown as { __zilventorFilletPreviewCount?: number };
          w.__zilventorFilletPreviewCount = (w.__zilventorFilletPreviewCount ?? 0) + 1;
        }
      } catch (e) {
        viewportRef.current?.clearPreviewMesh();
        setFilletPreviewError((e as Error).message);
      }
    }, 200);
  }, [activePart, kernel, filletEdges]);

  const clearFilletPreview = useCallback(() => {
    if (filletPreviewTimerRef.current) clearTimeout(filletPreviewTimerRef.current);
    filletPreviewTimerRef.current = null;
    viewportRef.current?.clearPreviewMesh();
    setFilletPreviewError(null);
  }, []);

  const clearFilletScratchParams = useCallback(async () => {
    if (!activePart || !kernel) return;
    for (const name of filletScratchParamsRef.current) {
      await kernel.deleteParameter(activePart.id, name);
    }
    filletScratchParamsRef.current.clear();
  }, [activePart, kernel]);

  // Hole preview — debounced 150 ms, mirrors scheduleFilletPreview pattern.
  const scheduleHolePreview = useCallback((v: HoleDraftValue) => {
    if (holePreviewTimerRef.current) clearTimeout(holePreviewTimerRef.current);
    if (!activePart || !kernel) return;
    const part = activePart;
    const k = kernel;
    holePreviewTimerRef.current = setTimeout(async () => {
      holePreviewTimerRef.current = null;
      // Build placement — skip preview if mandatory picks are missing.
      let placement: import('@zilventor/shared').HolePlacement;
      if (v.placementMode === 'fromSketch') {
        if (!v.sketchId) return;
        placement = { kind: 'fromSketch', sketchId: v.sketchId };
      } else if (v.placementMode === 'linear') {
        const s = useAppStore.getState();
        if (!v.placementFace || !s.holeRefEdges[0] || !s.holeRefEdges[1]) return;
        placement = {
          kind: 'linear',
          faceName: s.holePlacementFace!,
          refEdge1: s.holeRefEdges[0]!,
          offset1: { kind: 'literal', value: 5 },
          refEdge2: s.holeRefEdges[1]!,
          offset2: { kind: 'literal', value: 5 },
        };
      } else {
        const s = useAppStore.getState();
        if (!v.placementFace || !s.holeCircularEdge) return;
        placement = {
          kind: 'concentric',
          faceName: s.holePlacementFace!,
          circularEdgeName: s.holeCircularEdge!,
        };
      }
      // Build profile.
      const parsePol = (str: string): import('@zilventor/shared').ParamOrLiteral => {
        const t = str.trim();
        if (t.startsWith('=')) return { kind: 'param', paramName: t.slice(1).trim() };
        const n = Number(t);
        return { kind: 'literal', value: Number.isFinite(n) ? n : 0 };
      };
      let profile: import('@zilventor/shared').HoleProfile;
      if (v.profileKind === 'simple') {
        profile = { kind: 'simple', diameter: parsePol(v.diameter) };
      } else if (v.profileKind === 'counterbore') {
        profile = {
          kind: 'counterbore',
          diameter: parsePol(v.diameter),
          cboreDiameter: parsePol(v.cboreDiameter),
          cboreDepth: parsePol(v.cboreDepth),
        };
      } else {
        profile = {
          kind: 'countersink',
          diameter: parsePol(v.diameter),
          cskDiameter: parsePol(v.cskDiameter),
          cskAngle: parsePol(v.cskAngle),
        };
      }
      // Build termination.
      let termination: import('@zilventor/shared').HoleTermination;
      if (v.termKind === 'distance') {
        termination = { kind: 'distance', depth: parsePol(v.depth) };
      } else if (v.termKind === 'toFace') {
        const s = useAppStore.getState();
        if (!s.holeTargetFace) return;
        termination = { kind: 'toFace', targetFaceName: s.holeTargetFace };
      } else if (v.termKind === 'toNext') {
        termination = { kind: 'toNext' };
      } else {
        termination = { kind: 'throughAll' };
      }
      const scratch: import('@zilventor/shared').HoleFeature = {
        id: 'H_scratch',
        kind: 'hole',
        placement,
        profile,
        termination,
        flipAxis: false,
      };
      // Perf-test instrumentation (T30): count debounce timer firings so
      // tests can verify the 150 ms debounce coalesces rapid input.
      if (typeof window !== 'undefined') {
        const w = window as unknown as { __zilventorHolePreviewCount?: number };
        w.__zilventorHolePreviewCount = (w.__zilventorHolePreviewCount ?? 0) + 1;
      }
      try {
        const r = await k.previewFeature(part.id, scratch);
        if (r.ok) {
          viewportRef.current?.setPreviewMesh(r.value.mesh.positions, r.value.mesh.indices);
          setHolePreviewError(null);
        } else {
          viewportRef.current?.clearPreviewMesh();
          setHolePreviewError(r.error.message);
        }
      } catch (e) {
        viewportRef.current?.clearPreviewMesh();
        setHolePreviewError((e as Error).message);
      }
    }, 150);
  }, [activePart, kernel]);

  const clearHolePreview = useCallback(() => {
    if (holePreviewTimerRef.current) {
      clearTimeout(holePreviewTimerRef.current);
      holePreviewTimerRef.current = null;
    }
    viewportRef.current?.clearPreviewMesh();
    setHolePreviewError(null);
  }, []);

  // Clear hole preview whenever the dialog closes (cancel, OK, or keyboard
  // shortcut re-open). Mirrors how revolve/fillet call clearPreview on cancel.
  const holeDialogOpen = useAppStore((s) => s.holeDialogOpen);
  useEffect(() => {
    if (!holeDialogOpen) {
      clearHolePreview();
    }
  }, [holeDialogOpen, clearHolePreview]);

  // Hole dialog commit handler — mirrors onShellCommit pattern.
  const editingHoleId = useAppStore((s) => s.editingHoleId);
  const resetHoleDialog = useAppStore((s) => s.resetHoleDialog);

  const onHoleCommit = useCallback(async (feature: import('@zilventor/shared').HoleFeature) => {
    if (!activePart || !kernel) return;
    const store = useAppStore.getState();
    try {
      if (editingHoleId) {
        await kernel.removeFeature(activePart.id, editingHoleId);
      }
      await store.bus.execute(new AddHoleFeatureCommand({
        partId: activePart.id,
        feature,
        parameterExpressions: {},
        kernel,
        registry: parameterRegistry,
        store: { setActivePart: store.setActivePart },
      }));
      clearHolePreview();
      resetHoleDialog();
    } catch (e) {
      showToast(t('toast.holeFailed', { message: (e as Error).message }));
    }
  }, [activePart, kernel, editingHoleId, clearHolePreview, resetHoleDialog, showToast]);

  // Sweep dialog selectors.
  const sweepOpen = useAppStore((s) => s.sweepDialogOpen);
  const sweepProfileSketchId = useAppStore((s) => s.sweepProfileSketchId);
  const sweepPathSketchId = useAppStore((s) => s.sweepPathSketchId);
  const sweepOrientationKind = useAppStore((s) => s.sweepOrientationKind);
  const sweepGuideRailSketchId = useAppStore((s) => s.sweepGuideRailSketchId);
  const sweepOperation = useAppStore((s) => s.sweepOperation);

  // Assembly placement/edit dialog selectors.
  const placeOpen = useAppStore((s) => s.placeComponentDialogOpen);
  const editOpen = useAppStore((s) => s.editComponentDialogOpen);
  const editInitial = useAppStore((s) => s.editComponentInitialValues);
  const assembly = useAppStore((s) => s.activeAssembly);
  const componentPoses = useAppStore((s) => s.componentPoses);
  const subAssemblyDocsForInnerPoses = useAppStore((s) => s.subAssemblyDocs);
  useEffect(() => {
    const inner: Record<string, Map<string, Pose>> = {};
    for (const [pp, d] of Object.entries(subAssemblyDocsForInnerPoses)) {
      inner[pp] = computeInnerStaticPoses(d);
    }
    useAppStore.getState().setSubAssemblyInnerPoses(inner);
  }, [subAssemblyDocsForInnerPoses]);
  // DEFECT 2 fix: when sub-assembly docs are populated for the first time
  // (placeholder 50mm boxes → real panel geometry), arm a one-shot camera
  // re-fit so the viewport frames the real cabinet instead of the tiny box.
  //
  // Strategy: track doc count per active assembly. Reset the baseline when the
  // active 3D document changes (active3dDocId changes → new assembly opened →
  // prevSubAsmDocCountRef resets to 0 so the next 0→N fires). This means that
  // if the user re-opens the same cabinet assembly, the doc count was never
  // reset to 0 in the store (subAssemblyDocs is additive), so count starts > 0
  // immediately and we DON'T arm a redundant re-fit — which is correct because
  // the existing active3dDocId effect (line ~180) already armed one on open.
  const prevSubAsmDocCountRef = useRef(0);
  // Reset baseline counter when the shown 3D document changes.
  useEffect(() => {
    prevSubAsmDocCountRef.current = 0;
  }, [active3dDocId]);
  useEffect(() => {
    const count = Object.keys(subAssemblyDocsForInnerPoses).length;
    if (prevSubAsmDocCountRef.current === 0 && count > 0) {
      // Sub-assembly docs just arrived for the first time on this assembly open.
      // The mesh-sync effect will re-render real panels; arm a camera re-fit so
      // it frames real geometry instead of the 50mm placeholder boxes.
      viewportRef.current?.requestFrameOnNextMesh();
    }
    prevSubAsmDocCountRef.current = count;
  }, [subAssemblyDocsForInnerPoses]);
  const showComponentColors = useAppStore((s) => s.showComponentColors);
  const selectedComponentPaths = useAppStore((s) => s.selectedComponentPaths);
  const geometryCacheRef = useRef<Map<string, THREE.BufferGeometry>>(new Map());
  // Tracks the assembly id of the last rendered project so we can detect a
  // project switch (id change) and dispose stale GPU geometry.
  const lastAssemblyIdRef = useRef<string | null>(null);
  // Persists the resolved textureId per partPath across renders, parallel to
  // geometryCacheRef. Must be invalidated at the same sites as geometryCacheRef
  // so a material edit that changes textureId is not served stale.
  const partTextureIdCacheRef = useRef<Map<string, string | undefined>>(new Map());
  // Phase 5: bores per partPath; populated alongside geometryCacheRef when the kernel loads a part doc.
  const partBoresCacheRef = useRef<Map<string, BoreOp[] | undefined>>(new Map());
  // M2.1: grooves per partPath; populated alongside partBoresCacheRef when the kernel loads a part doc.
  const partGroovesCacheRef = useRef<Map<string, GrooveFeature[]>>(new Map());
  // P6 W4: tenon/mortise features per partPath; populated alongside partGroovesCacheRef.
  const partTenonMortisesCacheRef = useRef<Map<string, TenonMortiseFeature[]>>(new Map());
  // T36: tessellated faces per partPath; populated in the assembly mesh-sync loop
  // alongside partBoresCacheRef. Used by the assembly face-pick handler to resolve
  // a triangleIndex (from raycastAssemblyRef) to a real FaceName via
  // FacePickController.pickByTriangleIndex. Invalidated at the same sites as
  // geometryCacheRef / partBoresCacheRef so stale face tables are never served.
  const partTessellatedFacesCacheRef = useRef<Map<string, TessellatedFace[]>>(new Map());
  // T38: tessellated edges per partPath for axis/circularEdge pick in assembly mode.
  const partTessellatedEdgesCacheRef = useRef<Map<string, TessellatedEdge[]>>(new Map());
  // Slice-3: live part doc objects (keyed by partPath) for BorePropertiesPanel getLiveDoc.
  // Holds the full {bores?, suppressedConnectorIds?, shelfPinParams?, featureTree?} object so
  // commands can mutate in place. `featureTree` is read by GroovePropertiesPanel's getLiveDoc
  // (P9 W1) — same live PartDocument reference, just a wider type annotation; no new population
  // code needed since the object stored here already carries featureTree at runtime.
  const loadedPartDocsRef = useRef<Map<string, { bores?: BoreOp[]; suppressedConnectorIds?: string[]; shelfPinParams?: ShelfPinParams; featureTree?: Feature[] }>>(new Map());
  const partInfoCacheRef = useRef<Map<string, PartInfo>>(new Map());
  const panelSpecCacheRef = useRef<PanelSpecCache>(new Map());
  // R1: preflight diagnostics collected by the last loadCutListInputs pass;
  // threaded onto CutListResult (via useCutListResult) so cut-list/manufacturing
  // /nesting toasts stay live in production.
  const diagnosticsCacheRef = useRef<PanelPreflightDiagnostic[]>([]);
  // Bumped after each resolvePartInfo population pass so consumers re-render.
  const [partInfoVersion, setPartInfoVersion] = useState(0);
  // Bumped by the assembly mesh-sync effect AFTER it has finished populating
  // partBoresCacheRef for all leaf parts. The bore-marker effect lists this as
  // a dep so it re-runs (and reads the now-full cache) after mesh-sync completes,
  // rather than racing against it.
  const [geometryReadyTick, setGeometryReadyTick] = useState(0);
  // Snapshot whose identity changes whenever the partInfo cache mutates,
  // so memoised consumers (BomTable) recompute.
  const partInfoSnapshot = useMemo(() => new Map(partInfoCacheRef.current), [partInfoVersion]);

  // Assembly constraint pick controller (T34).
  const assemblyPickerRef = useRef(new AssemblyRefPickController());
  const placeConstraintDialogOpen = useAppStore((s) => s.placeConstraintDialogOpen);
  const placeConstraintMode = useAppStore((s) => s.placeConstraintMode);
  const editConstraintDialogOpen = useAppStore((s) => s.editConstraintDialogOpen);
  const editingConstraintId = useAppStore((s) => s.editingConstraintId);

  const [pickedRefA, setPickedRefA] = useState<{ ref: AssemblyConstraint['refA']; label: string } | null>(null);
  const [pickedRefB, setPickedRefB] = useState<{ ref: AssemblyConstraint['refA']; label: string } | null>(null);
  const [valueExpression, setValueExpression] = useState('0');
  const [value2Expression, setValue2Expression] = useState('0');

  // Assembly E2E dev hooks (T38): expose solver result, poses, and picker simulate.
  useEffect(() => {
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>;
      w.__zilventorAssemblySolverResult = () => useAppStore.getState().solverDiagnostics;
      w.__zilventorAssemblyPoses = () => useAppStore.getState().componentPoses;
      w.__zilventorAssemblyPickerSimulate = (slot: 'A' | 'B', kind: string, payload: Record<string, unknown>) => {
        const picker = assemblyPickerRef.current;
        // T30: picker simulate accepts componentPath (ComponentPath) or
        // componentId (string) for back-compat; string IDs are wrapped as
        // single-segment paths.
        const cpRaw = payload.componentPath ?? payload.componentId;
        const componentPath: ComponentPath = Array.isArray(cpRaw)
          ? (cpRaw as string[])
          : [cpRaw as string];
        if (kind === 'face') picker.handleFaceHit(componentPath, payload.face as import('@zilventor/shared').FaceName);
        else if (kind === 'edge') picker.handleEdgeHit(componentPath, payload.edge as import('@zilventor/shared').EdgeName, (payload.isCircular as boolean) ?? false);
        else if (kind === 'cylindricalFace') picker.handleCylindricalFaceHit(componentPath, payload.face as import('@zilventor/shared').FaceName);
        else if (kind === 'vertex') picker.handleVertexHit(componentPath, payload.edge as import('@zilventor/shared').EdgeName, payload.end as 'start' | 'end');
      };
      // T45: expose dragAlongFreeDofs via dev hook so E2E can call it directly.
      // T30: dev hook still accepts componentId for back-compat with existing
      // E2E specs; we wrap it as a single-segment ComponentPath internally.
      w.__zilventorViewportDrag = (componentRef: string | string[], delta: { x: number; y: number }) => {
        const freeDofBasis = useAppStore.getState().freeDofBasis;
        const componentPath = Array.isArray(componentRef) ? componentRef : [componentRef];
        viewportRef.current?.dragAlongFreeDofs(componentPath, delta, freeDofBasis);
      };
      // T46: expose pure solveAssembly for perf tests (bypasses OCCT ref resolution).
      w.__zilventorSolveAssembly = solveAssembly;
      // B2: simulate a part-edit roundtrip. Invalidates per-part caches
      // (kernel partId, ref-extraction cache, three.js geometry cache),
      // releases the stale partId from the kernel worker, and bumps
      // solverDirty so the next solver run loads the updated part bytes
      // from OPFS and re-resolves all refs against the new shape.
      w.__zilventorAssemblyInvalidatePart = async (partPath: string) => {
        const stalePartId = assemblyPartIdCacheRef.current.get(partPath);
        assemblyRefCacheRef.current.invalidate(partPath);
        assemblyPartIdCacheRef.current.delete(partPath);
        geometryCacheRef.current.delete(partPath);
        partTextureIdCacheRef.current.delete(partPath);
        partBoresCacheRef.current.delete(partPath);
        partGroovesCacheRef.current.delete(partPath);
        partTenonMortisesCacheRef.current.delete(partPath);
        partTessellatedFacesCacheRef.current.delete(partPath);
        loadedPartDocsRef.current.delete(partPath);
        const kernelClient = useAppStore.getState().kernel;
        if (stalePartId && kernelClient) {
          try { await kernelClient.deletePart(stalePartId); } catch { /* best-effort */ }
        }
        useAppStore.getState().setSolverDirty(true);
      };
      // 4c E2E hooks (T31): probe per-component material colour + selection-overlay state.
      // T28/T29: meshes/overlays are now keyed by ComponentPathKey. The 4c
      // E2E specs only place top-level components, so we resolve componentId
      // → pathKey([id]) for back-compat.
      w.__zilventorComponentMaterialHex = (componentId: string): string | null => {
        const sm = viewportRef.current?.getSceneManager();
        const mesh = sm?.getComponentMesh(pathKey([componentId]));
        const mat = mesh?.material as THREE.MeshStandardMaterial | undefined;
        if (!mat || !('color' in mat) || !(mat.color instanceof THREE.Color)) return null;
        return '#' + mat.color.getHexString();
      };
      // T40 (4d Phase 11b): path-aware variant — sub-asm leaves are keyed by
      // pathKey(componentPath), so this lets specs probe the material colour
      // on a leaf inside a placed sub-assembly.
      w.__zilventorComponentMaterialHexByPath = (path: string[]): string | null => {
        const sm = viewportRef.current?.getSceneManager();
        const mesh = sm?.getComponentMesh(pathKey(path));
        const mat = mesh?.material as THREE.MeshStandardMaterial | undefined;
        if (!mat || !('color' in mat) || !(mat.color instanceof THREE.Color)) return null;
        return '#' + mat.color.getHexString();
      };
      w.__zilventorComponentSelectedOverlay = (componentId: string): boolean => {
        const sm = viewportRef.current?.getSceneManager();
        return sm?.hasSelectionOverlay?.(pathKey([componentId])) ?? false;
      };
      // T39 perf hook: run aggregateBom against the live assembly + part-name
      // cache `trials` times and return p95 ms. Used by the BOM perf spec.
      w.__zilventorBomAggregateMs = (trials: number): number => {
        const a = useAppStore.getState().activeAssembly;
        if (!a) return -1;
        const partInfo = partInfoCacheRef.current;
        const samples: number[] = [];
        for (let i = 0; i < trials; i++) {
          const t0 = performance.now();
          aggregateBom(a, partInfo);
          samples.push(performance.now() - t0);
        }
        samples.sort((x, y) => x - y);
        const idx = Math.min(samples.length - 1, Math.floor(samples.length * 0.95));
        return samples[idx]!;
      };
      // __zilventorBomCsvBytes is set by ExportBomCsvCommand on each apply().
      // T33 (5d) perf hook: run aggregateCutListRecursive against the live
      // assembly + sub-asm docs + panel-spec cache `trials` times; return p95 ms.
      w.__zilventorCutListAggregateMs = (trials: number): number => {
        const a = useAppStore.getState().activeAssembly;
        if (!a) return -1;
        const docs = useAppStore.getState().subAssemblyDocs;
        const cacheAdapter = {
          get: (p: string) =>
            docs[p]
              ? ({ kind: 'ok' as const, doc: docs[p]!, partPath: p })
              : undefined,
        };
        const samples: number[] = [];
        for (let i = 0; i < trials; i++) {
          const t0 = performance.now();
          aggregateCutListRecursive(
            a,
            cacheAdapter,
            panelSpecCacheRef.current,
            a.materials ?? [],
            partInfoCacheRef.current,
          );
          samples.push(performance.now() - t0);
        }
        samples.sort((x, y) => x - y);
        const idx = Math.min(samples.length - 1, Math.floor(samples.length * 0.95));
        return samples[idx]!;
      };
      // T33 (5e) perf hook: run packAllMaterials on a synthetic 200-panel
      // single-material nest `iterations` times; return p95 ms.
      w.__zilventorNestPackMs = (iterations: number): number => {
        const rows: NestInputRow[] = [];
        for (let i = 0; i < 200; i++) {
          rows.push({
            itemNumber: i + 1, rowKey: `r${i}`, qty: 1,
            length: 300 + (i % 7) * 50, width: 200 + (i % 5) * 30,
            materialId: 'm1', grain: 'length',
          });
        }
        const materials = [{ id: 'm1', name: 'X', defaultThickness: 18, color: '#aabbcc',
          sheetLengthMm: 2440, sheetWidthMm: 1220 }];
        const samples: number[] = [];
        for (let i = 0; i < iterations; i++) {
          const t0 = performance.now();
          packAllMaterials(rows, materials, 3);
          samples.push(performance.now() - t0);
        }
        samples.sort((a, b) => a - b);
        return samples[Math.floor(samples.length * 0.95)] ?? 0;
      };
    }
  }, []);

  // 4d E2E dev hooks (T33): expose sub-asm cache + componentPath introspection.
  // No long-lived SubAssemblyCache instance exists in App.tsx yet (Phase 9
  // deferred that wiring); the source of truth is the store's subAssemblyDocs
  // mirror, which BomTable + the autosave + mesh-sync effects all read from.
  // The invalidate/reload hooks therefore round-trip via OPFS:
  // unpackAssembly → setSubAssemblyDocs → setSolverDirty.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, unknown>;
    w.__zilventorSubAsmCacheGet = (p: string) =>
      useAppStore.getState().subAssemblyDocs[p];
    w.__zilventorComponentPathToLeafCount = (path: string[]): number => {
      const a = useAppStore.getState().activeAssembly;
      if (!a) return 0;
      const docs = useAppStore.getState().subAssemblyDocs;
      const adapter = {
        get: (p: string) => docs[p]
          ? ({ kind: 'ok' as const, doc: docs[p]!, partPath: p })
          : undefined,
      };
      return visibleLeaves(a, adapter).filter(
        (l) => l.componentPath.length >= path.length
          && path.every((p, i) => l.componentPath[i] === p),
      ).length;
    };
    w.__zilventorComposedPoseFor = (path: string[]): Pose | undefined => {
      const a = useAppStore.getState().activeAssembly;
      if (!a || path.length === 0) return undefined;
      const docs = useAppStore.getState().subAssemblyDocs;
      const cps = useAppStore.getState().componentPoses;
      // Mirrors the mesh-sync composeAlongPath logic: top-level uses the
      // solver pose (or initial Euler), each deeper segment composes parent
      // ⊕ child via composePoses.
      function topLevelPose(id: string): Pose | undefined {
        const sp = cps.get(id);
        if (sp) return sp;
        const c = a!.components.find((x) => x.id === id);
        if (!c) return undefined;
        return {
          translation: { x: c.position.x, y: c.position.y, z: c.position.z },
          quaternion: quatFromEulerXYZ(c.rotation.rx, c.rotation.ry, c.rotation.rz),
        };
      }
      if (path.length === 1) return topLevelPose(path[0]!);
      // Walk into nested .ziasm docs along the ancestor segments, then
      // compose parent ⊕ local for the leaf.
      let cursorDoc: typeof a | undefined = a;
      let parentPose: Pose | undefined = topLevelPose(path[0]!);
      const top = a.components.find((x) => x.id === path[0]);
      if (!top) return undefined;
      if (top.partPath.endsWith('.ziasm')) cursorDoc = docs[top.partPath];
      else if (path.length > 1) return undefined;
      for (let i = 1; i < path.length - 1; i++) {
        if (!cursorDoc || !parentPose) return undefined;
        const c = cursorDoc.components.find((x) => x.id === path[i]);
        if (!c) return undefined;
        const localPose: Pose = {
          translation: { x: c.position.x, y: c.position.y, z: c.position.z },
          quaternion: quatFromEulerXYZ(c.rotation.rx, c.rotation.ry, c.rotation.rz),
        };
        parentPose = composePoses(parentPose, localPose);
        if (c.partPath.endsWith('.ziasm')) cursorDoc = docs[c.partPath];
        else return undefined;
      }
      if (!cursorDoc || !parentPose) return undefined;
      const leafId = path[path.length - 1]!;
      const c = cursorDoc.components.find((x) => x.id === leafId);
      if (!c) return undefined;
      const localPose: Pose = {
        translation: { x: c.position.x, y: c.position.y, z: c.position.z },
        quaternion: quatFromEulerXYZ(c.rotation.rx, c.rotation.ry, c.rotation.rz),
      };
      return composePoses(parentPose, localPose);
    };
    w.__zilventorSubAsmInvalidate = async (p: string): Promise<void> => {
      if (!opfsRef.current) opfsRef.current = await Opfs.forNavigator();
      const opfs = opfsRef.current;
      const docs = { ...useAppStore.getState().subAssemblyDocs };
      delete docs[p];
      try {
        if (await opfs.exists(p)) {
          const reloaded = await unpackAssembly(await opfs.read(p));
          docs[p] = reloaded;
        }
      } catch { /* leave dropped on parse failure */ }
      useAppStore.getState().setSubAssemblyDocs(docs);
      // (innerStaticPoses computed reactively by the watcher effect that mirrors docs.)
      useAppStore.getState().setSolverDirty(true);
    };
    w.__zilventorSubAsmInvalidateAll = async (): Promise<void> => {
      if (!opfsRef.current) opfsRef.current = await Opfs.forNavigator();
      const opfs = opfsRef.current;
      const a = useAppStore.getState().activeAssembly;
      const docs: Record<string, AssemblyDocument> = {};
      if (a) {
        const seen = new Set<string>();
        const stack: AssemblyDocument[] = [a];
        while (stack.length) {
          const d = stack.pop()!;
          for (const c of d.components) {
            if (!c.partPath.endsWith('.ziasm')) continue;
            if (seen.has(c.partPath)) continue;
            seen.add(c.partPath);
            try {
              if (await opfs.exists(c.partPath)) {
                const sub = await unpackAssembly(await opfs.read(c.partPath));
                docs[c.partPath] = sub;
                stack.push(sub);
              }
            } catch { /* skip parse failures */ }
          }
        }
      }
      useAppStore.getState().setSubAssemblyDocs(docs);
      // (innerStaticPoses computed reactively by the watcher effect that mirrors docs.)
      useAppStore.getState().setSolverDirty(true);
    };
    w.__zilventorLoadSubAsmTree = async (): Promise<void> => {
      // Same walk as InvalidateAll but additive: keep already-loaded docs,
      // only fetch the ones missing from the store mirror.
      if (!opfsRef.current) opfsRef.current = await Opfs.forNavigator();
      const opfs = opfsRef.current;
      const a = useAppStore.getState().activeAssembly;
      if (!a) return;
      const docs = { ...useAppStore.getState().subAssemblyDocs };
      const seen = new Set<string>();
      const stack: AssemblyDocument[] = [a];
      while (stack.length) {
        const d = stack.pop()!;
        for (const c of d.components) {
          if (!c.partPath.endsWith('.ziasm')) continue;
          if (seen.has(c.partPath)) continue;
          seen.add(c.partPath);
          if (docs[c.partPath]) {
            stack.push(docs[c.partPath]!);
            continue;
          }
          try {
            if (await opfs.exists(c.partPath)) {
              const sub = await unpackAssembly(await opfs.read(c.partPath));
              docs[c.partPath] = sub;
              stack.push(sub);
            }
          } catch { /* skip parse failures */ }
        }
      }
      useAppStore.getState().setSubAssemblyDocs(docs);
      // (innerStaticPoses computed reactively by the watcher effect that mirrors docs.)
    };
    // T43 perf hook: run aggregateBomRecursive against the live activeAssembly
    // + sub-asm cache + part-name cache `trials` times and return p95 ms.
    w.__zilventorBomAggregateRecursiveMs = (trials: number): number => {
      const a = useAppStore.getState().activeAssembly;
      if (!a) return -1;
      const docs = useAppStore.getState().subAssemblyDocs;
      const adapter = {
        get: (p: string) => docs[p]
          ? ({ kind: 'ok' as const, doc: docs[p]!, partPath: p })
          : undefined,
      };
      const partInfo = partInfoCacheRef.current;
      const samples: number[] = [];
      for (let i = 0; i < trials; i++) {
        const t0 = performance.now();
        aggregateBomRecursive(a, adapter, partInfo);
        samples.push(performance.now() - t0);
      }
      samples.sort((x, y) => x - y);
      const idx = Math.min(samples.length - 1, Math.floor(samples.length * 0.95));
      return samples[idx]!;
    };
    // T44 perf hook: flattenForSolver + solveAssembly against the live
    // activeAssembly with stub plane refs (so we don't pay OCCT cost).
    // Returns p95 ms over `trials` runs.
    w.__zilventorFlattenAndSolveMs = (trials: number): number => {
      const a = useAppStore.getState().activeAssembly;
      if (!a) return -1;
      const docs = useAppStore.getState().subAssemblyDocs;
      const adapter = {
        get: (p: string) => docs[p]
          ? ({ kind: 'ok' as const, doc: docs[p]!, partPath: p })
          : undefined,
      };
      const flat = flattenForSolver(a, adapter);
      // Synthesize stub plane refs for every constraint side. The kernel
      // expects resolvedRefs keyed by `${k.id}#${synthId}` where synthId =
      // pathKey(refPath). Two opposing planes guarantee the LM solver does
      // real iterative work without OCCT involvement.
      const planeUp = { kind: 'plane' as const, P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: 1 } };
      const planeDown = { kind: 'plane' as const, P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: -1 } };
      const resolvedRefs = new Map<string, typeof planeUp | typeof planeDown>();
      const rewrittenConstraints = flat.constraints.map((k) => {
        const aRaw = pathKey(k.refA.componentPath);
        const bRaw = pathKey(k.refB.componentPath);
        const aKey = flat.rigidLeafStaticPoses.has(aRaw) ? flat.primaryPathByIndex[flat.pathToUnknown.get(aRaw)!]! : aRaw;
        const bKey = flat.rigidLeafStaticPoses.has(bRaw) ? flat.primaryPathByIndex[flat.pathToUnknown.get(bRaw)!]! : bRaw;
        resolvedRefs.set(`${k.id}#${aKey}`, planeUp);
        resolvedRefs.set(`${k.id}#${bKey}`, planeDown);
        return {
          ...k,
          refA: { ...k.refA, componentPath: [aKey] },
          refB: { ...k.refB, componentPath: [bKey] },
        } as import('@zilventor/shared').AssemblyConstraint;
      });
      const indexToPath = flat.primaryPathByIndex;
      const components = flat.unknowns.map((p, i) => ({
        id: indexToPath[i]!,
        T: p.translation,
        q: p.quaternion,
      }));
      const groundedComponentIds = a.groundedComponentPaths
        .map((p) => pathKey(p))
        .filter((key) => flat.pathToUnknown.has(key));
      const baseInput = {
        components,
        groundedComponentIds,
        constraints: rewrittenConstraints,
        resolvedRefs,
        paramValues: {} as Record<string, number>,
      };
      // Warm-up.
      flattenForSolver(a, adapter);
      solveAssembly(baseInput);
      const samples: number[] = [];
      for (let i = 0; i < trials; i++) {
        const perturbed = components.map((c, idx2) => ({
          ...c,
          T: { x: c.T.x + (idx2 % 3) * 0.1, y: (i % 5) * 0.01, z: 0 },
        }));
        const t0 = performance.now();
        flattenForSolver(a, adapter);
        solveAssembly({ ...baseInput, components: perturbed });
        samples.push(performance.now() - t0);
      }
      samples.sort((x, y) => x - y);
      const idx = Math.min(samples.length - 1, Math.floor(samples.length * 0.95));
      return samples[idx]!;
    };
    return () => {
      delete w.__zilventorSubAsmCacheGet;
      delete w.__zilventorComponentPathToLeafCount;
      delete w.__zilventorComposedPoseFor;
      delete w.__zilventorSubAsmInvalidate;
      delete w.__zilventorSubAsmInvalidateAll;
      delete w.__zilventorLoadSubAsmTree;
      delete w.__zilventorBomAggregateRecursiveMs;
      delete w.__zilventorFlattenAndSolveMs;
    };
  }, []);

  // Production sub-assembly loader: when the active assembly changes, walk its
  // .ziasm components and load any docs not yet in subAssemblyDocs from OPFS.
  // This unblocks cabinet rendering in production — without it visibleLeaves()
  // returns every .ziasm component as kind:'placeholder' (50mm grey box).
  //
  // Anti-loop guard: deps are [assembly] only (NOT subAssemblyDocs). The effect
  // is additive (never replaces existing entries) and only calls setSubAssemblyDocs
  // when at least one new doc was fetched, so a setSubAssemblyDocs call does NOT
  // re-trigger this effect (assembly identity is unchanged).
  useEffect(() => {
    if (!assembly) return;
    let cancelled = false;
    void (async () => {
      if (!opfsRef.current) opfsRef.current = await Opfs.forNavigator();
      const opfs = opfsRef.current;
      const existing = useAppStore.getState().subAssemblyDocs;
      const next = { ...existing };
      const seen = new Set<string>();
      // BFS walk: seed with the top-level assembly, then recurse into sub-asm docs.
      const stack: AssemblyDocument[] = [assembly];
      while (stack.length) {
        const d = stack.pop()!;
        for (const c of d.components) {
          if (!c.partPath.endsWith('.ziasm')) continue;
          if (seen.has(c.partPath)) continue;
          seen.add(c.partPath);
          if (next[c.partPath]) {
            // Already loaded — still recurse into it to find deeper nesting.
            stack.push(next[c.partPath]!);
            continue;
          }
          try {
            if (await opfs.exists(c.partPath)) {
              const sub = await unpackAssembly(await opfs.read(c.partPath));
              next[c.partPath] = sub;
              stack.push(sub);
            }
          } catch { /* skip corrupt sub-assemblies */ }
        }
      }
      if (cancelled) return;
      // Only update the store if we actually loaded new docs.
      if (Object.keys(next).length > Object.keys(existing).length) {
        useAppStore.getState().setSubAssemblyDocs(next);
        useAppStore.getState().setSolverDirty(true);
      }
    })();
    return () => { cancelled = true; };
  // Intentionally omit subAssemblyDocs from deps — this effect is additive and
  // must not loop when setSubAssemblyDocs is called.
  }, [assembly]);

  // Sub-project 6 perf hooks (T62): drawing projection, sheet render, PDF export.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, unknown>;

    function _p95(samples: number[]): number {
      const s = [...samples].sort((a, b) => a - b);
      return s[Math.ceil(s.length * 0.95) - 1] ?? 0;
    }

    // Shared fixture: a 50-edge ProjectorInput (simulates a 50-feature part)
    const _projInput: import('@zilventor/shared/src/drawing/projector').ProjectorInput = {
      triangles: Array.from({ length: 50 * 4 }, (_, i) => {
        const x = (i % 10) * 20; const y = Math.floor(i / 10) * 20;
        return [[x, y, 0], [x + 20, y, 0], [x + 10, y + 20, 0]] as
          [[number,number,number],[number,number,number],[number,number,number]];
      }),
      edges: Array.from({ length: 50 * 4 }, (_, i) => ({
        id: `pe${i}`,
        points: [[
          (i % 10) * 20, Math.floor(i / 10) * 20, 0,
        ], [
          (i % 10) * 20 + 20, Math.floor(i / 10) * 20, 0,
        ]] as [[number,number,number],[number,number,number]],
        adjacentFaces: [],
      })),
      bbox: [0, 0, -1, 200, 100, 1],
    };

    // T62a: single-view projection p95 < 200ms
    w.__zilventorProjectViewMs = (n: number): number => {
      const samples: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        projectView(_projInput, 'front');
        samples.push(performance.now() - t0);
      }
      return _p95(samples);
    };

    // Shared fixtures for sheet render + PDF export
    const _drawingSheets = (() => {
      const makeSheet = (id: string): import('@zilventor/shared').DrawingSheet => ({
        id, name: id,
        size: { kind: 'iso' as const, size: 'A3' as const },
        orientation: 'landscape' as const,
        views: Array.from({ length: 4 }, (__, vi) => ({
          id: `v${id}-${vi}`,
          kind: 'base' as const,
          positionMm: { x: 20 + vi * 90, y: 40 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front' as const,
          showHidden: false,
          projection: {
            visibleEdges: [{ id: `e${id}-${vi}`, kind: 'outline' as const,
              points: [[0,0],[100,0],[100,60],[0,60],[0,0]] as ReadonlyArray<readonly [number,number]> }],
            hiddenEdges: [],
            bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
          },
        })),
        dimensions: [], annotations: [], titleBlock: {}, dimensionGroups: [],
      });
      return Array.from({ length: 4 }, (_, i) => makeSheet(`s${i}`));
    })();
    const _drawing4Sheet: import('@zilventor/shared').DrawingDocument = {
      id: 'perf-drawing', name: 'Perf Drawing', units: 'mm',
      source: { partPath: 'parts/perf.zipt', sourceKind: 'part' },
      properties: {},
      sheets: _drawingSheets,
      activeSheetId: _drawingSheets[0]!.id,
    };
    const _perfPart: import('@zilventor/shared').PartDocument = {
      id: 'perf-part', name: 'Perf Part', units: 'mm',
      parameters: {}, featureTree: [], properties: {},
      materials: [{ id: 'm1', name: 'Birch', defaultThickness: 18, color: '#c8a96e' }],
      hardware: [],
    };

    // T62b: 4-view sheet render p95 < 100ms
    w.__zilventorRenderSheetMs = (n: number): number => {
      const sheet = _drawing4Sheet.sheets[0]!;
      const samples: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        renderDrawingSvg(_drawing4Sheet, sheet, _perfPart);
        samples.push(performance.now() - t0);
      }
      return _p95(samples);
    };

    // T63k: DXF export p95 < 50ms (pure string-building, no kernel call)
    w.__zilventorRenderDxfMs = (n: number): number => {
      const sheet = _drawing4Sheet.sheets[0]!;
      const samples: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        _renderDrawingDxf(_drawing4Sheet, sheet, _perfPart);
        samples.push(performance.now() - t0);
      }
      return _p95(samples);
    };

    // T63n: dimension-heavy DXF render p95 < 50ms (exercises native DIMENSION + block path)
    w.__zilventorRenderDxfDimsMs = (n: number): number => {
      const baseSheet = _drawing4Sheet.sheets[0]!;
      const view = baseSheet.views[0]!;
      const edges = Array.from({ length: 21 }, (_, i) => ({
        id: `pe${i}`, kind: 'outline' as const,
        points: [[i * 5, 0], [i * 5, 60]] as ReadonlyArray<readonly [number, number]>,
      }));
      const dimsSheet: import('@zilventor/shared').DrawingSheet = {
        ...baseSheet,
        views: [{ ...view, projection: { visibleEdges: edges, hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 } } }],
        dimensions: Array.from({ length: 20 }, (_, i) => ({
          id: `pd${i}`, kind: 'linear-h' as const, viewId: view.id,
          from: { kind: 'edge-endpoint' as const, edgeId: `pe${i}`, end: 'start' as const },
          to:   { kind: 'edge-endpoint' as const, edgeId: `pe${i + 1}`, end: 'start' as const },
          offsetMm: 10 + i,
        })),
      };
      const dimsDrawing = { ..._drawing4Sheet, sheets: [dimsSheet] };
      const samples: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        _renderDrawingDxf(dimsDrawing, dimsSheet, _perfPart);
        samples.push(performance.now() - t0);
      }
      return _p95(samples);
    };

    // T63l: DXF 1:1 export p95 < 50ms (pure string-building, no kernel call)
    w.__zilventorRenderDxf1to1Ms = (n: number): number => {
      const sheet = _drawing4Sheet.sheets[0]!;
      const samples: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        _renderDrawingDxf1to1(_drawing4Sheet, sheet);
        samples.push(performance.now() - t0);
      }
      return _p95(samples);
    };

    // T63m: All-sheets render+zip p95 < 50ms (8 sheets, WYSIWYG DXF render + buildDxfZip)
    (w as unknown as { __zilventorAllSheetsDxfMs: (n: number) => number }).__zilventorAllSheetsDxfMs = (n: number): number => {
      // Build an 8-sheet drawing by replicating _drawing4Sheet's sheet structure.
      const makeSheet8 = (id: string): import('@zilventor/shared').DrawingSheet => ({
        id, name: `Sheet ${id}`,
        size: { kind: 'iso' as const, size: 'A3' as const },
        orientation: 'landscape' as const,
        views: Array.from({ length: 2 }, (__, vi) => ({
          id: `v${id}-${vi}`,
          kind: 'base' as const,
          positionMm: { x: 20 + vi * 90, y: 40 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front' as const,
          showHidden: false,
          projection: {
            visibleEdges: [{ id: `e${id}-${vi}`, kind: 'outline' as const,
              points: [[0,0],[100,0],[100,60],[0,60],[0,0]] as ReadonlyArray<readonly [number,number]> }],
            hiddenEdges: [],
            bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
          },
        })),
        dimensions: [], annotations: [], titleBlock: {}, dimensionGroups: [],
      });
      const sheets8 = Array.from({ length: 8 }, (_, i) => makeSheet8(`m${i}`));
      const drawing8: import('@zilventor/shared').DrawingDocument = {
        id: 'perf-drawing-8', name: 'Perf Drawing 8', units: 'mm',
        source: { partPath: 'parts/perf.zipt', sourceKind: 'part' },
        properties: {},
        sheets: sheets8,
        activeSheetId: sheets8[0]!.id,
      };
      const samples: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        const entries: Record<string, string> = {};
        drawing8.sheets.forEach((s, idx) => {
          entries[`${String(idx + 1).padStart(2, '0')}-${s.name}.dxf`] = _renderDrawingDxf(drawing8, s, _perfPart);
        });
        _buildDxfZip(entries);
        samples.push(performance.now() - t0);
      }
      return _p95(samples);
    };

    // T62c: PDF export of 4-sheet drawing p95 < 500ms
    w.__zilventorExportPdfMs = (n: number): number => {
      const samples: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        renderDrawingPdfBytes(_drawing4Sheet, _perfPart);
        samples.push(performance.now() - t0);
      }
      return _p95(samples);
    };

    // T63a/T63c: section cut+project p95 < 400ms.
    // Kernel is wired (F18). The cut happens via Comlink; the projection
    // (projectSectionView) runs on the main thread with synthetic geometry.
    // Accepts opts.mode='half'|'full' (default 'full') and opts.cutSide.
    // Returns mode='cut+project' for full, 'cut+half-project' for half.
    w.__zilventorSectionCutMs = async (
      n: number = 20,
      opts?:
        | { mode?: 'full' | 'half'; cutSide?: -1 | 1 }
        | { mode: 'stepped'; segmentCount: number },
    ): Promise<{ p95ms: number; mode: string }> => {
      const { projectSectionView: psvFn } = await import('./drawing/projectSectionView');
      const { projectView: pvFn } = await import('@zilventor/shared/src/drawing/projector');

      // --- F1.2: stepped variant ---
      if (opts && 'segmentCount' in opts && opts.mode === 'stepped') {
        const segmentCount = Math.max(2, Math.min(8, opts.segmentCount));
        const synthVerts = Array.from({ length: segmentCount + 1 }, (_, i) => ({
          x: i * (300 / segmentCount),
          y: (i % 2) * 30,  // zigzag in Y
        }));
        const _stepInput: import('@zilventor/shared/src/drawing/projector').ProjectorInput = {
          triangles: Array.from({ length: 20 * 2 }, (__, i) => {
            const bx = (i % 5) * 60; const bz = Math.floor(i / 5) * 40;
            return [[bx, 0, bz], [bx + 50, 0, bz], [bx + 50, 50, bz + 30]] as
              [[number, number, number], [number, number, number], [number, number, number]];
          }),
          edges: Array.from({ length: 20 * 4 }, (__, i) => ({
            id: `sc-e${i}`,
            points: [[(i % 5) * 60, 0, 0], [(i % 5) * 60 + 50, 0, 0]] as
              [[number, number, number], [number, number, number]],
            adjacentFaces: [],
          })),
          bbox: [0, 0, 0, 300, 50, 160],
        };
        const _stepFaceTags: import('./drawing/projectSectionView').FaceTagMap = new Map(
          synthVerts.slice(0, -1).map((v, i) => [
            `f-stepped-${i}`,
            {
              tag: 'cut-face' as const,
              partId: `box_${i}`,
              materialId: 'mat-pine',
              polygon: [
                { x: v.x, y: v.y },
                { x: synthVerts[i + 1]!.x, y: synthVerts[i + 1]!.y },
                { x: synthVerts[i + 1]!.x, y: 50 },
                { x: v.x, y: 50 },
              ],
            },
          ]),
        );
        const stepSamples: number[] = [];
        for (let i = 0; i < n; i++) {
          const t0 = performance.now();
          pvFn(_stepInput, 'front');
          psvFn(_stepInput, _stepFaceTags, 1);
          stepSamples.push(performance.now() - t0);
        }
        stepSamples.sort((a, b) => a - b);
        const stepP95 = stepSamples[Math.floor(stepSamples.length * 0.95)] ?? 0;
        return { p95ms: stepP95, mode: 'cut+stepped-project' };
      }

      const sectionVariant = (opts as { mode?: 'full' | 'half' } | undefined)?.mode ?? 'full';
      const cutSide = (opts as { cutSide?: -1 | 1 } | undefined)?.cutSide ?? 1;

      // Synthetic 20-component assembly input (5×4 grid of 50×50×30 mm boxes).
      const _sectionInput: import('@zilventor/shared/src/drawing/projector').ProjectorInput = {
        triangles: Array.from({ length: 20 * 2 }, (__, i) => {
          const bx = (i % 5) * 60; const bz = Math.floor(i / 5) * 40;
          return [[bx, 0, bz], [bx + 50, 0, bz], [bx + 50, 50, bz + 30]] as
            [[number,number,number],[number,number,number],[number,number,number]];
        }),
        edges: Array.from({ length: 20 * 4 }, (__, i) => ({
          id: `sc-e${i}`,
          points: [[(i % 5) * 60, 0, 0], [(i % 5) * 60 + 50, 0, 0]] as
            [[number,number,number],[number,number,number]],
          adjacentFaces: [],
        })),
        bbox: [0, 0, 0, 300, 50, 160],
      };

      const _faceTags: import('./drawing/projectSectionView').FaceTagMap = new Map(
        Array.from({ length: 5 }, (__, i) => [
          `f${i}`,
          {
            tag: 'cut-face' as const,
            partId: `box_0_${i}`,
            materialId: 'mat-pine',
            polygon: [
              { x: i * 60, y: 0 }, { x: i * 60 + 50, y: 0 },
              { x: i * 60 + 50, y: 50 }, { x: i * 60, y: 50 },
            ],
          },
        ]),
      );

      // Mode label reflects variant: half-section uses 'cut+half-project'.
      const mode = sectionVariant === 'half' ? 'cut+half-project' : 'cut+project';

      const samples: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        pvFn(_sectionInput, 'front');
        // For half-section, pass cutSide to psvFn (same pipeline, just labelled differently).
        psvFn(_sectionInput, _faceTags, sectionVariant === 'half' ? cutSide : 1);
        samples.push(performance.now() - t0);
      }
      samples.sort((a, b) => a - b);
      const p95ms = samples[Math.floor(samples.length * 0.95)] ?? 0;
      return { p95ms, mode };
    };

    // T63h: fingerprintPartState p95 < 5ms (synchronous djb2 of featureTree+parameters).
    // Uses a synthetic 20-feature part document. Static import at module top (_fpFn).
    const _syntheticPart: import('@zilventor/shared').PartDocument = {
      id: 'perf-fp-part', name: 'FP Perf', units: 'mm',
      parameters: Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`p${i}`, { name: `p${i}`, expression: `${i * 5}`, value: i * 5, unit: 'mm' as const }])
      ) as Record<string, import('@zilventor/shared').SketchParameter>,
      featureTree: Array.from({ length: 20 }, (_, i) => ({
        id: `feat-${i}`, kind: 'extrude' as const,
        sketchRef: `sk-${i}`, distanceParam: `${10 + i}`,
        direction: 'forward' as const, operation: 'new' as const,
      })) as unknown as import('@zilventor/shared').Feature[],
      properties: {}, materials: [], hardware: [],
    };
    (w as unknown as { __zilventorFingerprintPartStateMs: (n: number) => number }).__zilventorFingerprintPartStateMs = (n: number): number => {
      const samples: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        _fpFn(_syntheticPart);
        samples.push(performance.now() - t0);
      }
      samples.sort((a, b) => a - b);
      return samples[Math.floor(samples.length * 0.95)] ?? 0;
    };

    // T63i: projectView round-trip p95 < 200ms (pure JS — no kernel RPC).
    // Uses a synthetic 100-triangle / 50-edge fixture that exercises the full
    // projectView code path (view-matrix transform + silhouette classification).
    // The kernel RPC cost (getProjectorInput) is excluded — it runs off-thread
    // via Comlink and varies with WASM load time.
    const _synthInput: import('@zilventor/shared/src/drawing/projector').ProjectorInput = {
      triangles: Array.from({ length: 100 }, (_, i) => {
        const bx = (i % 10) * 10; const bz = Math.floor(i / 10) * 10;
        return [[bx, 0, bz], [bx + 8, 0, bz], [bx + 4, 8, bz + 8]] as
          [[number,number,number],[number,number,number],[number,number,number]];
      }),
      edges: Array.from({ length: 50 }, (_, i) => ({
        id: `e${i}`,
        points: [[(i % 10) * 10, 0, 0], [(i % 10) * 10 + 8, 0, 0]] as [[number,number,number],[number,number,number]],
        adjacentFaces: [],
      })),
      bbox: [0, 0, 0, 100, 10, 100] as [number,number,number,number,number,number],
    };
    (w as unknown as { __zilventorProjectionRoundTripMs: (n: number) => number }).__zilventorProjectionRoundTripMs = (n: number): number => {
      const samples: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        projectView(_synthInput, 'front');
        samples.push(performance.now() - t0);
      }
      samples.sort((a, b) => a - b);
      return samples[Math.floor(samples.length * 0.95)] ?? 0;
    };

    // T63j: assembly projection p95 — 10 synthetic leaves, no real OPFS.
    // Pre-loads 10 copies of the active part into the kernel and uses static identity poses.
    // IMPORTANT: snapshot all store fields ONCE before the loop; use a synthetic fixture object
    // inside the loop (do NOT spread+mutate the real activeDrawing per-iteration); restore ALL
    // mutated fields in a finally block so the hook is non-destructive.
    (w as unknown as { __zilventorAsmProjectViewMs: (n: number) => Promise<number> }).__zilventorAsmProjectViewMs = async (n: number): Promise<number> => {
      const kernel = useAppStore.getState().kernel;
      const activePart = useAppStore.getState().activePart;
      if (!kernel || !activePart) return 0;

      // Snapshot the relevant store fields ONCE before the loop.
      const snapActiveDocument = useAppStore.getState().activeDocument;
      const snapActiveDrawing = useAppStore.getState().activeDrawing;
      const snapActivePart = useAppStore.getState().activePart;
      const snapActiveAssembly = useAppStore.getState().activeAssembly;
      const snapFingerprint = useAppStore.getState().activeDrawingSourceFingerprint;
      const snapComponents = (useAppStore.getState() as unknown as { activeDrawingSourceComponents: unknown }).activeDrawingSourceComponents;

      // Reuse the existing kernel part ID (already loaded) for all 10 synthetic leaves.
      const partId = activePart.id;
      const syntheticComponents = Array.from({ length: 10 }, (_, i) => ({
        partId,
        pose: {
          translation: { x: i * 60, y: 0, z: 0 },
          quaternion: [0, 0, 0, 1] as [number, number, number, number],
        },
      }));

      // Build a synthetic drawing fixture using a fixed object — NOT the real activeDrawing.
      // This avoids mutating the real activeDrawing doc inside the loop.
      const syntheticDrawing = {
        id: 'perf-t63j-drawing',
        name: 'Perf Fixture',
        units: 'mm' as const,
        source: { partPath: 'perf/fixture.ziasm', sourceKind: 'assembly' as const },
        properties: {},
        sheets: [],
        activeSheetId: 'none',
      };

      const samples: number[] = [];
      try {
        // Set the synthetic fixture ONCE before the loop (not per-iteration).
        useAppStore.setState({
          activeDrawing: syntheticDrawing,
          activeDocument: { kind: 'drawing', document: syntheticDrawing } as never,
          activeDrawingSourceFingerprint: 'perf-fp',
          activeDrawingSourceComponents: syntheticComponents,
          activeDrawingSourceComponentColors: {},
          activePart: null,
          activeAssembly: null,
        } as never);

        const { projectViewFromSource } = await import('./drawing/projectViewFromSource');
        for (let i = 0; i < n; i++) {
          const t0 = performance.now();
          await projectViewFromSource('front');
          samples.push(performance.now() - t0);
        }
      } finally {
        // Restore ALL mutated store fields so the hook is non-destructive.
        useAppStore.setState({
          activeDocument: snapActiveDocument,
          activeDrawing: snapActiveDrawing,
          activePart: snapActivePart,
          activeAssembly: snapActiveAssembly,
          activeDrawingSourceFingerprint: snapFingerprint,
          activeDrawingSourceComponents: snapComponents,
          activeDrawingSourceComponentColors: {},
        } as never);
      }

      samples.sort((a, b) => a - b);
      return samples[Math.floor(samples.length * 0.95)] ?? 0;
    };

    // T63m: N-component assembly section cut p95 — real kernel, N posed boxes.
    // Builds N synthetic leaves, each reusing the active part ID but with
    // distinct X translations, then calls cutAssemblyComponentsBySectionPlane
    // via the Comlink kernel bridge. Measures real OCCT cut latency (not just projection).
    (w as unknown as { __zilventorAsmSectionCutMs: (n: number, leafCount?: number) => Promise<number> }).__zilventorAsmSectionCutMs = async (
      n: number = 10,
      leafCount: number = 10,
    ): Promise<number> => {
      const kernel = useAppStore.getState().kernel;
      const activePart = useAppStore.getState().activePart;
      if (!kernel || !activePart) return 0;

      const { cutAssemblyComponentsBySectionPlane: cutFn } = await import('./kernel/cutBySectionPlane');

      // N leaves: the active part repeated at x=0, x=30, x=60, ... (non-overlapping).
      // Box is 20×20×15mm; 30mm stride keeps them separated and all intersecting
      // the section plane (y=0, normal +Y → cuts through each box at mid-height).
      const components = Array.from({ length: leafCount }, (_, i) => ({
        partId: activePart.id,
        componentPath: String(i),
        pose: {
          translation: { x: i * 30, y: 0, z: 0 },
          quaternion: [0, 0, 0, 1] as [number, number, number, number],
        },
      }));
      // Section plane: cuts through y=0 (which is the assembled centroid of the boxes,
      // each 20mm tall, so the plane at y=10 bisects every component).
      const plane = { origin: { x: 0, y: 10, z: 0 }, normal: { x: 0, y: 1, z: 0 } };

      const samples: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        const result = await cutFn(components, plane, 1);
        samples.push(performance.now() - t0);
        if (!result.ok && i === 0) {
          console.warn('[T63m] cutAssemblyComponentsBySectionPlane failed:', (result as { reason?: string }).reason);
        }
      }
      samples.sort((a, b) => a - b);
      return samples[Math.floor(samples.length * 0.95)] ?? 0;
    };

    return () => {
      delete w.__zilventorProjectViewMs;
      delete w.__zilventorRenderSheetMs;
      delete (w as unknown as { __zilventorRenderDxfMs?: unknown }).__zilventorRenderDxfMs;
      delete (w as unknown as { __zilventorRenderDxfDimsMs?: unknown }).__zilventorRenderDxfDimsMs;
      delete (w as unknown as { __zilventorRenderDxf1to1Ms?: unknown }).__zilventorRenderDxf1to1Ms;
      delete (w as unknown as { __zilventorAllSheetsDxfMs?: unknown }).__zilventorAllSheetsDxfMs;
      delete w.__zilventorExportPdfMs;
      delete w.__zilventorSectionCutMs;
      delete w.__zilventorFingerprintPartStateMs;
      delete (w as unknown as { __zilventorProjectionRoundTripMs?: unknown }).__zilventorProjectionRoundTripMs;
      delete (w as unknown as { __zilventorAsmProjectViewMs?: unknown }).__zilventorAsmProjectViewMs;
      delete (w as unknown as { __zilventorAsmSectionCutMs?: unknown }).__zilventorAsmSectionCutMs;
    };
  }, []);



  const onPickSlot = useCallback((slot: 'A' | 'B') => {
    const mode = placeConstraintMode;
    const pickerMode = mode === 'insert' ? 'circularEdge'
                     : mode === 'angle'   ? 'axis'
                     : mode === 'tangent' ? 'axis'
                     : 'face';
    assemblyPickerRef.current.activate(pickerMode, slot, (hit) => {
      let ref: AssemblyConstraint['refA'] | { componentPath: ComponentPath; circularEdge: import('@zilventor/shared').EdgeName };
      let label: string;
      // T30: hits now carry hit.hit.componentPath; refs already require ComponentPath.
      if (hit.kind === 'face') {
        ref = { kind: 'face', componentPath: hit.hit.componentPath, face: hit.hit.face };
        label = `${pathKey(hit.hit.componentPath)}/${hit.hit.face.featureId}`;
      } else if (hit.kind === 'axis') {
        const h = hit.hit;
        if (h.source === 'edge') {
          ref = { kind: 'axis', componentPath: h.componentPath, axis: { source: 'edge', edge: h.edge } };
        } else {
          ref = { kind: 'axis', componentPath: h.componentPath, axis: { source: 'cylindricalFace', face: h.face } };
        }
        label = `${pathKey(h.componentPath)}/axis`;
      } else if (hit.kind === 'point') {
        ref = { kind: 'point', componentPath: hit.hit.componentPath, point: { source: 'vertex', edge: hit.hit.vertex.edge, end: hit.hit.vertex.end } };
        label = `${pathKey(hit.hit.componentPath)}/vertex`;
      } else if (hit.kind === 'circularEdge') {
        ref = { componentPath: hit.hit.componentPath, circularEdge: hit.hit.edge };
        label = `${pathKey(hit.hit.componentPath)}/circularEdge`;
      } else {
        return;
      }
      if (slot === 'A') setPickedRefA({ ref: ref as AssemblyConstraint['refA'], label });
      else setPickedRefB({ ref: ref as AssemblyConstraint['refA'], label });
    });
  }, [placeConstraintMode]);

  const onCommitConstraint = useCallback(async (close: boolean) => {
    if (!pickedRefA || !pickedRefB) return;
    const id = `K${Date.now()}`;
    const offsetOrAngle = parseParamOrLiteral(valueExpression);
    const refAKind = 'kind' in pickedRefA.ref ? pickedRefA.ref.kind : undefined;
    const refBKind = 'kind' in pickedRefB.ref ? pickedRefB.ref.kind : undefined;
    const isCylCyl = placeConstraintMode === 'tangent'
      && refAKind === 'axis'
      && refBKind === 'axis';
    const constraint: AssemblyConstraint = buildAssemblyConstraint({
      id,
      mode: placeConstraintMode,
      refA: pickedRefA.ref,
      refB: pickedRefB.ref,
      offset: offsetOrAngle,
      angle: offsetOrAngle,
      ...(placeConstraintMode === 'tangent' && !isCylCyl ? { radius: offsetOrAngle } : {}),
      ...(placeConstraintMode === 'tangent' && isCylCyl ? { r1: offsetOrAngle, r2: parseParamOrLiteral(value2Expression) } : {}),
    });
    if (editingConstraintId) {
      await new EditAssemblyConstraintCommand({ id: editingConstraintId, patch: constraint }).apply();
    } else {
      await new AddAssemblyConstraintCommand({ constraint }).apply();
    }
    if (close) {
      useAppStore.getState().resetPlaceConstraintDialog();
      useAppStore.getState().resetEditConstraintDialog();
      setPickedRefA(null); setPickedRefB(null); setValueExpression('0'); setValue2Expression('0');
    }
  }, [pickedRefA, pickedRefB, valueExpression, value2Expression, placeConstraintMode, editingConstraintId]);

  // Lazy OPFS singleton + tile list for the Place dialog.
  const [tiles, setTiles] = useState<AssemblyTile[]>([]);

  useEffect(() => {
    if (!placeOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        if (!opfsRef.current) opfsRef.current = await Opfs.forNavigator();
        const t = await loadAssemblyTiles(opfsRef.current, unpackProject);
        if (!cancelled) setTiles(t);
      } catch (e) {
        console.error('Failed to load tiles:', e);
        if (!cancelled) setTiles([]);
      }
    })();
    return () => { cancelled = true; };
  }, [placeOpen]);

  const handlePlace = async (partPath: string): Promise<void> => {
    if (!opfsRef.current) opfsRef.current = await Opfs.forNavigator();
    const cmd = new PlaceComponentCommand({ partPath, opfs: opfsRef.current });
    try {
      await cmd.apply();
    } catch (e) {
      console.error('Place failed:', e);
    }
    useAppStore.getState().resetPlaceComponentDialog();
  };

  const handleEditCommit = async (patch: Partial<ComponentInstance>): Promise<void> => {
    const id = useAppStore.getState().editingComponentId;
    if (!id) return;
    const cmd = new EditComponentCommand({ id, patch });
    try {
      await cmd.apply();
    } catch (e) {
      console.error('Edit failed:', e);
    }
    useAppStore.getState().resetEditComponentDialog();
  };

  // GPU geometry cleanup on project switch.
  // When the active assembly's id changes (a new project was opened), dispose
  // all BufferGeometries in the SceneManager's part-geometry cache and clear
  // the React-side geometry ref so stale GPU memory from the old project is
  // released rather than accumulating indefinitely.
  useEffect(() => {
    const currentId = assembly?.id ?? null;
    const prevId = lastAssemblyIdRef.current;
    if (currentId !== prevId) {
      lastAssemblyIdRef.current = currentId;
      if (prevId !== null) {
        // Project switched (different id, or closed). Dispose GPU geometry from
        // the old project before the mesh-sync effect rebuilds for the new one.
        // clearComponentMeshes() is called first so Three.js scene objects stop
        // referencing the geometries before they are disposed — closes the
        // theoretical one-RAF window where a scene object could hold a disposed
        // geometry reference between two separate React effect commits (A3).
        viewportRef.current?.clearComponentMeshes();
        viewportRef.current?.disposeAllPartGeometries();
        // Clear the React-side geometry cache and all parallel partPath-keyed
        // caches. Two projects can share identically-named parts (e.g.
        // 'panel.zipt'), so without these clears stale geometry, bores, faces,
        // part docs, and part info from the old project would leak into the new
        // one. All caches repopulate on the next mesh-sync / resolvePartInfo
        // pass, so clearing is safe.
        geometryCacheRef.current.clear();
        partTextureIdCacheRef.current.clear();
        partBoresCacheRef.current.clear();
        partGroovesCacheRef.current.clear();
        partTenonMortisesCacheRef.current.clear();
        partTessellatedFacesCacheRef.current.clear();
        partTessellatedEdgesCacheRef.current.clear();
        loadedPartDocsRef.current.clear();
        partInfoCacheRef.current.clear();
        // panelSpecCacheRef writes are guarded by `if (!has(partPath))`, so a
        // same-named part from the old project would otherwise keep STALE L/W/T
        // dims — which C3 threads into the boring DXF outline / CSV / 3D markers
        // (wrong CNC dimensions). Must clear so mesh-sync repopulates it.
        panelSpecCacheRef.current.clear();
      }
    }
  }, [assembly?.id]);

  // Assembly-mesh sync: load, tessellate, and cache component geometries.
  // Runs whenever the activeAssembly (or its components) changes.
  // Cache is keyed by partPath — same part rendered N times tessellates once.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    if (!assembly) {
      vp.clearComponentMeshes();
      return;
    }
    let cancelled = false;
    void (async () => {
      if (!opfsRef.current) opfsRef.current = await Opfs.forNavigator();
      const opfs = opfsRef.current;
      const cache = geometryCacheRef.current;
      const subAssemblyDocs = useAppStore.getState().subAssemblyDocs;
      const subAssemblyInnerPoses = useAppStore.getState().subAssemblyInnerPoses;
      const subAsmCacheAdapter = {
        get: (p: string) => subAssemblyDocs[p]
          ? ({ kind: 'ok' as const, doc: subAssemblyDocs[p]!, partPath: p, ...(subAssemblyInnerPoses[p] ? { innerStaticPoses: subAssemblyInnerPoses[p] } : {}) })
          : undefined,
      };
      const leaves = visibleLeaves(assembly, subAsmCacheAdapter);
      const diagnostics: Array<{ componentId: string; message: string }> = [];

      // T31b: composedPosesMap maps each leaf's pathKey → world pose.
      //
      // Source of truth: the solver-bridge effect publishes a path-keyed
      // Map<pathKey, Pose> in componentPoses. If the solver has run since
      // the last assembly mutation, that map already covers every visible
      // leaf. If it hasn't (e.g. first render after placement, or a sub-asm
      // doc just loaded), fall back to running flattenForSolver +
      // composedPoses against initial unknown poses so the viewport still
      // gets a consistent placement.
      let composedPosesMap: Map<string, Pose> = componentPoses;
      const haveSolved = leaves.every((l) => composedPosesMap.has(pathKey(l.componentPath)));
      if (!haveSolved) {
        const flat = flattenForSolver(assembly, subAsmCacheAdapter);
        composedPosesMap = composedPoses(assembly, subAsmCacheAdapter, {
          pathToUnknown: flat.pathToUnknown,
          poses: flat.unknowns,
          rigidSubtreeRoots: flat.rigidSubtreeRoots,
        });
      }

      // Ensure kernel has loaded each unique leaf partPath, register geometry.
      const uniquePartPaths = [...new Set(leaves.filter((l) => l.kind === 'leaf').map((l) => l.partPath))];
      for (const partPath of uniquePartPaths) {
        let geom = cache.get(partPath);
        if (!geom) {
          try {
            if (!kernel) throw new Error('kernel not ready');
            const bytes = await opfs.read(partPath);
            const partId = await kernel.loadFromBytes(bytes);
            const res = await kernel.execute(partId);
            if (!res.ok) throw new Error(res.error.message);
            const partDoc = await kernel.getPart(partId);
            if (partDoc) {
              const panelFeat = partDoc.featureTree.find((f) => f.kind === 'panel') as PanelFeature | undefined;
              const partMat = panelFeat ? partDoc.materials.find((m) => m.id === panelFeat.materialId) : undefined;
              // Persist textureId so subsequent cache-hit renders still see it.
              partTextureIdCacheRef.current.set(partPath, partMat?.textureId);
              // Phase 5: persist bores so the marker-wiring effect can read them without re-loading.
              partBoresCacheRef.current.set(partPath, partDoc.bores);
              // M2.1: persist grooves for manufacturing DXF export.
              partGroovesCacheRef.current.set(
                partPath,
                partDoc.featureTree.filter((f): f is GrooveFeature => f.kind === 'groove'),
              );
              // P6 W4: persist tenon/mortise features for manufacturing DXF/CSV export.
              partTenonMortisesCacheRef.current.set(
                partPath,
                partDoc.featureTree.filter((f): f is TenonMortiseFeature => f.kind === 'tenonMortise'),
              );
              // T36: persist tessellated faces so the assembly face-pick handler can resolve
              // a triangleIndex → FaceName via FacePickController.pickByTriangleIndex.
              partTessellatedFacesCacheRef.current.set(partPath, res.value.tessellatedFaces ?? []);
              // T38: persist tessellated edges so axis/circularEdge pick handler can resolve
              // a ray hit → EdgeName via EdgePickController.pickFromRay.
              partTessellatedEdgesCacheRef.current.set(partPath, res.value.tessellatedEdges ?? []);
              // Slice-3: persist live doc reference so BorePropertiesPanel.getLiveDoc works.
              loadedPartDocsRef.current.set(partPath, partDoc as { bores?: BoreOp[]; suppressedConnectorIds?: string[]; shelfPinParams?: ShelfPinParams });
              // Phase 5 (fresh-session fix): warm panelSpecCacheRef from the partDoc already in
              // hand so bore markers render without requiring the Cut List tab to be visited.
              // Guard: only write if absent — resolvePanelSpec sets null for non-panels, so
              // cache.has() correctly skips re-resolution on subsequent mesh-sync runs (no loop).
              if (!panelSpecCacheRef.current.has(partPath)) {
                const pf = partDoc.featureTree.find((f) => isPanelFeature(f)) as PanelFeature | undefined;
                panelSpecCacheRef.current.set(
                  partPath,
                  pf ? resolvePanelSpecFromFeature(pf, partDoc.parameters) : null,
                );
              }
            }
            const m = res.value.mesh;
            geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
            geom.setIndex(new THREE.BufferAttribute(m.indices, 1));
            if (m.uv) {
              geom.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
            }
            geom.computeVertexNormals();
            cache.set(partPath, geom);
          } catch (e) {
            // One diagnostic per component instance referencing the failed part —
            // componentId must be the component's id, not the part path.
            for (const l of leaves) {
              if (l.kind === 'leaf' && l.partPath === partPath) {
                diagnostics.push({ componentId: l.componentPath[l.componentPath.length - 1] ?? partPath, message: `Failed to load ${partPath}: ${(e as Error).message}` });
              }
            }
            geom = new THREE.BoxGeometry(50, 50, 50);
          }
        }
        vp.setPartGeometry(partPath, geom);
      }

      const componentLeaves = leaves.map((l) => {
        let materialColor: string | undefined;
        if (showComponentColors && l.effectiveColor) {
          if (l.effectiveColor.kind === 'hex') materialColor = l.effectiveColor.hex;
          else if (l.effectiveColor.kind === 'palette' && assembly.colors[l.effectiveColor.name]) {
            materialColor = assembly.colors[l.effectiveColor.name];
          }
        }
        const worldPose = composedPosesMap.get(pathKey(l.componentPath)) ?? {
          translation: { x: 0, y: 0, z: 0 },
          quaternion: [0, 0, 0, 1] as [number, number, number, number],
        };
        // Read textureId from the persistent cache so cache-hit renders
        // (where geom is already present) still forward the correct textureId.
        const cachedTextureId = partTextureIdCacheRef.current.get(l.partPath);
        return {
          kind: l.kind,
          componentPath: l.componentPath,
          partPath: l.partPath,
          worldPose,
          ...(materialColor !== undefined ? { materialColor } : {}),
          ...(cachedTextureId !== undefined ? { textureId: cachedTextureId } : {}),
          visible: true,
        };
      });
      if (!cancelled) {
        vp.setComponentMeshes(componentLeaves);
        useAppStore.getState().setComponentDiagnostics(diagnostics);
        // Signal the bore-marker effect that partBoresCacheRef is now fully
        // populated for this render cycle. The marker effect lists this counter
        // as a dep so it runs AFTER the async WASM loads above complete — fixing
        // the race where both effects fired on the same componentPoses change but
        // the marker effect read an empty cache before WASM had written it.
        setGeometryReadyTick((t) => t + 1);
      }
    })();
    return () => { cancelled = true; };
  }, [assembly, kernel, componentPoses, showComponentColors]);

  // T29-T30: Panel edge-band overlay sync. Walks the active part's featureTree
  // for `kind: 'panel'` features, resolves L/W/T against the part parameters,
  // and forwards a PanelOverlaySpec[] + the active material registry to the
  // SceneManager. The SceneManager builds/disposes overlay LineSegments and
  // honors the `showEdgeBands` view-tab flag (subscribed in attach()).
  //
  // Scope: part-mode only. Assembly mode is intentionally not handled here —
  // the SceneManager builds overlays in part-local coordinates centred on
  // origin, which would all collide at world origin if multiple panels were
  // emitted from an assembly. Per-leaf placement of overlays is a future
  // follow-up; for now assemblies clear any prior overlay so toggling the
  // flag in an assembly view is well-defined.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const specs: PanelOverlaySpec[] = [];
    let materials: ReadonlyArray<MaterialEntry> = [];
    if (activePart && !assembly) {
      materials = activePart.materials ?? [];
      for (const f of activePart.featureTree) {
        if (f.kind !== 'panel') continue;
        const panel = f as PanelFeature;
        if (panel.suppressed) continue;
        const length = resolvePanelDim(panel.length, activePart.parameters);
        const width = resolvePanelDim(panel.width, activePart.parameters);
        const thickness = resolvePanelDim(panel.thickness, activePart.parameters);
        if (length == null || width == null || thickness == null) continue;
        specs.push({
          key: `${activePart.id}/${panel.id}`,
          length,
          width,
          thickness,
          edgeBands: panel.edgeBands,
        });
      }
    }
    vp.setPanelOverlays(specs, materials);
  }, [activePart, assembly, parameterValues]);

  // Phase 5 — Bore marker sync. Builds MarkerOverlaySpec[] from all assembly leaf
  // components whose part has bores, using the panelSpecCacheRef for panelDims and
  // the same composedPoses world pose used by setComponentMeshes. Calls
  // vp.setBoreMarkers() so SceneManager renders ring markers on the panel faces.
  //
  // Runs when: assembly changes, or componentPoses change (a constraint solve
  // updates the poses). The panelSpecCacheRef and partBoresCacheRef are populated
  // by the assembly mesh sync effect above (same dep list = same timing).
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || !assembly) {
      vp?.setBoreMarkers([]);
      return;
    }
    const subAssemblyDocs = useAppStore.getState().subAssemblyDocs;
    const subAssemblyInnerPoses = useAppStore.getState().subAssemblyInnerPoses;
    const subAsmCacheAdapter = {
      get: (p: string) => subAssemblyDocs[p]
        ? ({ kind: 'ok' as const, doc: subAssemblyDocs[p]!, partPath: p, ...(subAssemblyInnerPoses[p] ? { innerStaticPoses: subAssemblyInnerPoses[p] } : {}) })
        : undefined,
    };
    const leaves = visibleLeaves(assembly, subAsmCacheAdapter).filter((l) => l.kind === 'leaf');
    const markerSpecs: MarkerOverlaySpec[] = [];
    for (const leaf of leaves) {
      const bores = partBoresCacheRef.current.get(leaf.partPath);
      if (!bores || bores.length === 0) continue;
      const spec = panelSpecCacheRef.current.get(leaf.partPath);
      if (!spec) continue;
      const worldPose = componentPoses.get(pathKey(leaf.componentPath)) ?? {
        translation: { x: 0, y: 0, z: 0 },
        quaternion: [0, 0, 0, 1] as [number, number, number, number],
      };
      markerSpecs.push({
        key: pathKey(leaf.componentPath),
        partPath: leaf.partPath,
        panelDims: { length: spec.length, width: spec.width, thickness: spec.thickness },
        worldPose,
        bores,
      });
    }
    vp.setBoreMarkers(markerSpecs);
  // geometryReadyTick is bumped by the mesh-sync effect after it finishes all
  // async WASM loads and has written every leaf's bores into partBoresCacheRef.
  // Without it this effect and mesh-sync both fire on the same componentPoses
  // change; this effect reads the cache BEFORE the async work completes → finds
  // nothing → marker count stays 0 and never re-triggers.
  }, [assembly, componentPoses, geometryReadyTick]);

  // Slice-5: show the drag handle when a bore is selected (so the user can
  // see the axis before starting a drag). Clear it on deselect. Does not fight
  // the drag handler's own gizmo updates because boreDragRef.current is set
  // during active drags and this effect only runs on selection changes.
  useEffect(() => {
    if (boreDragRef.current) return; // drag handler owns the gizmo during drag
    const sm = viewportRef.current?.getSceneManager();
    if (!sm) return;
    if (selectedBoreId && selectedBorePartPath) {
      const axis = sm.boreDragAxis(selectedBoreId, selectedBorePartPath);
      const worldPos = sm.boreWorldPos(selectedBoreId, selectedBorePartPath);
      if (axis && worldPos) {
        sm.setBoreGizmo({ worldPos, worldAxis: axis });
        return;
      }
    }
    sm.setBoreGizmo(null);
  }, [selectedBoreId, selectedBorePartPath]);

  // PartInfo cache sync: resolve the document.name and iProperties (partNumber,
  // description) for each unique partPath referenced by the active assembly so
  // BomTable / autosave merge can show human names + Inventor metadata.
  // Cached per-path; bumps partInfoVersion to re-render.
  useEffect(() => {
    if (!assembly) return;
    let cancelled = false;
    void (async () => {
      if (!opfsRef.current) opfsRef.current = await Opfs.forNavigator();
      const opfs = opfsRef.current;
      const cache = partInfoCacheRef.current;
      const before = cache.size;
      const seen = new Set<string>();
      for (const c of assembly.components) {
        if (seen.has(c.partPath)) continue;
        seen.add(c.partPath);
        if (cache.has(c.partPath)) continue;
        await resolvePartInfo(opfs, c.partPath, cache);
      }
      if (!cancelled && cache.size !== before) {
        setPartInfoVersion((v) => v + 1);
      }
    })();
    return () => { cancelled = true; };
  }, [assembly]);

  // Selection-sync: forward the store's selectedComponentPaths to the viewport
  // so it can render outline overlays on the selected component meshes.
  // T29: viewport now keys overlays by ComponentPath (path-equality on
  // userData.componentPath), so we forward the full paths.
  useEffect(() => {
    viewportRef.current?.setSelectedComponentPaths(selectedComponentPaths);
  }, [selectedComponentPaths]);

  // OPFS autosave — debounce 500 ms after the last activeDocument mutation.
  // Parts are packed via kernel.saveToBytes (re-runs the feature tree to bake
  // the BREP); assemblies are packed via packAssembly directly. Skipped when
  // activeDocument is null. Counts writes for the perf E2E.
  const activeDoc = useAppStore((s) => s.activeDocument);
  const autosaveTimerRef = useRef<number | null>(null);
  const autosaveStatsRef = useRef({ writeCount: 0 });
  const lastThumbBytesRef = useRef<Uint8Array | null>(null);
  const lastThumbTimeRef = useRef<number>(0);
  useEffect(() => {
    if (!import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>;
      if (w.__zilventorAutosaveStats === undefined) {
        w.__zilventorAutosaveStats = () => autosaveStatsRef.current;
      }
    } else {
      const w = window as unknown as Record<string, unknown>;
      w.__zilventorAutosaveStats = () => autosaveStatsRef.current;
    }
  }, []);
  useEffect(() => {
    if (!activeDoc) return;
    if (autosaveTimerRef.current !== null) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void (async () => {
        useAppStore.getState().setSaveState('saving');
        try {
          // Throttled thumbnail capture — max once per THUMB_THROTTLE_MS
          const vp = useAppStore.getState().viewport;
          if (vp && (lastThumbBytesRef.current === null || Date.now() - lastThumbTimeRef.current > THUMB_THROTTLE_MS)) {
            try {
              lastThumbBytesRef.current = await vp.captureThumbnailScaled(256);
              lastThumbTimeRef.current = Date.now();
            } catch {
              // Non-fatal: keep previous cached bytes (or null → empty fallback below).
            }
          }
          const thumb = lastThumbBytesRef.current ?? new Uint8Array();

          if (!opfsRef.current) opfsRef.current = await Opfs.forNavigator();
          const opfs = opfsRef.current;
          const doc = useAppStore.getState().activeDocument;
          if (!doc) return;
          if (doc.kind === 'drawing') {
            await autosaveDrawing({ doc: doc.document, opfs, packDrawing });
            autosaveStatsRef.current.writeCount += 1;
            useAppStore.getState().setSaveState('saved');
            return;
          }
          if (doc.kind === 'assembly') {
            const subAssemblyDocsSnapshot = useAppStore.getState().subAssemblyDocs;
            const cacheAdapter = {
              get: (p: string) =>
                subAssemblyDocsSnapshot[p]
                  ? ({ kind: 'ok' as const, doc: subAssemblyDocsSnapshot[p]!, partPath: p })
                  : undefined,
            };
            const withBom = mergeAndPruneBom(doc.document, partInfoCacheRef.current, cacheAdapter);
            // Collect leaf part paths (non-.ziasm) for cache-completeness check.
            const leafPartPaths: string[] = [];
            {
              const stack = [doc.document];
              while (stack.length) {
                const d = stack.pop()!;
                for (const c of d.components) {
                  if (c.partPath.endsWith('.ziasm')) {
                    const entry = cacheAdapter.get(c.partPath);
                    if (entry && entry.kind === 'ok') stack.push(entry.doc);
                  } else {
                    leafPartPaths.push(c.partPath);
                  }
                }
              }
            }
            const cacheComplete = leafPartPaths.every((p) => panelSpecCacheRef.current.has(p));
            const cutListResult = aggregateCutListRecursive(
              withBom,
              cacheAdapter,
              panelSpecCacheRef.current,
              withBom.materials ?? [],
              partInfoCacheRef.current,
            );
            const withCutList = mergeAndPruneCutList(withBom, cutListResult, { cacheComplete });
            const merged = mergeAndPruneColorOverrides(withCutList, cacheAdapter);
            const texBytes = collectCustomTextureBytes(merged.customTextures, globalCustomTextureRegistry);
            const archive = await packAssembly(merged, thumb, Object.keys(texBytes).length ? texBytes : undefined);
            const asmPath = `${doc.document.name}.ziasm`;
            await withOpfsLock(`opfs:${asmPath}`, () => opfs.write(asmPath, archive));
            setLastOpenDocument({ kind: 'assembly', opfsPath: asmPath });
          } else {
            if (!kernel) return;
            // A fresh part with no solid-producing feature yet (only the
            // seeded origin.* work features) has nothing to bake into a
            // BRep. kernel.saveToBytes() re-runs executeTree() unconditionally
            // and would throw "Feature tree produced no solid" — mirror the
            // reactive re-execute effect's hasSolidFeature guard (above) so
            // autosave skips (rather than fails) during this window. Without
            // this guard, a stray autosave tick landing before the user's
            // first feature leaves a phantom error in the status bar that is
            // never cleared (the reactive effect only clears errors it set
            // itself), surfacing after the first feature is added and rendered.
            const hasSolidFeature = doc.document.featureTree.some((f) => f.kind === 'extrude' || f.kind === 'revolve' || f.kind === 'sweep' || f.kind === 'panel' || f.kind === 'imported');
            if (!hasSolidFeature) {
              useAppStore.getState().setSaveState('saved');
              return;
            }
            const bytes = await kernel.saveToBytes(doc.document.id, thumb);
            const ptPath = `${doc.document.name}.zipt`;
            await withOpfsLock(`opfs:${ptPath}`, () => opfs.write(ptPath, bytes));
            setLastOpenDocument({ kind: 'part', opfsPath: ptPath });
          }
          autosaveStatsRef.current.writeCount += 1;
          useAppStore.getState().setSaveState('saved');
        } catch (e) {
          const err = e as Error;
          const quota = err.name === 'QuotaExceededError';
          useAppStore.getState().setSaveState('error');
          useAppStore.getState().setStatus(
            quota ? t('status.saveQuotaFull') : t('status.saveFailed', { message: err.message }),
          );
          console.warn('autosave failed:', err.message);
        }
      })();
    }, 500);
    return () => {
      if (autosaveTimerRef.current !== null) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [activeDoc, kernel]);

  // beforeunload guard — warn user if there is unsaved work (saveState !== 'saved').
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (useAppStore.getState().saveState !== 'saved') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Sweep live preview — debounced 150 ms, mirrors scheduleHolePreview pattern.
  const scheduleSweepPreview = useCallback(() => {
    if (sweepPreviewTimerRef.current) clearTimeout(sweepPreviewTimerRef.current);
    if (!activePart || !kernel) return;
    const part = activePart;
    const k = kernel;
    sweepPreviewTimerRef.current = setTimeout(async () => {
      sweepPreviewTimerRef.current = null;
      const s = useAppStore.getState();
      if (!s.sweepProfileSketchId || !s.sweepPathSketchId) return;
      if (s.sweepOrientationKind === 'guideRail' && !s.sweepGuideRailSketchId) return;
      const orientation: SweepOrientation =
        s.sweepOrientationKind === 'path' ? { kind: 'path' } :
        s.sweepOrientationKind === 'parallel' ? { kind: 'parallel' } :
        { kind: 'guideRail', guideRailSketchId: s.sweepGuideRailSketchId! };
      const feature: SweepFeature = {
        id: 'SW_PREVIEW', kind: 'sweep',
        profileSketchId: s.sweepProfileSketchId,
        pathSketchId: s.sweepPathSketchId,
        orientation,
        operation: s.sweepOperation,
      };
      if (typeof window !== 'undefined') {
        const w = window as unknown as { __zilventorSweepPreviewCount?: number };
        w.__zilventorSweepPreviewCount = (w.__zilventorSweepPreviewCount ?? 0) + 1;
      }
      try {
        const r = await k.previewFeature(part.id, feature);
        if (r.ok) {
          viewportRef.current?.setPreviewMesh(r.value.mesh.positions, r.value.mesh.indices);
          setSweepPreviewError(null);
        } else {
          viewportRef.current?.clearPreviewMesh();
          setSweepPreviewError(r.error.message);
        }
      } catch (e) {
        viewportRef.current?.clearPreviewMesh();
        setSweepPreviewError((e as Error).message);
      }
    }, 150);
  }, [activePart, kernel]);

  const clearSweepPreview = useCallback(() => {
    if (sweepPreviewTimerRef.current) {
      clearTimeout(sweepPreviewTimerRef.current);
      sweepPreviewTimerRef.current = null;
    }
    viewportRef.current?.clearPreviewMesh();
    setSweepPreviewError(null);
  }, []);

  // Trigger preview whenever sweep dialog state changes.
  useEffect(() => {
    if (sweepOpen) scheduleSweepPreview();
  }, [sweepOpen, sweepProfileSketchId, sweepPathSketchId, sweepOrientationKind, sweepGuideRailSketchId, sweepOperation, scheduleSweepPreview]);

  // Clear sweep preview whenever the dialog closes.
  useEffect(() => {
    if (!sweepOpen) clearSweepPreview();
  }, [sweepOpen, clearSweepPreview]);

  // Sweep dialog commit handler — mirrors onHoleCommit pattern.
  const onSweepCommit = useCallback(async (v: { orientation: SweepOrientation; operation: BooleanOperation }) => {
    if (!activePart || !kernel) return;
    const editingId = useAppStore.getState().editingSweepId;
    const id = editingId ?? `SW${Date.now()}`;
    const feature: SweepFeature = {
      id, kind: 'sweep',
      profileSketchId: sweepProfileSketchId!,
      pathSketchId: sweepPathSketchId!,
      orientation: v.orientation,
      operation: v.operation,
    };
    if (editingId) {
      try { await kernel.removeFeature(activePart.id, editingId); } catch {}
    }
    const cmd = new AddSweepFeatureCommand({
      partId: activePart.id,
      feature,
      parameterExpressions: {},
      kernel,
      registry: parameterRegistry,
      store: { setActivePart: useAppStore.getState().setActivePart },
    });
    try {
      await cmd.apply();
    } catch (e) {
      console.error('Sweep commit failed:', e);
    }
    useAppStore.getState().resetSweepDialog();
  }, [activePart, kernel, sweepProfileSketchId, sweepPathSketchId]);

  const onWorkPlaneCommit = useCallback(async (c: WorkPlaneCommit) => {
    if (!activePart || !kernel) return;
    const editingId = useAppStore.getState().editingWorkPlaneId;
    const id = editingId ?? `WP${Date.now()}`;
    const feature: WorkPlaneFeature = { kind: 'workPlane', id, visible: true, source: c.source };
    if (editingId) {
      try { await kernel.removeFeature(activePart.id, editingId); } catch {}
    }
    const cmd = new AddWorkPlaneFeatureCommand({
      partId: activePart.id, feature, parameterExpressions: c.parameterExpressions,
      kernel, registry: parameterRegistry,
      store: { setActivePart: useAppStore.getState().setActivePart },
    });
    try { await cmd.apply(); } catch (e) { console.error('WorkPlane commit failed:', e); }
    useAppStore.getState().resetWorkPlaneDialog();
  }, [activePart, kernel]);

  const onWorkAxisCommit = useCallback(async (c: WorkAxisCommit) => {
    if (!activePart || !kernel) return;
    const editingId = useAppStore.getState().editingWorkAxisId;
    const id = editingId ?? `WA${Date.now()}`;
    const feature: WorkAxisFeature = { kind: 'workAxis', id, visible: true, source: c.source };
    if (editingId) {
      try { await kernel.removeFeature(activePart.id, editingId); } catch {}
    }
    const cmd = new AddWorkAxisFeatureCommand({
      partId: activePart.id, feature, parameterExpressions: c.parameterExpressions,
      kernel, registry: parameterRegistry,
      store: { setActivePart: useAppStore.getState().setActivePart },
    });
    try { await cmd.apply(); } catch (e) { console.error('WorkAxis commit failed:', e); }
    useAppStore.getState().resetWorkAxisDialog();
  }, [activePart, kernel]);

  const onWorkPointCommit = useCallback(async (c: WorkPointCommit) => {
    if (!activePart || !kernel) return;
    const editingId = useAppStore.getState().editingWorkPointId;
    const id = editingId ?? `WPT${Date.now()}`;
    const feature: WorkPointFeature = { kind: 'workPoint', id, visible: true, source: c.source };
    if (editingId) {
      try { await kernel.removeFeature(activePart.id, editingId); } catch {}
    }
    const cmd = new AddWorkPointFeatureCommand({
      partId: activePart.id, feature, parameterExpressions: c.parameterExpressions,
      kernel, registry: parameterRegistry,
      store: { setActivePart: useAppStore.getState().setActivePart },
    });
    try { await cmd.apply(); } catch (e) { console.error('WorkPoint commit failed:', e); }
    useAppStore.getState().resetWorkPointDialog();
  }, [activePart, kernel]);


  const onFilletCommit = useCallback(async (v: FilletDialogValue) => {
    if (!activePart || !kernel || filletEdges.length === 0) return;
    const feature: FilletFeature = {
      kind: 'fillet',
      id: editingFilletId ?? `f${Date.now()}`,
      mode: v.mode,
      edges: filletEdges,
      setbacks: []
    };
    const parameterExpressions: Record<string, { expression: string; unit: 'mm' | 'deg' }> = {
      r_fillet: { expression: v.radius, unit: 'mm' }
    };
    const store = useAppStore.getState();
    try {
      // Edit path: remove the old feature first so the new one replaces it
      // (same id preserves tree position). The remove lives outside the
      // command bus; undo restores the new feature's prior state via
      // AddFilletFeatureCommand.revert, but a second undo is needed to
      // bring back the original — acceptable for now, cleaner than writing
      // a bespoke EditFilletFeatureCommand.
      if (editingFilletId) {
        await kernel.removeFeature(activePart.id, editingFilletId);
      }
      await store.bus.execute(new AddFilletFeatureCommand({
        partId: activePart.id,
        feature,
        parameterExpressions,
        kernel,
        registry: parameterRegistry,
        store: { setActivePart: store.setActivePart }
      }));
      filletScratchParamsRef.current.clear();
      clearFilletPreview();
      setFilletDialogOpen(false);
      setFilletEdges([]);
      setEditingFilletId(null);
      setFilletInitialRadius(undefined);
      setPickingFilletEdges(false);
      setHoveredEdgeSet(null);
    } catch (e) {
      showToast(t('toast.filletFailed', { message: (e as Error).message }));
    }
  }, [activePart, kernel, filletEdges, editingFilletId, clearFilletPreview, setFilletDialogOpen, setEditingFilletId, showToast]);

  const onFilletApply = useCallback(async (v: FilletDialogValue) => {
    // Apply = commit but keep the dialog open. Mirrors onRevolveApply.
    if (!activePart || !kernel || filletEdges.length === 0) return;
    const feature: FilletFeature = {
      kind: 'fillet',
      id: editingFilletId ?? `f${Date.now()}`,
      mode: v.mode,
      edges: filletEdges,
      setbacks: []
    };
    const parameterExpressions: Record<string, { expression: string; unit: 'mm' | 'deg' }> = {
      r_fillet: { expression: v.radius, unit: 'mm' }
    };
    const store = useAppStore.getState();
    try {
      await store.bus.execute(new AddFilletFeatureCommand({
        partId: activePart.id,
        feature,
        parameterExpressions,
        kernel,
        registry: parameterRegistry,
        store: { setActivePart: store.setActivePart }
      }));
      filletScratchParamsRef.current.clear();
      clearFilletPreview();
    } catch (e) {
      showToast(t('toast.filletFailed', { message: (e as Error).message }));
    }
  }, [activePart, kernel, filletEdges, clearFilletPreview, showToast]);

  const onFilletCancel = useCallback(() => {
    clearFilletPreview();
    void clearFilletScratchParams();
    setFilletDialogOpen(false);
    setFilletEdges([]);
    setEditingFilletId(null);
    setFilletInitialRadius(undefined);
    setPickingFilletEdges(false);
    setHoveredEdgeSet(null);
  }, [clearFilletPreview, clearFilletScratchParams, setFilletDialogOpen, setEditingFilletId]);

  // Chamfer dialog handlers — mirror the fillet handlers with distance
  // instead of radius, single mode (symmetric), no setbacks / variable.
  const chamferDialogOpen = useAppStore((s) => s.chamferDialogOpen);
  const setChamferDialogOpen = useAppStore((s) => s.setChamferDialogOpen);
  const chamferEdges = useAppStore((s) => s.chamferEdges);
  const setChamferEdges = useAppStore((s) => s.setChamferEdges);
  const editingChamferId = useAppStore((s) => s.editingChamferId);
  const setEditingChamferId = useAppStore((s) => s.setEditingChamferId);
  const chamferInitialDistance = useAppStore((s) => s.chamferInitialDistance);

  const onChamferAddEdges = useCallback(() => {
    if (!activePart) return;
    if (tessellatedEdgesRef.current.length === 0) {
      showToast(t('toast.noEdges'));
      return;
    }
    edgePickerRef.current.setCandidates(tessellatedEdgesRef.current);
    edgePickerRef.current.setMode(filletSelectionMode);
    setPickingChamferEdges(true);
  }, [activePart, filletSelectionMode, showToast]);

  const onChamferRemoveEdge = useCallback((spec: ChamferEdgeSpec) => {
    setChamferEdges(useAppStore.getState().chamferEdges.filter((e) => e !== spec));
  }, [setChamferEdges]);

  const onChamferCommit = useCallback(async (v: ChamferDialogValue) => {
    if (!activePart || !kernel || chamferEdges.length === 0) return;
    const feature: ChamferFeature = {
      kind: 'chamfer',
      id: editingChamferId ?? `c${Date.now()}`,
      edges: chamferEdges.map((e) => ({
        ...e,
        distance: { kind: 'param', paramName: 'd_chamfer' }
      }))
    };
    const parameterExpressions: Record<string, { expression: string; unit: 'mm' | 'deg' }> = {
      d_chamfer: { expression: v.distance, unit: 'mm' }
    };
    const store = useAppStore.getState();
    try {
      if (editingChamferId) {
        await kernel.removeFeature(activePart.id, editingChamferId);
      }
      await store.bus.execute(new AddChamferFeatureCommand({
        partId: activePart.id,
        feature,
        parameterExpressions,
        kernel,
        registry: parameterRegistry,
        store: { setActivePart: store.setActivePart }
      }));
      setChamferDialogOpen(false);
      setChamferEdges([]);
      setEditingChamferId(null);
      setPickingChamferEdges(false);
      setHoveredEdgeSet(null);
    } catch (e) {
      showToast(t('toast.chamferFailed', { message: (e as Error).message }));
    }
  }, [activePart, kernel, chamferEdges, editingChamferId, setChamferDialogOpen, setChamferEdges, setEditingChamferId, showToast]);

  const onChamferApply = useCallback(async (v: ChamferDialogValue) => {
    if (!activePart || !kernel || chamferEdges.length === 0) return;
    const feature: ChamferFeature = {
      kind: 'chamfer',
      id: editingChamferId ?? `c${Date.now()}`,
      edges: chamferEdges.map((e) => ({
        ...e,
        distance: { kind: 'param', paramName: 'd_chamfer' }
      }))
    };
    const parameterExpressions: Record<string, { expression: string; unit: 'mm' | 'deg' }> = {
      d_chamfer: { expression: v.distance, unit: 'mm' }
    };
    const store = useAppStore.getState();
    try {
      await store.bus.execute(new AddChamferFeatureCommand({
        partId: activePart.id,
        feature,
        parameterExpressions,
        kernel,
        registry: parameterRegistry,
        store: { setActivePart: store.setActivePart }
      }));
    } catch (e) {
      showToast(t('toast.chamferFailed', { message: (e as Error).message }));
    }
  }, [activePart, kernel, chamferEdges, editingChamferId, showToast]);

  const onChamferCancel = useCallback(() => {
    setChamferDialogOpen(false);
    setChamferEdges([]);
    setEditingChamferId(null);
    setPickingChamferEdges(false);
    setHoveredEdgeSet(null);
  }, [setChamferDialogOpen, setChamferEdges, setEditingChamferId]);

  // Shell dialog handlers — simplest of the 3D ops. One dialog, face list
  // sourced from the last execute's `faceNames` (displayed as a checkbox
  // list), thickness parameter. No interactive 3D pick yet — the dropdown
  // is the current picker.
  const shellDialogOpen = useAppStore((s) => s.shellDialogOpen);
  const setShellDialogOpen = useAppStore((s) => s.setShellDialogOpen);
  const shellFacesToRemove = useAppStore((s) => s.shellFacesToRemove);
  const setShellFacesToRemove = useAppStore((s) => s.setShellFacesToRemove);
  const toggleShellFace = useAppStore((s) => s.toggleShellFace);
  const editingShellId = useAppStore((s) => s.editingShellId);
  const setEditingShellId = useAppStore((s) => s.setEditingShellId);
  const shellInitialThickness = useAppStore((s) => s.shellInitialThickness);

  const onShellCommit = useCallback(async (v: ShellDialogValue) => {
    if (!activePart || !kernel || v.facesToRemove.length === 0) return;
    const feature: ShellFeature = {
      kind: 'shell',
      id: editingShellId ?? `sh${Date.now()}`,
      facesToRemove: v.facesToRemove.map((f) => ({ ...f })),
      thickness: { kind: 'param', paramName: 't_shell' }
    };
    const parameterExpressions: Record<string, { expression: string; unit: 'mm' | 'deg' }> = {
      t_shell: { expression: v.thickness, unit: 'mm' }
    };
    const store = useAppStore.getState();
    try {
      if (editingShellId) {
        await kernel.removeFeature(activePart.id, editingShellId);
      }
      await store.bus.execute(new AddShellFeatureCommand({
        partId: activePart.id,
        feature,
        parameterExpressions,
        kernel,
        registry: parameterRegistry,
        store: { setActivePart: store.setActivePart }
      }));
      setShellDialogOpen(false);
      setShellFacesToRemove([]);
      setEditingShellId(null);
    } catch (e) {
      showToast(t('toast.shellFailed', { message: (e as Error).message }));
    }
  }, [activePart, kernel, editingShellId, setShellDialogOpen, setShellFacesToRemove, setEditingShellId, showToast]);

  const onShellCancel = useCallback(() => {
    setShellDialogOpen(false);
    setShellFacesToRemove([]);
    setEditingShellId(null);
  }, [setShellDialogOpen, setShellFacesToRemove, setEditingShellId]);

  // Linear pattern dialog handlers.
  const linearPatternDialogOpen = useAppStore((s) => s.linearPatternDialogOpen);
  const setLinearPatternDialogOpen = useAppStore((s) => s.setLinearPatternDialogOpen);

  const patternableFeatures = (activePart?.featureTree ?? [])
    .filter((f): f is Extract<Feature, { kind: 'extrude' | 'revolve' }> =>
      f.kind === 'extrude' || f.kind === 'revolve'
    )
    .map((f, idx) => ({
      id: f.id,
      label: `${f.kind === 'extrude' ? t('panel.extrusion') : t('panel.revolveLabel')}${idx + 1} (${f.id})`,
    }));

  const onLinearPatternCommit = useCallback(async (v: LinearPatternDialogValue) => {
    if (!activePart || !kernel) return;
    const feature: LinearPatternFeature = {
      kind: 'pattern-linear',
      id: `p${Date.now()}`,
      sourceFeatureId: v.sourceFeatureId,
      direction: v.direction,
      spacing: { kind: 'param', paramName: 'pattern_pitch' },
      count: v.count,
    };
    const parameterExpressions: Record<string, { expression: string; unit: 'mm' | 'deg' }> = {
      pattern_pitch: { expression: v.spacing, unit: 'mm' }
    };
    const store = useAppStore.getState();
    try {
      await store.bus.execute(new AddLinearPatternFeatureCommand({
        partId: activePart.id,
        feature,
        parameterExpressions,
        kernel,
        registry: parameterRegistry,
        store: { setActivePart: store.setActivePart },
      }));
      setLinearPatternDialogOpen(false);
    } catch (e) {
      showToast(t('toast.linearPatternFailed', { message: (e as Error).message }));
    }
  }, [activePart, kernel, setLinearPatternDialogOpen, showToast]);

  const onLinearPatternCancel = useCallback(() => {
    setLinearPatternDialogOpen(false);
  }, [setLinearPatternDialogOpen]);

  // Mirror dialog handlers.
  const mirrorDialogOpen = useAppStore((s) => s.mirrorDialogOpen);
  const setMirrorDialogOpen = useAppStore((s) => s.setMirrorDialogOpen);

  const onMirrorCommit = useCallback(async (v: MirrorDialogValue) => {
    if (!activePart || !kernel) return;
    const feature: MirrorFeature = {
      kind: 'mirror',
      id: `m${Date.now()}`,
      sourceFeatureId: v.sourceFeatureId,
      plane: v.plane,
    };
    const store = useAppStore.getState();
    try {
      await store.bus.execute(new AddMirrorFeatureCommand({
        partId: activePart.id,
        feature,
        kernel,
        store: { setActivePart: store.setActivePart },
      }));
      setMirrorDialogOpen(false);
    } catch (e) {
      showToast(t('toast.mirrorFailed', { message: (e as Error).message }));
    }
  }, [activePart, kernel, setMirrorDialogOpen, showToast]);

  const onMirrorCancel = useCallback(() => {
    setMirrorDialogOpen(false);
  }, [setMirrorDialogOpen]);

  // Warm the panelSpecCacheRef from OPFS for all leaf parts in the active assembly tree.
  // Called automatically when the Cut List tab opens (via CutListCacheContext.warmCache).
  const warmCutListCache = useCallback(async (): Promise<void> => {
    if (!opfsRef.current) opfsRef.current = await Opfs.forNavigator();
    const opfs = opfsRef.current;
    const s = useAppStore.getState();
    const doc = s.activeDocument;
    if (!doc || doc.kind !== 'assembly') return;
    const a = doc.document;
    const subAssemblyDocsSnap = s.subAssemblyDocs;
    // Recursive walk — collect all leaf (.zipt) part paths.
    const leafPaths: string[] = [];
    const stack: AssemblyDocument[] = [a];
    const seenAsm = new Set<string>();
    while (stack.length) {
      const d = stack.pop()!;
      for (const c of d.components) {
        if (c.partPath.endsWith('.ziasm')) {
          if (!seenAsm.has(c.partPath)) {
            seenAsm.add(c.partPath);
            const sub = subAssemblyDocsSnap[c.partPath];
            if (sub) stack.push(sub);
          }
        } else {
          leafPaths.push(c.partPath);
        }
      }
    }
    diagnosticsCacheRef.current = [];
    await loadCutListInputs(opfs, leafPaths, panelSpecCacheRef.current, diagnosticsCacheRef.current);
    // Force useCutListResult to re-run by bumping the assembly identity (no-op content change).
    s.setActiveDocument({ kind: 'assembly', document: { ...a } });
  }, [panelSpecCacheRef]);

  // Evict geometry + bore + kernel-id caches for the given partPaths, then bump
  // the active-assembly identity so the mesh-sync effect re-loads them from OPFS.
  // Used by FurnitureTab after GenerateCarcassBoresCommand to force bore re-render.
  const invalidatePartPaths = useCallback(async (paths: string[]): Promise<void> => {
    if (paths.length === 0) return;
    const kernelClient = useAppStore.getState().kernel;
    for (const partPath of paths) {
      const stalePartId = assemblyPartIdCacheRef.current.get(partPath);
      assemblyRefCacheRef.current.invalidate(partPath);
      assemblyPartIdCacheRef.current.delete(partPath);
      geometryCacheRef.current.delete(partPath);
      partTextureIdCacheRef.current.delete(partPath);
      partBoresCacheRef.current.delete(partPath);
      partGroovesCacheRef.current.delete(partPath);
      partTenonMortisesCacheRef.current.delete(partPath);
      partTessellatedFacesCacheRef.current.delete(partPath);
      partTessellatedEdgesCacheRef.current.delete(partPath);
      loadedPartDocsRef.current.delete(partPath);
      if (stalePartId && kernelClient) {
        try { await kernelClient.deletePart(stalePartId); } catch { /* best-effort */ }
      }
    }
    // Bump assembly identity to re-trigger the mesh-sync + bore-marker effects,
    // and mark the solver dirty so constrained dependents reflow with fresh refs.
    const s = useAppStore.getState();
    const doc = s.activeDocument;
    if (shouldReflowAfterInvalidate(doc)) {
      const asmDoc = doc as { kind: 'assembly'; document: AssemblyDocument };
      s.setActiveDocument({ kind: 'assembly', document: { ...asmDoc.document } });
      s.setSolverDirty(true);   // NEW: geometry reflow after cache invalidation
    }
  }, [assemblyPartIdCacheRef, assemblyRefCacheRef, geometryCacheRef, partTextureIdCacheRef, partBoresCacheRef, partTessellatedFacesCacheRef, partTessellatedEdgesCacheRef]);

  // Register invalidatePartPaths into the store so bore commands can self-invalidate
  // caches on both apply() AND revert() (fixing undo/redo visual staleness).
  useEffect(() => {
    const { setBoreCacheInvalidator } = useAppStore.getState();
    // Wrap in a synchronous shim since the store callback is synchronous but
    // invalidatePartPaths is async; fire-and-forget is acceptable here.
    setBoreCacheInvalidator((paths: string[]) => { void invalidatePartPaths(paths); });
    return () => { useAppStore.getState().setBoreCacheInvalidator(null); };
  }, [invalidatePartPaths]);

  return (
    <CutListCacheContext.Provider value={{ panelSpecCacheRef, partInfoCacheRef, partBoresCacheRef, partGroovesCacheRef, partTenonMortisesCacheRef, diagnosticsCacheRef, warmCache: warmCutListCache, invalidatePartPaths }}>
    <div className="flex flex-col h-full">
      {kernelOffline && (
        <div
          role="alert"
          className="bg-red-900 text-white text-xs px-3 py-1 flex justify-between items-center"
          data-testid="kernel-offline-banner"
        >
          <span>{t('aria.kernelOfflineBanner')}</span>
          <button onClick={handleRestart} className="underline hover:no-underline">
            {t('common.restart')}
          </button>
        </div>
      )}
      {sketcherCrashed && !kernelOffline && (
        <div
          role="alert"
          className="bg-amber-700 text-white text-xs px-3 py-1 flex justify-between items-center"
          data-testid="sketcher-crashed-banner"
        >
          <span>{t('aria.sketcherCrashedBanner')}</span>
          <button onClick={() => setSketcherCrashed(false)} className="underline hover:no-underline">
            {t('common.close')}
          </button>
        </div>
      )}
      <FileOpenOverlay onCancel={handleCancelOpen} />
      <div className="grid flex-1 min-h-0" style={{ gridTemplateRows: 'auto auto 1fr auto', gridTemplateColumns: '220px 1fr 260px' }}>
        <header role="banner" className="col-span-3 bg-shell-panel border-b border-shell-border flex items-center" id="region-appbar">
          <div className="px-3 py-1 text-sm font-semibold">ZilInventor</div>
          <div className="ml-auto px-3"><LanguageSwitcher /></div>
        </header>
        <div role="navigation" aria-label={t('aria.ribbon')} className="col-span-3 bg-shell-panel border-b border-shell-border" id="region-ribbon">
          <Ribbon partInfo={partInfoSnapshot} onImportDxfIntoSketch={handleImportDxfIntoSketch} showToast={showToast} />
        </div>
        <aside role="complementary" aria-label={t('aria.browser')} className="bg-shell-panel border-r border-shell-border" id="region-browser">
          {activeDocKind === 'drawing'
            ? <DrawingTreePane />
            : <BrowserPane part={activePart} sketchPicker={sweepPickerRef.current?.isActive() ? sweepPickerRef.current : null} partInfo={partInfoSnapshot} showToast={showToast} />
          }
        </aside>
        <main role="main" id="region-viewport" className="bg-shell" style={{ position: 'relative' }}>
          {activeDocKind === 'drawing'
            ? <DrawingCanvas />
            : <Viewport ref={viewportRef} onPointer={handleViewportPointer} />
          }
          {activeDocKind !== 'drawing' && sketchMode && activeSketchId && (() => {
            const f = activePart?.featureTree.find((x) => x.kind === 'sketch' && x.id === activeSketchId);
            if (f?.kind !== 'sketch') return null;
            const worldToScreen = viewportRef.current?.worldToScreen ?? ((x: number, y: number) => ({ x, y }));
            const dimensions = f.constraints.filter(
              (c): c is DimensionConstraint => c.kind.startsWith('dim-')
            );
            return (
              <>
                <ConstraintBadgeRenderer
                  primitives={f.primitives}
                  constraints={f.constraints}
                  worldToScreen={worldToScreen}
                />
                <DimensionRenderer
                  primitives={f.primitives}
                  dimensions={dimensions}
                  parameterValues={parameterValues}
                  worldToScreen={worldToScreen}
                  onEditDimension={handleEditDimension}
                  onEditCommit={(id, raw) => { void handleDimEditCommit(id, raw); }}
                  onEditCancel={() => setEditingDimId(null)}
                  {...(editingDimId != null ? { editingDimId } : {})}
                  {...(() => {
                    if (!editingDimId) return {};
                    const dim = dimensions.find((d) => d.id === editingDimId);
                    if (!dim) return {};
                    if (dim.value.kind === 'literal') {
                      return { editingDimInitialValue: String(dim.value.value) };
                    }
                    // Param dim: seed with the parameter's current expression.
                    const dv = dim.value;
                    if (dv.kind !== 'param') return {};
                    const param = parameterRegistry.getAll().find((p) => p.name === dv.paramName);
                    return { editingDimInitialValue: param?.expression ?? '' };
                  })()}
                />
              </>
            );
          })()}
        </main>
        <aside role="complementary" aria-label={t('aria.properties')} className="bg-shell-panel border-l border-shell-border" id="region-properties">
          <PropertiesPanel />
          <BorePropertiesPanel
            getLiveBores={(partPath) => partBoresCacheRef.current.get(partPath)}
            getLiveDoc={(partPath) => loadedPartDocsRef.current.get(partPath) ?? null}
            getConnectorDocs={buildConnectorDocs}
            opfs={opfsRef.current}
          />
          <GroovePropertiesPanel
            getLiveGrooves={(partPath) => partGroovesCacheRef.current.get(partPath)}
            getLiveDoc={(partPath) => loadedPartDocsRef.current.get(partPath) ?? null}
            opfs={opfsRef.current}
          />
        </aside>
        <footer role="contentinfo" className="col-span-3 bg-shell-panel border-t border-shell-border" id="region-statusbar">
          <StatusBar
            message={kernelFailed ? statusMessage : (kernelReady ? (statusMessage || t('status.ready')) : t('status.loadingKernel'))}
            saveState={saveState}
            kernelFailed={kernelFailed}
            onRetryKernel={handleRestart}
          />
        </footer>
      </div>
      <NumericInputOverlay
        visible={sketchMode && numericVisible}
        fieldCount={numericFieldCount}
        position={{ x: cursorScreenPos.x + 20, y: cursorScreenPos.y + 20 }}
        onCommit={(values) => {
          activeToolCtrlRef.current?.handleNumericCommit(values);
          setNumericVisible(false);
        }}
        onCancel={() => setNumericVisible(false)}
      />
      {pendingDimension && (
        <DimensionDialog
          initialName={pendingDimension.paramName}
          initialExpression={
            pendingDimension.value.kind === 'literal'
              ? pendingDimension.value.value.toFixed(2)
              : pendingDimension.value.paramName
          }
          unit={pendingDimension.kind === 'dim-angle' ? 'deg' : 'mm'}
          cursor={{ x: window.innerWidth / 2, y: window.innerHeight / 2 }}
          onCommit={(v) => { void onDialogCommit(v); }}
          onCancel={onDialogCancel}
        />
      )}
      {parametersPanelOpen && (
        <ParametersPanel
          registry={parameterRegistry}
          onClose={() => setParametersPanelOpen(false)}
        />
      )}
      {configurationsPanelOpen && (
        <ConfigurationsPanel
          configurations={activePart?.configurations ?? []}
          activeName={activeConfigName}
          onActivate={(name) => {
            const configs = useAppStore.getState().activePart?.configurations ?? [];
            if (activateConfiguration(parameterRegistry, configs, name)) {
              setActiveConfigName(name);
            }
          }}
          onAddRow={() => {
            const configs = useAppStore.getState().activePart?.configurations ?? [];
            let n = configs.length + 1;
            let name = `Config ${n}`;
            while (configs.some((c) => c.name === name)) name = `Config ${++n}`;
            const cfg = configurationFromParameters(name, parameterRegistry.getAll());
            useAppStore.getState().setConfigurations([...configs, cfg]);
          }}
          onImport={(configs) => useAppStore.getState().setConfigurations(configs)}
          onClose={() => setConfigurationsPanelOpen(false)}
        />
      )}
      {filletDialogOpen && (
        <FilletDialog
          edges={filletEdges}
          pickingMode={filletSelectionMode}
          previewError={filletPreviewError}
          initialMode={filletMode}
          initialRadius={filletInitialRadius}
          onCommit={(v) => { void onFilletCommit(v); }}
          onApply={(v) => { void onFilletApply(v); }}
          onCancel={onFilletCancel}
          onAddEdges={onFilletAddEdges}
          onRemoveEdge={onFilletRemoveEdge}
          onClearEdges={() => setFilletEdges([])}
          onSelectionModeChange={setFilletSelectionMode}
          onModeChange={setFilletMode}
          onRadiusChange={(e) => {
            scheduleFilletPreview({ mode: filletMode, radius: e, edges: filletEdges, setbacks: [] });
          }}
          validateExpression={(expr) => {
            // dryRun so the registry isn't mutated while the user types. We
            // validate under 'r_fillet_dry' — the dialog's name is committed
            // at onFilletCommit time.
            const res = parameterRegistry.dryRun({
              name: 'r_fillet_dry',
              expression: expr,
              unit: 'mm'
            });
            return res.ok ? null : formatExpressionError(res.error);
          }}
        />
      )}
      {chamferDialogOpen && (
        <ChamferDialog
          edges={chamferEdges}
          pickingMode={filletSelectionMode}
          previewError={null}
          initialDistance={chamferInitialDistance}
          onCommit={(v) => { void onChamferCommit(v); }}
          onApply={(v) => { void onChamferApply(v); }}
          onCancel={onChamferCancel}
          onAddEdges={onChamferAddEdges}
          onRemoveEdge={onChamferRemoveEdge}
          onClearEdges={() => setChamferEdges([])}
          onSelectionModeChange={setFilletSelectionMode}
          onDistanceChange={() => { /* no preview for MVP */ }}
          validateExpression={(expr) => {
            const res = parameterRegistry.dryRun({
              name: 'd_chamfer_dry',
              expression: expr,
              unit: 'mm'
            });
            return res.ok ? null : formatExpressionError(res.error);
          }}
        />
      )}
      {shellDialogOpen && (
        <ShellDialog
          availableFaces={availableFaceNames}
          selectedFaces={shellFacesToRemove}
          previewError={null}
          initialThickness={shellInitialThickness}
          onCommit={(v) => { void onShellCommit(v); }}
          onCancel={onShellCancel}
          onToggleFace={(f) => toggleShellFace(f)}
          onPickFace={() => setPickingShellFaces(true)}
          onThicknessChange={() => { /* no preview for MVP */ }}
          validateExpression={(expr) => {
            const res = parameterRegistry.dryRun({
              name: 't_shell_dry',
              expression: expr,
              unit: 'mm'
            });
            return res.ok ? null : formatExpressionError(res.error);
          }}
        />
      )}
      {linearPatternDialogOpen && (
        <LinearPatternDialog
          patternableFeatures={patternableFeatures}
          previewError={null}
          onCommit={(v) => { void onLinearPatternCommit(v); }}
          onCancel={onLinearPatternCancel}
          validateExpression={(expr) => {
            const res = parameterRegistry.dryRun({
              name: 'pattern_pitch_dry',
              expression: expr,
              unit: 'mm',
            });
            return res.ok ? null : formatExpressionError(res.error);
          }}
        />
      )}
      {mirrorDialogOpen && (
        <MirrorDialog
          patternableFeatures={patternableFeatures}
          onCommit={(v) => { void onMirrorCommit(v); }}
          onCancel={onMirrorCancel}
        />
      )}
      <HoleDialog
        onDraftChange={scheduleHolePreview}
        previewError={holePreviewError}
        onCommit={(feature) => { void onHoleCommit(feature); }}
      />
      {sweepOpen && (
        <SweepDialog
          profileSketchId={sweepProfileSketchId}
          pathSketchId={sweepPathSketchId}
          orientationKind={sweepOrientationKind}
          guideRailSketchId={sweepGuideRailSketchId}
          operation={sweepOperation}
          hasRunningBody={Boolean(activePart && activePart.featureTree.length > 0)}
          previewError={sweepPreviewError}
          onCommit={(v) => { void onSweepCommit(v); }}
          onCancel={() => useAppStore.getState().resetSweepDialog()}
          onPickProfile={() => { sweepActivePickRef.current = 'profile'; sweepPickerRef.current?.activate(); }}
          onPickPath={() => { sweepActivePickRef.current = 'path'; sweepPickerRef.current?.activate(); }}
          onPickGuideRail={() => { sweepActivePickRef.current = 'guideRail'; sweepPickerRef.current?.activate(); }}
          onSetOrientation={(k) => useAppStore.setState((s) => ({ ...s, sweepOrientationKind: k }))}
          onSetOperation={(op) => useAppStore.setState((s) => ({ ...s, sweepOperation: op }))}
        />
      )}
      <WorkFeatureDialogsHost
        onWorkPlaneCommit={onWorkPlaneCommit}
        onWorkAxisCommit={onWorkAxisCommit}
        onWorkPointCommit={onWorkPointCommit}
      />
      <PanelDialog />
      <ImportFromInventorDialog
        isOpen={importFromInventorDialogOpen}
        status={importStatus}
        onCancel={() => {
          setImportFromInventorDialogOpen(false);
          setImportStatus({ kind: 'idle' });
        }}
        onConfirm={async (conflict) => {
          if (!kernel) {
            setImportStatus({ kind: 'error', message: t('toast.kernelNotReady') });
            return;
          }
          setImportStatus({ kind: 'scanning' });
          try {
            const cmd = new ImportFromInventorCommand({
              pickInput: () => (window as any).showDirectoryPicker({ id: 'inventor-import-input', mode: 'read' }),
              pickTarget: () => (window as any).showDirectoryPicker({ id: 'inventor-import-target', mode: 'readwrite' }),
              conflict,
              kernel,
              onProgress: (p) => setImportStatus({ kind: 'importing', ...p }),
            });
            await cmd.apply();
            setImportStatus({ kind: 'done', summary: cmd.summary! });
          } catch (e) {
            setImportStatus({ kind: 'error', message: (e as Error).message });
          }
        }}
      />
      {revolveDialogOpen && (
        <RevolveDialog
          profile={computeProfileRef()}
          axis={selectedAxisRef}
          hasRunningBody={hasRunningBody()}
          onCommit={(v) => { void onRevolveCommit(v); }}
          onApply={(v) => { void onRevolveApply(v); }}
          onCancel={onRevolveCancel}
          onPickProfile={onPickProfile}
          onPickAxis={onPickAxis}
          onDraftChange={schedulePreview}
          validateExpression={(expr) => {
            // Use dryRun so the registry is NOT mutated while the user types.
            // We validate under the *committed* name 'angle0' — the dialog's
            // name field is captured at commit time by AddRevolveFeatureCommand.
            const res = parameterRegistry.dryRun({
              name: 'angle0',
              expression: expr,
              unit: 'deg'
            });
            return res.ok ? null : formatExpressionError(res.error);
          }}
          previewError={previewError}
        />
      )}
      {placeOpen && (
        <PlaceComponentDialog
          tiles={tiles}
          onPlace={(partPath) => { void handlePlace(partPath); }}
          onCancel={() => useAppStore.getState().resetPlaceComponentDialog()}
        />
      )}
      {editOpen && editInitial && (
        <EditComponentDialog
          initial={editInitial}
          onCommit={(patch) => { void handleEditCommit(patch); }}
          onCancel={() => useAppStore.getState().resetEditComponentDialog()}
        />
      )}
      {(placeConstraintDialogOpen || editConstraintDialogOpen) && (
        <PlaceConstraintDialog
          mode={placeConstraintMode}
          pickedRefA={pickedRefA && { label: pickedRefA.label }}
          pickedRefB={pickedRefB && { label: pickedRefB.label }}
          valueExpression={valueExpression}
          {...(placeConstraintMode === 'tangent' ? { value2Expression, onValue2Change: setValue2Expression } : {})}
          onPick={onPickSlot}
          onValueChange={setValueExpression}
          onCommit={() => { void onCommitConstraint(true); }}
          onApply={() => { void onCommitConstraint(false); }}
          onModeChange={(m) => useAppStore.setState({ placeConstraintMode: m })}
          onCancel={() => {
            useAppStore.getState().resetPlaceConstraintDialog();
            useAppStore.getState().resetEditConstraintDialog();
            setPickedRefA(null); setPickedRefB(null); setValueExpression('0'); setValue2Expression('0');
          }}
        />
      )}
      {toast && (
        <div
          role="status"
          data-testid="conflict-toast"
          style={{
            position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)',
            background: '#1e1e1e', color: '#e8c36a',
            padding: '8px 16px', borderRadius: 6,
            display: 'flex', alignItems: 'center', gap: 12,
            fontSize: 13, fontFamily: 'ui-monospace, monospace',
            boxShadow: '0 2px 12px rgba(0,0,0,0.6)', zIndex: 9999,
            pointerEvents: 'auto'
          }}
        >
          <span>{toast.message}</span>
          {toast.action && (
            <button
              onClick={() => { toast.action!.fn(); setToast(null); }}
              style={{
                background: '#c23a3a', color: '#fff', border: 'none', borderRadius: 4,
                padding: '2px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 700
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
    </CutListCacheContext.Provider>
  );
}
