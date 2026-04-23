import { inferFromGeometry } from './inferFromGeometry';

export const CURRENT_FORMAT_VERSION = 3 as const;

export type AnyManifest = { formatVersion: number; [k: string]: unknown };

type MigrateFn = (m: AnyManifest) => AnyManifest;

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

const migrations: Record<number, MigrateFn> = {
  // v1 → v2: synthesize primitive ids on sketch features.
  1: (mIn) => {
    const m = deepClone(mIn);
    const doc = m.document as
      | { featureTree?: Array<{ kind: string; id?: string; primitives?: Array<Record<string, unknown>> }> }
      | undefined;
    if (doc?.featureTree) {
      for (const feature of doc.featureTree) {
        if (feature.kind === 'sketch' && Array.isArray(feature.primitives)) {
          const sketchId = feature.id ?? 's';
          feature.primitives = feature.primitives.map((p, i) => {
            const existingId = (p as { id?: string }).id;
            return { ...p, id: existingId ?? `${sketchId}-p${i}` };
          });
        }
      }
    }
    return { ...m, formatVersion: 2 };
  },

  // v2 → v3: add constraints[] to sketch features; seed via inferFromGeometry
  // when absent. Tag each inferred constraint with source: 'inferred-migration'.
  2: (mIn) => {
    const m = deepClone(mIn);
    const doc = m.document as
      | { featureTree?: Array<Record<string, unknown>> }
      | undefined;
    if (doc?.featureTree) {
      for (const f of doc.featureTree) {
        if (f.kind === 'sketch' && !Array.isArray(f.constraints)) {
          const prims = (f.primitives ?? []) as Parameters<typeof inferFromGeometry>[0];
          f.constraints = inferFromGeometry(prims);
        }
      }
    }
    return { ...m, formatVersion: 3 };
  }
};

export function migrateManifest(m: AnyManifest): AnyManifest {
  if (typeof m.formatVersion !== 'number') {
    throw new Error('formatVersion missing from manifest');
  }
  if (m.formatVersion > CURRENT_FORMAT_VERSION) {
    throw new Error(
      `file is from a newer version of ZilInventor (formatVersion=${m.formatVersion}, current=${CURRENT_FORMAT_VERSION})`
    );
  }
  let current = m;
  while (current.formatVersion < CURRENT_FORMAT_VERSION) {
    const step = migrations[current.formatVersion];
    if (!step) throw new Error(`no migration from formatVersion ${current.formatVersion}`);
    const priorVersion = current.formatVersion;
    current = step(current);
    if (typeof current.formatVersion !== 'number' || current.formatVersion <= priorVersion) {
      throw new Error(`migration from formatVersion ${priorVersion} did not advance the version`);
    }
  }
  return current;
}
