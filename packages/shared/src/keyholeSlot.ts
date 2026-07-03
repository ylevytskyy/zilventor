import type { PanelFaceRole } from './bore';

/**
 * A localized keyhole-slot cutout (wall-hanger routing): a circular entry
 * hole with a slotted channel running from its center outward, so a screw
 * head can be dropped through the wide entry and slid into the narrow slot
 * to hang the panel. Unlike `GrooveSpec`'s full-face-extent channel, this is
 * a LOCALIZED cutout anchored at `(u,v)`.
 *
 *   `faceRole`/`u`/`v`: the entry-hole CENTER, in face2DFrame coordinates
 *   (mm — same convention as `BoreOp`).
 *   `axis`/`direction`: the slot runs from the hole center outward, along
 *   `axis` ('u'|'v') in the sign given by `direction` (1|-1).
 *   `entryDiameter`: Ø of the circular entry hole (screw-head clearance).
 *   `slotWidth`: width of the slot channel (screw-shank clearance).
 *   `slotLength`: length of the slot, measured from the hole CENTER outward.
 *   `depth`: cut depth (mm) into the panel along the inward face normal.
 */
export interface KeyholeSlotSpec {
  faceRole: PanelFaceRole;
  u: number;
  v: number;
  axis: 'u' | 'v';
  direction: 1 | -1;
  entryDiameter: number;
  slotWidth: number;
  slotLength: number;
  depth: number;
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
 * A keyhole slot as a regenerable feature-tree entry (mirrors how
 * `GrooveFeature` extends `GrooveSpec` / `TenonMortiseFeature` extends
 * `TenonMortiseSpec`). `executeTree` re-cuts the cylinder∪box pocket from
 * this spec on every build, so the slot survives save/reload.
 */
export interface KeyholeSlotFeature extends KeyholeSlotSpec {
  kind: 'keyholeSlot';
  id: string;
}
