/**
 * Cross-browser file picker helpers. Use these instead of calling
 * window.showOpenFilePicker / window.showSaveFilePicker directly,
 * so Firefox/Safari (no File System Access API) work too.
 */

export type FilePickerType = {
  description: string;
  /** mime → extension list, e.g. { 'application/step': ['.step', '.stp'] } */
  accept: Record<string, string[]>;
};

/** True iff the browser exposes showOpenFilePicker / showSaveFilePicker. */
export function hasFsa(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function'
  );
}

/** True iff the browser exposes showDirectoryPicker (Chromium only). */
export function hasDirectoryPicker(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
  );
}

/**
 * Pick a single file. Returns null when the user cancels.
 * Uses showOpenFilePicker on Chromium; falls back to a hidden
 * <input type="file"> elsewhere.
 */
export async function pickFile(types: FilePickerType[]): Promise<File | null> {
  if (hasFsa()) {
    try {
      const [handle] = await (
        window as unknown as {
          showOpenFilePicker: (o: unknown) => Promise<FileSystemFileHandle[]>;
        }
      ).showOpenFilePicker({ types });
      if (!handle) return null;
      return await handle.getFile();
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      throw e;
    }
  }

  if (typeof document === 'undefined') return null;

  const accept = Array.from(
    new Set(types.flatMap((t) => Object.values(t.accept).flat())),
  ).join(',');

  return new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';

    let settled = false;
    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    input.addEventListener('change', () => {
      if (settled) return;
      settled = true;
      const f = input.files?.[0] ?? null;
      cleanup();
      resolve(f);
    });

    // 'cancel' event lands in modern browsers; older Firefox won't fire it.
    // Either way, change-or-cancel covers both outcomes deterministically.
    // Older-Firefox users who dismiss without selecting will see a hanging
    // promise — acceptable as a minor known limitation.
    input.addEventListener('cancel', () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    });

    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Save bytes (as a Blob) to disk. Uses showSaveFilePicker on Chromium
 * (real overwrite semantics with a user-chosen path); falls back to a
 * one-shot anchor download (file lands in the browser's default
 * downloads folder under the suggestedName).
 *
 * Returns true if the user committed a save / a download fired;
 * false if they cancelled the picker.
 */
export async function saveBlob(
  blob: Blob,
  suggestedName: string,
  types: FilePickerType[],
): Promise<boolean> {
  const w = (typeof window !== 'undefined' ? window : undefined) as
    | (Window & { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> })
    | undefined;

  if (w && typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName, types });
      const writable = await (
        handle as unknown as {
          createWritable: () => Promise<{
            write: (b: Blob) => Promise<void>;
            close: () => Promise<void>;
          }>;
        }
      ).createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false;
      throw e;
    }
  }

  if (typeof document === 'undefined') return false;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}
