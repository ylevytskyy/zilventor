import { useState, type FormEvent } from 'react';

export type ExtrudeOperation = 'new' | 'join' | 'cut';

export type ExtrudeDialogValue = {
  distance: string;
  operation: ExtrudeOperation;
};

type Props = {
  hasRunningBody: boolean;
  initialDistance?: string;
  onCommit(v: ExtrudeDialogValue): void;
  onCancel(): void;
};

const toggleBtnClass = (pressed: boolean, disabled: boolean): string => {
  const base = 'flex-1 px-2 py-1 border text-xs';
  if (disabled) return `${base} border-shell-border text-neutral-500 cursor-not-allowed`;
  if (pressed) return `${base} border-blue-400 bg-blue-900/40 text-white`;
  return `${base} border-shell-border hover:bg-shell`;
};

export default function ExtrudeDialog({
  hasRunningBody,
  initialDistance = '18',
  onCommit,
  onCancel,
}: Props): JSX.Element {
  const [distance, setDistance] = useState(initialDistance);
  const [operation, setOperation] = useState<ExtrudeOperation>(hasRunningBody ? 'join' : 'new');

  const canCommit = (() => {
    const d = Number(distance);
    return Number.isFinite(d) && d > 0;
  })();

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!canCommit) return;
    onCommit({ distance, operation });
  };

  return (
    <div role="dialog" aria-label="Extrude dialog" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <form onSubmit={handleSubmit} className="bg-shell-panel border border-shell-border p-4 w-64 text-xs">
        <h3 className="mb-3 text-sm">Extrude</h3>
        <label>Distance
          <input
            aria-label="Distance"
            className="block w-full mt-1 bg-shell text-white px-2 py-1"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
          />
        </label>

        <div className="mt-3">
          <span className="block font-semibold mb-1">Operation</span>
          <div className="flex gap-1">
            <button
              type="button"
              aria-pressed={operation === 'new'}
              className={toggleBtnClass(operation === 'new', false)}
              onClick={() => setOperation('new')}
            >
              New
            </button>
            <button
              type="button"
              aria-pressed={operation === 'join'}
              disabled={!hasRunningBody}
              className={toggleBtnClass(operation === 'join', !hasRunningBody)}
              onClick={() => setOperation('join')}
            >
              Join
            </button>
            <button
              type="button"
              aria-pressed={operation === 'cut'}
              disabled={!hasRunningBody}
              className={toggleBtnClass(operation === 'cut', !hasRunningBody)}
              onClick={() => setOperation('cut')}
            >
              Cut
            </button>
          </div>
        </div>

        <div className="flex gap-2 mt-4 justify-end">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="font-semibold" disabled={!canCommit}>OK</button>
        </div>
      </form>
    </div>
  );
}
