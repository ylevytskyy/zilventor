import type { PanelFaceRole } from './bore';

/**
 * A parametric dado / groove / rabbet channel cut into one face of a panel.
 *
 * The groove runs the FULL extent of the face along `axis` (a through-channel,
 * edge to edge) and is `width` wide across the other axis, centred at
 * `position` (mm, measured along the cross-axis from the face's frame origin —
 * see `face2DFrame`). It is cut `depth` mm into the panel along the inward face
 * normal.
 *
 *   axis 'u' → groove runs along uDir; `position` offsets it along vDir
 *   axis 'v' → groove runs along vDir; `position` offsets it along uDir
 */
export interface GrooveSpec {
  faceRole: PanelFaceRole;
  axis: 'u' | 'v';
  position: number;
  width: number;
  depth: number;
  label?: string;
}

/**
 * A groove as a regenerable feature-tree entry (mirrors how присадка bores
 * become `kind:'hole'` features). `executeTree` re-cuts the channel from this
 * spec on every build, so the groove survives save/reload — unlike a one-shot
 * cut of the cached `main` blob.
 */
export interface GrooveFeature extends GrooveSpec {
  kind: 'groove';
  id: string;
}
