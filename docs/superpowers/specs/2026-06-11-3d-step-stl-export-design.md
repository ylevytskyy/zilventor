# 3D STEP/STL export — structured STEP + binary STL, parts + assemblies

**Date:** 2026-06-11
**Status:** Approved (brainstorming → spec)
**Track:** Tier-2 (interop) — first export-direction 3D interchange; user confirmed file export is a felt pain.
**Base:** master `a57b1f7` · **NO manifest bump** (runtime-only; no document-schema change).

---

## 1. Motivation

ZilInventor can **import** 3D (STEP/.stp via `STEPCAFControl_Reader`, incl. multi-body + per-solid
colors), but cannot **export** any 3D format — only 2D drawings (DXF/SVG/PDF), cut-lists/BOM (CSV),
and a viewport image (PNG). The furniture team needs to send 3D models out: to clients/shops using
parametric CAD (SolidWorks/Inventor/Fusion all read STEP) and to mesh tools / 3D printers (STL).
This slice adds **Export STEP** (exact B-rep, structured + named + colored for assemblies) and
**Export STL** (binary triangle mesh), for both the active part and the active assembly.

## 2. Decisions (locked in brainstorming)

| Axis | Decision |
|---|---|
| Formats | **STEP + STL both** |
| Scope | **Active part + active assembly both** (keys off `activeDocument.kind`) |
| STEP assembly fidelity | **Structured XCAF**: named components + per-component transform + colors |
| STL form | **Binary** (compact, standard); flat posed mesh for assemblies |
| Units | **mm** (the app's native unit) |
| Manifest | **No bump** (no persisted-document change) |

## 3. Verified premises (audited against real code + a RUNTIME export probe, before this spec)

1. **OCCT writers SHIP in the current WASM build — RUNTIME-PROVEN, no rebuild (conf 99).** The
   kernel vendors the prebuilt `opencascade.js@2.0.0-beta` **full** build; `occtLoader.ts:29/36/42`
   loads `opencascade.full.{js,wasm}`. The audit instantiated the live WASM and ran a real
   end-to-end export: `STEPControl_Writer.Transfer`+`Write` → status `1` (`IFSelect_RetDone`) →
   15,416-byte STEP; `BRepMesh_IncrementalMesh` + STL → 3,052 bytes. Present + live:
   `STEPControl_Writer`, `STEPCAFControl_Writer` (`Transfer_1(Handle_TDocStd_Document,…)`,
   `SetColorMode`/`SetNameMode`), `StlAPI_Writer`, `BRepMesh_IncrementalMesh`, `TDocStd_Document`,
   `XCAFDoc_DocumentTool`. (Grepping the glue JS is NOT a presence test — Embind registers symbols
   inside the WASM; the 9.3MB `.d.ts` + the runtime probe are authoritative.)
   - A repo TEST helper already exercises STEPCAF **writing**: `stepColor.helper.ts:63-81`
     (`STEPCAFControl_Writer_1` + `Transfer_1(doc, AsIs, …)` + `Write`) — but ONLY for **flat,
     un-transformed, corner-point boxes**. It does NOT prove the load-bearing **posed + colored
     component** case; in fact its own comment (`:36-42`) warns that baked transforms drop
     per-component colors (see §6). So the structured posed+colored write is genuinely unproven in
     the repo and is what the §10 round-trip must target.
2. **All export inputs are present + exercised by shipped code (conf 88).**
   - Part shape: `namedShapeCache: Map<partId, NamedShape>` (`api.ts:203`); `ns.shape.handle` is the
     `TopoDS_Shape`; warmed by `executeTree`→`updateNamedShapeCache`; re-execute if cold
     (`api.ts:519-523`). `saveToBytes` (`api.ts:358-385`) + `writeBRep` (`BRepIO.ts:16-30`) are the
     MEMFS write→`FS.readFile`→`Uint8Array` template.
   - World poses: `composedPoses` walker (`app/src/assembly/walkers/composedPoses.ts:28-64`) derives
     every visible leaf's world `Pose{translation,quaternion}` (the same data the renderer uses).
   - Pose→shape: `transformShapeByPose` (`TransformOps.ts:41-77`) → `gp_Trsf` +
     `BRepBuilderAPI_Transform_2(copy=true)`. Compound: `BRep_Builder`+`TopoDS_Compound`, precedent
     `cutAssemblyBySectionPlane` (`api.ts:631-640` fuses all cache shapes into one compound).
   - STL mesh: `tessellate(oc, shape, {linearDeflection,angularDeflection})` (`Tessellator.ts:47-147`)
     runs `BRepMesh_IncrementalMesh` then yields interleaved positions/indices arrays.
   - Colors: per-part XCAF import colors (`StepIO.ts:10-13,92-159`), `ComponentInstance.color`
     (`types.ts:111`), `AssemblyDocument.colorOverrides`/`colors` (`types.ts:127,130`), palette
     (`shared/bomRow.ts:22`).
3. **App-side export is ~80% reuse (conf high).** Image PNG export is the closest precedent:
   `FileTab.tsx:25-39,272-278` (button → bytes → `new Blob` → `triggerDownload`); `triggerDownload`
   (`nesting/triggerDownload.ts:8-34`) does the native `showSaveFilePicker` save dialog + anchor
   fallback. 13 `Export*Command` files exist; `ExportDrawingDxfCommand.ts:16-27` is the command
   template (non-undoable, `apply()`→bytes→download). Kernel is a Comlink Web Worker
   (`worker.ts`, `KernelClient.ts`); `Uint8Array` returns cross fine (like `saveToBytes`).
   Active-doc context: `activeDocument.kind` ('part'|'assembly'|'drawing') + `activePart`
   (`FileTab.tsx:65,76,88,274`).

## 4. Architecture overview

```
  FileTab "Export STEP" / "Export STL" (disabled on drawings)
        │  keys off activeDocument.kind
        ▼
  ExportStepCommand / ExportStlCommand (app; non-undoable, mirror ExportDrawingDxfCommand)
        │  part:  target = { partId }
        │  asm:   warm all leaf parts → target = leaves[] { partId, name, worldPose, color }
        ▼ Comlink
  kernel.exportStep(target) / kernel.exportStl(target,{binary})  → Uint8Array
        │  STEP: build XCAF doc (ShapeTool.AddShape/AddComponent + ColorTool + names)
        │        → STEPCAFControl_Writer.Transfer(doc) SetColorMode/SetNameMode → Write → FS.read
        │  STL : tessellate each leaf → transform verts by worldPose → concat → binary STL bytes
        ▼
  new Blob([bytes]) → triggerDownload(blob,{suggestedName,ext,mimeType})  (native save dialog)
```

## 5. Kernel API (new — `packages/kernel`, mirror `saveToBytes` byte-return)

```ts
// part export: id of a registered/executed part
exportStepPart(partId: string): Promise<Uint8Array>;
exportStlPart(partId: string, opts?: { binary?: boolean }): Promise<Uint8Array>;

// assembly export: leaves assembled app-side (kernel stays document-agnostic). color is already
// resolved to 0-1 RGB app-side (see §9); pose is the world Pose {translation,quaternion}.
interface ExportLeaf { partId: string; name: string; pose: Pose; color?: [number,number,number]; }
exportStepAssembly(leaves: ExportLeaf[], opts?: { name?: string }): Promise<Uint8Array>;
exportStlAssembly(leaves: ExportLeaf[], opts?: { binary?: boolean }): Promise<Uint8Array>;
```

- The kernel is **document-agnostic**: the app resolves world poses + effective 0-1 RGB colors +
  names and hands the kernel a flat `leaves[]`. Comlink structured-clones this shape fine — the
  kernel ALREADY accepts `{partId, pose:{translation,quaternion}}[]` today
  (`cutAssemblyComponentsByStepSegments`, `api.ts:185-188`), the pose-aware precedent (NOT
  `cutAssemblyBySectionPlane`, `api.ts:636`, which fuses ALL cache shapes with no transform).
- **🔴 Cold-cache re-execute is MANDATORY, not optional (verifier-found blocker).** `loadFromBytes`
  (`api.ts:429-454`) registers only into the `parts` Map — it does NOT execute and does NOT populate
  `namedShapeCache`. So a leaf the app just "warmed" is still **cold** in `namedShapeCache`; a naive
  `namedShapeCache.get(partId)` returns nothing → the writer emits an **empty** STEP/STL and returns
  `RetDone` (a textbook false green). Every export method MUST re-execute-if-cold (the
  `extractAssemblyRef` pattern, `api.ts:519-528`): `let ns = namedShapeCache.get(partId); if (!ns) {
  const p = parts.get(partId); if (!p) throw 'export: leaf part not loaded'; <executeTree + updateNamedShapeCache>; ns = …; }`.
  The §10 guard MUST assert **non-empty volume / solid count** so a cold-cache empty export turns RED.
- Byte readback idiom (verbatim from `BRepIO.ts`/`StepIO.ts`): `Writer.Write('/tmp/out.step')` →
  `oc.FS.readFile('/tmp/out.step')` → `oc.FS.unlink`.
- **Single part STEP = a trivial 1-leaf XCAF doc** (one labeled prototype, identity transform, its
  color), so the STEP code path + colors are unified across part/assembly.

## 6. Structured XCAF assembly build (THE load-bearing new piece — `packages/kernel`)

This inverts the existing XCAF color *import* (`StepIO.ts:92-159`). **API names/arities below are
pinned against the real `opencascade.full.d.ts` + the proven write helper `stepColor.helper.ts`
(verified) — re-emit them exactly.** Bootstrap the doc EXACTLY like the helper
(`stepColor.helper.ts:12-19`): `const app = oc.XCAFApp_Application.GetApplication().get();` →
`const docH = new oc.Handle_TDocStd_Document_1();` → `app.NewDocument_2(new oc.TCollection_ExtendedString_2('XmlXCAF'), docH);`
→ `const doc = docH.get(); const main = doc.Main();`. Then (note `.get()` on every static accessor —
they return Handles):

```
const shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(main).get();   // Handle → object
const colorTool = oc.XCAFDoc_DocumentTool.ColorTool(main).get();
```
1. **Per distinct `partId` (the prototype — UN-POSED, location-free shape):**
   `const partLabel = shapeTool.AddShape(partShape, /*makeAssembly*/false, /*makePrepare*/true);`
   Name it: `oc.TDataStd_Name.Set_1(partLabel, new oc.TCollection_ExtendedString_2(partName));`
   (there is **no** `ShapeTool.SetName`.) Color the prototype label:
   `colorTool.SetColor_2(partLabel, qcol, oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf);` where
   `qcol = new oc.Quantity_Color_3(r, g, b, oc.Quantity_TypeOfColor.Quantity_TOC_RGB)` (0–1 floats).
   Use **`ColorSurf`** (parity with the import reader's primary lookup `StepIO.ts:145` + the proven
   helper), not `ColorGen`.
2. **Per leaf instance (the pose lives ONLY here — never baked into the shape):** build the world
   `gp_Trsf` from the leaf `Pose` (reuse the `SetValues`/quaternion→3×3 logic from
   `transformShapeByPose` — but NOT its baked `BRepBuilderAPI_Transform` output), wrap it as a
   location, and add the component:
   `const compLabel = shapeTool.AddComponent_1(asmLabel, partLabel, new oc.TopLoc_Location_2(trsf));`
   Set a per-instance name on `compLabel` via `TDataStd_Name.Set_1` (instances share the prototype
   but get distinct names from the component path / index).
3. **Write:** `const w = new oc.STEPCAFControl_Writer_1(); w.SetColorMode(true); w.SetNameMode(true);
   const ok = w.Transfer_1(docH, oc.STEPControl_StepModelType.STEPControl_AsIs, null, new oc.Message_ProgressRange_1());
   w.Write('/tmp/out.step');` then `oc.FS.readFile('/tmp/out.step')` → `Uint8Array` → `oc.FS.unlink`.
   **`Transfer_1` takes the Handle (`docH`), not the unwrapped `doc`, and all four args** (the
   `null` is the `multi` `Standard_CString`).

> **THE load-bearing false-green vector (verified from `stepColor.helper.ts:36-42`):** a shape that
> carries a baked `TopoDS` location (what `transformShapeByPose`/`BRepBuilderAPI_Transform`
> produces) is treated by XCAF as a *reference*, and the STEPCAF writer then **loses every
> per-component color except the first label's**. The structured path above avoids this by (a)
> `AddShape`-ing the **un-posed prototype** and (b) putting the pose ONLY in `AddComponent_1`'s
> `TopLoc_Location`. The §10 round-trip guard MUST therefore assert **two DIFFERENT component colors
> both survive** on a **posed multi-component** assembly — the exact configuration that triggers the
> bug — not a single-color or un-posed case. This (not "pin the API") is the real proof the build is
> well-formed.

## 7. STL emission (`packages/kernel`)

- Per leaf: `tessellate(oc, shape, {linearDeflection: adaptiveLinearDeflection(bbox), angularDeflection})`
  → positions (Float32) + indices (Uint32). For an assembly, transform each vertex by the leaf's
  world pose (quaternion+translation; the same `Pose` math used app-side), and accumulate triangles.
- Emit **binary STL** directly (little-endian): 80-byte header + `uint32` triangle count +
  per-triangle (normal `3×f32` + 3 vertices `9×f32` + `uint16` attr). No `StlAPI_Writer` dependency
  (sidesteps the one unverified binding; mesh data is already in STL's native form). ASCII STL is a
  deferred non-goal.
- **Facet-normal winding caveat (verifier-found):** `tessellate` (`Tessellator.ts:74-111`) pushes
  `Poly_Triangle` node indices WITHOUT inspecting `face.Orientation()`, so a normal derived purely
  from winding points INWARD on `TopAbs_REVERSED` faces. **Flip the triangle's vertex order (and
  thus the normal) when the source face is `TopAbs_REVERSED`** so printers/slicers that trust the
  stored normal see outward facets. (Most consumers re-derive from winding, and the §10 bbox guard
  does NOT validate normal orientation — so add a tiny explicit outward-normal check on a known
  convex part, or scope normals as best-effort if flipping proves fiddly.)

## 8. App wiring (`packages/app`)

- `ExportStepCommand` / `ExportStlCommand` (mirror `ExportDrawingDxfCommand`; non-undoable;
  `revert()` no-op): `apply()` resolves the target, calls the kernel method, wraps bytes in a `Blob`,
  `triggerDownload({ suggestedName: <docName>.step|.stl, extension, mimeType })`.
  **Comlink auto-exposes the new kernel methods** (`worker.ts` `Comlink.expose(api)`) — no
  `KernelClient` registration step.
- **Active PART** target is simple: `{ partId: activePart.id }` (already a registered kernel id,
  `FileTab.tsx:89-90`).
- **Active ASSEMBLY** target needs a real resolution pipeline (the `apply()` reproduces the
  renderer's logic OUTSIDE React — verifier-found, the spec must not hand-wave "call composedPoses"):
  1. **Self-warm the sub-assembly DOC cache** (do NOT rely on the async render effect having run):
     mirror the BFS at `App.tsx:3186-3202` — walk the assembly's `.ziasm` children, `unpackAssembly`
     each into a local `subAsmCache` + compute `innerStaticPoses`. A FileTab export can fire before
     `subAssemblyDocs` is warm, which would silently drop nested cabinet leaves as placeholders.
  2. `visibleLeaves(assembly, subAsmCache)` (`visibleLeaves.ts`) → leaves keyed by **`partPath`**
     (not partId) with `effectiveColor: ComponentColor`. Any residual `kind:'placeholder'` leaf is a
     **hard error** (never a silently dropped component, per §17).
  3. **partPath → partId warm map:** for each unique `partPath`, `loadFromBytes(opfs.read(partPath))`
     and capture the returned id (the part doc's stable persisted UUID — same id on every load). The
     assembly model has NO kernel `partId`; this map is the bridge.
  4. **World poses:** reproduce `App.tsx:3855-3863` — `flattenForSolver(assembly, subAsmCacheAdapter)`
     + `composedPoses` (prefer the solver-published `componentPoses` map, recompute only if not
     solved). Zip `composedPosesMap.get(pathKey(leaf.componentPath))` against `kind:'leaf'` leaves.
  5. Build `ExportLeaf[] = { partId (from map), name (§9), pose (world), color ([r,g,b] from §9) }`.
- Two **FileTab** buttons ("Export STEP" / "Export STL") at `packages/app/src/shell/tabs/FileTab.tsx`,
  placed by the image-export button, **disabled when `activeDocument.kind === 'drawing'`**
  (precedent `FileTab.tsx:274`). i18n keys in `packages/app/src/i18n/locales/{en,uk}.json`
  (parity-test gate).

## 9. Effective color + name resolution (app-side, mirrors the renderer)

- **Color (a discriminated union, NOT an `[r,g,b]` tuple — verifier-found).** `visibleLeaves`
  yields `effectiveColor: ComponentColor = { kind:'hex', hex } | { kind:'palette', name }`. Resolve
  to 0-1 RGB app-side via a small pure `effectiveColorToRgb(color, assembly.colors): [number,number,number] | undefined`:
  `palette` → `assembly.colors[name]` → hex (the renderer does this at `App.tsx:3917-3919`), then
  hex → 0-1 RGB via the existing `hexToRgb01` (`stepColor.helper.ts:84-89`). The precedence
  (`colorOverrides` > instance `color` > part/material > palette) is already baked into
  `effectiveColor` by `visibleLeaves`/`resolveColor.ts` — reuse it; do NOT re-derive precedence. A
  palette name with no entry → `undefined` (the renderer leaves it unmaterialized).
- **Name = `PartDocument.name` (there is NO `ComponentInstance.name` — verifier-found).** Resolve per
  `partPath` via `resolvePartInfo` (`resolvePartInfo.ts:16-17`, name from the part manifest), warmed
  for ALL leaves incl. nested cabinet leaves (the render path only resolves top-level
  `assembly.components`); fall back to the `partPath` basename. **De-dup:** duplicate instances share
  one `partPath`/`partId` → name the SHAPE once per `partId` (the prototype), name each COMPONENT per
  instance from the component path/index (instances differ only by pose).
- **Geometry-only fallback:** a leaf with `undefined` color exports without a color attribute (still
  valid STEP). `effectiveColorToRgb` is the one logic-heavy resolver and is unit-tested (Phase 5a).

## 10. Verification (the load-bearing gate — real-OCCT round-trips, not status codes)

The false-green risks here are (a) asserting on the **writer status** (`RetDone`) / byte-length
instead of re-readable content, and (b) copying the existing **loose `>` bbox assertion**
(`stepColor.integration.spec.ts:24-25` asserts `span > 25` for boxes that should span EXACTLY 30 —
the anti-pattern; a unit/transform error passes it). All guards use **strict `toBeCloseTo`**. The
re-import path is the SHIPPED `readStep` (`StepIO.ts`, returns `{solidCount, solidColors[], boundingBox}`,
already called in `StepIO.integration.spec.ts`), so the round-trip is genuinely implementable.
- **STEP single-part round-trip (kernel integration, real OCCT):** `exportStepPart` a 10mm box →
  `readStep` the bytes → `expect(solidCount).toBe(1)`; `expect(bbox extent).toBeCloseTo(10, 3)`
  (**proves mm units** — do NOT accept a `>` inequality). If it fails, set
  `Interface_Static.SetCVal('write.step.unit','MM')` before `Transfer`.
- **STEP posed multi-component round-trip (THE load-bearing guard):** build a real 2-component
  assembly — two `buildPanelBox` solids at **distinct world poses** + **two DIFFERENT colors** →
  `exportStepAssembly` → `readStep` → assert: `solidCount === 2`; **both distinct colors survive**
  (`solidColors` contains both — the XCAF color-loss bug's signature is "only the first survives",
  so two distinct colors is the exact discriminator); and each solid's world bbox/min-corner
  `toBeCloseTo` the posed input (a dropped/collapsed transform → components at the origin → RED).
  Plus a **nested-cabinet** case (a real `.ziasm` sub-assembly leaf) to prove the §8 self-warm BFS
  pulls nested leaves (not placeholders) — assert the nested part's solid is present + posed.
  Assert `solidCount > 0` first so a cold-cache empty export (the §5 blocker) turns RED.
- **STL round-trip (kernel integration):** `exportStlPart`/`exportStlAssembly` → parse the binary
  STL back (header + `uint32` count + triangles) → `expect(triCount).toBeGreaterThan(0)`; parsed
  bbox `toBeCloseTo` the model bbox (assembly: spans all components' posed extents). Optionally one
  outward-normal check on a convex part (§7 caveat — the bbox guard does NOT validate normals).
- **§6 browser (probe-based; viewport is black headless):** export STEP + STL from the real FileTab
  against a real part AND a real cabinet assembly; read the downloaded bytes back and assert the STEP
  starts with `ISO-10303-21;` + contains the component names, and the STL binary triangle count > 0.
  Confirm the buttons disable on a drawing tab. i18n parity green.
- `npx tsc --noEmit` on touched packages (no new errors beyond the ~16-file baseline).

## 11. Internal phase plan (TDD slices — input to writing-plans)

Each phase = red→green→refactor; suite green after each.
1. **STL part export** — `exportStlPart` (cold-cache re-execute → `tessellate` → binary STL, REVERSED
   winding flip) + parse-back round-trip guard (`triCount>0`, bbox `toBeCloseTo`). Smallest
   end-to-end slice; proves the kernel→bytes→readback loop + the cold-cache fallback. (kernel)
2. **STL assembly export** — `exportStlAssembly` (per-leaf re-execute + posed vertex transform +
   concat) + posed-bbox round-trip spanning all components. (kernel)
3. **STEP part export** — `exportStepPart` via the 1-leaf XCAF doc + `STEPCAFControl_Writer`.
   **Pin the exact XCAF write API here against the real `.d.ts`** (doc bootstrap, `.get()` unwrap,
   `AddShape(s,false,true)`, `SetColor_2`/`ColorSurf`, `TDataStd_Name.Set_1`, `Transfer_1(docH,…)`).
   Round-trip asserts `solidCount===1` + **bbox `toBeCloseTo(10,3)` (proves mm)** + color survives. (kernel)
4. **STEP assembly export** — `exportStepAssembly` (structured XCAF: un-posed prototype `AddShape`,
   per-instance `AddComponent_1(asmLabel, partLabel, new TopLoc_Location_2(trsf))`, per-label color +
   names). Round-trip guard on a **posed 2-component, 2-DIFFERENT-color** assembly (both colors
   survive — the color-loss discriminator) + posed bbox + a **nested-`.ziasm`** case. (kernel)
5a. **Leaf-resolution logic (pure, TDD)** — `effectiveColorToRgb(color, colors)` (ComponentColor→rgb)
   + the partPath→partId / world-pose / name assembly into `ExportLeaf[]`, unit-tested: a 2-instance
   assembly resolves 2 leaves with correct rgb + distinct world poses + names; a placeholder leaf
   throws. This is the one logic-heavy app piece that must NOT drift from the viewport. (app)
5b. **Commands + FileTab + i18n (wiring)** — `ExportStepCommand`/`ExportStlCommand` (using 5a +
   sub-assembly self-warm BFS), two FileTab buttons (drawing-disabled), en/uk keys. Verified by the
   existing `parity.test.ts` (RED on a missing key) + the §6 browser gate; the pure UI render/disable
   is non-TDD (explicit). Comlink needs NO `KernelClient` registration. (app)
6. **e2e + §6 browser** — real-WASM e2e (export part + assembly STEP/STL, read bytes back, assert
   `ISO-10303-21` header + component names + STL triangle count) + tsc. (app/e2e)

## 12. Non-goals (deferred)

- IGES / 3MF / OBJ / glTF; ASCII STL.
- STEP AP242 PMI / annotations / GD&T; per-face colors.
- An export-options dialog (deflection, units, ascii/binary toggle) — sane defaults this slice.
- Drawing-tab 3D export (a drawing has no 3D); exporting a sub-assembly selection vs the whole doc.
- Re-export round-trip fidelity beyond solids+colors+structure (e.g. preserving the feature tree).

## 13. Key risks & mitigations

| Risk | Mitigation |
|---|---|
| XCAF **write** API differs from the import (read) surface | §6 now pins the EXACT bindings (`AddShape(s,false,true)`, `AddComponent_1`+`TopLoc_Location_2`, `SetColor_2`+`ColorSurf`, `TDataStd_Name.Set_1`, `Transfer_1(docH,…)`, `.get()` unwrap, doc bootstrap) — re-emit verbatim; Phase 3 confirms against the live `.d.ts`; the round-trip is the real proof |
| **🔴 Cold-cache empty export (blocker)** — `loadFromBytes` warms `parts`, NOT `namedShapeCache` → a naive `.get(partId)` exports an EMPTY STEP/STL with status RetDone | Every export method re-executes-if-cold (`extractAssemblyRef` pattern, `api.ts:519-528`); §10 guard asserts non-empty `solidCount`/volume so an empty export turns RED |
| **XCAF color-loss on baked transform** — only the first component's color survives | AddShape the UN-POSED prototype; pose ONLY in `AddComponent_1`'s `TopLoc_Location`; §10 asserts TWO DIFFERENT colors survive on a POSED assembly (the exact trigger) |
| Nested cabinet leaves silently dropped (async `subAssemblyDocs` not warm at export time) | The command SELF-WARMS the sub-assembly DOC cache via the BFS (`App.tsx:3186-3202`) before `visibleLeaves`; residual placeholder = hard error; §10 has a nested-`.ziasm` case |
| Input shape: assembly is partPath-keyed, `effectiveColor` is a `ComponentColor` union, no instance name | §8/§9: partPath→partId warm map; `effectiveColorToRgb` resolver (unit-tested, Phase 5a); name from `PartDocument.name` |
| False green: loose `>` bbox / status-only assertion | §10 uses strict `toBeCloseTo`; the existing `>25` test (`stepColor.integration.spec.ts:25`) is the named anti-pattern NOT to copy |
| Dropped/incorrect world transform → components stacked at origin | Round-trip asserts each component's posed world bbox/min-corner `toBeCloseTo` input (a collapsed transform turns RED) |
| STEP units not mm | Verify/SET the STEP write unit to mm in Phase 3; assert a known 10mm box reads back as 10mm |
| WASM heap / leaks on large assembly export (many shapes) | Reuse the import-path discipline (delete OCCT handles, unlink MEMFS temp files); test a multi-component cabinet |
| Binary STL endianness / normal winding wrong | Round-trip parse asserts triangle count + bbox; little-endian per the STL spec; normal from winding |

## 14. Success criteria

- **Part:** active part → "Export STEP"/"Export STL" downloads a `.step`/`.stl`; re-importing the
  STEP reproduces the solid (bbox/volume); the STL parses to a non-empty mesh with the right bbox.
- **Assembly:** active cabinet → "Export STEP" produces a STEP whose re-import has **N named
  components at the correct world poses with their colors**; "Export STL" produces one flat binary
  mesh spanning all components.
- **UI:** buttons disabled on a drawing tab; native save dialog; en/uk i18n parity green.
- **§6:** real-browser export of a real part AND a real assembly verified by reading the bytes back
  (STEP `ISO-10303-21` + component names; STL binary triangle count > 0).
- Additive only: no manifest bump; existing suites green; no new tsc errors.
