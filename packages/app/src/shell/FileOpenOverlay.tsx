import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';

function formatElapsed(sec: number): string {
  const mm = Math.floor(sec / 60);
  const ss = String(sec % 60).padStart(2, '0');
  return mm > 0 ? `${mm}:${ss}` : `${sec}s`;
}

/**
 * Blocking modal shown while a File→Open is in progress (driven by the store's
 * `fileOpen` slice). Dimmed scrim prevents other commands; the Cancel button
 * aborts via the injected `onCancel` (a hard kernel restart — see the spec).
 */
export default function FileOpenOverlay({ onCancel }: { onCancel: () => void }) {
  const fileOpen = useAppStore((s) => s.fileOpen);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!fileOpen) {
      setElapsedSec(0);
      return;
    }
    const { startedAtMs } = fileOpen;
    setElapsedSec(Math.floor((Date.now() - startedAtMs) / 1000));
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAtMs) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [fileOpen]);

  if (!fileOpen) return null;

  return (
    <div
      role="alertdialog"
      aria-label="Opening file"
      data-testid="file-open-overlay"
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
    >
      <div className="bg-shell-panel border border-shell-border p-6 w-96 text-xs flex flex-col items-center gap-3">
        <div
          aria-hidden="true"
          className="w-8 h-8 border-2 border-neutral-600 border-t-white rounded-full animate-spin"
        />
        <div className="text-sm">Opening {fileOpen.fileName}…</div>
        <div className="text-neutral-300" data-testid="file-open-elapsed">
          {formatElapsed(elapsedSec)} elapsed
        </div>
        {elapsedSec >= 3 && (
          <div className="text-neutral-400 text-center">
            Large assemblies can take several minutes.
          </div>
        )}
        <button
          onClick={onCancel}
          className="mt-2 px-3 py-1 border border-shell-border hover:text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
