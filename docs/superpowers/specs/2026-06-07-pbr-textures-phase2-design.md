# PBR Textures Phase 2 — User-Uploaded Custom Textures + Persistence

**Date:** 2026-06-07
**Status:** Approved (design)
**Builds on:** Phase 1 (`docs/superpowers/specs/2026-06-06-pbr-textures-phase1-design.md`, shipped master `3086fdd`)

## Goal

Let users upload their own texture image(s) per material, assign them like the
built-in CC0 library, and have them survive project reopen + Save-As-to-disk.
Phase 1 shipped the built-in library + grain-aligned kernel-baked UVs + a picker;
the plumbing (`MaterialEntry.textureId`) already persists. Phase 2 adds the
upload UI, the byte storage, and the runtime loader for user-supplied textures.

## Locked design decisions (brainstorm)

| Axis | Decision |
|------|----------|
| Storage scope | **Per-document** — bytes packed into the part/assembly file; metadata in a new `customTextures[]` field. Self-contained, survives Save-As, mirrors imported B-rep bodies. (Not a cross-project OPFS library.) |
| PBR maps | **Albedo required + normal/roughness optional** — full parity with built-ins; loader already supports optional maps. |
| Upload UI | **Dedicated small modal dialog** opened from the material editor. |
| Image processing | **Auto-downscale on upload** — canvas re-encode, longest edge ≤1024px, uniform JPEG q≈0.9 (matches built-in `.jpg` assets, bounds file growth). |
| Remove/GC | **Deferred** — an uploaded-but-unassigned texture persists in the file; no delete action in v1. |

## Non-goals (deferred)

- Cross-project texture library (upload once, reuse everywhere).
- Deleting / garbage-collecting unused custom textures.
- Per-instance grain-rotation override.
- Textured exports / thumbnails (that is Phase 3).
- Any kernel geometry change — texture images are app-side only; the kernel
  already bakes grain UVs independent of texture choice, so custom textures get
  grain alignment for free.

## Architecture

### 1. Data model (`packages/shared`)

New persisted type, namespaced ids to distinguish from built-ins:

```ts
interface CustomTextureDef {
  id: string;                 // 'custom-<ulid>'
  name: string;
  physicalWidthMm: number;
  physicalHeightMm: number;
  albedoBlobId: string;       // → container bytes (textures/<blobId>.jpg)
  normalBlobId?: string;
  roughnessBlobId?: string;
}
```

Add `customTextures?: CustomTextureDef[]` to **both** `PartDocument` and
`AssemblyDocument` (parallel to their existing `materials[]`). A `MaterialEntry`
whose `textureId` starts with `custom-` resolves to a `CustomTextureDef` instead
of a `BUILTIN_TEXTURE_DEF`.

### 2. Persistence

- **Metadata** rides for free in `manifest.document.customTextures[]` (JSON).
- **Bytes** packed as tar entries under a `textures/<blobId>.jpg` prefix,
  parallel to the existing `blobs/<id>.brep`. Extend the same pack/unpack path
  that already handles `blobs`. Uniform JPEG → no per-blob mime tracking.
- **Manifest `CURRENT_FORMAT_VERSION` 19→20** + no-op backfill migration that
  sets `customTextures: []` on documents lacking it. Follows the established
  additive-field migration pattern (v9 `materials: []`, v11 `hardware: []`).
- OPFS autosave and disk Save-As both carry the new `textures/` entries — same
  serialization chokepoint as part bytes / imported B-rep blobs.

### 3. Runtime loading + registry (`packages/app`)

On document activate/load, for each `customTextures[]` entry:

1. Read its bytes from the unpacked container.
2. `URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))` per map.
3. Build a runtime `TextureDef` (object URLs + mm) and register it in a
   **per-document custom-texture runtime registry**.

Texture resolution becomes `findTextureDef(id) ?? customRegistry.get(id)`.
`textureCache` is unchanged — it already accepts any URL (http or blob).
**Revoke object URLs on document teardown**, mirroring the existing
`textureCache` dispose discipline (and the Phase 1 `partTextureIdCacheRef`
invalidation pattern).

### 4. Upload dialog

"Upload custom texture…" button in `MaterialRegistryEditor` opens a modal:

- **Name** (text).
- **Albedo** file input (required).
- **Normal** / **Roughness** file inputs (optional).
- **Physical width / height mm** (default 1000×1000, editable) — drives
  `repeat = 1/mm` exactly as built-ins do.

On confirm → downscale each provided map → `AddCustomTextureCommand`.

### 5. Downscale util

Canvas re-encode: longest edge ≤1024px, output JPEG q≈0.9, uniform format.
Returns `Uint8Array` per map. Pure-ish util (takes an image source, returns
bytes) so it is unit-testable.

### 6. Command + store wiring

`AddCustomTextureCommand` (undo/redo capable):

- apply: append the `CustomTextureDef` to `document.customTextures[]`, stash the
  byte blobs in the store/runtime registry, trigger autosave.
- revert: remove the def + its registry entries (revoke URLs).

After add, the new texture appears in the picker `<select>` for that document and
is assigned via the **existing** `EditMaterialCommand` path →
`syncPartMaterials` → SceneManager material rebuild. No new assignment path.

## TDD slices (red→green each)

1. **shared** — `CustomTextureDef` type + `customTextures` field + v20 migration
   (backfill `[]`) + migration test.
2. **downscale util** — cap longest edge ≤1024, JPEG output, dimensions assert.
3. **persistence** — pack/unpack `textures/<id>.jpg` entries round-trip
   (metadata + bytes survive).
4. **runtime registry** — build defs from container bytes, resolution
   (`findTextureDef ?? registry`), URL revoke on teardown.
5. **AddCustomTextureCommand** — apply/revert (document + registry).
6. **upload dialog UI** — render, file inputs, mm fields, dispatch.
7. **e2e (§6 gate)** — upload → assign to a panel → textured render (pixel
   variance) → reload project → still textured. Read screenshots back.

## Verification (CLAUDE.md §6 — the gate)

E2E in real Chromium driving the actual upload dialog with a real JPEG fixture,
WebGL pixel-variance assertion that the panel renders textured, then a project
reload asserting it is still textured. Screenshots read back by the controller.
Phase 1's entire value-add came from real-render verification catching
integration bugs invisible to unit tests — same discipline here. One committed
test image fixture required (a genuine small texture, not a fabricated one).

## Open risks / flags

- **Exact pack integration point** (`kernel/src/storage/ProjectPacker.ts` vs an
  app-side serializer) confirmed during planning; bytes originate app-side and
  are threaded to whatever packs `document` + `blobs`.
- **No GC** in v1: an uploaded-but-unassigned texture persists in the file
  (acceptable; delete/GC deferred).
- Normal/roughness through JPEG q0.9 is a mild fidelity compromise; acceptable
  for furniture realism.
- Asset-sourcing rule: the e2e test fixture must be a genuine image, never a
  fabricated/approximated one.
