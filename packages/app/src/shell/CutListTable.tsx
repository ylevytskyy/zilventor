import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CutListResult, CutListRow } from '@zilventor/shared/src/cutListRow';

export type CutListTableProps = {
  result: CutListResult;
  onSelectRow: (componentPathKeys: string[]) => void;
  onEditItemNumber: (rowKey: string, n: number) => void;
  onExportCsv: () => void;
};

function bandLabel(cell: CutListRow['edgeBands']['front']): string {
  return cell ? cell.materialName : '';
}

function ItemNumberCell({
  row, onEditItemNumber,
}: { row: CutListRow; onEditItemNumber: CutListTableProps['onEditItemNumber'] }): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(row.itemNumber));
  if (editing) {
    return (
      <td onClick={(e) => e.stopPropagation()} className="px-2 py-1 border-b">
        <input
          type="number"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            const n = Number(value);
            if (Number.isInteger(n) && n > 0) onEditItemNumber(row.rowKey, n);
            setEditing(false);
          }}
          className="w-16"
        />
      </td>
    );
  }
  return (
    <td
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={() => { setValue(String(row.itemNumber)); setEditing(true); }}
      aria-label={`Item# ${row.itemNumber}`}
      className="px-2 py-1 border-b cursor-text"
    >
      {row.itemNumber}
    </td>
  );
}

export function CutListTable({ result, onSelectRow, onEditItemNumber, onExportCsv }: CutListTableProps): JSX.Element {
  const { t } = useTranslation();
  const canExport = result.rows.length > 0 || result.excluded.componentCount > 0;
  return (
    <div className="flex flex-col gap-3 p-2 text-xs">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onExportCsv}
          disabled={!canExport}
          className="px-2 py-1 rounded border bg-white disabled:opacity-50"
        >
          {t('common.export_csv')}
        </button>
      </div>
      {result.rows.length === 0 ? (
        <div className="italic text-gray-500 px-2">{t('common.no_panels')}</div>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="px-2 py-1 border-b">{t('table.cutlist.item_num')}</th>
              <th className="px-2 py-1 border-b">{t('table.cutlist.qty')}</th>
              <th className="px-2 py-1 border-b">{t('table.cutlist.material')}</th>
              <th className="px-2 py-1 border-b">{t('table.cutlist.length')}</th>
              <th className="px-2 py-1 border-b">{t('table.cutlist.width')}</th>
              <th className="px-2 py-1 border-b">{t('table.cutlist.thickness')}</th>
              <th className="px-2 py-1 border-b">{t('table.cutlist.grain')}</th>
              <th className="px-2 py-1 border-b">{t('table.cutlist.front')}</th>
              <th className="px-2 py-1 border-b">{t('table.cutlist.back')}</th>
              <th className="px-2 py-1 border-b">{t('table.cutlist.left')}</th>
              <th className="px-2 py-1 border-b">{t('table.cutlist.right')}</th>
              <th className="px-2 py-1 border-b">{t('table.cutlist.part_name')}</th>
              <th className="px-2 py-1 border-b">{t('table.cutlist.part_path')}</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => {
              const broken = r.materialName === '(missing material)';
              return (
                <tr
                  key={r.rowKey}
                  data-cutlist-row
                  className={broken ? 'bg-yellow-50 hover:bg-yellow-100 cursor-pointer' : 'hover:bg-gray-50 cursor-pointer'}
                  aria-invalid={broken ? 'true' : undefined}
                  onClick={() => onSelectRow([...r.componentPathKeys])}
                >
                  <ItemNumberCell row={r} onEditItemNumber={onEditItemNumber} />
                  <td className="px-2 py-1 border-b">{r.qty}</td>
                  <td className="px-2 py-1 border-b">{r.materialName}</td>
                  <td className="px-2 py-1 border-b">{r.length}</td>
                  <td className="px-2 py-1 border-b">{r.width}</td>
                  <td className="px-2 py-1 border-b">{r.thickness}</td>
                  <td className="px-2 py-1 border-b">{r.grain}</td>
                  <td className="px-2 py-1 border-b">{bandLabel(r.edgeBands.front)}</td>
                  <td className="px-2 py-1 border-b">{bandLabel(r.edgeBands.back)}</td>
                  <td className="px-2 py-1 border-b">{bandLabel(r.edgeBands.left)}</td>
                  <td className="px-2 py-1 border-b">{bandLabel(r.edgeBands.right)}</td>
                  <td className="px-2 py-1 border-b">{r.partName}</td>
                  <td className="px-2 py-1 border-b">{r.partPath}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {result.bandTotals.length > 0 && (
        <div>
          <div className="font-semibold mb-1">{t('table.cutlist.edge_band_totals')}</div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="px-2 py-1 border-b">{t('table.cutlist.material')}</th>
                <th className="px-2 py-1 border-b">{t('table.cutlist.total_mm')}</th>
                <th className="px-2 py-1 border-b">{t('table.cutlist.total_m')}</th>
              </tr>
            </thead>
            <tbody>
              {result.bandTotals.map((b) => (
                <tr key={b.materialId}>
                  <td className="px-2 py-1 border-b">{b.materialName}</td>
                  <td className="px-2 py-1 border-b">{b.totalLengthMm} mm</td>
                  <td className="px-2 py-1 border-b">{(b.totalLengthMm / 1000).toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-gray-600 italic">
        {t('table.cutlist.excluded', { componentCount: result.excluded.componentCount, partCount: result.excluded.partCount })}
      </div>
    </div>
  );
}
