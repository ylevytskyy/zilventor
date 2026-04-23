import { useEffect, useState } from 'react';
import RibbonPanel from '../RibbonPanel';
import { useAppStore } from '../../store/useAppStore';
import SketchRectangleDialog from '../SketchRectangleDialog';
import type { Feature } from '@zilventor/shared';

type PrimitiveBtn = { kind: 'line' | 'rect' | 'circle' | 'arc' | 'spline'; label: string; shortcut: string };
const BUTTONS: PrimitiveBtn[] = [
  { kind: 'line',   label: 'Line',      shortcut: 'L' },
  { kind: 'rect',   label: 'Rectangle', shortcut: 'R' },
  { kind: 'circle', label: 'Circle',    shortcut: 'C' },
  { kind: 'arc',    label: 'Arc',       shortcut: 'A' },
  { kind: 'spline', label: 'Spline',    shortcut: 'S' }
];

export default function SketchTab() {
  const activePart = useAppStore((s) => s.activePart);
  const sketchMode = useAppStore((s) => s.sketchMode);
  const activeToolKind = useAppStore((s) => s.activeToolKind);
  const canSketch = !!activePart;
  const [numericFallbackOpen, setNumericFallbackOpen] = useState(false);

  const startSketch = async () => {
    const store = useAppStore.getState();
    if (!store.kernel || !activePart) return;
    // Reuse the latest sketch feature, or create one.
    const latestSketch = [...activePart.featureTree].reverse().find((f): f is Extract<Feature, { kind: 'sketch' }> => f.kind === 'sketch');
    if (latestSketch) {
      store.setSketchMode(true, latestSketch.id);
      return;
    }
    const newId = `s${Date.now()}`;
    await store.kernel.addFeature(activePart.id, { kind: 'sketch', id: newId, plane: 'XY', primitives: [], constraints: [] });
    const next = await store.kernel.getPart(activePart.id);
    store.setActivePart(next);
    store.setSketchMode(true, newId);
  };

  const finishSketch = () => {
    const store = useAppStore.getState();
    store.setSketchMode(false);
    store.setActiveToolKind(null);
    store.setStatus('Ready');
  };

  // Keyboard shortcuts (only in sketch mode, only when not in an input)
  useEffect(() => {
    if (!sketchMode) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
      const btn = BUTTONS.find((b) => b.shortcut.toLowerCase() === e.key.toLowerCase());
      if (btn) useAppStore.getState().setActiveToolKind(btn.kind);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sketchMode]);

  return (
    <div className="flex gap-2 px-3 py-2">
      <RibbonPanel title="Sketch">
        {!sketchMode && (
          <button
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={!canSketch}
            onClick={() => { void startSketch(); }}
          >
            2D Sketch
          </button>
        )}
        {sketchMode && (
          <button className="text-xs hover:text-white" onClick={finishSketch}>
            Finish Sketch
          </button>
        )}
      </RibbonPanel>
      <RibbonPanel title="Draw">
        {BUTTONS.map((b) => (
          <button
            key={b.kind}
            aria-pressed={activeToolKind === b.kind}
            className={`text-xs ${activeToolKind === b.kind ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
            disabled={!sketchMode}
            onClick={() => useAppStore.getState().setActiveToolKind(b.kind)}
          >
            {b.label} <span className="text-neutral-500">({b.shortcut})</span>
          </button>
        ))}
      </RibbonPanel>
      <RibbonPanel title="Constrain">
        <button className="text-xs text-neutral-500" disabled>Constraints (SP2b)</button>
      </RibbonPanel>
      <RibbonPanel title="Fallback">
        <button className="text-xs text-neutral-400 hover:text-white" onClick={() => setNumericFallbackOpen(true)}>Numeric rectangle…</button>
      </RibbonPanel>
      {numericFallbackOpen && <SketchRectangleDialog onClose={() => setNumericFallbackOpen(false)} />}
    </div>
  );
}
