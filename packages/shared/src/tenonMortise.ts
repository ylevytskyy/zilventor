import type { PanelFaceRole } from './bore';

export type JoineryRole = 'tenon' | 'mortise';

/**
 * A parametric rectangular tenon/mortise joinery feature — MVP scope (P6 plan
 * doc D6/S2): a full-thickness box-joint-style tab/pocket, not a
 * shoulder-reduced classic tenon (no thickness-reduction field exists).
 *
 * `role==='tenon'`: `count` protruding tabs on the panel's END face
 * (`faceRole`, typically Left/Right/Front/Back), each `width` mm along
 * `axis`, spanning the panel's full thickness across the other (cross) axis,
 * protruding `depth` mm outward from the face (boolean fuse).
 *
 * `role==='mortise'`: `count` receiving pockets on the mating panel's face
 * (`faceRole`), each `width` mm along `axis` (widened by `fitClearance` on
 * each side so the tenon fits). Across the cross axis, the pocket is bounded
 * to the mating (tenon-host) panel's end footprint via `crossPosition`/
 * `crossSpan` when present — see those fields' docs — falling back to the
 * full cross-axis extent when absent (legacy/tenon behavior). Cut
 * `depth + fitClearance` mm into the panel (boolean cut).
 *
 * `count` tabs/pockets are centred as a group on `position` (mm, along
 * `axis`, measured from the face frame origin — see `face2DFrame`) and
 * spaced `spacing` mm apart, centre-to-centre (ignored when count===1).
 *
 *   axis 'u' → tabs/pockets are arranged along uDir
 *   axis 'v' → tabs/pockets are arranged along vDir
 */
export interface TenonMortiseSpec {
  role: JoineryRole;
  faceRole: PanelFaceRole;
  axis: 'u' | 'v';
  position: number;
  width: number;
  depth: number;
  count: number;
  spacing: number;
  /** Added to the mortise pocket's half-width, cross-span half-width, and
   *  depth (each side/direction). Tenon tabs always render at nominal
   *  width/depth. Required (not optional) so both roles carry the same field
   *  for symmetry with the pairing that produced them — pass 0 for a
   *  snug/no-clearance mortise. */
  fitClearance: number;
  /** Center of the pocket group along the CROSS axis (mm, host face frame,
   *  measured from the face2DFrame origin — the same convention `position`
   *  uses for the run axis). Meaningful for role:'mortise' only, set by
   *  `generateTenonMortisePair` from `crossCoord(matingPanelThickness)` (the
   *  same coordinate the bore precedent lands on). Absent → `buildTenonMortiseCutters`
   *  falls back to spanning the cross axis's full extent (legacy/tenon
   *  behavior — a tenon's own full-thickness footprint IS that full extent,
   *  so it never needs this field).
   *  Absent-not-zero contract (exactOptionalPropertyTypes). */
  crossPosition?: number;
  /** Extent of the pocket along the CROSS axis (mm), before `fitClearance`
   *  widening — set by `generateTenonMortisePair` to the mating (tenon-host)
   *  panel's thickness, so the pocket is bounded to that panel's end
   *  footprint rather than cutting a through-dado across the whole host
   *  face. Only meaningful paired with `crossPosition`; absent keeps the
   *  full-cross-extent MVP behavior.
   *  Absent-not-zero contract (exactOptionalPropertyTypes). */
  crossSpan?: number;
  label?: string;
  /** CAM tool-table index, set by ApplyMachiningPresetCommand from a MachiningPreset.
   *  Absent-not-zero contract (exactOptionalPropertyTypes). */
  toolNumber?: number;
  /** CAM spindle speed (RPM), set by ApplyMachiningPresetCommand from a MachiningPreset.
   *  Absent-not-zero contract (exactOptionalPropertyTypes). */
  speed?: number;
  /** DXF layer name override, set by ApplyMachiningPresetCommand from a MachiningPreset.layerName.
   *  Falls back to the existing MANUFACTURING_LAYERS scheme when absent.
   *  Absent-not-set contract (exactOptionalPropertyTypes). */
  presetLayerName?: string;
}

/**
 * A tenon or mortise as a regenerable feature-tree entry (mirrors how
 * GrooveFeature extends GrooveSpec). `executeTree` re-cuts/re-fuses the
 * tabs/pockets from this spec on every build, so the joint survives
 * save/reload.
 *
 * `pairId` is the same value on both sides of a generated pair — it links a
 * tenon feature (on the male/end-host panel) to its matching mortise feature
 * (on the female/face-host panel).
 */
export interface TenonMortiseFeature extends TenonMortiseSpec {
  kind: 'tenonMortise';
  id: string;
  pairId: string;
}
