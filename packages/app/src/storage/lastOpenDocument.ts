// packages/app/src/storage/lastOpenDocument.ts

const LAST_OPEN_KEY = 'zilventor:lastOpenDocument';

export type LastOpenDocument = { kind: 'drawing'; opfsPath: string };

export function setLastOpenDrawing(opfsPath: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LAST_OPEN_KEY, JSON.stringify({ kind: 'drawing', opfsPath }));
}

export function getLastOpenDrawing(): LastOpenDocument | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(LAST_OPEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as Record<string, unknown>)['kind'] === 'drawing' &&
      typeof (parsed as Record<string, unknown>)['opfsPath'] === 'string'
    ) {
      return parsed as LastOpenDocument;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearLastOpen(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(LAST_OPEN_KEY);
}
