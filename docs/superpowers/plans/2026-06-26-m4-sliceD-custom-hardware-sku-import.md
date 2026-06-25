# Custom Hardware SKU Import (M4 Slice D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user import a JSON hardware SKU into a per-document catalog so it is placeable via the existing `AddHardwareCommand`, appears in the hardware BOM, and persists with the project.

**Architecture:** Promote the private `CatalogEntry` interface to an exported shared type `HardwareCatalogEntry`. Add one pure resolver `resolveHardwareCatalog(doc) = [...BUILTIN_CATALOG, ...doc.customHardware]` and route the three *generic* catalog consumers (place / list / BOM) through it. Pure validation + parse functions form the TDD heart; an undoable command + store action + a `HardwareDialog` Import button form the write path. New field on the document + a `v32→v33` additive migration persists it.

**Tech Stack:** TypeScript (monorepo: `packages/shared`, `packages/app`), Vitest, Zustand store, Playwright e2e, i18n (en/uk).

## Global Constraints

- **Branch:** `feat/m4-custom-hardware-sku-import` (already created off `master`). Never push; never commit to `master`. Merge is human-gated via `--no-ff` at the end.
- **Spec:** `docs/superpowers/specs/2026-06-26-m4-sliceD-custom-hardware-sku-import-design.md`.
- **No custom boring math** — a custom SKU is a placeable block (bbox + attachPoints + metadata). Boring is code-driven and out of scope.
- **ID collision → reject** (builtin, existing custom, or intra-batch). Import is **atomic**: any failure aborts the whole import; document unchanged.
- **Per-task EXEC gate:** `pnpm typecheck` (root, 5 pkgs, expect 0) AND scoped `pnpm exec eslint <touched files>` per package (full-repo `pnpm lint` OOMs — never run it). `tsc 0 ≠ eslint 0` — run both.
- **Run tests scoped:** shared → `cd packages/shared && pnpm exec vitest run <spec>`; app has **no** `test` script → `cd packages/app && pnpm exec vitest run <spec>`.
- **`exactOptionalPropertyTypes: true`** → use conditional spread for optional undefinable fields: `...(x ? { x } : {})`.
- **Assert absolute values, never counts.** Validation tests assert the exact returned object (every field), not "it passed".
- **Repack preserves blobs** (`blobs: project.blobs ?? {}`) — no blobs touched here, but autosave runs.
- **i18n:** every user-facing string gets an `en` and a `uk` key; regression-lock the new keys.
- **Commit after each task** with a `feat(m4-d):` / `test(m4-d):` prefix. No `Co-Authored-By` / tool-attribution trailers.

---

## File Structure

**New (shared):**
- `packages/shared/src/hardware/resolveCatalog.ts` — `resolveHardwareCatalog(doc)` + `HardwareCatalogEntry` re-export.
- `packages/shared/src/hardware/customHardware.ts` — `validateCustomHardwareSku`, `parseCustomHardwareImport`, `CustomHardwareValidationError`.
- Specs: `resolveCatalog.spec.ts`, `customHardware.spec.ts`.

**New (app):**
- `packages/app/src/commands/ImportCustomHardwareCommand.ts` (+ `.spec.ts`).
- `packages/app/tests/e2e/m4-custom-hardware-sku.spec.ts`.

**Modified (shared):**
- `packages/shared/src/hardware/builtinCatalog.ts` — export `CatalogEntry` as `HardwareCatalogEntry`.
- `packages/shared/src/types.ts` — add `customHardware?: HardwareCatalogEntry[]` to `AssemblyDocument` + `PartDocument`.
- `packages/shared/src/fileFormat.ts` — `CURRENT_FORMAT_VERSION 32→33` + migration `32:`.

**Modified (app):**
- `packages/app/src/store/useAppStore.ts` — `addCustomHardware` action + store type.
- `packages/app/src/commands/AddHardwareCommand.ts` — lookup via `resolveHardwareCatalog(activeDoc)`.
- `packages/app/src/shell/HardwareDialog.tsx` — Import button + resolver filter.
- `packages/app/src/shell/BrowserPane.tsx` — BOM registry via resolver.
- i18n `en` / `uk` resource files (locate during Task 8).

---

## Task 1: Export `HardwareCatalogEntry` + `resolveHardwareCatalog`

**Files:**
- Modify: `packages/shared/src/hardware/builtinCatalog.ts` (the private `interface CatalogEntry`)
- Create: `packages/shared/src/hardware/resolveCatalog.ts`
- Test: `packages/shared/src/hardware/resolveCatalog.spec.ts`

**Interfaces:**
- Produces: `export interface HardwareCatalogEntry` (the former `CatalogEntry` shape: `HardwareEntry` + `bboxMm{l,w,h}` + `attachPoints[]` + `legLeveler?`). `export function resolveHardwareCatalog(doc: { customHardware?: readonly HardwareCatalogEntry[] } | null | undefined): readonly HardwareCatalogEntry[]`.

- [ ] **Step 1: Read context.** Read `packages/shared/src/hardware/builtinCatalog.ts` (the `interface CatalogEntry` at the top + how `BUILTIN_CATALOG` is typed/exported) and `packages/shared/src/hardware-feature.ts` (`HardwareEntry`, `LegLevelerSpec`).

- [ ] **Step 2: Write the failing test** — `packages/shared/src/hardware/resolveCatalog.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveHardwareCatalog, type HardwareCatalogEntry } from './resolveCatalog';
import { BUILTIN_CATALOG } from './builtinCatalog';

const custom: HardwareCatalogEntry = {
  id: 'acme-pull-128',
  name: 'ACME Bar Pull 128mm',
  category: 'drawerHandles',
  vendor: 'ACME',
  notes: 'custom',
  bboxMm: { l: 140, w: 12, h: 30 },
  attachPoints: [{ name: 'screw-a', position: { x: 6, y: 0, z: 0 } }],
};

describe('resolveHardwareCatalog', () => {
  it('returns builtins alone when doc has no customHardware', () => {
    expect(resolveHardwareCatalog(undefined)).toEqual(BUILTIN_CATALOG);
    expect(resolveHardwareCatalog({})).toEqual(BUILTIN_CATALOG);
    expect(resolveHardwareCatalog({ customHardware: [] })).toEqual(BUILTIN_CATALOG);
  });

  it('appends customHardware after builtins, preserving order', () => {
    const out = resolveHardwareCatalog({ customHardware: [custom] });
    expect(out.length).toBe(BUILTIN_CATALOG.length + 1);
    expect(out[out.length - 1]).toEqual(custom);
    expect(out.slice(0, BUILTIN_CATALOG.length)).toEqual(BUILTIN_CATALOG);
  });
});
```

- [ ] **Step 3: Run test to verify it fails.** Run: `cd packages/shared && pnpm exec vitest run src/hardware/resolveCatalog.spec.ts` — Expected: FAIL (`Cannot find module './resolveCatalog'`).

- [ ] **Step 4: Export the type.** In `builtinCatalog.ts`, change `interface CatalogEntry {` to `export interface CatalogEntry {` (keep the name `CatalogEntry` so `BUILTIN_CATALOG`'s inferred type is unchanged).

- [ ] **Step 5: Create the resolver** — `packages/shared/src/hardware/resolveCatalog.ts`:

```ts
import { BUILTIN_CATALOG, type CatalogEntry } from './builtinCatalog';

/** The full catalog entry shape (metadata + geometry). Builtin and custom alike. */
export type HardwareCatalogEntry = CatalogEntry;

/**
 * Effective hardware catalog for a document: built-in SKUs followed by the
 * document's user-imported `customHardware` (M4 Slice D). Pure; never mutates.
 */
export function resolveHardwareCatalog(
  doc: { customHardware?: readonly HardwareCatalogEntry[] } | null | undefined,
): readonly HardwareCatalogEntry[] {
  return [...BUILTIN_CATALOG, ...(doc?.customHardware ?? [])];
}
```

- [ ] **Step 6: Run test to verify it passes.** Run the Step 3 command — Expected: PASS (2 tests).

- [ ] **Step 7: EXEC gate.** Run `pnpm typecheck` (root; expect 0) and `cd packages/shared && pnpm exec eslint src/hardware/resolveCatalog.ts src/hardware/resolveCatalog.spec.ts src/hardware/builtinCatalog.ts` (expect clean).

- [ ] **Step 8: Commit.**

```bash
git add packages/shared/src/hardware/resolveCatalog.ts packages/shared/src/hardware/resolveCatalog.spec.ts packages/shared/src/hardware/builtinCatalog.ts
git commit -m "feat(m4-d): export HardwareCatalogEntry + resolveHardwareCatalog"
```

---

## Task 2: `validateCustomHardwareSku`

**Files:**
- Create: `packages/shared/src/hardware/customHardware.ts`
- Test: `packages/shared/src/hardware/customHardware.spec.ts`

**Interfaces:**
- Consumes: `HardwareCatalogEntry` (Task 1), `HardwareCategory` (`hardware-feature.ts`).
- Produces: `export class CustomHardwareValidationError extends Error`; `export function validateCustomHardwareSku(raw: unknown, existingIds: ReadonlySet<string>): HardwareCatalogEntry`.

- [ ] **Step 1: Write the failing test** — `packages/shared/src/hardware/customHardware.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateCustomHardwareSku, CustomHardwareValidationError } from './customHardware';

const valid = {
  id: 'acme-pull-128',
  name: 'ACME Bar Pull 128mm',
  category: 'drawerHandles',
  vendor: 'ACME',
  notes: 'matte black',
  bboxMm: { l: 140, w: 12, h: 30 },
  attachPoints: [{ name: 'screw-a', position: { x: 6, y: 0, z: 0 } }],
};

describe('validateCustomHardwareSku', () => {
  it('accepts a valid entry and returns it normalized', () => {
    const out = validateCustomHardwareSku(valid, new Set());
    expect(out).toEqual({
      id: 'acme-pull-128',
      name: 'ACME Bar Pull 128mm',
      category: 'drawerHandles',
      vendor: 'ACME',
      notes: 'matte black',
      bboxMm: { l: 140, w: 12, h: 30 },
      attachPoints: [{ name: 'screw-a', position: { x: 6, y: 0, z: 0 } }],
    });
  });

  it('defaults vendor and notes to empty string when omitted', () => {
    const { vendor, notes, ...rest } = valid;
    const out = validateCustomHardwareSku(rest, new Set());
    expect(out.vendor).toBe('');
    expect(out.notes).toBe('');
  });

  it('preserves an optional legLeveler when present and valid', () => {
    const withLeg = {
      ...valid,
      id: 'acme-leg',
      category: 'legLevelers',
      legLeveler: { screwCount: 4, patternW: 36, patternD: 36, screwDiameter: 4, screwDepth: 13 },
    };
    expect(validateCustomHardwareSku(withLeg, new Set()).legLeveler).toEqual({
      screwCount: 4, patternW: 36, patternD: 36, screwDiameter: 4, screwDepth: 13,
    });
  });

  it.each([
    ['non-object', 42, /object/i],
    ['missing id', { ...valid, id: undefined }, /id/i],
    ['empty id', { ...valid, id: '' }, /id/i],
    ['missing name', { ...valid, name: undefined }, /name/i],
    ['bad category', { ...valid, category: 'sprockets' }, /category/i],
    ['non-numeric bbox', { ...valid, bboxMm: { l: 'x', w: 1, h: 1 } }, /bbox/i],
    ['negative bbox', { ...valid, bboxMm: { l: -1, w: 1, h: 1 } }, /bbox/i],
    ['attachPoints not array', { ...valid, attachPoints: {} }, /attachPoint/i],
    ['attachPoint missing position', { ...valid, attachPoints: [{ name: 'a' }] }, /position/i],
    ['bad legLeveler screwCount', { ...valid, legLeveler: { screwCount: 2, patternW: 1, patternD: 1, screwDiameter: 1, screwDepth: 1 } }, /legLeveler/i],
  ])('rejects %s', (_label, input, re) => {
    expect(() => validateCustomHardwareSku(input as unknown, new Set())).toThrow(CustomHardwareValidationError);
    expect(() => validateCustomHardwareSku(input as unknown, new Set())).toThrow(re);
  });

  it('rejects an id that collides with existingIds', () => {
    expect(() => validateCustomHardwareSku(valid, new Set(['acme-pull-128'])))
      .toThrow(/already exists|collision|duplicate/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.** Run: `cd packages/shared && pnpm exec vitest run src/hardware/customHardware.spec.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `packages/shared/src/hardware/customHardware.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes.** Run the Step 2 command — Expected: PASS (all cases).

- [ ] **Step 5: EXEC gate.** `pnpm typecheck` (0); `cd packages/shared && pnpm exec eslint src/hardware/customHardware.ts src/hardware/customHardware.spec.ts`.

> **Note:** confirm `Vec3` is exported from `hardware-feature.ts` (the extraction showed it is). If it is not, import `Vec3` from wherever it is declared.

- [ ] **Step 6: Commit.**

```bash
git add packages/shared/src/hardware/customHardware.ts packages/shared/src/hardware/customHardware.spec.ts
git commit -m "feat(m4-d): validateCustomHardwareSku pure validator"
```

---

## Task 3: `parseCustomHardwareImport` (atomic, object-or-array)

**Files:**
- Modify: `packages/shared/src/hardware/customHardware.ts`
- Test: `packages/shared/src/hardware/customHardware.spec.ts` (add a `describe`)

**Interfaces:**
- Consumes: `validateCustomHardwareSku` (Task 2), `HardwareCatalogEntry` (Task 1).
- Produces: `export function parseCustomHardwareImport(jsonText: string, existingRegistry: readonly HardwareCatalogEntry[]): HardwareCatalogEntry[]`.

- [ ] **Step 1: Write the failing test** — append to `customHardware.spec.ts`:

```ts
import { parseCustomHardwareImport } from './customHardware';
import { BUILTIN_CATALOG } from './builtinCatalog';

describe('parseCustomHardwareImport', () => {
  const one = JSON.stringify(valid);
  const two = JSON.stringify([valid, { ...valid, id: 'acme-pull-160', name: 'ACME 160' }]);

  it('parses a single object into a one-element array', () => {
    const out = parseCustomHardwareImport(one, BUILTIN_CATALOG);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('acme-pull-128');
  });

  it('parses an array of objects', () => {
    const out = parseCustomHardwareImport(two, BUILTIN_CATALOG);
    expect(out.map((e) => e.id)).toEqual(['acme-pull-128', 'acme-pull-160']);
  });

  it('throws on malformed JSON', () => {
    expect(() => parseCustomHardwareImport('{ not json', BUILTIN_CATALOG)).toThrow(/JSON/i);
  });

  it('rejects an id that collides with a builtin', () => {
    const dup = JSON.stringify({ ...valid, id: BUILTIN_CATALOG[0].id });
    expect(() => parseCustomHardwareImport(dup, BUILTIN_CATALOG)).toThrow(/already exists/i);
  });

  it('rejects an intra-batch duplicate id (atomic — second item collides with first)', () => {
    const batch = JSON.stringify([valid, { ...valid, name: 'dup' }]);
    expect(() => parseCustomHardwareImport(batch, BUILTIN_CATALOG)).toThrow(/already exists/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.** Run: `cd packages/shared && pnpm exec vitest run src/hardware/customHardware.spec.ts` — Expected: FAIL (`parseCustomHardwareImport` not exported).

- [ ] **Step 3: Implement** — append to `customHardware.ts`:

```ts
/**
 * Parse imported JSON text (a single SKU object OR an array of them) and validate
 * each against the existing registry. Atomic: throws on the first failure — including
 * an id that collides with a builtin, an already-imported entry, or an earlier item in
 * the same batch — and returns nothing partial. On success returns all validated entries.
 */
export function parseCustomHardwareImport(
  jsonText: string,
  existingRegistry: readonly HardwareCatalogEntry[],
): HardwareCatalogEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new CustomHardwareValidationError(`Invalid JSON: ${(e as Error).message}`);
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const ids = new Set<string>(existingRegistry.map((e) => e.id));
  const out: HardwareCatalogEntry[] = [];
  for (const item of items) {
    const entry = validateCustomHardwareSku(item, ids);
    ids.add(entry.id);
    out.push(entry);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes.** Run the Step 2 command — Expected: PASS (whole file green).

- [ ] **Step 5: EXEC gate.** `pnpm typecheck` (0); `cd packages/shared && pnpm exec eslint src/hardware/customHardware.ts src/hardware/customHardware.spec.ts`.

- [ ] **Step 6: Commit.**

```bash
git add packages/shared/src/hardware/customHardware.ts packages/shared/src/hardware/customHardware.spec.ts
git commit -m "feat(m4-d): parseCustomHardwareImport atomic object-or-array"
```

---

## Task 4: Document field + `v32→v33` migration + round-trip

**Files:**
- Modify: `packages/shared/src/types.ts` (`AssemblyDocument`, `PartDocument`)
- Modify: `packages/shared/src/fileFormat.ts` (`CURRENT_FORMAT_VERSION`, `migrations`)
- Test: `packages/shared/src/fileFormat.spec.ts` (or the existing migration spec — locate it; otherwise create `fileFormat.customHardware.spec.ts`)

**Interfaces:**
- Consumes: `HardwareCatalogEntry` (Task 1).
- Produces: `AssemblyDocument.customHardware?: HardwareCatalogEntry[]`; `PartDocument.customHardware?: HardwareCatalogEntry[]`; `CURRENT_FORMAT_VERSION === 33`.

- [ ] **Step 1: Read context.** Read `packages/shared/src/fileFormat.ts` around `CURRENT_FORMAT_VERSION`, the `migrations` object (esp. the `31:` entry), and how `migrate`/round-trip is tested (find the existing `fileFormat.spec.ts` or migration test file). Read `types.ts` near the `customTextures?:` field on `AssemblyDocument` and `PartDocument`.

- [ ] **Step 2: Write the failing test.** In the migration spec, add (adjust imports/helpers to the existing test's conventions for building a manifest):

```ts
import { describe, it, expect } from 'vitest';
import { CURRENT_FORMAT_VERSION, migrateManifest } from './fileFormat'; // use the real exported migrate fn name

describe('v32 -> v33 customHardware bump', () => {
  it('CURRENT_FORMAT_VERSION is 33', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(33);
  });

  it('migrates a v32 assembly manifest to v33 without touching content', () => {
    const v32 = { formatVersion: 32, kind: 'assembly', document: { id: 'a', name: 'A', hardware: [] } };
    const out = migrateManifest(v32 as never); // use the real migrate entrypoint
    expect(out.formatVersion).toBe(33);
    expect((out as { document: { customHardware?: unknown } }).document.customHardware).toBeUndefined();
  });
});
```

> If the spec instead tests via a `migrate(manifest)` or `parseManifest(bytes)` entrypoint, mirror that. The two assertions that matter: `CURRENT_FORMAT_VERSION === 33` and a v32→v33 round-trip is a no-op on content.

- [ ] **Step 3: Run test to verify it fails.** Run: `cd packages/shared && pnpm exec vitest run src/fileFormat.spec.ts` (or the located file) — Expected: FAIL (`expected 32 to be 33`).

- [ ] **Step 4: Add the document field.** In `types.ts`, import the type and add to both `AssemblyDocument` and `PartDocument` immediately after their `customTextures?:` line:

```ts
  customHardware?: HardwareCatalogEntry[];
```

Add the import at the top of `types.ts`:

```ts
import type { HardwareCatalogEntry } from './hardware/resolveCatalog';
```

> If `types.ts` and `resolveCatalog.ts` would form an import cycle (resolveCatalog imports builtinCatalog which may import types), prefer importing `HardwareCatalogEntry` from `./hardware/builtinCatalog` via the exported `CatalogEntry` alias, or move the `HardwareCatalogEntry` type declaration into `builtinCatalog.ts` and re-export from `resolveCatalog.ts`. Verify with `pnpm typecheck`.

- [ ] **Step 5: Bump version + add migration.** In `fileFormat.ts`: change `export const CURRENT_FORMAT_VERSION = 32 as const;` → `33`. Add to the `migrations` object (after the `31:` entry):

```ts
  // v32 → v33: M4 Slice D. Additive: introduces the optional `customHardware`
  // catalog field on assembly/part documents. No existing document needs
  // mutation; the bump pins the schema.
  32: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 33 };
  },
```

- [ ] **Step 6: Add a round-trip test.** Append (using the spec's serialize/parse helpers):

```ts
it('round-trips a customHardware entry through serialize -> parse', () => {
  const entry = {
    id: 'acme-pull-128', name: 'ACME Bar Pull 128mm', category: 'drawerHandles',
    vendor: 'ACME', notes: 'x', bboxMm: { l: 140, w: 12, h: 30 },
    attachPoints: [{ name: 'screw-a', position: { x: 6, y: 0, z: 0 } }],
  };
  // Build an assembly doc with customHardware: [entry], pack to bytes, parse back.
  // Assert the parsed document's customHardware deep-equals [entry].
});
```

> Fill the body using the existing pack/parse round-trip helpers in the spec file (locate the pattern other round-trip tests use — e.g. `packDocument`/`parseDocument` or the OPFS tar packer). The assertion: `expect(parsed.customHardware).toEqual([entry])`.

- [ ] **Step 7: Run tests to verify they pass.** Run the Step 3 command — Expected: PASS.

- [ ] **Step 8: EXEC gate.** `pnpm typecheck` (0 — this is the cross-package gate; the new field touches many call sites only via optional access, so 0 expected); `cd packages/shared && pnpm exec eslint src/types.ts src/fileFormat.ts <spec file>`.

- [ ] **Step 9: Commit.**

```bash
git add packages/shared/src/types.ts packages/shared/src/fileFormat.ts packages/shared/src/<spec file>
git commit -m "feat(m4-d): customHardware doc field + v32->v33 migration"
```

---

## Task 5: `addCustomHardware` store action

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`
- Test: `packages/app/src/store/useAppStore.customHardware.spec.ts` (new; or extend an existing store spec — locate the `addCustomTexture` test if any)

**Interfaces:**
- Consumes: `HardwareCatalogEntry` (Task 1), `addCustomTexture` pattern.
- Produces: store action `addCustomHardware(entries: HardwareCatalogEntry[]): void`.

- [ ] **Step 1: Read context.** Read `useAppStore.ts` around `addCustomTexture` (extraction showed ~969–985): the action shape, the store-type declaration (the interface field `addCustomTexture: (def: CustomTextureDef) => void`), and how `activeAssembly` / `activePart` / `activeDocument` are updated together.

- [ ] **Step 2: Write the failing test** — `useAppStore.customHardware.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './useAppStore';

const entry = {
  id: 'acme-pull-128', name: 'ACME Bar Pull 128mm', category: 'drawerHandles' as const,
  vendor: 'ACME', notes: '', bboxMm: { l: 140, w: 12, h: 30 },
  attachPoints: [{ name: 'screw-a', position: { x: 6, y: 0, z: 0 } }],
};

describe('addCustomHardware', () => {
  beforeEach(() => {
    // Seed a minimal active assembly. Mirror how addCustomTexture's test (or other
    // store tests) construct/inject an activeAssembly; reuse that helper.
  });

  it('appends entries to activeAssembly.customHardware', () => {
    useAppStore.getState().addCustomHardware([entry]);
    expect(useAppStore.getState().activeAssembly?.customHardware).toEqual([entry]);
    expect(useAppStore.getState().activeDocument).toMatchObject({ kind: 'assembly' });
  });

  it('is additive across calls', () => {
    useAppStore.getState().addCustomHardware([entry]);
    useAppStore.getState().addCustomHardware([{ ...entry, id: 'acme-pull-160' }]);
    expect(useAppStore.getState().activeAssembly?.customHardware?.map((e) => e.id))
      .toEqual(['acme-pull-128', 'acme-pull-160']);
  });
});
```

> Reuse the active-assembly seeding helper that existing store specs use (search `useAppStore` specs for how they set `activeAssembly`). If none, set state directly with a minimal `AssemblyDocument` via `useAppStore.setState({ activeAssembly, activeDocument: { kind: 'assembly', document: activeAssembly } })` in `beforeEach`.

- [ ] **Step 3: Run test to verify it fails.** Run: `cd packages/app && pnpm exec vitest run src/store/useAppStore.customHardware.spec.ts` — Expected: FAIL (`addCustomHardware is not a function`).

- [ ] **Step 4: Implement.** Add the action next to `addCustomTexture`, mirroring it exactly (append to active assembly, else active part):

```ts
  addCustomHardware: (entries) => set((s) => {
    if (s.activeAssembly) {
      const next = {
        ...s.activeAssembly,
        customHardware: [...(s.activeAssembly.customHardware ?? []), ...entries],
      };
      return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next };
    }
    if (s.activePart) {
      const next = {
        ...s.activePart,
        customHardware: [...(s.activePart.customHardware ?? []), ...entries],
      };
      return { activeDocument: { kind: 'part', document: next }, activePart: next };
    }
    return s;
  }),
```

Add to the store's type/interface (next to `addCustomTexture`'s declaration):

```ts
  addCustomHardware: (entries: HardwareCatalogEntry[]) => void;
```

and import `HardwareCatalogEntry` from `@zilventor/shared/src/hardware/resolveCatalog` (match the import style used for `CustomTextureDef`).

- [ ] **Step 5: Run test to verify it passes.** Run the Step 3 command — Expected: PASS.

- [ ] **Step 6: EXEC gate.** `pnpm typecheck` (0); `cd packages/app && pnpm exec eslint src/store/useAppStore.ts src/store/useAppStore.customHardware.spec.ts`.

- [ ] **Step 7: Commit.**

```bash
git add packages/app/src/store/useAppStore.ts packages/app/src/store/useAppStore.customHardware.spec.ts
git commit -m "feat(m4-d): addCustomHardware store action"
```

---

## Task 6: `ImportCustomHardwareCommand` (undoable)

**Files:**
- Create: `packages/app/src/commands/ImportCustomHardwareCommand.ts`
- Test: `packages/app/src/commands/ImportCustomHardwareCommand.spec.ts`

**Interfaces:**
- Consumes: `addCustomHardware` (Task 5), `HardwareCatalogEntry` (Task 1), the command base/pattern used by `AddCustomTextureCommand` / `AddHardwareCommand`.
- Produces: `class ImportCustomHardwareCommand` with `execute()` / `revert()` (match the project's Command interface — `apply`/`revert` or `execute`/`revert`; read `AddHardwareCommand.ts` to confirm method names).

- [ ] **Step 1: Read context.** Read `packages/app/src/commands/AddCustomTextureCommand.ts` (full — the closest template) and the Command interface it implements (method names, constructor `opts.store ?? useAppStore`, how revert is expressed). Read `AddHardwareCommand.ts` constructor for the `store` injection convention.

- [ ] **Step 2: Write the failing test** — `ImportCustomHardwareCommand.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../store/useAppStore';
import { ImportCustomHardwareCommand } from './ImportCustomHardwareCommand';

const a = { id: 'a', name: 'A', category: 'drawerHandles' as const, vendor: '', notes: '',
  bboxMm: { l: 10, w: 10, h: 10 }, attachPoints: [] };
const b = { ...a, id: 'b', name: 'B' };

describe('ImportCustomHardwareCommand', () => {
  beforeEach(() => {
    // Seed a minimal active assembly (same helper as Task 5).
  });

  it('execute adds the imported ids; revert removes exactly them', () => {
    const cmd = new ImportCustomHardwareCommand({ entries: [a, b] });
    cmd.execute(); // or .apply() — match the Command interface
    expect(useAppStore.getState().activeAssembly?.customHardware?.map((e) => e.id)).toEqual(['a', 'b']);
    cmd.revert();
    expect(useAppStore.getState().activeAssembly?.customHardware ?? []).toEqual([]);
  });

  it('apply -> revert -> apply (redo) restores exactly the same ids without duplication', () => {
    const cmd = new ImportCustomHardwareCommand({ entries: [a, b] });
    cmd.execute();
    cmd.revert();
    cmd.execute();
    expect(useAppStore.getState().activeAssembly?.customHardware?.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('revert only removes ids it imported, leaving pre-existing custom entries intact', () => {
    useAppStore.getState().addCustomHardware([{ ...a, id: 'pre' }]);
    const cmd = new ImportCustomHardwareCommand({ entries: [a, b] });
    cmd.execute();
    cmd.revert();
    expect(useAppStore.getState().activeAssembly?.customHardware?.map((e) => e.id)).toEqual(['pre']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails.** Run: `cd packages/app && pnpm exec vitest run src/commands/ImportCustomHardwareCommand.spec.ts` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement** (adapt method names/base to `AddCustomTextureCommand`'s interface — the body below shows intent; `execute` appends via the store action, `revert` removes the imported ids by filtering the active doc's `customHardware`):

```ts
import { useAppStore } from '../store/useAppStore';
import type { HardwareCatalogEntry } from '@zilventor/shared/src/hardware/resolveCatalog';

export interface ImportCustomHardwareOpts {
  entries: HardwareCatalogEntry[];
  store?: typeof useAppStore;
}

export class ImportCustomHardwareCommand /* implements Command — match the project base */ {
  private readonly store: typeof useAppStore;
  constructor(private readonly opts: ImportCustomHardwareOpts) {
    this.store = opts.store ?? useAppStore;
  }

  execute(): void {
    this.store.getState().addCustomHardware(this.opts.entries);
  }

  revert(): void {
    const ids = new Set(this.opts.entries.map((e) => e.id));
    this.store.setState((s) => {
      if (s.activeAssembly) {
        const next = {
          ...s.activeAssembly,
          customHardware: (s.activeAssembly.customHardware ?? []).filter((e) => !ids.has(e.id)),
        };
        return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next };
      }
      if (s.activePart) {
        const next = {
          ...s.activePart,
          customHardware: (s.activePart.customHardware ?? []).filter((e) => !ids.has(e.id)),
        };
        return { activeDocument: { kind: 'part', document: next }, activePart: next };
      }
      return s;
    });
  }
}
```

> Match the project's actual Command contract: if commands implement `apply()`/`revert()` or are registered through a `CommandManager`, rename `execute`→`apply` and wire registration exactly as `AddCustomTextureCommand` does. The two behaviors that must hold: execute appends the entries; revert removes exactly the imported ids (set-filter, not pop-N).

- [ ] **Step 5: Run test to verify it passes.** Run the Step 3 command — Expected: PASS (3 tests, incl. the redo cycle).

- [ ] **Step 6: EXEC gate.** `pnpm typecheck` (0); `cd packages/app && pnpm exec eslint src/commands/ImportCustomHardwareCommand.ts src/commands/ImportCustomHardwareCommand.spec.ts`.

- [ ] **Step 7: Commit.**

```bash
git add packages/app/src/commands/ImportCustomHardwareCommand.ts packages/app/src/commands/ImportCustomHardwareCommand.spec.ts
git commit -m "feat(m4-d): ImportCustomHardwareCommand (undoable, set-filter revert)"
```

---

## Task 7: Route the three generic consumers through `resolveHardwareCatalog`

This task makes a custom SKU actually **placeable**, **listed**, and **BOM-aggregated**.

**Files:**
- Modify: `packages/app/src/commands/AddHardwareCommand.ts` (the `BUILTIN_CATALOG.find(...)` lookup)
- Modify: `packages/app/src/shell/BrowserPane.tsx:242` (the `[...BUILTIN_CATALOG]` BOM registry)
- Modify: `packages/app/src/shell/HardwareDialog.tsx:28` (the `BUILTIN_CATALOG.filter(...)`)
- Test: `packages/app/src/commands/AddHardwareCommand.customSku.spec.ts` (new)

**Interfaces:**
- Consumes: `resolveHardwareCatalog` (Task 1), `addCustomHardware` (Task 5).

- [ ] **Step 1: Read context.** Read `AddHardwareCommand.ts` (how it gets the active doc — `store.getState().activeAssembly`/`activePart`/`activeDocument` — and the `BUILTIN_CATALOG.find((e) => e.id === this.opts.skuId)` block, plus `HardwareSkuNotFoundError`). Read `BrowserPane.tsx` around line 242 and `HardwareDialog.tsx` around lines 4/28.

- [ ] **Step 2: Write the failing test** — `AddHardwareCommand.customSku.spec.ts`. Seed an active assembly, import a custom SKU via `addCustomHardware`, then place it with `AddHardwareCommand` and assert it does **not** throw and produces a `HardwareFeature` with `hardwareSkuId` equal to the custom id:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../store/useAppStore';
import { AddHardwareCommand, HardwareSkuNotFoundError } from './AddHardwareCommand';

const custom = { id: 'acme-pull-128', name: 'ACME', category: 'drawerHandles' as const,
  vendor: '', notes: '', bboxMm: { l: 140, w: 12, h: 30 },
  attachPoints: [{ name: 'screw-a', position: { x: 6, y: 0, z: 0 } }] };

describe('AddHardwareCommand with a custom SKU', () => {
  beforeEach(() => {
    // Seed an active assembly + a target part/component such that AddHardwareCommand
    // can place hardware. Mirror the EXISTING AddHardwareCommand.spec.ts setup exactly
    // (read it first — it already constructs a valid placement target).
  });

  it('throws HardwareSkuNotFoundError for an unknown id (regression)', () => {
    expect(() => new AddHardwareCommand({ skuId: 'does-not-exist', /* ...placement opts */ } as never).execute())
      .toThrow(HardwareSkuNotFoundError);
  });

  it('places a custom SKU once imported (was previously SkuNotFound)', () => {
    useAppStore.getState().addCustomHardware([custom]);
    const cmd = new AddHardwareCommand({ skuId: 'acme-pull-128', /* ...same placement opts */ } as never);
    expect(() => cmd.execute()).not.toThrow();
    // Assert the placed HardwareFeature carries the custom id (read back via the store/part doc).
  });
});
```

> **Important:** copy the placement-target setup from the existing `AddHardwareCommand.spec.ts` verbatim so the only variable under test is builtin-vs-custom id resolution. Read that spec first.

- [ ] **Step 3: Run test to verify it fails.** Run: `cd packages/app && pnpm exec vitest run src/commands/AddHardwareCommand.customSku.spec.ts` — Expected: the "places a custom SKU" case FAILS with `HardwareSkuNotFoundError` (proving the bug), the regression case PASSES.

- [ ] **Step 4: Implement the lookup change in `AddHardwareCommand.ts`.** Replace:

```ts
const catalogEntry = BUILTIN_CATALOG.find((e) => e.id === this.opts.skuId);
```

with a resolver lookup over the active document:

```ts
const activeDoc = this.store.getState().activeAssembly ?? this.store.getState().activePart;
const catalogEntry = resolveHardwareCatalog(activeDoc).find((e) => e.id === this.opts.skuId);
```

and add `import { resolveHardwareCatalog } from '@zilventor/shared/src/hardware/resolveCatalog';`. Keep the `if (!catalogEntry) throw new HardwareSkuNotFoundError(...)` line unchanged. (If `AddHardwareCommand` already reads the active doc for placement, reuse that reference instead of re-reading the store.)

- [ ] **Step 5: Implement the BOM registry change in `BrowserPane.tsx`.** Replace the line:

```ts
const hardwareRows = aggregateHardwareRecursive(asm, hwCache, [...BUILTIN_CATALOG]).rows;
```

with:

```ts
const hardwareRows = aggregateHardwareRecursive(asm, hwCache, [...resolveHardwareCatalog(asm)]).rows;
```

(`asm` is the assembly already in scope at line 242 — confirm its variable name; add the `resolveHardwareCatalog` import.)

- [ ] **Step 6: Implement the dialog filter change in `HardwareDialog.tsx`.** Replace:

```ts
const filtered = BUILTIN_CATALOG.filter((e) => e.category === category);
```

with a resolver over the active doc:

```ts
const activeDoc = useAppStore((s) => s.activeAssembly ?? s.activePart);
const filtered = resolveHardwareCatalog(activeDoc).filter((e) => e.category === category);
```

(Use the dialog's existing store-access pattern — if it already subscribes to the store, read `activeAssembly`/`activePart` from there; add the `resolveHardwareCatalog` import. Remove the now-unused `BUILTIN_CATALOG` import only if nothing else in the file uses it — eslint will flag it.)

- [ ] **Step 7: Run tests to verify they pass.** Run the Step 3 command — Expected: both cases PASS. Also run the existing `AddHardwareCommand.spec.ts` and any `HardwareDialog`/`BrowserPane` specs to confirm no regression: `cd packages/app && pnpm exec vitest run src/commands/AddHardwareCommand.spec.ts`.

- [ ] **Step 8: EXEC gate.** `pnpm typecheck` (0); `cd packages/app && pnpm exec eslint src/commands/AddHardwareCommand.ts src/shell/BrowserPane.tsx src/shell/HardwareDialog.tsx src/commands/AddHardwareCommand.customSku.spec.ts` (watch for unused `BUILTIN_CATALOG` import errors — `no-unused-vars` is a hard ERROR here).

- [ ] **Step 9: Commit.**

```bash
git add packages/app/src/commands/AddHardwareCommand.ts packages/app/src/shell/BrowserPane.tsx packages/app/src/shell/HardwareDialog.tsx packages/app/src/commands/AddHardwareCommand.customSku.spec.ts
git commit -m "feat(m4-d): resolve catalog (builtins+custom) for place/list/BOM"
```

---

## Task 8: HardwareDialog "Import SKU" button + file pick + i18n

**Files:**
- Modify: `packages/app/src/shell/HardwareDialog.tsx`
- Modify: i18n resources (locate: search for an existing HardwareDialog key, e.g. the dialog title, in the `en`/`uk` files under `packages/app/src` — likely `locales/en.json` + `locales/uk.json` or a `i18n` module)
- Test: `packages/app/src/shell/HardwareDialog.import.spec.tsx` (component test) **or** fold into the Task 9 e2e if component-testing infra is absent (decide in Step 1)

**Interfaces:**
- Consumes: `parseCustomHardwareImport` (Task 3), `ImportCustomHardwareCommand` (Task 6), `pickFile` (`packages/app/src/shell/fsaFallback.ts`), `resolveHardwareCatalog` (Task 1).

- [ ] **Step 1: Read context.** Read `HardwareDialog.tsx` fully (its render structure, how it dispatches commands, how it shows errors if at all), `fsaFallback.ts` (`pickFile` signature), and the i18n usage in this file (the `t('...')` calls + which resource files hold the keys). Decide: component test vs e2e-only (if there's no existing `*.spec.tsx` render-test infra in `shell/`, defer the behavioral assertion to Task 9 and keep Task 8 to wiring + an i18n key regression-lock test).

- [ ] **Step 2: Write the failing test.** Two options by infra:
  - **i18n key regression-lock** (always do this) — `HardwareDialog.import.spec.tsx` or a small i18n spec:

```ts
import { describe, it, expect } from 'vitest';
import en from '<path>/en.json';
import uk from '<path>/uk.json';

describe('custom hardware import i18n keys', () => {
  it.each(['hardware.import.button', 'hardware.import.error', 'hardware.import.success'])(
    'key %s exists in en and uk', (key) => {
      const get = (o: Record<string, unknown>, k: string) => k.split('.').reduce<any>((a, p) => a?.[p], o);
      expect(get(en, key)).toBeTruthy();
      expect(get(uk, key)).toBeTruthy();
    });
});
```

  (Adjust to the project's i18n shape — flat keys vs nested. Match the existing key naming convention for HardwareDialog.)

- [ ] **Step 3: Run test to verify it fails.** Run: `cd packages/app && pnpm exec vitest run src/shell/HardwareDialog.import.spec.tsx` — Expected: FAIL (keys missing).

- [ ] **Step 4: Add i18n keys.** Add to `en` and `uk` resource files (match existing nesting/format), e.g.:

```json
"hardware": {
  "import": {
    "button": "Import SKU…",
    "success": "Imported {{count}} hardware SKU(s)",
    "error": "Import failed: {{message}}"
  }
}
```

uk:

```json
"hardware": {
  "import": {
    "button": "Імпорт SKU…",
    "success": "Імпортовано SKU: {{count}}",
    "error": "Помилка імпорту: {{message}}"
  }
}
```

(Merge into the existing `hardware` block if present; do not duplicate the key root.)

- [ ] **Step 5: Wire the button in `HardwareDialog.tsx`.** Add a button rendering `t('hardware.import.button')` whose handler:

```ts
const onImport = async () => {
  const file = await pickFile([{ accept: { 'application/json': ['.json'] } }]);
  if (!file) return;
  try {
    const text = await file.text();
    const entries = parseCustomHardwareImport(text, resolveHardwareCatalog(activeDoc));
    new ImportCustomHardwareCommand({ entries }).execute(); // or dispatch via the CommandManager the dialog already uses
    setImportError(null); // surface t('hardware.import.success', { count: entries.length }) if the dialog has a toast
  } catch (e) {
    setImportError(t('hardware.import.error', { message: (e as Error).message }));
  }
};
```

Add a local `const [importError, setImportError] = useState<string | null>(null);` and render `{importError && <div className="...error...">{importError}</div>}` near the list. **Dispatch the command the same way the dialog dispatches its other commands** (read how `AddHardwareCommand` is invoked from this dialog and mirror it — direct `.execute()` vs a `useCommandManager().run(cmd)`); undo must work, so prefer the manager if one exists.

- [ ] **Step 6: Run test to verify it passes.** Run the Step 3 command — Expected: PASS.

- [ ] **Step 7: EXEC gate.** `pnpm typecheck` (0); `cd packages/app && pnpm exec eslint src/shell/HardwareDialog.tsx <i18n files if linted> <spec>`.

- [ ] **Step 8: Commit.**

```bash
git add packages/app/src/shell/HardwareDialog.tsx <i18n files> packages/app/src/shell/HardwareDialog.import.spec.tsx
git commit -m "feat(m4-d): HardwareDialog Import SKU button + en/uk i18n"
```

---

## Task 9: E2E — import a SKU, assert it lands in the store, 0 console errors

**Files:**
- Create: `packages/app/tests/e2e/m4-custom-hardware-sku.spec.ts`
- Create (fixture): `packages/app/tests/e2e/fixtures/custom-hardware-sku.json` (a single valid SKU)

**Interfaces:**
- Consumes: the full UI flow (open HardwareDialog → Import → file input → store mutation).

- [ ] **Step 1: Read context.** Read an existing e2e spec (e.g. `tests/e2e/m4-tandem-slides.spec.ts`) for: how the app is launched, how a console-error listener is attached, how the store is read from the page (`window`-exposed store or a test hook), and how a file `<input type="file">` is driven (Playwright `setInputFiles`). Note: `pickFile` falls back to a hidden file input — drive that input directly with `setInputFiles`.

- [ ] **Step 2: Write the fixture** — `fixtures/custom-hardware-sku.json`:

```json
{
  "id": "e2e-acme-pull-128",
  "name": "E2E ACME Bar Pull 128mm",
  "category": "drawerHandles",
  "vendor": "ACME",
  "notes": "e2e fixture",
  "bboxMm": { "l": 140, "w": 12, "h": 30 },
  "attachPoints": [{ "name": "screw-a", "position": { "x": 6, "y": 0, "z": 0 } }]
}
```

- [ ] **Step 3: Write the failing e2e** — `m4-custom-hardware-sku.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
// mirror the harness setup (baseURL, console-error collection) from m4-tandem-slides.spec.ts

test('import a custom hardware SKU → appears in store customHardware, 0 console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // 1. launch app + create/open an assembly (copy the tandem spec's bootstrap)
  // 2. open the Hardware dialog (find the trigger the tandem/hardware flows use)
  // 3. set the hidden file input to the fixture:
  //    await page.setInputFiles('input[type=file]', 'tests/e2e/fixtures/custom-hardware-sku.json');
  //    (if pickFile uses showOpenFilePicker in the test browser, force the fallback or
  //     stub it — confirm how other DXF-import e2e tests drive pickFile.)

  // 4. assert the store received it (read the exposed store):
  const ids = await page.evaluate(() =>
    // @ts-expect-error test hook
    (window.__APP_STORE__?.getState?.().activeAssembly?.customHardware ?? []).map((e: { id: string }) => e.id),
  );
  expect(ids).toContain('e2e-acme-pull-128');

  expect(errors).toEqual([]);
});
```

> Use the **same store-exposure mechanism** the existing e2e specs use (the tandem spec asserts via the store — copy that access path exactly; do not invent `window.__APP_STORE__` if the project exposes it differently). If DXF-import e2e tests already solve "drive `pickFile` in Playwright", copy that approach.

- [ ] **Step 4: Run test to verify it fails.** Run the project's e2e command for a single spec (find it in `package.json` / the tandem handoff — e.g. `cd packages/app && pnpm exec playwright test tests/e2e/m4-custom-hardware-sku.spec.ts`). Expected: FAIL (button/flow not yet reachable or assertion empty) — confirm it fails for the *intended* reason, not a harness typo.

- [ ] **Step 5: Make it pass.** Fix wiring gaps surfaced by the e2e (dialog trigger selector, file-input driving, store exposure). No new feature code should be needed if Tasks 7–8 are correct; this task closes UI-wiring gaps.

- [ ] **Step 6: Run test to verify it passes.** Re-run Step 4 command — Expected: PASS, `errors` empty.

- [ ] **Step 7: EXEC gate.** `pnpm typecheck` (0); `cd packages/app && pnpm exec eslint tests/e2e/m4-custom-hardware-sku.spec.ts`.

- [ ] **Step 8: Commit.**

```bash
git add packages/app/tests/e2e/m4-custom-hardware-sku.spec.ts packages/app/tests/e2e/fixtures/custom-hardware-sku.json
git commit -m "feat(m4-d): e2e import custom hardware SKU (store assertion, 0 console errors)"
```

---

## Final: whole-branch review + EXEC gate + merge (controller, not a task)

After Task 9: dispatch an **opus whole-branch review** (base = `master`), apply EXEC gate (`pnpm typecheck` 0; scoped eslint on every touched package; re-run shared + app specs + the e2e), fix any RED, then `--no-ff` merge `feat/m4-custom-hardware-sku-import` → local `master`, re-verify green on merged master, delete the branch. **Do not push** (human-gated). Update memory + write the handoff.

---

## Self-Review (author)

- **Spec coverage:** §2.1 resolver → Task 1+7; §2.2 validate/parse → Task 2+3; §2.3 field+migration → Task 4; §2.4 store/command/UI/i18n → Tasks 5/6/8; data flow & BOM → Task 7; persistence round-trip → Task 4; e2e → Task 9. All spec sections mapped.
- **Reject-on-collision** covered in Task 2 (existingIds) + Task 3 (intra-batch + builtin). **Atomic import** in Task 3. **Undo** + redo cycle in Task 6.
- **Type consistency:** `HardwareCatalogEntry` defined Task 1, consumed identically in 2/3/4/5/6/7. `addCustomHardware(entries: HardwareCatalogEntry[])` consistent across 5/6/8. `resolveHardwareCatalog(doc)` signature consistent across 1/7/8.
- **Placeholder scan:** app-layer tasks (5–9) intentionally say "read the existing file and mirror its pattern" because exact method names (Command `execute` vs `apply`, store seeding helper, i18n file paths, e2e store exposure) depend on unread internals — each such spot names the exact file to read and the exact behavior to preserve. Pure shared tasks (1–4) carry full verbatim code. This matches the project convention that plan snippets are reference, not literal.
- **Known follow-up to fold in opportunistically:** the deferred tandem-slice cleanups (see handoff) are unrelated; leave them.
