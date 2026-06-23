import { aciToRgb } from './aci';
import type { DxfLayer } from './types';

export type SketchStyle = { color?: number; lineStyle?: 'dashed' | 'dashdot' };

const DASHED = new Set(['DASHED', 'HIDDEN']);
const DASHDOT = new Set(['CENTER', 'DASHDOT', 'PHANTOM']);

export function linetypeToStyle(name: string): 'dashed' | 'dashdot' | undefined {
  const n = name.trim().toUpperCase();
  if (DASHED.has(n)) return 'dashed';
  if (DASHDOT.has(n)) return 'dashdot';
  return undefined; // CONTINUOUS / empty / BYLAYER / BYBLOCK / unknown -> solid
}

export function resolveStyle(
  e: { layer: string; color?: number; linetype?: string },
  layers: Record<string, DxfLayer>,
): SketchStyle {
  const layer = layers[e.layer];
  // Color: entity code 62 wins unless 256 (BYLAYER) or absent -> layer color. 0 (BYBLOCK) -> default.
  const aci = e.color != null && e.color !== 256 ? e.color : (layer?.color ?? 7);
  const color = aciToRgb(aci);
  // Linetype: entity code 6 wins unless BYLAYER/absent -> layer linetype.
  const ltName = e.linetype && e.linetype.trim().toUpperCase() !== 'BYLAYER'
    ? e.linetype
    : (layer?.linetype ?? '');
  const lineStyle = linetypeToStyle(ltName);
  const out: SketchStyle = {};
  if (color !== undefined) out.color = color;
  if (lineStyle !== undefined) out.lineStyle = lineStyle;
  return out;
}
