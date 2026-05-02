# Sub-project 5a — Panel + edge-band smoke test

User-run checklist. Three scenarios, each runs end-to-end on a fresh
ZilInventor build. Passing all three is the gate for declaring sub-
project 5a shipped from the user's perspective.

Prereqs once per machine:

- ZilInventor running locally (`pnpm --filter @zilventor/app dev`) or a
  deployed URL accessible from a recent Chrome/Edge.
- A clean OPFS root for these scenarios. To wipe: open DevTools →
  Application → Storage → "Clear site data".

---

## Scenario 1 — Hello-Panel (single part, save + reopen)

Verifies the Panel base feature, the per-project material registry,
and persistence through the v10 manifest format.

### Setup

- [ ] Step 1: Open ZilInventor in a fresh browser tab.
- [ ] Step 2: **File** tab → **New Part**. Browser pane shows `Part1`
      with origin features only.

### Run

- [ ] Step 3: **Furniture** tab → click **Panel**.
- [ ] Step 4: Panel dialog appears. Fill:
      - **Length:** `600`
      - **Width:** `400`
      - **Thickness:** leave blank — will be filled from material below.
- [ ] Step 5: Click **Manage…** to open the material registry.
- [ ] Step 6: Click **+ Add**. Fill:
      - **Name:** `Birch 18`
      - **Default thickness:** `18`
      - **Color:** any (default is fine).
- [ ] Step 7: Click **Add**. The registry table now lists `Birch 18`.
      Click **Manage…** again (or **Done**) to collapse the editor.
- [ ] Step 8: From the **Material** dropdown, pick **Birch 18**.
- [ ] Step 9: Confirm **Thickness** auto-fills to `18` and shows the
      `(from material)` badge.
- [ ] Step 10: Click **OK**. Dialog closes.

### Expected results

- [ ] Step 11: Browser pane shows the panel feature row under `Part1`.
- [ ] Step 12: Viewport renders the 600×400×18 mm panel.
- [ ] Step 13: **File** → **Save part** → name `Side` → save into a
      fresh OPFS folder. Confirm it lands as `Side.zipt`.

### Save / reopen check

- [ ] Step 14: **File** → **Close part** (or hard-reload the tab).
- [ ] Step 15: **File** → **Open** → pick `Side.zipt`.
- [ ] Step 16: Browser pane shows `Side` with one panel feature.
- [ ] Step 17: Double-click the panel feature → dialog reopens with
      Length 600 / Width 400 / Thickness 18 (from material) /
      Material `Birch 18`.

### Failure indicators

- Panel dialog never appears (Furniture tab disabled or button
  unresponsive). → Recovery: hard-reload, check console for missing
  command registration; report a regression.
- After save+reopen, dimensions or material reference are missing. →
  Recovery: open `Side.zipt` with a tar viewer, inspect
  `manifest.json`. `formatVersion` must be `10`. If it's lower, the
  v9→v10 migrator is broken; report.
- Thickness "(from material)" badge stops updating when the material
  changes. → Recovery: check `panel.thicknessFromMaterial` in the saved
  manifest; if true but thickness no longer tracks, this is the
  same-as-default detection regressing.

---

## Scenario 2 — Cabinet-prep (5-panel assembly with bands)

Verifies the assembly placement flow (`CreateAndPlacePanelCommand`),
material reconciliation, edge-band metadata, and the View-tab
"Show edge bands" toggle.

### Setup

- [ ] Step 1: **File** → **New Assembly**. Browser pane shows the
      empty assembly node.

### Run — place 5 panels

For each of the five sides below: open **Furniture** → **Panel**, fill
the dimensions, pick a material (add via Manage… on the first one;
re-use thereafter), set edge bands as listed, click **OK**. Watch the
component count in the browser pane increment after each.

- [ ] Step 2: **Top** — 800 × 400 × 18, material `Birch 18`. No bands.
- [ ] Step 3: **Bottom** — 800 × 400 × 18, material `Birch 18`. No
      bands.
- [ ] Step 4: **Left** (upright) — 720 × 400 × 18, material
      `Birch 18`. Band the **Top** edge with `PVC 1mm white`
      (add the second material now via Manage… → +Add when wiring its
      first reference; re-use afterwards).
- [ ] Step 5: **Right** (upright) — 720 × 400 × 18, material
      `Birch 18`. Band the **Top** edge with `PVC 1mm white`.
- [ ] Step 6: **Back** — 800 × 720 × 6, material `MDF 6mm` (add via
      Manage… → +Add). No bands.

(Step 4-5 use only one banded edge each per the plan's "4 uprights"
note in spec §6.4 — adapt freely; the load-bearing piece is that at
least 2-4 panels carry edge-band metadata.)

### Expected results

- [ ] Step 7: Browser pane lists 5 components.
- [ ] Step 8: Material registry on the assembly contains 3 materials:
      `Birch 18`, `PVC 1mm white`, `MDF 6mm`. Open via the BOM tab or
      Manage… inside any future Panel dialog.
- [ ] Step 9: **View** tab → **Show edge bands** is on (check mark
      shown). Viewport renders coloured highlight lines along the
      banded top edges of Left + Right.
- [ ] Step 10: Click **Show edge bands** to toggle off — highlights
      disappear immediately.
- [ ] Step 11: Click again to toggle on — highlights return.

### Save / reopen check

- [ ] Step 12: **File** → **Save assembly** → name `Cabinet` → save
      into the same OPFS folder.
- [ ] Step 13: Hard-reload the tab.
- [ ] Step 14: **File** → **Open** → `Cabinet.ziasm`.
- [ ] Step 15: All 5 panels reload; material registry intact (BOM tab
      lists the 3 materials with the right thicknesses).
- [ ] Step 16: Edge-band highlights persist (View tab toggle still on,
      bands visible on Left + Right top edges).

### Failure indicators

- A Panel dialog OK click silently fails (no component added). →
  Recovery: check console for `NO_ACTIVE_ASSEMBLY` or
  reconciliation errors; verify the active document is in fact the
  assembly.
- Saving `Cabinet.ziasm` succeeds but reopen drops materials or
  edge-band fields. → Recovery: open `.ziasm` with a tar viewer,
  inspect `manifest.json` `formatVersion` (must be 10) and the panel
  features in each `parts/<id>.zipt` referenced manifest; the
  `edgeBands` object must have all 4 keys (front/back/left/right),
  null for unbanded edges.
- Highlights don't appear despite panels having `edgeBands`
  populated. → Recovery: check View tab toggle state; if it claims
  on but no overlays render, inspect the SceneManager's
  `edgeBandOverlayCount` via DevTools console:
      `__zilventorStore.getState().viewport.getSceneManager().edgeBandOverlayCount()`

---

## Scenario 3 — Material-edit-cascade

Verifies that editing a material's `defaultThickness` cascades to
panels using `thicknessFromMaterial=true` but does not touch panels
with explicit overrides.

### Setup

- [ ] Step 1: Start from the saved `Cabinet.ziasm` from Scenario 2,
      open in ZilInventor.

### Pre-flight — give one panel an explicit thickness

- [ ] Step 2: Open the **Top** panel (Browser pane → double-click).
- [ ] Step 3: In the dialog, change **Thickness** to `19` manually
      (this clears `thicknessFromMaterial`). The "(from material)"
      badge should disappear.
- [ ] Step 4: Click **OK**. The Top panel now has an explicit 19 mm
      thickness override.

### Run

- [ ] Step 5: Open the assembly's material registry (Furniture →
      Panel on any panel → **Manage…**, or directly via the BOM tab if
      it links there).
- [ ] Step 6: Edit `Birch 18` → change **Default thickness** from `18`
      to `19`. Click **Save**.

### Expected results

- [ ] Step 7: Bottom, Left, Right panels (which still have
      `thicknessFromMaterial=true`) all update to 19 mm thickness in
      the viewport. Re-opening any of them in the Panel dialog shows
      `Thickness: 19  (from material)`.
- [ ] Step 8: The **Top** panel does **not** change — it kept the
      explicit override from Step 3 (still 19 mm because we set it
      manually, but the badge says no "(from material)"). To prove the
      override truly stuck, re-edit `Birch 18` → 20 mm. Bottom/Left/
      Right move to 20 mm; Top stays at 19 mm.
- [ ] Step 9: The **Back** panel (uses `MDF 6mm`, not `Birch 18`)
      stays at 6 mm throughout.

### Failure indicators

- Editing the material's thickness updates **all** panels including
  the explicit-override one. → Bug:
  `thicknessFromMaterial=false` is not being honoured by the material-
  edit cascade. Inspect `EditMaterialCommand` and the panel
  recompute path.
- Editing the material updates **none** of the panels. → Bug: the
  cascade hook isn't firing; verify the material edit produces a new
  material ref by checking `__zilventorStore.getState().activeAssembly.materials`
  in DevTools.
- Trying to delete `Birch 18` while it's still referenced returns
  silent success (no `MATERIAL_IN_USE` error). → Bug: the in-use
  reference guard regressed; this is covered by the e2e T33 spec, so
  re-run that suite.

### Recovery

For all failure modes: re-run the cascade with DevTools open. The
relevant store paths to watch:
- `__zilventorStore.getState().activeAssembly.materials` — registry.
- For each `parts/<id>.zipt`, the `panel.thicknessFromMaterial` flag
  on the panel feature.

---

## Sign-off

- [ ] Scenario 1 (Hello-Panel) passed.
- [ ] Scenario 2 (Cabinet-prep) passed.
- [ ] Scenario 3 (Material-edit-cascade) passed.

Once all three scenarios are checked, sub-project 5a is shipped from
the user's perspective. Note any scenario-specific quirks in the
project memory note for future reference.
