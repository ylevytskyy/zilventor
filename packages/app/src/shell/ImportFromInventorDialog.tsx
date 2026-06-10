import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImportConflict, ImportSummary } from '../import/InventorImporter';

export type ImportDialogStatus =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'importing'; current: number; total: number; path: string }
  | { kind: 'done'; summary: ImportSummary }
  | { kind: 'error'; message: string };

export type ImportFromInventorDialogProps = {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: (conflict: ImportConflict) => void;
  status: ImportDialogStatus;
};

export function ImportFromInventorDialog(props: ImportFromInventorDialogProps): JSX.Element | null {
  const { t } = useTranslation();
  const [conflict, setConflict] = useState<ImportConflict>('skip');
  if (!props.isOpen) return null;

  const isWorking = props.status.kind === 'scanning' || props.status.kind === 'importing';

  return (
    <div role="dialog" aria-label={t('dialog.importInventor.title')} className="fixed inset-0 bg-black/40 flex items-center justify-center">
      <div className="bg-neutral-900 text-neutral-100 rounded shadow-lg p-4 w-[480px]">
        <h2 className="text-sm font-semibold mb-3">{t('dialog.importInventor.title')}</h2>
        <fieldset className="mb-3">
          <legend className="text-xs mb-1">{t('dialog.importInventor.conflictLegend')}</legend>
          <label className="block text-xs">
            <input type="radio" name="conflict-policy" checked={conflict === 'overwrite'} onChange={() => setConflict('overwrite')} /> {t('dialog.importInventor.overwrite')}
          </label>
          <label className="block text-xs">
            <input type="radio" name="conflict-policy" checked={conflict === 'skip'} onChange={() => setConflict('skip')} /> {t('dialog.importInventor.skip')}
          </label>
          <label className="block text-xs">
            <input type="radio" name="conflict-policy" checked={conflict === 'cancel-on-conflict'} onChange={() => setConflict('cancel-on-conflict')} /> {t('dialog.importInventor.cancelOnConflict')}
          </label>
        </fieldset>
        {props.status.kind === 'importing' && (
          <div className="text-xs mb-2">
            {t('dialog.importInventor.importing', { current: props.status.current, total: props.status.total, path: props.status.path })}
          </div>
        )}
        {props.status.kind === 'done' && (
          <div className="text-xs mb-2">
            {t('dialog.importInventor.done', { parts: props.status.summary.partsImported, assemblies: props.status.summary.assembliesImported, skipped: props.status.summary.skipped, errors: props.status.summary.errors.length })}
          </div>
        )}
        {props.status.kind === 'error' && (
          <div className="text-xs text-red-400 mb-2">{t('dialog.importInventor.error', { message: props.status.message })}</div>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={props.onCancel} className="text-xs px-2 py-1 hover:text-white">{t('common.cancel')}</button>
          <button
            onClick={() => props.onConfirm(conflict)}
            disabled={isWorking}
            className="text-xs px-2 py-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-50"
          >
            {t('dialog.importInventor.importBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}
