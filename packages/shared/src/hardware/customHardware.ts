import type { HardwareCatalogEntry } from './resolveCatalog';
import type { HardwareCategory, LegLevelerSpec, Vec3 } from '../hardware-feature';

export class CustomHardwareValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomHardwareValidationError';
  }
}

const CATEGORIES: ReadonlySet<string> = new Set<HardwareCategory>([
  'hinges', 'shelfPins', 'drawerHandles', 'drawerSlides', 'legLevelers', 'softCloseHinges',
]);

function fail(msg: string): never {
  throw new CustomHardwareValidationError(msg);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function reqString(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim() === '') fail(`${field} must be a non-empty string`);
  return v as string;
}
function optString(v: unknown, field: string): string {
  if (v === undefined) return '';
  if (typeof v !== 'string') fail(`${field} must be a string`);
  return v;
}
function posNum(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) fail(`${field} must be a positive finite number`);
  return v;
}
function finiteNum(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${field} must be a finite number`);
  return v;
}
function vec3(v: unknown, field: string): Vec3 {
  if (!isObj(v)) fail(`${field} must be a {x,y,z} object`);
  return { x: finiteNum(v.x, `${field}.x`), y: finiteNum(v.y, `${field}.y`), z: finiteNum(v.z, `${field}.z`) };
}

function legLeveler(v: unknown): LegLevelerSpec {
  if (!isObj(v)) fail('legLeveler must be an object');
  if (v.screwCount !== 4) fail('legLeveler.screwCount must be 4');
  return {
    screwCount: 4,
    patternW: posNum(v.patternW, 'legLeveler.patternW'),
    patternD: posNum(v.patternD, 'legLeveler.patternD'),
    screwDiameter: posNum(v.screwDiameter, 'legLeveler.screwDiameter'),
    screwDepth: posNum(v.screwDepth, 'legLeveler.screwDepth'),
  };
}

/** Validate one raw imported object into a typed catalog entry, or throw with a precise message. */
export function validateCustomHardwareSku(
  raw: unknown,
  existingIds: ReadonlySet<string>,
): HardwareCatalogEntry {
  if (!isObj(raw)) fail('SKU must be an object');

  const id = reqString(raw.id, 'id');
  if (existingIds.has(id)) fail(`SKU id "${id}" already exists`);

  const name = reqString(raw.name, 'name');
  const category = reqString(raw.category, 'category');
  if (!CATEGORIES.has(category)) fail(`category "${category}" is not a valid HardwareCategory`);

  const vendor = optString(raw.vendor, 'vendor');
  const notes = optString(raw.notes, 'notes');

  if (!isObj(raw.bboxMm)) fail('bboxMm must be a {l,w,h} object');
  const bboxMm = {
    l: posNum(raw.bboxMm.l, 'bboxMm.l'),
    w: posNum(raw.bboxMm.w, 'bboxMm.w'),
    h: posNum(raw.bboxMm.h, 'bboxMm.h'),
  };

  if (!Array.isArray(raw.attachPoints)) fail('attachPoints must be an array');
  const attachPoints = raw.attachPoints.map((p, i) => {
    if (!isObj(p)) fail(`attachPoints[${i}] must be an object`);
    const apName = reqString(p.name, `attachPoints[${i}].name`);
    if (p.position === undefined) fail(`attachPoints[${i}].position is required`);
    const position = vec3(p.position, `attachPoints[${i}].position`);
    return p.normal === undefined
      ? { name: apName, position }
      : { name: apName, position, normal: vec3(p.normal, `attachPoints[${i}].normal`) };
  });

  return {
    id, name, category: category as HardwareCategory, vendor, notes, bboxMm, attachPoints,
    ...(raw.legLeveler === undefined ? {} : { legLeveler: legLeveler(raw.legLeveler) }),
  };
}
