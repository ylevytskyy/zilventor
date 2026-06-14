# Frame Generator slice 1 — Wood face frames (cabinet-bound R×C grid, butt joints)

Status: BRAINSTORM-APPROVED 2026-06-14 (use case + scope locked via 2 question rounds). Awaiting user spec-review gate, then writing-plans.
Track: Tier-2 "Inventor 2012 parity" — **Frame Generator**, scoped to its most furniture-native reading: wood face frames for cabinets. (Metal structural / T-slot extrusion frames are explicitly out of scope — possible later slices.)
Predecessors / templates: `AddDoorCommand` + `doorMath`/`prisadkaFaceConventions.ts` (flat board on cabinet front), `AddDrawerBankCommand` + `drawerBankLayout` (N-equal division into a cabinet opening), `CreateComponentPatternCommand` (degenerate-input guard discipline), C1 clash filter (`Record<ComponentRole,…>` exhaustive classifier).

## 1. Goal

One command, **Add Face Frame**, places a solid-wood **face frame** onto a selected cabinet front: outer stiles + rails dividing the front into an **R×C grid of equal openings**, with optional mid-rails (rows) and mid-stiles/mullions (columns). Each member is a narrow solid-wood board (a panel). Undoable. Members flow into 3D, cut-list, BOM, DXF, and nesting automatically via the existing panel infrastructure — **no kernel change**.

Furniture value: face-frame (American-style) casework is a core cabinet construction method (rails + stiles on the cabinet front; 2-door base needs a center mullion; drawer-over-door needs a mid-rail). This is the most-used reading of "Frame Generator" for a cabinet shop.

## 2. Locked design decisions (brainstorm)

| Axis | Decision |
|---|---|
| Frame type | **Wood face frame** (solid-wood rails + stiles). Metal/T-slot frames out of scope. |
| Input / binding | **Cabinet-bound.** Pick a cabinet (like Add Door / Add Drawers), read its front opening, generate members as role-tagged `ComponentInstance`s **inside the cabinet `.ziasm`**. |
| Openings | **Equal R×C grid.** `rows` × `cols` equal openings → outer frame + (`rows−1`) mid-rails + (`cols−1`) mid-stiles. 1×1 = single opening; 2×1 = drawer-over-door; 1×2 = two-door. |
| Joinery | **None in slice 1.** Members butt-touch. Slice 1 delivers geometry + 3D + cut-list + BOM + DXF only. Pocket-hole / dowel joinery boring is a fast-follow. |
| Construction convention | **Stiles continuous full height; rails are segments that butt between adjacent stiles** (standard continuous-vertical-line look, simplest math). |
| Member representation | **Panels** (slab boards), one `PartDocument` per member, added as components — Approach A (maximal reuse of panel/cut-list/BOM/DXF infra). |
| Frame extent | Frame outer rectangle = **carcass box front** — outer-to-outer of the two side panels (width) and of the top & bottom panels (height), **excluding the toekick recess**. The frame covers the front edges of the carcass and sits **proud of the carcass front** by `thickness` along the outward front normal. (Note: this is the carcass *outer* front, NOT the door *opening* — outer stiles align flush with the cabinet sides.) |

## 3. Numeric defaults (ONE shared module — see §10)

- Stile width (vertical members): **38 mm** (≈1½″). Dialog-editable.
- Rail width (horizontal members): **38 mm**. Dialog-editable.
- Frame thickness: **19 mm** (≈¾″). Dialog-editable.
- Rows × cols: default **1 × 1** (single opening). Dialog-editable (each 1–10).
- Material: cabinet default material (inherits; dialog may override later — not required slice 1).

All constants live in ONE shared module `faceFrameConventions.ts`. No re-declaration anywhere (git-grep-gated), same discipline as `prisadkaFaceConventions.ts` / `drawerConventions.ts`.

## 4. Architecture

```
FurnitureTab "Add Face Frame" button
  → pick a cabinet (reuse the cabinet-pick step Add Door / Add Drawers use)
  → FaceFrameDialog (rows, cols, stileWidth, railWidth, thickness)
  → onSubmit → bus.execute(new AddFaceFrameCommand(opts))

AddFaceFrameCommand.apply():
  1. opfs.read(cabinetPath) → unpackAssembly → cab: AssemblyDocument
  2. deriveCabinetDims(cab)                 // REUSE from AddDoorCommand path (front W×H, front-plane frame)
  3. members = layoutFaceFrame({ frontW, frontH, thickness, stileWidth, railWidth, rows, cols })
                                            // → FrameMember[]  (pure, shared)  — throws on degenerate opening
  for each member:
     4a. build a panel PartDocument (REUSE the same panel path doors use)
         with PanelSpec { length, width, thickness, grain, materialId }
     4b. packProject → opfs.write(memberPath) ; kernel.registerPart(partDoc)
     4c. push ComponentInstance { partPath: memberPath, pose, role: 'faceFrameStile' | 'faceFrameRail' }
  5. packAssembly(cab) → opfs.write(cabinetPath)
  6. reloadCabinet() → store subAssemblyDocs[cabinetPath]

AddFaceFrameCommand.revert():
  remove the created components from cab.components, delete the written member .zipt blobs,
  repackAssembly + opfs.write + reloadCabinet. (Command holds created ids + paths in-memory — no persistent spec needed.)
```

No new recursion code: rendering (sub-assembly render path), cut-list (`aggregateCutListRecursive`), BOM (`aggregateBomRecursive`), DXF/nesting already recurse into the cabinet `.ziasm`. **Final-review item: verify each path actually reaches the new members** (the drawer-bank "false-green reaches-nested" class).

## 5. Geometry — grid layout & member sizing

Work in the cabinet **front plane**, 2D coords: `u` = horizontal (width) axis ∈ [0, frontW], `v` = vertical (height) axis ∈ [0, frontH], outward normal `n`.
- `frontW` = cabinet **outer** width (outer faces of the two side panels).
- `frontH` = carcass **box front** height (outer faces of top & bottom panels), **excluding the toekick**. The frame's `v=0` is the bottom of the carcass box (top of toekick), not the floor.
- Source fields are confirmed against the real cabinet model in the implementation plan (reuse `deriveCabinetDims`/carcass panels rather than guessing field names); **toekick-exclusion is a tested invariant** (a base cabinet with a toekick yields `frontH < total cabinet height`).

Let `sw` = stileWidth, `rw` = railWidth, `t` = thickness.

**Stiles** (`cols+1` members, continuous full height):
- Opening width `ow = (frontW − (cols+1)·sw) / cols`.
- Stile `i` (i = 0…cols): left edge at `u_i = i·(sw + ow)`; occupies `u ∈ [u_i, u_i + sw]`, full `v ∈ [0, frontH]`.
- Local board dims: length = `frontH` (along `v`), width = `sw` (along `u`), thickness = `t` (along `n`). Grain = **vertical**.

**Rails** (`cols·(rows+1)` members, segments between adjacent stiles):
- Opening height `oh = (frontH − (rows+1)·rw) / rows`.
- Rail row `k` (k = 0…rows): bottom edge at `v_k = k·(rw + oh)`; occupies `v ∈ [v_k, v_k + rw]`.
- For each column `c` (c = 0…cols−1): rail spans the opening between stile `c` and stile `c+1`, i.e. `u ∈ [u_c + sw, u_c + sw + ow]`. Length = `ow` (along `u`), width = `rw` (along `v`), thickness = `t`. Grain = **horizontal**.

**Member counts:** stiles = `cols+1`; rails = `cols·(rows+1)`; total = `(cols+1) + cols·(rows+1)`.
Spot-checks: 1×1 → 2 + 2 = **4** ✓; 2×1 → 2 + 3 = **5** ✓; 1×2 → 3 + 4 = **7** ✓; 2×2 → 3 + 6 = **9** ✓.

**Invariants (unit-tested):**
- `len(stiles) == cols+1`, `len(rails) == cols·(rows+1)`.
- All members lie within `[0,frontW] × [0,frontH]` (no member exceeds the front rectangle).
- Stiles pairwise non-overlapping in `u`; rails within a column pairwise non-overlapping in `v`.
- All `ow` equal, all `oh` equal (equal openings).
- **Degenerate guard (slice 1, not deferred):** if `(cols+1)·sw ≥ frontW` or `(rows+1)·rw ≥ frontH` (opening collapses, `ow ≤ 0` or `oh ≤ 0`), `layoutFaceFrame` **throws** a typed error; the dialog catches it and shows a guard toast (keep-open), same pattern as the circular-pattern radius guard + the drawer-handle width guard. RED test owns this.

## 6. Pose / front-plane convention (LOAD-BEARING — derive, do not hardcode)

A face-frame member is a flat board on the cabinet front, exactly like a door. Its pose maps the panel's local axes (length / width / thickness) onto the front-plane frame `{ origin, uAxis, vAxis, nAxis }`:
- translation = `origin + (u_center)·uAxis + (v_center)·vAxis + (t/2 + proud)·nAxis`
- orientation: stile → length∥`vAxis`, width∥`uAxis`, thickness∥`nAxis`; rail → length∥`uAxis`, width∥`vAxis`, thickness∥`nAxis`.

The front-plane frame and the panel-quaternion math **MUST be derived from the existing door/cabinet front convention** (`prisadkaFaceConventions.ts` / `deriveCabinetDims` / the door pose), NOT re-invented. The implementation plan must include a **Phase-0 derive step**: compute the member pose, assert it against a known door pose, and flip-RED before relying on it — and verify the final geometry with a **real-OCCT bake** of a generated member (volume + centroid + bbox ground-truth via the kernel integration config), per the присадка face-convention lessons. Volume alone is move/center-blind → assert centroid too.

## 7. Data model changes

- `shared/src/types.ts`: add two `ComponentRole` values — `'faceFrameStile'`, `'faceFrameRail'`. (Two roles, not one, so grain/labels/cut-list grouping stay clean.)
- `shared/src/fileFormat.ts`: bump `CURRENT_FORMAT_VERSION` **25 → 26**, additive no-op migration (v25→v26), consistent with the drawer-bank "drawer roles" bump precedent. No new persisted spec field needed for slice 1 (no live-edit/regeneration).
- No new kernel feature, no WASM rebuild.

## 8. BOM / cut-list / DXF integration

Members are panels with a `PanelSpec` → picked up by `aggregateCutListLocal` / `aggregateCutListRecursive` with no new code. Stiles (length=frontH, width=sw, vertical grain) group into one cut-list row at qty `cols+1`; rails group by column-width into rows. BOM (`aggregateBomRecursive`) and DXF/nesting already consume panel components recursively. **Final-review item: confirm members actually appear in cut-list + BOM + a nesting/DXF pass** (do not assume — the drawer-bank false-green-reaches class).

## 9. Clash filter interaction

The C1 clash filter classifies every `ComponentRole` via an exhaustive `Record<ComponentRole, boolean>` (compile-guard). Adding the two new roles **forces** handling them (TS error until done). Face-frame members are **NOT carcass** → kept like doors/drawers. Members butt-touch the carcass front and each other → touching faces yield zero overlap volume ("no solid" / threshold backstop, clash SC-10) → no spurious clash rows. **Acceptance check (e2e or unit): adding a face frame produces no new clash report rows.**

## 10. Shared constants module

`packages/shared/src/faceFrameConventions.ts` — single source of truth for: `DEFAULT_STILE_WIDTH = 38`, `DEFAULT_RAIL_WIDTH = 38`, `DEFAULT_FRAME_THICKNESS = 19`, `FACE_FRAME_PROUD = 0` (flush proud offset; member sits on the front face, front normal offset = t/2), role string constants, and grain conventions. Git-grep-gated zero re-declaration.

## 11. Files touched

| File | Change |
|---|---|
| `shared/src/faceFrameMath.ts` | NEW — pure `layoutFaceFrame(params) → FrameMember[]`, degenerate guard, invariants |
| `shared/src/faceFrameConventions.ts` | NEW — defaults + role/grain constants (single source) |
| `shared/src/types.ts` | ADD two `ComponentRole` values |
| `shared/src/fileFormat.ts` | BUMP v25→v26 + additive migration |
| `app/src/commands/AddFaceFrameCommand.ts` | NEW — apply/revert; unpack → build member panels → register/write → add components → repack |
| `app/src/shell/FaceFrameDialog.tsx` | NEW — rows/cols/widths/thickness form (reads Zustand) |
| `app/src/shell/WorkFeatureDialogsHost.tsx` | ADD `<FaceFrameDialog />` |
| `app/src/store/useAppStore.ts` | ADD `addFaceFrameDialog` state + setter |
| `app/src/shell/tabs/FurnitureTab.tsx` | ADD "Add Face Frame" button → cabinet pick → dialog → command |
| clash classifier (`Record<ComponentRole,…>`) | ADD the two roles (kept = true) |
| `app/src/i18n/locales/{en,uk}.json` | ADD UI strings (button, dialog labels, guard toast) |

## 12. Testing (TDD slices — each red→green + suite green)

- **A. `faceFrameMath`** (pure, unit): member counts for 1×1/2×1/1×2/2×2; lengths/widths; within-bounds; non-overlap; equal openings; **degenerate guard throws** (RED first). Owns the layout invariants.
- **B. types + manifest**: v25→v26 additive migration spec (round-trip a v25 doc → v26 unchanged); roles exist.
- **C. `AddFaceFrameCommand`** (full `AssemblyDocument` seed — bare shim crashes `addComponent`, known gotcha): apply adds `cols+1` stiles + `cols·(rows+1)` rails with correct roles/poses + member files written; **revert** removes components + deletes files. Assert via re-unpack, not just in-memory.
- **D. real-OCCT bake** (kernel integration config): bake one generated member → assert volume == `length·width·thickness` and centroid == member center (move/center-blind guard). Phase-0 pose-derive assertion lives here / alongside.
- **E. dialog + FurnitureTab wiring**: a **real handler test** that the FurnitureTab "Add Face Frame" path constructs + executes `AddFaceFrameCommand` (NOT a stub onSubmit — the slice-6 UI-false-green lesson); width/division guard surfaces a toast + keeps dialog open (async try/catch, no silent swallow).
- **F. clash classifier**: compile-guard satisfied; unit test that face-frame members produce no clash rows.
- **G. real-browser e2e**: Add Face Frame on a seeded cabinet → assert N members in the cabinet `.ziasm` + corresponding cut-list rows + no new clash rows, via `window.__zilventor*` probes (headless viewport renders black — never assert pixels).

Gate (must all pass before merge): app + shared + kernel-unit vitest green; kernel real-OCCT integration green; `tsc` 0-new across packages; `pnpm lint` 0 (hard gate); built-artifact e2e ✓.

## 13. Defaults & deferrals

**Defaults:** stile/rail 38 mm, thickness 19 mm, 1×1, cabinet material, flush-proud on the front face.

**Deferrals (explicit, not bugs):**
1. **Joinery** — pocket-hole / dowel / mortise-tenon boring at rail–stile joints (fast-follow; pocket holes are angled/stepped and likely need a kernel/boring extension beyond the straight `atFace` model).
2. **Unequal / custom row & column sizing** — e.g. a short drawer rail over a tall door. (Slice 1 is equal divisions; this is the top fast-follow.)
3. **Inset / overlay door integration** — frame openings driving door/drawer-front sizing; reveal model between frame and doors.
4. **Live-editable / regenerating frame node** (a first-class FaceFrame entity — Approach C, a later slice).
5. **Applied moldings, arched / shaped rails, beaded face frames.**
6. **Alternative convention** (mid-stiles running *between* rails instead of rails between stiles).
7. **Material override per frame** in the dialog; structural/linear-stock material kind.
8. **uk.json domain-term review** by the shop lead (face-frame terminology: обв'язка / стійка / поперечка).

## 14. Risks / verification gates (load-bearing)

- **Geometry-convention false-green** (the recurring class): derive pose from the door convention (single source), real-OCCT bake on GENERATED members with centroid assertion, Phase-0 compute→assert→flip-RED. Do NOT hand-author the value-under-test in the bake test (the slice-1 fillet false-green lesson).
- **UI false-green**: real FurnitureTab handler test, not a wiring-spec-injected onSubmit (slice-6 lesson).
- **Reaches-the-members false-green**: explicitly verify cut-list + BOM + DXF/nesting + render reach the new members (drawer-bank lesson).
- **Degenerate opening**: guard + RED test (circular-pattern lesson).
- **Clash noise** from touching members: e2e asserts no new clash rows.
- **Dirty-tree / self-push from subagents**: controller `git status` before every push; "commit but DO NOT push" in every subagent prompt (Phase-C gotcha).
- **Final whole-branch cross-chunk review is mandatory** (it caught cross-chunk blockers every prior feature) — re-check the spec §-by-§ against the diff.
