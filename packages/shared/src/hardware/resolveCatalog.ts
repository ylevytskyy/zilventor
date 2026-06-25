import { BUILTIN_CATALOG, type CatalogEntry } from './builtinCatalog';

/** The full catalog entry shape (metadata + geometry). Builtin and custom alike. */
export type HardwareCatalogEntry = CatalogEntry;

/**
 * Effective hardware catalog for a document: built-in SKUs followed by the
 * document's user-imported `customHardware` (M4 Slice D). Pure; never mutates.
 */
export function resolveHardwareCatalog(
  doc: { customHardware?: readonly HardwareCatalogEntry[] } | null | undefined,
): readonly HardwareCatalogEntry[] {
  return [...BUILTIN_CATALOG, ...(doc?.customHardware ?? [])];
}
