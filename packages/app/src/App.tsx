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
import { AddPrimitiveCommand } from './commands/AddPrimitiveCommand';
import { AddConstraintCommand } from './commands/AddConstraintCommand';
import type { Feature } from '@zilventor/shared';

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

  const [numericVisible, setNumericVisible] = useState(false);
  const [numericFieldCount, setNumericFieldCount] = useState(0);
  const [cursorScreenPos, setCursorScreenPos] = useState({ x: 0, y: 0 });

  // Per-slice subscriptions (avoid subscribing to the full store).
  const activePart = useAppStore((s) => s.activePart);
  const kernel = useAppStore((s) => s.kernel);
  const statusMessage = useAppStore((s) => s.statusMessage);
  const kernelReady = useAppStore((s) => s.kernelReady);
  const sketchMode = useAppStore((s) => s.sketchMode);
  const activeSketchId = useAppStore((s) => s.activeSketchId);
  const activeToolKind = useAppStore((s) => s.activeToolKind);

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
      const hasExtrude = activePart.featureTree.some((f) => f.kind === 'extrude');
      if (!hasExtrude) return;
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
        setSketchDof: useAppStore.getState().setSketchDof
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
              store: { activePart: store.activePart, setActivePart: store.setActivePart },
              sketchId: store.activeSketchId,
              primitive
            }));
          })();
        },
        emitConstraint: (c) => {
          const store = useAppStore.getState();
          if (!store.activeSketchId) return;
          void store.bus.execute(new AddConstraintCommand(store.activeSketchId, c));
        },
        sketcherClient: sketcherClientRef.current ?? undefined,
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
        const hasExtrude = ap.featureTree.some((f) => f.kind === 'extrude');
        if (hasExtrude) {
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

  const handleViewportPointer = useCallback((ev: { type: 'click' | 'move'; clientX: number; clientY: number }) => {
    if (!sketchMode || !activeToolCtrlRef.current || !viewportRef.current) return;
    const world = viewportRef.current.screenToWorld(ev.clientX, ev.clientY);
    const sketch = activePart?.featureTree.find(
      (f): f is Extract<Feature, { kind: 'sketch' }> => f.kind === 'sketch' && f.id === activeSketchId
    );
    const primitives = sketch?.primitives ?? [];
    activeToolCtrlRef.current.handlePointer(
      { type: ev.type === 'click' ? 'click' : 'move', point: world },
      [...primitives]
    );
    if (ev.type === 'move') setCursorScreenPos({ x: ev.clientX, y: ev.clientY });
  }, [sketchMode, activePart, activeSketchId]);

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
            return (
              <ConstraintBadgeRenderer
                primitives={f.primitives}
                constraints={f.constraints}
                worldToScreen={worldToScreen}
              />
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
    </div>
  );
}
