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

export class MachiningPresetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MachiningPresetValidationError';
  }
}

const BORE_ROLES: ReadonlySet<string> = new Set<BoreRole>([
  'confirmat-face', 'confirmat-edge',
  'minifix-cam', 'minifix-bolt', 'minifix-cross',
  'dowel-face', 'dowel-edge',
  'shelfPin-system32',
  'hingeCup',
  'hingePlate',
  'drawerSlide-cabinet',
  'drawerSlide-box',
  'handleScrew-face',
  'legLeveler',
  'tandem-cabinet',
  'tandem-drawer-bottom',
  'tandem-drawer-back',
]);
const OP_TYPES: ReadonlySet<string> = new Set([...BORE_ROLES, 'groove']);

function fail(msg: string): never {
  throw new MachiningPresetValidationError(msg);
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function reqString(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim() === '') fail(`${field} must be a non-empty string`);
  return v as string;
}
function posNum(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) fail(`${field} must be a positive finite number`);
  return v;
}
function finiteNum(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${field} must be a finite number`);
  return v;
}
function posInt(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) fail(`${field} must be a positive integer`);
  return v;
}

function validateOnePreset(raw: unknown, existingIds: ReadonlySet<string>): MachiningPreset {
  if (!isObj(raw)) fail('preset must be an object');

  const id = reqString(raw.id, 'id');
  if (existingIds.has(id)) fail(`preset id "${id}" already exists`);

  const name = reqString(raw.name, 'name');
  const opType = reqString(raw.opType, 'opType');
  if (!OP_TYPES.has(opType)) fail(`opType "${opType}" is not a known BoreRole or 'groove'`);

  const diameter = posNum(raw.diameter, 'diameter');
  const depth = posNum(raw.depth, 'depth');
  const layerName = reqString(raw.layerName, 'layerName');

  return {
    id,
    name,
    opType: opType as MachiningPreset['opType'],
    diameter,
    depth,
    layerName,
    ...(raw.offset === undefined ? {} : { offset: finiteNum(raw.offset, 'offset') }),
    ...(raw.toolNumber === undefined ? {} : { toolNumber: posInt(raw.toolNumber, 'toolNumber') }),
    ...(raw.speed === undefined ? {} : { speed: posNum(raw.speed, 'speed') }),
  };
}

/**
 * Validate raw imported JSON (a single preset object OR an array of them) against
 * the existing registry. Atomic: throws on the first failure — including an id that
 * collides with an existing preset or an earlier item in the same batch — and never
 * returns partial results. Mirrors the customHardware import shape decision.
 */
export function validateMachiningPresetImport(
  raw: unknown,
  existingIds: ReadonlySet<string>,
): MachiningPreset[] {
  const items = Array.isArray(raw) ? raw : [raw];
  const ids = new Set(existingIds);
  const out: MachiningPreset[] = [];
  for (const item of items) {
    const preset = validateOnePreset(item, ids);
    ids.add(preset.id);
    out.push(preset);
  }
  return out;
}

/** Serialize presets to the JSON shape validateMachiningPresetImport round-trips. */
export function serializeMachiningPresets(presets: readonly MachiningPreset[]): string {
  return JSON.stringify(presets, null, 2);
}
