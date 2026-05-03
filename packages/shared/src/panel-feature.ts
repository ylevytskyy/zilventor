import type { ParamOrLiteral } from './types';
import type { MaterialId } from './material';
import type { SketchParameter } from './parameters';

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

export interface PanelSpec {
  readonly length: number;
  readonly width: number;
  readonly thickness: number;
  readonly materialId: MaterialId;
  readonly grain: GrainDirection;
  readonly edgeBands: { readonly [K in PanelEdgeKey]: { readonly materialId: MaterialId } | null };
}

function resolveDim(v: ParamOrLiteral, parameters: Record<string, SketchParameter>): number | null {
  if (v.kind === 'literal') {
    return Number.isFinite(v.value) && v.value > 0 ? v.value : null;
  }
  const p = parameters[v.paramName];
  if (!p) return null;
  return Number.isFinite(p.value) && p.value > 0 ? p.value : null;
}

export function resolvePanelSpecFromFeature(
  feature: PanelFeature,
  parameters: Record<string, SketchParameter>,
): PanelSpec | null {
  const length = resolveDim(feature.length, parameters);
  const width = resolveDim(feature.width, parameters);
  const thickness = resolveDim(feature.thickness, parameters);
  if (length === null || width === null || thickness === null) return null;
  return {
    length,
    width,
    thickness,
    materialId: feature.materialId,
    grain: feature.grain,
    edgeBands: {
      front: feature.edgeBands.front ? { materialId: feature.edgeBands.front.materialId } : null,
      back: feature.edgeBands.back ? { materialId: feature.edgeBands.back.materialId } : null,
      left: feature.edgeBands.left ? { materialId: feature.edgeBands.left.materialId } : null,
      right: feature.edgeBands.right ? { materialId: feature.edgeBands.right.materialId } : null,
    },
  };
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
