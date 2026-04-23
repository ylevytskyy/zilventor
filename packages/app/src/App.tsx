import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Ribbon from './shell/Ribbon';
import BrowserPane from './shell/BrowserPane';
import StatusBar from './shell/StatusBar';
import PropertiesPanel from './shell/PropertiesPanel';
import Viewport, { type ViewportRef } from './viewport/Viewport';
import { spawnKernel } from './kernel-client/KernelClient';
import { useAppStore } from './store/useAppStore';

export default function App() {
  const viewportRef = useRef<ViewportRef>(null);
  const terminateRef = useRef<(() => void) | null>(null);
  const [kernelOffline, setKernelOffline] = useState(false);

  // Per-slice subscriptions (avoid subscribing to the full store).
  const activePart = useAppStore((s) => s.activePart);
  const kernel = useAppStore((s) => s.kernel);
  const statusMessage = useAppStore((s) => s.statusMessage);
  const kernelReady = useAppStore((s) => s.kernelReady);

  // Bootstrap the kernel once.
  useEffect(() => {
    let disposed = false;
    (async () => {
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
      terminateRef.current?.();
      terminateRef.current = null;
    };
  }, []);

  // Re-execute when the feature tree contains a solid-producing feature (extrude).
  // Empty / sketch-only trees skip execute() entirely — otherwise the kernel
  // raises a spurious degenerateSketch error that pollutes the status bar.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!kernel || !activePart || !viewportRef.current) return;
      const hasExtrude = activePart.featureTree.some((f) => f.kind === 'extrude');
      if (!hasExtrude) return;
      const res = await kernel.execute(activePart.id);
      if (cancelled) return;
      if (res.ok) {
        viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices, res.value.mesh.normals);
      } else {
        useAppStore.getState().setStatus(`Error: ${res.error.message}`);
      }
    })();
    return () => { cancelled = true; };
  }, [activePart, kernel]);

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

  // Global keyboard shortcuts: Ctrl/Cmd+Z for undo, Ctrl/Cmd+Y or Shift+Ctrl/Cmd+Z for redo.
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Don't swallow undo/redo inside input fields — the native undo there is
      // useful, and intercepting would surprise the user mid-edit.
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
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
  }, []);

  // Handler for the kernel-offline banner's Restart button. Terminates the
  // current worker, spawns a new one, and re-executes the active part so the
  // viewport mesh is repopulated.
  const handleRestart = useCallback(async () => {
    setKernelOffline(false);
    terminateRef.current?.();
    terminateRef.current = null;
    try {
      const { client, terminate } = await spawnKernel({
        onOffline: () => setKernelOffline(true)
      });
      terminateRef.current = terminate;
      useAppStore.getState().setKernel(client);
      const { activePart: ap } = useAppStore.getState();
      if (ap && viewportRef.current) {
        const hasExtrude = ap.featureTree.some((f) => f.kind === 'extrude');
        if (hasExtrude) {
          const res = await client.execute(ap.id);
          if (res.ok) {
            viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices, res.value.mesh.normals);
          }
        }
      }
    } catch (e) {
      useAppStore.getState().setStatus(`Kernel restart failed: ${(e as Error).message}`);
    }
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
        <main role="main" id="region-viewport" className="bg-shell">
          <Viewport ref={viewportRef} />
        </main>
        <aside role="complementary" aria-label="Properties" className="bg-shell-panel border-l border-shell-border" id="region-properties">
          <PropertiesPanel />
        </aside>
        <footer role="contentinfo" className="col-span-3 bg-shell-panel border-t border-shell-border" id="region-statusbar">
          <StatusBar message={kernelReady ? (statusMessage || 'Ready') : 'Loading CAD kernel…'} />
        </footer>
      </div>
    </div>
  );
}
