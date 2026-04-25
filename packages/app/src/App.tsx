import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Ribbon from './shell/Ribbon';
import BrowserPane from './shell/BrowserPane';
import StatusBar from './shell/StatusBar';
import PropertiesPanel from './shell/PropertiesPanel';
import Viewport, { type ViewportRef } from './viewport/Viewport';
import NumericInputOverlay from './shell/NumericInputOverlay';
import { spawnKernel } from './kernel-client/KernelClient';
import { useAppStore } from './store/useAppStore';
import type { ToolKind } from './store/useAppStore';
import { createSketchModeController, type SketchModeHandle } from './sketcher/SketchModeController';
import { SketcherClient } from './sketcher/SketcherClient';
import { createSketcherWorkerApi } from './vendor/sketcherWorker';
import { ActiveToolController } from './sketcher/ActiveToolController';
import { SketchOverlay } from './sketcher/overlay/SketchOverlay';
import { CommittedSketchRenderer } from './sketcher/render/CommittedSketchRenderer';
import { ConstraintBadgeRenderer } from './sketcher/render/ConstraintBadgeRenderer';
import { DimensionRenderer } from './sketcher/render/DimensionRenderer';
import { AddPrimitiveCommand } from './commands/AddPrimitiveCommand';
import { AddConstraintCommand } from './commands/AddConstraintCommand';
import { AddDimensionCommand, AddDimensionConflictError } from './commands/AddDimensionCommand';
import type { Feature, DimensionConstraint, FaceName, FilletEdgeSpec, FilletSelectionMode, FilletFeature, ChamferEdgeSpec, ChamferFeature, ShellFeature, LinearPatternFeature, MirrorFeature, MirrorPlane, PatternAxis, EdgeName, SweepFeature, SweepOrientation, BooleanOperation } from '@zilventor/shared';
import { ParameterRegistry } from './parameters/ParameterRegistry';
import type { EvaluationError } from './parameters/types';
import { useParameterValues } from './parameters/useParameterValues';
import { DimensionDialog } from './shell/DimensionDialog';
import { ParametersPanel } from './shell/ParametersPanel';
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
import { Opfs } from '@zilventor/kernel/src/storage/Opfs';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { packAssembly, unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import type { ComponentInstance } from '@zilventor/shared';
import * as THREE from 'three';

// Module-level singleton. Registry loads from activePart.parameters on every part change.
export const parameterRegistry = new ParameterRegistry();

function formatExpressionError(err: EvaluationError): string {
  switch (err.code) {
    case 'unknown-var':   return `Unknown parameter '${err.name}' in expression`;
    case 'cycle':         return `Cycle detected: ${err.namesInCycle.join(' → ')}`;
    case 'parse-error':   return `Parse error: ${err.message}`;
    case 'div-by-zero':   return 'Division by zero';
    case 'non-finite':    return 'Expression evaluates to non-finite value';
    case 'name-in-use':   return `Parameter name '${err.name}' is already in use`;
    case 'referenced':    return `Parameter '${err.name}' is referenced by: ${err.referencedBy.join(', ')}`;
  }
}

export default function App() {
  const viewportRef = useRef<ViewportRef>(null);
  const terminateRef = useRef<(() => void) | null>(null);
  // Guards against double-click reentry into handleRestart (both calls would
  // race spawnKernel() and leak a worker by overwriting terminateRef).
  const restartingRef = useRef(false);
  // Set from the bootstrap effect's cleanup so an in-flight handleRestart can
  // terminate the freshly spawned worker instead of leaking it after unmount.
  const unmountedRef = useRef(false);
  const [kernelOffline, setKernelOffline] = useState(false);

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
  const [availableFaceNames, setAvailableFaceNames] = useState<FaceName[]>([]);

  const [numericVisible, setNumericVisible] = useState(false);
  const [numericFieldCount, setNumericFieldCount] = useState(0);
  const [cursorScreenPos, setCursorScreenPos] = useState({ x: 0, y: 0 });
  const [pendingDimension, setPendingDimension] = useState<DimensionConstraint | null>(null);
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

  // Per-slice subscriptions (avoid subscribing to the full store).
  const activePart = useAppStore((s) => s.activePart);
  const kernel = useAppStore((s) => s.kernel);
  const statusMessage = useAppStore((s) => s.statusMessage);
  const kernelReady = useAppStore((s) => s.kernelReady);
  const sketchMode = useAppStore((s) => s.sketchMode);
  const activeSketchId = useAppStore((s) => s.activeSketchId);
  const activeToolKind = useAppStore((s) => s.activeToolKind);
  const parametersPanelOpen = useAppStore((s) => s.parametersPanelOpen);
  const setParametersPanelOpen = useAppStore((s) => s.setParametersPanelOpen);
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
      w.__zilventorPackProject = packProject;
      w.__zilventorUnpackAssembly = unpackAssembly;
      w.__zilventorGetOpfs = async () => {
        if (!opfsRef.current) opfsRef.current = await Opfs.forNavigator();
        return opfsRef.current;
      };
      w.__zilventorAssemblyGeomCacheSize = () => geometryCacheRef.current.size;
    }
  }, []);

  // Bootstrap the kernel once.
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const { client, terminate } = await spawnKernel({
          onOffline: () => setKernelOffline(true)
        });
        if (disposed) { terminate(); return; }
        terminateRef.current = terminate;
        useAppStore.getState().setKernel(client);
      } catch (e) {
        useAppStore.getState().setStatus(`Kernel failed: ${(e as Error).message}`);
      }
    })();
    return () => {
      disposed = true;
      unmountedRef.current = true;
      terminateRef.current?.();
      terminateRef.current = null;
    };
  }, []);

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
      const hasExecutableFeature = activePart.featureTree.some((f) => f.kind === 'extrude' || f.kind === 'revolve' || f.kind === 'sweep' || f.kind === 'workAxis' || f.kind === 'workPlane' || f.kind === 'workPoint');
      if (!hasExecutableFeature) return;
      const res = await kernel.execute(activePart.id);
      if (cancelled) return;
      if (res.ok) {
        viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices);
        tessellatedEdgesRef.current = res.value.tessellatedEdges ?? [];
        setAvailableFaceNames(res.value.faceNames ?? []);
        facePickerRef.current.setCandidates(res.value.tessellatedFaces ?? []);
        useAppStore.getState().setFeatureErrors(res.value.featureErrors ?? new Map());
        applyWorkFeaturesToViewport(res.value.workFeatures, activePart.featureTree);
      } else {
        useAppStore.getState().setStatus(`Error: ${res.error.message}`);
        useAppStore.getState().setFeatureErrors(new Map());
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

      sketcherClientRef.current = new SketcherClient(createSketcherWorkerApi());

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
          void (async () => {
            const store = useAppStore.getState();
            if (!store.kernel || !store.activePart || !store.activeSketchId) return;
            await store.bus.execute(new AddPrimitiveCommand({
              kernel: store.kernel,
              sketcherClient: sketcherClientRef.current ?? undefined,
              store: { getActivePart: () => useAppStore.getState().activePart, setActivePart: store.setActivePart },
              sketchId: store.activeSketchId,
              primitive
            }));
          })();
        },
        emitConstraint: (c) => {
          const store = useAppStore.getState();
          if (!store.activeSketchId) return;
          void store.bus.execute(new AddConstraintCommand(store.activeSketchId, c, sketcherClientRef.current ?? undefined));
        },
        sketcherClient: sketcherClientRef.current ?? undefined,
        onCoords: (diff) => {
          const store = useAppStore.getState();
          if (store.activeSketchId) store.applyCoordDiff(store.activeSketchId, diff);
        },
        onDof: (dof) => {
          useAppStore.getState().setSketchDof(dof);
        },
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
        }
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
    // Reset and repopulate on every activePart change.
    const names = parameterRegistry.getAll().map((p) => p.name);
    for (const n of names) parameterRegistry.removeParameter(n);
    for (const p of Object.values(activePart.parameters ?? {})) {
      parameterRegistry.setParameter({ name: p.name, expression: p.expression, unit: p.unit });
    }
  }, [activePart?.id]);

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
            (f) => f.kind === 'extrude' || f.kind === 'revolve' || f.kind === 'sweep' || f.kind === 'workAxis' || f.kind === 'workPlane' || f.kind === 'workPoint'
          );
          if (!hasExecutableFeature) return;
          const res = await kernelClient.execute(freshPart.id);
          if (res.ok && viewportRef.current) {
            viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices);
            tessellatedEdgesRef.current = res.value.tessellatedEdges ?? [];
            setAvailableFaceNames(res.value.faceNames ?? []);
            facePickerRef.current.setCandidates(res.value.tessellatedFaces ?? []);
            useAppStore.getState().setFeatureErrors(res.value.featureErrors ?? new Map());
            applyWorkFeaturesToViewport(res.value.workFeatures, freshPart.featureTree);
          } else if (!res.ok) {
            useAppStore.getState().setStatus(`Error: ${res.error.message}`);
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
      for (const c of sketch.constraints) {
        if (!c.kind.startsWith('dim-')) continue;
        const dim = c as DimensionConstraint;
        if (dim.value.kind !== 'param') continue;
        const resolved = parameterRegistry.getValue(dim.value.paramName);
        if (resolved === undefined) continue;
        void client.updateDimensionValue(dim.id, resolved);
      }
    });
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
    r.update(sketch?.primitives ?? []);
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
        showToast('Over-defined: sketch has conflicting constraints.', offending.length > 0 ? {
          label: 'Show conflict',
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
        const hasSolidFeature = ap.featureTree.some((f) => f.kind === 'extrude' || f.kind === 'revolve' || f.kind === 'sweep');
        if (hasSolidFeature) {
          const res = await client.execute(ap.id);
          if (!unmountedRef.current && res.ok && viewportRef.current) {
            viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices);
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
        useAppStore.getState().setStatus(`Kernel restart failed: ${(e as Error).message}`);
      }
    } finally {
      restartingRef.current = false;
    }
  }, []);

  const handleViewportPointer = useCallback((ev: { type: 'click' | 'move' | 'pointerdown' | 'pointerup'; clientX: number; clientY: number }) => {
    if (!viewportRef.current) return;
    const docKind = useAppStore.getState().activeDocument?.kind;
    if (docKind === 'assembly' && ev.type === 'click') {
      const hit = viewportRef.current.raycastComponent(ev.clientX, ev.clientY);
      useAppStore.getState().selectComponent(hit);
      return;
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
    if (!sketchMode || !activeToolCtrlRef.current) return;
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
  }, [sketchMode, activePart, activeSketchId, pickingAxis, pickingProfile, pickingFilletEdges, pickingChamferEdges, pickingShellFaces, filletSelectionMode]);

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
      showToast(`Revolve failed: ${(e as Error).message}`);
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
      showToast(`Revolve failed: ${(e as Error).message}`);
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
      showToast('No edges available — add a body (extrude/revolve) first.');
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
      showToast(`Hole failed: ${(e as Error).message}`);
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
  const geometryCacheRef = useRef<Map<string, THREE.BufferGeometry>>(new Map());

  // Lazy OPFS singleton + tile list for the Place dialog.
  const opfsRef = useRef<Opfs | null>(null);
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
    const cmd = new PlaceComponentCommand({ partPath });
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
      const specs: Array<{
        componentId: string;
        geometry: THREE.BufferGeometry;
        transform: THREE.Matrix4;
        visible: boolean;
      }> = [];
      const diagnostics: Array<{ componentId: string; message: string }> = [];

      for (const c of assembly.components) {
        let geom = cache.get(c.partPath);
        if (!geom) {
          try {
            if (!kernel) throw new Error('kernel not ready');
            const bytes = await opfs.read(c.partPath);
            const partId = await kernel.loadFromBytes(bytes);
            const res = await kernel.execute(partId);
            if (!res.ok) throw new Error(res.error.message);
            const m = res.value.mesh;
            geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
            geom.setIndex(new THREE.BufferAttribute(m.indices, 1));
            geom.computeVertexNormals();
            cache.set(c.partPath, geom);
          } catch (e) {
            diagnostics.push({ componentId: c.id, message: `Failed to load ${c.partPath}: ${(e as Error).message}` });
            geom = new THREE.BoxGeometry(50, 50, 50);
          }
        }
        const transform = new THREE.Matrix4();
        transform.makeRotationFromEuler(new THREE.Euler(
          (c.rotation.rx * Math.PI) / 180,
          (c.rotation.ry * Math.PI) / 180,
          (c.rotation.rz * Math.PI) / 180,
          'XYZ',
        ));
        transform.setPosition(c.position.x, c.position.y, c.position.z);
        specs.push({ componentId: c.id, geometry: geom, transform, visible: c.visible });
      }
      if (!cancelled) {
        vp.setComponentMeshes(specs);
        useAppStore.getState().setComponentDiagnostics(diagnostics);
      }
    })();
    return () => { cancelled = true; };
  }, [assembly, kernel]);

  // OPFS autosave — debounce 500 ms after the last activeDocument mutation.
  // Parts are packed via kernel.saveToBytes (re-runs the feature tree to bake
  // the BREP); assemblies are packed via packAssembly directly. Skipped when
  // activeDocument is null. Counts writes for the perf E2E.
  const activeDoc = useAppStore((s) => s.activeDocument);
  const autosaveTimerRef = useRef<number | null>(null);
  const autosaveStatsRef = useRef({ writeCount: 0 });
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
        try {
          if (!opfsRef.current) opfsRef.current = await Opfs.forNavigator();
          const opfs = opfsRef.current;
          const doc = useAppStore.getState().activeDocument;
          if (!doc) return;
          if (doc.kind === 'assembly') {
            const archive = await packAssembly(doc.document, new Uint8Array());
            await opfs.write(`${doc.document.name}.ziasm`, archive);
          } else {
            if (!kernel) return;
            const bytes = await kernel.saveToBytes(doc.document.id);
            await opfs.write(`${doc.document.name}.zipt`, bytes);
          }
          autosaveStatsRef.current.writeCount += 1;
        } catch (e) {
          console.warn('autosave failed:', (e as Error).message);
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
      showToast(`Fillet failed: ${(e as Error).message}`);
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
      showToast(`Fillet failed: ${(e as Error).message}`);
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
      showToast('No edges available — add a body (extrude/revolve) first.');
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
      showToast(`Chamfer failed: ${(e as Error).message}`);
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
      showToast(`Chamfer failed: ${(e as Error).message}`);
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
      showToast(`Shell failed: ${(e as Error).message}`);
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
      label: `${f.kind === 'extrude' ? 'Extrusion' : 'Revolve'}${idx + 1} (${f.id})`,
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
      showToast(`Linear pattern failed: ${(e as Error).message}`);
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
      showToast(`Mirror failed: ${(e as Error).message}`);
    }
  }, [activePart, kernel, setMirrorDialogOpen, showToast]);

  const onMirrorCancel = useCallback(() => {
    setMirrorDialogOpen(false);
  }, [setMirrorDialogOpen]);




  return (
    <div className="flex flex-col h-full">
      {kernelOffline && (
        <div
          role="alert"
          className="bg-red-900 text-white text-xs px-3 py-1 flex justify-between items-center"
          data-testid="kernel-offline-banner"
        >
          <span>Kernel stopped — click to restart</span>
          <button onClick={handleRestart} className="underline hover:no-underline">
            Restart
          </button>
        </div>
      )}
      <div className="grid flex-1 min-h-0" style={{ gridTemplateRows: 'auto auto 1fr auto', gridTemplateColumns: '220px 1fr 260px' }}>
        <header role="banner" className="col-span-3 bg-shell-panel border-b border-shell-border" id="region-appbar">
          <div className="px-3 py-1 text-sm font-semibold">ZilInventor</div>
        </header>
        <div role="navigation" aria-label="Ribbon" className="col-span-3 bg-shell-panel border-b border-shell-border" id="region-ribbon">
          <Ribbon />
        </div>
        <aside role="complementary" aria-label="Browser" className="bg-shell-panel border-r border-shell-border" id="region-browser">
          <BrowserPane part={activePart} sketchPicker={sweepPickerRef.current?.isActive() ? sweepPickerRef.current : null} />
        </aside>
        <main role="main" id="region-viewport" className="bg-shell" style={{ position: 'relative' }}>
          <Viewport ref={viewportRef} onPointer={handleViewportPointer} />
          {sketchMode && activeSketchId && (() => {
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
                />
              </>
            );
          })()}
        </main>
        <aside role="complementary" aria-label="Properties" className="bg-shell-panel border-l border-shell-border" id="region-properties">
          <PropertiesPanel />
        </aside>
        <footer role="contentinfo" className="col-span-3 bg-shell-panel border-t border-shell-border" id="region-statusbar">
          <StatusBar message={kernelReady ? (statusMessage || 'Ready') : 'Loading CAD kernel…'} />
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
  );
}
