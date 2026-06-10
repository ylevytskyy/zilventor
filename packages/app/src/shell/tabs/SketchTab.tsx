import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import RibbonPanel from '../RibbonPanel';
import { useAppStore } from '../../store/useAppStore';
import type { ToolKind } from '../../store/useAppStore';
import SketchRectangleDialog from '../SketchRectangleDialog';
import type { Feature } from '@zilventor/shared';

type PrimitiveBtn = { kind: 'line' | 'rect' | 'circle' | 'arc' | 'spline'; labelKey: string; shortcut: string };
const BUTTONS: PrimitiveBtn[] = [
  { kind: 'line',   labelKey: 'ribbon.sketch.line',   shortcut: 'L' },
  { kind: 'rect',   labelKey: 'ribbon.sketch.rect',   shortcut: 'R' },
  { kind: 'circle', labelKey: 'ribbon.sketch.circle', shortcut: 'C' },
  { kind: 'arc',    labelKey: 'ribbon.sketch.arc',    shortcut: 'A' },
  { kind: 'spline', labelKey: 'ribbon.sketch.spline', shortcut: 'S' },
];

export default function SketchTab() {
  const { t } = useTranslation();
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
    store.setStatus(t('status.ready'));
  };

  return (
    <div className="flex gap-2 px-3 py-2">
      <RibbonPanel title={t('ribbon.sketch.sketch')}>
        {!sketchMode && (
          <button
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={!canSketch}
            onClick={() => { void startSketch(); }}
          >
            {t('ribbon.sketch.sketch2d')}
          </button>
        )}
        {sketchMode && (
          <button className="text-xs hover:text-white" onClick={finishSketch}>
            {t('ribbon.sketch.finishSketch')}
          </button>
        )}
      </RibbonPanel>
      <RibbonPanel title={t('ribbon.sketch.draw')}>
        <button
          aria-pressed={activeToolKind === 'select'}
          className={`text-xs ${activeToolKind === 'select' ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
          disabled={!sketchMode}
          onClick={() => useAppStore.getState().setActiveToolKind('select')}
        >
          {t('ribbon.sketch.select')}
        </button>
        {BUTTONS.map((b) => (
          <button
            key={b.kind}
            aria-pressed={activeToolKind === b.kind}
            className={`text-xs ${activeToolKind === b.kind ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
            disabled={!sketchMode}
            onClick={() => useAppStore.getState().setActiveToolKind(b.kind)}
          >
            {t(b.labelKey)} <span className="text-neutral-500">({b.shortcut})</span>
          </button>
        ))}
      </RibbonPanel>
      <RibbonPanel title={t('ribbon.sketch.construction')}>
        <button
          aria-pressed={constructionMode}
          className={`text-xs ${constructionMode ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
          disabled={!sketchMode}
          onClick={() => useAppStore.getState().setConstructionMode(!constructionMode)}
        >
          {t('ribbon.sketch.constructionBtn')} <span className="text-neutral-500">(X)</span>
        </button>
      </RibbonPanel>
      <RibbonPanel title={t('ribbon.sketch.constrain')}>
        <div className="flex flex-col gap-1">
          {([
            ['coincident',    'ribbon.sketch.coincident', '●'],
            ['horizontal',    'ribbon.sketch.horizontal', '—'],
            ['vertical',      'ribbon.sketch.vertical',   '|'],
            ['parallel',      'ribbon.sketch.parallel',   '∥'],
            ['perpendicular', 'ribbon.sketch.perpendicular', '⊥'],
            ['tangent',       'ribbon.sketch.tangent',    '⌒'],
            ['equal',         'ribbon.sketch.equal',      '='],
            ['symmetric',     'ribbon.sketch.symmetric',  '⇄'],
          ] as const).map(([kind, labelKey, glyph]) => (
            <button
              key={kind}
              aria-pressed={activeToolKind === `constrain-${kind}`}
              className={`text-xs ${activeToolKind === `constrain-${kind}` ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
              disabled={!sketchMode}
              title={t(labelKey)}
              onClick={() => useAppStore.getState().setActiveToolKind(`constrain-${kind}` as ToolKind)}
            >
              <span className="glyph">{glyph}</span> {t(labelKey)}
            </button>
          ))}
        </div>
      </RibbonPanel>
      <RibbonPanel title={t('ribbon.sketch.modify')}>
        <button
          aria-pressed={activeToolKind === 'offset'}
          className={`text-xs ${activeToolKind === 'offset' ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
          disabled={!sketchMode}
          onClick={() => useAppStore.getState().setActiveToolKind('offset')}
        >
          {t('ribbon.sketch.offset')}
        </button>
        <button
          aria-pressed={activeToolKind === 'fillet'}
          className={`text-xs ${activeToolKind === 'fillet' ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
          disabled={!sketchMode}
          onClick={() => useAppStore.getState().setActiveToolKind('fillet')}
        >
          {t('ribbon.sketch.fillet')}
        </button>
        <button
          aria-pressed={activeToolKind === 'chamfer'}
          className={`text-xs ${activeToolKind === 'chamfer' ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
          disabled={!sketchMode}
          onClick={() => useAppStore.getState().setActiveToolKind('chamfer')}
        >
          {t('ribbon.sketch.chamfer')}
        </button>
        <button
          aria-pressed={activeToolKind === 'trim'}
          className={`text-xs ${activeToolKind === 'trim' ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
          disabled={!sketchMode}
          onClick={() => useAppStore.getState().setActiveToolKind('trim')}
        >
          {t('ribbon.sketch.trim')}
        </button>
        <button
          aria-pressed={activeToolKind === 'extend'}
          className={`text-xs ${activeToolKind === 'extend' ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
          disabled={!sketchMode}
          onClick={() => useAppStore.getState().setActiveToolKind('extend')}
        >
          {t('ribbon.sketch.extend')}
        </button>
        <button
          aria-pressed={activeToolKind === 'project-geom'}
          className={`text-xs ${activeToolKind === 'project-geom' ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
          disabled={!sketchMode}
          onClick={() => useAppStore.getState().setActiveToolKind('project-geom')}
        >
          {t('ribbon.sketch.project')}
        </button>
      </RibbonPanel>
      <RibbonPanel title={t('ribbon.sketch.dimension')}>
        <button
          aria-pressed={activeToolKind === 'dimension'}
          className={`text-xs ${activeToolKind === 'dimension' ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
          disabled={!sketchMode}
          onClick={() => useAppStore.getState().setActiveToolKind('dimension')}
        >
          {t('ribbon.sketch.generalDim')} <span className="text-neutral-500">(D)</span>
        </button>
      </RibbonPanel>
      <RibbonPanel title={t('ribbon.sketch.fallback')}>
        <button className="text-xs text-neutral-400 hover:text-white" onClick={() => setNumericFallbackOpen(true)}>{t('ribbon.sketch.numericRect')}</button>
      </RibbonPanel>
      {numericFallbackOpen && <SketchRectangleDialog onClose={() => setNumericFallbackOpen(false)} />}
    </div>
  );
}
