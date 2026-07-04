import type { BoreOp } from '@zilventor/shared';

/** ABF-compatible outline layer name (docs/abf-plugin/05-parity/04-abf-flatten-dxf-sample-analysis.md §3 Rule 5). */
export const ABF_OUTLINE_LAYER = 'ABF_cuttingLines';

/**
 * ABF-compatible DXF layer name for a bore, per the ratified sample-evidenced
 * convention (docs/abf-plugin/05-parity/04-abf-flatten-dxf-sample-analysis.md §3):
 * face bores → `DEPTH<depth>-ARTICLE<sku>` (bare `DEPTH<depth>` when no sku);
 * edge bores → `ABF-DSIDE-<dia>` (sku ignored). Returns null for a `throughAll`
 * bore (Rule 4: no invented THRU convention) — caller falls back to the native
 * layer scheme. Face-vs-edge classification is the caller's job.
 */
export function abfBoreLayer(b: BoreOp, orientation: 'face' | 'edge'): string | null {
  if (b.depth === 'throughAll') return null;
  if (orientation === 'edge') return `ABF-DSIDE-${b.diameter}`;
  return b.sku !== undefined ? `DEPTH${b.depth}-ARTICLE${b.sku}` : `DEPTH${b.depth}`;
}
