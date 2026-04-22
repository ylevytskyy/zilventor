import { useEffect, useRef } from 'react';
import Ribbon from './shell/Ribbon';
import BrowserPane from './shell/BrowserPane';
import StatusBar from './shell/StatusBar';
import Viewport, { type ViewportRef } from './viewport/Viewport';
import { spawnKernel } from './kernel-client/KernelClient';
import { useAppStore } from './store/useAppStore';

export default function App() {
  const viewportRef = useRef<ViewportRef>(null);
  const { activePart, kernel, statusMessage, kernelReady, setKernel, setStatus } = useAppStore();

  // Bootstrap the kernel once.
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const { client } = await spawnKernel();
        if (disposed) return;
        setKernel(client);
      } catch (e) {
        setStatus(`Kernel failed: ${(e as Error).message}`);
      }
    })();
    return () => { disposed = true; };
  }, [setKernel, setStatus]);

  // Re-execute the feature tree whenever the part changes, and push mesh into the viewport.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!kernel || !activePart || !viewportRef.current) return;
      const res = await kernel.execute(activePart.id);
      if (cancelled) return;
      if (res.ok) {
        viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices, res.value.mesh.normals);
      } else {
        setStatus(`Error: ${res.error.message}`);
      }
    })();
    return () => { cancelled = true; };
  }, [activePart, kernel, setStatus]);

  return (
    <div className="grid h-full" style={{ gridTemplateRows: 'auto auto 1fr auto', gridTemplateColumns: '220px 1fr 260px' }}>
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
        <div className="px-3 py-2 text-xs text-neutral-500">Properties — Task 22</div>
      </aside>
      <footer role="contentinfo" className="col-span-3 bg-shell-panel border-t border-shell-border" id="region-statusbar">
        <StatusBar message={kernelReady ? (statusMessage || 'Ready') : 'Loading CAD kernel…'} />
      </footer>
    </div>
  );
}
