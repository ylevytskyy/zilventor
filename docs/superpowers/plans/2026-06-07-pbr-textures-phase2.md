# PBR Textures Phase 2 — User-Uploaded Custom Textures + Persistence — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-06-07-pbr-textures-phase2-design.md` (LOCKED)
**Phase 1 context:** `docs/superpowers/specs/2026-06-06-pbr-textures-phase1-design.md` (shipped master `3086fdd`)
**Date:** 2026-06-07
**Base branch for diffs:** `master` (this repo's default; confirm before long commit logs)

## Goal / success criteria

Users upload their own texture image(s) per material, assign them like the built-in
CC0 library, and have them survive project reopen + Save-As-to-disk. Verifiable done:

- A custom `CustomTextureDef` persists in a part/assembly file (metadata in
  `manifest.document.customTextures[]`, bytes as `textures/<blobId>.jpg` tar entries).
- An uploaded texture round-trips through pack→unpack with byte-identical maps.
- A material with `textureId` starting `custom-` renders textured in the 3D viewport.
- **E2E gate:** upload a real JPEG → assign to a panel → panel renders textured
  (WebGL pixel-variance > 25) → reload project from OPFS → still textured. Screenshots
  read back by the controller.

## Conventions for every task

- **TDD:** write the failing test FIRST, run it, confirm it fails *for the expected
  reason* (assertion mismatch — not import/typo), write the minimal impl, run it green,
  commit. One commit per task.
- **Test commands (load-bearing — wrong CWD silently skips/mis-resolves):**
  - **shared:** from repo root — `npx vitest run packages/shared/src/__tests__/<file>`
  - **kernel:** from repo root — `npx vitest run packages/kernel/src/storage/__tests__/<file>`
  - **app:** **MUST run from `packages/app/`** —
    `cd packages/app && npx vitest run --config vitest.config.ts <relpath-under-packages/app>`
    (the app vitest `setupFiles`/`test-setup.ts` localStorage+canvas shims resolve relative
    to that CWD; running from repo root swallows stdout and breaks jsdom config — auto-memory
    trap). Confirmed config at `packages/app/vitest.config.ts`.
- **No scope creep.** Real code in every step — no placeholders, no "similar to Task N".
- Remove only imports/vars your change orphaned. Match surrounding style.

---

## Anchor corrections vs the brief (verified against live files)

- `fileFormat.ts` + `CURRENT_FORMAT_VERSION = 19` live at **`packages/shared/src/fileFormat.ts:4`**,
  NOT `packages/kernel/src/storage/`. Migration table is a `Record<number, MigrateFn>`
  ending at key `18` (→ v19). (Brief said kernel/storage.)
- `PartDocument` is at `types.ts:70`, `AssemblyDocument` at `types.ts:101`; their
  `materials: MaterialEntry[]` are at `types.ts:78` and `:114` (brief ~78/~114 — close).
- The `ProjectFile` union (`types.ts:140-143`) hardcodes the version literal list and
  **must gain `20`** on all three arms.
- Part save chokepoint is **`packages/kernel/src/api.ts:327` `saveToBytes`** (re-runs tree,
  builds `manifest.document` by spreading the kernel's stored `part`, then `packProject`).
  NOT an app-side serializer for parts.
- Assembly save chokepoint is **app-side `packAssembly`** (`AssemblyPacker.ts:5`) called at
  **`App.tsx:3803`**; it writes ONLY `manifest.json` + `thumbnail.png` — **no blob entries
  today**. This is the real persistence gap for assemblies (Task 4b).
- `textureId → TextureDef` resolution is **`SceneManager.buildMaterial` at
  `SceneManager.ts:320`** (`findTextureDef(textureId)`), reached from `setMesh` (`:148`,
  part view) and `setComponentMeshes` (`:380`, assembly view). Insert `?? customRegistry.get(id)`
  there.
- SceneManager teardown that disposes textures is **`SceneManager.ts:709`
  `globalTextureCache.disposeTextures()`** (inside `dispose()`). URL revoke hooks here.
- Phase 1 per-part textureId cache invalidation: **`App.tsx:2531` `partTextureIdCacheRef`**,
  invalidated at **`App.tsx:2591`** (alongside `geometryCacheRef`). Resolution populated at
  **`App.tsx:3607`** / read at **`App.tsx:3640`**.

---

## Task 1 — shared: `CustomTextureDef` type + `customTextures?` field

**Files**
- Create `packages/shared/src/custom-texture-def.ts`
- Modify `packages/shared/src/types.ts` — add `customTextures?` to `PartDocument` (after
  `:79 hardware`) and `AssemblyDocument` (after `:115 hardware`); import the new type.
- Modify `packages/shared/src/index.ts` — re-export `CustomTextureDef`,
  `isCustomTextureDef` (find the existing `export * from './texture-def'` / barrel line and
  add the parallel line).
- Create `packages/shared/src/__tests__/custom-texture-def.spec.ts`

**Steps**

1. Write failing test `custom-texture-def.spec.ts`:
   ```ts
   import { describe, it, expect } from 'vitest';
   import { isCustomTextureDef, type CustomTextureDef } from '../custom-texture-def';

   describe('CustomTextureDef', () => {
     const valid: CustomTextureDef = {
       id: 'custom-01HZ', name: 'My Oak',
       physicalWidthMm: 1000, physicalHeightMm: 800,
       albedoBlobId: 'tex-abc',
     };
     it('accepts a minimal albedo-only def', () => {
       expect(isCustomTextureDef(valid)).toBe(true);
     });
     it('accepts optional normal + roughness blob ids', () => {
       expect(isCustomTextureDef({ ...valid, normalBlobId: 'n1', roughnessBlobId: 'r1' })).toBe(true);
     });
     it('rejects a def missing albedoBlobId', () => {
       const { albedoBlobId: _omit, ...rest } = valid;
       expect(isCustomTextureDef(rest)).toBe(false);
     });
     it('rejects a non-positive physical width', () => {
       expect(isCustomTextureDef({ ...valid, physicalWidthMm: 0 })).toBe(false);
     });
     it('rejects an empty id', () => {
       expect(isCustomTextureDef({ ...valid, id: '' })).toBe(false);
     });
   });
   ```
2. Run — fails: `Cannot find module '../custom-texture-def'`.
   `npx vitest run packages/shared/src/__tests__/custom-texture-def.spec.ts`
3. Create `custom-texture-def.ts`:
   ```ts
   /** A user-uploaded PBR texture set persisted into the project file.
    *  Blob ids point at `textures/<blobId>.jpg` tar entries (uniform JPEG). */
   export interface CustomTextureDef {
     readonly id: string;            // 'custom-<ulid>'
     readonly name: string;
     readonly physicalWidthMm: number;
     readonly physicalHeightMm: number;
     readonly albedoBlobId: string;
     readonly normalBlobId?: string;
     readonly roughnessBlobId?: string;
   }

   function isPositiveFinite(v: unknown): v is number {
     return typeof v === 'number' && Number.isFinite(v) && v > 0;
   }
   function isNonEmptyString(v: unknown): v is string {
     return typeof v === 'string' && v.length > 0;
   }

   export function isCustomTextureDef(v: unknown): v is CustomTextureDef {
     if (!v || typeof v !== 'object') return false;
     const d = v as Record<string, unknown>;
     if (!isNonEmptyString(d.id) || !isNonEmptyString(d.name)) return false;
     if (!isPositiveFinite(d.physicalWidthMm) || !isPositiveFinite(d.physicalHeightMm)) return false;
     if (!isNonEmptyString(d.albedoBlobId)) return false;
     if (d.normalBlobId !== undefined && !isNonEmptyString(d.normalBlobId)) return false;
     if (d.roughnessBlobId !== undefined && !isNonEmptyString(d.roughnessBlobId)) return false;
     return true;
   }
   ```
4. Add to `types.ts`: `import type { CustomTextureDef } from './custom-texture-def';`
   then `customTextures?: CustomTextureDef[];` on `PartDocument` and `AssemblyDocument`.
   Add `export { isCustomTextureDef } from './custom-texture-def';` and
   `export type { CustomTextureDef } from './custom-texture-def';` to `index.ts`.
5. Run — green. `npx tsc -b packages/shared` (type-check the field additions).
6. Commit: `feat(shared): add CustomTextureDef type + customTextures field on documents`.

---

## Task 2 — shared: v19→v20 migration (backfill `customTextures: []`) + manifest bump

**Files**
- Modify `packages/shared/src/fileFormat.ts` — `CURRENT_FORMAT_VERSION` `19 → 20` (`:4`);
  add migration key `19` after the `18:` entry (`:268-293`).
- Modify `packages/shared/src/types.ts` — add `20` literal to all three `ProjectFile`
  arms (`:141-143`).
- Create `packages/shared/src/__tests__/migrateManifest-v19-to-v20.spec.ts`
- Modify the existing version-assert tests that hardcode `19` (see step 5).

**Steps**

1. Write failing test `migrateManifest-v19-to-v20.spec.ts` (mirror the v9→v10 additive
   pattern — `migrateManifest-v9-to-v10.spec.ts` is the cleanest precedent):
   ```ts
   import { describe, it, expect } from 'vitest';
   import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

   describe('migrateManifest v19 → v20 (Phase 2 — customTextures backfill)', () => {
     it('CURRENT_FORMAT_VERSION is 20', () => {
       expect(CURRENT_FORMAT_VERSION).toBe(20);
     });
     it('v19 part without customTextures → v20 has customTextures: []', () => {
       const v19 = { formatVersion: 19, kind: 'part',
         document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
           properties: {}, materials: [], hardware: [] } };
       const out = migrateManifest(v19) as { formatVersion: number; document: { customTextures: unknown[] } };
       expect(out.formatVersion).toBe(20);
       expect(out.document.customTextures).toEqual([]);
     });
     it('v19 assembly without customTextures → v20 has customTextures: []', () => {
       const v19 = { formatVersion: 19, kind: 'assembly',
         document: { id: 'a', name: 'A', units: 'mm', parameters: {}, components: [],
           constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
           cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [], hardware: [] } };
       const out = migrateManifest(v19) as { formatVersion: number; document: { customTextures: unknown[] } };
       expect(out.formatVersion).toBe(20);
       expect(out.document.customTextures).toEqual([]);
     });
     it('does not clobber an existing customTextures array (idempotent)', () => {
       const existing = [{ id: 'custom-x', name: 'X', physicalWidthMm: 1000,
         physicalHeightMm: 1000, albedoBlobId: 'b' }];
       const v19 = { formatVersion: 19, kind: 'part',
         document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
           properties: {}, materials: [], hardware: [], customTextures: existing } };
       const out = migrateManifest(v19) as { document: { customTextures: unknown[] } };
       expect(out.document.customTextures).toEqual(existing);
     });
     it('leaves drawing documents untouched (no customTextures field)', () => {
       const v19 = { formatVersion: 19, kind: 'drawing',
         document: { id: 'd', name: 'D', units: 'mm', sheets: [], properties: {} } };
       const out = migrateManifest(v19) as { formatVersion: number; document: Record<string, unknown> };
       expect(out.formatVersion).toBe(20);
       expect(out.document.customTextures).toBeUndefined();
     });
   });
   ```
2. Run — fails: `expected 19 to be 20` (the const is still 19; no `19:` migration).
   `npx vitest run packages/shared/src/__tests__/migrateManifest-v19-to-v20.spec.ts`
3. Impl in `fileFormat.ts`. Change `:4` to `export const CURRENT_FORMAT_VERSION = 20 as const;`.
   Add a backfill helper near `addHardwareField` (`:14`) and the `19:` migration after the
   `18:` block — verbatim style of the v9→v10 entry (`:174-181`):
   ```ts
   function addCustomTexturesField(doc: Record<string, unknown>): void {
     if (doc.customTextures == null) {
       doc.customTextures = [];
     }
   }
   ```
   ```ts
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
   ```
4. Update `types.ts` `ProjectFile` union — append `| 20` to the part and assembly arms'
   version lists (`:141`, `:142`) and `20` to the drawing arm (`:143`).
5. **Mechanical fixups for the bump** (these break the moment the const flips to 20):
   `fileFormat.spec.ts` and the per-version migration specs assert the *terminal* version
   `.toBe(19)` and `CURRENT_FORMAT_VERSION).toBe(19)`. Update every **terminal-version /
   CURRENT_FORMAT_VERSION** assertion `19 → 20`, but **leave `formatVersion: 19` INPUT
   fixtures** (those drive the v18→v19 migration and must stay). Files to touch (grep
   `toBe(19)` + `CURRENT_FORMAT_VERSION).toBe`) — VERIFIED hit list (13 shared specs):
   `packages/shared/src/__tests__/fileFormat.spec.ts` (19 hits),
   `migrateManifest-v7-to-v8` … `migrateManifest-v18-to-v19.spec.ts` (each asserts the chain
   now lands on 20). NOTE `migrateManifest-v10-to-v11.spec.ts` and
   `migrateManifest-v11-to-v12.spec.ts` also each contain 2 `toBe(19)` terminal assertions
   (they were missing from the `CURRENT_FORMAT_VERSION).toBe(19)` sub-list but DO assert the
   full chain → must flip). 
   ⚠️ **VERIFIED TRAP — `migrateManifest-v18-to-v19.spec.ts:215-225`**: the case titled
   `'v19 manifest passes through without re-migration'` feeds a `formatVersion: 19` INPUT and
   asserts `expect(out.formatVersion).toBe(19)`. After this bump a v19 manifest NO LONGER
   passes through — it migrates v19→v20. The blanket "leave `formatVersion: 19` INPUT
   fixtures" rule is INSUFFICIENT here: keep the `19` input but **flip the terminal
   assertion to `.toBe(20)` and add `expect(out.document.customTextures).toEqual([])`**, and
   retitle to `'v19 manifest migrates to v20'`. (This case is the ONLY place a v19 input has
   a terminal `.toBe(19)` that must change semantics; do not blindly skip it.)
   App fixtures that hardcode a part/drawing manifest version —
   `packages/app/src/drawing/__tests__/loadDrawingSource.spec.ts:113`,
   `packages/app/src/shell/tabs/__tests__/FileTab.drawing.spec.ts:60`,
   `packages/app/src/storage/__tests__/DrawingPacker.spec.ts:41`,
   and **`packages/app/src/commands/__tests__/PlaceComponentCommand.spec.ts`** (lines 93/139/185
   build a manifest with `formatVersion: CURRENT_FORMAT_VERSION` — the SYMBOL, not a literal,
   so it auto-tracks the bump; INSPECT to confirm it stays green, it almost certainly does —
   but it was missing from the original touch list). For each: bump their input
   `formatVersion: 19 → 20` only if the test asserts no-migration round-trip; otherwise
   leave as a valid older-version input — inspect each: if the test does
   `migrateManifest(...)` and asserts equality/no-op, bump; if it feeds an older version to
   exercise migration, leave. Do this surgically per file.
6. Run the full shared suite + the touched app specs — all green.
   `npx vitest run packages/shared` then
   `cd packages/app && npx vitest run --config vitest.config.ts src/drawing/__tests__/loadDrawingSource.spec.ts src/shell/tabs/__tests__/FileTab.drawing.spec.ts src/storage/__tests__/DrawingPacker.spec.ts`
7. Commit: `feat(shared): bump format v19→v20, backfill customTextures: [] migration`.

---

## Task 3 — app: canvas downscale util (longest edge ≤1024px, JPEG q0.9)

**Files**
- Create `packages/app/src/textures/downscaleTexture.ts`
- Create `packages/app/src/textures/__tests__/downscaleTexture.spec.ts`

> The util takes an already-decoded `ImageBitmap | HTMLImageElement | HTMLCanvasElement`
> drawable + its natural width/height (caller decodes the File — keeps the util pure-ish
> and testable). jsdom lacks a real 2D raster encoder, so the test injects a fake
> `OffscreenCanvas`-like factory to assert the *scaling math* + that JPEG output is
> requested; the real browser path is exercised by the Task 7 e2e.

**Steps**

1. Write failing test `downscaleTexture.spec.ts`:
   ```ts
   import { describe, it, expect, vi } from 'vitest';
   import { computeDownscaleSize, downscaleToJpeg } from '../downscaleTexture';

   describe('computeDownscaleSize', () => {
     it('caps the longest edge at 1024, preserving aspect (landscape)', () => {
       expect(computeDownscaleSize(2048, 1024)).toEqual({ width: 1024, height: 512 });
     });
     it('caps the longest edge at 1024 (portrait)', () => {
       expect(computeDownscaleSize(800, 1600)).toEqual({ width: 512, height: 1024 });
     });
     it('leaves images already within 1024 untouched', () => {
       expect(computeDownscaleSize(640, 480)).toEqual({ width: 640, height: 480 });
     });
     it('rounds to integer pixels', () => {
       expect(computeDownscaleSize(1025, 1025)).toEqual({ width: 1024, height: 1024 });
     });
   });

   describe('downscaleToJpeg', () => {
     it('draws at the capped size and encodes JPEG q0.9', async () => {
       const drawImage = vi.fn();
       const toBlob = vi.fn((cb: (b: Blob) => void, type: string, q: number) => {
         expect(type).toBe('image/jpeg');
         expect(q).toBeCloseTo(0.9);
         cb(new Blob([new Uint8Array([1, 2, 3])], { type }));
       });
       const fakeCtx = { drawImage };
       const fakeCanvas = { getContext: () => fakeCtx, toBlob, width: 0, height: 0 } as unknown as HTMLCanvasElement;
       const bytes = await downscaleToJpeg(
         { width: 2048, height: 1024 } as unknown as CanvasImageSource & { width: number; height: number },
         () => fakeCanvas,
       );
       expect(fakeCanvas.width).toBe(1024);
       expect(fakeCanvas.height).toBe(512);
       expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1024, 512);
       expect(Array.from(bytes)).toEqual([1, 2, 3]);
     });
   });
   ```
2. Run — fails: `Cannot find module '../downscaleTexture'`.
   `cd packages/app && npx vitest run --config vitest.config.ts src/textures/__tests__/downscaleTexture.spec.ts`
3. Impl `downscaleTexture.ts`:
   ```ts
   const MAX_EDGE = 1024;
   const JPEG_QUALITY = 0.9;

   export function computeDownscaleSize(w: number, h: number): { width: number; height: number } {
     const longest = Math.max(w, h);
     if (longest <= MAX_EDGE) return { width: Math.round(w), height: Math.round(h) };
     const scale = MAX_EDGE / longest;
     return { width: Math.round(w * scale), height: Math.round(h * scale) };
   }

   export type DrawableSource = CanvasImageSource & { width: number; height: number };

   /** Downscale a decoded image source to ≤1024px longest edge and re-encode as JPEG q0.9.
    *  `canvasFactory` defaults to a real <canvas>; injectable for tests. */
   export async function downscaleToJpeg(
     src: DrawableSource,
     canvasFactory: () => HTMLCanvasElement = () => document.createElement('canvas'),
   ): Promise<Uint8Array> {
     const { width, height } = computeDownscaleSize(src.width, src.height);
     const canvas = canvasFactory();
     canvas.width = width;
     canvas.height = height;
     const ctx = canvas.getContext('2d');
     if (!ctx) throw new Error('downscaleToJpeg: 2D canvas context unavailable');
     ctx.drawImage(src, 0, 0, width, height);
     const blob = await new Promise<Blob | null>((resolve) =>
       canvas.toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY),
     );
     if (!blob) throw new Error('downscaleToJpeg: toBlob produced no blob');
     return new Uint8Array(await blob.arrayBuffer());
   }

   /** Decode a File into a drawable bitmap (browser path used by the upload dialog). */
   export async function decodeImageFile(file: File): Promise<DrawableSource> {
     const bitmap = await createImageBitmap(file);
     return bitmap as unknown as DrawableSource;
   }
   ```
4. Run — green.
5. Commit: `feat(app): add canvas downscale util (≤1024px JPEG q0.9) for custom textures`.

---

## Task 4a — kernel: persist `textures/<blobId>.jpg` for PARTS (pack/unpack + blob registry + setCustomTextures)

**Files**
- Modify `packages/kernel/src/storage/ProjectPacker.ts` — write/read `textures/<id>.jpg`
  entries; add `textures` to `ProjectArchiveInput`/`ProjectArchiveOutput`.
- Modify `packages/kernel/src/api.ts` — add `customTextureBlobs` registry (mirror
  `importedShapeCache` at `:193`); add `registerCustomTexture(blobId, bytes)` +
  `setCustomTextures(partId, defs)` API; thread `textures` into `saveToBytes`
  (`:345`/`:369`) and restore on `loadFromBytes` (`:386`).
- Modify `packages/kernel/src/api.ts` `KernelApi` interface (near `:69 setMaterials`).
- Create `packages/kernel/src/storage/__tests__/ProjectPacker.textures.spec.ts`

**Steps**

1. Write failing test `ProjectPacker.textures.spec.ts`:
   ```ts
   import { describe, it, expect } from 'vitest';
   import { packProject, unpackProject } from '../ProjectPacker';

   describe('ProjectPacker — custom texture blobs', () => {
     it('round-trips textures/<id>.jpg entries byte-identically', async () => {
       const albedo = new Uint8Array([0xff, 0xd8, 0xff, 0x10, 0x20]); // jpeg-ish
       const normal = new Uint8Array([1, 2, 3, 4]);
       const archive = await packProject({
         manifest: { formatVersion: 20, kind: 'part', document: { id: 'p' } },
         blobs: { main: new Uint8Array([9, 9]) },
         textures: { 'tex-a': albedo, 'tex-n': normal },
       });
       const out = await unpackProject(archive);
       expect(out.textures).toBeDefined();
       expect(Array.from(out.textures!['tex-a']!)).toEqual([0xff, 0xd8, 0xff, 0x10, 0x20]);
       expect(Array.from(out.textures!['tex-n']!)).toEqual([1, 2, 3, 4]);
       expect(Array.from(out.blobs.main!)).toEqual([9, 9]);
     });
     it('omits textures key when none supplied (back-compat)', async () => {
       const archive = await packProject({
         manifest: { formatVersion: 20, kind: 'part', document: {} },
         blobs: {},
       });
       const out = await unpackProject(archive);
       expect(out.textures ?? {}).toEqual({});
     });
   });
   ```
2. Run — fails: `out.textures` is `undefined` (packer ignores the key).
   `npx vitest run packages/kernel/src/storage/__tests__/ProjectPacker.textures.spec.ts`
3. Impl `ProjectPacker.ts`:
   - `ProjectArchiveInput` / `ProjectArchiveOutput` gain `textures?: Record<string, Uint8Array>;`.
   - In `packProject`, after the `blobs` loop (`:21`):
     ```ts
     if (input.textures) {
       for (const [id, bytes] of Object.entries(input.textures)) {
         entries.push({ name: `textures/${id}.jpg`, data: bytes });
       }
     }
     ```
   - In `unpackProject`, after the `blobs/` branch (`:36`), before `thumbnail`:
     ```ts
     } else if (entry.name.startsWith('textures/') && entry.name.endsWith('.jpg')) {
       const id = entry.name.slice('textures/'.length, -'.jpg'.length);
       (result.textures ??= {})[id] = entry.data;
     ```
4. Run — green. Commit checkpoint A: `feat(kernel): pack/unpack textures/<id>.jpg blobs in ProjectPacker`.

5. Write failing test `api.customTextures.spec.ts`
   (`packages/kernel/src/__tests__/api.customTextures.spec.ts`) — uses the existing kernel
   test harness (copy the bootstrap from an existing `api.*.spec.ts` that creates a part):
   ```ts
   it('saveToBytes embeds registered custom-texture bytes + customTextures metadata', async () => {
     // create a part via the harness, then:
     await kernel.registerCustomTexture('tex-a', new Uint8Array([7, 7, 7]));
     await kernel.setCustomTextures(partId, [{
       id: 'custom-1', name: 'Mine', physicalWidthMm: 1000, physicalHeightMm: 1000,
       albedoBlobId: 'tex-a',
     }]);
     const bytes = await kernel.saveToBytes(partId);
     const { manifest, textures } = await unpackProject(bytes);
     expect((manifest as any).document.customTextures[0].id).toBe('custom-1');
     expect(Array.from(textures!['tex-a']!)).toEqual([7, 7, 7]);
   });
   it('loadFromBytes restores custom-texture bytes into the registry', async () => {
     // round-trip the bytes from the prior save, reload, re-save, assert bytes survive
   });
   ```
6. Run — fails: `kernel.registerCustomTexture is not a function`.
   `npx vitest run packages/kernel/src/__tests__/api.customTextures.spec.ts`
7. Impl `api.ts`:
   - Registry near `:193`: `const customTextureBlobs = new Map<string, Uint8Array>();`.
   - Interface (near `:69`): add
     `registerCustomTexture(blobId: string, bytes: Uint8Array): Promise<void>;`
     and `setCustomTextures(partId: string, defs: CustomTextureDef[]): Promise<void>;`
     (import `CustomTextureDef` from `@zilventor/shared`).
   - Impl methods (beside `setMaterials` `:265`):
     ```ts
     async registerCustomTexture(blobId, bytes) {
       customTextureBlobs.set(blobId, bytes.slice());
     },
     async setCustomTextures(partId, defs) {
       const p = parts.get(partId);
       if (!p) throw new Error(`setCustomTextures: unknown partId ${partId}`);
       parts.set(partId, { ...p, customTextures: [...defs] });
     },
     ```
   - In `saveToBytes`, after building `blobs` (`:354`), collect texture blobs referenced by
     `part.customTextures`, then pass them to `packProject` (`:369`):
     ```ts
     const textures: Record<string, Uint8Array> = {};
     for (const ct of part.customTextures ?? []) {
       for (const ref of [ct.albedoBlobId, ct.normalBlobId, ct.roughnessBlobId]) {
         if (!ref) continue;
         const b = customTextureBlobs.get(ref);
         if (!b) throw new Error(`saveToBytes: custom texture blob ${ref} not in registry`);
         textures[ref] = b;
       }
     }
     ```
     ```ts
     return await packProject({
       manifest, blobs,
       ...(Object.keys(textures).length ? { textures } : {}),
       ...(thumbnail ? { thumbnail } : {}),
     });
     ```
     (`part` already spreads into `manifest.document` at `:361`, so `customTextures` rides
     for free.)
   - In `loadFromBytes` (`:386`), after `const { manifest, blobs } = await unpackProject(bytes);`
     add `const { textures } = ...` and restore:
     ```ts
     if (textures) for (const [id, b] of Object.entries(textures)) customTextureBlobs.set(id, b);
     ```
8. Run — green (both kernel specs).
9. Commit: `feat(kernel): persist custom-texture bytes + metadata through saveToBytes/loadFromBytes`.

---

## Task 4b — app: persist custom textures for ASSEMBLIES (packAssembly blob entries)

**Files**
- Modify `packages/kernel/src/storage/AssemblyPacker.ts` — `packAssembly` accepts an
  optional `textures` map and writes `textures/<id>.jpg`; `unpackAssembly` returns
  `{ doc, textures }` (or add a sibling `unpackAssemblyWithTextures` to avoid churning all
  callers — choose the sibling to keep `unpackAssembly`'s `AssemblyDocument` return for
  the ~6 existing callers).
- Modify `packages/app/src/App.tsx:3803` — pass the active assembly's texture bytes into
  `packAssembly` (read from the runtime registry built in Task 5).
- Create `packages/kernel/src/storage/__tests__/AssemblyPacker.textures.spec.ts`

**Steps**

1. Write failing test:
   ```ts
   import { describe, it, expect } from 'vitest';
   import { packAssembly, unpackAssemblyWithTextures } from '../AssemblyPacker';

   const baseDoc = { id: 'a', name: 'A', units: 'mm', parameters: {}, components: [],
     constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
     cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [], hardware: [],
     customTextures: [{ id: 'custom-1', name: 'X', physicalWidthMm: 1000, physicalHeightMm: 1000, albedoBlobId: 'tex-a' }] };

   it('packAssembly writes + unpack returns custom-texture bytes', async () => {
     const bytes = await packAssembly(baseDoc as any, new Uint8Array(), { 'tex-a': new Uint8Array([5, 6]) });
     const { doc, textures } = await unpackAssemblyWithTextures(bytes);
     expect(doc.customTextures?.[0]?.albedoBlobId).toBe('tex-a');
     expect(Array.from(textures['tex-a']!)).toEqual([5, 6]);
   });
   ```
2. Run — fails: `unpackAssemblyWithTextures is not exported` / `packAssembly` arity.
   `npx vitest run packages/kernel/src/storage/__tests__/AssemblyPacker.textures.spec.ts`
3. Impl `AssemblyPacker.ts`:
   - `packAssembly(doc, thumbnail, textures?: Record<string, Uint8Array>)`: build the entry
     list, then append `textures/<id>.jpg` entries (same shape as Task 4a).
   - Add `unpackAssemblyWithTextures(bytes): Promise<{ doc: AssemblyDocument; textures: Record<string, Uint8Array> }>`
     that runs `readTarGz`, parses the manifest (reuse the existing parse/migrate logic from
     `unpackAssembly`), and collects `textures/*.jpg`. Keep the legacy `unpackAssembly`
     delegating to it (`return (await unpackAssemblyWithTextures(bytes)).doc;`) — zero churn
     for existing callers.
4. Run — green. Commit checkpoint: `feat(kernel): packAssembly writes custom-texture blobs`.
5. Modify `App.tsx:3803` autosave assembly branch: replace
   `const archive = await packAssembly(merged, new Uint8Array());` with a call that passes
   the assembly's referenced texture bytes from the runtime registry (Task 5):
   ```ts
   const texBytes = collectCustomTextureBytes(merged.customTextures, customTextureRegistryRef.current);
   const archive = await packAssembly(merged, new Uint8Array(), texBytes);
   ```
   (Define `collectCustomTextureBytes(defs, registry)` as a tiny helper in the Task-5 module;
   it maps each def's blob ids → `registry.getBytes(blobId)`.) This step is verified by the
   Task 7 e2e (assembly path is not unit-tested here to avoid mounting App).
6. Commit: `feat(app): thread custom-texture bytes into assembly autosave pack`.

---

## Task 5 — app: per-document custom-texture runtime registry + resolution + URL revoke

**Files**
- Create `packages/app/src/textures/customTextureRegistry.ts`
- Modify `packages/app/src/viewport/SceneManager.ts` — `buildMaterial` (`:320`) resolves
  `findTextureDef(id) ?? registry.get(id)`; add `setCustomTextureRegistry(r)` setter; field
  default `null`.
- Modify `packages/app/src/viewport/SceneManager.ts:709` `dispose()` — call
  `registry?.revokeAll()`.
- Create `packages/app/src/textures/__tests__/customTextureRegistry.spec.ts`

**Steps**

1. Write failing test `customTextureRegistry.spec.ts`:
   ```ts
   import { describe, it, expect, vi, beforeEach } from 'vitest';
   import { createCustomTextureRegistry } from '../customTextureRegistry';
   import type { CustomTextureDef } from '@zilventor/shared';

   const created: string[] = [];
   const revoked: string[] = [];
   beforeEach(() => { created.length = 0; revoked.length = 0;
     (globalThis as any).URL.createObjectURL = vi.fn(() => { const u = `blob:${created.length}`; created.push(u); return u; });
     (globalThis as any).URL.revokeObjectURL = vi.fn((u: string) => { revoked.push(u); });
   });

   const def: CustomTextureDef = { id: 'custom-1', name: 'Mine',
     physicalWidthMm: 1000, physicalHeightMm: 800, albedoBlobId: 'a' };

   it('builds a runtime TextureDef with blob URLs + physical mm from container bytes', () => {
     const reg = createCustomTextureRegistry();
     reg.register([def], { a: new Uint8Array([1]) });
     const td = reg.get('custom-1')!;
     expect(td.albedoUrl).toMatch(/^blob:/);
     expect(td.physicalWidthMm).toBe(1000);
     expect(td.physicalHeightMm).toBe(800);
     expect(td.normalUrl).toBeUndefined();
   });
   it('includes optional normal/roughness URLs when blob ids present', () => {
     const reg = createCustomTextureRegistry();
     reg.register([{ ...def, normalBlobId: 'n', roughnessBlobId: 'r' }],
       { a: new Uint8Array([1]), n: new Uint8Array([2]), r: new Uint8Array([3]) });
     const td = reg.get('custom-1')!;
     expect(td.normalUrl).toMatch(/^blob:/);
     expect(td.roughnessUrl).toMatch(/^blob:/);
   });
   it('get returns undefined for built-in / unknown ids', () => {
     expect(createCustomTextureRegistry().get('oak')).toBeUndefined();
   });
   it('exposes raw bytes for persistence threading', () => {
     const reg = createCustomTextureRegistry();
     reg.register([def], { a: new Uint8Array([9]) });
     expect(Array.from(reg.getBytes('a')!)).toEqual([9]);
   });
   it('revokeAll revokes every created object URL and clears the registry', () => {
     const reg = createCustomTextureRegistry();
     reg.register([{ ...def, normalBlobId: 'n' }], { a: new Uint8Array([1]), n: new Uint8Array([2]) });
     reg.revokeAll();
     expect(revoked.length).toBe(2);
     expect(reg.get('custom-1')).toBeUndefined();
   });
   ```
2. Run — fails: `Cannot find module '../customTextureRegistry'`.
   `cd packages/app && npx vitest run --config vitest.config.ts src/textures/__tests__/customTextureRegistry.spec.ts`
3. Impl `customTextureRegistry.ts`:
   ```ts
   import type { CustomTextureDef, TextureDef } from '@zilventor/shared';

   export interface CustomTextureRegistry {
     register(defs: CustomTextureDef[], bytesById: Record<string, Uint8Array>): void;
     get(id: string): TextureDef | undefined;
     getBytes(blobId: string): Uint8Array | undefined;
     revokeAll(): void;
   }

   export function createCustomTextureRegistry(): CustomTextureRegistry {
     const defs = new Map<string, TextureDef>();
     const bytes = new Map<string, Uint8Array>();
     const urls: string[] = [];

     function urlFor(blobId: string): string {
       const b = bytes.get(blobId);
       if (!b) throw new Error(`customTextureRegistry: missing bytes for ${blobId}`);
       // Copy into a standalone ArrayBuffer so Blob ownership is independent of the map entry.
       const u = URL.createObjectURL(new Blob([b.slice()], { type: 'image/jpeg' }));
       urls.push(u);
       return u;
     }

     return {
       register(newDefs, bytesById) {
         for (const [k, v] of Object.entries(bytesById)) bytes.set(k, v);
         for (const d of newDefs) {
           defs.set(d.id, {
             id: d.id, name: d.name,
             physicalWidthMm: d.physicalWidthMm, physicalHeightMm: d.physicalHeightMm,
             albedoUrl: urlFor(d.albedoBlobId),
             ...(d.normalBlobId ? { normalUrl: urlFor(d.normalBlobId) } : {}),
             ...(d.roughnessBlobId ? { roughnessUrl: urlFor(d.roughnessBlobId) } : {}),
           });
         }
       },
       get: (id) => defs.get(id),
       getBytes: (blobId) => bytes.get(blobId),
       revokeAll() {
         for (const u of urls) URL.revokeObjectURL(u);
         urls.length = 0; defs.clear(); bytes.clear();
       },
     };
   }

   export function collectCustomTextureBytes(
     defs: CustomTextureDef[] | undefined,
     reg: CustomTextureRegistry,
   ): Record<string, Uint8Array> {
     const out: Record<string, Uint8Array> = {};
     for (const d of defs ?? []) {
       for (const ref of [d.albedoBlobId, d.normalBlobId, d.roughnessBlobId]) {
         if (!ref) continue;
         const b = reg.getBytes(ref);
         if (b) out[ref] = b;
       }
     }
     return out;
   }
   ```
4. Run — green. Commit checkpoint: `feat(app): per-document custom-texture runtime registry + URL revoke`.

5. Write failing test for SceneManager resolution
   (`packages/app/src/viewport/__tests__/SceneManager.customTexture.spec.ts` — copy the
   jsdom/WebGL-mock bootstrap from an existing `SceneManager.*.spec.ts`):
   ```ts
   it('buildMaterial resolves a custom textureId via the injected registry', () => {
     const reg = createCustomTextureRegistry();
     reg.register([{ id: 'custom-1', name: 'M', physicalWidthMm: 1000, physicalHeightMm: 1000, albedoBlobId: 'a' }],
       { a: new Uint8Array([1]) });
     const sm = makeSceneManager();          // harness helper
     sm.setCustomTextureRegistry(reg);
     sm.setMesh(positions, indices, '#ffffff', uv, 'custom-1');
     const mat = sm.getCurrentMaterial();    // existing/added test accessor
     expect((mat as THREE.MeshStandardMaterial).map).toBeTruthy();
   });
   it('falls back to solid color when a custom id is unknown to the registry', () => {
     const sm = makeSceneManager();
     sm.setMesh(positions, indices, '#abcdef', uv, 'custom-missing');
     const mat = sm.getCurrentMaterial();
     expect((mat as THREE.MeshStandardMaterial).map).toBeFalsy();
   });
   ```
   (If no `getCurrentMaterial` accessor exists, add a minimal test-only getter returning
   `this.current?.material`; keep it tiny.)
6. Run — fails: `setCustomTextureRegistry is not a function`.
7. Impl in `SceneManager.ts`:
   - Field: `private customTextureRegistry: CustomTextureRegistry | null = null;`
   - `setCustomTextureRegistry(r: CustomTextureRegistry | null): void { this.customTextureRegistry = r; }`
   - In `buildMaterial` (`:320-322`): `const def = findTextureDef(textureId) ?? this.customTextureRegistry?.get(textureId);`
   - In `dispose()` after `globalTextureCache.disposeTextures();` (`:709`):
     `this.customTextureRegistry?.revokeAll();`
   - Import `createCustomTextureRegistry` type from `../textures/customTextureRegistry`.
8. Run — green.
9. Commit: `feat(app): resolve custom textureId in SceneManager + revoke URLs on dispose`.

> **App.tsx wiring (covered by Task 7 e2e, no unit test):** build a
> `customTextureRegistryRef` (`useRef<CustomTextureRegistry>`), populate it on document
> activate from the unpacked container's `customTextures` + `textures` (the load path at
> `App.tsx:3599 kernel.loadFromBytes` for assemblies / part open), and call
> `sm.setCustomTextureRegistry(registryRef.current)` where SceneManager is attached
> (`App.tsx:1129`). Revoke + rebuild the registry on document teardown — mirror the
> `partTextureIdCacheRef` invalidation site (`App.tsx:2591`). Pin: registry rebuild belongs
> next to the existing `partTextureIdCacheRef.current.set(...)` at `App.tsx:3607`.

---

## Task 6 — app: `AddCustomTextureCommand` (apply/revert; document + registry)

**Files**
- Create `packages/app/src/commands/AddCustomTextureCommand.ts`
- Modify `packages/app/src/store/useAppStore.ts` — add `addCustomTexture(def)` +
  `removeCustomTexture(id)` reducers (mirror `addMaterial` at `:693`) + interface entries
  (near `:289`); add a `kernel.registerCustomTexture` + `kernel.setCustomTextures` sync
  helper `syncPartCustomTextures()` (mirror `syncPartMaterials.ts`).
- Create `packages/app/src/store/syncPartCustomTextures.ts`
- Create `packages/app/src/commands/__tests__/AddCustomTextureCommand.spec.ts`

**Steps**

1. Write failing test `AddCustomTextureCommand.spec.ts` (mirror the existing
   `packages/app/src/commands/__tests__/EditMaterialCommand.hatch.spec.ts` harness —
   seeds an active part in the store, stubs kernel):
   ```ts
   it('apply appends the def to the active part and registers bytes; revert removes it', async () => {
     // seed activePart with customTextures: []
     const reg = createCustomTextureRegistry();
     const cmd = new AddCustomTextureCommand({
       def: { id: 'custom-1', name: 'Mine', physicalWidthMm: 1000, physicalHeightMm: 1000, albedoBlobId: 'a' },
       bytes: { a: new Uint8Array([1, 2]) },
       registry: reg,
     });
     await cmd.apply();
     expect(useAppStore.getState().activePart!.customTextures!.map(d => d.id)).toContain('custom-1');
     expect(reg.get('custom-1')).toBeTruthy();
     await cmd.revert();
     expect(useAppStore.getState().activePart!.customTextures!).toEqual([]);
   });
   ```
2. Run — fails: `Cannot find module '../AddCustomTextureCommand'`.
   `cd packages/app && npx vitest run --config vitest.config.ts src/commands/__tests__/AddCustomTextureCommand.spec.ts`
3. Impl reducers in `useAppStore.ts` (mirror `addMaterial` `:693-709`, writing
   `customTextures` on activePart/activeAssembly + activeDocument; `removeCustomTexture`
   filters by id). Impl `syncPartCustomTextures.ts`:
   ```ts
   import { useAppStore } from './useAppStore';
   export async function syncPartCustomTextures(): Promise<void> {
     const { kernel, activePart } = useAppStore.getState();
     if (!kernel || !activePart) return;
     await kernel.setCustomTextures(activePart.id, activePart.customTextures ?? []);
   }
   ```
   Impl `AddCustomTextureCommand.ts`:
   ```ts
   import type { Command } from './Command';
   import type { CustomTextureDef } from '@zilventor/shared';
   import { useAppStore } from '../store/useAppStore';
   import { syncPartCustomTextures } from '../store/syncPartCustomTextures';
   import type { CustomTextureRegistry } from '../textures/customTextureRegistry';

   export interface AddCustomTextureArgs {
     def: CustomTextureDef;
     bytes: Record<string, Uint8Array>;
     registry: CustomTextureRegistry;
   }

   export class AddCustomTextureCommand implements Command {
     readonly name = 'AddCustomTexture';
     constructor(private args: AddCustomTextureArgs) {}

     async apply(): Promise<void> {
       const { def, bytes, registry } = this.args;
       registry.register([def], bytes);
       const { kernel, activePart } = useAppStore.getState();
       if (kernel && activePart) await kernel.registerCustomTexture(def.albedoBlobId, bytes[def.albedoBlobId]!);
       // (register normal/roughness blobs too, when present)
       useAppStore.getState().addCustomTexture(def);
       await syncPartCustomTextures();
     }

     async revert(): Promise<void> {
       useAppStore.getState().removeCustomTexture(this.args.def.id);
       await syncPartCustomTextures();
       // Object-URL revoke for the removed def is handled at registry teardown
       // (no GC in v1 per spec — bytes stay in the kernel registry harmlessly).
     }
   }
   ```
4. Run — green.
5. Commit: `feat(app): AddCustomTextureCommand + store reducers + kernel sync`.

---

## Task 7 — app: upload dialog UI (button in MaterialRegistryEditor + modal)

**Files**
- Create `packages/app/src/shell/UploadCustomTextureDialog.tsx`
- Modify `packages/app/src/shell/MaterialRegistryEditor.tsx` — add an "Upload custom
  texture…" button + dialog open state; extend the texture `<select>` (`:341`) to also list
  `activeDocument`'s `customTextures` after the built-ins.
- Create `packages/app/src/shell/__tests__/UploadCustomTextureDialog.spec.tsx`

**Steps**

1. Write failing test (React Testing Library — match the existing
   `MaterialRegistryEditor.spec.tsx` render/queries pattern):
   ```ts
   it('renders Name + required Albedo + optional Normal/Roughness inputs + mm fields with 1000 defaults', () => {
     render(<UploadCustomTextureDialog onSubmit={vi.fn()} onCancel={vi.fn()} />);
     expect(screen.getByLabelText('Texture name')).toBeInTheDocument();
     expect(screen.getByLabelText(/Albedo/)).toBeRequired();
     expect(screen.getByLabelText(/Normal/)).toBeInTheDocument();
     expect(screen.getByLabelText(/Roughness/)).toBeInTheDocument();
     expect((screen.getByLabelText('Physical width (mm)') as HTMLInputElement).value).toBe('1000');
     expect((screen.getByLabelText('Physical height (mm)') as HTMLInputElement).value).toBe('1000');
   });
   it('Add is disabled until a name + albedo file are provided', () => {
     render(<UploadCustomTextureDialog onSubmit={vi.fn()} onCancel={vi.fn()} />);
     expect(screen.getByRole('button', { name: 'Add texture' })).toBeDisabled();
   });
   it('on submit, downscales each provided map and calls onSubmit with def + bytes', async () => {
     const onSubmit = vi.fn();
     // inject a stub downscale + a fake File; fill name, set albedo file, click Add
     // assert onSubmit called with { def: { name, physicalWidthMm: 1000, ... }, bytes: { [albedoBlobId]: <Uint8Array> } }
   });
   ```
   (The third test injects `downscaleToJpeg`/`decodeImageFile` via a prop or module mock so
   no real canvas raster encoding runs under jsdom — the real path runs in the e2e.)
2. Run — fails: `Cannot find module '../UploadCustomTextureDialog'`.
   `cd packages/app && npx vitest run --config vitest.config.ts src/shell/__tests__/UploadCustomTextureDialog.spec.tsx`
3. Impl `UploadCustomTextureDialog.tsx`: a modal with the labelled inputs above; on Add,
   for each provided file run `decodeImageFile` → `downscaleToJpeg`, allocate
   `albedoBlobId = 'tex-' + crypto.randomUUID()` (+ optional normal/roughness), build a
   `CustomTextureDef { id: 'custom-' + crypto.randomUUID(), name, physicalWidthMm,
   physicalHeightMm, albedoBlobId, ... }`, and call
   `onSubmit({ def, bytes })`. Wire `aria-label`s exactly as asserted. Match the dialog
   chrome of an existing dialog (e.g. the Panel dialog) for visual consistency.
   In `MaterialRegistryEditor.tsx`: add an `Upload custom texture…` button that opens the
   dialog; its `onSubmit` dispatches `new AddCustomTextureCommand({ def, bytes,
   registry: <the document registry> })` on the bus. Extend the `<select>` (`:339-344`) to
   append `activeAssembly?.customTextures ?? activePart?.customTextures ?? []` as `<option>`s
   after the built-ins.
4. Run — green.
5. Commit: `feat(app): upload custom texture dialog + picker integration in material editor`.

---

## Task 8 — E2E gate (upload → assign → render → reload still textured)

**Files**
- Create `tests/e2e/pbr-textures-custom-upload.spec.ts`
- Test fixture: `tests/e2e/fixtures/custom-texture-upload.jpg` — **a GENUINE image**. Produce
  it by downscaling an existing built-in asset (`packages/app/public/textures/oak/albedo.jpg`)
  to ≤1024px JPEG via a one-off `sharp`/ImageMagick command, OR the controller supplies one.
  NEVER fabricate bytes. (Command, run once at plan-execution time:
  `npx --yes sharp-cli -i packages/app/public/textures/oak/albedo.jpg -o tests/e2e/fixtures/custom-texture-upload.jpg resize 512`
  or `magick packages/app/public/textures/oak/albedo.jpg -resize 512x512 tests/e2e/fixtures/custom-texture-upload.jpg`.)

**Steps**

1. Write the e2e (reuse Phase 1 helpers — `waitForKernelReady` from
   `tests/e2e/helpers/buildBox`; the `__zilventorStore` bus pattern; the WebGL
   pixel-variance readback block verbatim from `pbr-textures-panel.spec.ts:125-152`; the
   `[data-triangle-count]` wait). Structure:
   ```ts
   import { test, expect } from '@playwright/test';
   import { waitForKernelReady } from './helpers/buildBox';
   import path from 'node:path';

   test('upload a custom texture, assign to a panel, render textured, reload still textured', async ({ page }) => {
     test.setTimeout(180_000);
     page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
     await page.goto('/'); await waitForKernelReady(page);
     await page.getByRole('tab', { name: 'Model' }).click();
     await page.getByRole('button', { name: 'New Part' }).click();
     await expect(page.getByText('Part1')).toBeVisible();

     // Add a material via the bus (no UI shortcut — same as Phase 1).
     const matId = await page.evaluate(async () => {
       const { AddMaterialCommand } = await import('/src/commands/AddMaterialCommand.ts');
       const store = (window as any).__zilventorStore;
       await store.getState().bus.execute(new AddMaterialCommand({ name: 'Custom Mat', defaultThickness: 18, color: '#888888' }));
       return store.getState().activePart.materials.find((m: any) => m.name === 'Custom Mat').id;
     });

     // Open Panel dialog → Manage… → material editor (Phase 1 injection pattern).
     await page.evaluate(() => (window as any).__zilventorStore.getState().setPanelDialog({ mode: 'part', onSubmit: () => {}, onCancel: () => (window as any).__zilventorStore.getState().setPanelDialog(null) }));
     const dialog = page.getByRole('dialog', { name: 'Panel' });
     await dialog.getByRole('button', { name: /Manage/i }).click();
     const editor = dialog.locator('[data-testid="material-registry-editor"]');

     // Open the upload dialog, fill name, upload the REAL jpeg via setInputFiles.
     await editor.getByRole('button', { name: /Upload custom texture/i }).click();
     await page.getByLabel('Texture name').fill('My Wood');
     await page.getByLabel(/Albedo/).setInputFiles(path.resolve(__dirname, 'fixtures/custom-texture-upload.jpg'));
     await page.getByRole('button', { name: 'Add texture' }).click();

     // Assign the new custom texture to the material via the picker, Save.
     const row = editor.locator('tbody tr').filter({ hasText: 'Custom Mat' });
     await row.hover(); await row.getByRole('button', { name: /Edit Custom Mat/i }).click();
     await editor.getByLabel('Edit texture').selectOption({ label: 'My Wood' });
     await editor.getByRole('button', { name: 'Save' }).click();
     await page.evaluate(() => (window as any).__zilventorStore.getState().setPanelDialog(null));

     // Add a panel using that material.
     await page.evaluate(async (materialId) => {
       const { AddPanelFeatureCommand } = await import('/src/commands/AddPanelFeatureCommand.ts');
       const store = (window as any).__zilventorStore;
       await store.getState().bus.execute(new AddPanelFeatureCommand({ kind: 'panel', id: 'pf-custom-e2e',
         length: { kind: 'literal', value: 600 }, width: { kind: 'literal', value: 400 },
         thickness: { kind: 'literal', value: 18 }, thicknessFromMaterial: false, materialId,
         grain: 'length', edgeBands: { front: null, back: null, left: null, right: null } }));
     }, matId);
     await expect(page.locator('[data-triangle-count]')).toHaveAttribute('data-triangle-count', /[1-9]\d*/, { timeout: 60_000 });
     await page.screenshot({ path: '/tmp/pbr-custom-textured.png' });

     // Pixel-variance gate (verbatim block from pbr-textures-panel.spec.ts).
     const variance = await page.evaluate(/* …readPixels block… */);
     expect(variance, 'WebGL readback unavailable').not.toBe(-1);
     expect(variance, 'custom texture must produce visible non-uniform pixels').toBeGreaterThan(25);

     // Reload (autosaved to OPFS) → restore last-open document → still textured.
     await page.reload(); await waitForKernelReady(page);
     await expect(page.locator('[data-triangle-count]')).toHaveAttribute('data-triangle-count', /[1-9]\d*/, { timeout: 60_000 });
     await page.screenshot({ path: '/tmp/pbr-custom-textured-after-reload.png' });
     const varianceAfter = await page.evaluate(/* …same readPixels block… */);
     expect(varianceAfter, 'reloaded panel must still be textured').toBeGreaterThan(25);
   });
   ```
2. Run — fails (the upload button / dialog wiring or registry rebuild on reload not yet
   complete; iterate until green). `npx playwright test tests/e2e/pbr-textures-custom-upload.spec.ts`
3. Implement the App.tsx activation/teardown wiring noted under Task 5 (build + attach the
   registry; rebuild on reload from the unpacked container `customTextures` + `textures`)
   and the Task 4b assembly thread until both pixel-variance gates pass.
4. **Read both screenshots back** (`/tmp/pbr-custom-textured.png` + `…-after-reload.png`)
   — confirm visible grain pre- and post-reload before claiming done (CLAUDE.md §6).
5. Commit: `test(e2e): custom texture upload→assign→render→reload-persistence gate`.

---

## Manifest / version-bump touch list (do not miss)

- `packages/shared/src/fileFormat.ts:4` — `CURRENT_FORMAT_VERSION` 19 → 20.
- `packages/shared/src/fileFormat.ts` — new `19:` migration.
- `packages/shared/src/types.ts:141-143` — add `20` to all three `ProjectFile` arms.
- **Test fixups (terminal-version assertions only — leave older INPUT fixtures, EXCEPT the
  verified v18→v19 `:215-225` v19-input case which must flip to `.toBe(20)` — see Task 2 §5):**
  `fileFormat.spec.ts`, all `migrateManifest-v*-to-v*.spec.ts` files (incl. v10-v11 + v11-v12),
  `loadDrawingSource.spec.ts:113`, `FileTab.drawing.spec.ts:60`, `DrawingPacker.spec.ts:41`,
  and inspect `PlaceComponentCommand.spec.ts` (uses `CURRENT_FORMAT_VERSION` symbol — should
  auto-track, confirm green).
- `AssemblyPacker.ts` / `ProjectPacker.ts` use `CURRENT_FORMAT_VERSION` at write — no literal
  edits needed (they pick up 20 automatically); confirm their round-trip specs still pass.

## Verification gate (CLAUDE.md §6)

Done only when: full `npx vitest run packages/shared`, the touched
`cd packages/app && npx vitest run --config vitest.config.ts …` specs, the kernel storage
specs, AND the Task 8 e2e are green, and both e2e screenshots were **read back** showing a
textured panel before and after reload.
