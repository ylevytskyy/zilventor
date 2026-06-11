import type { AssemblyDocument, BoreOp, PartInfo } from '@zilventor/shared';
import { pathKey, CONNECTOR_BOM_CATALOG } from '@zilventor/shared';
import type { BoreConnectorKind } from '@zilventor/shared';
import type { SubAssemblyCache } from '../SubAssemblyCache';

/**
 * Internal aggregator output — locale-free; resolved to ConnectorBomRow by useConnectorBomResult.
 * The aggregator stays pure/locale-free and returns nameKey, not a resolved name.
 */
export interface ConnectorBomRawRow {
  kind: BoreConnectorKind;
  /** i18n key; e.g. 'bom.connector.confirmat'. Resolved to display name by useConnectorBomResult. */
  nameKey: string;
  notes: string;
  qty: number;
}

/**
 * Aggregates connector/fastener counts from all panels in an assembly tree.
 *
 * Deduplication model:
 *   - Fasteners (confirmat / minifix / dowel / hinge): deduplicated by
 *     Set<`${enclosingScopeKey}:${connectorKind}:${connectorId}`>
 *     where enclosingScopeKey = pathKey of the NEAREST enclosing .ziasm instance.
 *     This prevents double-counting when both panel docs of the same joint appear
 *     inside the same .ziasm scope. Using the nearest instance (not root/outer) means
 *     two instances of the same inner cabinet each contribute their own confirmats (×N).
 *   - shelfPin: counted per bore (role === 'shelfPin-system32'), connectorId
 *     NOT used for dedup — each hole is one pin.
 *
 * Returns ConnectorBomRawRow[] sorted by kind ascending. Pure, no I/O.
 */
export function aggregateConnectorBomRecursive(
  activeDoc: AssemblyDocument,
  cache: Pick<SubAssemblyCache, 'get'>,
  partBores: Map<string, BoreOp[]>,
  partInfo: Map<string, PartInfo>,
): ConnectorBomRawRow[] {
  // Accumulator: kind → qty
  const qtys = new Map<BoreConnectorKind, number>();
  // Fastener dedup set: `${nearestScopeKey}:${kind}:${connectorId}`
  const seen = new Set<string>();

  /**
   * Walk the assembly tree recursively.
   *
   * @param doc        — the assembly document to walk
   * @param prefix     — component-id path from root to the current doc's parent instance
   * @param scopeKey   — pathKey of the NEAREST enclosing .ziasm instance
   *                     (empty string = at root level, no enclosing .ziasm yet)
   */
  function walk(doc: AssemblyDocument, prefix: string[], scopeKey: string): void {
    for (const c of doc.components) {
      const path = [...prefix, c.id];

      if (c.partPath.endsWith('.ziasm')) {
        const e = cache.get(c.partPath);
        if (e && e.kind === 'ok') {
          // This instance becomes the new nearest enclosing .ziasm scope for everything inside it.
          // Using pathKey(path) (the INSTANCE path) rather than c.partPath (the FILE path) ensures
          // two instances of the same .ziasm file get different scope keys (enables ×N counting).
          const newScopeKey = pathKey(path);
          walk(e.doc, path, newScopeKey);
        }
        continue;
      }

      const bores = partBores.get(c.partPath);
      if (!bores || bores.length === 0) continue;

      for (const bore of bores) {
        if (bore.role === 'shelfPin-system32') {
          // Per-hole counting — connectorId NOT used for dedup.
          // Each Ø5 hole in a shelf-pin grid is one physical pin.
          qtys.set('shelfPin', (qtys.get('shelfPin') ?? 0) + 1);
        } else {
          // Fastener: deduplicate by nearest-scope-key + connector-kind + connectorId.
          // The connectorId is shared between the face and edge bores of the same joint,
          // so both bores of one confirmat pair collapse to a single counted fastener.
          const dedupKey = `${scopeKey}:${bore.connectorKind}:${bore.connectorId}`;
          if (!seen.has(dedupKey)) {
            seen.add(dedupKey);
            qtys.set(bore.connectorKind, (qtys.get(bore.connectorKind) ?? 0) + 1);
          }
        }
      }
    }
  }

  // Root-level parts have no enclosing .ziasm — use empty string as scope key.
  // Root-level .ziasm components set their own scope key when entered (via newScopeKey = pathKey(path)).
  walk(activeDoc, [], '');

  // Build rows from accumulated qtys, resolving nameKey from catalog.
  const rows: ConnectorBomRawRow[] = [];
  for (const [kind, qty] of qtys.entries()) {
    const entry = CONNECTOR_BOM_CATALOG[kind];
    rows.push({
      kind,
      nameKey: entry.nameKey,
      notes: entry.notes,
      qty,
    });
  }

  rows.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  return rows;
}
