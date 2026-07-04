# Import ABF flatten DXF as named panels — ratified plan

**Status: RATIFIED** — design ratified by the user 2026-07-04 across three `AskUserQuestion` rounds. This document is the frozen design + final worker briefs. No implementation code has been written against this plan; it is a planning artifact only.

**Sample evidence base:** `~/Downloads/Стелаж flatten.dxf` (902,719 bytes, `AC1021`, genuine UTF-8, a 10-panel shelving unit with doors). Byte-level forensic analysis lives at `docs/abf-plugin/05-parity/04-abf-flatten-dxf-sample-analysis.md` (confidence 75, single-sample). All "EXEC-verified" claims below were re-confirmed against the live file during this planning pass with a throwaway group-code-pair parser (not the doc alone) — see per-item notes.

---

## 1. Entry point — RATIFIED

New explicit command **"Import ABF flatten DXF…"**, a sibling of the existing import commands in `packages/app/src/commands/`. No auto-detect fork of the existing generic DXF import path.

**VERIFIED — sibling files that exist today** (`packages/app/src/commands/`): `ImportDxfIntoNewPartCommand.ts`, `ImportDxfIntoActiveSketchCommand.ts`, `ImportDxfUnderlayCommand.ts`, `ImportFromInventorCommand.ts`, `ImportStepAsComponentCommand.ts`, `ImportCustomHardwareCommand.ts` (+ `.spec.ts`), `RemoveDxfUnderlayCommand.ts`, `ExplodeIntoAssemblyCommand.ts`. All implement the shared `Command` type in `packages/app/src/commands/Command.ts`:
```ts
export type Command = { readonly name: string; apply(): Promise<void>; revert(): Promise<void>; };
```
Dispatch is always `bus.execute(cmd)` via `CommandBus` (`packages/app/src/commands/CommandBus.ts`) — never call `.apply()`/`.revert()` directly from UI code.

---

## 2. Detection — RATIFIED

Panel roots = top-level INSERTs whose `Skp_GroupInstanceName` ATTRIB value matches `/^__\d+\.\s/`.

**EXEC-verified against the live sample file** (re-parsed directly, not taken from the prior doc): exactly **10** ATTRIB values (group code 1) match `^__\d+\.\s`:
`__4. Дверка`, `__10. Дверка`, `__6. Дверка`, `__3. Перег`, `__12. Перег`, `__13. ЗАД`, `__5. Кришка`, `__9. Дно`, `__11. Бік Пр`, `__7. Бік Лв`.
Separately, **165** ATTRIB values (also group code 1, same field, different ATTRIB tag/context) contain the substring `_ABF_` — these are internal marker sub-block names, not panel roots: distinct values sampled include `_ABF_hingeCup`, `_ABF_Label`, `_ABF_cuttingLines`, `_ABF_sideDrill`, `_ABF_sideDrillDepth`, `_ABF_minifixBolts`, `_ABF_minifixPlasticBase`, `_ABF_hingeMountingPlate`. The `^__\d+\.\s` regex cleanly separates the 10 panel roots from all 165 `_ABF_*` markers — **no false positives in this sample.**

Panel names are kept **verbatim** (e.g. `__4. Дверка`), including the `__N. ` ordinal prefix — no re-formatting.

**ATTRIB parsing — shipped, confirmed.** `packages/shared/src/dxf/parser.ts`: a `pendingInsert` buffer (line 393, `{ ent, attribs: Array<{tag,value}> }`) accumulates trailing ATTRIB records (group 66=1 through SEQEND) and `finalizePendingInsert()` (lines 398–403) attaches them as `ent.attribs` only when non-empty. Shipped in commit `b746e6ea` "fix(shared): DXF INSERT ATTRIB parsing + block-internal OCS regression lock". INSERT type — `packages/shared/src/dxf/types.ts:17` — includes `attribs?: Array<{ tag: string; value: string }>` on the `DxfEntity` INSERT variant (optional field, matches `exactOptionalPropertyTypes`).

---

## 3. Extraction pass — RATIFIED, new shared module required (S1)

**CANNOT reuse `toSketch`** — CONFIRMED. `packages/shared/src/dxf/toSketch.ts`, function `expandInsert` spans **lines 361–436** (the design sketch's cited "line 439" is actually the start of `toSketch()` itself, `export function toSketch(parsed: ParsedDxf): ToSketchResult {`). Inside `expandInsert`'s block-body loop, each sub-entity only flows through `resolveStyle()` (color/lineStyle for rendering) into `blockPrims`/`blockAnnos` — the sub-entity's `layer` string and the containing INSERT's `attribs` are never read or forwarded anywhere in the function. A new shared extraction module must walk the block tree itself, keeping `layer` and `attribs` alive.

Outline per panel comes from the `ABF_cuttingLines` layer. **Confirmed dual meaning of this exact string**: it is both (a) the ABF sample file's own layer name for the panel-edge silhouette (per `docs/abf-plugin/05-parity/04-abf-flatten-dxf-sample-analysis.md` §2–3), and (b) already a literal constant in this codebase — `packages/app/src/drawing/abfLayerScheme.ts:4`: `export const ABF_OUTLINE_LAYER = 'ABF_cuttingLines';` — used today only on the **export** side (`renderPanelManufacturingDxf.ts`, ABF-compatible export mode). The import path should read the same literal, ideally importing `ABF_OUTLINE_LAYER` rather than re-declaring the string.

Per the sample-analysis doc §4: `ABF_cuttingLines` entities are per-edge `LINE`/legacy-`POLYLINE` segments with **non-zero Z** (a 3D silhouette across panel thickness), not one closed polygon — the outline must be reconstructed by joining edge segments **at Z=0**, then projected to 2D. Use the resulting polygon's bbox for L×W. **Risk, flagged not solved here:** if a panel's true outline is non-rectangular (an L-shape, notch, etc.), a bbox-only outline silently loses shape — S1 must at minimum detect and flag (not silently discard) non-rectangular outlines in the import status.

Material-group token parse: wrapping BLOCK names follow `<MATERIAL>_THICKNESS_<mm>`. **EXEC-verified in the sample**: exactly two such groups, `AUTO_THICKNESS_18` (6 panels) and `SREE_PEARLS_2_THICKNESS_18` (4 panels) — 6+4=10, matching the 10 detected panel roots exactly (per `04-abf-flatten-dxf-sample-analysis.md` §1).

---

## 4. Material/thickness dialog — RATIFIED

One row per material-group token (`<MATERIAL>_THICKNESS_<mm>`); thickness prefilled from the `<mm>` token; material chosen from the app's material registry.

**Material registry shape — VERIFIED**, `packages/shared/src/material.ts`: `MaterialId = string`; `MaterialEntry` (lines 3–18): `id`, `name`, `defaultThickness: number` (a **single** number, not a set of thickness options — the dialog's thickness field is a free numeric input prefilled from the DXF token, not a picker constrained to a material's registered thicknesses), `color` (hex), optional `sheetLengthMm`/`sheetWidthMm` (must both be present or both absent), optional `hatchAngleDeg`/`hatchSpacingMm`/`textureId`/`bandThicknessMm`/`kind`. `MaterialRegistry = readonly MaterialEntry[]`. Editor UI precedent: `packages/app/src/shell/MaterialRegistryEditor.tsx`.

**Dialog precedent — VERIFIED**, `packages/app/src/shell/ImportFromInventorDialog.tsx`: controlled dialog, props `{ isOpen: boolean; onCancel: () => void; onConfirm: (conflict: ImportConflict) => void; status: ImportDialogStatus }` (lines 12–17), invoked from `packages/app/src/App.tsx:5777`, `onConfirm` constructs `new ImportFromInventorCommand({...})` at line ~5791. Its current body is a single conflict-policy radio group — **not** already a per-row picker — but the `isOpen/onCancel/onConfirm/status`-prop shape and the "dialog owns local UI state, `onConfirm` builds the Command" wiring pattern is directly reusable as the template for S4's per-material-group row table.

---

## 5. Output shape — RATIFIED, with one architectural correction from the design sketch

One `AssemblyDocument` (`.ziasm`) + N `PartDocument`s at identity/origin pose, each carrying a `PanelFeature` so `resolvePanelSpec` resolves it into the cut-list/nesting/manufacturing-DXF/labels/statistics pipeline.

**CORRECTION — the design sketch's template pick is wrong for the PART side.** The sketch said to mirror `ExplodeIntoAssemblyCommand`'s `registerPart`/OPFS flow for *everything*. Verified facts split this in two:

- **`ExplodeIntoAssemblyCommand`** (`packages/app/src/commands/ExplodeIntoAssemblyCommand.ts`, 181 lines) IS the right template for the **assembly-wrapper mechanics**: build a brand-new `AssemblyDocument` inline, place each new part as a `ComponentInstance` at identity pose via a local `makeOriginInstance(partPath, color)` helper (lines 172–181), set it active via `useAppStore.getState().setActiveDocument({kind:'assembly', document: assembly})` (line 144), and roll back all created parts/OPFS entries on error (lines 112–124, 150–167). It uses `kernel.registerPart(partDoc)` (declared `packages/kernel/src/api.ts:118`, impl 566–570) + `kernel.saveToBytes(partDoc.id)` — **but that's because it's handling real imported STEP solids that need a live kernel-side B-rep.**
- **ABF-imported panels have no B-rep source** (2D outline + thickness only) and must instead follow **`CreateAndPlacePanelCommand`**'s pattern (`packages/app/src/commands/CreateAndPlacePanelCommand.ts`): build the `PartDocument` purely at the manifest level via `newPart(name)` + `addFeature(part, panelFeature)` (both from `packages/kernel/src/adapter/PartDocument.ts`, `newPart` line 44, `addFeature` line 65 — **despite living under `kernel/src/adapter`, these are pure manifest-mutation helpers, no OCCT call**), then pack via the command's local `packPartManifest()` helper (lines 174–182):
  ```ts
  async function packPartManifest(part: PartDocument): Promise<Uint8Array> {
    const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: part };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    return writeTarGz([{ name: 'manifest.json', data: manifestBytes }]);
  }
  ```
  and write directly via `opfs.write(partPath, bytes)` — **no `kernel.registerPart` call, no OCCT solid at all.**

This is confirmed load-bearing, not incidental: `resolvePanelSpec` (`packages/app/src/shell/resolvePanelSpec.ts:70–72`) contains the comment *"R1 preflight: parametric parts (built via PanelFeature) are single-solid and manifold by kernel construction — only name/material can be missing"* and hardcodes `solidCount: 1` for the `PanelFeature` branch — the whole downstream pipeline (cut list, nesting, manufacturing DXF, labels, statistics) is designed to work off the manifest-level `PanelFeature` alone, never off a persisted kernel body. **S2/S3 must build panels the `CreateAndPlacePanelCommand` way, using `ExplodeIntoAssemblyCommand` only as the template for the surrounding new-assembly-plus-N-components skeleton.**

**`resolvePanelSpec` requirement — VERIFIED** (`packages/app/src/shell/resolvePanelSpec.ts:15–87`): reads `manifest.document.featureTree`, finds the first entry passing `isPanelFeature`; if none found, returns `null` (with optional import-time diagnostics for non-panel/imported parts — not relevant here). **`PanelFeature` type** (`packages/shared/src/panel-feature.ts:14–29`):
```ts
export interface PanelFeature {
  readonly kind: 'panel';
  readonly id: string;
  readonly length: ParamOrLiteral;
  readonly width: ParamOrLiteral;
  readonly thickness: ParamOrLiteral;
  readonly thicknessFromMaterial: boolean;
  readonly materialId: MaterialId;
  readonly grain: GrainDirection;
  readonly edgeBands: { readonly [K in PanelEdgeKey]: EdgeBand | null };
  readonly suppressed?: boolean;
  readonly outline?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}
```
All fields except `suppressed`/`outline` are required; `edgeBands` must supply all four keys (front/back/left/right) as `EdgeBand | null` — for an ABF-imported panel with no known edge-banding data, the correct value is `null` for all four, not omission. After finding the `PanelFeature`, `resolvePanelSpec` also runs `panelPreflight({name, materialId, solidCount:1})` (line 72) and returns `null` on failure — so the `PartDocument`'s top-level `name` and the panel's `materialId` must both be non-empty/valid for the imported panel to actually flow into the pipeline; this is a concrete acceptance check S2/S6 should assert against, not just "a PanelFeature exists."

---

## 6. Bore reconstruction (face bores only in v1) — RATIFIED

### 6a. Real BoreOps from `DEPTH<d>` / `DEPTH<d>-ARTICLE<sku>` layers with pure-Z extrusion

**`BoreOp` type — VERIFIED**, `packages/shared/src/bore.ts:26–60`:
```ts
export interface BoreOp {
  id: string;
  face: FaceName;              // { featureId:'panel', role: PanelFaceRole, instance:0 }
  u: number; v: number;
  diameter: number;
  depth: number | 'throughAll';
  role: BoreRole;
  connectorId: string;
  connectorKind: BoreConnectorKind;
  edited?: boolean; jointDir?: {x:number;y:number;z:number};
  toolNumber?: number; speed?: number; presetLayerName?: string;
  sku?: string;
}
```
`id`, `face`, `u`, `v`, `diameter`, `depth`, `role`, `connectorId`, `connectorKind` are all required; `sku` is optional and **already exists specifically for this use case** — its doc comment (lines 54–58) reads *"Hardware-catalog SKU ... Drives the ABF-compatible `DEPTH<depth>-ARTICLE<sku>` DXF layer scheme."* Map: `depth` = the `<d>` token (number, or `'throughAll'` — not applicable here since ABF depths are always finite), `diameter` = 2×radius from the CIRCLE's group-40 radius, `sku` = the raw `<sku>` token **verbatim, no fuzzy catalog-id mapping**.

**`u`/`v` coordinate frame — CORRECTED DURING S1 (this paragraph originally claimed centered u/v; that was WRONG).** The `bore.ts:66–68` doc comment describes the 3D panel *box* (`[-L/2,-W/2,0]..[L/2,W/2,T]`, centered X/Y), but `face2DFrame` itself (`bore.ts:161-174`) places the 2D u/v origin at a *corner* (e.g. `(-hL,-hW,T)`), and real fixtures confirm it: `connectorCatalog.spec.ts:132-138` shows u/v in range `0..L`, not `-L/2..L/2`. **`u`/`v` are CORNER-BASED.** The importer copies bbox-local coordinates directly — NO `(−L/2, −W/2)` shift. S1 ships a round-trip regression test against the real `face2DFrame` locking this.

`boreToFlat` (`packages/app/src/drawing/renderPanelManufacturingDxf.ts:52–62`, not the sketch's cited 40–70 — those lines are `boreLabel` + doc comments):
```ts
export function boreToFlat(b: BoreOp, len: number, wid: number): { x: number; y: number; layer: string } | null {
  switch (b.face.role) {
    case 'Top':    return { x: b.u, y: b.v, layer: L.boresFront(b.diameter) };
    case 'Bottom': return { x: b.u, y: wid - b.v, layer: L.boresBack(b.diameter) };
    case 'Front':  return { x: b.v, y: wid, layer: L.boresEdge('Front', b.diameter) };
    case 'Back':   return { x: len - b.v, y: 0, layer: L.boresEdge('Back', b.diameter) };
    case 'Left':   return { x: 0, y: b.v, layer: L.boresEdge('Left', b.diameter) };
    case 'Right':  return { x: len, y: wid - b.v, layer: L.boresEdge('Right', b.diameter) };
    default:       return null;
  }
}
```
v1 only reconstructs face bores (`Top`/`Bottom`), so only these two branches need inverting: `u = x_bboxlocal`, and `v = y_bboxlocal` (Top) or `v = wid - y_bboxlocal` (Bottom) — bbox-local (corner-origin) coordinates used directly, per the S1 correction above.

### 6b. Face-role convention — RATIFIED, exact constant pinned

The sample's hinge cups sit at extrusion `(0,0,−1)` (per `04-abf-flatten-dxf-sample-analysis.md` §5). **Convention constant — VERIFIED**: `packages/shared/src/prisadkaFaceConventions.ts:32`: `export const DOOR_CUP_FACE: BroadFace = 'Bottom';` (`BroadFace = Extract<PanelFaceRole, 'Top'|'Bottom'>`, line 3) — this is the face our own pipeline drills hinge cups into, consumed by `packages/app/src/commands/AddDoorCommand.ts:25` (import) / line 219 (use). There is no module literally named `prisadkaFaceConventions` other than this file, and no `FaceRole` type — the real type is `PanelFaceRole` (`bore.ts:63`: `'Top'|'Bottom'|'Front'|'Back'|'Left'|'Right'`). Also in the same file: `LEFT_SIDE_INNER_FACE = 'Top'` (line 21), `RIGHT_SIDE_INNER_FACE = 'Bottom'` (line 22) — for side-panel hinge-plate holes.

**Ratified rule**: extrusion `(0,0,−1)` on a hinge-cup-diameter (~35mm) circle → `role: DOOR_CUP_FACE` (`'Bottom'`); extrusion `(0,0,+1)` → the other broad face (`'Top'`). Implement behind **one** documented constant, e.g. `ABF_NEGATIVE_Z_FACE_ROLE = 'Bottom'` (equal to `DOOR_CUP_FACE` today — S1 should import `DOOR_CUP_FACE` rather than re-declare the literal, so the two stay in sync by construction), with a locking test and a comment flagging that **a second ABF sample file must re-verify this sign convention** before it's treated as universal.

### 6c. Unknown-hardware face bores — RATIFIED, no manifest bump

Example: `DEPTH3.0` (2.0mm diameter, per the sample's §2 layer table — 50/50 face/edge split, no article number). Best-effort catalog match: diameter(+depth) tolerance match against known connector semantics; unmatched circles still import as `BoreOp`s, flagged in the import status.

**Enum constraint — VERIFIED, this drives the "no bump" answer.** `BoreRole` (`bore.ts:3–16`) and `BoreConnectorKind` (`bore.ts:18`, `'confirmat'|'minifix'|'dowel'|'shelfPin'|'hinge'|'drawerSlide'|'handleScrew'|'legLeveler'|'tandem'`) are both **closed string-literal unions with no generic/"unknown" member**, and `BoreOp.connectorKind`/`role` are **required, non-optional** fields. There is no free-string escape hatch for connector classification — only `sku` (optional string) is free-form. **Therefore**: the "best-effort match" must always resolve to one of the 9 existing `BoreConnectorKind` literals (and a compatible `BoreRole`) — **never introduce a 10th value**. This keeps the manifest bump-free: the closest-existing-type match is a *classification* choice, not a new persisted literal; the true article/SKU identity is preserved verbatim in the free-string `sku` field regardless of which bucket was chosen, and the import-status flag communicates "this was a best-effort/uncertain match" to the user. S1's worker must enumerate the full `BoreRole`/`BoreConnectorKind` unions from `bore.ts:3–18` directly (quoted above) before writing the classification table, since a diameter-only heuristic will need to pick from this exact closed set.

### 6d. Edge/reference-only bores — RATIFIED

`ABF-DSIDE-<dia>` (edge bores, e.g. shelf-pin/System-32 rows) and `D*-DEPTHF-$*` (single-instance-only convention in the sample, meaning uncertain per the sample doc's §3.3/§6) — v1 imports these as **plain sketch circles** (reference geometry only), **no `BoreOp`**, since no reliable depth signal exists for edge-drilled hardware in this file. All otherwise-unclassifiable circles also fall back to sketch circles. The import status must report both counts, e.g. *"N bores imported, M as reference geometry only."*

---

## 7. Manifest version — RATIFIED, confirmed no bump, with a stale-doc correction

**No manifest bump is required.** `PartDocument`, `AssemblyDocument`, `PanelFeature`, and `BoreOp` are all pre-existing, stable manifest-participating types; `PartDocument.bores?: BoreOp[]` already exists (marked "Additive v21" in `fileFormat.ts`'s migration-history comments) and lives as a **top-level array on `PartDocument`, not nested inside `featureTree`**. §6c above confirms the one place a new-value temptation could arise (`BoreConnectorKind`/`BoreRole` for unmatched hardware) is designed around, not through, a new literal.

**Correction to this project's own `CLAUDE.md`** (not part of this plan's scope to fix, flagged for awareness): `CURRENT_FORMAT_VERSION` is **VERIFIED as `41`** (`packages/shared/src/fileFormat.ts:4`, `export const CURRENT_FORMAT_VERSION = 41 as const;`), not `40` as currently stated in the project's `CLAUDE.md` "New manifest field/kind" note. That note appears to be one version behind as of this plan's writing (2026-07-04) — a future manifest-touching change should bump to `42`, not `41`.

---

## 8. Fixture — RATIFIED

Derive a trimmed 2–3-panel fixture (~20–50KB) from `~/Downloads/Стелаж flatten.dxf` for integration tests. Do **not** commit the full 902,719-byte sample. Recommended source panels for the trim: pick one `AUTO_THICKNESS_18` panel with a hinge-cup bore (e.g. one of the `Дверка`/door panels — confirmed to carry `DEPTH13-ARTICLE96053` 35mm face bores) plus one plain panel with no face bores, to exercise both the BoreOp-reconstruction path and the "reference geometry only" fallback path in the same fixture.

---

## 9. Slices and dependencies

`S1 ∥ S4` first (no shared-state dependency between the extraction module and the dialog UI) → `S2` after `S1` → `S3` after `S1`+`S2` (+ `S4`'s dialog-output interface) → `S5` after `S3`+`S4` → `S6` last.

---

### S1 — Shared extraction module (the heart)

**Goal:** A new pure module in `packages/shared/src/dxf/` (e.g. `abfPanelExtraction.ts`) that walks a parsed DXF's block/INSERT tree and produces, per detected panel, a record with: verbatim panel name, material-group token (material + thickness mm), reconstructed 2D outline (+ bbox L×W, + a flag if non-rectangular), and a classified list of bore circles (face-role + role/connectorKind/sku for real bores, or "reference only" for the rest).

**Background (pin these facts, don't re-derive):** Detection regex `/^__\d+\.\s/` against `Skp_GroupInstanceName` ATTRIB values (§2 above — EXEC-verified 10 roots vs 165 `_ABF_*` markers in the trimmed-down-from sample). `packages/shared/src/dxf/parser.ts` already threads `attribs?: Array<{tag,value}>` onto INSERT records (types.ts:17) — read that, do not reparse raw group codes. **Cannot call `toSketch`** — its `expandInsert` (`toSketch.ts:361-436`) discards `layer`/`attribs`; walk the block tree directly, resolving nested INSERT transforms + the `(0,0,±1)`-extrusion OCS mirror (`Xworld=-Xocs` — already handled correctly elsewhere per `docs/abf-plugin/05-parity/04-abf-flatten-dxf-sample-analysis.md` §5/§7.1, regression-locked in `toSketch.spec.ts` — reuse that OCS-resolution helper if it's exported, don't reimplement it blind). Outline layer = `ABF_OUTLINE_LAYER` (`packages/app/src/drawing/abfLayerScheme.ts:4` — import this constant, it's in `app`, so either re-export a shared copy or duplicate the literal with a comment pointing at the source of truth). Material-group token regex against wrapping BLOCK names: `<MATERIAL>_THICKNESS_<mm>`. Bore classification table: enumerate `BoreRole`/`BoreConnectorKind` full literal sets from `packages/shared/src/bore.ts:3-18` (quoted in §6c above) — pick the closest match by diameter (±depth where available), never invent a new literal. Face role: extrusion `(0,0,-1)` → `DOOR_CUP_FACE` (import from `packages/shared/src/prisadkaFaceConventions.ts:32`, don't redeclare `'Bottom'` as a bare string), `(0,0,+1)` → the other broad face. `u/v` are **corner-based** per `face2DFrame` (`bore.ts:161-174`; S1 correction — the centered claim earlier in this doc's history was wrong): store bbox-local coordinates directly, no shift.

**exactOptionalPropertyTypes:** any output record field that's "maybe present" (e.g. bore `sku`) must be conditionally spread (`...(sku ? {sku} : {})`), never assigned `undefined`.

**Skills to load:** `tdd-deep`.

**Done-criteria:** `cd packages/shared && npx vitest run src/dxf/__tests__/abfPanelExtraction.spec.ts` green, using the S6 trimmed fixture (or a hand-built minimal DXF string fixture if S6 fixture isn't ready yet — coordinate with S6's owner). `npx vitest run` (full shared suite) stays at or above the 1609-pass baseline (verified fresh 2026-07-04; see §Verification). `pnpm typecheck` clean from repo root.

**Report format:** file(s) touched, test names + pass count, §Self-critique (numbered weaknesses + numbered assumptions), `Confidence: 0-100` + one-sentence justification.

---

### S2 — Part builder (shared record → app `PanelFeature`-bearing `PartDocument`)

**Goal:** A function (likely `packages/app/src/commands/` or a small helper module) taking one S1 panel record + dialog-supplied `{materialId, thickness}` and producing a `PartDocument` with a `PanelFeature` in its `featureTree` (+ `bores: BoreOp[]` at the top level) — **built the `CreateAndPlacePanelCommand` way, not the `ExplodeIntoAssemblyCommand` way** (§5 above: no kernel B-rep, no `kernel.registerPart`).

**Background:** Follow `packages/app/src/commands/CreateAndPlacePanelCommand.ts`'s part-construction sequence exactly: `newPart(name)` + `addFeature(part, panelFeature)` (`packages/kernel/src/adapter/PartDocument.ts:44,65` — pure manifest mutators despite the `kernel` package path), then the local `packPartManifest()` pattern (`{formatVersion: CURRENT_FORMAT_VERSION, kind:'part', document: part}` → `writeTarGz`). `PanelFeature` required fields (`packages/shared/src/panel-feature.ts:14-29`, quoted in §5): `kind:'panel'`, `id`, `length`, `width`, `thickness`, `thicknessFromMaterial: false` (dialog supplies an explicit thickness, not "derive from material"), `materialId`, `grain` (pick a sane default, e.g. `'none'` or whatever the existing `GrainDirection` union's neutral value is — grep it, don't guess), `edgeBands: {front:null,back:null,left:null,right:null}` (no edge-band data in ABF import), optional `outline` (populate from S1's reconstructed polygon when non-rectangular, per §3's flagged risk). `PartDocument.name` and the panel's `materialId` must both be non-empty for `resolvePanelSpec`'s `panelPreflight` check to pass (`resolvePanelSpec.ts:70-72`) — assert this explicitly in tests. `CURRENT_FORMAT_VERSION` is `41` (`fileFormat.ts:4`), no bump needed.

**exactOptionalPropertyTypes:** `outline` only present when non-rectangular — conditional spread, never `outline: undefined`.

**Skills to load:** `tdd-deep`.

**Done-criteria:** `cd packages/app && npx vitest run src/commands/__tests__/<new-file>.spec.ts` green — assert the built `PartDocument` round-trips through `resolvePanelSpec` (construct it, pack it, feed it through the real `resolvePanelSpec` against an in-memory OPFS fake) and resolves non-null. Full `npx vitest run` stays at or above the 3784-pass baseline (verified fresh 2026-07-04). `pnpm typecheck` clean.

**Report format:** as S1.

---

### S3 — `ImportAbfFlattenDxfCommand`

**Goal:** The orchestrating `Command`: parse the uploaded DXF → run S1 detection → open S4's dialog for per-material-group thickness/material choices → build N parts via S2 → assemble one new `AssemblyDocument` + write N `.zipt`s to OPFS, mirroring `ExplodeIntoAssemblyCommand`'s **assembly-wrapper skeleton only** (new `AssemblyDocument` literal, `ComponentInstance`s at identity pose via a `makeOriginInstance`-style helper, `setActiveDocument`, error-path rollback deleting every part created so far) — not its per-part `kernel.registerPart` step (S2 replaces that).

**Background:** `packages/app/src/commands/ExplodeIntoAssemblyCommand.ts` (181 lines) is the structural template — read its `apply()`/`revert()` end to end for the assembly-build/rollback shape, but swap its per-solid `kernel.registerPart`+`kernel.saveToBytes` block for a call into S2's builder + `opfs.write`. `partPath` convention: `${name}.zipt` (matches `ExplodeIntoAssemblyCommand.ts:88` and `CreateAndPlacePanelCommand`'s doc comment). Import status must report per §6d: "N bores imported, M as reference geometry only," plus a count of non-rectangular-outline panels (§3) and best-effort/uncertain hardware matches (§6c).

**exactOptionalPropertyTypes:** same conditional-spread discipline as S2 when assembling the `ComponentInstance[]` and any optional status fields.

**Skills to load:** `tdd-deep`.

**Done-criteria:** `cd packages/app && npx vitest run src/commands/__tests__/ImportAbfFlattenDxfCommand.spec.ts` green, covering: happy path (N panels → N parts + 1 assembly), rollback on mid-loop failure (assert no orphan OPFS entries), and the import-status counts. Full `npx vitest run` ≥ 3784-pass baseline. `pnpm typecheck` clean.

**Report format:** as S1.

---

### S4 — Per-material-group import dialog

**Goal:** A React dialog component (e.g. `packages/app/src/shell/ImportAbfFlattenDxfDialog.tsx`) rendering one row per detected material-group token (`<MATERIAL>_THICKNESS_<mm>`), each row: a material picker (from the app's `MaterialRegistry`) + a thickness number input prefilled from the `<mm>` token. `onConfirm` returns the per-group `{groupToken, materialId, thickness}[]` selections for S3 to consume.

**Background:** Follow `packages/app/src/shell/ImportFromInventorDialog.tsx`'s prop/wiring shape (`{isOpen, onCancel, onConfirm, status}`, invoked + wired from `App.tsx` near line 5777/5791) — its current body (a single radio group) is not reusable content, but the controlled-dialog/status-prop/`onConfirm`-builds-something pattern is. `MaterialRegistry = readonly MaterialEntry[]` (`packages/shared/src/material.ts:20`); each `MaterialEntry` has `id`, `name`, `defaultThickness: number` (single value — do not treat it as a set of selectable thicknesses; the row's thickness field is a free numeric input, independently editable from the picked material's default). i18n copy goes through S5 (don't hardcode English strings here beyond dev placeholders if S4 lands before S5).

**Skills to load:** `tdd-deep`.

**Done-criteria:** `cd packages/app && npx vitest run src/shell/__tests__/ImportAbfFlattenDxfDialog.spec.tsx` (React Testing Library / jsdom, matching sibling dialog test conventions) green — assert rows render one-per-group, thickness prefill, and `onConfirm` payload shape. Full `npx vitest run` ≥ 3784-pass baseline. `pnpm typecheck` clean.

**Report format:** as S1.

---

### S5 — Ribbon/menu entry + i18n

**Goal:** Wire the new command into the file-import UI and add `en`/`uk` copy.

**Background:** Ribbon precedent — `packages/app/src/shell/tabs/FileTab.tsx`'s `handleImportDxf` handler (~line 311): dynamic `await import('../../commands/ImportDxfIntoNewPartCommand')` then `bus.execute(new ...)`, rendered as a plain button (~lines 371-379) alongside "Import from Inventor" (which instead opens a dialog via local state). Add a new button (`t('menu.file.importAbfFlattenDxf')`) following the same dynamic-import-then-`bus.execute` shape; if e2e coverage needs a direct hook (see S6), also add a `__zilventorImportAbfFlattenDxf` window-global test hook in `App.tsx` following the existing `__zilventorImportDxfNewPart` pattern (~`App.tsx:1250`). i18n files are **`packages/app/src/i18n/locales/en.json`** and **`packages/app/src/i18n/locales/uk.json`** (not `i18n/en.json` directly — confirmed path), loaded via `packages/app/src/i18n/index.ts`. **Single owner for both locale files in this slice** — do not split en/uk across two parallel workers (project `CLAUDE.md` i18n rule).

**Skills to load:** `tdd-deep`.

**Done-criteria:** `cd packages/app && npx vitest run` (any FileTab/App-level spec touching the new button/hook) green, full suite ≥ 3784-pass baseline. `pnpm typecheck` clean. Manual/e2e smoke of the button click is S6's job, not S5's.

**Report format:** as S1.

---

### S6 — E2E + fixture creation

**Goal:** Produce the trimmed 2-3-panel fixture DXF (§8) and a Playwright e2e spec exercising the full import flow against it: click the new ribbon entry → fixture file upload → dialog interaction (pick material/confirm) → assert the resulting assembly + parts via `window.__zilventorStore` (never a dynamic `import('/src/store/useAppStore')` — stale Vite HMR module binding per project `CLAUDE.md`) — check part count, panel dimensions, and that at least one imported `BoreOp` exists with `role/connectorKind` from the closed enum sets (§6c) and `sku` set to the raw ARTICLE token.

**Background:** Trim source: `~/Downloads/Стелаж flatten.dxf` — hand-pick entities for one door panel (has `DEPTH13-ARTICLE96053` 35mm hinge-cup face bores, extrusion `(0,0,-1)`) plus one bore-free panel, keeping their material-group wrapper BLOCK, `ABF_cuttingLines` outline entities, and relevant `ATTRIB`s; drop everything else (target ~20-50KB, do not commit the 902KB original). Poll settled end state via `expect.poll`/`waitForFunction`, **never `waitForTimeout`** (project `CLAUDE.md` e2e-flake history). Headless viewport renders black — no visual 3D assertions; probe via store state / OPFS bytes as above.

**Skills to load:** `tdd-deep`, `webapp-testing`.

**Done-criteria:** `pnpm exec playwright test --project=chromium -g "abf.*flatten"` (or the spec's own `-g` filter) green from a **fresh** dev server, after `pkill -f playwright; pkill -f chrome-headless; lsof -ti:5173 | xargs kill -9` to clear stray processes (project `CLAUDE.md` gotcha). Full two-shard suite (`pnpm exec playwright test --project=chromium --shard=1/2` then `--shard=2/2` — **never** `pnpm test:e2e -- --shard`, pnpm mangles the `=`) stays green at/above the current e2e baseline.

**Report format:** as S1, plus the fixture file path and its byte size.

---

## 10. Verification section

- **Per-package vitest** (fresh baselines, re-run 2026-07-04 during this planning pass — supersede the stale numbers in the project `CLAUDE.md`, which currently reads "app 3744, shared 1573"):
  - `cd packages/shared && npx vitest run` → **1609 passed** (169 test files).
  - `cd packages/app && npx vitest run` → **3784 passed** (531 test files).
- **Root typecheck**: `pnpm typecheck` from repo root — clean (0 errors) across the 5 packages that carry a `typecheck` script (`icons`, `shared`, `sketcher-worker`, `kernel`, `app`).
- **E2E**: `pnpm exec playwright test --project=chromium` from root, sharded (`--shard=1/2` then `--shard=2/2`, 600s timeout each) — **never** `pnpm test:e2e -- --shard=…`. Kill stray processes before judging (`pkill -f playwright; pkill -f chrome-headless; lsof -ti:5173 | xargs kill -9`). Current e2e/kernel baselines per project `CLAUDE.md` (239/239 e2e; kernel 306 unit + 380/381 integration) were **not** re-run during this planning pass (out of scope for a doc-only task) — re-confirm at S6/merge time.
- **Gate:** full suite green (shared ≥1609, app ≥3784, typecheck 0, e2e at/above 239/239, kernel unmoved) before merging to LOCAL `master` (`--no-ff`). Pushes to `master` are user-only.

---

## 11. Open risks carried forward (not solved by this plan, flagged for slice owners)

1. **Single-sample evidence** — the entire OCS-sign convention (§6b), the `DEPTH<d>` face/edge orientation split (§6a — same-family layers can be face- or edge-oriented per-instance, never inferable from the layer name alone per the sample doc's Rule 1), and the `_ABF_*` marker-vs-panel-root split (§2) all rest on one 10-panel file. A second sample must re-verify before any of these becomes a "known convention" rather than a "best current guess, regression-locked."
2. **Non-rectangular outlines** (§3) are explicitly out of scope for correct reconstruction in v1 — only flagged, not handled.
3. **`ABF-DSIDE`'s companion-`POLYLINE` purpose is unconfirmed** (per the sample doc §6) — irrelevant to v1 since these import as reference-only sketch circles anyway, but would matter if a future slice tries to recover edge-bore depth.
