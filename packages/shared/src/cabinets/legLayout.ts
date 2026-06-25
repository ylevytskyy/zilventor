import type { BoreOp } from '../bore';
import type { FaceName } from '../types';
import type { LegLevelerSpec } from '../hardware-feature';

export interface LegLayoutParams {
  width: number;
  depth: number;
  legsPerRow: number;
  sideInset: number;
  frontInset: number;
  backInset: number;
}

export function computeLegPositions(p: LegLayoutParams): Array<{ x: number; y: number }> {
  const { width, depth, legsPerRow: R, sideInset, frontInset, backInset } = p;
  const lo = sideInset;
  const hi = width - sideInset;
  const xs: number[] =
    R <= 1 ? [width / 2] : Array.from({ length: R }, (_, i) => lo + (i * (hi - lo)) / (R - 1));
  const ys = [frontInset, depth - backInset];
  const out: Array<{ x: number; y: number }> = [];
  for (const y of ys) for (const x of xs) out.push({ x, y });
  return out;
}

export function legLevelerBores(
  center: { u: number; v: number },
  spec: LegLevelerSpec,
  face: FaceName,
  idBase: string,
): BoreOp[] {
  const hw = spec.patternW / 2;
  const hd = spec.patternD / 2;
  const offsets = [
    { du: -hw, dv: -hd },
    { du: +hw, dv: -hd },
    { du: -hw, dv: +hd },
    { du: +hw, dv: +hd },
  ];
  return offsets.map((o, i) => ({
    id: `${idBase}-${i}`,
    face,
    u: center.u + o.du,
    v: center.v + o.dv,
    diameter: spec.screwDiameter,
    depth: spec.screwDepth,
    role: 'legLeveler' as BoreOp['role'],
    connectorId: `${idBase}-${i}`,
    connectorKind: 'legLeveler' as BoreOp['connectorKind'],
  }));
}
