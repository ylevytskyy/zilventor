import type { BoreOp } from '@zilventor/shared';

/** ABF-compatible outline layer name (docs/abf-plugin/05-parity/04-abf-flatten-dxf-sample-analysis.md §3 Rule 5). */
export const ABF_OUTLINE_LAYER = 'ABF_cuttingLines';

/** Cyrillic → Latin transliteration table (Ukrainian + Russian standard romanization). */
const CYRILLIC_TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', ґ: 'g', д: 'd', е: 'e', ё: 'yo', є: 'ye',
  ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'yi', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh',
  ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e',
  ю: 'yu', я: 'ya',
};

function transliterate(s: string): string {
  return Array.from(s)
    .map((ch) => {
      const lower = ch.toLowerCase();
      const mapped = CYRILLIC_TRANSLIT[lower];
      if (mapped === undefined) return ch;
      return ch !== lower && mapped.length > 0 ? mapped.charAt(0).toUpperCase() + mapped.slice(1) : mapped;
    })
    .join('');
}

/**
 * Sanitizes a user-entered hardware SKU for embedding in a DXF R12 (ASCII-only)
 * layer name: transliterates Cyrillic, then replaces any remaining character
 * outside `[A-Za-z0-9_$-]` (the `$` prefix is load-bearing — real ABF SKUs are
 * `$`-prefixed) with `_`, collapses consecutive `_`, and trims leading/trailing `_`.
 */
export function sanitizeSkuForLayer(sku: string): string {
  return transliterate(sku)
    .replace(/[^A-Za-z0-9_$-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * ABF-compatible DXF layer name for a bore, per the ratified sample-evidenced
 * convention (docs/abf-plugin/05-parity/04-abf-flatten-dxf-sample-analysis.md §3):
 * face bores → `DEPTH<depth>-ARTICLE<sku>` (bare `DEPTH<depth>` when no sku);
 * edge bores → `ABF-DSIDE-<dia>` (sku ignored). A `throughAll` bore WITH a sku
 * gets the Rule-3 `D<diameter>-DEPTHF-<sku>` family (orientation-independent —
 * the sample's DEPTHF instance was itself a mixed face/edge split); a
 * `throughAll` bore with no sku still returns null (Rule 4: no invented THRU
 * convention when there's no hardware identity to hang the DEPTHF layer on) —
 * caller falls back to the native layer scheme. Face-vs-edge classification is
 * the caller's job.
 */
export function abfBoreLayer(b: BoreOp, orientation: 'face' | 'edge'): string | null {
  if (b.depth === 'throughAll') {
    const sku = b.sku !== undefined ? sanitizeSkuForLayer(b.sku) : '';
    return sku ? `D${b.diameter}-DEPTHF-${sku}` : null;
  }
  if (orientation === 'edge') return `ABF-DSIDE-${b.diameter}`;
  const sku = b.sku !== undefined ? sanitizeSkuForLayer(b.sku) : '';
  return sku ? `DEPTH${b.depth}-ARTICLE${sku}` : `DEPTH${b.depth}`;
}
