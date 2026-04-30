# Sub-project 1.5 — Inventor Export Macro + Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the user's Inventor 2012 furniture library into ZilInventor's `.zipt`/`.ziasm` format via a one-time STEP+JSON export from Inventor and a folder-driven importer in ZilInventor.

**Architecture:** Inventor-side VBA macro `.ivb` writes per-part STEPs + sibling `.ipt.json`/`.iam.json` sidecars. ZilInventor-side File-tab "Import from Inventor" command walks the export folder, reads STEPs via OCCT into a kernel-resident brep blob cache, builds v9 `PartDocument`s with a new read-only `ImportedFeature` variant, and packs into `.zipt`/`.ziasm` written to OPFS preserving folder structure.

**Tech Stack:** TypeScript / pnpm workspace; React + Zustand UI; three.js viewport; OCCT (`opencascade.js`) kernel via Comlink RPC; Vitest + Playwright tests. Macro side: VBA in Inventor 2012 with `ADODB.Stream` for UTF-8 I/O.

**Spec:** `docs/superpowers/specs/2026-04-30-subproject-1.5-inventor-export-design.md`

**Validation per task:** `pnpm -r typecheck` and the affected package's vitest must remain green at every commit. E2E + perf at the corresponding phase boundaries.

**Commit footer (every commit):**

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Phase 1 — Schema bump (v8 → v9 additive)

### Task 1: Add `ImportedFeature` variant + `properties` field to shared types

**Files:**
- Modify: `packages/shared/src/types.ts`
- Test: `packages/shared/src/__tests__/imported-feature.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/__tests__/imported-feature.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isImportedPart, type PartDocument, type ImportedFeature } from '../types';

const ORIGIN_FEATURES = [
  { kind: 'workAxis', id: 'origin.X', visible: false, source: { mode: 'origin', axis: 'X' } } as const,
  { kind: 'workAxis', id: 'origin.Y', visible: false, source: { mode: 'origin', axis: 'Y' } } as const,
  { kind: 'workAxis', id: 'origin.Z', visible: false, source: { mode: 'origin', axis: 'Z' } } as const,
  { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } } as const,
  { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } } as const,
  { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } } as const,
  { kind: 'workPoint', id: 'origin.O', visible: false, source: { mode: 'origin' } } as const,
];

const importedFeature: ImportedFeature = {
  kind: 'imported',
  id: 'imp-1',
  sourceStep: 'SidePanel.step',
  bodyRef: 'blob-abc',
};

describe('isImportedPart', () => {
  it('returns true when featureTree has exactly one imported feature plus origin features', () => {
    const doc: PartDocument = {
      id: 'p1',
      name: 'SidePanel',
      units: 'mm',
      parameters: {},
      featureTree: [...ORIGIN_FEATURES, importedFeature],
      properties: {},
    };
    expect(isImportedPart(doc)).toBe(true);
  });

  it('returns false for a parametric part (sketch + extrude)', () => {
    const doc: PartDocument = {
      id: 'p2',
      name: 'Box',
      units: 'mm',
      parameters: {},
      featureTree: [
        ...ORIGIN_FEATURES,
        { kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [], constraints: [] },
        { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd', direction: 'forward', operation: 'new' },
      ],
      properties: {},
    };
    expect(isImportedPart(doc)).toBe(false);
  });

  it('returns false for an empty featureTree (only origins)', () => {
    const doc: PartDocument = {
      id: 'p3', name: 'Empty', units: 'mm', parameters: {},
      featureTree: [...ORIGIN_FEATURES],
      properties: {},
    };
    expect(isImportedPart(doc)).toBe(false);
  });

  it('returns false when imported feature is alongside another non-origin feature', () => {
    const doc: PartDocument = {
      id: 'p4', name: 'Mixed', units: 'mm', parameters: {},
      featureTree: [
        ...ORIGIN_FEATURES,
        importedFeature,
        { kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [], constraints: [] },
      ],
      properties: {},
    };
    expect(isImportedPart(doc)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @zilventor/shared test imported-feature`
Expected: FAIL — `ImportedFeature` not exported, `isImportedPart` not exported, `properties` not on PartDocument.

- [ ] **Step 3: Implement the schema additions**

Edit `packages/shared/src/types.ts`. Find the `Feature` union and add `ImportedFeature`:

```ts
export type ImportedFeature = {
  kind: 'imported';
  id: string;
  /** Source filename of the originating STEP, for diagnostics only. */
  sourceStep: string;
  /** Blob id of the cached B-rep body. The kernel keeps a runtime
   *  cache keyed by this id; ProjectPacker (un)packs it on save/load. */
  bodyRef: string;
};

export type Feature =
  | { kind: 'sketch'; id: string; plane: WorkPlaneRef; primitives: SketchPrimitive[]; constraints: SketchConstraint[] }
  | { kind: 'extrude'; id: string; sketchRef: string; distanceParam: string; direction: 'forward' | 'symmetric'; operation: BooleanOperation }
  | { kind: 'revolve'; id: string; sketchRef: string; axisPrimitiveId: string; angleParam: string; direction: 'normal' | 'symmetric' | 'flipped'; operation: BooleanOperation }
  | FilletFeature
  | ChamferFeature
  | ShellFeature
  | LinearPatternFeature
  | MirrorFeature
  | HoleFeature
  | SweepFeature
  | WorkAxisFeature
  | WorkPlaneFeature
  | WorkPointFeature
  | ImportedFeature;
```

Find `PartDocument` and add `properties`:

```ts
export type PartDocument = {
  id: string;
  name: string;
  units: 'mm';
  parameters: Record<string, SketchParameter>;
  featureTree: Feature[];
  cachedGeometry?: CachedGeometry;
  properties: Record<string, string | number | boolean>;
};
```

Find `AssemblyDocument` and add `properties`:

```ts
export type AssemblyDocument = {
  id: string;
  name: string;
  units: 'mm';
  parameters: Record<string, SketchParameter>;
  components: ComponentInstance[];
  constraints: AssemblyConstraint[];
  groundedComponentPaths: ComponentPath[];
  colors: Record<string, string>;
  bomItemNumbers: Record<string, number>;
  colorOverrides: Record<ComponentPathKey, ComponentColor>;
  properties: Record<string, string | number | boolean>;
};
```

Find `ProjectFile` and bump version range:

```ts
export type ProjectFile =
  | { formatVersion: 7 | 8 | 9; kind: 'part'; createdAt: string; appVersion: string; document: PartDocument }
  | { formatVersion: 7 | 8 | 9; kind: 'assembly'; createdAt: string; appVersion: string; document: AssemblyDocument };
```

At the bottom of the file, add the predicate:

```ts
export function isImportedPart(doc: PartDocument): boolean {
  const nonOrigin = doc.featureTree.filter((f) => !(typeof f.id === 'string' && f.id.startsWith('origin.')));
  return nonOrigin.length === 1 && nonOrigin[0]!.kind === 'imported';
}
```

- [ ] **Step 4: Run the new test**

Run: `pnpm --filter @zilventor/shared test imported-feature`
Expected: PASS (4 tests).

- [ ] **Step 5: Run workspace typecheck**

Run: `pnpm -r typecheck`
Expected: FAIL — many places in `packages/app/**` and `packages/kernel/**` construct `PartDocument`/`AssemblyDocument` literals without `properties: {}`. **Do not fix those yet** — Task 2 fixes them via the migration loader, and Task 3 backfills literal sites.

(If the failures are limited to test fixtures and command construction sites, that's expected. Note the count for sanity check: should be ~30–60 errors.)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/__tests__/imported-feature.spec.ts
git commit -m "$(cat <<'EOF'
feat(shared): T1 ImportedFeature variant + properties bag (v8→v9 prep)

Adds the ImportedFeature discriminant to the Feature union, properties:
Record<string, string|number|boolean> to both PartDocument and
AssemblyDocument, formatVersion 9 to ProjectFile, and the isImportedPart
predicate. Schema additions only; the v8→v9 migration and call-site
backfill follow in T2 and T3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: v8 → v9 migration

**Files:**
- Modify: `packages/shared/src/fileFormat.ts`
- Test: `packages/shared/src/__tests__/migrateManifest-v8-to-v9.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/__tests__/migrateManifest-v8-to-v9.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v8 → v9', () => {
  it('CURRENT_FORMAT_VERSION is 9', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(9);
  });

  it('v8 part without properties gets properties: {} on v9', () => {
    const v8: any = {
      formatVersion: 8,
      kind: 'part',
      createdAt: '2026-04-29T00:00:00Z',
      appVersion: '0.0.1',
      document: {
        id: 'p1', name: 'X', units: 'mm', parameters: {}, featureTree: [],
      },
    };
    const v9 = migrateManifest(v8) as any;
    expect(v9.formatVersion).toBe(9);
    expect(v9.document.properties).toEqual({});
  });

  it('v8 assembly without properties gets properties: {} on v9', () => {
    const v8: any = {
      formatVersion: 8,
      kind: 'assembly',
      createdAt: '2026-04-29T00:00:00Z',
      appVersion: '0.0.1',
      document: {
        id: 'a1', name: 'A', units: 'mm', parameters: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: {}, colorOverrides: {},
      },
    };
    const v9 = migrateManifest(v8) as any;
    expect(v9.formatVersion).toBe(9);
    expect(v9.document.properties).toEqual({});
  });

  it('v9 file with properties preserved (no clobber)', () => {
    const v9in: any = {
      formatVersion: 9,
      kind: 'part',
      createdAt: '2026-04-30T00:00:00Z',
      appVersion: '0.0.1',
      document: {
        id: 'p1', name: 'X', units: 'mm', parameters: {}, featureTree: [],
        properties: { partNumber: 'Z-1', mass: 1.5 },
      },
    };
    const v9out = migrateManifest(v9in) as any;
    expect(v9out.formatVersion).toBe(9);
    expect(v9out.document.properties).toEqual({ partNumber: 'Z-1', mass: 1.5 });
  });

  it('v7 part migrates all the way to v9 with properties: {}', () => {
    const v7: any = {
      formatVersion: 7,
      createdAt: '2026-04-20T00:00:00Z',
      appVersion: '0.0.1',
      document: { id: 'p1', name: 'X', units: 'mm', parameters: {}, featureTree: [] },
    };
    const v9 = migrateManifest(v7) as any;
    expect(v9.formatVersion).toBe(9);
    expect(v9.document.properties).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @zilventor/shared test migrateManifest-v8-to-v9`
Expected: FAIL — `CURRENT_FORMAT_VERSION` is 8.

- [ ] **Step 3: Implement the migration**

Edit `packages/shared/src/fileFormat.ts`. Change the version constant:

```ts
export const CURRENT_FORMAT_VERSION = 9 as const;
```

Add the v8 entry to the `migrations` map (right after the `7:` entry, before the closing `}` of the map):

```ts
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
```

- [ ] **Step 4: Run the migration test**

Run: `pnpm --filter @zilventor/shared test migrateManifest-v8-to-v9`
Expected: PASS (5 tests).

- [ ] **Step 5: Run all shared tests**

Run: `pnpm --filter @zilventor/shared test`
Expected: All shared tests pass (existing v7→v8 tests still green; new v8→v9 tests green; `imported-feature` from T1 green).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/fileFormat.ts packages/shared/src/__tests__/migrateManifest-v8-to-v9.spec.ts
git commit -m "$(cat <<'EOF'
feat(shared): T2 v8→v9 migration injects properties: {} on documents

Bumps CURRENT_FORMAT_VERSION to 9. Migration is additive — existing v8
files load with properties defaulting to {} and re-save as v9. v7 files
still migrate forward through both steps.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Backfill `properties: {}` at PartDocument/AssemblyDocument literal sites

**Goal:** every TS construction site for `PartDocument` and `AssemblyDocument` (test fixtures, factory helpers, command tests) sets `properties: {}` so workspace typecheck is clean. We do NOT add `properties` handling to `newPart`/`newAssembly` in this task — Task 4 handles those factories.

- [ ] **Step 1: Discover the failing sites**

Run: `pnpm -r typecheck 2>&1 | grep -E "Property 'properties' is missing|properties.*not assignable" | sort -u`

Expected: list of files (likely):
- `packages/kernel/src/adapter/PartDocument.ts` — `newPart` factory
- `packages/kernel/src/adapter/__tests__/PartDocument.spec.ts`
- Multiple `packages/app/src/commands/__tests__/*.spec.ts`
- Multiple `packages/app/src/shell/__tests__/*.spec.tsx`
- `packages/kernel/src/storage/__tests__/AssemblyPacker.spec.ts`
- `packages/kernel/src/storage/__tests__/ProjectPacker.spec.ts`
- `tests/e2e/helpers/seedKernelPart.ts` and similar

(Numbers will vary; treat the grep as the authoritative list.)

- [ ] **Step 2: Fix the factory sources first**

Edit `packages/kernel/src/adapter/PartDocument.ts`. Find `export function newPart(name: string): PartDocument` and add `properties: {}` to the returned literal.

If a `newAssembly` factory exists in the kernel (search: `pnpm exec rg -l "name === 'newAssembly'|export function newAssembly"`), add `properties: {}` there too.

If app-side seed helpers (`tests/e2e/helpers/seedKernelPart.ts`, `tests/e2e/helpers/seedAssemblyPart.ts`, `tests/e2e/helpers/seedAssemblyCylinderPart.ts`, `tests/e2e/helpers/seedSubAssembly.ts`) construct documents, add `properties: {}` in their literal returns.

- [ ] **Step 3: Mass-fix call sites**

For each test file flagged by Step 1, add `properties: {}` to every PartDocument/AssemblyDocument literal it constructs. **Do not** add it to factory-derived calls like `newPart('foo')` — those now return it from the factory.

For files that build a `PartDocument` via spread (e.g., `{ ...somePart, name: 'X' }`), no change needed — the spread carries `properties`.

- [ ] **Step 4: Run workspace typecheck**

Run: `pnpm -r typecheck`
Expected: PASS — clean across all packages.

- [ ] **Step 5: Run all unit tests**

Run: `pnpm -r test:unit`
Expected: All pre-existing tests still green. (Existing tests don't read `properties`, so the empty-bag default is invisible.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(workspace): T3 backfill properties: {} at PartDocument/AssemblyDocument literal sites

Adds properties: {} to every direct construction site (factories, test
fixtures, seed helpers) so workspace typecheck is clean after the v9
schema bump. No behavioural change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: ProjectPacker round-trips `properties` and `ImportedFeature.bodyRef` blob

**Files:**
- Modify: `packages/kernel/src/storage/ProjectPacker.ts`
- Test: `packages/kernel/src/storage/__tests__/ProjectPacker.spec.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `packages/kernel/src/storage/__tests__/ProjectPacker.spec.ts`:

```ts
import type { ImportedFeature } from '@zilventor/shared';

describe('ProjectPacker — properties + imported-feature blob', () => {
  it('round-trips properties on a part', async () => {
    const doc: PartDocument = {
      id: 'p1', name: 'X', units: 'mm', parameters: {}, featureTree: [],
      properties: { partNumber: 'Z-1', description: 'тест', mass: 1.5, isFinished: true },
    };
    const bytes = await packProject({ formatVersion: 9, kind: 'part', createdAt: 'now', appVersion: '0.0.1', document: doc }, new Map());
    const { manifest } = await unpackProject(bytes);
    expect((manifest as any).document.properties).toEqual({
      partNumber: 'Z-1', description: 'тест', mass: 1.5, isFinished: true,
    });
  });

  it('round-trips an ImportedFeature with its brep blob', async () => {
    const blobBytes = new Uint8Array([0xDC, 0xCA, 0xCA, 0xFE]);
    const blobs = new Map<string, Uint8Array>([['blob-imp-1', blobBytes]]);
    const importedFeature: ImportedFeature = {
      kind: 'imported', id: 'imp-1', sourceStep: 'X.step', bodyRef: 'blob-imp-1',
    };
    const doc: PartDocument = {
      id: 'p1', name: 'X', units: 'mm', parameters: {}, featureTree: [importedFeature], properties: {},
    };
    const bytes = await packProject({ formatVersion: 9, kind: 'part', createdAt: 'now', appVersion: '0.0.1', document: doc }, blobs);
    const { manifest, blobs: outBlobs } = await unpackProject(bytes);
    expect(outBlobs.get('blob-imp-1')).toEqual(blobBytes);
    expect((manifest as any).document.featureTree[0]).toMatchObject({ kind: 'imported', id: 'imp-1', bodyRef: 'blob-imp-1' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail or pass**

Run: `pnpm --filter @zilventor/kernel test ProjectPacker.spec`
Expected: depends on existing implementation.
- If `packProject` already takes a `blobs: Map<string, Uint8Array>` and round-trips them, the second test may already pass — investigate before assuming.
- If `properties` is not on the manifest filter list, the first test passes (the packer is generic and writes whatever the manifest contains).

- [ ] **Step 3: Inspect packer to confirm**

Read `packages/kernel/src/storage/ProjectPacker.ts`. Confirm:
1. `packProject(manifest, blobs)` writes `manifest.json` plus each `blobs/<id>.brep`.
2. `unpackProject(bytes)` returns `{ manifest, blobs: Map<string, Uint8Array> }`.

If yes, both tests pass without changes. If the signature differs (e.g., `packProject` only takes `cachedGeometry.brepBlobId`), modify the signature so callers can pass an arbitrary blob map. Add a new param if needed (default to empty Map).

- [ ] **Step 4: Make tests pass**

If the existing implementation already supports it (likely, given 4d's history): no code change needed.
If not: extend `packProject(manifest, blobs)` to write all entries in `blobs` to the tar. Extend `unpackProject` to return a `Map` of all `blobs/*.brep` entries.

- [ ] **Step 5: Run all kernel tests**

Run: `pnpm --filter @zilventor/kernel test`
Expected: All green.

- [ ] **Step 6: Commit**

```bash
git add packages/kernel/src/storage/ProjectPacker.ts packages/kernel/src/storage/__tests__/ProjectPacker.spec.ts
git commit -m "$(cat <<'EOF'
test(kernel): T4 ProjectPacker round-trips properties + ImportedFeature blob

Confirms (or extends if needed) that the project packer writes
PartDocument.properties and the brep blob referenced by an
ImportedFeature.bodyRef without losing them on unpack. No production
change if the packer was already generic enough.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

**Phase 1 verification gate:**

```bash
pnpm -r typecheck && pnpm -r test:unit
```

Both must be green before moving to Phase 2.

---

## Phase 2 — Kernel STEP I/O + ImportedFeature evaluator

This phase wires up: a brep blob cache in the kernel; a STEP reader that populates it; an `importStep` RPC; an evaluator that returns a cached blob as a NamedShape; FaceName generation for imported geometry; and save/load round-trip via the packer. Phase 2 is the heaviest in the plan — it spans ~7 tasks.

### Task 5: Brep blob cache in kernel API closure

**Files:**
- Modify: `packages/kernel/src/api.ts` — add `importedShapeCache` to closure, plus accessor helpers

- [ ] **Step 1: Add the cache** in `packages/kernel/src/api.ts`. Inside `createKernelApi()`, alongside `namedShapeCache`, add:

```ts
/** Imported-STEP brep blob cache, keyed by ImportedFeature.bodyRef.
 *  Populated by `importStep` and by `loadFromBytes` (when restoring an
 *  imported part). Read by the ImportedFeature evaluator (Task 8) and
 *  walked by `saveToBytes` to write blobs back into the .zipt. */
const importedShapeCache = new Map<string, OcctShape>();
```

Add two internal helpers above the `return` statement:

```ts
function registerImportedShape(bodyRef: string, shape: OcctShape): void {
  const prev = importedShapeCache.get(bodyRef);
  if (prev) disposeShape(prev);
  importedShapeCache.set(bodyRef, shape);
}
function lookupImportedShape(bodyRef: string): OcctShape | undefined {
  return importedShapeCache.get(bodyRef);
}
```

Import `OcctShape` from `./occt/SolidOps` if not already imported.

- [ ] **Step 2: Plumb the cache to `executeTree` and `ProjectPacker`**

This is forward-prep for Tasks 8 and 11 — no behavioural change yet. In `api.ts`, wherever `executeTree(occ, part)` is called, pass `lookupImportedShape` as a third argument. Update `executeTree`'s signature to accept an optional fourth parameter `lookupImportedShape?: (bodyRef: string) => OcctShape | undefined` (used by the imported-feature dispatch in Task 8).

For now, just add the parameter to the function signature and thread it through. The dispatch code that uses it lands in Task 8.

- [ ] **Step 3: Run typecheck**

Run: `pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/kernel/src/api.ts packages/kernel/src/adapter/FeatureTree.ts
git commit -m "$(cat <<'EOF'
feat(kernel): T5 importedShapeCache + lookup plumbing for ImportedFeature

Adds the in-memory brep cache to the kernel API closure, with
register/lookup helpers, and threads a lookup function through
executeTree's signature. No imported features are dispatched yet; T8
adds the evaluator.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: STEP fixtures (committed binaries + regenerator script)

**Goal:** commit three small `.step` files used by Tasks 7 and the importer e2e tests, plus a one-time helper script to regenerate them.

**Files:**
- Create: `tools/generate-step-fixtures.mjs` — node ESM script using `opencascade.js` to produce the fixture STEPs
- Create: `packages/kernel/src/occt/__tests__/fixtures/step/cube-10mm.step` (committed binary output)
- Create: `packages/kernel/src/occt/__tests__/fixtures/step/two-bodies.step` (committed)
- Create: `packages/kernel/src/occt/__tests__/fixtures/step/cyrillic-name.step` (committed)

- [ ] **Step 1: Write the generator script** at `tools/generate-step-fixtures.mjs`:

```js
// One-time generator. Run via: node tools/generate-step-fixtures.mjs
// Produces three small STEP fixtures for the kernel STEP-IO integration tests.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import opencascade from 'opencascade.js';

const OUT_DIR = 'packages/kernel/src/occt/__tests__/fixtures/step';
mkdirSync(OUT_DIR, { recursive: true });

const oc = await opencascade();

function makeBox(dx, dy, dz, originX = 0, originY = 0, originZ = 0) {
  const origin = new oc.gp_Pnt_3(originX, originY, originZ);
  const box = new oc.BRepPrimAPI_MakeBox_3(origin, dx, dy, dz);
  box.Build(new oc.Message_ProgressRange_1());
  return box.Shape();
}

function writeStep(shape, productName, outFile) {
  const writer = new oc.STEPControl_Writer_1();
  // AP214 with mm units (Inventor convention)
  oc.Interface_Static.SetCVal('write.step.schema', 'AP214');
  oc.Interface_Static.SetCVal('write.step.unit', 'MM');
  oc.Interface_Static.SetCVal('write.step.product.name', productName);
  writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true, new oc.Message_ProgressRange_1());
  const tmpPath = '/tmp.step';
  oc.FS.unlink(tmpPath); // ignore failures
  writer.Write(tmpPath);
  const bytes = oc.FS.readFile(tmpPath);
  writeFileSync(outFile, bytes);
  // OCCT cleanup
}

// 1. cube-10mm.step — a single 10×10×10 mm box at origin
const cube = makeBox(10, 10, 10);
writeStep(cube, 'cube-10mm', `${OUT_DIR}/cube-10mm.step`);

// 2. two-bodies.step — two disjoint boxes assembled into a compound
const boxA = makeBox(10, 10, 10);
const boxB = makeBox(5, 5, 5, 30, 0, 0);
const builder = new oc.BRep_Builder();
const comp = new oc.TopoDS_Compound();
builder.MakeCompound(comp);
builder.Add(comp, boxA);
builder.Add(comp, boxB);
writeStep(comp, 'two-bodies', `${OUT_DIR}/two-bodies.step`);

// 3. cyrillic-name.step — single box with a Ukrainian product name
const cube2 = makeBox(10, 10, 10);
writeStep(cube2, 'Бічна_панель', `${OUT_DIR}/cyrillic-name.step`);

console.log('Wrote fixtures to', OUT_DIR);
```

- [ ] **Step 2: Run the generator**

Run: `node tools/generate-step-fixtures.mjs`
Expected: three files created under `packages/kernel/src/occt/__tests__/fixtures/step/`. Sizes typically 2–6 KB each. Manually verify with `head -3 cube-10mm.step` — should start with `ISO-10303-21;`.

If the generator hits OCCT API mismatches (the `opencascade.js` API surface drifts between minor versions): peek at `packages/kernel/src/occt/SolidOps.ts` for the canonical pattern in this repo (e.g. `oc.BRepPrimAPI_MakeBox_3` may be `_2`), and adjust accordingly.

- [ ] **Step 3: Add a fixtures README** at `packages/kernel/src/occt/__tests__/fixtures/step/README.md`:

```
STEP fixtures for sub-project 1.5 importer tests.
Regenerate via: node tools/generate-step-fixtures.mjs
Do not edit the .step files by hand.
```

- [ ] **Step 4: Commit**

```bash
git add tools/generate-step-fixtures.mjs packages/kernel/src/occt/__tests__/fixtures/
git commit -m "$(cat <<'EOF'
test(kernel): T6 STEP fixtures + regenerator script for 1.5 importer

Three small AP214 STEPs (cube, two-bodies compound, cyrillic-named
cube) committed as binary fixtures, plus the one-time node script
that produced them. Regeneration is reproducible via the script.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `StepIO.readStep` — STEP bytes → BRep + face count

**Files:**
- Create: `packages/kernel/src/occt/StepIO.ts`
- Test: `packages/kernel/src/occt/__tests__/StepIO.integration.spec.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `packages/kernel/src/occt/__tests__/StepIO.integration.spec.ts`:

```ts
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { readStep } from '../StepIO';
import { disposeShape } from '../SolidOps';

const FIXTURES = resolve(__dirname, 'fixtures/step');

describe('readStep (integration)', () => {
  let oc: OcctInstance;
  beforeAll(async () => { oc = await loadOcct(); });

  it('reads cube-10mm.step into a single solid with 6 faces and bbox [0,0,0,10,10,10]', () => {
    const bytes = readFileSync(resolve(FIXTURES, 'cube-10mm.step'));
    const result = readStep(oc, bytes.buffer);
    try {
      expect(result.faceCount).toBe(6);
      expect(result.boundingBox).toEqual([0, 0, 0, 10, 10, 10]);
      expect(result.solidCount).toBe(1);
    } finally {
      disposeShape(result.shape);
    }
  });

  it('reads two-bodies.step and unifies into a compound (12 faces, 2 solids)', () => {
    const bytes = readFileSync(resolve(FIXTURES, 'two-bodies.step'));
    const result = readStep(oc, bytes.buffer);
    try {
      expect(result.faceCount).toBe(12);
      expect(result.solidCount).toBe(2);
    } finally {
      disposeShape(result.shape);
    }
  });

  it('reads cyrillic-name.step without throwing on Cyrillic product name', () => {
    const bytes = readFileSync(resolve(FIXTURES, 'cyrillic-name.step'));
    const result = readStep(oc, bytes.buffer);
    try {
      expect(result.faceCount).toBe(6);
    } finally {
      disposeShape(result.shape);
    }
  });

  it('throws a descriptive error for non-STEP bytes', () => {
    const garbage = new TextEncoder().encode('not a step file').buffer;
    expect(() => readStep(oc, garbage)).toThrow(/STEP|read|parse/i);
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `pnpm --filter @zilventor/kernel test:integration StepIO.integration`
Expected: FAIL — `readStep` not defined.

- [ ] **Step 3: Implement `StepIO.ts`**

Create `packages/kernel/src/occt/StepIO.ts`:

```ts
import type { OcctInstance } from './occtLoader';
import type { OcctShape } from './SolidOps';
import type { BoundingBox } from '@zilventor/shared';

export type StepReadResult = {
  shape: OcctShape;
  faceCount: number;
  solidCount: number;
  boundingBox: BoundingBox;
};

/**
 * Reads STEP bytes into a single TopoDS_Shape. Multiple solids in the
 * STEP are returned as a single compound shape — the caller decides how
 * to surface them (sub-project 1.5 unifies them into one imported part).
 *
 * Caller owns the returned `shape`; dispose via SolidOps.disposeShape.
 */
export function readStep(oc: OcctInstance, stepBytes: ArrayBuffer): StepReadResult {
  // OCCT requires the bytes to be on its in-memory FS
  const tmpPath = `/tmp-step-${Math.random().toString(36).slice(2, 10)}.step`;
  const u8 = new Uint8Array(stepBytes);
  oc.FS.writeFile(tmpPath, u8);
  try {
    const reader = new oc.STEPControl_Reader_1();
    const status = reader.ReadFile(tmpPath);
    // IFSelect_RetDone == 0 in current opencascade.js bindings; verify by reading
    // packages/kernel/src/occt/occtLoader.ts for the exact enum import.
    if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      throw new Error(`readStep: failed to parse STEP (status=${status})`);
    }
    reader.TransferRoots(new oc.Message_ProgressRange_1());
    const shape: OcctShape = reader.OneShape();
    if (shape.IsNull()) throw new Error('readStep: STEP produced an empty shape');

    // Count faces and solids
    let faceCount = 0;
    const faceExp = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (faceExp.More()) { faceCount++; faceExp.Next(); }

    let solidCount = 0;
    const solidExp = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (solidExp.More()) { solidCount++; solidExp.Next(); }

    // Bounding box
    const bnd = new oc.Bnd_Box_1();
    oc.BRepBndLib.Add(shape, bnd, true);
    const xmin = { current_value: 0 } as any;
    // Bnd_Box.Get takes 6 out-refs; opencascade.js exposes them via Get
    // (some bindings: bnd.Get(xmin, ymin, zmin, xmax, ymax, zmax))
    const out = bnd.Get();  // returns [xmin, ymin, zmin, xmax, ymax, zmax] in current bindings
    const boundingBox: BoundingBox = [out[0], out[1], out[2], out[3], out[4], out[5]];

    return { shape, faceCount, solidCount, boundingBox };
  } finally {
    try { oc.FS.unlink(tmpPath); } catch { /* ignore */ }
  }
}
```

**Note:** the exact OCCT binding names (`STEPControl_Reader_1`, `IFSelect_ReturnStatus`, `Bnd_Box_1.Get` return shape) drift across `opencascade.js` versions. If a binding is missing, mirror the pattern used elsewhere in `packages/kernel/src/occt/` (e.g. `SolidOps.ts`, `BooleanOps.ts`) and adjust.

- [ ] **Step 4: Run the test, expect PASS**

Run: `pnpm --filter @zilventor/kernel test:integration StepIO.integration`
Expected: 4 PASS.

- [ ] **Step 5: Run all kernel tests**

Run: `pnpm --filter @zilventor/kernel test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/kernel/src/occt/StepIO.ts packages/kernel/src/occt/__tests__/StepIO.integration.spec.ts
git commit -m "$(cat <<'EOF'
feat(kernel): T7 StepIO.readStep — STEP bytes → BRep + topology counts

Wraps STEPControl_Reader to parse STEP (AP214) bytes into a single
TopoDS_Shape compound, returning face count, solid count, and bbox.
Caller owns and disposes the returned shape. Integration tested
against T6 fixtures including a Cyrillic-named product.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `importStep` RPC + ImportedFeature evaluator + face naming

**Files:**
- Modify: `packages/kernel/src/api.ts` — add `importStep` method, plumb the cache
- Create: `packages/kernel/src/adapter/features/ImportedFeature.ts`
- Modify: `packages/kernel/src/adapter/FeatureTree.ts` — dispatch `imported` features
- Test: `packages/kernel/src/adapter/features/__tests__/ImportedFeature.integration.spec.ts` (create)
- Test: `packages/kernel/src/__tests__/api.integration.spec.ts` — extend with importStep coverage

- [ ] **Step 1: Write the failing test for `importStep`**

Append to `packages/kernel/src/__tests__/api.integration.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('importStep + ImportedFeature roundtrip', () => {
  it('imports a STEP, attaches it as an imported feature, and execute() returns a mesh with 6 face names', async () => {
    const api = createKernelApi();
    await api.init();
    const bytes = readFileSync(resolve(__dirname, '../occt/__tests__/fixtures/step/cube-10mm.step'));
    const result = await api.importStep({ stepBytes: bytes.buffer, partName: 'Cube' });
    expect(result.faceCount).toBe(6);
    expect(result.boundingBox).toEqual([0, 0, 0, 10, 10, 10]);
    expect(result.triangleCount).toBeGreaterThan(0);

    const partId = await api.createPart('Cube');
    await api.addFeature(partId, {
      kind: 'imported', id: 'imp-1', sourceStep: 'cube-10mm.step', bodyRef: result.brepBlobId,
    });
    const exec = await api.execute(partId);
    if (exec.tag !== 'ok') throw new Error(`execute failed: ${JSON.stringify(exec.err)}`);
    expect(exec.value.mesh.indices.length).toBeGreaterThan(0);
    expect(exec.value.faceNames?.length).toBe(6);
    // Each face has role 'imported-face' and instance 0..5
    const roles = (exec.value.faceNames ?? []).map((f) => f.role);
    expect(new Set(roles)).toEqual(new Set(['imported-face']));
    const instances = (exec.value.faceNames ?? []).map((f) => f.instance ?? -1).sort((a, b) => a - b);
    expect(instances).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`importStep not on api`).

Run: `pnpm --filter @zilventor/kernel test:integration api.integration`

- [ ] **Step 3: Implement `ImportedFeature.ts`**

Create `packages/kernel/src/adapter/features/ImportedFeature.ts`:

```ts
import type { OcctInstance } from '../../occt/occtLoader';
import type { ImportedFeature, FaceName } from '@zilventor/shared';
import type { OcctShape } from '../../occt/SolidOps';
import { type NamedShape, attachName } from '../../occt/FaceNaming';

/**
 * Evaluates an `imported` feature by looking up its cached brep shape
 * and attaching deterministic face names of the form
 *   { featureId, role: 'imported-face', instance: <occt-face-index> }
 *
 * The lookup function is provided by the kernel API closure; it reads
 * from the `importedShapeCache` populated by `importStep` /
 * `loadFromBytes`.
 *
 * Returns a fresh NamedShape; the caller (FeatureTree.executeTree) owns
 * it and disposes via disposeShape on cleanup. The cached brep stays
 * alive — we hand out a *copy* so the cache remains the source of truth.
 */
export function executeImportedFeature(
  oc: OcctInstance,
  feature: ImportedFeature,
  lookup: (bodyRef: string) => OcctShape | undefined,
): NamedShape {
  const cached = lookup(feature.bodyRef);
  if (!cached) {
    throw new Error(`ImportedFeature "${feature.id}": no brep cached for bodyRef "${feature.bodyRef}"`);
  }
  // Copy the shape so downstream disposal doesn't kill our cache entry
  const copier = new oc.BRepBuilderAPI_Copy_2(cached, true, false);
  const shape: OcctShape = copier.Shape();

  // Iterate faces in OCCT's deterministic explorer order, attaching names
  const ns: NamedShape = { shape, faceNames: new Map() };
  const exp = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let idx = 0;
  while (exp.More()) {
    const face = exp.Current();
    const name: FaceName = { featureId: feature.id, role: 'imported-face', instance: idx };
    attachName(ns, face, name);
    idx++;
    exp.Next();
  }
  return ns;
}
```

**Note:** `attachName` and `NamedShape`'s exact shape — confirm by reading `packages/kernel/src/occt/FaceNaming.ts`. Adjust the return-shape construction to match the existing convention.

- [ ] **Step 4: Wire dispatch in FeatureTree**

Edit `packages/kernel/src/adapter/FeatureTree.ts`:

1. Import `executeImportedFeature` from `./features/ImportedFeature`.
2. Extend `executeTree`'s signature with `lookupImportedShape?: (bodyRef: string) => OcctShape | undefined`.
3. In the main feature-walk switch, add a case for `kind === 'imported'`:

```ts
case 'imported': {
  if (!lookupImportedShape) {
    return err({ kind: 'execution', message: 'no imported-shape lookup provided to executeTree', correlationId: newCorrelationId() });
  }
  // Imported feature replaces the running solid — operation is implicit 'new'
  if (finalSolid) { disposeShape(finalSolid.shape); finalSolid = null; }
  finalSolid = executeImportedFeature(oc, feature, lookupImportedShape);
  break;
}
```

Place this case alongside the other `case 'X':` branches in the switch.

- [ ] **Step 5: Implement `importStep` on the API**

In `packages/kernel/src/api.ts`:

1. Import `readStep` from `./occt/StepIO`, `tessellate` from `./occt/Tessellator`, `writeBRep` from `./occt/BRepIO`.
2. Add to `KernelApi` type:

```ts
importStep(params: {
  stepBytes: ArrayBuffer;
  partName: string;
}): Promise<{
  brepBlobId: string;
  triangleCount: number;
  boundingBox: BoundingBox;
  faceCount: number;
}>;
```

3. Implement on the returned object:

```ts
async importStep({ stepBytes, partName }) {
  if (!occ) throw new Error('kernel not init()ed');
  const result = readStep(occ, stepBytes);
  const { mesh } = tessellate(occ, result.shape);
  const brepBlobId = `imp-${crypto.randomUUID()}`;
  registerImportedShape(brepBlobId, result.shape);
  return {
    brepBlobId,
    triangleCount: mesh.indices.length / 3,
    boundingBox: result.boundingBox,
    faceCount: result.faceCount,
  };
},
```

Note: `partName` is unused by the kernel for now — the app stores it on the PartDocument. We pass it in the RPC anyway for forward-compat (e.g. future logging).

4. In every existing `executeTree(occ, p)` call, add the third argument: `executeTree(occ, p, lookupImportedShape)` (or however the threading went in T5).

- [ ] **Step 6: Run integration tests**

Run: `pnpm --filter @zilventor/kernel test:integration`
Expected: PASS, including the new `importStep + ImportedFeature roundtrip` test.

- [ ] **Step 7: Commit**

```bash
git add packages/kernel/
git commit -m "$(cat <<'EOF'
feat(kernel): T8 importStep RPC + ImportedFeature evaluator

New importStep({ stepBytes, partName }) RPC reads a STEP into the
kernel-resident importedShapeCache, returning bodyRef + topology meta.
The FeatureTree dispatches kind:'imported' features through
executeImportedFeature, which copies the cached brep and attaches
deterministic face names {role:'imported-face', instance:<idx>}.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Save/load round-trip for ImportedFeature

**Goal:** an imported part survives `saveToBytes` → `loadFromBytes` with its brep blob restored to the importedShapeCache, and `execute` still produces a mesh.

**Files:**
- Modify: `packages/kernel/src/api.ts` — `saveToBytes` writes imported brep blobs, `loadFromBytes` rehydrates them
- Test: `packages/kernel/src/__tests__/save-roundtrip.integration.spec.ts` — extend

- [ ] **Step 1: Write the failing test**

Append to `packages/kernel/src/__tests__/save-roundtrip.integration.spec.ts`:

```ts
it('round-trips an imported part: importStep → addFeature → save → load → execute', async () => {
  const api = createKernelApi();
  await api.init();
  const bytes = readFileSync(resolve(__dirname, '../occt/__tests__/fixtures/step/cube-10mm.step'));
  const imp = await api.importStep({ stepBytes: bytes.buffer, partName: 'Cube' });
  const partId = await api.createPart('Cube');
  await api.addFeature(partId, {
    kind: 'imported', id: 'imp-1', sourceStep: 'cube-10mm.step', bodyRef: imp.brepBlobId,
  });
  const saved = await api.saveToBytes(partId);

  // Fresh API instance simulates a reload
  const api2 = createKernelApi();
  await api2.init();
  const partId2 = await api2.loadFromBytes(saved);
  const exec = await api2.execute(partId2);
  if (exec.tag !== 'ok') throw new Error(`execute after reload failed: ${JSON.stringify(exec.err)}`);
  expect(exec.value.mesh.indices.length).toBeGreaterThan(0);
  expect(exec.value.faceNames?.length).toBe(6);
});
```

- [ ] **Step 2: Run, expect FAIL** (the brep blob is not yet written into the .zipt; load can't find it).

- [ ] **Step 3: Implement save-side blob writing**

In `packages/kernel/src/api.ts`, find `saveToBytes`. Before calling `packProject(manifest, blobs)`, walk `part.featureTree` for any `kind: 'imported'` features and add their breps to the `blobs` map:

```ts
for (const f of part.featureTree) {
  if (f.kind === 'imported') {
    const shape = importedShapeCache.get(f.bodyRef);
    if (!shape) throw new Error(`saveToBytes: imported feature ${f.id} bodyRef=${f.bodyRef} not in cache`);
    blobs.set(f.bodyRef, writeBRep(occ, shape));
  }
}
```

If `cachedGeometry.brepBlobId` is also being written here, leave that path intact.

- [ ] **Step 4: Implement load-side blob restoration**

In `loadFromBytes`, after `unpackProject(bytes)` returns `{ manifest, blobs }`, walk the manifest's featureTree (from `migrateManifest(...).document.featureTree`) for `kind: 'imported'`. For each, read the matching blob via `readBRep(occ, blobs.get(f.bodyRef))` and call `registerImportedShape(f.bodyRef, shape)`.

Import `readBRep` from `./occt/BRepIO`.

- [ ] **Step 5: Run, expect PASS**

Run: `pnpm --filter @zilventor/kernel test:integration save-roundtrip`

- [ ] **Step 6: Commit**

```bash
git add packages/kernel/src/api.ts packages/kernel/src/__tests__/save-roundtrip.integration.spec.ts
git commit -m "$(cat <<'EOF'
feat(kernel): T9 ImportedFeature blob round-trips through save/load

saveToBytes walks imported features and writes their cached breps into
the .zipt blob bag. loadFromBytes rehydrates them back into the
importedShapeCache so subsequent execute() can evaluate the part.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

**Phase 2 verification gate:**

```bash
pnpm -r typecheck && pnpm -r test:unit && pnpm --filter @zilventor/kernel test:integration
```

All green before Phase 3.

---

## Phase 3 — Importer pure logic (no kernel, no DOM)

These tasks build the side-effect-free TypeScript that turns parsed JSON into v9 documents. Each is a small, self-contained module with its own unit test file. Run via `pnpm --filter @zilventor/app test <name>`.

### Task 10: `inventorJsonSchema` — types + validators

**Files:**
- Create: `packages/app/src/import/inventorJsonSchema.ts`
- Test: `packages/app/src/import/__tests__/inventorJsonSchema.spec.ts`
- Test: `packages/app/src/import/__tests__/fixtures/part-simple.ipt.json`
- Test: `packages/app/src/import/__tests__/fixtures/asm-simple.iam.json`

- [ ] **Step 1: Write the failing tests**

Create `packages/app/src/import/__tests__/inventorJsonSchema.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parsePartJson, parseAssemblyJson, type ImporterPartJson, type ImporterAssemblyJson } from '../inventorJsonSchema';

describe('inventorJsonSchema', () => {
  describe('parsePartJson', () => {
    it('accepts a well-formed part JSON', () => {
      const j: any = {
        schemaVersion: 1, kind: 'part', exportedAt: '2026-04-30T00:00:00Z',
        source: { iptPath: 'a/b.ipt', fileVersion: 'Inventor 2012' },
        step: 'b.step', name: 'b',
        properties: { partNumber: 'X-1', mass: 1.5, hasFinish: true, 'Cost Center': 'Doors' },
        parameters: { Width: { value: 600, unit: 'mm', expression: '600 mm' } },
      };
      const r = parsePartJson(j);
      expect(r.tag).toBe('ok');
      if (r.tag === 'ok') expect(r.value.name).toBe('b');
    });

    it('rejects wrong schemaVersion', () => {
      const r = parsePartJson({ schemaVersion: 2, kind: 'part' });
      expect(r.tag).toBe('err');
      if (r.tag === 'err') expect(r.error).toMatch(/schemaVersion/);
    });

    it('rejects wrong kind', () => {
      const r = parsePartJson({ schemaVersion: 1, kind: 'assembly' });
      expect(r.tag).toBe('err');
    });

    it('rejects missing required fields (step)', () => {
      const r = parsePartJson({ schemaVersion: 1, kind: 'part', source: { iptPath: 'x', fileVersion: 'I' }, name: 'n', properties: {}, parameters: {} });
      expect(r.tag).toBe('err');
      if (r.tag === 'err') expect(r.error).toMatch(/step/);
    });

    it('preserves Cyrillic in property keys and values', () => {
      const j: any = {
        schemaVersion: 1, kind: 'part', exportedAt: '2026-04-30T00:00:00Z',
        source: { iptPath: 'a.ipt', fileVersion: 'Inventor 2012' },
        step: 'a.step', name: 'Бічна_панель',
        properties: { 'Назва': 'Дверцята' },
        parameters: {},
      };
      const r = parsePartJson(j);
      expect(r.tag).toBe('ok');
      if (r.tag === 'ok') expect(r.value.properties['Назва']).toBe('Дверцята');
    });
  });

  describe('parseAssemblyJson', () => {
    it('accepts a well-formed assembly JSON with one occurrence', () => {
      const j: any = {
        schemaVersion: 1, kind: 'assembly', exportedAt: '2026-04-30T00:00:00Z',
        source: { iamPath: 'a/b.iam', fileVersion: 'Inventor 2012' },
        name: 'b', properties: {}, parameters: {},
        occurrences: [
          { occurrenceName: 'P:1', ref: './P.ipt.json',
            pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
            visible: true, grounded: false },
        ],
      };
      const r = parseAssemblyJson(j);
      expect(r.tag).toBe('ok');
      if (r.tag === 'ok') expect(r.value.occurrences[0]!.ref).toBe('./P.ipt.json');
    });

    it('accepts ref: null (broken external reference)', () => {
      const j: any = {
        schemaVersion: 1, kind: 'assembly', exportedAt: '2026-04-30T00:00:00Z',
        source: { iamPath: 'a.iam', fileVersion: 'I' },
        name: 'a', properties: {}, parameters: {},
        occurrences: [
          { occurrenceName: 'P:1', ref: null,
            pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
            visible: true, grounded: false },
        ],
      };
      const r = parseAssemblyJson(j);
      expect(r.tag).toBe('ok');
    });

    it('rejects malformed pose', () => {
      const j: any = {
        schemaVersion: 1, kind: 'assembly', exportedAt: 't',
        source: { iamPath: 'x', fileVersion: 'I' }, name: 'n',
        properties: {}, parameters: {},
        occurrences: [{ occurrenceName: 'X', ref: './a', pose: { translation: { x: 0 }, quaternion: [0, 0, 0] }, visible: true, grounded: false }],
      };
      const r = parseAssemblyJson(j);
      expect(r.tag).toBe('err');
    });
  });
});
```

Create fixture `packages/app/src/import/__tests__/fixtures/part-simple.ipt.json`:

```json
{
  "schemaVersion": 1,
  "kind": "part",
  "exportedAt": "2026-04-30T00:00:00Z",
  "source": { "iptPath": "SidePanel.ipt", "fileVersion": "Inventor 2012" },
  "step": "SidePanel.step",
  "name": "SidePanel",
  "properties": { "partNumber": "Z-1", "description": "Side panel", "material": "Plywood 18mm" },
  "parameters": { "Width": { "value": 600, "unit": "mm", "expression": "600 mm" } }
}
```

Create fixture `packages/app/src/import/__tests__/fixtures/asm-simple.iam.json`:

```json
{
  "schemaVersion": 1,
  "kind": "assembly",
  "exportedAt": "2026-04-30T00:00:00Z",
  "source": { "iamPath": "Cabinet.iam", "fileVersion": "Inventor 2012" },
  "name": "Cabinet",
  "properties": {},
  "parameters": {},
  "occurrences": [
    { "occurrenceName": "SidePanel:1", "ref": "./SidePanel.ipt.json",
      "pose": { "translation": { "x": 0, "y": 0, "z": 0 }, "quaternion": [0, 0, 0, 1] },
      "visible": true, "grounded": false }
  ]
}
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @zilventor/app test inventorJsonSchema`

- [ ] **Step 3: Implement** `packages/app/src/import/inventorJsonSchema.ts`:

```ts
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
  if (pose.tag !== 'ok') return pose;
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
  if (props.tag !== 'ok') return props;
  const params = parseParameters(input.parameters, 'part JSON');
  if (params.tag !== 'ok') return params;
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
  if (props.tag !== 'ok') return props;
  const params = parseParameters(input.parameters, 'asm JSON');
  if (params.tag !== 'ok') return params;
  if (!Array.isArray(input.occurrences)) return err('asm JSON: occurrences must be array');
  const occs: ImporterOccurrence[] = [];
  for (let i = 0; i < input.occurrences.length; i++) {
    const o = parseOccurrence(input.occurrences[i], i);
    if (o.tag !== 'ok') return o;
    occs.push(o.value);
  }
  return ok({
    schemaVersion: 1, kind: 'assembly', exportedAt: input.exportedAt,
    source: { iamPath: input.source.iamPath, fileVersion: input.source.fileVersion },
    name: input.name, properties: props.value, parameters: params.value, occurrences: occs,
  });
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/import/inventorJsonSchema.ts packages/app/src/import/__tests__/
git commit -m "$(cat <<'EOF'
feat(app): T10 inventorJsonSchema validators for part + assembly JSON

Hand-rolled Result-typed validators (no zod dep) that turn untrusted
JSON into ImporterPartJson / ImporterAssemblyJson. Tested with
fixtures including Cyrillic property keys and broken-ref (ref:null)
occurrences.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: `poseDecode` — pose JSON → ComponentInstance.pose

**Files:**
- Create: `packages/app/src/import/poseDecode.ts`
- Test: `packages/app/src/import/__tests__/poseDecode.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/import/__tests__/poseDecode.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodePose } from '../poseDecode';
import type { ImporterPose } from '../inventorJsonSchema';

describe('decodePose', () => {
  it('identity pose round-trips', () => {
    const p: ImporterPose = { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] };
    const out = decodePose(p);
    expect(out.translation).toEqual({ x: 0, y: 0, z: 0 });
    expect(out.quaternion).toEqual([0, 0, 0, 1]);
  });

  it('preserves translation', () => {
    const p: ImporterPose = { translation: { x: 12.5, y: -3, z: 7 }, quaternion: [0, 0, 0, 1] };
    const out = decodePose(p);
    expect(out.translation).toEqual({ x: 12.5, y: -3, z: 7 });
  });

  it('normalizes a denormalized quaternion', () => {
    // (2, 0, 0, 0) is the unnormalized i axis — should normalize to (1, 0, 0, 0)
    const p: ImporterPose = { translation: { x: 0, y: 0, z: 0 }, quaternion: [2, 0, 0, 0] };
    const out = decodePose(p);
    expect(out.quaternion[0]).toBeCloseTo(1, 8);
    expect(out.quaternion[3]).toBeCloseTo(0, 8);
  });

  it('throws on zero-length quaternion (cannot normalize)', () => {
    const p: ImporterPose = { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 0] };
    expect(() => decodePose(p)).toThrow(/quaternion/i);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `packages/app/src/import/poseDecode.ts`:

```ts
import type { Vec3 } from '@zilventor/shared';
import type { ImporterPose } from './inventorJsonSchema';

export type DecodedPose = {
  translation: Vec3;
  quaternion: [number, number, number, number];
};

export function decodePose(p: ImporterPose): DecodedPose {
  const [x, y, z, w] = p.quaternion;
  const len = Math.hypot(x, y, z, w);
  if (len < 1e-12) {
    throw new Error(`decodePose: zero-length quaternion ${JSON.stringify(p.quaternion)}`);
  }
  return {
    translation: { x: p.translation.x, y: p.translation.y, z: p.translation.z },
    quaternion: [x / len, y / len, z / len, w / len],
  };
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/import/poseDecode.ts packages/app/src/import/__tests__/poseDecode.spec.ts
git commit -m "feat(app): T11 decodePose normalizes quaternion + preserves translation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: `resolveOutputPaths` — input rel path → OPFS path with collision rename

**Files:**
- Create: `packages/app/src/import/resolveOutputPaths.ts`
- Test: `packages/app/src/import/__tests__/resolveOutputPaths.spec.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { mapInputPathToOpfs, MapPathError } from '../resolveOutputPaths';

describe('mapInputPathToOpfs', () => {
  it('part: a/b.ipt.json → a/b.zipt', () => {
    const r = mapInputPathToOpfs('a/b.ipt.json');
    expect(r).toEqual({ tag: 'ok', path: 'a/b.zipt' });
  });
  it('asm: a/b.iam.json → a/b.ziasm', () => {
    const r = mapInputPathToOpfs('a/b.iam.json');
    expect(r).toEqual({ tag: 'ok', path: 'a/b.ziasm' });
  });
  it('preserves nested folders', () => {
    expect(mapInputPathToOpfs('Cabinet/Door/Hinge.ipt.json')).toEqual({ tag: 'ok', path: 'Cabinet/Door/Hinge.zipt' });
  });
  it('preserves _external/ prefix', () => {
    expect(mapInputPathToOpfs('_external/Hardware/Hinge.ipt.json')).toEqual({ tag: 'ok', path: '_external/Hardware/Hinge.zipt' });
  });
  it('rejects .. path segments', () => {
    const r = mapInputPathToOpfs('../leak.ipt.json');
    expect(r.tag).toBe('err');
  });
  it('rejects absolute paths', () => {
    const r = mapInputPathToOpfs('/abs/x.ipt.json');
    expect(r.tag).toBe('err');
  });
  it('rejects non-importer extensions', () => {
    const r = mapInputPathToOpfs('a/b.json');
    expect(r.tag).toBe('err');
    if (r.tag === 'err') expect(r.error).toMatch(/extension/);
  });
});
```

- [ ] **Step 2: Implement**:

```ts
import type { Result } from '@zilventor/shared';
import { ok, err } from '@zilventor/shared';

export type MapPathError = string;

export function mapInputPathToOpfs(inputRelPath: string): Result<{ path: string }, MapPathError> {
  if (inputRelPath.startsWith('/')) return err(`absolute paths not allowed: ${inputRelPath}`);
  const segments = inputRelPath.split('/');
  if (segments.some((s) => s === '..' || s === '.')) return err(`. or .. segments not allowed: ${inputRelPath}`);

  let outName: string;
  if (inputRelPath.endsWith('.ipt.json')) {
    outName = inputRelPath.slice(0, -'.ipt.json'.length) + '.zipt';
  } else if (inputRelPath.endsWith('.iam.json')) {
    outName = inputRelPath.slice(0, -'.iam.json'.length) + '.ziasm';
  } else {
    return err(`unsupported extension (must be .ipt.json or .iam.json): ${inputRelPath}`);
  }
  return ok({ path: outName });
}

/** Returns a unique sibling path by appending __<hash> to the basename. */
export function avoidCollision(target: string, exists: (p: string) => boolean): string {
  if (!exists(target)) return target;
  const lastDot = target.lastIndexOf('.');
  const stem = lastDot >= 0 ? target.slice(0, lastDot) : target;
  const ext = lastDot >= 0 ? target.slice(lastDot) : '';
  for (let i = 0; i < 100; i++) {
    const hash = Math.random().toString(36).slice(2, 6);
    const candidate = `${stem}__${hash}${ext}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error(`avoidCollision: failed to find unique path after 100 attempts (${target})`);
}
```

- [ ] **Step 3: Run, expect PASS. Commit.**

```bash
git add packages/app/src/import/resolveOutputPaths.ts packages/app/src/import/__tests__/resolveOutputPaths.spec.ts
git commit -m "feat(app): T12 mapInputPathToOpfs + avoidCollision

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: `dependencyGraph` — build, cycle detect, topo sort, missing-ref check

**Files:**
- Create: `packages/app/src/import/dependencyGraph.ts`
- Test: `packages/app/src/import/__tests__/dependencyGraph.spec.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildDependencyGraph, type GraphNode } from '../dependencyGraph';

function node(path: string, kind: 'part' | 'assembly', refs: string[] = []): GraphNode {
  return { inputRelPath: path, kind, refs };
}

describe('buildDependencyGraph', () => {
  it('returns parts in topo order before assemblies that reference them', () => {
    const nodes = [
      node('Cabinet.iam.json', 'assembly', ['Side.ipt.json', 'Back.ipt.json']),
      node('Side.ipt.json', 'part'),
      node('Back.ipt.json', 'part'),
    ];
    const r = buildDependencyGraph(nodes);
    expect(r.tag).toBe('ok');
    if (r.tag !== 'ok') return;
    const order = r.value.topoOrder.map((n) => n.inputRelPath);
    expect(order.indexOf('Side.ipt.json')).toBeLessThan(order.indexOf('Cabinet.iam.json'));
    expect(order.indexOf('Back.ipt.json')).toBeLessThan(order.indexOf('Cabinet.iam.json'));
  });

  it('handles two-level assembly hierarchy', () => {
    const nodes = [
      node('Outer.iam.json', 'assembly', ['Inner.iam.json']),
      node('Inner.iam.json', 'assembly', ['Leaf.ipt.json']),
      node('Leaf.ipt.json', 'part'),
    ];
    const r = buildDependencyGraph(nodes);
    expect(r.tag).toBe('ok');
    if (r.tag !== 'ok') return;
    const order = r.value.topoOrder.map((n) => n.inputRelPath);
    expect(order).toEqual(['Leaf.ipt.json', 'Inner.iam.json', 'Outer.iam.json']);
  });

  it('detects a cycle', () => {
    const nodes = [
      node('A.iam.json', 'assembly', ['B.iam.json']),
      node('B.iam.json', 'assembly', ['A.iam.json']),
    ];
    const r = buildDependencyGraph(nodes);
    expect(r.tag).toBe('err');
    if (r.tag === 'err') expect(r.error).toMatch(/cycle/i);
  });

  it('detects a missing ref', () => {
    const nodes = [node('A.iam.json', 'assembly', ['Missing.ipt.json'])];
    const r = buildDependencyGraph(nodes);
    expect(r.tag).toBe('err');
    if (r.tag === 'err') expect(r.error).toMatch(/Missing\.ipt\.json/);
  });

  it('ignores null refs (broken external) without error', () => {
    const nodes = [node('A.iam.json', 'assembly', [])];  // null refs collapsed at parse stage; test the case where they're filtered out
    const r = buildDependencyGraph(nodes);
    expect(r.tag).toBe('ok');
  });
});
```

- [ ] **Step 2: Implement** `packages/app/src/import/dependencyGraph.ts`:

```ts
import type { Result } from '@zilventor/shared';
import { ok, err } from '@zilventor/shared';

export type GraphNode = {
  inputRelPath: string;          // e.g. 'Cabinet/Cabinet.iam.json'
  kind: 'part' | 'assembly';
  /** Resolved sibling-relative refs from this node, with null refs filtered out
   *  by the caller. Each ref is an inputRelPath that must also appear in the
   *  nodes array. */
  refs: string[];
};

export type DependencyGraph = {
  topoOrder: GraphNode[];
};

export function buildDependencyGraph(nodes: GraphNode[]): Result<DependencyGraph, string> {
  const byPath = new Map<string, GraphNode>();
  for (const n of nodes) byPath.set(n.inputRelPath, n);

  // Validate refs all exist
  for (const n of nodes) {
    for (const r of n.refs) {
      if (!byPath.has(r)) {
        return err(`${n.inputRelPath}: missing referenced file ${r}`);
      }
    }
  }

  // Topo sort with cycle detection (DFS, post-order push)
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const n of nodes) color.set(n.inputRelPath, WHITE);
  const order: GraphNode[] = [];
  const stack: { path: string; iter: number }[] = [];

  function dfs(start: string): string | null {
    stack.push({ path: start, iter: 0 });
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const node = byPath.get(top.path)!;
      if (top.iter === 0) {
        if (color.get(top.path) === GREY) {
          // walking the path of greys gives the cycle
          const cycle = stack.map((s) => s.path).join(' → ');
          return `cycle detected: ${cycle}`;
        }
        if (color.get(top.path) === BLACK) { stack.pop(); continue; }
        color.set(top.path, GREY);
      }
      if (top.iter < node.refs.length) {
        const next = node.refs[top.iter]!;
        top.iter++;
        if (color.get(next) === GREY) {
          return `cycle detected: ${[...stack.map((s) => s.path), next].join(' → ')}`;
        }
        if (color.get(next) === WHITE) {
          stack.push({ path: next, iter: 0 });
        }
      } else {
        color.set(top.path, BLACK);
        order.push(node);
        stack.pop();
      }
    }
    return null;
  }

  for (const n of nodes) {
    if (color.get(n.inputRelPath) === WHITE) {
      const e = dfs(n.inputRelPath);
      if (e) return err(e);
    }
  }

  return ok({ topoOrder: order });
}
```

- [ ] **Step 3: Run, expect PASS. Commit.**

```bash
git add packages/app/src/import/dependencyGraph.ts packages/app/src/import/__tests__/dependencyGraph.spec.ts
git commit -m "feat(app): T13 buildDependencyGraph with cycle + missing-ref detection

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: `buildPartDocument` — partJson + import result → v9 PartDocument

**Files:**
- Create: `packages/app/src/import/buildPartDocument.ts`
- Test: `packages/app/src/import/__tests__/buildPartDocument.spec.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildPartDocument } from '../buildPartDocument';
import type { ImporterPartJson } from '../inventorJsonSchema';

const basePart: ImporterPartJson = {
  schemaVersion: 1, kind: 'part', exportedAt: 't',
  source: { iptPath: 'a/b.ipt', fileVersion: 'I' },
  step: 'b.step', name: 'b',
  properties: { partNumber: 'X-1', description: 'd', mass: 1.5 },
  parameters: {
    Width: { value: 600, unit: 'mm', expression: '600 mm' },
    Angle: { value: 45, unit: 'deg', expression: '45 deg' },
  },
};
const importResult = { brepBlobId: 'imp-123', triangleCount: 12, boundingBox: [0, 0, 0, 10, 10, 10] as const, faceCount: 6 };

describe('buildPartDocument', () => {
  it('produces a v9 PartDocument with one ImportedFeature plus origin features', () => {
    const doc = buildPartDocument({ partJson: basePart, importResult, partId: 'p-1', importedFeatureId: 'imp-1' });
    expect(doc.id).toBe('p-1');
    expect(doc.name).toBe('b');
    expect(doc.units).toBe('mm');
    expect(doc.properties).toEqual({ partNumber: 'X-1', description: 'd', mass: 1.5 });
    const nonOrigin = doc.featureTree.filter((f) => !(typeof f.id === 'string' && f.id.startsWith('origin.')));
    expect(nonOrigin).toEqual([
      { kind: 'imported', id: 'imp-1', sourceStep: 'b.step', bodyRef: 'imp-123' },
    ]);
  });

  it('falls back to filename basename for name when properties.partNumber missing AND name is empty', () => {
    const j: ImporterPartJson = { ...basePart, name: '', properties: {} };
    const doc = buildPartDocument({ partJson: j, importResult, partId: 'p-2', importedFeatureId: 'imp-2' });
    expect(doc.name).toBe('b');  // from step filename basename
  });

  it('maps mm/deg/rad/unitless units to ZilInventor SketchParameter unit kinds', () => {
    const doc = buildPartDocument({ partJson: basePart, importResult, partId: 'p-3', importedFeatureId: 'imp-3' });
    expect(doc.parameters.Width).toMatchObject({ unit: 'mm', value: 600 });
    expect(doc.parameters.Angle).toMatchObject({ unit: 'deg', value: 45 });
  });
});
```

- [ ] **Step 2: Implement** `packages/app/src/import/buildPartDocument.ts`:

```ts
import type { PartDocument, ImportedFeature, SketchParameter } from '@zilventor/shared';
import type { ImporterPartJson, ImporterParameter } from './inventorJsonSchema';

/** Origin features injected by the file-format loader; we replicate them here
 *  so the constructed document is normalised before it ever hits OPFS. */
const ORIGIN_FEATURES = [
  { kind: 'workAxis' as const, id: 'origin.X', visible: false, source: { mode: 'origin' as const, axis: 'X' as const } },
  { kind: 'workAxis' as const, id: 'origin.Y', visible: false, source: { mode: 'origin' as const, axis: 'Y' as const } },
  { kind: 'workAxis' as const, id: 'origin.Z', visible: false, source: { mode: 'origin' as const, axis: 'Z' as const } },
  { kind: 'workPlane' as const, id: 'origin.XY', visible: false, source: { mode: 'origin' as const, plane: 'XY' as const } },
  { kind: 'workPlane' as const, id: 'origin.YZ', visible: false, source: { mode: 'origin' as const, plane: 'YZ' as const } },
  { kind: 'workPlane' as const, id: 'origin.XZ', visible: false, source: { mode: 'origin' as const, plane: 'XZ' as const } },
  { kind: 'workPoint' as const, id: 'origin.O', visible: false, source: { mode: 'origin' as const } },
];

export type BuildPartArgs = {
  partJson: ImporterPartJson;
  importResult: { brepBlobId: string; triangleCount: number; boundingBox: readonly [number, number, number, number, number, number]; faceCount: number };
  partId: string;
  importedFeatureId: string;
};

function stepFilenameBasename(stepRef: string): string {
  const base = stepRef.split('/').pop() ?? stepRef;
  return base.replace(/\.step$/i, '');
}

function toSketchParameter(name: string, p: ImporterParameter): SketchParameter {
  return {
    name,
    expression: p.expression,
    unit: p.unit,
    value: p.value,
  };
}

export function buildPartDocument(args: BuildPartArgs): PartDocument {
  const { partJson, importResult, partId, importedFeatureId } = args;
  const importedFeature: ImportedFeature = {
    kind: 'imported',
    id: importedFeatureId,
    sourceStep: partJson.step,
    bodyRef: importResult.brepBlobId,
  };
  const parameters: Record<string, SketchParameter> = {};
  for (const [k, v] of Object.entries(partJson.parameters)) {
    parameters[k] = toSketchParameter(k, v);
  }
  const name = partJson.name?.length ? partJson.name : stepFilenameBasename(partJson.step);
  return {
    id: partId,
    name,
    units: 'mm',
    parameters,
    featureTree: [...ORIGIN_FEATURES, importedFeature],
    properties: { ...partJson.properties },
  };
}
```

- [ ] **Step 3: Run, expect PASS. Commit.**

```bash
git add packages/app/src/import/buildPartDocument.ts packages/app/src/import/__tests__/buildPartDocument.spec.ts
git commit -m "feat(app): T14 buildPartDocument — partJson + importStep result → v9 PartDocument

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: `buildAssemblyDocument` — asmJson + ref-resolution map → v9 AssemblyDocument

**Files:**
- Create: `packages/app/src/import/buildAssemblyDocument.ts`
- Test: `packages/app/src/import/__tests__/buildAssemblyDocument.spec.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildAssemblyDocument } from '../buildAssemblyDocument';
import type { ImporterAssemblyJson } from '../inventorJsonSchema';
import { pathKey } from '@zilventor/shared';

const asm: ImporterAssemblyJson = {
  schemaVersion: 1, kind: 'assembly', exportedAt: 't',
  source: { iamPath: 'Cabinet.iam', fileVersion: 'I' },
  name: 'Cabinet', properties: { partNumber: 'C-1' }, parameters: {},
  occurrences: [
    { occurrenceName: 'Side:1', ref: './Side.ipt.json',
      pose: { translation: { x: 1, y: 2, z: 3 }, quaternion: [0, 0, 0, 1] },
      visible: true, grounded: true },
    { occurrenceName: 'Side:2', ref: './Side.ipt.json',
      pose: { translation: { x: 10, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
      color: { hex: '#ff0000' }, visible: true, grounded: false },
    { occurrenceName: 'Brkn:1', ref: null,
      pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
      visible: true, grounded: false },
  ],
};
const refResolution = new Map<string, string>([['./Side.ipt.json', 'Cabinet/Side.zipt']]);

describe('buildAssemblyDocument', () => {
  it('produces v9 AssemblyDocument with components for refs that resolve', () => {
    const doc = buildAssemblyDocument({ asmJson: asm, refResolution, asmId: 'a-1' });
    expect(doc.components.length).toBe(3);
    expect(doc.components[0]!.partPath).toBe('Cabinet/Side.zipt');
    expect(doc.components[0]!.pose).toBeDefined();
    expect(doc.components[0]!.pose!.translation).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('keeps null-ref occurrences with a sentinel partPath that 4d renders as missing', () => {
    const doc = buildAssemblyDocument({ asmJson: asm, refResolution, asmId: 'a-1' });
    const broken = doc.components.find((c) => c.id.startsWith('Brkn'));
    expect(broken?.partPath).toBe('');
  });

  it('grounded flag → groundedComponentPaths', () => {
    const doc = buildAssemblyDocument({ asmJson: asm, refResolution, asmId: 'a-1' });
    const groundedIds = doc.groundedComponentPaths.map((p) => p[0]);
    expect(groundedIds).toEqual([doc.components[0]!.id]);
  });

  it('color → colorOverrides keyed by pathKey([occId])', () => {
    const doc = buildAssemblyDocument({ asmJson: asm, refResolution, asmId: 'a-1' });
    const k = pathKey([doc.components[1]!.id]);
    expect(doc.colorOverrides[k]).toEqual({ kind: 'hex', hex: '#ff0000' });
  });

  it('constraints array is empty', () => {
    const doc = buildAssemblyDocument({ asmJson: asm, refResolution, asmId: 'a-1' });
    expect(doc.constraints).toEqual([]);
  });

  it('properties bag preserved on document', () => {
    const doc = buildAssemblyDocument({ asmJson: asm, refResolution, asmId: 'a-1' });
    expect(doc.properties).toEqual({ partNumber: 'C-1' });
  });
});
```

- [ ] **Step 2: Implement** `packages/app/src/import/buildAssemblyDocument.ts`:

```ts
import type { AssemblyDocument, ComponentInstance, ComponentPath, ComponentColor, SketchParameter } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import type { ImporterAssemblyJson, ImporterParameter } from './inventorJsonSchema';
import { decodePose } from './poseDecode';

export type BuildAssemblyArgs = {
  asmJson: ImporterAssemblyJson;
  /** Map from sibling-relative ref (e.g. './Side.ipt.json') to OPFS path
   *  (e.g. 'Cabinet/Side.zipt'). Refs not in this map are treated as broken
   *  (sentinel '' partPath, 4d's missing-part placeholder renders them). */
  refResolution: Map<string, string>;
  asmId: string;
};

function sanitizeOccurrenceId(name: string): string {
  // Inventor occurrence names are like 'SidePanel:1'; ZilInventor component
  // ids must be a valid file-path-safe string. Slugify lightly.
  return name.replace(/[\\/:*?"<>|\u0000]/g, '_');
}

function toSketchParameter(name: string, p: ImporterParameter): SketchParameter {
  return { name, expression: p.expression, unit: p.unit, value: p.value };
}

export function buildAssemblyDocument(args: BuildAssemblyArgs): AssemblyDocument {
  const { asmJson, refResolution, asmId } = args;
  const components: ComponentInstance[] = [];
  const colorOverrides: Record<string, ComponentColor> = {};
  const groundedPaths: ComponentPath[] = [];

  for (const occ of asmJson.occurrences) {
    const id = sanitizeOccurrenceId(occ.occurrenceName);
    const partPath = occ.ref == null ? '' : (refResolution.get(occ.ref) ?? '');
    const decoded = decodePose(occ.pose);
    const inst: ComponentInstance = {
      id,
      partPath,
      position: decoded.translation,
      rotation: { rx: 0, ry: 0, rz: 0 },  // unused once `pose` is set; backfill is kept for legacy paths
      visible: occ.visible,
      pose: { translation: decoded.translation, quaternion: decoded.quaternion },
      ...(occ.color ? { color: { kind: 'hex' as const, hex: occ.color.hex } } : {}),
    };
    components.push(inst);
    if (occ.grounded) groundedPaths.push([id]);
    if (occ.color) colorOverrides[pathKey([id])] = { kind: 'hex', hex: occ.color.hex };
  }

  const parameters: Record<string, SketchParameter> = {};
  for (const [k, v] of Object.entries(asmJson.parameters)) parameters[k] = toSketchParameter(k, v);

  return {
    id: asmId,
    name: asmJson.name,
    units: 'mm',
    parameters,
    components,
    constraints: [],
    groundedComponentPaths: groundedPaths,
    colors: {},
    bomItemNumbers: {},
    colorOverrides,
    properties: { ...asmJson.properties },
  };
}
```

- [ ] **Step 3: Run, expect PASS. Commit.**

```bash
git add packages/app/src/import/buildAssemblyDocument.ts packages/app/src/import/__tests__/buildAssemblyDocument.spec.ts
git commit -m "feat(app): T15 buildAssemblyDocument — asmJson + ref map → v9 AssemblyDocument

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

**Phase 3 verification gate:**

```bash
pnpm -r typecheck && pnpm -r test:unit
```

All green before Phase 4.

---

## Phase 4 — Importer orchestrator + UI

### Task 16: `InventorImporter` orchestrator

**Files:**
- Create: `packages/app/src/import/InventorImporter.ts`
- Test: `packages/app/src/import/__tests__/InventorImporter.spec.ts`

- [ ] **Step 1: Failing test** (uses an in-memory FS handle stub plus a stub kernel client)

```ts
import { describe, expect, it, vi } from 'vitest';
import { runInventorImport } from '../InventorImporter';

/** Minimal in-memory directory handle that satisfies the subset of FileSystemDirectoryHandle the importer uses. */
function makeDir(entries: Record<string, Uint8Array | Record<string, unknown>>): any {
  return {
    kind: 'directory',
    async *entries() {
      for (const [name, val] of Object.entries(entries)) {
        if (val instanceof Uint8Array) {
          yield [name, { kind: 'file', name, getFile: async () => ({ arrayBuffer: async () => val.buffer.slice(val.byteOffset, val.byteOffset + val.byteLength) }) }];
        } else {
          yield [name, makeDir(val as any)];
        }
      }
    },
    async getDirectoryHandle(name: string) { return makeDir(entries[name] as any); },
  };
}

function utf8(s: string): Uint8Array { return new TextEncoder().encode(s); }

describe('runInventorImport — single part', () => {
  it('imports one part: parses JSON, calls kernel.importStep, packs .zipt, writes to OPFS target', async () => {
    const stepBytes = new Uint8Array([1, 2, 3, 4]);
    const partJson = utf8(JSON.stringify({
      schemaVersion: 1, kind: 'part', exportedAt: 't',
      source: { iptPath: 'P.ipt', fileVersion: 'I' },
      step: 'P.step', name: 'P', properties: { partNumber: 'X' }, parameters: {},
    }));
    const inputDir = makeDir({ 'P.ipt.json': partJson, 'P.step': stepBytes });
    const writes = new Map<string, Uint8Array>();
    const targetDir = {
      kind: 'directory' as const,
      async getFileHandle(name: string, opts: { create?: boolean }) {
        return {
          kind: 'file' as const, name,
          async createWritable() {
            const chunks: Uint8Array[] = [];
            return {
              async write(data: Uint8Array | { type: string; data?: Uint8Array }) {
                if (data instanceof Uint8Array) chunks.push(data);
                else if ((data as any).data) chunks.push((data as any).data);
              },
              async close() {
                const total = chunks.reduce((a, c) => a + c.byteLength, 0);
                const merged = new Uint8Array(total);
                let off = 0; for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
                writes.set(name, merged);
              },
            };
          },
        };
      },
      async getDirectoryHandle(name: string, opts: { create?: boolean }) {
        return targetDir; // flat for this stub
      },
      async exists(_p: string) { return false; },
    } as any;

    const kernel = {
      async importStep({ stepBytes }: { stepBytes: ArrayBuffer; partName: string }) {
        return { brepBlobId: 'imp-x', triangleCount: 12, boundingBox: [0, 0, 0, 1, 1, 1] as const, faceCount: 6 };
      },
      async createPart(_n: string) { return 'p-1'; },
      async addFeature(_pid: string, _f: unknown) {},
      async saveToBytes(_pid: string) { return new Uint8Array([0xAA, 0xBB]); },
      async deletePart(_pid: string) {},
    } as any;

    const summary = await runInventorImport({
      input: inputDir, target: targetDir, conflict: 'overwrite', kernel,
    });
    expect(summary.partsImported).toBe(1);
    expect(summary.assembliesImported).toBe(0);
    expect(summary.errors).toHaveLength(0);
    expect(writes.has('P.zipt')).toBe(true);
    expect(writes.get('P.zipt')).toEqual(new Uint8Array([0xAA, 0xBB]));
  });
});
```

- [ ] **Step 2: Implement** `packages/app/src/import/InventorImporter.ts`

```ts
import { parsePartJson, parseAssemblyJson } from './inventorJsonSchema';
import { mapInputPathToOpfs, avoidCollision } from './resolveOutputPaths';
import { buildDependencyGraph, type GraphNode } from './dependencyGraph';
import { buildPartDocument } from './buildPartDocument';
import { buildAssemblyDocument } from './buildAssemblyDocument';
import type { Result } from '@zilventor/shared';

export type ImportConflict = 'overwrite' | 'skip' | 'cancel-on-conflict';

export type ImportSummary = {
  partsImported: number;
  assembliesImported: number;
  skipped: number;
  errors: { path: string; error: string }[];
};

export type RunImportArgs = {
  input: FileSystemDirectoryHandle;
  target: FileSystemDirectoryHandle;
  conflict: ImportConflict;
  kernel: {
    importStep(p: { stepBytes: ArrayBuffer; partName: string }): Promise<{ brepBlobId: string; triangleCount: number; boundingBox: readonly [number, number, number, number, number, number]; faceCount: number }>;
    createPart(n: string): Promise<string>;
    addFeature(partId: string, f: import('@zilventor/shared').Feature): Promise<void>;
    saveToBytes(partId: string): Promise<Uint8Array>;
    deletePart(partId: string): Promise<void>;
  };
  /** Optional progress callback for the dialog UI. */
  onProgress?: (p: { current: number; total: number; path: string }) => void;
  /** Optional cancellation signal. */
  signal?: AbortSignal;
};

type DiscoveredFile =
  | { kind: 'part'; relPath: string; bytesJson: Uint8Array; bytesStep: Uint8Array }
  | { kind: 'assembly'; relPath: string; bytesJson: Uint8Array };

async function walkDir(dir: FileSystemDirectoryHandle, prefix = ''): Promise<DiscoveredFile[]> {
  const out: DiscoveredFile[] = [];
  const stepBytesByDir = new Map<string, Map<string, Uint8Array>>(); // dirPrefix → name → bytes
  const partJsonsByDir = new Map<string, { name: string; bytes: Uint8Array }[]>();
  const asmJsonsByDir = new Map<string, { name: string; bytes: Uint8Array }[]>();

  async function recurse(d: FileSystemDirectoryHandle, p: string): Promise<void> {
    for await (const [name, handle] of (d as any).entries()) {
      const rel = p ? `${p}/${name}` : name;
      if (handle.kind === 'directory') {
        await recurse(handle as FileSystemDirectoryHandle, rel);
      } else {
        const file = await (handle as FileSystemFileHandle).getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (name.endsWith('.ipt.json')) {
          const arr = partJsonsByDir.get(p) ?? [];
          arr.push({ name, bytes });
          partJsonsByDir.set(p, arr);
        } else if (name.endsWith('.iam.json')) {
          const arr = asmJsonsByDir.get(p) ?? [];
          arr.push({ name, bytes });
          asmJsonsByDir.set(p, arr);
        } else if (name.endsWith('.step')) {
          const m = stepBytesByDir.get(p) ?? new Map<string, Uint8Array>();
          m.set(name, bytes);
          stepBytesByDir.set(p, m);
        }
      }
    }
  }
  await recurse(dir, prefix);

  for (const [p, arr] of partJsonsByDir) {
    const stepMap = stepBytesByDir.get(p) ?? new Map();
    for (const { name, bytes } of arr) {
      const stem = name.slice(0, -'.ipt.json'.length);
      const stepName = `${stem}.step`;
      const stepBytes = stepMap.get(stepName);
      if (!stepBytes) continue; // missing step is reported as error during processing
      out.push({ kind: 'part', relPath: p ? `${p}/${name}` : name, bytesJson: bytes, bytesStep: stepBytes });
    }
  }
  for (const [p, arr] of asmJsonsByDir) {
    for (const { name, bytes } of arr) {
      out.push({ kind: 'assembly', relPath: p ? `${p}/${name}` : name, bytesJson: bytes });
    }
  }
  return out;
}

async function getOrCreateDir(root: FileSystemDirectoryHandle, segments: string[]): Promise<FileSystemDirectoryHandle> {
  let cur = root;
  for (const s of segments) cur = await cur.getDirectoryHandle(s, { create: true });
  return cur;
}

async function writeBytes(dir: FileSystemDirectoryHandle, name: string, bytes: Uint8Array): Promise<void> {
  const h = await dir.getFileHandle(name, { create: true });
  const w = await (h as any).createWritable();
  await w.write(bytes);
  await w.close();
}

async function fileExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try { await dir.getFileHandle(name, { create: false }); return true; }
  catch { return false; }
}

function siblingResolve(asmRelPath: string, ref: string): string {
  if (!ref.startsWith('./')) throw new Error(`refs must be sibling-relative (./<name>): ${ref}`);
  const dir = asmRelPath.split('/').slice(0, -1).join('/');
  const refName = ref.slice(2);
  return dir ? `${dir}/${refName}` : refName;
}

export async function runInventorImport(args: RunImportArgs): Promise<ImportSummary> {
  const summary: ImportSummary = { partsImported: 0, assembliesImported: 0, skipped: 0, errors: [] };
  const discovered = await walkDir(args.input);

  // Build dependency graph
  const parsedAssemblies = new Map<string, ReturnType<typeof parseAssemblyJson>>();
  const graphNodes: GraphNode[] = [];
  for (const d of discovered) {
    if (d.kind === 'part') {
      graphNodes.push({ inputRelPath: d.relPath, kind: 'part', refs: [] });
    } else {
      const parsed = parseAssemblyJson(JSON.parse(new TextDecoder().decode(d.bytesJson)));
      parsedAssemblies.set(d.relPath, parsed);
      const refs: string[] = [];
      if (parsed.tag === 'ok') {
        for (const occ of parsed.value.occurrences) {
          if (occ.ref) refs.push(siblingResolve(d.relPath, occ.ref));
        }
      }
      graphNodes.push({ inputRelPath: d.relPath, kind: 'assembly', refs });
    }
  }
  const graph = buildDependencyGraph(graphNodes);
  if (graph.tag !== 'ok') {
    throw new Error(`Import aborted: ${graph.error}`);
  }

  // OPFS path map: input relPath → OPFS relPath
  const opfsPathByInput = new Map<string, string>();
  for (const node of graph.value.topoOrder) {
    const r = mapInputPathToOpfs(node.inputRelPath);
    if (r.tag !== 'ok') {
      summary.errors.push({ path: node.inputRelPath, error: r.error });
      continue;
    }
    opfsPathByInput.set(node.inputRelPath, r.value.path);
  }

  // Process in topo order
  const partBytesByRelPath = new Map<string, Uint8Array>();
  for (const d of discovered) if (d.kind === 'part') partBytesByRelPath.set(d.relPath, d.bytesStep);

  let i = 0;
  for (const node of graph.value.topoOrder) {
    if (args.signal?.aborted) break;
    i++;
    args.onProgress?.({ current: i, total: graph.value.topoOrder.length, path: node.inputRelPath });
    const opfsPath = opfsPathByInput.get(node.inputRelPath);
    if (!opfsPath) continue;
    const segs = opfsPath.split('/');
    const fileName = segs.pop()!;
    const dir = await getOrCreateDir(args.target, segs);

    if (await fileExists(dir, fileName)) {
      if (args.conflict === 'skip') { summary.skipped++; continue; }
      if (args.conflict === 'cancel-on-conflict') {
        summary.errors.push({ path: node.inputRelPath, error: `target already exists: ${opfsPath}` });
        return summary;
      }
      // overwrite: fall through
    }

    if (node.kind === 'part') {
      try {
        const partJsonRaw = discovered.find((d) => d.kind === 'part' && d.relPath === node.inputRelPath)!;
        if (partJsonRaw.kind !== 'part') throw new Error('unreachable');
        const parsed = parsePartJson(JSON.parse(new TextDecoder().decode(partJsonRaw.bytesJson)));
        if (parsed.tag !== 'ok') throw new Error(parsed.error);
        const importResult = await args.kernel.importStep({ stepBytes: partJsonRaw.bytesStep.buffer.slice(partJsonRaw.bytesStep.byteOffset, partJsonRaw.bytesStep.byteOffset + partJsonRaw.bytesStep.byteLength), partName: parsed.value.name });
        const partId = await args.kernel.createPart(parsed.value.name);
        const importedFeatureId = `imp-${node.inputRelPath.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const doc = buildPartDocument({ partJson: parsed.value, importResult, partId, importedFeatureId });
        await args.kernel.addFeature(partId, { kind: 'imported', id: importedFeatureId, sourceStep: parsed.value.step, bodyRef: importResult.brepBlobId });
        // The kernel-side document is the source of truth via createPart+addFeature. saveToBytes packs it.
        const bytes = await args.kernel.saveToBytes(partId);
        await writeBytes(dir, fileName, bytes);
        await args.kernel.deletePart(partId);
        summary.partsImported++;
      } catch (e) {
        summary.errors.push({ path: node.inputRelPath, error: (e as Error).message });
      }
    } else {
      try {
        const parsed = parsedAssemblies.get(node.inputRelPath)!;
        if (parsed.tag !== 'ok') throw new Error(parsed.error);
        // refResolution: occ.ref → opfs target path
        const refResolution = new Map<string, string>();
        for (const occ of parsed.value.occurrences) {
          if (!occ.ref) continue;
          const refRel = siblingResolve(node.inputRelPath, occ.ref);
          const refOpfs = opfsPathByInput.get(refRel);
          if (refOpfs) refResolution.set(occ.ref, refOpfs);
        }
        const asmId = `asm-${node.inputRelPath.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const doc = buildAssemblyDocument({ asmJson: parsed.value, refResolution, asmId });
        // Write as v9 .ziasm via the kernel's pack path
        const manifest = { formatVersion: 9 as const, kind: 'assembly' as const, createdAt: new Date().toISOString(), appVersion: '1.5', document: doc };
        // Reuse kernel-side packer if exposed; otherwise inline-pack via packAssembly RPC
        // (For simplicity, assume the kernel also exposes a save-assembly path; if not, this task lands a small `kernel.packAssembly(doc)` RPC.)
        const bytes = await packAssemblyViaKernel(args.kernel as any, manifest);
        await writeBytes(dir, fileName, bytes);
        summary.assembliesImported++;
      } catch (e) {
        summary.errors.push({ path: node.inputRelPath, error: (e as Error).message });
      }
    }
  }

  return summary;
}

async function packAssemblyViaKernel(kernel: { packAssembly?(m: unknown): Promise<Uint8Array> }, manifest: unknown): Promise<Uint8Array> {
  if (typeof kernel.packAssembly === 'function') return kernel.packAssembly(manifest);
  // Fallback: serialize as JSON tar — implementer should expose `kernel.packAssembly` as part of T16 if missing.
  throw new Error('kernel.packAssembly not available — expose it from packages/kernel/src/api.ts (wraps storage/AssemblyPacker.ts)');
}
```

- [ ] **Step 3: If `kernel.packAssembly` doesn't exist** in `packages/kernel/src/api.ts`, add a thin RPC wrapping `packAssembly` from `packages/kernel/src/storage/AssemblyPacker.ts`. Add a unit/integration test for it.

- [ ] **Step 4: Run, expect PASS. Commit.**

```bash
git add packages/app/src/import/InventorImporter.ts packages/app/src/import/__tests__/InventorImporter.spec.ts packages/kernel/
git commit -m "$(cat <<'EOF'
feat(app): T16 InventorImporter orchestrator + kernel.packAssembly RPC

Walks an export folder, builds a JSON dependency graph, and processes
parts/assemblies in topo order. For each part: parse JSON → kernel
importStep → buildPartDocument → kernel saveToBytes → write .zipt to
OPFS. For each assembly: parse → buildAssemblyDocument → packAssembly
→ write .ziasm. Conflict policy is per-call (overwrite/skip/cancel).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: `ImportFromInventorCommand`

**Files:**
- Create: `packages/app/src/commands/ImportFromInventorCommand.ts`
- Test: `packages/app/src/commands/__tests__/ImportFromInventorCommand.spec.ts`

- [ ] **Step 1: Failing test** — exercises `apply()` with stub handles + a stub importer.

```ts
import { describe, expect, it, vi } from 'vitest';
import { ImportFromInventorCommand } from '../ImportFromInventorCommand';

describe('ImportFromInventorCommand', () => {
  it('apply() runs the importer with the picked input/target and returns the summary', async () => {
    const inputHandle = { kind: 'directory' } as any;
    const targetHandle = { kind: 'directory' } as any;
    const summary = { partsImported: 1, assembliesImported: 0, skipped: 0, errors: [] };
    const runImport = vi.fn(async () => summary);
    const cmd = new ImportFromInventorCommand({
      pickInput: async () => inputHandle,
      pickTarget: async () => targetHandle,
      conflict: 'skip',
      kernel: {} as any,
      runImport,
    });
    await cmd.apply();
    expect(runImport).toHaveBeenCalledWith(expect.objectContaining({
      input: inputHandle, target: targetHandle, conflict: 'skip',
    }));
    expect(cmd.summary).toEqual(summary);
  });

  it('apply() throws if the user cancels the input picker', async () => {
    const cmd = new ImportFromInventorCommand({
      pickInput: async () => { throw new DOMException('aborted', 'AbortError'); },
      pickTarget: async () => { throw new Error('should not be called'); },
      conflict: 'skip',
      kernel: {} as any,
      runImport: async () => ({ partsImported: 0, assembliesImported: 0, skipped: 0, errors: [] }),
    });
    await expect(cmd.apply()).rejects.toThrow(/abort|cancel/i);
  });
});
```

- [ ] **Step 2: Implement** `packages/app/src/commands/ImportFromInventorCommand.ts`:

```ts
import type { Command } from './Command';
import type { KernelClient } from '../kernel-client/KernelClient';
import { runInventorImport, type ImportSummary, type ImportConflict } from '../import/InventorImporter';

export type ImportFromInventorCtx = {
  pickInput: () => Promise<FileSystemDirectoryHandle>;
  pickTarget: () => Promise<FileSystemDirectoryHandle>;
  conflict: ImportConflict;
  kernel: KernelClient;
  /** Injectable for tests; defaults to runInventorImport. */
  runImport?: typeof runInventorImport;
  onProgress?: (p: { current: number; total: number; path: string }) => void;
};

export class ImportFromInventorCommand implements Command {
  readonly name = 'ImportFromInventor';
  summary: ImportSummary | null = null;
  constructor(private ctx: ImportFromInventorCtx) {}

  async apply(): Promise<void> {
    const input = await this.ctx.pickInput();
    const target = await this.ctx.pickTarget();
    const run = this.ctx.runImport ?? runInventorImport;
    this.summary = await run({
      input, target, conflict: this.ctx.conflict, kernel: this.ctx.kernel as any,
      ...(this.ctx.onProgress ? { onProgress: this.ctx.onProgress } : {}),
    });
  }

  async revert(): Promise<void> {
    // Import is non-undoable (writes many OPFS files). Revert is a no-op;
    // the user clears OPFS via the file manager if they want to undo.
  }
}
```

- [ ] **Step 3: Run, expect PASS. Commit.**

```bash
git add packages/app/src/commands/ImportFromInventorCommand.ts packages/app/src/commands/__tests__/ImportFromInventorCommand.spec.ts
git commit -m "feat(app): T17 ImportFromInventorCommand

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: `ImportFromInventorDialog` UI

**Files:**
- Create: `packages/app/src/shell/ImportFromInventorDialog.tsx`
- Test: `packages/app/src/shell/__tests__/ImportFromInventorDialog.spec.tsx`

- [ ] **Step 1: Failing test** — render the dialog, confirm the conflict-policy radios and cancel/import buttons are present.

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImportFromInventorDialog } from '../ImportFromInventorDialog';

describe('ImportFromInventorDialog', () => {
  it('renders the conflict radios and import/cancel buttons', () => {
    render(<ImportFromInventorDialog isOpen={true} onCancel={() => {}} onConfirm={() => {}} status={'idle'} />);
    expect(screen.getByLabelText(/overwrite/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/skip/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cancel on conflict/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('calls onConfirm with the selected conflict policy', () => {
    const onConfirm = vi.fn();
    render(<ImportFromInventorDialog isOpen={true} onCancel={() => {}} onConfirm={onConfirm} status={'idle'} />);
    fireEvent.click(screen.getByLabelText(/overwrite/i));
    fireEvent.click(screen.getByRole('button', { name: /import/i }));
    expect(onConfirm).toHaveBeenCalledWith('overwrite');
  });
});
```

- [ ] **Step 2: Implement** `packages/app/src/shell/ImportFromInventorDialog.tsx`:

```tsx
import React, { useState } from 'react';
import type { ImportConflict, ImportSummary } from '../import/InventorImporter';

export type ImportDialogStatus =
  | { kind: 'idle' } | 'idle'
  | { kind: 'scanning' } | 'scanning'
  | { kind: 'importing'; current: number; total: number; path: string }
  | { kind: 'done'; summary: ImportSummary }
  | { kind: 'error'; message: string };

export function ImportFromInventorDialog(props: {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: (conflict: ImportConflict) => void;
  status: ImportDialogStatus;
}) {
  const [conflict, setConflict] = useState<ImportConflict>('skip');
  if (!props.isOpen) return null;
  const isWorking = typeof props.status === 'object' && (props.status.kind === 'scanning' || props.status.kind === 'importing');
  const done = typeof props.status === 'object' && props.status.kind === 'done' ? props.status.summary : null;
  return (
    <div role="dialog" aria-label="Import from Inventor" className="fixed inset-0 bg-black/40 flex items-center justify-center">
      <div className="bg-neutral-900 text-neutral-100 rounded shadow-lg p-4 w-[480px]">
        <h2 className="text-sm font-semibold mb-3">Import from Inventor</h2>
        <fieldset className="mb-3">
          <legend className="text-xs mb-1">If a file already exists in the target:</legend>
          <label className="block text-xs"><input type="radio" checked={conflict === 'overwrite'} onChange={() => setConflict('overwrite')} /> Overwrite</label>
          <label className="block text-xs"><input type="radio" checked={conflict === 'skip'} onChange={() => setConflict('skip')} /> Skip existing</label>
          <label className="block text-xs"><input type="radio" checked={conflict === 'cancel-on-conflict'} onChange={() => setConflict('cancel-on-conflict')} /> Cancel on conflict</label>
        </fieldset>
        {isWorking && typeof props.status === 'object' && props.status.kind === 'importing' && (
          <div className="text-xs mb-2">Importing {props.status.current} / {props.status.total}: {props.status.path}</div>
        )}
        {done && (
          <div className="text-xs mb-2">
            Imported {done.partsImported} parts, {done.assembliesImported} assemblies. {done.errors.length} errors. {done.skipped} skipped.
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={props.onCancel} className="text-xs px-2 py-1 hover:text-white">Cancel</button>
          <button onClick={() => props.onConfirm(conflict)} disabled={isWorking} className="text-xs px-2 py-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-50">Import</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run, expect PASS. Commit.**

```bash
git add packages/app/src/shell/ImportFromInventorDialog.tsx packages/app/src/shell/__tests__/ImportFromInventorDialog.spec.tsx
git commit -m "feat(app): T18 ImportFromInventorDialog (radios + progress + summary)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: Wire the button into File tab + App.tsx

**Files:**
- Modify: `packages/app/src/shell/tabs/FileTab.tsx` — add "Import from Inventor" button in the Import group
- Modify: `packages/app/src/App.tsx` — host the dialog state + dispatch the command
- Modify: `packages/app/src/store/useAppStore.ts` — add `importFromInventorDialogOpen: boolean` slice

- [ ] **Step 1:** in `useAppStore.ts`, add the boolean state and a setter alongside existing dialog flags.

- [ ] **Step 2:** in `FileTab.tsx`, add a button:

```tsx
<button
  className="text-xs hover:text-white"
  onClick={() => useAppStore.getState().setImportFromInventorDialogOpen(true)}
>Import from Inventor</button>
```

Group it under a new "Import" `<RibbonPanel>` (or extend an existing one matching the layout convention). Reference `ModelTab.tsx` for the panel/button pattern.

- [ ] **Step 3:** in `App.tsx`, render the dialog:

```tsx
<ImportFromInventorDialog
  isOpen={importFromInventorDialogOpen}
  status={importStatus}
  onCancel={() => setImportFromInventorDialogOpen(false)}
  onConfirm={async (conflict) => {
    setImportStatus({ kind: 'scanning' });
    try {
      const cmd = new ImportFromInventorCommand({
        pickInput: async () => (await window.showDirectoryPicker({ id: 'inventor-import-input', mode: 'read' })),
        pickTarget: async () => (await window.showDirectoryPicker({ id: 'inventor-import-target', mode: 'readwrite' })),
        conflict,
        kernel: kernelClient,
        onProgress: (p) => setImportStatus({ kind: 'importing', ...p }),
      });
      await commandBus.execute(cmd);
      setImportStatus({ kind: 'done', summary: cmd.summary! });
    } catch (e) {
      setImportStatus({ kind: 'error', message: (e as Error).message });
    }
  }}
/>
```

- [ ] **Step 4: Manual smoke**: `pnpm --filter @zilventor/app dev`, click the button, point to a small test fixture folder, confirm dialog flow works end-to-end.

- [ ] **Step 5: Run typecheck + tests**

Run: `pnpm -r typecheck && pnpm -r test:unit`

- [ ] **Step 6: Commit**

```bash
git add packages/app/
git commit -m "$(cat <<'EOF'
feat(app): T19 wire \"Import from Inventor\" button into File tab

New File-tab button opens the import dialog. App.tsx hosts dialog
state, dispatches ImportFromInventorCommand on confirm. Picker IDs
are distinct so the browser remembers last-used input vs target.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — Read-only enforcement

### Task 20: Disable Model-tab buttons when active part is imported

**Files:**
- Modify: `packages/app/src/shell/tabs/ModelTab.tsx`
- Test: `packages/app/src/shell/__tests__/ModelTab.spec.tsx` (extend or create)

- [ ] **Step 1:** Failing test — render `<ModelTab>` with an active part whose `featureTree` is `[...origins, importedFeature]`, assert that every Add* button has `disabled` set, plus a tooltip `title` containing the read-only string.

- [ ] **Step 2:** In `ModelTab.tsx`, import `isImportedPart` from `@zilventor/shared` and compute:

```tsx
const readOnly = activePart ? isImportedPart(activePart) : false;
const tip = readOnly ? 'This part was imported from Inventor and is read-only. Re-author parametrically by creating a new part.' : undefined;
```

For every button, change `disabled={!hasSketch}` → `disabled={!hasSketch || readOnly}`, similarly `disabled={!activePart}` → `disabled={!activePart || readOnly}`, etc. Add `title={tip}` to each.

- [ ] **Step 3:** Run tests, expect PASS. Commit.

```bash
git add packages/app/src/shell/tabs/ModelTab.tsx packages/app/src/shell/__tests__/ModelTab.spec.tsx
git commit -m "feat(app): T20 disable Model-tab buttons on imported parts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 21: Suppress edit dialog on imported feature in BrowserPane

**Files:**
- Modify: `packages/app/src/shell/BrowserPane.tsx`
- Test: `packages/app/src/shell/__tests__/BrowserPane.spec.tsx` (extend)

- [ ] **Step 1:** Failing test — double-click on an imported feature node should not open any edit dialog. Right-click should not surface "Edit feature" / "Delete feature" entries.

- [ ] **Step 2:** In `BrowserPane.tsx`, find the feature-node double-click handler and the right-click context menu builder. For nodes with `feature.kind === 'imported'`, short-circuit: no handler invocation, no menu entries.

- [ ] **Step 3:** Run, expect PASS. Commit.

```bash
git add packages/app/src/shell/BrowserPane.tsx packages/app/src/shell/__tests__/BrowserPane.spec.tsx
git commit -m "feat(app): T21 BrowserPane suppresses edit on imported feature

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6 — BOM extraction

### Task 22: BOM aggregator surfaces `properties.partNumber` / `properties.description`

**Files:**
- Modify: `packages/shared/src/bomRow.ts` — extend `BomRow` with `partNumber?: string; description?: string`
- Modify: `packages/shared/src/bomRow.ts` — `aggregateBom` reads them from the part name source
- Modify: `packages/app/src/assembly/walkers/aggregateBomRecursive.ts`
- Modify: `packages/app/src/shell/BomTable.tsx` — display the new columns
- Test: `packages/shared/src/__tests__/bomRow.spec.ts` — extend
- Test: `packages/app/src/assembly/walkers/__tests__/aggregateBomRecursive.spec.ts` — extend
- Test: `packages/app/src/shell/__tests__/BomTable.spec.tsx` — extend

- [ ] **Step 1: Failing tests** — each aggregator returns a row with `partNumber` and `description` populated when the underlying `PartDocument.properties` has them.

The aggregators read `partNames: Map<string, string>` today. Expand that to a richer map: change the parameter type to `partInfo: Map<string, { name: string; partNumber?: string; description?: string }>` and propagate through.

Callers — in `App.tsx` or wherever `partNames` is built (search: `partNames`) — populate the new fields by reading `doc.properties.partNumber` / `doc.properties.description` from each loaded part.

- [ ] **Step 2:** Update the row construction sites:

```ts
rows.push({
  rowKey, itemNumber, qty: g.componentIds.length,
  partPath: g.partPath,
  partName: info?.name ?? '(missing part)',
  ...(info?.partNumber !== undefined ? { partNumber: info.partNumber } : {}),
  ...(info?.description !== undefined ? { description: info.description } : {}),
  color: g.color, componentIds: [...g.componentIds],
});
```

- [ ] **Step 3:** In `BomTable.tsx`, add two columns: "Part #" (`row.partNumber ?? ''`) and "Description" (`row.description ?? ''`). Place them between Item and Qty.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/bomRow.ts packages/app/src/assembly/walkers/ packages/app/src/shell/BomTable.tsx
git commit -m "$(cat <<'EOF'
feat(bom): T22 surface partNumber + description from PartDocument.properties

Extends the BOM aggregator partInfo input to carry partNumber and
description alongside name. BomTable adds two columns. Imported parts
from 1.5 surface their iProperty values in BOM without extra wiring.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7 — E2E + perf

### Task 23: E2E — single-part import

**Files:**
- Create: `tests/e2e/import/import-from-inventor.spec.ts`
- Create: `tests/e2e/fixtures/inventor-export/single-part/SidePanel.ipt.json`
- Create: `tests/e2e/fixtures/inventor-export/single-part/SidePanel.step` (committed binary; use the cube fixture from T6)

Uses the existing `__zilventor*` dev hooks plus a directory-handle shim. Pattern: drop a `__zilventorImportFromHandle(rootHandle, target, conflict)` dev-only window function that bypasses `showDirectoryPicker`.

- [ ] **Step 1:** Write the spec:

```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('import single part: cube from Inventor JSON+STEP into a .zipt', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__zilventorImportFromFiles));
  const partJson = readFileSync(resolve(__dirname, '../fixtures/inventor-export/single-part/SidePanel.ipt.json'), 'utf-8');
  const stepBytes = readFileSync(resolve(__dirname, '../fixtures/inventor-export/single-part/SidePanel.step'));
  const summary = await page.evaluate(async ([json, step]) => {
    const fakeFiles = { 'SidePanel.ipt.json': json, 'SidePanel.step': new Uint8Array(step) };
    return await (window as any).__zilventorImportFromFiles(fakeFiles, 'imported');
  }, [partJson, Array.from(stepBytes)]);
  expect(summary.partsImported).toBe(1);
  expect(summary.errors).toHaveLength(0);
});
```

- [ ] **Step 2:** In `App.tsx` (dev-only branch), expose `__zilventorImportFromFiles(files, target)` that turns `Record<name, json|bytes>` into an in-memory `FileSystemDirectoryHandle`-shaped object and runs `runInventorImport` directly. Reuse the in-memory handle stub from the unit test in T16.

- [ ] **Step 3:** Commit fixtures (use cube STEP from T6 as `SidePanel.step`; copy bytes via the Bash tool: `cp packages/kernel/src/occt/__tests__/fixtures/step/cube-10mm.step tests/e2e/fixtures/inventor-export/single-part/SidePanel.step`). Author the JSON by hand pointing to that step.

- [ ] **Step 4:** Run: `pnpm --filter @zilventor/app exec playwright test import-from-inventor` — expect PASS. Commit.

---

### Task 24: E2E — two-level assembly import

**Files:**
- Extend: `tests/e2e/import/import-from-inventor.spec.ts` with second scenario
- Create: `tests/e2e/fixtures/inventor-export/two-level-asm/Leaf.ipt.json` (+ `.step`)
- Create: `tests/e2e/fixtures/inventor-export/two-level-asm/Inner.iam.json` (refs Leaf)
- Create: `tests/e2e/fixtures/inventor-export/two-level-asm/Outer.iam.json` (refs Inner)

- [ ] **Step 1:** Author JSON fixtures with one occurrence per assembly. Inner has color override; Outer has grounded flag.

- [ ] **Step 2:** Spec opens the resulting outer `.ziasm` and asserts: browser pane shows two-level tree, viewport shows the leaf component placed correctly, BOM tab shows the leaf with Description from properties.

- [ ] **Step 3:** Commit.

```bash
git add tests/e2e/import/ tests/e2e/fixtures/inventor-export/
git commit -m "test(e2e): T23+T24 importer single-part and two-level assembly

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 25: Perf — batch import 50 parts + 10 assemblies

**Files:**
- Create: `tools/generate-perf-fixtures.mjs` — generates 50 cube STEPs + 10 small assemblies
- Commit generated fixtures under `tests/perf/fixtures/inventor-export-batch/`
- Create: `tests/perf/import-batch.spec.ts`

- [ ] **Step 1:** Generator script writes 50 cube STEPs (each 10×10×10 mm) and 10 `.iam.json`s (each referencing 5 parts).

- [ ] **Step 2:** Run the generator. Commit the output.

- [ ] **Step 3:** Perf spec:

```ts
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

test('batch import 50 parts + 10 assemblies under perf budget', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__zilventorImportFromFiles));
  const fixtureDir = resolve(__dirname, 'fixtures/inventor-export-batch');
  const files: Record<string, string | number[]> = {};
  for (const f of readdirSync(fixtureDir)) {
    const path = resolve(fixtureDir, f);
    if (f.endsWith('.json')) files[f] = readFileSync(path, 'utf-8');
    else files[f] = Array.from(readFileSync(path));
  }
  const t0 = Date.now();
  const summary = await page.evaluate(async (f) => (window as any).__zilventorImportFromFiles(f, 'imported-batch'), files);
  const elapsed = Date.now() - t0;
  expect(summary.partsImported).toBe(50);
  expect(summary.assembliesImported).toBe(10);
  expect(summary.errors).toHaveLength(0);
  // Threshold: 30 s on locked target hardware. ±20% tolerance applied at calibration time.
  expect(elapsed).toBeLessThan(30000);
});
```

- [ ] **Step 4:** Run on a local dev box once to calibrate the 30 s budget. If significantly faster, tighten to actual+20%; if slower, document hardware variance and adjust.

- [ ] **Step 5:** Commit.

```bash
git add tools/generate-perf-fixtures.mjs tests/perf/fixtures/ tests/perf/import-batch.spec.ts
git commit -m "perf(import): T25 batch-import 50 parts + 10 assemblies under 30s p95

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 8 — Inventor VBA macro

### Task 26: `ZilInventorExport.ivb` — single-doc + batch

**Files:**
- Create: `tools/inventor-export/ZilInventorExport.ivb`

**No automated tests** — VBA needs a running Inventor. Manual verification via the smoke checklist (Phase 9, T28).

- [ ] **Step 1: Write the macro skeleton** at `tools/inventor-export/ZilInventorExport.ivb`. The file contains a single VBA module with the routines listed in the spec section "Inventor-side: VBA macro".

```vb
'   ZilInventor export macro for Inventor 2012
'   Run via Tools > Macros > ZilInventor_BatchExportFolder (or _ExportActiveDocument)
'   Schema: see docs/superpowers/specs/2026-04-30-subproject-1.5-inventor-export-design.md

Option Explicit

Public Sub ZilInventor_ExportActiveDocument()
    On Error GoTo Cleanup
    Dim outputRoot As String
    outputRoot = PickFolder("Choose output folder")
    If Len(outputRoot) = 0 Then Exit Sub
    Dim doc As Document
    Set doc = ThisApplication.ActiveDocument
    If doc Is Nothing Then
        MsgBox "No active document.", vbExclamation
        Exit Sub
    End If
    Dim relPath As String
    relPath = BaseName(doc.FullFileName)
    Call ExportDocument(doc, outputRoot, "", relPath)
    MsgBox "Export done. See " & outputRoot & "\_export-log.txt", vbInformation
Cleanup:
    If Err.Number <> 0 Then MsgBox "Error: " & Err.Description, vbCritical
End Sub

Public Sub ZilInventor_BatchExportFolder()
    On Error GoTo Cleanup
    Dim inputRoot As String
    inputRoot = PickFolder("Choose input folder (.ipt/.iam tree)")
    If Len(inputRoot) = 0 Then Exit Sub
    Dim outputRoot As String
    outputRoot = PickFolder("Choose output folder (must NOT be inside the input folder)")
    If Len(outputRoot) = 0 Then Exit Sub
    If StartsWithFolder(outputRoot, inputRoot) Then
        MsgBox "Output folder must not be inside the input folder.", vbExclamation
        Exit Sub
    End If
    Call BatchWalk(inputRoot, outputRoot)
    MsgBox "Batch export done. See " & outputRoot & "\_export-log.txt", vbInformation
Cleanup:
    If Err.Number <> 0 Then MsgBox "Error: " & Err.Description, vbCritical
End Sub

'  --- Internal subs ---

Private Function PickFolder(prompt As String) As String
    Dim shell As Object
    Set shell = CreateObject("Shell.Application")
    Dim folder As Object
    Set folder = shell.BrowseForFolder(0, prompt, 0, 0)
    If folder Is Nothing Then
        PickFolder = ""
    Else
        PickFolder = folder.Self.Path
    End If
End Function

'   ... [continue with: BatchWalk, ExportDocument, ExportPart, ExportAssembly,
'        WritePartJson, WriteAssemblyJson, STEPExport, JsonEscape, JsonNumber,
'        WriteUtf8File, AppendUtf8File, LogLine, BaseName, JoinPath,
'        StartsWithFolder, IsAlreadyExported]
```

Fill out the rest of the routines. Reference the spec section "Inventor-side: VBA macro" for behavior. Use `ADODB.Stream` for UTF-8 file I/O — example:

```vb
Private Sub WriteUtf8File(path As String, contents As String)
    Dim s As Object
    Set s = CreateObject("ADODB.Stream")
    s.Charset = "utf-8"
    s.Type = 2
    s.Open
    s.WriteText contents
    s.SaveToFile path, 2
    s.Close
End Sub
```

- [ ] **Step 2: Internal review** — open the file in any text editor and walk it line by line. Confirm:
  - Every public sub has `On Error GoTo Cleanup` plus a `Cleanup:` label that surfaces errors.
  - JSON output passes through `JsonEscape` for every string value, including iProperty keys (Cyrillic safe).
  - Per-batch dedup (`IsAlreadyExported`) keys by `Document.FullFileName` (Inventor's resolved absolute path).
  - STEP export uses AP214 + binary mode (`STEPControl_Writer` settings via `Interface_Static.SetCVal`).

- [ ] **Step 3: Commit**

```bash
git add tools/inventor-export/ZilInventorExport.ivb
git commit -m "$(cat <<'EOF'
feat(inventor): T26 ZilInventorExport.ivb VBA macro

Single-file VBA module for Inventor 2012. Two entry points:
ZilInventor_ExportActiveDocument and ZilInventor_BatchExportFolder.
Writes STEP (AP214) per unique referenced .ipt and JSON sidecars per
document with properties + parameters + occurrences. UTF-8 I/O via
ADODB.Stream so Cyrillic survives. No automated tests — verified via
docs/superpowers/manual-tests/subproject-1.5.md on the user's box.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 9 — User docs + manual smoke test

### Task 27: `INVENTOR-EXPORT-README.md`

**Files:**
- Create: `docs/migration/INVENTOR-EXPORT-README.md`

User-facing documentation. Sections:

1. What this migrates and what it doesn't (cross-reference the spec's NOT-migrated list).
2. One-time install: how to load `ZilInventorExport.ivb` into Inventor 2012's macro editor.
3. Running the batch macro: input folder, output folder, what to expect.
4. Inspecting the output folder.
5. Importing into ZilInventor: File-tab button, conflict policy, target subfolder.
6. What the imported parts look like in ZilInventor (read-only feature tree, parameters as metadata, BOM rows with properties).
7. Troubleshooting: common Inventor STEP-translator errors, log file location, how to re-run a failed file.

- [ ] **Step 1:** Write the file. Aim for ~1500 words of practical instructions, not a reference manual.

- [ ] **Step 2: Commit.**

```bash
git add docs/migration/INVENTOR-EXPORT-README.md
git commit -m "docs(migration): T27 user-facing INVENTOR-EXPORT-README

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 28: Manual smoke test checklist

**Files:**
- Create: `docs/superpowers/manual-tests/subproject-1.5.md`

Five scenarios from the spec:

1. Single small `.ipt` with three numeric parameters and four iProperty fields.
2. Flat assembly with three placed instances of one part, two with color overrides.
3. Two-level assembly (`Cabinet.iam` containing `Door.iam` instances).
4. Assembly referencing one part outside the input root (`_external/`).
5. Re-run macro on (1) into a populated output folder; verify Skip vs Overwrite.

Each scenario: setup steps, expected macro output, expected ZilInventor outcome (viewport, browser, BOM, Parameters panel).

- [ ] **Step 1:** Write the checklist.

- [ ] **Step 2: Commit.**

```bash
git add docs/superpowers/manual-tests/subproject-1.5.md
git commit -m "docs(manual-tests): T28 sub-project 1.5 smoke checklist

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final verification gate (before declaring 1.5 shipped)

```bash
pnpm -r typecheck                                          # clean
pnpm -r test:unit                                          # all green
pnpm --filter @zilventor/kernel test:integration           # all green
pnpm --filter @zilventor/app exec playwright test          # all e2e green
pnpm --filter @zilventor/app exec playwright test perf/    # perf within budget
```

User runs the manual smoke (`docs/superpowers/manual-tests/subproject-1.5.md`) on their Inventor 2012 box and confirms scenarios 1–5 pass. Sub-project 1.5 ships when:

- Workspace gates green.
- Manual smoke passes.
- A representative slice of the user's actual furniture library has been migrated end-to-end.

---

## Memory note for after ship

Add `project_subproject_1.5_execution_state.md` to `~/.claude/projects/-Users-lion-Documents-Projects-mine-zilventor/memory/` summarizing: the shipped commit, total tasks, what landed, any deferred follow-ups (likely: drawing translation in 1.5+ or BOM-table column visibility toggle in a 4c follow-up).
