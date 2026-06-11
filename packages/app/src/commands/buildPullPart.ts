/**
 * buildPullPart — pack a hardware-only .zipt for a bar-pull SKU.
 * Part of присадка slice 6 (drawer handles/pulls).
 *
 * Returns the packed bytes and the intended OPFS path `hardware/<skuId>.zipt`.
 * The path prefix `hardware/` is REQUIRED so buildHardwareCache recognises it.
 */

import type { HardwareFeature, PartDocument } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { newPart, addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { packProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { BUILTIN_CATALOG } from '@zilventor/shared/src/hardware/builtinCatalog';

export interface BuildPullPartResult {
  /** Packed .zipt bytes for the pull part. */
  bytes: Uint8Array;
  /** Intended OPFS path: `hardware/<skuId>.zipt`. */
  path: string;
}

/**
 * Build and pack a PartDocument containing a single HardwareFeature for the
 * given bar-pull SKU. Throws if the SKU is not found in BUILTIN_CATALOG.
 */
export async function buildPullPart(skuId: string): Promise<BuildPullPartResult> {
  const entry = BUILTIN_CATALOG.find((e) => e.id === skuId);
  if (!entry) {
    throw new Error(`buildPullPart: unknown SKU '${skuId}' — not in BUILTIN_CATALOG`);
  }

  const hwFeature: HardwareFeature = {
    kind: 'hardware',
    id: 'pull',
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

/** Map from centre-to-centre spacing (mm) to the SKU id in BUILTIN_CATALOG. */
export const BAR_PULL_SKU: Readonly<Record<96 | 128 | 160, string>> = {
  96:  'bar-pull-96',
  128: 'bar-pull-128',
  160: 'bar-pull-160',
};
