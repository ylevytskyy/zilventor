import { inferFromGeometry } from './inferFromGeometry';
import { BUILTIN_CATALOG } from './hardware/builtinCatalog';

export const CURRENT_FORMAT_VERSION = 12 as const;

export type AnyManifest = { formatVersion: number; [k: string]: unknown };

type MigrateFn = (m: AnyManifest) => AnyManifest;

function deepClone<T>(v: T): T {
  return structuredClone(v);
}

function addHardwareField(doc: Record<string, unknown>): void {
  if (doc.hardware == null) {
    doc.hardware = [];
  }
}

function seedBuiltinHardware(doc: Record<string, unknown>): void {
  const existing = (doc.hardware as Array<{ id: string }> | undefined) ?? [];
  const existingIds = new Set(existing.map((e) => e.id));
  for (const entry of BUILTIN_CATALOG) {
    if (!existingIds.has(entry.id)) {
      existing.push({ ...entry });
    }
  }
  doc.hardware = existing;
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
  },

  // v3 → v4: ensure document.parameters exists (typed as Record<string, SketchParameter>).
  // Files saved before this field was formalised may omit it entirely.
  3: (mIn) => {
    const m = deepClone(mIn);
    const doc = m.document as { parameters?: Record<string, unknown> } | undefined;
    if (doc && !doc.parameters) {
      doc.parameters = {};
    }
    return { ...m, formatVersion: 4 };
  },

  // v4 → v5: add operation field to extrude features.
  // First extrude in the tree gets 'new' (creates the initial body);
  // subsequent extrudes get 'join' (fuse into the running body).
  4: (mIn) => {
    const m = deepClone(mIn);
    const doc = m.document as { featureTree?: Array<Record<string, unknown>> } | undefined;
    if (doc?.featureTree) {
      // Count any extrudes that already carry `operation` (none in canonical
      // v4 files but guard against hand-edited or pre-release inputs so the
      // migration stays idempotent).
      let seenNew = doc.featureTree.some((f) => f.kind === 'extrude' && f.operation != null);
      for (const f of doc.featureTree) {
        if (f.kind !== 'extrude' || f.operation != null) continue;
        if (!seenNew) { f.operation = 'new'; seenNew = true; }
        else f.operation = 'join';
      }
    }
    return { ...m, formatVersion: 5 };
  },

  // v5 → v6 is additive (FilletFeature variant added). No-op migration.
  5: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 6 };
  },

  // v6 → v7 is additive (SweepFeature variant added). No-op migration.
  6: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 7 };
  },

  // v7 → v8: assembly schema — componentId → componentPath: [componentId] on
  // every constraint ref; groundedComponentIds → groundedComponentPaths;
  // colorOverrides defaults to {}; ComponentInstance.flexible left absent
  // (defaults to rigid).
  7: (mIn) => {
    const m = deepClone(mIn);
    const anyM = m as { kind?: string; document?: any };
    if (anyM.kind !== 'assembly' || !anyM.document) {
      return { ...m, formatVersion: 8 };
    }
    const doc = anyM.document;

    // groundedComponentIds → groundedComponentPaths
    if (Array.isArray(doc.groundedComponentIds)) {
      doc.groundedComponentPaths = doc.groundedComponentIds.map((id: string) => [id]);
      delete doc.groundedComponentIds;
    } else if (!Array.isArray(doc.groundedComponentPaths)) {
      doc.groundedComponentPaths = [];
    }

    // Constraint refs: componentId → componentPath
    if (Array.isArray(doc.constraints)) {
      doc.constraints = doc.constraints.map((c: any) => {
        const next = { ...c };
        for (const slot of ['refA', 'refB'] as const) {
          const r = next[slot];
          if (r && typeof r.componentId === 'string') {
            const { componentId, ...rest } = r;
            next[slot] = { ...rest, componentPath: [componentId] };
          }
        }
        return next;
      });
    }

    // colorOverrides default
    if (doc.colorOverrides == null) doc.colorOverrides = {};

    return { ...m, document: doc, formatVersion: 8 };
  },

  // v8 → v9: additive — add `properties: {}` bag to part/assembly documents
  // for iProperty / custom-iProperty storage (sub-project 1.5).
  8: (mIn) => {
    const m = deepClone(mIn);
    const anyM = m as { kind?: string; document?: any };
    if (anyM.document && anyM.document.properties == null) {
      anyM.document.properties = {};
    }
    return { ...m, formatVersion: 9 };
  },

  // v9 → v10: additive — add `materials: []` array to part- and assembly-kind
  // documents (sub-project 5a). Empty default; populated by Panel-creating
  // commands and material-registry editor.
  9: (mIn) => {
    const m = deepClone(mIn);
    const anyM = m as { kind?: string; document?: { materials?: unknown } };
    if (anyM.document && anyM.document.materials == null) {
      anyM.document.materials = [];
    }
    return { ...m, formatVersion: 10 };
  },

  // v10 → v11: additive — add `cutListItemNumbers: {}` to assembly-kind
  // documents (sub-project 5d). Empty default; populated by user inline
  // edits + Renumber + autosave merge path.
  10: (mIn) => {
    const m = deepClone(mIn);
    const anyM = m as { kind?: string; document?: { cutListItemNumbers?: unknown } };
    if (anyM.kind === 'assembly' && anyM.document && anyM.document.cutListItemNumbers == null) {
      anyM.document.cutListItemNumbers = {};
    }
    return { ...m, formatVersion: 11 };
  },

  // v11 → v12: additive — add `hardware: []` to part- and assembly-kind
  // documents (sub-project 5c). Seeds the 7 built-in catalog entries into
  // AssemblyDocument.hardware on first migration (idempotent by id).
  11: (mIn) => {
    const m = deepClone(mIn);
    const anyM = m as { kind?: string; document?: Record<string, unknown> };
    if (anyM.document) {
      addHardwareField(anyM.document);
      if (anyM.kind === 'assembly') {
        seedBuiltinHardware(anyM.document);
      }
    }
    return { ...m, formatVersion: 12 };
  },
};

function normalizeKind(m: AnyManifest): AnyManifest {
  if ((m.formatVersion === 10 || m.formatVersion === 11 || m.formatVersion === 12) && (m as any).kind === undefined) {
    return { ...m, kind: 'part' } as AnyManifest;
  }
  return m;
}

const ORIGIN_FEATURES: ReadonlyArray<Record<string, unknown>> = [
  { kind: 'workAxis', id: 'origin.X', visible: false, source: { mode: 'origin', axis: 'X' } },
  { kind: 'workAxis', id: 'origin.Y', visible: false, source: { mode: 'origin', axis: 'Y' } },
  { kind: 'workAxis', id: 'origin.Z', visible: false, source: { mode: 'origin', axis: 'Z' } },
  { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
  { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } },
  { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } },
  { kind: 'workPoint', id: 'origin.O', visible: false, source: { mode: 'origin' } },
];

function injectOriginFeatures(m: AnyManifest): AnyManifest {
  const anyM = m as { kind?: string; document?: { featureTree?: Array<Record<string, unknown>> } };
  if (anyM.kind !== 'part') return m;
  const doc = anyM.document;
  if (!doc || !Array.isArray(doc.featureTree)) return m;
  const tree = doc.featureTree;
  const hasOrigin = tree.some((f) => typeof f.id === 'string' && (f.id as string).startsWith('origin.'));
  if (hasOrigin) return m;
  const next = {
    ...(m as Record<string, unknown>),
    document: { ...doc, featureTree: [...ORIGIN_FEATURES.map((f) => ({ ...f })), ...tree] },
  };
  return next as unknown as AnyManifest;
}

function eulerXYZToQuat(rx: number, ry: number, rz: number): [number, number, number, number] {
  const cx = Math.cos(rx * Math.PI / 360); const sx = Math.sin(rx * Math.PI / 360);
  const cy = Math.cos(ry * Math.PI / 360); const sy = Math.sin(ry * Math.PI / 360);
  const cz = Math.cos(rz * Math.PI / 360); const sz = Math.sin(rz * Math.PI / 360);
  // XYZ order, returning [x, y, z, w]
  const x = sx * cy * cz + cx * sy * sz;
  const y = cx * sy * cz - sx * cy * sz;
  const z = cx * cy * sz + sx * sy * cz;
  const w = cx * cy * cz - sx * sy * sz;
  return [x, y, z, w];
}

function backfillAssembly4b(m: AnyManifest): AnyManifest {
  const anyM = m as { kind?: string; document?: any };
  if (anyM.kind !== 'assembly' || !anyM.document) return m;
  const doc = { ...anyM.document };
  if (!Array.isArray(doc.constraints)) doc.constraints = [];
  if (!Array.isArray(doc.groundedComponentPaths)) doc.groundedComponentPaths = [];
  if (doc.colors == null) doc.colors = {};
  if (doc.bomItemNumbers == null) doc.bomItemNumbers = {};
  if (doc.colorOverrides == null) doc.colorOverrides = {};
  if (Array.isArray(doc.components)) {
    doc.components = doc.components.map((c: any) => {
      if (c.pose) return c;
      const pos = c.position ?? { x: 0, y: 0, z: 0 };
      const rot = c.rotation ?? { rx: 0, ry: 0, rz: 0 };
      return {
        ...c,
        pose: {
          translation: { x: pos.x, y: pos.y, z: pos.z },
          quaternion: eulerXYZToQuat(rot.rx, rot.ry, rot.rz),
        },
      };
    });
  }
  return { ...m, document: doc } as AnyManifest;
}

function migrateSketchPlanes(m: AnyManifest): AnyManifest {
  const anyM = m as { kind?: string; document?: { featureTree?: Array<Record<string, unknown>> } };
  if (anyM.kind !== 'part') return m;
  const doc = anyM.document;
  if (!doc || !Array.isArray(doc.featureTree)) return m;
  let changed = false;
  const next = doc.featureTree.map((f) => {
    if (f.kind !== 'sketch') return f;
    if (typeof f.plane === 'string') {
      changed = true;
      return { ...f, plane: { source: 'workPlane', featureId: `origin.${f.plane}` } };
    }
    return f;
  });
  if (!changed) return m;
  return {
    ...(m as Record<string, unknown>),
    document: { ...doc, featureTree: next },
  } as unknown as AnyManifest;
}



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
  return migrateSketchPlanes(injectOriginFeatures(backfillAssembly4b(normalizeKind(current))));
}
