import type { ParamOrLiteral } from './types';
import type { MaterialId } from './material';

export type PanelEdgeKey = 'front' | 'back' | 'left' | 'right';
export type GrainDirection = 'length' | 'width' | 'none';

export interface EdgeBand {
  readonly materialId: MaterialId;
}

export interface PanelFeature {
  readonly kind: 'panel';
  readonly id: string;
  readonly length: ParamOrLiteral;
  readonly width: ParamOrLiteral;
  readonly thickness: ParamOrLiteral;
  readonly thicknessFromMaterial: boolean;
  readonly materialId: MaterialId;
  readonly grain: GrainDirection;
  readonly edgeBands: { readonly [K in PanelEdgeKey]: EdgeBand | null };
  readonly suppressed?: boolean;
}

const GRAIN_VALUES = new Set<GrainDirection>(['length', 'width', 'none']);
const EDGE_KEYS: readonly PanelEdgeKey[] = ['front', 'back', 'left', 'right'];

function isParamOrLiteral(v: unknown): v is ParamOrLiteral {
  if (!v || typeof v !== 'object') return false;
  const k = (v as { kind?: unknown }).kind;
  if (k === 'param') return typeof (v as { paramName?: unknown }).paramName === 'string';
  if (k === 'literal') return typeof (v as { value?: unknown }).value === 'number';
  return false;
}

function isEdgeBandSlot(v: unknown): boolean {
  if (v === null) return true;
  if (!v || typeof v !== 'object') return false;
  return typeof (v as { materialId?: unknown }).materialId === 'string';
}

export function isPanelFeature(v: unknown): v is PanelFeature {
  if (!v || typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  if (f.kind !== 'panel') return false;
  if (typeof f.id !== 'string') return false;
  if (!isParamOrLiteral(f.length) || !isParamOrLiteral(f.width) || !isParamOrLiteral(f.thickness)) return false;
  if (typeof f.thicknessFromMaterial !== 'boolean') return false;
  if (typeof f.materialId !== 'string') return false;
  if (!GRAIN_VALUES.has(f.grain as GrainDirection)) return false;
  const eb = f.edgeBands;
  if (!eb || typeof eb !== 'object') return false;
  for (const k of EDGE_KEYS) {
    if (!isEdgeBandSlot((eb as Record<string, unknown>)[k])) return false;
  }
  return true;
}
