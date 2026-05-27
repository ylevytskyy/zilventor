// packages/app/src/storage/lastOpenDocument.ts

const LAST_OPEN_KEY = 'zilventor:lastOpenDocument';

export type LastOpenKind = 'drawing' | 'part' | 'assembly';
export type LastOpenDocument = { kind: LastOpenKind; opfsPath: string };

export function setLastOpenDocument(ptr: LastOpenDocument): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LAST_OPEN_KEY, JSON.stringify(ptr));
}

export function getLastOpenDocument(): LastOpenDocument | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(LAST_OPEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (
      (p.kind === 'drawing' || p.kind === 'part' || p.kind === 'assembly') &&
      typeof p.opfsPath === 'string'
    ) {
      return { kind: p.kind, opfsPath: p.opfsPath };
    }
    return null;
  } catch {
    return null;
  }
}

// Thin wrapper — keeps the existing drawing autosave caller + tests unchanged.
export function setLastOpenDrawing(opfsPath: string): void {
  setLastOpenDocument({ kind: 'drawing', opfsPath });
}

export function getLastOpenDrawing(): LastOpenDocument | null {
  const p = getLastOpenDocument();
  return p && p.kind === 'drawing' ? p : null;
}

export function clearLastOpen(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(LAST_OPEN_KEY);
}
