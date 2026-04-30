import { useState } from 'react';
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
  const [conflict, setConflict] = useState<ImportConflict>('skip');
  if (!props.isOpen) return null;

  const isWorking = props.status.kind === 'scanning' || props.status.kind === 'importing';

  return (
    <div role="dialog" aria-label="Import from Inventor" className="fixed inset-0 bg-black/40 flex items-center justify-center">
      <div className="bg-neutral-900 text-neutral-100 rounded shadow-lg p-4 w-[480px]">
        <h2 className="text-sm font-semibold mb-3">Import from Inventor</h2>
        <fieldset className="mb-3">
          <legend className="text-xs mb-1">If a file already exists in the target:</legend>
          <label className="block text-xs">
            <input type="radio" checked={conflict === 'overwrite'} onChange={() => setConflict('overwrite')} /> Overwrite
          </label>
          <label className="block text-xs">
            <input type="radio" checked={conflict === 'skip'} onChange={() => setConflict('skip')} /> Skip existing
          </label>
          <label className="block text-xs">
            <input type="radio" checked={conflict === 'cancel-on-conflict'} onChange={() => setConflict('cancel-on-conflict')} /> Cancel on conflict
          </label>
        </fieldset>
        {props.status.kind === 'importing' && (
          <div className="text-xs mb-2">
            Importing {props.status.current} / {props.status.total}: {props.status.path}
          </div>
        )}
        {props.status.kind === 'done' && (
          <div className="text-xs mb-2">
            Imported {props.status.summary.partsImported} parts, {props.status.summary.assembliesImported} assemblies, {props.status.summary.skipped} skipped, {props.status.summary.errors.length} errors.
          </div>
        )}
        {props.status.kind === 'error' && (
          <div className="text-xs text-red-400 mb-2">Error: {props.status.message}</div>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={props.onCancel} className="text-xs px-2 py-1 hover:text-white">Cancel</button>
          <button
            onClick={() => props.onConfirm(conflict)}
            disabled={isWorking}
            className="text-xs px-2 py-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-50"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
