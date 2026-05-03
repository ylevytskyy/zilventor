# Sub-project 5b — Base Cabinet smoke test

User-run checklist. Six scenarios covering the base cabinet feature
happy path: creation, cut-list integration, edge bands, undo, validation,
and the no-active-assembly state. Passing all six is the gate for
declaring sub-project 5b shipped from the user's perspective.

Prereqs once per machine:

- ZilInventor running locally (`pnpm --filter @zilventor/app dev`) or a
  deployed URL accessible from a recent Chrome/Edge.
- A clean OPFS root for these scenarios. To wipe: open DevTools →
  Application → Storage → "Clear site data".

---

## Test Setup

- [ ] Step 1: Open ZilInventor in a fresh browser tab.
- [ ] Step 2: **File** tab → **New Assembly**. Name the assembly
      "Kitchen Run". Browser pane shows the empty assembly node.
- [ ] Step 3: **Furniture** → **Manage Materials** → **+ Add**.
      Create two materials:
      - Name: `Birch 18mm`, Default thickness: `18`, Color: any.
      - Name: `Hardboard 6mm`, Default thickness: `6`, Color: any.
      Click **Add** for each, then **Done**.

---

## T1 — Default base cabinet

Verifies that the Base Cabinet dialog opens, accepts defaults, and places
a cabinet component with correct dimensions.

- [ ] Step 1: **Furniture** → **Cabinets** → **Base Cabinet**. A dialog
      opens with fields: Width, Depth, Height, Thickness, Material, Shelf
      Count, Edge Band Material.
- [ ] Step 2: Verify defaults are populated:
      - Width: `600`, Depth: `560`, Height: `720`, Thickness: `18`
      - Material: `Birch 18mm`
      - Shelf Count: `1`
      - Edge Band Material: `None`
- [ ] Step 3: Click **OK** without changes.
- [ ] Step 4: Browser pane shows a new component `Base Cabinet` as a
      child of "Kitchen Run" assembly.
- [ ] Step 5: 3D viewport shows a cabinet-shaped solid. Measure tool or
      visual inspection confirms approximate dimensions 600 (W) ×
      560 (D) × 720 (H) mm.

**Pass criterion:** Cabinet placed, component visible in browser pane and
viewport with expected dimensions.

---

## T2 — Cut list integration

Verifies that the Base Cabinet's panels are aggregated correctly in the
Cut List tab.

- [ ] Step 1: From T1, **Furniture** → **Cut List**. The Cut List tab
      opens and aggregates all panels from the cabinet.
- [ ] Step 2: Verify approximately **5 aggregated rows**:
      - 1× sides QTY 2 (left + right merged)
      - 1× bottom + top QTY 2 (merged)
      - 1× back QTY 1
      - 1× toekick QTY 1
      - 1× shelf QTY 1
      
      (The aggregator merges identical L/W/T/material/grain rows.)
- [ ] Step 3: Verify each row shows Length, Width, Thickness, Material,
      Grain, and QTY columns.

**Pass criterion:** Cut List shows correct aggregated row count and
structure.

---

## T3 — Edge bands

Verifies that edge-band material can be set, causes the cabinet name to
auto-bump on re-open, and band totals are computed.

- [ ] Step 1: Re-open the Base Cabinet dialog (**Furniture** → **Cabinets**
      → **Base Cabinet** from the browser pane context menu, or create a
      new one).
- [ ] Step 2: Set **Edge Band Material** to any non-None entry
      (e.g., `Hardboard 6mm`). Click **OK**.
- [ ] Step 3: Browser pane shows the component is now named
      "Base Cabinet 2" (name auto-bumped due to same parameters).
- [ ] Step 4: Open **Cut List** tab. Verify the **Edge Band Totals**
      section below the main rows is non-empty and lists the edge-band
      material with a positive length total (mm or m).

**Pass criterion:** Edge-band material set, name auto-bumps, band totals
non-empty.

---

## T4 — Undo round-trip

Verifies that Ctrl+Z correctly removes cabinet placements.

- [ ] Step 1: From T3, press **Ctrl+Z**.
- [ ] Step 2: Browser pane shows the "Base Cabinet 2" component is
      removed.
- [ ] Step 3: Assembly node is still present; only the component is gone.

**Pass criterion:** Ctrl+Z removes the most recent cabinet.

---

## T5 — Validation

Verifies that invalid parameter values trigger inline error messages and
grey out the OK button.

- [ ] Step 1: **Furniture** → **Cabinets** → **Base Cabinet** (create a
      new one, or re-open the first).
- [ ] Step 2: Set **Width** to `30` (below minimum 100 mm). An inline
      error message appears above or below the field. **OK** button is
      greyed out.
- [ ] Step 3: Set **Shelf Count** to `99` (above a reasonable limit). A
      second inline error appears. **OK** remains greyed.
- [ ] Step 4: Correct Width back to a valid value (e.g., `600`). Shelf
      Count error remains. **OK** is still greyed.
- [ ] Step 5: Correct Shelf Count to a valid value (e.g., `1`). Both
      errors clear. **OK** is enabled.

**Pass criterion:** Invalid values block submission with visible error
messages.

---

## T6 — No-active-assembly state

Verifies that the Base Cabinet button is greyed out when no assembly is
active (e.g., a part document is open).

- [ ] Step 1: From the current assembly, **File** → **New Part** (creates
      a new part document without an assembly context).
- [ ] Step 2: Click the **Furniture** tab in the ribbon.
- [ ] Step 3: Locate **Base Cabinet** button (under **Cabinets** panel or
      menu). It is **greyed out** (disabled).
- [ ] Step 4: Hover over the disabled button. A **tooltip** appears
      explaining that a base cabinet requires an active assembly
      (e.g., "Base Cabinet requires an active assembly.").

**Pass criterion:** Base Cabinet button greyed and tooltip present in
non-assembly context.

---

## Sign-off

| Date | Initials | Pass / Notes |
|---|---|---|
| | | |
