import { isHardwareFeature, type HardwareEntry, type HardwareFeature, type HardwareRegistry } from '@zilventor/shared';
import type { PartDocument } from '@zilventor/shared';

export function resolveHardwareSpec(
  part: Pick<PartDocument, 'featureTree'>,
  registry: HardwareRegistry,
): { entry: HardwareEntry; feature: HardwareFeature } | null {
  const feature = (part.featureTree as unknown[]).find(
    (f): f is HardwareFeature => isHardwareFeature(f),
  );
  if (!feature) return null;
  const entry = registry.find((e) => e.id === feature.hardwareSkuId);
  if (!entry) return null;
  return { entry, feature };
}
