import type { BoreRole } from './bore';

/**
 * A named, app-global CAM preset (R2.1–R2.3): editable dia/depth/offset + a
 * target DXF layer name for a hardware-boring op type or a groove op.
 * Presets describe the shop, not the model (ADR 0001) — they are applied to
 * BoreOp/GrooveFeature instances via a snapshot-on-apply command, not
 * referenced live.
 */
export interface MachiningPreset {
  id: string;
  name: string;
  opType: BoreRole | 'groove';
  diameter: number;
  depth: number;
  /** Absent-not-zero contract (exactOptionalPropertyTypes). */
  offset?: number;
  layerName: string;
  /** Absent-not-zero contract (exactOptionalPropertyTypes). */
  toolNumber?: number;
  /** Absent-not-zero contract (exactOptionalPropertyTypes). */
  speed?: number;
}
