# Sub-project 5c — Hardware Library smoke test

User-run checklist. Seven scenarios covering the hardware library feature
happy path: dialog defaults, component placement, cut-list integration,
grouping, category switching, undo, and CSV export. Passing all seven is
the gate for declaring sub-project 5c shipped from the user's perspective.

Prereqs once per machine:

- ZilInventor running locally (`pnpm --filter @zilventor/app dev`) or a
  deployed URL accessible from a recent Chrome/Edge.
- A clean OPFS root for these scenarios. To wipe: open DevTools →
  Application → Storage → "Clear site data".

---

## Test Setup

- [ ] Step 1: Open ZilInventor in a fresh browser tab.
- [ ] Step 2: **File** tab → **New Assembly**. Name the assembly "Test Run".
      Browser pane shows the empty assembly node.
- [ ] Step 3: **Furniture** → **Manage Materials** → **+ Add**. Create one
      material:
      - Name: `Oak 18mm`, Default thickness: `18`, Color: any.
      Click **Add**, then **Done**.

---

## T1 — Hardware dialog defaults

Verifies that the Add Hardware dialog opens with correct preselections:
Category="Hinges" and the first variant "35mm Cup Hinge — Full Overlay"
selected by default.

- [ ] Step 1: **Furniture** tab → **Hardware** ribbon panel → **Add
      Hardware**. A dialog opens.
- [ ] Step 2: Verify **Category** dropdown shows `Hinges` as the selected
      value.
- [ ] Step 3: Verify the variant grid contains at least one radio button
      option. The first option is labeled "35mm Cup Hinge — Full Overlay"
      and is **selected** (radio button filled).
- [ ] Step 4: No other variant is selected.

**Pass criterion:** Dialog opens with Category="Hinges" and first variant
preselected.

---

## T2 — Hardware placement

Verifies that clicking OK places a hardware component and writes the file to
OPFS.

- [ ] Step 1: From T1, click **OK** without changes.
- [ ] Step 2: Browser pane shows a new component node under "Test Run"
      assembly (e.g., "35mm Cup Hinge — Full Overlay" or "Hardware 1").
- [ ] Step 3: Open **DevTools** → **Application** → **Storage** → **File
      System**. Navigate to the OPFS root. Verify that a file matching the
      pattern `hardware/hinge-35mm-cup-full.zipt` exists (exact name may
      vary; confirm it contains "hinge" and ".zipt" extension).

**Pass criterion:** Component appears in browser pane and .zipt file exists
in OPFS.

---

## T3 — Hardware in cut list

Verifies that the hardware component appears in the Cut List tab in a
dedicated Hardware section below the panel table.

- [ ] Step 1: From T2, **Furniture** → **Cut List**. The Cut List tab opens.
- [ ] Step 2: Below the main panel aggregation table, verify a **Hardware**
      section is visible with a header row showing columns: **SKU**,
      **Name**, **Category**, **Qty**, **Notes**.
- [ ] Step 3: Verify one row appears under Hardware with:
      - SKU: `hinge-35mm-cup-full` (lowercase, kebab-case)
      - Name: "35mm Cup Hinge — Full Overlay"
      - Category: "Hinges"
      - Qty: **1**
      - Notes: (empty or populated per spec)

**Pass criterion:** Hardware section present with correct hinge row and
Qty=1.

---

## T4 — Hardware grouping

Verifies that adding a duplicate hardware component increments the Qty
column instead of creating a second row.

- [ ] Step 1: From T3, **Furniture** → **Hardware** → **Add Hardware**. The
      dialog opens with Category="Hinges" and first variant selected.
- [ ] Step 2: Click **OK** without changes.
- [ ] Step 3: Browser pane shows a second component node (same type or named
      "Hardware 2").
- [ ] Step 4: Stay on or re-open the **Cut List** tab. Verify the Hardware
      section now shows **one row** (not two) with:
      - SKU, Name, Category identical to T3
      - Qty: **2** (not two separate rows with Qty=1 each)

**Pass criterion:** Duplicate hardware is grouped; Qty increments from 1 to
2.

---

## T5 — Category switching

Verifies that changing the category dropdown updates the variant grid to
show new options, and selecting a variant allows placement of a different
hardware type.

- [ ] Step 1: **Furniture** → **Hardware** → **Add Hardware**. Dialog opens.
- [ ] Step 2: Click the **Category** dropdown. Verify "Shelf Pins" is listed
      as an option. Select **Shelf Pins**.
- [ ] Step 3: Verify the variant grid updates and shows **3 entries**:
      - "5mm Steel"
      - "5mm Clear"
      - "7mm Sleeve"
      (or similar shelf pin variants; exact names confirm hardware database
      is loaded).
- [ ] Step 4: Select the **first entry** (e.g., "5mm Steel") by clicking its
      radio button.
- [ ] Step 5: Click **OK**.
- [ ] Step 6: Browser pane shows a new component (e.g., "Shelf Pin 5mm
      Steel" or "Hardware 3").
- [ ] Step 7: Open **Cut List** tab. Verify the Hardware section now shows
      **two rows**:
      - First: hinge (Qty=2 from T4)
      - Second: shelf pin (Qty=1, category="Shelf Pins")

**Pass criterion:** Category dropdown updates variant grid, new hardware type
placed and visible in cut list as separate row.

---

## T6 — Undo removes hardware and deletes files

Verifies that Ctrl+Z removes hardware components one at a time and deletes
OPFS files when reference count drops to zero.

- [ ] Step 1: From T5, verify OPFS contains two hardware .zipt files
      (hinge and shelf pin). Use DevTools → Application → Storage → File
      System to inspect.
- [ ] Step 2: Press **Ctrl+Z**. Browser pane shows one hardware component
      removed (shelf pin gone, two hinges remain or shown as single Qty=1).
- [ ] Step 3: Open DevTools and confirm the shelf-pin .zipt file is **deleted
      from OPFS** (only hinge file remains).
- [ ] Step 4: Press **Ctrl+Z** again. One hinge is removed. Cut List Hardware
      section now shows Qty=1.
- [ ] Step 5: Press **Ctrl+Z** a third time. The last hinge is removed.
      Browser pane shows no hardware components. Cut List Hardware section is
      **empty or hidden**.
- [ ] Step 6: Open DevTools. Verify **both hardware .zipt files are deleted
      from OPFS** (no `hardware/*.zipt` files remain).

**Pass criterion:** Three undos remove three components and delete all
associated files from OPFS.

---

## T7 — CSV export includes hardware

Verifies that exporting the cut list to CSV includes a dedicated Hardware
section with correct structure and data.

- [ ] Step 1: From T6 (after the three undos, assembly is in a clean state),
      **Furniture** → **Hardware** → **Add Hardware** → accept defaults →
      **OK**. A hinge is added.
- [ ] Step 2: **Furniture** → **Cut List** tab. Below the panel table, the
      Hardware section shows one row with the hinge.
- [ ] Step 3: Locate and click the **Export Cut List** button (typically near
      the top or bottom of the Cut List tab).
- [ ] Step 4: A **Save As** dialog appears. Choose a location and save the
      CSV file (e.g., "cut-list.csv"). Open it in a text editor or
      spreadsheet.
- [ ] Step 5: Verify the CSV contains:
      - Panel rows at the top (if any panels were in the assembly)
      - Edge band totals section (if applicable)
      - A **`# Hardware`** section header line
      - A header line: `SKU,Name,Category,Qty,Notes`
      - One data row: hinge SKU, name, "Hinges", 1, (notes)

**Pass criterion:** CSV export includes dedicated Hardware section with
correct header and data row.

---

## Sign-off

| Date | Initials | Pass / Notes |
|---|---|---|
| | | |
