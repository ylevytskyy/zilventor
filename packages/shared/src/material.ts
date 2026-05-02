export type MaterialId = string;

export interface MaterialEntry {
  readonly id: MaterialId;
  readonly name: string;
  readonly defaultThickness: number;
  readonly color: string;
}

export type MaterialRegistry = readonly MaterialEntry[];

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isMaterialEntry(v: unknown): v is MaterialEntry {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return typeof m.id === 'string' && m.id.length > 0
    && typeof m.name === 'string' && m.name.length > 0
    && typeof m.defaultThickness === 'number' && Number.isFinite(m.defaultThickness) && m.defaultThickness > 0
    && typeof m.color === 'string' && HEX_COLOR_RE.test(m.color);
}
