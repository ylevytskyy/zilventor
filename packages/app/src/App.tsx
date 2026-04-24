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
import type { Feature, DimensionConstraint } from '@zilventor/shared';
import { ParameterRegistry } from './parameters/ParameterRegistry';
import type { EvaluationError } from './parameters/types';
import { useParameterValues } from './parameters/useParameterValues';
import { DimensionDialog } from './shell/DimensionDialog';
import { ParametersPanel } from './shell/ParametersPanel';
import { RevolveDialog, type AxisRef, type ProfileRef, type RevolveDialogValue } from './shell/RevolveDialog';
import { AxisPickController } from './model/AxisPickController';
import { AddRevolveFeatureCommand } from './commands/AddRevolveFeatureCommand';

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

  const [numericVisible, setNumericVisible] = useState(false);
  const [numericFieldCount, setNumericFieldCount] = useState(0);
  const [cursorScreenPos, setCursorScreenPos] = useState({ x: 0, y: 0 });
  const [pendingDimension, setPendingDimension] = useState<DimensionConstraint | null>(null);
  const [pickingAxis, setPickingAxis] = useState(false);
  const [selectedAxisRef, setSelectedAxisRef] = useState<AxisRef | null>(null);
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
      w.__zilventorParameterRegistry = parameterRegistry;
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
      const hasSolidFeature = activePart.featureTree.some((f) => f.kind === 'extrude' || f.kind === 'revolve');
      if (!hasSolidFeature) return;
      const res = await kernel.execute(activePart.id);
      if (cancelled) return;
      if (res.ok) {
        viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices);
      } else {
        useAppStore.getState().setStatus(`Error: ${res.error.message}`);
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
        const hasSolidFeature = ap.featureTree.some((f) => f.kind === 'extrude' || f.kind === 'revolve');
        if (hasSolidFeature) {
          const res = await client.execute(ap.id);
          if (!unmountedRef.current && res.ok && viewportRef.current) {
            viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices);
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
  }, [sketchMode, activePart, activeSketchId, pickingAxis]);

  // Revolve dialog helpers and handlers.
  // computeProfileRef: find a sketch suitable as a revolve profile. T13
  // simplification — prefer an activeSketchId, else the last sketch in the
  // feature tree. Closed-loop detection is deferred (T15+); report 1 if the
  // sketch has any primitives so the dialog can show non-empty state.
  const computeProfileRef = useCallback((): ProfileRef | null => {
    if (!activePart) return null;
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
  }, [activePart, activeSketchId]);

  // hasRunningBody: true if any prior solid-producing feature exists. T13
  // simplification — any extrude or revolve feature qualifies.
  const hasRunningBody = useCallback((): boolean => {
    if (!activePart) return false;
    return activePart.featureTree.some(
      (f) => f.kind === 'extrude' || f.kind === 'revolve'
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
  }, [activePart, kernel, setRevolveDialogOpen, clearPreview]);

  // Global cleanup: cancel any in-flight preview timer on unmount so the
  // closure (which holds a ref to the kernel) doesn't survive teardown.
  useEffect(() => {
    return () => {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
    };
  }, []);

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
          <BrowserPane part={activePart} />
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
      {revolveDialogOpen && (
        <RevolveDialog
          profile={computeProfileRef()}
          axis={selectedAxisRef}
          hasRunningBody={hasRunningBody()}
          onCommit={(v) => { void onRevolveCommit(v); }}
          onApply={(v) => { void onRevolveApply(v); }}
          onCancel={onRevolveCancel}
          onPickProfile={() => { /* T15: profile picking. For T13 the dialog shows the active sketch. */ }}
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
