// packages/app/src/commands/reprojectDetailRegion.ts
import { projectDetailView, fingerprintDetailView } from '@zilventor/shared';
import type { DetailView, DrawingView } from '@zilventor/shared';

type Region = { center: { x: number; y: number }; radiusMm: number };

/**
 * Recompute a DetailView's projection + fingerprint for a new region.
 * Pure: returns a new DetailView object; does NOT touch the store.
 * Mirrors the logic in AddDetailViewCommand.apply().
 */
export function reprojectDetailRegion(
  detail: DetailView,
  parentView: DrawingView & { projection: NonNullable<DrawingView['projection']> },
  region: Region,
): DetailView {
  const projection = projectDetailView({
    parentView: parentView as Parameters<typeof projectDetailView>[0]['parentView'],
    regionParent: { center: region.center, radiusMm: region.radiusMm },
    detailScale: detail.scale,
    showHidden: detail.showHidden,
  });

  const inputFingerprint = fingerprintDetailView(
    (parentView as { inputFingerprint?: string }).inputFingerprint ?? '',
    { center: region.center, radiusMm: region.radiusMm },
    detail.scale,
  );

  return {
    ...detail,
    regionParent: { center: region.center, radiusMm: region.radiusMm },
    projection,
    inputFingerprint,
  };
}
