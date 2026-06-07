# PBR Textures Phase 3 — Textured image export + autosave thumbnails

**Date:** 2026-06-07
**Status:** Design approved
**Builds on:** Phase 1 (built-in CC0 textures + grain UVs), Phase 2 (user-uploaded custom textures + per-document persistence, manifest v20)

## Premise correction (load-bearing)

The original Phase 3 seed ("bake textures into exports — exports are flat color") was **largely false**, confirmed by code exploration:

- **Thumbnails are already textured.** There is exactly one `WebGLRenderer` (`SceneManager.ts:100`, `preserveDrawingBuffer: true`). `captureThumbnail()` does a live readback of the textured viewport via `toBlob`. "Save As…" already embeds a grain-textured thumbnail.
- **There is no standalone "Export 3D image / Save as PNG" feature at all.** The only render-to-image path is `captureThumbnail`, fired only inside Save As.
- **Drawing PNG/PDF/SVG and Nesting PNG are flat-color 2D paths** (no THREE.js) — deliberately hatch/flat (a Phase 1 cut). **Not** Phase 3 targets.
- **Real latent bug:** autosave passes an **empty** thumbnail (`App.tsx` ~3806/3811 → `new Uint8Array()`), so OPFS copies have blank thumbnails → **Place Component dialog tiles are blank** until a manual Save As.

So Phase 3 is re-scoped to the two pieces of genuine value: **add the textured image-export feature that doesn't exist yet**, and **fix the blank-autosave-thumbnail bug**. Both are app-layer only.

## Scope

Two deliverables. **No manifest bump, no kernel changes, no migration** — thumbnails are already part of the file format; custom textures already persist at v20.

### A. Export 3D view as PNG

A user-triggered action to save the current 3D viewport as a PNG to disk, with the textures the user sees.

**`SceneManager.captureViewportPng({ transparent }: { transparent: boolean }): Promise<Uint8Array>`** (new)
- Renders at the **current** on-screen canvas size (no resize → no flicker, WYSIWYG). Calls `this.render()` for a fresh frame, then `canvas.toBlob(…, 'image/png')`. Works because `preserveDrawingBuffer: true` is already set.
- **Opaque (default):** uses the live scene background as-is.
- **Transparent:** stash `scene.background`; set `scene.background = null` and `renderer.setClearAlpha(0)`; `render()`; `toBlob`; then restore `scene.background` + `setClearAlpha(1)` and `render()` again.
- Returns PNG `Uint8Array` (matches `captureThumbnail`'s return shape).

**Renderer constructor change:** `new THREE.WebGLRenderer({ canvas, antialias: …, preserveDrawingBuffer: true, alpha: true })` — add `alpha: true` (currently unset; WebGL default is false). Needed for a transparent clear. Opaque rendering is unaffected: a set `scene.background` paints fully opaque over the transparent clear.

**FileTab UI:**
- An **"Export Image"** button + a **"Transparent background"** checkbox, in the same area as Save As…
- Inline `handleExportImage(transparent: boolean)` (mirrors the existing inline `handleSaveAs` — not a Command, because export is a non-undoable side effect):
  - `const bytes = await viewport.captureViewportPng({ transparent });`
  - `await triggerDownload(new Blob([bytes], { type: 'image/png' }), { suggestedName: `${name}.png`, mimeType: 'image/png', extension: 'png', description: 'Image PNG' });`
  - `name` from `activeDocument.document.name`.
- **Disabled when `activeDocument.kind === 'drawing'`** (no 3D viewport).
- Reuses `triggerDownload` from `nesting/triggerDownload.ts` (handles `showSaveFilePicker` + anchor-download fallback) — the same helper every export command uses.

### B. Fix blank autosave thumbnails

Make autosave embed a real, textured thumbnail without causing viewport flicker.

**`SceneManager.captureThumbnailScaled(size: number): Promise<Uint8Array>`** (new)
- Draws the live WebGL canvas into a `size × size` 2D canvas via `ctx.drawImage(...)`, **center-cropped to a square** (largest centered square region of the source → `size × size`) to avoid aspect distortion. **No WebGL resize** → no on-screen flash. Cheap PNG encode (small canvas).
- Calls `this.render()` first to ensure the source frame is fresh.
- Returns PNG `Uint8Array`.

**Autosave wiring (`App.tsx` autosave effect, ~3752–3827):**
- Add throttled thumbnail caching via refs: `lastThumbBytesRef` (`Uint8Array | null`) and `lastThumbTimeRef` (`number`).
- Inside the autosave async callback, before packing:
  - `const vp = useAppStore.getState().viewport;`
  - If `vp` and (`lastThumbBytesRef.current === null` **or** `Date.now() - lastThumbTimeRef.current > THUMB_THROTTLE_MS`): `lastThumbBytesRef.current = await vp.captureThumbnailScaled(256); lastThumbTimeRef.current = Date.now();`
  - Pack `lastThumbBytesRef.current ?? new Uint8Array()` as the thumbnail (for both `packAssembly(merged, thumb, …)` and `kernel.saveToBytes(doc.document.id, thumb)`).
- `THUMB_THROTTLE_MS = 5000`. First autosave captures immediately (cache null). The active doc saved by autosave **is** the live-rendered doc, so the capture is contextually correct.

**Viewport ref:** `Viewport.tsx` exposes `captureViewportPng` and `captureThumbnailScaled` on `ViewportRef` (delegating to the SceneManager), alongside the existing `captureThumbnail` / `getSceneManager`.

## Data flow

```
Export:   FileTab "Export Image" → viewport.captureViewportPng({transparent})
          → triggerDownload → disk (showSaveFilePicker / anchor fallback)

Autosave: 500ms timer → (throttled ≥5s) viewport.captureThumbnailScaled(256)
          → cached bytes → packAssembly / kernel.saveToBytes thumbnail arg
          → OPFS .ziasm/.zipt → Place Component dialog <img> tile (textured)
```

## Components touched

- `packages/app/src/viewport/SceneManager.ts` — renderer `alpha: true`; new `captureViewportPng`, `captureThumbnailScaled`.
- `packages/app/src/viewport/Viewport.tsx` — expose the two new methods on `ViewportRef`.
- `packages/app/src/shell/tabs/FileTab.tsx` — Export Image button + Transparent checkbox + `handleExportImage`.
- `packages/app/src/App.tsx` — autosave throttled thumbnail capture (replace `new Uint8Array()` thumbnail args).

## Error handling

- `captureViewportPng` / `captureThumbnailScaled` throw if `toBlob` returns null (matches existing `captureThumbnail`). The transparent path restores `scene.background` + clear alpha in a `finally` so a failed capture never leaves a transparent viewport.
- `handleExportImage`: if `viewport` is absent, no-op (button is disabled when no 3D doc, but guard anyway). `triggerDownload` already swallows the user-cancel `AbortError`.
- Autosave: thumbnail capture wrapped so a capture failure falls back to the previous cached bytes (or empty) and never aborts the save.

## Testing

TDD slices (each: failing test → minimal code → green):

1. `captureViewportPng` opaque returns PNG bytes; calls `render()` then `toBlob` at current size (no `setSize`).
2. `captureViewportPng` transparent: stashes/restores `scene.background`, calls `setClearAlpha(0)` then restores; renderer constructed with `alpha: true`.
3. `captureThumbnailScaled`: **no `setSize` call**; draws into `size × size`; returns bytes; center-crop math correct for a non-square source.
4. FileTab: Export Image button present + enabled for part/assembly, **disabled for drawing**; Transparent checkbox toggles the arg; `triggerDownload` invoked with `<name>.png`.
5. Autosave: packers receive non-empty thumbnail bytes; throttle reuses the cached bytes within `THUMB_THROTTLE_MS`; first capture is immediate.
6. **e2e (§6 real-environment gate):** open a textured part → click Export Image (opaque + transparent) → decode the downloaded blob in-page and assert pixel-variance (grain present); then trigger autosave and verify the Place Component dialog tile renders the textured model. Screenshots/blobs read back by the controller.

## Out of scope (confirmed)

- Drawing PNG/PDF/SVG + Nesting PNG stay flat hatch/color (deliberate Phase 1 cut).
- No resolution dialog; no higher-than-screen-resolution export (WYSIWYG current size only).
- No "remove custom texture" / GC (deferred to Phase 2.5).
