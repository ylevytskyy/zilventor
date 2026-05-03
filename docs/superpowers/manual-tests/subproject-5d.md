# Sub-project 5d — Cut List smoke test

User-run checklist. Three scenarios, each runs end-to-end on a fresh
ZilInventor build. Passing all three is the gate for declaring sub-
project 5d shipped from the user's perspective.

Prereqs once per machine:

- ZilInventor running locally (`pnpm --filter @zilventor/app dev`) or a
  deployed URL accessible from a recent Chrome/Edge.
- A clean OPFS root for these scenarios. To wipe: open DevTools →
  Application → Storage → "Clear site data".

---

## Scenario 1 — Single cabinet (Hello-Panel)

Verifies that the Cut List tab aggregates rows correctly, edge-band
totals compute, and CSV export produces a valid 3-section file.

### Setup

- [ ] Step 1: Open ZilInventor in a fresh browser tab.
- [ ] Step 2: **File** tab → **New Assembly**. Browser pane shows the
      empty assembly node.

### Run — place 4 panels

- [ ] Step 3: **Furniture** → **Panel**. Fill:
      - **Length:** `600`, **Width:** `400`, **Thickness:** blank
        (will come from material).
      - **Manage…** → **+ Add**. Name: `Birch 18mm`,
        Default thickness: `18`, Color: any. Click **Add**, then **Done**.
      - Pick **Birch 18mm** from the Material dropdown. Thickness
        auto-fills to `18` with the "(from material)" badge.
      - Edge bands: **Front** → add `PVC 1mm white`
        (**Manage…** → **+ Add**, name `PVC 1mm white`, thickness `1`).
      - Click **OK**. Browser pane shows component `Side`.

- [ ] Step 4: **Furniture** → **Panel** again. Same material, no bands.
      Length `600`, Width `400`. Click **OK** (second `Side`).

- [ ] Step 5: **Furniture** → **Panel**. Length `600`, Width `600`.
      Material `Birch 18mm`, no bands. Click **OK** (first `Top`).

- [ ] Step 6: **Furniture** → **Panel**. Length `600`, Width `600`.
      Material `Birch 18mm`, no bands. Click **OK** (second `Top`).

### Expected results

- [ ] Step 7: Browser pane lists 4 components.
- [ ] Step 8: Click **Cut List tab** (in the BOM/Cut List strip next to
      the Assembly tab). Cut List table appears.
- [ ] Step 9: Exactly **3 distinct rows**:
      - `600 × 400 × 18` Birch 18mm — QTY **2** (the two sides with Front band)
      - `600 × 400 × 18` Birch 18mm — QTY **2** if grain-matched, **or** a
        single `600 × 400` row at QTY 2 and a separate `600 × 600` row at QTY 2.

        Actually with Front band on only 2 panels and none on the others:
        - Row 1: `600 × 400` PVC 1mm white on Front — QTY 2
        - Row 2: `600 × 600` (no bands) — QTY 2
      
      Two distinct rows is correct (the two matching sides collapse to qty 2;
      the two matching tops collapse to qty 2).

- [ ] Step 10: **Edge Band Totals** section below the main rows lists
      `PVC 1mm white` with a positive mm or m total (≥ 1 200 mm for
      two front edges at 600 mm each).
- [ ] Step 11: Click **Export CSV**. A save-file dialog opens with the
      suggested name `<assembly-name>-cutlist.csv`.
- [ ] Step 12: Open the saved CSV in a spreadsheet application.
      Verify three sections render correctly:
      - Section 1: panel rows (Item#, QTY, Length, Width, Thickness,
        Material, Grain, and edge-band columns).
      - Section 2: edge-band totals.
      - Section 3: excluded (non-panel) parts footer — empty if all
        parts are panels.

### Failure indicators

- Cut List tab button missing or disabled. → Recovery: confirm the
  active document is an assembly; check console for
  `OpenCutListTabCommand` registration errors.
- Rows show QTY 1 each instead of collapsing duplicates. → Bug:
  `cutListRowKey` normalization is not matching identical panels;
  inspect the key via DevTools:
  `__zilventorStore.getState().activeAssembly.cutListItemNumbers`.
- Edge Band Totals section is empty despite banded panels. → Bug:
  `aggregateCutListRecursive` is not summing `bandTotals`; check the
  `bandTotals` field on the returned `CutListResult`.
- CSV export saves but opens as a single column. → The delimiter may
  not match the locale's list separator; try opening with
  Import Wizard in the spreadsheet and set delimiter to comma.

---

## Scenario 2 — Two-level recursion

Verifies that placing a cabinet sub-assembly twice in an outer kitchen
assembly doubles all panel QTY counts.

### Setup

- [ ] Step 1: Start from the 4-panel assembly saved as `Cabinet.ziasm`
      (from Scenario 1, or a fresh 4-panel assembly).
- [ ] Step 2: **File** → **Save assembly** → name `Cabinet`. Confirm it
      lands as `Cabinet.ziasm`.

### Run

- [ ] Step 3: **File** → **New Assembly** (creates an outer assembly).
- [ ] Step 4: **File** → **Place sub-assembly** (or use the Place
      dialog). Select `Cabinet.ziasm`. Place it — first instance lands.
- [ ] Step 5: Place `Cabinet.ziasm` a second time. Browser pane shows
      two top-level sub-assembly nodes.

### Expected results

- [ ] Step 6: Click **Cut List tab**. Wait for rows to appear
      (OPFS reads for the nested parts may take ~1 s).
- [ ] Step 7: QTY column for every row is **exactly double** the
      Scenario 1 counts (e.g., the `600 × 400` row shows QTY 4,
      the `600 × 600` row shows QTY 4).
- [ ] Step 8: Edge Band Totals quantity is also doubled.

### Failure indicators

- QTY values match Scenario 1 (not doubled). → Bug: the recursive
  walker is not descending into the sub-assembly; confirm
  `__zilventorLoadSubAsmTree` has hydrated the sub-asm cache by
  checking `__zilventorSubAsmCacheGet('Cabinet.ziasm')` in DevTools.
- Cut List tab shows 0 rows. → The panelSpecCache may not have been
  warmed for sub-assembly leaves; hard-reload and retry, or inspect
  `__zilventorStore.getState()` for the sub-assembly docs.

---

## Scenario 3 — Renumber + edit persistence

Verifies that Item# values can be renumbered, manually edited with
collision-bump protection, and survive a save/reload cycle.

### Setup

- [ ] Step 1: Open any assembly with at least 3 distinct panel specs
      (the Scenario 1 cabinet works if it has 3+ rows).
- [ ] Step 2: Open the **Cut List tab**.

### Run

- [ ] Step 3: Click **Renumber**. Rows receive consecutive Item# values
      starting at 1 (1, 2, 3 … for however many rows exist).
- [ ] Step 4: Click the Item# cell in row 2 (value `2`). An inline
      text input appears.
- [ ] Step 5: Type the same value as row 1 (i.e., `1`) and confirm
      (press Enter or click away). This is an intentional collision.
- [ ] Step 6: Observe that the formerly-row-1 Item# bumps to `max+1`
      (e.g., if there are 3 rows and max was 3, row 1 becomes 4). No
      cascade — only the conflicting row moves.
- [ ] Step 7: **File** → **Save assembly** (or wait for autosave).

### Expected results

- [ ] Step 8: Hard-reload the browser tab.
- [ ] Step 9: **File** → **Open** → pick the saved assembly.
- [ ] Step 10: **Cut List tab** opens. Item# values match the post-edit
      state (the manually set value and the bumped value persist;
      renumber resets are also persisted).
- [ ] Step 11: No row has Item# 0 or a duplicate.

### Failure indicators

- After reload, all Item# values are gone (reverted to auto-numbered
  or blank). → Bug: `cutListItemNumbers` is not being written to the
  autosave archive; inspect the saved `.ziasm` manifest with a tar
  viewer and check `document.cutListItemNumbers`.
- Collision-bump does not fire — row 1 keeps its value and a duplicate
  appears. → Bug: the conflict-resolution guard in
  `SetCutListItemNumberCommand` is not activating; re-run
  `cut-list-renumber.spec.ts` to isolate.

---

## Sign-off

| Date | Initials | Pass / Notes |
|---|---|---|
| | | |
