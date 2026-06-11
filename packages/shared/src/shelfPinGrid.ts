import type { BoreOp, PanelFaceRole } from './bore';

/**
 * система-32 shelf-pin boring parameters. All distances in mm.
 * `frontSetback`/`backSetback` = the v-offset of the front/back columns
 * (depth direction). `topMargin`/`bottomMargin` = the u-clearance of the
 * first/last hole from the panel ends (height direction). Blind `depth`.
 */
export interface ShelfPinParams {
  pitch: number;
  diameter: number;
  depth: number;
  frontSetback: number;
  backSetback: number;
  topMargin: number;
  bottomMargin: number;
  columns: 1 | 2;
}

export const DEFAULT_SHELF_PIN_PARAMS: ShelfPinParams = {
  pitch: 32,
  diameter: 5,
  depth: 13,
  frontSetback: 37,
  backSetback: 37,
  topMargin: 64,
  bottomMargin: 64,
  columns: 2,
};

/**
 * Hole centers along one axis: a run spaced `pitch` apart, centered inside
 * [start, end] so the leading and trailing clearances are equal. When the
 * span is smaller than one pitch, a single hole is placed at the midpoint.
 */
export function columnPositions(start: number, end: number, pitch: number): number[] {
  const span = end - start;
  if (span <= 0) return [start];
  const steps = Math.floor(span / pitch); // gaps between holes
  if (steps <= 0) return [(start + end) / 2];
  const count = steps + 1;
  const runLength = steps * pitch;
  const lead = (span - runLength) / 2; // equal leading/trailing clearance
  const first = start + lead;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(first + i * pitch);
  return out;
}
