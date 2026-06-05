# STEP Per-Body Color Import — Design

**Date:** 2026-06-05
**Status:** Approved (design); ready for implementation planning
**Author:** brainstorm session (Claude + levytskyy)

## Problem

STEP files imported into ZilInventor render in a single default gray
(`0xc8c8c8`). STEP files do **not** carry textures, but they *can* carry
per-body / per-face **colors** (AP214 / AP242 color attributes). The current
importer reads geometry with plain `STEPControl_Reader`, which discards all
color data — so a colored model (e.g. the office-chair STEP that motivated this
work) loses its colors and looks uniformly gray.

This is the second of two rendering issues raised against imported STEP
geometry. The first — open sheet surfaces rendering one-sided (backface
culling) — was fixed separately by setting `side: THREE.DoubleSide` on the
viewport part materials. This spec covers **colors only**.

## Goal

Read **per-body** colors from STEP files and apply them as the default render
color of the imported part — in both the single-part viewport and the assembly
viewport — while letting the existing user color-override system always win.
Uncolored STEP files must render exactly as they do today (gray).

## Scope decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Granularity | **Per-body** (each solid/shell → one color) | Covers ~95% of real furniture STEP; maps cleanly to the explode-into-assembly path where each body is already a component. Per-face is ~3× the plumbing (face-name→color map, THREE geometry groups, material arrays) and deferred. |
| Storage | **Part-level default + assembly override** | Persist the color on the imported part/feature; part-mode renders it; assembly uses it as a fallback below user overrides. Survives save/reload. |
| Validation | **Both** | Committed synthetic colored STEP fixture for fast CI; the real chair `.step` for the early spike + manual confidence. |
| OCCT extraction | **Approach B — replace the reader** | Single parse via `STEPCAFControl_Reader`; no double-parse perf/heap regression. |
| Manifest | **No version bump** | Optional additive fields, matching the v9/v10/v12 precedent. |

## Out of scope

- Per-face coloring (deferred follow-up).
- Textures / material maps (STEP has no such concept).
- Reading other XCAF metadata (names, layers, materials/PMI).
- Re-coloring or color-editing UI (the existing override UI already exists).

## Architecture

### Approach B vs A (why B)

STEP colors live in OCCT's XCAF document. The chosen approach **replaces** the
plain reader rather than running a second parse:

- **B (chosen):** `importStep` uses `STEPCAFControl_Reader` → `TDocStd_Document`
  with `SetColorMode(true)`. Geometry is pulled from the XCAF doc (the same
  B-rep `STEPControl_Reader` would have produced), and the per-solid color map
  is built from the *same* document. **Single parse**, no perf regression, no
  double-heap.
- **A (rejected as default):** keep `STEPControl_Reader` and additionally run
  `STEPCAFControl_Reader` to build a `shape→color` map. Parses the file twice —
  contradicts the documented 171MB perf budget (~8.75 min) and a previously
  observed WASM heap leak from double-parsing. Retained only as a guarded
  fallback (size-limited) if the spike shows B perturbs geometry/face-naming.

**Risk B introduces:** `STEPCAFControl_Reader`'s shape output could differ
subtly from `STEPControl_Reader` (extra compound nesting, sub-shape ordering),
which could perturb the face-naming that feeds drawing projection. The early
spike de-risks this before any downstream work.

### Components & data flow

```
STEP file
  │  STEPCAFControl_Reader + TDocStd_Document (SetColorMode true)
  ▼
readStep ──► { shape, …, solidColors: (string|null)[] }    [kernel/occt/StepIO.ts]
  │   per solid (canonical TopExp order): GetColor(solid, ColorSurf|ColorGen) → hex
  ▼
importStep caches solidColors by brepBlobId                [kernel/api.ts]
  │   (importStep + splitImportedShape are SEPARATE round-trips; the XCAF doc
  │    is gone by split time, so colors are extracted at import and cached)
  ▼
splitImportedShape ──► looks up cached solidColors, passes to helper
  │   splitImportedShapeHelper(oc, compound, solidColors?) assigns color[i]
  ▼
ExtractedSolid { brepBlobId, boundingBox, shape, color? }  (hex string)
  │   API returns solids: [{ brepBlobId, boundingBox, color? }]
  ▼
importStepIntoNewParts ──► registerOne(blobId, name, color?) [app/import/...]
  ▼
buildImportedPartDocument(name, blobId, file, partId?, color?)
  │   sets ImportedFeature.color (hex) + PartDocument.color ({kind:'hex'})
  ▼
PartDocument { …, color?: ComponentColor }                 [shared/types.ts]
  ├──────────────► single-part view: SceneManager.setMesh(pos, idx, colorHex?)
  │                                  (App.tsx setMesh call sites)
  └──────────────► explode/insert: stamp ComponentInstance.color from part color
                                   → resolveColor reads c.color (override wins)
```

**Color extraction timing (the two-round-trip wrinkle):** `importStep` and
`splitImportedShape` are separate kernel calls. The `XCAFDoc_ColorTool` only
lives during the import parse, so per-solid colors are extracted inside
`readStep` (enumerating solids in canonical `TopExp_Explorer` order, identical
to the order `splitImportedShapeHelper` uses), returned as a `(string|null)[]`,
cached by `importStep` keyed on `brepBlobId` in a new `importedColorCache`, and
consumed by `splitImportedShape`. `splitImportedShapeHelper` itself stays free
of any XCAF dependency — it takes an optional `solidColors` array — so it is
unit-testable with a synthetic compound + colors.

### Units / responsibilities

1. **`StepIO.ts` + `api.ts` — color-aware reader + split.**
   - `readStep`: switch to `STEPCAFControl_Reader` + `TDocStd_Document` +
     `SetColorMode(true)`. After obtaining the compound, enumerate solids in
     canonical `TopExp_Explorer_2(shape, SOLID, SHAPE)` order and, for each, look
     up its color via `GetColor(solidShape, XCAFDoc_ColorSurf, …)`, falling back
     to `XCAFDoc_ColorGen`; OCCT resolves up the label hierarchy (inherited
     assembly-node color). Convert `Quantity_Color`/`Quantity_ColorRGBA` → hex
     string. Return `solidColors: (string | null)[]` (index-aligned with the
     solid enumeration; `null` when uncolored). Then dispose the XCAF doc.
   - `importStep` (`api.ts`): cache `result.solidColors` keyed by `brepBlobId`
     in a new `importedColorCache: Map<string, (string|null)[]>`.
   - `splitImportedShape` (`api.ts`): look up `importedColorCache.get(brepBlobId)`
     and pass it to `splitImportedShapeHelper(occt, cached, solidColors)`; return
     each solid's `color?` in the API result.
   - `splitImportedShapeHelper`: new optional `solidColors?: (string|null)[]`
     param. In the pass-1 loop, set `color: solidColors?.[i] ?? undefined` on each
     `ExtractedSolid`. No XCAF dependency in the helper → unit-testable with a
     synthetic compound + colors array.

2. **`shared/src/types.ts` — data model.**
   - `ImportedFeature.color?: string` (hex).
   - `PartDocument.color?: ComponentColor` (reuse the type already used by
     `colorOverrides` / `ComponentInstance.color`).
   - Both optional → no manifest bump (additive, per v9/v10/v12 precedent). A
     no-op v19→v20 migration may be added only if the codebase convention wants
     explicitness; default is no bump.

3. **App import pipeline.**
   - `buildImportedPartDocument` takes optional `color`; sets
     `PartDocument.color` and the `ImportedFeature.color`.
   - `importStepIntoNewParts` threads each solid's color into its part doc.

4. **Rendering — single-part view.**
   - `SceneManager.setMesh(positions, indices, color?)` — optional color arg;
     material uses it, falling back to `0xc8c8c8` when absent.
   - Update all three `setMesh` call sites in `App.tsx` (≈1072, 1282, 1750) to
     pass `activePart.color`.

5. **Rendering — assembly view.**
   - **No change to `resolveColor`.** The assembly view picks up STEP color
     because the explode/insert commands stamp it onto the `ComponentInstance`
     (see #6). `resolveColor` already reads `c.color` (line 18) below the user
     `colorOverrides` check (line 10), so a user override always wins.
   - *Rationale for revising original spec decision #5:* `resolveColor`'s cache
     (`SubAssemblyCache`) only holds `.ziasm` assembly docs, not `.zipt` part
     docs, so a part-intrinsic fallback tier cannot reach the leaf part's color
     without new render-path plumbing (per-leaf `.zipt` load + `partPath→color`
     map). Stamping `instance.color` achieves the identical user-visible
     behavior (STEP color by default, override wins) in ~3 lines, persists
     naturally in the `.ziasm`, and needs no new cache. The earlier claim that
     stamping "blocks re-coloring" was wrong — overrides are checked first.
     Cosmetic trade-offs: each instance carries its own color copy, and the BOM
     color column shows the STEP color as if user-set. Accepted.

6. **Explode / insert commands.**
   - `ExplodeIntoAssemblyCommand` and `ImportStepAsComponentCommand` read each
     imported part's `PartDocument.color` and set it on the created
     `ComponentInstance.color`. A user `colorOverride` still wins (checked first
     in `resolveColor`).

## Error handling / fallback

- No color in file, or `GetColor` returns false → `undefined` → gray
  (today's behavior). The feature is purely additive: an uncolored STEP renders
  exactly as before.
- If the spike shows Approach B perturbs geometry or face-naming, fall back to
  Approach A guarded by a file-size limit (large files keep the single-parse,
  color-less path rather than risk the double-heap).

## Testing strategy

- **Spike (gates everything):** run `STEPCAFControl_Reader` against the real
  chair `.step` and a synthetic colored cube. Assert (a) colors are returned,
  (b) the resulting shape tessellates and face-names identically to the
  `STEPControl_Reader` path, (c) no perf regression on a large file.
- **Kernel unit:** synthetic colored multi-body STEP fixture →
  `splitImportedShapeHelper` returns the expected per-solid hex; uncolored
  fixture → `undefined`.
- **App unit:** `buildImportedPartDocument` sets `PartDocument.color`
  (`{kind:'hex'}`) + `ImportedFeature.color`; `importStepIntoNewParts` threads
  per-solid color; explode/insert stamp `ComponentInstance.color` from the part
  color; `resolveColor` precedence unchanged (override still beats instance
  color).
- **E2E:** import the synthetic colored STEP, assert the rendered mesh material
  color; reload and assert persistence (real bus).
- **Manual:** load the chair, confirm per-body colors render together with the
  DoubleSide fix.

## TDD slice outline (for the plan)

1. **Spike** — `STEPCAFControl_Reader` reads color + geometry equivalence
   (RED: assert color array non-empty + face-name parity).
2. **Kernel split color** — `ExtractedSolid.color` populated from `colorTool`.
3. **Data model** — optional `color` fields on `ImportedFeature` / `PartDocument`.
4. **Import plumbing** — `buildImportedPartDocument` + `importStepIntoNewParts`
   thread color.
5. **Single-part render** — `setMesh(colorHex?)` + call sites.
6. **Explode/insert** — stamp `ComponentInstance.color` from `PartDocument.color`
   (assembly view colors via the existing `resolveColor` `c.color` path).
7. **E2E + manual** — colored STEP round-trip (single-part + exploded assembly)
   + chair.

Each slice: failing test first → minimum code → green → suite green.

## Open items carried into implementation

- The chair `.step` path (needed for the spike + manual check) — to be provided
  by the user at implementation time.
- Exact `Quantity_Color` → hex conversion (sRGB vs linear): confirm in the
  spike against the chair's expected colors.
