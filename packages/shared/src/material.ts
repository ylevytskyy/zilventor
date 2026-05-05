export type MaterialId = string;

export interface MaterialEntry {
  readonly id: MaterialId;
  readonly name: string;
  readonly defaultThickness: number;
  readonly color: string;
  readonly sheetLengthMm?: number;
  readonly sheetWidthMm?: number;
  readonly hatchAngleDeg?: number;   // default 45 — degrees from horizontal
  readonly hatchSpacingMm?: number;  // default 3 — spacing between hatch lines
}

export type MaterialRegistry = readonly MaterialEntry[];

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isPositiveFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

const DEFAULT_HATCH_ANGLE_DEG = 45;
const DEFAULT_HATCH_SPACING_MM = 3;

/**
 * Derive hatch rendering spec from a material, applying defaults for absent fields.
 * Returned values are always finite numbers safe for trigonometric use.
 */
export function getHatchSpec(material: MaterialEntry): { angleDeg: number; spacingMm: number } {
  return {
    angleDeg:  material.hatchAngleDeg  ?? DEFAULT_HATCH_ANGLE_DEG,
    spacingMm: material.hatchSpacingMm ?? DEFAULT_HATCH_SPACING_MM,
  };
}

export function isMaterialEntry(v: unknown): v is MaterialEntry {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  if (!(typeof m.id === 'string' && m.id.length > 0
    && typeof m.name === 'string' && m.name.length > 0
    && typeof m.defaultThickness === 'number' && Number.isFinite(m.defaultThickness) && m.defaultThickness > 0
    && typeof m.color === 'string' && HEX_COLOR_RE.test(m.color))) return false;
  const hasL = m.sheetLengthMm !== undefined;
  const hasW = m.sheetWidthMm !== undefined;
  if (hasL !== hasW) return false;
  if (hasL && !isPositiveFiniteNumber(m.sheetLengthMm)) return false;
  if (hasW && !isPositiveFiniteNumber(m.sheetWidthMm)) return false;
  return true;
}
