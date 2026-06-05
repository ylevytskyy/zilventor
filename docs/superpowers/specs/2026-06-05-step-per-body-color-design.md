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
importStep ──► { shape, colorTool }                       [kernel/occt/StepIO.ts]
  │
  ▼
splitImportedShapeHelper(oc, compound, colorTool)          [kernel/occt/StepIO.ts]
  │   per solid: colorTool.GetColor(solid, ColorSurf|ColorGen) → hex
  ▼
ExtractedSolid { brepBlobId, boundingBox, shape, color? }
  │
  ▼
importStepIntoNewParts ──► per-solid color                 [app/import/...]
  │
  ▼
buildImportedPartDocument(name, blobId, file, partId?, color?)
  │   sets PartDocument.color + ImportedFeature.color
  ▼
PartDocument { …, color?: ComponentColor }                 [shared/types.ts]
  ├──────────────► single-part view: SceneManager.setMesh(pos, idx, color?)
  │                                  (App.tsx call sites 1072/1282/1750)
  └──────────────► assembly view: resolveColor() fallback tier
                                   (visibleLeaves.ts)
```

### Units / responsibilities

1. **`StepIO.ts` — color-aware reader + split.**
   - `importStep`: switch to `STEPCAFControl_Reader` + `TDocStd_Document` +
     `SetColorMode(true)`; expose `colorTool` (and shape) to the splitter.
   - `splitImportedShapeHelper`: new `colorTool` param. In the pass-1 solid
     loop, look up each solid's color via
     `GetColor(solidShape, XCAFDoc_ColorSurf, …)`, falling back to
     `XCAFDoc_ColorGen`; OCCT resolves up the label hierarchy (inherited
     assembly-node color). Convert `Quantity_Color`/`Quantity_ColorRGBA` → hex
     string. Attach as `ExtractedSolid.color?`.
   - `undefined` when the solid carries no color.

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
   - `resolveColor` in `visibleLeaves.ts` gains a new **lowest-priority** tier:
     below user `colorOverrides` and explicit `ComponentInstance.color`, fall
     back to the leaf part's intrinsic `PartDocument.color` (looked up via the
     `SubAssemblyCache` part entry). STEP color shows by default; any user
     override always wins.

6. **Explode / insert commands.**
   - `ExplodeIntoAssemblyCommand` and `ImportStepAsComponentCommand` do **not**
     stamp color onto the created `ComponentInstance` (that would read as a user
     override and block re-coloring). They leave instance color empty and rely
     on the `resolveColor` part-color fallback. (Simpler than seeding
     `instance.color`; keeps the override channel clean.)

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
- **App unit:** `resolveColor` precedence
  (override > instance > part-intrinsic > gray); `buildImportedPartDocument`
  sets `PartDocument.color` + `ImportedFeature.color`.
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
5. **Single-part render** — `setMesh(color?)` + call sites.
6. **Assembly render** — `resolveColor` part-intrinsic fallback tier.
7. **Explode/insert** — verify fallback path colors components (no instance
   stamping).
8. **E2E + manual** — colored STEP round-trip + chair.

Each slice: failing test first → minimum code → green → suite green.

## Open items carried into implementation

- The chair `.step` path (needed for the spike + manual check) — to be provided
  by the user at implementation time.
- Exact `Quantity_Color` → hex conversion (sRGB vs linear): confirm in the
  spike against the chair's expected colors.
