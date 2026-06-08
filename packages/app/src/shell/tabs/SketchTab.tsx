import { useState } from 'react';
import RibbonPanel from '../RibbonPanel';
import { useAppStore } from '../../store/useAppStore';
import type { ToolKind } from '../../store/useAppStore';
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
  const constructionMode = useAppStore((s) => s.constructionMode);
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
    await store.kernel.addFeature(activePart.id, { kind: 'sketch', id: newId, plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [], constraints: [] });
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
        <button
          aria-pressed={activeToolKind === 'select'}
          className={`text-xs ${activeToolKind === 'select' ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
          disabled={!sketchMode}
          onClick={() => useAppStore.getState().setActiveToolKind('select')}
        >
          Select
        </button>
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
      <RibbonPanel title="Construction">
        <button
          aria-pressed={constructionMode}
          className={`text-xs ${constructionMode ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
          disabled={!sketchMode}
          onClick={() => useAppStore.getState().setConstructionMode(!constructionMode)}
        >
          Construction <span className="text-neutral-500">(X)</span>
        </button>
      </RibbonPanel>
      <RibbonPanel title="Constrain">
        <div className="flex flex-col gap-1">
          {([
            ['coincident',    'Coincident (N)', '●'],
            ['horizontal',    'Horizontal (H)', '—'],
            ['vertical',      'Vertical (V)',   '|'],
            ['parallel',      'Parallel (P)',   '∥'],
            ['perpendicular', 'Perpendicular (E)', '⊥'],
            ['tangent',       'Tangent (T)',    '⌒'],
            ['equal',         'Equal (Q)',      '='],
            ['symmetric',     'Symmetric (Y)',  '⇄'],
          ] as const).map(([kind, label, glyph]) => (
            <button
              key={kind}
              aria-pressed={activeToolKind === `constrain-${kind}`}
              className={`text-xs ${activeToolKind === `constrain-${kind}` ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
              disabled={!sketchMode}
              title={label}
              onClick={() => useAppStore.getState().setActiveToolKind(`constrain-${kind}` as ToolKind)}
            >
              <span className="glyph">{glyph}</span> {label}
            </button>
          ))}
        </div>
      </RibbonPanel>
      <RibbonPanel title="Modify">
        <button
          aria-pressed={activeToolKind === 'offset'}
          className={`text-xs ${activeToolKind === 'offset' ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
          disabled={!sketchMode}
          onClick={() => useAppStore.getState().setActiveToolKind('offset')}
        >
          Offset
        </button>
      </RibbonPanel>
      <RibbonPanel title="Dimension">
        <button
          aria-pressed={activeToolKind === 'dimension'}
          className={`text-xs ${activeToolKind === 'dimension' ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
          disabled={!sketchMode}
          onClick={() => useAppStore.getState().setActiveToolKind('dimension')}
        >
          General Dimension <span className="text-neutral-500">(D)</span>
        </button>
      </RibbonPanel>
      <RibbonPanel title="Fallback">
        <button className="text-xs text-neutral-400 hover:text-white" onClick={() => setNumericFallbackOpen(true)}>Numeric rectangle…</button>
      </RibbonPanel>
      {numericFallbackOpen && <SketchRectangleDialog onClose={() => setNumericFallbackOpen(false)} />}
    </div>
  );
}
