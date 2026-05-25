// packages/app/src/commands/reprojectDetailRegion.ts
import { projectDetailView, fingerprintDetailView } from '@zilventor/shared';
import type { DetailView, DrawingView, RegionParent } from '@zilventor/shared';

/**
 * Recompute a DetailView's projection + fingerprint for a new region (circle or rect).
 * Pure: returns a new DetailView object; does NOT touch the store.
 * Mirrors the logic in AddDetailViewCommand.apply().
 */
export function reprojectDetailRegion(
  detail: DetailView,
  parentView: DrawingView & { projection: NonNullable<DrawingView['projection']> },
  region: RegionParent,
): DetailView {
  const projection = projectDetailView({
    parentView: parentView as Parameters<typeof projectDetailView>[0]['parentView'],
    regionParent: region,
    detailScale: detail.scale,
    showHidden: detail.showHidden,
  });

  const inputFingerprint = fingerprintDetailView(
    (parentView as { inputFingerprint?: string }).inputFingerprint ?? '',
    region,
    detail.scale,
  );

  return {
    ...detail,
    regionParent: region,
    projection,
    inputFingerprint,
  };
}
