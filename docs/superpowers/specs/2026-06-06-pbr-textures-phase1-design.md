# PBR Textures — Phase 1 (3D viewport) Design

**Date:** 2026-06-06
**Status:** Approved (brainstorm), pending implementation plan
**Author:** brainstorm with levytskyy

## Context

Today zilventor renders all 3D meshes with flat solid color. `MeshStandardMaterial`
is built with a `color` only — no `.map`, no UV coordinates on geometry. The material
registry (`packages/shared/src/material.ts`) defines a surface with a single hex `color`
(plus sheet dimensions and 2D-drawing hatch params). 2D drawings deliberately use hatch
patterns (`hatchAngleDeg`/`hatchSpacingMm`) and that convention stays.

The user (furniture-CAD team, Inventor 2012) wants realistic textured panels — wood grain
and laminate — in the 3D viewport, with the grain running the correct direction on each
panel.

## Scope decomposition

Texture support is a sub-project. It ships in phases, each its own spec → plan → ship:

| Phase | Scope |
|---|---|
| **1 (this spec)** | PBR rendering in the **3D viewport** (parts + assemblies); built-in texture library; grain-direction-aware UVs baked in the kernel; color overrides tint the texture; solid color stays the fallback. |
| 2 | User-uploaded custom maps per material, persisted into project files + upload UI. |
| 3 | Bake textures into rendered thumbnails / screenshot / PNG exports. |
| 4 | **Cut.** 2D drawings stay on hatch by convention. (Only revisit if a real need appears, scoped to shaded iso views — never section/ortho hatch.) |

## Goal (Phase 1)

Furniture panels (and imported bodies) render with grain-aligned PBR maps
(color + normal + roughness) in the 3D viewport, from a built-in texture library, with
explicit color overrides tinting the texture. Solid color remains the fallback when a
material has no texture. Drawings, nesting, cut-list, and exports are unchanged.

## Key decisions (locked in brainstorm)

1. **Full PBR maps** (albedo + normal + roughness), not solid-color-only and not procedural.
2. **Mapping: UVs baked in the kernel** (the heaviest of the three options, chosen
   deliberately so UVs travel with the mesh and arbitrary imported geometry is handled
   uniformly). The kernel tessellator stays geometry-only; its **caller** (`FeatureTree`)
   supplies the projection frame, bridging grain knowledge from the feature layer.
3. **Grain direction matters** — U runs along the panel's grain axis.
4. **Color override tints the texture** (multiply), it does not replace it.
5. **Built-in library first**; uploads are Phase 2.

## Architecture

### 1. Data model — `packages/shared`

- New built-in **texture registry** `TextureDef`:
  ```ts
  interface TextureDef {
    readonly id: string;
    readonly name: string;
    readonly albedoUrl: string;
    readonly normalUrl?: string;
    readonly roughnessUrl?: string;
    readonly physicalWidthMm: number;   // real-world size the image spans
    readonly physicalHeightMm: number;
  }
  ```
  A static array of built-in defs; the image assets ship with the app
  (`packages/app`). Library content: ~6 starter textures — 3 woods
  (oak / walnut / beech), white melamine, black melamine, 1 laminate.

- `MaterialEntry` gains optional `textureId?: string` (additive). `color` stays required
  and is the fallback. The `isMaterialEntry` validator is extended to accept (and validate)
  an optional string `textureId`. No manifest bump — `textureId` is an optional field on the
  per-project material registry, which already serializes. **(Planner confirms back-compat.)**

### 2. Grain → UV projection bridge — `packages/shared` + `FeatureTree`

- New pure type:
  ```ts
  type UvProjection =
    | { mode: 'planar'; origin: Vec3; uAxis: Vec3; vAxis: Vec3 }  // part-local mm
    | { mode: 'box' };
  ```
- Pure helper `panelUvProjection(panel: PanelFeature): UvProjection` in shared, unit-tested:
  - `grain: 'length'` → `uAxis` = panel local X (length), `vAxis` = local Y (width).
  - `grain: 'width'`  → `uAxis` = local Y, `vAxis` = local X (90° swap).
  - `grain: 'none'`   → same as `'length'` (orientation irrelevant).
  - `origin` = panel local origin. (Panel local axes per existing convention:
    thickness = Z, width = Y, length = X.)
- `FeatureTree`, at the `tessellate` call (~`FeatureTree.ts:892`), selects the projection:
  top feature is a `PanelFeature` → `panelUvProjection(panel)`; otherwise → `{ mode: 'box' }`.
  Passes it into `tessellate`.

### 3. Kernel — `Tessellator.ts`

- `Mesh` (in `packages/shared/src/types.ts`) gains optional `uv?: Float32Array`
  (2 floats per vertex). Derived/transient — recomputed on rebuild, not serialized — so the
  field is additive in-memory only.
- `tessellate(occt, shape, opts, projection?)`:
  - **planar**: for each existing vertex `p`,
    `uv = [ dot(p − origin, uAxis), dot(p − origin, vAxis) ]`, in **millimeters**. Cheap,
    reuses existing vertex/index buffers, indexing untouched.
  - **box** (imported / non-panel): per-triangle dominant-normal planar projection. Because
    a vertex shared across faces of different dominant axes needs distinct UVs, **box meshes
    are de-indexed** (expand to per-triangle vertices). Acceptable for imported parts; grain
    has no meaning there.
  - `projection` omitted → no `uv` emitted (unchanged behavior for callers that don't pass it,
    e.g. drawing projector input).
- UVs are emitted in **millimeters**; texture scale is applied later via Three.js `repeat`,
  decoupling UV generation from texture image resolution.

### 4. App / rendering — `SceneManager` + `App.tsx`

- The `uv` attribute is piped through the `App.tsx` geometry setup
  (`geom.setAttribute('uv', new THREE.BufferAttribute(mesh.uv, 2))`) alongside
  positions/indices, before `computeVertexNormals()`.
- New texture loader/cache: for a `textureId`, lazy-load albedo / normal / roughness via
  `THREE.TextureLoader`; set `wrapS = wrapT = THREE.RepeatWrapping`. Because the baked UVs are
  already in millimeters, tiling at real physical size is just
  `texture.repeat.set(1 / physicalWidthMm, 1 / physicalHeightMm)` (a UV value of
  `physicalWidthMm` mm maps to exactly one image tile). Cache textures by `textureId`; dispose
  on unload.
- Material build (extends the existing per-color cache in `SceneManager`):
  - Resolved material has `textureId` → `MeshStandardMaterial` with `.map`, `.normalMap`,
    `.roughnessMap`, and `.color` = override tint (`overrideColor ?? 0xffffff`). Tint
    multiplies the albedo (per decision 4).
  - No `textureId` → solid color `MeshStandardMaterial`, exactly as today.
  - Material cache key becomes `${textureId ?? 'none'}|${tintHex}` (was hex only).
- The color-override resolution (`resolveColor`, per-component `ComponentInstance.color` and
  palette overrides) is unchanged; its result becomes the **tint** instead of replacing the
  surface color.

### 5. Built-in library assets — `packages/app`

- ~6 CC0-sourced PBR sets: JPG albedo + PNG normal/roughness, 1–2K resolution, stored under
  the app's public assets. KTX2/Basis compression deferred.
- **Asset sourcing rule:** real texture sets only. If a genuine CC0 set cannot be obtained for
  a slot, stop and ask the user — never fabricate, approximate, or ship a placeholder.

## Out of scope (Phase 1)

- User uploads + project persistence of custom maps (Phase 2).
- Export / thumbnail / screenshot baking (Phase 3).
- Any change to 2D drawings — they stay on hatch.
- KTX2/Basis compression, anisotropic filtering tuning, AO/metalness maps (future polish).
- Per-instance grain rotation UI beyond the panel's own `grain` field.

## Testing strategy

- **Unit (shared):** `panelUvProjection` for `length` / `width` / `none` produces the correct
  U/V axes (width is a 90° swap of length); planar UV math; box dominant-axis selection;
  material cache key includes both `textureId` and tint.
- **Kernel integration:** tessellate a panel with a planar projection → `uv.length === positions.length`
  and U increases along the grain axis; tessellate with `box` → de-indexed, every vertex has a uv;
  no `projection` → `uv` is undefined (back-compat).
- **E2E + viewport screenshot read-back** (verification gate): a textured panel renders with
  visible grain; switching grain `length` ↔ `width` rotates the grain 90°; a color override
  visibly tints the texture. Screenshot captured and read back before claiming done.

## Risks / open items for the plan

- Confirm `Mesh` is truly not serialized anywhere (no manifest bump). If it is, add a migration.
- `FeatureTree` must reliably identify the top feature as a `PanelFeature` to choose the
  projection; verify the feature is available at the `tessellate` call site (~892).
- Box-projection de-indexing increases vertex count for imported parts; verify acceptable on the
  large STEP fixtures already in the repo.
- Sourcing 6 real CC0 PBR sets — flagged as an explicit plan task; ask the user if any slot can't
  be filled with a genuine asset.
