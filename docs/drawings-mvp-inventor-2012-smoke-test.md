# Drawings MVP — Inventor 2012 manual smoke test

The Drawings MVP is fully unit/e2e/browser-verified inside ZilInventor, but the
one thing CI cannot check is **real Autodesk Inventor 2012 compatibility** —
whether DXF we write actually opens cleanly in Inventor, and whether DXF Inventor
writes imports cleanly as an underlay. Run this checklist once on the Inventor box.

Spec: `docs/superpowers/specs/2026-05-28-drawings-mvp-design.md` (acceptance tests
1–4). Locked decisions: R12/AC1009 DXF, first-angle (ISO), DXF-underlay-only import.

Prereqs: a running ZilInventor build; Autodesk Inventor 2012; a model with at
least one **hole** (for radial/diametric dims) and a small **assembly** of ≥2
components (for a non-trivial parts list).

Mark each step ✅/❌ and note anything Inventor complains about.

---

## Part A — ZilInventor export → opens in Inventor 2012 (acceptance 1, 2, 4)

Build a representative drawing in ZilInventor first:

1. Open the holed part (or the assembly). **File → New drawing** (or the drawing
   that sources it). Drawing tab → **Place Views → Base View** — confirm a
   projected view appears with visible/hidden edges.
2. Add **Projected View(s)** (top/side). ☐ **Verify FIRST-ANGLE layout**: the
   top view sits *below* the front view and the left-side view to the *right*
   (ISO/European), NOT third-angle. This is the headline Inventor-2012-metric
   convention check.
3. Dimension tab → **Radial** (or **Diametric**), click a hole's circular edge →
   an `R…`/`⌀…` leader appears.
4. Add a couple of **Linear**/**Aligned** dims; optionally **Auto-Dim**.
5. Annotate → **Parts List** → click the sheet → a BOM table (ITEM/QTY/PART NAME/
   MATERIAL/DIMENSIONS/EDGE BANDS) appears with real rows. (Warm the Cut List tab
   first if material/dimension cells come up blank — cold cache → BOM-only rows.)
6. Confirm the **title block** (bottom-right) shows Drawn-by/Approved/Scale/
   Material/Notes cells and the **first-angle projection symbol** (truncated-cone
   glyph: trapezoid with the concentric circles on its RIGHT).
7. Confirm each base/projected view has a **SCALE n:m** label beneath it; section
   views (if added) show a **SECTION X-X** heading.

Now export and open in Inventor:

8. Export tab → **Export DXF** (and separately **Export DXF (1:1)**). Save the
   `.dxf`.
9. ☐ **Open the DXF in Inventor 2012** (File → Open, or import into a drawing as
   AutoCAD DXF). **It must open WITHOUT a format/parse error** (this is the R12/
   AC1009 lock — acceptance 4).
10. ☐ Geometry intact: view outlines/edges present and correctly placed
    (first-angle). Straight box edges may show as many short segments (OCCT
    tessellation) — that's expected, not corruption.
11. ☐ Text readable: dimension texts (`R…`, `⌀…`, linear values), view SCALE
    labels, SECTION headings, title-block field text, and **all parts-list rows**
    are present and legible. Diameter symbol should read as `⌀` (DXF `%%c`).
12. ☐ Section hatch (if you added a section view) shows as line segments on a
    `SECTION-HATCH` layer (R12 has no native HATCH — segments are intended).
13. ☐ Layers look sane (VISIBLE/HIDDEN/SECTION-*/DIMENSIONS/ANNOTATIONS/
    HOLE-TABLE/PARTS-LIST/TITLE). Note any layer Inventor flags.
14. Repeat 9–13 with the **DXF (1:1)** file (true-scale variant) and the
    multi-sheet export if you have >1 sheet.
15. Sanity-check **PDF** export opens and looks right (not Inventor-specific, but
    confirms the same content renders).

---

## Part B — Inventor 2012 DXF → imports as underlay (acceptance 3)

1. In Inventor 2012, export a real drawing (or sketch) to **AutoCAD DXF**. If the
   export dialog offers a version, any of R12 / 2000 / 2004 / 2007 / 2010 is fine
   (the importer uses `dxf-parser`, which handles AC1009–AC1024).
2. In ZilInventor, open/active a drawing. Drawing tab → **Reference → Import DXF
   Underlay…** → choose the Inventor DXF.
3. ☐ A **grey, non-editable backdrop** appears **behind** the views.
4. ☐ **Centered & on-sheet**: the backdrop is centered in the drawable area (not
   off-page), at **1:1** (true size — measure a known dimension if possible).
5. ☐ **Upright, not mirrored**: any TEXT in the DXF reads left-to-right and
   upright; asymmetric geometry matches the source orientation (y-flip is
   handled).
6. ☐ **Non-pickable**: clicking the backdrop selects nothing (pointer-events off).
7. ☐ **Block geometry present**: if the Inventor DXF wraps geometry in blocks
   (INSERT), it still shows (block-flattening). ⚠️ Known limit: INSERT
   **rotation/scale** is not applied — only translation. If a rotated/scaled block
   looks misplaced, that's the documented gap, note it.
8. Reference → **Remove Underlay** → backdrop disappears; the button greys out.
9. ☐ **Persistence**: Save the drawing (`.zidw`), reload/reopen → the underlay is
   still there (and still centered/upright).

---

## Known limitations to expect (not bugs)

- INSERT **rotation/scale** not applied (translation only) — fine for axis-aligned
  Inventor views; rotated blocks may be mispositioned.
- LWPOLYLINE **bulge arcs** are straight-segment approximated (curved profiles
  slightly faceted).
- `$INSUNITS ≠ mm` is **not** scaled (assumes mm — true for standard Inventor
  metric exports).
- Underlay SCALE-label font: on export the label scales with the view; on the
  live canvas it stays constant size (constant is the more Inventor-correct one).

## If something fails

Capture: the exact Inventor error text, the offending `.dxf` (attach it), and
which step. The DXF writer is `packages/app/src/drawing/dxfWriter.ts` +
`renderDrawingDxf.ts`; the underlay reader is
`packages/app/src/drawing/parseDxfUnderlay.ts`. A failing real-world DXF makes a
perfect regression fixture — drop it under `packages/app/src/drawing/__tests__/`.
