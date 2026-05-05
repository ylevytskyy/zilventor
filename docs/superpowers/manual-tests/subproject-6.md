# Sub-project 6 — Manual smoke checklist

Run after merge, on the user's local box. Mirrors the 5e/5d/5c/5b patterns.

## Setup

- `pnpm dev` from repo root, open the printed URL in Chromium.
- Open DevTools console.
- Open (or create) a project that already has at least one part (e.g. a Base Cabinet assembly).

---

## T1 — Create drawing from cabinet → 4 views → Export PDF → spot-check

1. With a Base Cabinet assembly open and active, click **File → New Drawing**. Accept defaults (A3 landscape).
2. **Expect:** A new drawing tab opens. The canvas shows a blank A3 sheet with border and title block. Title block "Part" field shows the cabinet assembly name; "Date" shows today.
3. Click **Drawing → Place Views → Base View**. In the dialog, set orientation = **Front**, scale = **1:1**. Click anywhere on the canvas.
4. **Expect:** The front silhouette of the cabinet is rendered in the SVG with visible solid edges and hidden dashed edges.
5. Click **Drawing → Place Views → Projected View** (parent = the base view, direction = **Right**). Click to the right of the base view.
6. Repeat for **Top** (above) and **Iso (NE corner)**.
7. **Expect:** 4 view groups in the canvas, each with distinct silhouettes. Iso view has no hidden lines by default.
8. Click **Drawing → Export → Export PDF**.
9. Save the file and open it in Preview (macOS) or Evince.
10. **Expect:** 1 PDF page (A3 landscape). Title block in the bottom margin is legible (drawing name, date, scale). All 4 views are present at correct scale; scale ≈ 1:1 visible from the comparison of dimensions to the known cabinet size.

---

## T2 — Edit source → Regenerate → PDF reflects new geometry

1. Continue from T1 state (drawing open with 4 views).
2. Switch to the source cabinet tab. Change the cabinet **Height** parameter (e.g. from 720 mm to 900 mm). Apply.
3. Switch back to the drawing tab.
4. **Expect:** Each view shows a red ⚠ "Source changed" stale marker in its top-left corner. Views appear dimmed.
5. Click **Regenerate All** in the ribbon (or click ⚠ on each view individually → Regenerate).
6. **Expect:** All stale markers clear. The Front and Right views are visibly taller (reflecting the 900 mm height). The Iso view reflects the taller cabinet.
7. Click **Drawing → Export → Export PDF**.
8. Open the PDF and compare to the T1 PDF.
9. **Expect:** The new PDF shows the taller cabinet geometry. All 4 views updated.

---

## T3 — 5-sheet drawing → Export PDF → 5 pages

1. From the T2 drawing state, click **Drawing → Sheet → New Sheet** four more times (total 5 sheets).
2. Add at least one view to each new sheet (copy-paste or place fresh Base View with different orientation).
3. Click **Drawing → Export → Export PDF**.
4. Open the exported PDF.
5. **Expect:** The PDF has exactly **5 pages** (one per sheet). Each page shows its corresponding views and title block with correct "Sheet n/5" in the bottom-right corner.

---

## T4 — Per-sheet PNG export

1. From the T3 drawing state, navigate to Sheet 1 in the DrawingTreePane.
2. Right-click Sheet 1 → **Export PNG** (or use the ribbon **Export → Export PNG**).
3. Save and open the PNG.
4. **Expect:** The PNG is at least 1024 px wide. The content visually matches the on-screen canvas render for Sheet 1 — same views, same border, same title block text.
5. Repeat for Sheet 2.
6. **Expect:** Sheet 2's PNG shows Sheet 2's views only (not Sheet 1's).

---

## T5 — V13 project migration — no regression

1. Open a project created with a previous build (before Sub-project 6, i.e. v13 manifest).
2. **Expect:** The project opens without errors. Existing parts and assemblies behave identically to the pre-6 build. No "unknown manifest version" or schema errors in the console.
3. Verify: the **Drawing** ribbon tab shows its (mostly disabled) stub when a part or assembly is active. No JavaScript exceptions.
4. Optional: create a new drawing inside the migrated project and confirm it opens as v14.

---

## Sign-off

| Date | Initials | Pass / Notes |
|---|---|---|
| | | |
