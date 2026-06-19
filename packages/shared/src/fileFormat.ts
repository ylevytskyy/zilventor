import { inferFromGeometry } from './inferFromGeometry';
import { BUILTIN_CATALOG } from './hardware/builtinCatalog';

export const CURRENT_FORMAT_VERSION = 29 as const;

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

function addCustomTexturesField(doc: Record<string, unknown>): void {
  if (doc.customTextures == null) {
    doc.customTextures = [];
  }
}

function seedBuiltinHardware(doc: Record<string, unknown>): void {
  const existing = (doc.hardware as Array<Record<string, unknown>> | undefined) ?? [];
  const existingIds = new Set(existing.map((e) => e.id as string));
  for (const entry of BUILTIN_CATALOG) {
    if (!existingIds.has(entry.id)) {
      existing.push({
        id: entry.id,
        name: entry.name,
        category: entry.category,
        vendor: entry.vendor,
        notes: entry.notes,
      });
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

  // v12 → v13: no-op. AssemblyDocument.nest stays absent;
  // MaterialEntry.sheetLengthMm / sheetWidthMm stay absent. Fields appear via writes only.
  12: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 13 };
  },

  // v13 → v14: no-op. New 'drawing' kind is forward-only; existing part/assembly
  // files are unaffected. DrawingDocument is only created by CreateDrawingCommand.
  13: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 14 };
  },

  // v14 → v15: no-op. SectionView is forward-only; no existing documents need
  // structural transformation. (Drawing F1 — section views)
  14: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 15 };
  },

  // v15 → v16: no-op. DetailView is forward-only; no existing documents need
  // structural transformation. (Drawing F2 — detail views)
  15: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 16 };
  },

  // v16 → v17: additive. Broken views store breaks[] on existing view types.
  // No existing document contains breaks; absent field === [] at runtime.
  16: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 17 };
  },

  // v17 → v18: back-fill mode: 'full' on all SectionViews in drawing documents.
  // Half-section views (mode: 'half') are only created by F1.1 commands; pre-existing
  // documents always have full-section views without a mode field.
  17: (mIn) => {
    const m = deepClone(mIn);
    const anyM = m as { kind?: string; document?: { sheets?: Array<{ views?: Array<Record<string, unknown>> }> } };
    if (anyM.kind === 'drawing' && anyM.document?.sheets) {
      for (const sheet of anyM.document.sheets) {
        if (!Array.isArray(sheet.views)) continue;
        for (const view of sheet.views) {
          if (view['kind'] === 'section' && view['mode'] === undefined) {
            view['mode'] = 'full';
          }
        }
      }
    }
    return { ...m, formatVersion: 18 };
  },

  // v18 → v19: back-fill kind:'circle' on all DetailView.regionParent values in
  // drawing documents. Pre-F2.1 files store regionParent as a flat {center, radiusMm}
  // object without a kind discriminator. Idempotent: if kind is already present,
  // the spread is a no-op. (Drawing F2.1 — rectangular detail region)
  18: (mIn) => {
    const m = deepClone(mIn);
    const anyM = m as {
      kind?: string;
      document?: {
        sheets?: Array<{
          views?: Array<Record<string, unknown>>;
        }>;
      };
    };
    if (anyM.kind === 'drawing' && anyM.document?.sheets) {
      for (const sheet of anyM.document.sheets) {
        if (!Array.isArray(sheet.views)) continue;
        for (const view of sheet.views) {
          if (view['kind'] !== 'detail') continue;
          const rp = view['regionParent'] as Record<string, unknown> | undefined;
          if (rp !== undefined && rp['kind'] === undefined) {
            view['regionParent'] = {
              kind: 'circle',
              center: rp['center'],
              radiusMm: rp['radiusMm'],
            };
          }
        }
      }
    }
    return { ...m, formatVersion: 19 };
  },

  // v19 → v20: additive — add `customTextures: []` to part- and assembly-kind
  // documents (PBR Textures Phase 2). Empty default; populated by
  // AddCustomTextureCommand. Drawing documents are untouched.
  19: (mIn) => {
    const m = deepClone(mIn);
    const anyM = m as { kind?: string; document?: Record<string, unknown> };
    if ((anyM.kind === 'part' || anyM.kind === 'assembly') && anyM.document) {
      addCustomTexturesField(anyM.document);
    }
    return { ...m, formatVersion: 20 };
  },

  // v20 → v21: additive — PartDocument.bores and ComponentInstance.role are
  // optional; absent === []/unset at runtime. No structural transformation.
  20: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 21 };
  },

  // v21 → v22: additive — ComponentInstance.doorSpec is optional; absent === unset
  // at runtime. No structural transformation. (Присадка slice 2 — doors)
  21: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 22 };
  },

  // v22 → v23: additive — BoreOp.edited?, BoreOp.jointDir?, PartDocument.suppressedConnectorIds?
  // are all optional; absent === unset at runtime. No structural transformation needed.
  22: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 23 };
  },

  // v23 → v24: additive — DrawerSpec, drawerSlide BoreConnectorKind/BoreRole,
  // drawerFront/drawerBox-* PanelRole union members. All optional; absent === unset at runtime.
  // No structural transformation needed.
  23: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 24 };
  },

  // v24 → v25: additive — handleScrew BoreConnectorKind/BoreRole, drawerHandle ComponentInstance role,
  // drawerHandles HardwareCategory. All optional; absent === unset at runtime.
  // No structural transformation needed.
  24: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 25 };
  },

  // v25 → v26: additive — faceFrameStile/faceFrameRail PanelRole values.
  // All optional role strings; absent === unset at runtime. No structural transformation.
  25: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 26 };
  },

  // v26 → v27: edge bands gain a required `thickness` (mm) field for net→gross cut
  // sizing. Back-fill 0.4mm onto every existing non-null band in part-document panel
  // features. MaterialEntry.bandThicknessMm stays optional (defaults to 0.4 at read).
  // (1b.3 — edge-band thickness → net/gross sizes)
  26: (mIn) => {
    const m = deepClone(mIn);
    const anyM = m as { document?: { featureTree?: Array<Record<string, unknown>> } };
    const tree = anyM.document?.featureTree;
    if (Array.isArray(tree)) {
      for (const f of tree) {
        if (f.kind !== 'panel') continue;
        const eb = f.edgeBands as Record<string, unknown> | undefined;
        if (!eb || typeof eb !== 'object') continue;
        for (const k of ['front', 'back', 'left', 'right']) {
          const band = eb[k];
          if (band && typeof band === 'object' && (band as Record<string, unknown>).thickness === undefined) {
            (band as Record<string, unknown>).thickness = 0.4;
          }
        }
      }
    }
    return { ...m, formatVersion: 27 };
  },
  // v27 → v28: parametric configurator — inject an empty `rules` array onto every
  // part document so the rule engine has a stable field to read/write. Assembly
  // documents have no rules. (Milestone 2.2 — conditional parameter rules)
  27: (mIn) => {
    const m = deepClone(mIn);
    const anyM = m as { kind?: string; document?: Record<string, unknown> };
    if (anyM.kind === 'part' && anyM.document && anyM.document.rules === undefined) {
      anyM.document.rules = [];
    }
    return { ...m, formatVersion: 28 };
  },
  // v28 → v29: feature suppression — inject an empty `suppressedFeatureIds` array
  // onto every part document so the build loop has a stable field to read.
  // Assembly documents have no feature suppression. (Milestone 2.4)
  28: (mIn) => {
    const m = deepClone(mIn);
    const anyM = m as { kind?: string; document?: Record<string, unknown> };
    if (anyM.kind === 'part' && anyM.document && anyM.document.suppressedFeatureIds === undefined) {
      anyM.document.suppressedFeatureIds = [];
    }
    return { ...m, formatVersion: 29 };
  },
};

function normalizeKind(m: AnyManifest): AnyManifest {
  if (
    (m.formatVersion === 10 || m.formatVersion === 11 || m.formatVersion === 12 ||
     m.formatVersion === 13 || m.formatVersion === 14 || m.formatVersion === 15 ||
     m.formatVersion === 16 || m.formatVersion === 17 || m.formatVersion === 18 ||
     m.formatVersion === 19 || m.formatVersion === 20 || m.formatVersion === 21 ||
     m.formatVersion === 22 || m.formatVersion === 23 || m.formatVersion === 24 ||
     m.formatVersion === 25 || m.formatVersion === 26 ||
     m.formatVersion === 27 || m.formatVersion === 28 ||
     m.formatVersion === 29) &&
    (m as unknown as { kind?: unknown }).kind === undefined
  ) {
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

function backfillDrawingF5(m: AnyManifest): AnyManifest {
  const anyM = m as { kind?: string; document?: { sheets?: Array<Record<string, unknown>> } };
  if (anyM.kind !== 'drawing' || !anyM.document?.sheets) return m;
  // Immutable spread — mirrors backfillAssembly4b pattern.
  // Each sheet is spread into a new object; dimensionGroups is only added when absent.
  const newSheets = anyM.document.sheets.map((sheet) =>
    Array.isArray(sheet['dimensionGroups'])
      ? { ...sheet }
      : { ...sheet, dimensionGroups: [] }
  );
  return {
    ...m,
    document: { ...anyM.document, sheets: newSheets },
  } as AnyManifest;
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
  return backfillDrawingF5(migrateSketchPlanes(injectOriginFeatures(backfillAssembly4b(normalizeKind(current)))));
}
