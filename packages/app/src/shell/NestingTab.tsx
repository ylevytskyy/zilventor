import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';
import { useCutListResult } from './useCutListResult';
import { computeNestFingerprint } from '@zilventor/shared';
import type { NestSheet, NestExclusion } from '@zilventor/shared';
import { GenerateNestCommand } from '../commands/GenerateNestCommand';
import { ExportNestPngCommand } from '../commands/ExportNestPngCommand';
import { EditPlacedPanelCommand, EditRejectedError, type PlacedPanelEdit } from '../commands/EditPlacedPanelCommand';
import { SheetSvg } from './SheetSvg';

type SelectedPanel = { materialId: string; sheetIndex: number; panelArrayIndex: number };

export function NestingTab() {
  const { t } = useTranslation();
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const bus = useAppStore((s) => s.bus);
  const materials = activeAssembly?.materials ?? [];
  const nest = activeAssembly?.nest;
  const cutListResult = useCutListResult();

  const [currentFingerprint, setCurrentFingerprint] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState<SelectedPanel | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const kerf = nest?.params.kerfMm ?? 3;
    void computeNestFingerprint(cutListResult.rows, materials, kerf, nest?.params.oversize).then((fp) => {
      if (!cancelled) setCurrentFingerprint(fp);
    });
    return () => { cancelled = true; };
  }, [cutListResult.rows, materials, nest?.params.kerfMm, nest?.params.oversize?.lengthMm, nest?.params.oversize?.widthMm]);

  const stale = !!nest && currentFingerprint !== null && currentFingerprint !== nest.inputFingerprint;

  const grainByRowKey = useMemo(() => {
    const m = new Map<string, (typeof cutListResult.rows)[number]['grain']>();
    cutListResult.rows.forEach((r) => m.set(r.rowKey, r.grain));
    return m;
  }, [cutListResult.rows]);

  if (!nest) {
    return (
      <div className="p-4 text-xs text-neutral-400">
        {t('panel.nesting.noNest')}
      </div>
    );
  }

  const grouped = new Map<string, NestSheet[]>();
  nest.sheets.forEach((s) => {
    if (!grouped.has(s.materialId)) grouped.set(s.materialId, []);
    grouped.get(s.materialId)!.push(s);
  });

  const handleRegenerate = () => {
    void bus.execute(new GenerateNestCommand({ kerfMm: nest.params.kerfMm, ...(nest.params.oversize ? { oversize: nest.params.oversize } : {}), result: cutListResult, materials }));
  };

  const handleExportPng = (sheet: NestSheet) => {
    void new ExportNestPngCommand({ sheet, materials }).apply();
  };

  const toggleEditMode = () => {
    setEditMode((v) => !v);
    setSelected(null);
    setEditError(null);
  };

  const handleSelectPanel = (materialId: string, sheetIndex: number, panelArrayIndex: number) => {
    setSelected({ materialId, sheetIndex, panelArrayIndex });
    setEditError(null);
  };

  const handleEdit = async (edit: PlacedPanelEdit): Promise<void> => {
    if (!selected) return;
    try {
      await bus.execute(new EditPlacedPanelCommand({ ...selected, edit }));
      setEditError(null);
    } catch (err: unknown) {
      if (err instanceof EditRejectedError) {
        setEditError(t(err.reason === 'bounds' ? 'panel.sheet.edit.errorBounds' : 'panel.sheet.edit.errorOverlap'));
      } else {
        setEditError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const nudgeStep = (e: MouseEvent): number => (e.shiftKey ? 10 : 1);

  return (
    <div data-nesting-tab>
      <div className="mb-2">
        <button
          type="button"
          aria-label={t('panel.nesting.editModeAriaLabel')}
          aria-pressed={editMode}
          onClick={toggleEditMode}
        >
          {t('panel.nesting.editMode')} {editMode ? '✓' : ''}
        </button>
      </div>
      {editMode && selected && (
        <div className="mb-2 flex items-center gap-2 text-xs">
          <button type="button" title={t('panel.sheet.edit.rotateAriaLabel')} onClick={() => void handleEdit({ type: 'rotate' })}>
            {t('panel.sheet.edit.rotate')}
          </button>
          <button type="button" title={t('panel.sheet.edit.flipAriaLabel')} onClick={() => void handleEdit({ type: 'flip' })}>
            {t('panel.sheet.edit.flip')}
          </button>
          <button type="button" aria-label={t('panel.sheet.edit.moveUpAriaLabel')} onClick={(e) => void handleEdit({ type: 'move', dx: 0, dy: -nudgeStep(e) })}>▲</button>
          <button type="button" aria-label={t('panel.sheet.edit.moveDownAriaLabel')} onClick={(e) => void handleEdit({ type: 'move', dx: 0, dy: nudgeStep(e) })}>▼</button>
          <button type="button" aria-label={t('panel.sheet.edit.moveLeftAriaLabel')} onClick={(e) => void handleEdit({ type: 'move', dx: -nudgeStep(e), dy: 0 })}>◀</button>
          <button type="button" aria-label={t('panel.sheet.edit.moveRightAriaLabel')} onClick={(e) => void handleEdit({ type: 'move', dx: nudgeStep(e), dy: 0 })}>▶</button>
          {editError && <div role="alert" className="text-red-600">{editError}</div>}
        </div>
      )}
      {stale && (
        <div role="status" aria-label={t('panel.nesting.staleAriaLabel')} className="bg-yellow-100 text-yellow-900 px-2 py-1">
          ⚠️ {t('panel.nesting.stale')}
          <button onClick={handleRegenerate} className="ml-2 underline">{t('panel.nesting.regenerate')}</button>
        </div>
      )}
      {Array.from(grouped.entries()).map(([materialId, sheets]) => {
        const m = materials.find((mm) => mm.id === materialId);
        const avgUtil = sheets.reduce((s, sh) => s + sh.utilizationPct, 0) / sheets.length;
        return (
          <section key={materialId} className="mb-4" aria-label={t('panel.nesting.materialSection', { id: materialId })}>
            <h4 className="text-xs font-semibold mb-1">
              {m?.name ?? materialId} — {sheets.length} sheet{sheets.length === 1 ? '' : 's'}, avg {avgUtil.toFixed(1)}% util
            </h4>
            {sheets.map((s) => (
              <SheetSvg
                key={`${s.materialId}-${s.sheetIndex}`}
                sheet={s}
                material={m}
                grainByRowKey={grainByRowKey}
                onExportPng={handleExportPng}
                editable={editMode}
                selectedIndex={
                  selected && selected.materialId === s.materialId && selected.sheetIndex === s.sheetIndex
                    ? selected.panelArrayIndex
                    : null
                }
                onSelectPanel={(i) => handleSelectPanel(s.materialId, s.sheetIndex, i)}
              />
            ))}
          </section>
        );
      })}
      {nest.excluded.length > 0 && <ExcludedSection excluded={nest.excluded} />}
    </div>
  );
}

function ExcludedSection({ excluded }: { excluded: readonly NestExclusion[] }) {
  const { t } = useTranslation();
  return (
    <section aria-label={t('panel.nesting.excludedAriaLabel')} className="border-t pt-2 text-xs">
      <h4 className="font-semibold">{t('panel.nesting.excluded')}</h4>
      <ul>
        {excluded.map((e, i) => (
          <li key={i}>
            <strong>{e.materialId}</strong>:{' '}
            {e.reason === 'no-sheet-stock'
              ? t('panel.nesting.noSheetStock')
              : e.reason === 'grain-locked-exceeds-sheet'
                ? t('panel.nesting.grainLockedExceedsSheet', { s: e.itemNumbers.length === 1 ? '' : 's', nums: e.itemNumbers.join(', #') })
                : t('panel.nesting.panelExceedsSheet', { s: e.itemNumbers.length === 1 ? '' : 's', nums: e.itemNumbers.join(', #') })}
          </li>
        ))}
      </ul>
    </section>
  );
}
