import type { Result } from '@zilventor/shared';
import { ok, err } from '@zilventor/shared';

export type ImporterParameter = {
  value: number;
  unit: 'mm' | 'deg' | 'rad' | 'unitless';
  expression: string;
};

export type ImporterPartJson = {
  schemaVersion: 1;
  kind: 'part';
  exportedAt: string;
  source: { iptPath: string; fileVersion: string };
  step: string;
  name: string;
  properties: Record<string, string | number | boolean>;
  parameters: Record<string, ImporterParameter>;
};

export type ImporterPose = {
  translation: { x: number; y: number; z: number };
  quaternion: [number, number, number, number];
};

export type ImporterOccurrence = {
  occurrenceName: string;
  /** null = broken external reference (importer renders as missing-part). */
  ref: string | null;
  pose: ImporterPose;
  color?: { hex: string };
  visible: boolean;
  grounded: boolean;
};

export type ImporterAssemblyJson = {
  schemaVersion: 1;
  kind: 'assembly';
  exportedAt: string;
  source: { iamPath: string; fileVersion: string };
  name: string;
  properties: Record<string, string | number | boolean>;
  parameters: Record<string, ImporterParameter>;
  occurrences: ImporterOccurrence[];
};

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function parsePropertiesBag(x: unknown, where: string): Result<Record<string, string | number | boolean>, string> {
  if (!isObj(x)) return err(`${where}: properties must be an object`);
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(x)) {
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
      return err(`${where}: properties[${k}] must be string|number|boolean`);
    }
    out[k] = v;
  }
  return ok(out);
}

function parseParameters(x: unknown, where: string): Result<Record<string, ImporterParameter>, string> {
  if (!isObj(x)) return err(`${where}: parameters must be an object`);
  const out: Record<string, ImporterParameter> = {};
  for (const [k, raw] of Object.entries(x)) {
    if (!isObj(raw)) return err(`${where}: parameters[${k}] must be object`);
    const value = raw.value, unit = raw.unit, expression = raw.expression;
    if (typeof value !== 'number') return err(`${where}: parameters[${k}].value must be number`);
    if (unit !== 'mm' && unit !== 'deg' && unit !== 'rad' && unit !== 'unitless') {
      return err(`${where}: parameters[${k}].unit invalid (${String(unit)})`);
    }
    if (typeof expression !== 'string') return err(`${where}: parameters[${k}].expression must be string`);
    out[k] = { value, unit, expression };
  }
  return ok(out);
}

function parsePose(x: unknown, where: string): Result<ImporterPose, string> {
  if (!isObj(x)) return err(`${where}.pose must be object`);
  const t = x.translation, q = x.quaternion;
  if (!isObj(t) || typeof t.x !== 'number' || typeof t.y !== 'number' || typeof t.z !== 'number') {
    return err(`${where}.pose.translation invalid`);
  }
  if (!Array.isArray(q) || q.length !== 4 || !q.every((n) => typeof n === 'number')) {
    return err(`${where}.pose.quaternion must be [x,y,z,w]`);
  }
  return ok({ translation: { x: t.x, y: t.y, z: t.z }, quaternion: [q[0]!, q[1]!, q[2]!, q[3]!] });
}

function parseOccurrence(x: unknown, idx: number): Result<ImporterOccurrence, string> {
  if (!isObj(x)) return err(`occurrences[${idx}] must be object`);
  if (typeof x.occurrenceName !== 'string') return err(`occurrences[${idx}].occurrenceName must be string`);
  if (x.ref !== null && typeof x.ref !== 'string') return err(`occurrences[${idx}].ref must be string|null`);
  const pose = parsePose(x.pose, `occurrences[${idx}]`);
  if (!pose.ok) return pose;
  if (typeof x.visible !== 'boolean') return err(`occurrences[${idx}].visible must be boolean`);
  if (typeof x.grounded !== 'boolean') return err(`occurrences[${idx}].grounded must be boolean`);
  let color: { hex: string } | undefined;
  if (x.color !== undefined) {
    if (!isObj(x.color) || typeof x.color.hex !== 'string') return err(`occurrences[${idx}].color must be { hex: string }`);
    color = { hex: x.color.hex };
  }
  return ok({
    occurrenceName: x.occurrenceName, ref: x.ref as string | null,
    pose: pose.value, visible: x.visible, grounded: x.grounded,
    ...(color ? { color } : {}),
  });
}

export function parsePartJson(input: unknown): Result<ImporterPartJson, string> {
  if (!isObj(input)) return err('part JSON must be an object');
  if (input.schemaVersion !== 1) return err(`part JSON: schemaVersion must be 1 (got ${input.schemaVersion})`);
  if (input.kind !== 'part') return err(`part JSON: kind must be 'part' (got ${input.kind})`);
  if (typeof input.exportedAt !== 'string') return err('part JSON: exportedAt must be string');
  if (!isObj(input.source) || typeof input.source.iptPath !== 'string' || typeof input.source.fileVersion !== 'string') {
    return err('part JSON: source.iptPath and source.fileVersion required');
  }
  if (typeof input.step !== 'string') return err('part JSON: step (filename) required');
  if (typeof input.name !== 'string') return err('part JSON: name required');
  const props = parsePropertiesBag(input.properties, 'part JSON');
  if (!props.ok) return props;
  const params = parseParameters(input.parameters, 'part JSON');
  if (!params.ok) return params;
  return ok({
    schemaVersion: 1, kind: 'part', exportedAt: input.exportedAt,
    source: { iptPath: input.source.iptPath, fileVersion: input.source.fileVersion },
    step: input.step, name: input.name,
    properties: props.value, parameters: params.value,
  });
}

export function parseAssemblyJson(input: unknown): Result<ImporterAssemblyJson, string> {
  if (!isObj(input)) return err('asm JSON must be an object');
  if (input.schemaVersion !== 1) return err(`asm JSON: schemaVersion must be 1`);
  if (input.kind !== 'assembly') return err(`asm JSON: kind must be 'assembly'`);
  if (typeof input.exportedAt !== 'string') return err('asm JSON: exportedAt required');
  if (!isObj(input.source) || typeof input.source.iamPath !== 'string' || typeof input.source.fileVersion !== 'string') {
    return err('asm JSON: source.iamPath and source.fileVersion required');
  }
  if (typeof input.name !== 'string') return err('asm JSON: name required');
  const props = parsePropertiesBag(input.properties, 'asm JSON');
  if (!props.ok) return props;
  const params = parseParameters(input.parameters, 'asm JSON');
  if (!params.ok) return params;
  if (!Array.isArray(input.occurrences)) return err('asm JSON: occurrences must be array');
  const occs: ImporterOccurrence[] = [];
  for (let i = 0; i < input.occurrences.length; i++) {
    const o = parseOccurrence(input.occurrences[i], i);
    if (!o.ok) return o;
    occs.push(o.value);
  }
  return ok({
    schemaVersion: 1, kind: 'assembly', exportedAt: input.exportedAt,
    source: { iamPath: input.source.iamPath, fileVersion: input.source.fileVersion },
    name: input.name, properties: props.value, parameters: params.value, occurrences: occs,
  });
}
