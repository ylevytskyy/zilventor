import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useCutListResult } from './useCutListResult';
import { computeNestFingerprint } from '@zilventor/shared';
import type { NestSheet, NestExclusion } from '@zilventor/shared';
import { GenerateNestCommand } from '../commands/GenerateNestCommand';
// import { ExportNestPngCommand } from '../commands/ExportNestPngCommand'; // wired in Phase 7
import { SheetSvg } from './SheetSvg';

export function NestingTab() {
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const bus = useAppStore((s) => s.bus);
  const materials = activeAssembly?.materials ?? [];
  const nest = activeAssembly?.nest;
  const cutListResult = useCutListResult();

  const [currentFingerprint, setCurrentFingerprint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const kerf = nest?.params.kerfMm ?? 3;
    void computeNestFingerprint(cutListResult.rows, materials, kerf).then((fp) => {
      if (!cancelled) setCurrentFingerprint(fp);
    });
    return () => { cancelled = true; };
  }, [cutListResult.rows, materials, nest?.params.kerfMm]);

  const stale = !!nest && currentFingerprint !== null && currentFingerprint !== nest.inputFingerprint;

  const grainByRowKey = useMemo(() => {
    const m = new Map<string, (typeof cutListResult.rows)[number]['grain']>();
    cutListResult.rows.forEach((r) => m.set(r.rowKey, r.grain));
    return m;
  }, [cutListResult.rows]);

  if (!nest) {
    return (
      <div className="p-4 text-xs text-neutral-400">
        No nest generated yet. Click &quot;Generate Nest&quot; on the Furniture tab.
      </div>
    );
  }

  const grouped = new Map<string, NestSheet[]>();
  nest.sheets.forEach((s) => {
    if (!grouped.has(s.materialId)) grouped.set(s.materialId, []);
    grouped.get(s.materialId)!.push(s);
  });

  const handleRegenerate = () => {
    void bus.execute(new GenerateNestCommand({ kerfMm: nest.params.kerfMm, result: cutListResult, materials }));
  };

  const handleExportPng = (_sheet: NestSheet) => {
    console.warn('Export PNG not yet wired (Phase 7)');
  };

  return (
    <div data-nesting-tab>
      {stale && (
        <div role="status" aria-label="Nest stale" className="bg-yellow-100 text-yellow-900 px-2 py-1">
          ⚠️ Cut list changed since last nest.
          <button onClick={handleRegenerate} className="ml-2 underline">Regenerate</button>
        </div>
      )}
      {Array.from(grouped.entries()).map(([materialId, sheets]) => {
        const m = materials.find((mm) => mm.id === materialId);
        const avgUtil = sheets.reduce((s, sh) => s + sh.utilizationPct, 0) / sheets.length;
        return (
          <section key={materialId} className="mb-4" aria-label={`Material section ${materialId}`}>
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
  return (
    <section aria-label="Nest excluded section" className="border-t pt-2 text-xs">
      <h4 className="font-semibold">Excluded</h4>
      <ul>
        {excluded.map((e, i) => (
          <li key={i}>
            <strong>{e.materialId}</strong>:{' '}
            {e.reason === 'no-sheet-stock'
              ? 'no sheet stock defined'
              : `panel exceeds sheet (item${e.itemNumbers.length === 1 ? '' : 's'} #${e.itemNumbers.join(', #')})`}
          </li>
        ))}
      </ul>
    </section>
  );
}
