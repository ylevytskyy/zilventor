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

/**
 * система-32 shelf-pin grid for ONE side panel, authored against its UNSWAPPED
 * native dims {length:H, width:D, thickness:Tc} on the broad inner face
 * (`innerFace` = 'Top' z=Tc or 'Bottom' z=0; pinned per-side by Phase 0).
 *
 * Layout (CONTRACT §D, Convention 2): on the broad face, u=+X spans 0..H
 * (height), v=∓Y spans 0..D (depth). Each column is a fixed v (depth setback):
 *   - front column at v = frontSetback
 *   - back  column at v = width − backSetback   (= D − backSetback)
 * Holes step in u from bottomMargin..(length − topMargin) at `pitch`, centered.
 * All bores are BLIND (`depth`, never 'throughAll'); Ø`diameter`.
 */
export function shelfPinGrid(
  dims: { length: number; width: number; thickness: number },
  innerFace: 'Top' | 'Bottom',
  params: ShelfPinParams,
): BoreOp[] {
  const face: PanelFaceRole = innerFace;
  const uPositions = columnPositions(
    params.bottomMargin,
    dims.length - params.topMargin,
    params.pitch,
  );
  const cols: Array<{ id: 'pin-col-front' | 'pin-col-back'; v: number }> = [
    { id: 'pin-col-front', v: params.frontSetback },
  ];
  if (params.columns >= 2) {
    cols.push({ id: 'pin-col-back', v: dims.width - params.backSetback });
  }

  const bores: BoreOp[] = [];
  for (const col of cols) {
    uPositions.forEach((u, i) => {
      bores.push({
        id: `${col.id}-${i}`,
        face: { featureId: 'panel', role: face, instance: 0 },
        u,
        v: col.v,
        diameter: params.diameter,
        depth: params.depth, // blind number, never 'throughAll'
        role: 'shelfPin-system32',
        connectorId: col.id,
        connectorKind: 'shelfPin',
      });
    });
  }
  return bores;
}
