/**
 * buildSlidePart — pack a hardware-only .zipt for a drawer-slide SKU.
 * Part of Milestone 1b.5 (hardware catalog expansion).
 *
 * Mirrors buildPullPart: builds a single HardwareFeature from a BUILTIN_CATALOG
 * entry. A drawer slide is sold as a pair, so one slide part per drawer rolls up
 * to one drawerSlides BOM row of quantity = drawer count.
 *
 * The path prefix `hardware/` is REQUIRED so buildHardwareCache recognises it.
 */

import type { HardwareFeature, PartDocument } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { newPart, addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { packProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { BUILTIN_CATALOG } from '@zilventor/shared/src/hardware/builtinCatalog';

export interface BuildSlidePartResult {
  /** Packed .zipt bytes for the slide part. */
  bytes: Uint8Array;
  /** Intended OPFS path: `hardware/<skuId>.zipt`. */
  path: string;
}

/** Default drawer-slide SKU placed by AddDrawerBankCommand. */
export const DEFAULT_DRAWER_SLIDE_SKU = 'drawer-slide-500-fullext';

/**
 * Build and pack a PartDocument containing a single HardwareFeature for the
 * given drawer-slide SKU. Throws if the SKU is not found in BUILTIN_CATALOG.
 */
export async function buildSlidePart(skuId: string): Promise<BuildSlidePartResult> {
  const entry = BUILTIN_CATALOG.find((e) => e.id === skuId);
  if (!entry) {
    throw new Error(`buildSlidePart: unknown SKU '${skuId}' — not in BUILTIN_CATALOG`);
  }

  const hwFeature: HardwareFeature = {
    kind: 'hardware',
    id: 'slide',
    hardwareSkuId: skuId,
    bboxMm: entry.bboxMm,
    attachPoints: entry.attachPoints,
  };

  const partDoc: PartDocument = addFeature(newPart(entry.name), hwFeature);

  const bytes = await packProject({
    manifest: {
      formatVersion: CURRENT_FORMAT_VERSION,
      kind: 'part' as const,
      document: partDoc,
    },
    blobs: {},
  });

  return {
    bytes,
    path: `hardware/${skuId}.zipt`,
  };
}
