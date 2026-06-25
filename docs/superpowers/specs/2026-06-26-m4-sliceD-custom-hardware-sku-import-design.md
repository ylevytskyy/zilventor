# M4 Slice D — Custom Hardware SKU Import

**Date:** 2026-06-26
**Milestone:** M4 (Furniture authoring correctness) — Slice D (final functional slice before E: blind/diagonal corner cabinet)
**Status:** Design ratified (autonomous loop; scope decisions confirmed via brainstorm)

## 1. Problem & Goal

The builtin hardware catalog (`BUILTIN_CATALOG`, 17 SKUs across hinges / shelfPins /
drawerHandles / drawerSlides / legLevelers / softCloseHinges) is a static constant.
Shops need to add their own hardware (a specific hinge, pull, or block) without a code
change.

**Goal:** A user imports a JSON hardware SKU. It joins the active document's catalog,
becomes placeable through the *existing* `AddHardwareCommand`, appears in the hardware
BOM, and persists with the project file so it survives reopen.

### Scope decisions (confirmed)

| Axis | Decision |
| --- | --- |
| SKU capability | **Placeable block + BOM.** Carries `bboxMm` + `attachPoints` + metadata; reuses `AddHardwareCommand`. **No** custom boring math (boring is code-driven, e.g. `tandemSlideMath.ts` — out of scope). |
| Import format | **JSON** matching the `CatalogEntry` shape (single object **or** array). |
| Persistence | **Per-document** — new `customHardware?: HardwareCatalogEntry[]` field on `AssemblyDocument` + `PartDocument`; serialized into OPFS; `v32 → v33` migration. |
| ID collision | **Reject with error** — duplicate id (builtin or already-present custom) aborts the import. Builtins stay authoritative. |

### Non-goals (YAGNI)

- No custom boring / connector-BOM pattern from data (code-driven only).
- No global / app-level shared catalog (per-document only; revisit if shops ask).
- No editing/deleting an imported SKU through UI beyond undo of the import (delete-SKU UI deferred).
- No CSV; no in-app field form (the deliverable word is "import").

## 2. Architecture

### 2.1 The one new seam — `resolveHardwareCatalog`

Today `CatalogEntry` is a **private** interface in
`packages/shared/src/hardware/builtinCatalog.ts`. It extends `HardwareEntry`
(`id`, `name`, `category`, `vendor`, `notes`) with `bboxMm{l,w,h}`,
`attachPoints[]`, and optional `legLeveler`.

Promote it to an **exported shared type** `HardwareCatalogEntry`
(re-export `CatalogEntry` as an alias internally so `BUILTIN_CATALOG`'s literal type
is unchanged). Add one pure helper:

```ts
// packages/shared/src/hardware/resolveCatalog.ts
export function resolveHardwareCatalog(
  doc: { customHardware?: readonly HardwareCatalogEntry[] } | null | undefined,
): readonly HardwareCatalogEntry[] {
  return [...BUILTIN_CATALOG, ...(doc?.customHardware ?? [])];
}
```

Only the **generic** catalog consumers route through this resolver:

1. `AddHardwareCommand` — replace `BUILTIN_CATALOG.find(...)` with a lookup over
   `resolveHardwareCatalog(activeDoc)`. A custom SKU then resolves instead of
   throwing `HardwareSkuNotFoundError`.
2. `HardwareDialog` — replace `BUILTIN_CATALOG.filter(category)` with
   `resolveHardwareCatalog(activeDoc).filter(...)` so custom entries list under
   their category.
3. `BrowserPane` BOM — replace `[...BUILTIN_CATALOG]` passed to
   `aggregateHardwareRecursive` with `resolveHardwareCatalog(activeAssembly)`
   so a placed custom SKU aggregates into the hardware BOM.

**Untouched** (reference fixed builtin ids; custom SKUs do not shadow them):
`buildSlidePart` (`DEFAULT_TANDEM_SLIDE_SKU`), `LegLevelersDialog`,
`AddDrawerHandlesCommand`, leg-leveler / drawer-slide builders.

### 2.2 Pure validation core (shared — TDD heart)

```ts
// packages/shared/src/hardware/customHardware.ts

export class CustomHardwareValidationError extends Error { /* message describes the failure */ }

// Validate one raw object → typed entry, or throw with a precise message.
export function validateCustomHardwareSku(
  raw: unknown,
  existingIds: ReadonlySet<string>,
): HardwareCatalogEntry;

// Parse imported JSON (single object OR array), validate each ATOMICALLY
// (including intra-batch id collisions). Throws on the first failure;
// nothing is returned partially. Returns the validated entries.
export function parseCustomHardwareImport(
  jsonText: string,
  existingRegistry: readonly HardwareCatalogEntry[],
): HardwareCatalogEntry[];
```

**`validateCustomHardwareSku` checks** (each → `CustomHardwareValidationError` with a
field-specific message):

- `id`: non-empty string; **not** in `existingIds` (builtin or already-present custom).
- `name`: non-empty string.
- `category`: one of the six `HardwareCategory` values.
- `vendor`, `notes`: strings (default `''` if omitted — optional in import, required in type).
- `bboxMm`: object with finite positive numbers `l`, `w`, `h`.
- `attachPoints`: array (may be empty) of `{ name: string, position: Vec3, normal?: Vec3 }`
  where `Vec3` is `{ x, y, z }` finite numbers.
- `legLeveler` (optional): if present, valid `LegLevelerSpec` (`screwCount === 4`,
  finite positive `patternW`/`patternD`/`screwDiameter`/`screwDepth`).

**`parseCustomHardwareImport`**: `JSON.parse` (malformed → error); wrap a single object
into a one-element array; fold over the array accumulating accepted ids into a working
`Set` seeded from `existingRegistry` so a duplicate id *within the batch* is also rejected;
return all validated entries (atomic — caller applies all or none).

### 2.3 Persistence & migration

- Add `customHardware?: HardwareCatalogEntry[]` to `AssemblyDocument` and
  `PartDocument` in `packages/shared/src/types.ts` (mirrors `customTextures?:`).
- `CURRENT_FORMAT_VERSION`: `32 → 33` in `packages/shared/src/fileFormat.ts`.
- Migration `32: (m) => ({ ...deepClone(m), formatVersion: 33 })` — additive no-op
  (optional field defaults to `undefined`; nothing to seed since custom = user-supplied).
  Mirrors the v31→v32 no-op bump exactly.
- Round-trip: serialize/deserialize preserves `customHardware` (bbox, attachPoints,
  legLeveler) intact.

### 2.4 App write path (mirrors custom-texture template)

- **Store action** `addCustomHardware(entries: HardwareCatalogEntry[])` in
  `useAppStore` — append to `activeAssembly.customHardware` (or `activePart` when no
  assembly), mirroring `addCustomTexture`. Idempotent dedup not required (validation
  already rejected collisions), but the action appends only.
- **Command** `ImportCustomHardwareCommand` (undoable):
  - `execute`: `addCustomHardware(entries)`.
  - `revert`: remove the imported ids from the active doc's `customHardware`.
  - No kernel reload / bore-cache invalidation (catalog import changes no geometry
    until a SKU is placed — placement is a separate `AddHardwareCommand`).
- **UI**: `HardwareDialog` gains an **"Import SKU"** button →
  `pickFile([{ accept: { 'application/json': ['.json'] } }])` → read text →
  `parseCustomHardwareImport(text, resolveHardwareCatalog(activeDoc))` →
  on success dispatch `ImportCustomHardwareCommand`; on `CustomHardwareValidationError`
  show the message inline. The category list refreshes to include the new entries
  (already covered by the resolver in 2.1).
- **i18n**: new en/uk keys for the button label, success, and error-prefix strings.

## 3. Data flow

```
JSON file ──pickFile──▶ text ──parseCustomHardwareImport(text, registry)──▶ entries[]
   │                                          │ (throws → inline error)
   │                                          ▼
   └────────────────────────▶ ImportCustomHardwareCommand.execute
                                              │ addCustomHardware(entries)
                                              ▼
                          AssemblyDocument.customHardware += entries  ──autosave──▶ OPFS
                                              │
   resolveHardwareCatalog(doc) = builtins + customHardware
                                              │
        ┌─────────────────────────┬──────────┴───────────────────┐
        ▼                         ▼                               ▼
  HardwareDialog list      AddHardwareCommand place        BrowserPane hardware BOM
  (custom under category)  (custom SKU → HardwareFeature)  (placed custom aggregates)
```

## 4. Error handling

- Malformed JSON → `CustomHardwareValidationError("Invalid JSON: …")`.
- Missing/typed-wrong field → message naming the field and SKU id (if known).
- Id collision (builtin, existing custom, or intra-batch) → message naming the id.
- Import is **atomic**: any single failure aborts the whole import; the document is
  unchanged. UI surfaces the message; no partial state.

## 5. Testing strategy (TDD, red→green per slice)

| # | Layer | Red test (the failing assertion) | Green |
| --- | --- | --- | --- |
| 1 | shared | `resolveHardwareCatalog` returns builtins alone when no custom; builtins+custom when present; `HardwareCatalogEntry` is importable | export type alias + helper |
| 2 | shared | `validateCustomHardwareSku`: rejects missing id/name, bad category, non-numeric bbox, malformed attachPoints, collision; accepts a valid entry (exact returned object) | validator |
| 3 | shared | `parseCustomHardwareImport`: single object, array, malformed JSON, intra-batch collision, atomic-abort (nothing returned on failure) | parser |
| 4 | shared | migration v32 doc → v33 (field absent stays absent / optional); round-trip serialize→parse preserves a `customHardware` entry verbatim; `CURRENT_FORMAT_VERSION === 33` | field + migration bump |
| 5 | app | `addCustomHardware` appends to `activeAssembly.customHardware`; falls back to `activePart`; leaves doc identity correct | store action |
| 6 | app | `ImportCustomHardwareCommand` execute adds ids; revert removes exactly those ids (apply→revert→apply redo cycle restores) | command |
| 7 | app | `AddHardwareCommand` **places** a custom SKU (was `HardwareSkuNotFoundError`); `HardwareDialog` filter includes custom; BOM aggregates a placed custom SKU | route 3 consumers through resolver |
| 8 | app | HardwareDialog Import button: pick→parse→dispatch; validation error renders inline; en/uk keys exist (regression-lock the keys) | button + i18n |
| 9 | e2e | open HardwareDialog → import JSON SKU (file input) → entry appears in list (assert via store `customHardware`) → 0 console errors | wiring |

**Verification posture (carry-forward lessons):**
- **Assert absolute values, not counts** — task 2/3 assert the exact returned
  `HardwareCatalogEntry` (every field), not just "validation passed".
- **EXEC gate before done** — `pnpm typecheck` (root, 5 pkgs, 0) + scoped
  `pnpm exec eslint` per touched package (full-repo lint OOMs) + the actual vitest
  runs; `tsc 0 ≠ eslint 0`.
- **Redo-cycle test** for the command (task 6) — apply→revert→apply must not
  duplicate or orphan ids.
- **e2e asserts via store**, not OPFS — `customHardware` lives in the Zustand store
  (unlike panel bores), so it is directly assertable and non-vacuous.
- `exactOptionalPropertyTypes: true` → conditional spread for optional fields
  (`...(legLeveler ? { legLeveler } : {})`).
- Repack must preserve blobs (`blobs: project.blobs ?? {}`) — no blobs touched here,
  but the autosave path runs.

## 6. Files (anticipated)

**New (shared):** `hardware/resolveCatalog.ts`, `hardware/customHardware.ts` (+ specs).
**New (app):** `commands/ImportCustomHardwareCommand.ts` (+ spec);
e2e `tests/e2e/m4-custom-hardware-sku.spec.ts`.
**Edit (shared):** `hardware/builtinCatalog.ts` (export `HardwareCatalogEntry`),
`types.ts` (+`customHardware?`), `fileFormat.ts` (v33 + migration).
**Edit (app):** `useAppStore.ts` (+`addCustomHardware`),
`commands/AddHardwareCommand.ts` (resolver lookup),
`shell/HardwareDialog.tsx` (Import button + resolver filter),
`shell/BrowserPane.tsx` (resolver BOM registry), i18n `en`/`uk`.

## 7. Open risks

- `attachPoint` semantics for arbitrary user hardware are looser than for builtins
  (which encode hinge cup centers etc.) — acceptable: a custom block places at its
  attach points like any other; meaningfulness is the user's responsibility.
- `HardwareCatalogEntry` export must not change `BUILTIN_CATALOG`'s inferred literal
  type or downstream exhaustive lookups — verify `pnpm typecheck` stays 0.
