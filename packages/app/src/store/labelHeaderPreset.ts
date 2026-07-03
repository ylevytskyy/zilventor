export interface LabelHeaderPreset {
  id: string;
  name: string;
  line1: string;
  line2: string;
}

/**
 * Import/export validation + serialization for LabelHeaderPreset, co-located
 * with the type (mirrors packages/shared/src/machiningPreset.ts's pattern of
 * keeping type + validate + serialize together — this module is small enough
 * that a sibling file would be pure ceremony).
 */
export class LabelHeaderPresetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LabelHeaderPresetValidationError';
  }
}

function fail(msg: string): never {
  throw new LabelHeaderPresetValidationError(msg);
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/** id/name are keys/labels — required and non-empty. */
function reqString(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim() === '') fail(`${field} must be a non-empty string`);
  return v as string;
}
/**
 * line1/line2 are header text — required to be present and a string, but the
 * dialog legitimately creates presets with a blank line (form defaults to ''
 * and only `name` is required to submit), so empty string must round-trip.
 */
function reqStringField(v: unknown, field: string): string {
  if (typeof v !== 'string') fail(`${field} must be a string`);
  return v;
}

function validateOneLabelHeaderPreset(raw: unknown, existingIds: ReadonlySet<string>): LabelHeaderPreset {
  if (!isObj(raw)) fail('preset must be an object');

  const id = reqString(raw.id, 'id');
  if (existingIds.has(id)) fail(`preset id "${id}" already exists`);

  const name = reqString(raw.name, 'name');
  const line1 = reqStringField(raw.line1, 'line1');
  const line2 = reqStringField(raw.line2, 'line2');

  return { id, name, line1, line2 };
}

/**
 * Validate raw imported JSON (a single preset object OR an array of them) against
 * the existing registry. Atomic: throws on the first failure — including an id that
 * collides with an existing preset or an earlier item in the same batch — and never
 * returns partial results. Mirrors validateMachiningPresetImport.
 */
export function validateLabelHeaderPresetImport(
  raw: unknown,
  existingIds: ReadonlySet<string>,
): LabelHeaderPreset[] {
  const items = Array.isArray(raw) ? raw : [raw];
  const ids = new Set(existingIds);
  const out: LabelHeaderPreset[] = [];
  for (const item of items) {
    const preset = validateOneLabelHeaderPreset(item, ids);
    ids.add(preset.id);
    out.push(preset);
  }
  return out;
}

/** Serialize presets to the JSON shape validateLabelHeaderPresetImport round-trips. */
export function serializeLabelHeaderPresets(presets: readonly LabelHeaderPreset[]): string {
  return JSON.stringify(presets, null, 2);
}
