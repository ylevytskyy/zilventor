# Sub-project 1.5 — Inventor → ZilInventor migration smoke test

User-run checklist. Five scenarios, each runs end-to-end on a real
Inventor 2012 box and a recent ZilInventor build. Passing all five is
the gate for declaring sub-project 1.5 shipped.

Prereqs once per machine:

- Inventor 2012 installed.
- `tools/inventor-export/ZilInventorExport.ivb` imported into Inventor's
  Standard.ivb project (see `docs/migration/INVENTOR-EXPORT-README.md`
  for the install steps).
- ZilInventor running locally (`pnpm --filter @zilventor/app dev`) or a
  deployed URL accessible from the test box.
- Macro security set to **Disable with notification**
  (`Tools → Macros → Security…`).

---

## Scenario 1 — Single small `.ipt` with parameters and iProperties

### Setup

- [ ] Step 1: In Inventor, **File → New → Part (mm)**.
- [ ] Step 2: **Manage → Parameters** → add three numeric user
  parameters:
  - `Width = 600 mm`
  - `Height = 400 mm`
  - `Depth = 18 mm`
- [ ] Step 3: Sketch a `Width × Height` rectangle on the XY plane and
  extrude it by `Depth`. (Anything simple that produces a closed
  solid; the geometry doesn't need to use all three parameters.)
- [ ] Step 4: **iProperties** → fill in:
  - **Part Number:** `Z-001`
  - **Description:** `Side panel`
  - **Material:** `Plywood 18mm`
  - **Stock Number:** `Plywood`
- [ ] Step 5: Save as `SidePanel.ipt` in a fresh folder, e.g.
  `C:\zilv-smoke\scenario1\`.

### Run

- [ ] Step 6: With `SidePanel.ipt` active, **Tools → Macros…** →
  `ZilInventor_ExportActiveDocument` → **Run**.
- [ ] Step 7: Pick a fresh empty output folder, e.g.
  `C:\zilv-smoke\scenario1-out\`.

### Expected macro output

- [ ] Step 8: Output folder contains `SidePanel.step` and
  `SidePanel.ipt.json`.
- [ ] Step 9: `_export-log.txt` shows a single `OK   SidePanel.ipt`
  line.
- [ ] Step 10: Open `SidePanel.ipt.json` in a text editor. Confirm:
  - `schemaVersion: 1`, `kind: "part"`.
  - `properties` contains `partNumber: "Z-001"`,
    `description: "Side panel"`, `material: "Plywood 18mm"`,
    `stockNumber: "Plywood"`.
  - `parameters` contains `Width`, `Height`, `Depth`, each with
    `value`, `unit: "mm"`, and `expression`. Numeric values use a
    decimal point (`600`, not `600,0`).

### Expected ZilInventor outcome

- [ ] Step 11: Open ZilInventor → **File** tab →
  **Import from Inventor**.
- [ ] Step 12: Pick `C:\zilv-smoke\scenario1-out\` as input. Pick a
  fresh OPFS subfolder (e.g. `Smoke1`) as target. Conflict policy:
  **Overwrite**.
- [ ] Step 13: Click **Import**. Summary reports
  `1 part, 0 assemblies, 0 errors`.
- [ ] Step 14: Open `Smoke1/SidePanel.zipt`. Browser pane shows
  origin features plus one `Imported (SidePanel.step)` node.
- [ ] Step 15: **Parameters panel** lists `Width`, `Height`, `Depth`
  with the numeric values from step 2.
- [ ] Step 16: Properties panel (or BOM tab if you place this part in
  an assembly) shows Part Number `Z-001` and Description
  `Side panel`.
- [ ] Step 17: **Model tab** Add* buttons are disabled with the
  read-only tooltip on hover.

---

## Scenario 2 — Flat assembly with three placements + color overrides

### Setup

- [ ] Step 1: In Inventor, **File → New → Standard (mm).iam**.
- [ ] Step 2: Place `SidePanel.ipt` (from Scenario 1) three times.
  Position them roughly at:
  - Instance 1: at origin
  - Instance 2: translated +700 mm along X
  - Instance 3: translated −700 mm along X
- [ ] Step 3: Right-click instance 1 → **iProperties → Occurrence →
  Appearance** → set to a built-in Inventor color (e.g. **Red**).
- [ ] Step 4: Right-click instance 2 → set Appearance to a custom
  RGB color (e.g. `#3366cc`). Use **Manage → Materials and
  Appearances → Appearances** to author or pick.
- [ ] Step 5: Leave instance 3 with the part's default appearance
  (no override).
- [ ] Step 6: Save as `Bench.iam` in
  `C:\zilv-smoke\scenario2\`. The folder must contain
  `SidePanel.ipt` too (or be linked to its location).

### Run

- [ ] Step 7: With `Bench.iam` active, run
  `ZilInventor_ExportActiveDocument` → output to
  `C:\zilv-smoke\scenario2-out\`.

### Expected macro output

- [ ] Step 8: Output folder contains `Bench.iam.json`,
  `SidePanel.step`, `SidePanel.ipt.json`.
- [ ] Step 9: Open `Bench.iam.json`. Confirm:
  - `kind: "assembly"`, `schemaVersion: 1`.
  - `occurrences` array has 3 entries.
  - The first two carry a `color: { hex: "#..." }` field.
  - The third occurrence has **no** `color` field (default
    appearance is not exported).
  - Each occurrence has a `pose.translation` matching what you
    placed (within rounding), and a normalized
    `pose.quaternion`.
  - `visible: true`, `grounded: false` on all three (assuming you
    didn't ground anything).

### Expected ZilInventor outcome

- [ ] Step 10: Import `C:\zilv-smoke\scenario2-out\` into a fresh
  OPFS subfolder `Smoke2`.
- [ ] Step 11: Summary reports `1 part, 1 assembly, 0 errors`.
- [ ] Step 12: Open `Smoke2/Bench.ziasm`. Three components visible
  in the viewport at their Inventor positions.
- [ ] Step 13: Two instances render with the override colors; the
  third uses the part's default appearance.
- [ ] Step 14: BOM tab shows a row aggregating all three
  placements of the same part (qty 3) — or, depending on color-split
  policy, two color-split rows (qty 1 each for the colored
  instances) plus one default-color row (qty 1).

---

## Scenario 3 — Two-level assembly (`Cabinet.iam` containing `Door.iam`)

### Setup

- [ ] Step 1: Author `Panel.ipt` — any small simple `.ipt` (a
  parameterized box is fine). Save it in
  `C:\zilv-smoke\scenario3\`.
- [ ] Step 2: Create `Door.iam`. Place one instance of `Panel.ipt`.
  Save in the same folder.
- [ ] Step 3: Create `Cabinet.iam`. Place two instances of `Door.iam`
  (different positions, e.g. translated ±300 mm along Y). Save in
  the same folder.

### Run

- [ ] Step 4: **Tools → Macros…** → `ZilInventor_BatchExportFolder`
  → **Run**.
- [ ] Step 5: Pick `C:\zilv-smoke\scenario3\` as input,
  `C:\zilv-smoke\scenario3-out\` as output.

### Expected macro output

- [ ] Step 6: Output folder contains:
  - `Cabinet.iam.json`
  - `Door.iam.json`
  - `Panel.ipt.json`
  - `Panel.step`
  Note: `Door.iam` doesn't get a `.step` (assemblies have no STEP).
  `Panel.step` exists once even though `Cabinet → Door[1] →
  Panel` and `Cabinet → Door[2] → Panel` reference it twice.
- [ ] Step 7: `_export-log.txt` lists three `OK` lines (one per
  unique document).
- [ ] Step 8: Open `Cabinet.iam.json`. `occurrences` array has 2
  entries, each with `ref: "./Door.iam.json"`.
- [ ] Step 9: Open `Door.iam.json`. `occurrences` has 1 entry with
  `ref: "./Panel.ipt.json"`.

### Expected ZilInventor outcome

- [ ] Step 10: Import the folder into OPFS subfolder `Smoke3`.
- [ ] Step 11: Summary reports `1 part, 2 assemblies, 0 errors`.
- [ ] Step 12: Open `Smoke3/Cabinet.ziasm`.
- [ ] Step 13: Browser pane shows the two-level tree: `Cabinet →
  Door[1] → Panel`, `Cabinet → Door[2] → Panel`.
- [ ] Step 14: Both Door sub-assemblies render their Panels at the
  composed pose (Cabinet pose × Door pose × Panel pose).
- [ ] Step 15: BOM tab rolls up the two Panel instances into a
  single row with qty 2.

---

## Scenario 4 — Assembly with one part outside the input root (`_external/`)

### Setup

- [ ] Step 1: Create folder layout:
  ```
  C:\zilv-smoke\scenario4\
    MainAsm.iam
    Frame.ipt
  C:\zilv-smoke\scenario4-shared\
    Hardware\
      Hinge.ipt
  ```
- [ ] Step 2: `MainAsm.iam` references both `Frame.ipt` (sibling)
  and `Hinge.ipt` (which lives outside `scenario4\`).

### Run

- [ ] Step 3: `ZilInventor_BatchExportFolder` with input
  `C:\zilv-smoke\scenario4\`, output
  `C:\zilv-smoke\scenario4-out\`.

### Expected macro output

- [ ] Step 4: Output contains `MainAsm.iam.json`, `Frame.ipt.json`,
  `Frame.step`. The hinge part also exports — under
  `_external/Hardware/Hinge.ipt.json` + `_external/Hardware/Hinge.step`,
  preserving its source folder name.
- [ ] Step 5: `MainAsm.iam.json`'s second occurrence has
  `ref: "./_external/Hardware/Hinge.ipt.json"`.
- [ ] Step 6: `_export-log.txt` notes the external reference,
  e.g. `EXT  C:\zilv-smoke\scenario4-shared\Hardware\Hinge.ipt`.

### Expected ZilInventor outcome

- [ ] Step 7: Import the folder. Summary reports
  `2 parts, 1 assembly, 0 errors`.
- [ ] Step 8: Open `MainAsm.ziasm`. Both Frame and Hinge resolve
  correctly; assembly opens with both placed at their poses.
- [ ] Step 9: The browser pane shows one `Hardware/Hinge.zipt`
  reference under `_external/`.

---

## Scenario 5 — Re-run macro on populated output, then re-import

### Setup

- [ ] Step 1: Start from the completed Scenario 1 output folder.
  Don't delete it.

### Run (macro side)

- [ ] Step 2: Re-run `ZilInventor_ExportActiveDocument` on
  `SidePanel.ipt` from Scenario 1. Pick the *same* output folder
  (`C:\zilv-smoke\scenario1-out\`).
- [ ] Step 3: The macro overwrites the existing `.step` and
  `.ipt.json`. There is **no Inventor-side conflict policy** — this
  is a one-shot tool. If you want a clean state, delete the output
  folder before rerunning.
- [ ] Step 4: `_export-log.txt` is also overwritten — it now
  contains only the second run's lines, not history.

### Run (ZilInventor side, conflict-policy exercise)

- [ ] Step 5: Open ZilInventor. The OPFS subfolder `Smoke1` from
  Scenario 1 still exists.
- [ ] Step 6: Click **Import from Inventor** → pick
  `C:\zilv-smoke\scenario1-out\` → target `Smoke1` (existing).
  Conflict policy: **Skip existing**.
- [ ] Step 7: Click **Import**. Summary reports
  `0 parts imported, 1 skipped, 0 errors`.
- [ ] Step 8: Re-run import with conflict policy: **Overwrite
  existing files**.
- [ ] Step 9: Summary reports `1 part imported, 0 skipped, 0 errors`.
  The on-disk `Smoke1/SidePanel.zipt` now reflects the second
  export's contents.
- [ ] Step 10: Re-run with **Cancel on conflict**. Import aborts
  immediately on the first existing file; summary reports a
  cancelled state.

### Notes

- The Inventor-side macro is intentionally idempotent-ish: rerunning
  always overwrites. Re-running on a partial output is safe.
- The ZilInventor-side conflict policy is what handles re-imports —
  exercise all three radio options at least once during smoke
  testing to confirm the dialog plumbing.
- After Scenario 5, all three radio behaviors should be confirmed
  working.

---

## Sign-off

- [ ] Scenario 1 passed.
- [ ] Scenario 2 passed.
- [ ] Scenario 3 passed.
- [ ] Scenario 4 passed.
- [ ] Scenario 5 passed.

Once all five scenarios are checked, sub-project 1.5 is shipped from
the user's perspective. Note any scenario-specific quirks in the
project memory note for future reference.
