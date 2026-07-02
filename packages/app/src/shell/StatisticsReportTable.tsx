import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { StatisticsReportLine, StatisticsReportSection, StatisticsReport } from '../commands/buildStatisticsReport';
import { useAppStore } from '../store/useAppStore';
import { SetUnitPriceCommand } from '../commands/SetUnitPriceCommand';
import { ExportStatisticsCsvCommand } from '../commands/ExportStatisticsCsvCommand';
import { ExportStatisticsXlsxCommand } from '../commands/ExportStatisticsXlsxCommand';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatPieces(pieces: StatisticsReportLine['pieces']): string {
  if (!pieces || pieces.length === 0) return '';
  return pieces.map((p) => `${p.qty}×${p.lengthMm}mm`).join(', ');
}

function PriceCell({ line }: { line: StatisticsReportLine }): JSX.Element {
  const { t } = useTranslation();
  const [value, setValue] = useState(line.unitPrice !== undefined ? String(round2(line.unitPrice)) : '');
  const [asDefault, setAsDefault] = useState(false);

  useEffect(() => {
    setValue(line.unitPrice !== undefined ? String(round2(line.unitPrice)) : '');
  }, [line.unitPrice, line.key]);

  const commit = (): void => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return;
    void new SetUnitPriceCommand({ key: line.key, price: n }).apply();
    if (asDefault) useAppStore.getState().setDefaultPrice(line.key, n);
  };

  return (
    <td className="px-2 py-1 border-b" onClick={(e) => e.stopPropagation()}>
      <input
        type="number"
        step="0.01"
        min={0}
        aria-label={`unit-price-${line.key}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); }
        }}
        className="w-20"
      />
      <label className="ml-1 text-[10px] text-gray-500">
        <input
          type="checkbox"
          aria-label={`set-default-${line.key}`}
          checked={asDefault}
          onChange={(e) => setAsDefault(e.target.checked)}
        />{' '}
        {t('table.statistics.setAsDefault')}
      </label>
    </td>
  );
}

function SectionBlock({ section }: { section: StatisticsReportSection }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="mb-3">
      <div className="font-semibold mb-1">{t(`table.statistics.${section.category}`)}</div>
      {section.lines.length === 0 ? (
        <div className="italic text-gray-500 px-2">{t('table.statistics.noLines')}</div>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="px-2 py-1 border-b">{t('table.statistics.label')}</th>
              <th className="px-2 py-1 border-b">{t('table.statistics.qty')}</th>
              <th className="px-2 py-1 border-b">{t('table.statistics.unit')}</th>
              <th className="px-2 py-1 border-b">{t('table.statistics.unitPrice')}</th>
              <th className="px-2 py-1 border-b">{t('table.statistics.lineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {section.lines.map((line) => (
              <tr key={line.key} data-statistics-row>
                <td className="px-2 py-1 border-b">
                  {line.label}
                  {line.pieces && line.pieces.length > 0 && (
                    <div className="text-[10px] text-gray-500">
                      {t('table.statistics.pieces')}: {formatPieces(line.pieces)}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1 border-b">{line.qty}</td>
                <td className="px-2 py-1 border-b">{line.unit}</td>
                <PriceCell line={line} />
                <td className="px-2 py-1 border-b">{line.lineTotal !== undefined ? round2(line.lineTotal) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="px-2 py-1 border-b" colSpan={4}>{t('table.statistics.subtotal')}</td>
              <td className="px-2 py-1 border-b">{round2(section.subtotal)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

export type StatisticsReportTableProps = {
  report: StatisticsReport;
  suggestedName: string;
};

export function StatisticsReportTable({ report, suggestedName }: StatisticsReportTableProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <div data-testid="statistics-report-table" className="flex flex-col gap-3 p-2 text-xs">
      <div className="flex justify-end items-center gap-2">
        <span className="italic text-gray-500 mr-auto">
          {t('table.statistics.unpriced', { count: report.unpricedLineCount })}
        </span>
        <button
          type="button"
          onClick={() => void new ExportStatisticsCsvCommand({ report, suggestedName: `${suggestedName}.csv` }).apply()}
          className="px-2 py-1 rounded border bg-white"
        >
          {t('common.export_csv')}
        </button>
        <button
          type="button"
          onClick={() => void new ExportStatisticsXlsxCommand({ report, suggestedName: `${suggestedName}.xlsx` }).apply()}
          className="px-2 py-1 rounded border bg-white"
        >
          {t('common.export_xlsx')}
        </button>
      </div>
      {report.sections.map((section) => (
        <SectionBlock key={section.category} section={section} />
      ))}
      <div className="text-right font-bold border-t pt-1">
        {t('table.statistics.grandTotal')}: {round2(report.grandTotal)}
      </div>
    </div>
  );
}
