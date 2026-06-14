/**
 * Drawing-only autosave helper. Called from App.tsx's autosave debounce effect
 * when activeDocument.kind === 'drawing'. Pure and injected — no React deps.
 *
 * Does NOT handle part or assembly autosave; those remain inline in App.tsx
 * because they depend on partInfoCacheRef / panelSpecCacheRef React closures.
 */
import type { DrawingDocument } from '@zilventor/shared';
import { setLastOpenDrawing } from './lastOpenDocument';

export interface AutosaveDrawingOptions {
  doc: DrawingDocument;
  opfs: { write(path: string, bytes: Uint8Array): Promise<void> };
  packDrawing: (doc: DrawingDocument) => Promise<Uint8Array>;
}

/**
 * Acquire a Web Lock keyed on `lockName` before running `fn`.
 * Falls back to running `fn` directly when navigator.locks is unavailable
 * (SSR, older browsers, jsdom without the API polyfilled).
 *
 * Exported so callers in App.tsx can reuse the same helper for other
 * OPFS write sites (assembly autosave, part autosave).
 */
export async function withOpfsLock<T>(lockName: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(lockName, fn);
  }
  return fn();
}

export async function autosaveDrawing({ doc, opfs, packDrawing }: AutosaveDrawingOptions): Promise<void> {
  const path = `drawings/${doc.id}.zidw`;
  const bytes = await packDrawing(doc);
  await withOpfsLock(`opfs:${path}`, async () => {
    await opfs.write(path, bytes);
  });
  setLastOpenDrawing(path);
}
