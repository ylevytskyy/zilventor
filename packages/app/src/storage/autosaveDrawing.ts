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

export async function autosaveDrawing({ doc, opfs, packDrawing }: AutosaveDrawingOptions): Promise<void> {
  const bytes = await packDrawing(doc);
  const path = `drawings/${doc.id}.zidw`;
  await opfs.write(path, bytes);
  setLastOpenDrawing(path);
}
