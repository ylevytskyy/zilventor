import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';
import { useCutListResult } from './useCutListResult';
import { computeNestFingerprint } from '@zilventor/shared';
import type { NestSheet, NestExclusion } from '@zilventor/shared';
import { GenerateNestCommand } from '../commands/GenerateNestCommand';
import { ExportNestPngCommand } from '../commands/ExportNestPngCommand';
import { SheetSvg } from './SheetSvg';

export function NestingTab() {
  const { t } = useTranslation();
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const bus = useAppStore((s) => s.bus);
  const materials = activeAssembly?.materials ?? [];
  const nest = activeAssembly?.nest;
  const cutListResult = useCutListResult();

  const [currentFingerprint, setCurrentFingerprint] = useState<string | null>(null);

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

  return (
    <div data-nesting-tab>
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
              : t('panel.nesting.panelExceedsSheet', { s: e.itemNumbers.length === 1 ? '' : 's', nums: e.itemNumbers.join(', #') })}
          </li>
        ))}
      </ul>
    </section>
  );
}
