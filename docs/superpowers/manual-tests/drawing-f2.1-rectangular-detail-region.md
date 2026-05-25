# Drawing F2.1 — Rectangular Detail Region: Manual Smoke Checklist

Run this checklist on a local dev build after T-6-16 passes in CI.

## Steps

1. **Open an existing drawing with a base view.**
   - Open any `.zidw` file that has at least one base or projected view with a populated projection.
   - Expected: Drawing tab shows the view with visible edges.

2. **Place a rect detail view.**
   - Click Drawing → Place Views → Detail (Rect).
   - Click a parent view to set the first corner of the marquee region (status bar: "Pick first corner").
   - Drag to the opposite corner (rubber-band rectangle visible while dragging).
   - Release to commit the rectangle region (width and height clamped to ≥ 1.0 mm).
   - Click to drop the detail view on an empty area of the sheet.
   - Expected: Detail view appears with pre-clipped edges (only edges inside the rect), "DETAIL B" + "2:1" caption below, and a rectangle outline on the parent view at the region location.

3. **Edit the rect detail region — move center.**
   - Click Drawing → Edit Detail Region.
   - Drag the interior of the callout rectangle on the parent to move the region center.
   - Expected: The callout rectangle moves; the detail view's clipped edges update live (real-time re-clip). No stale banner.

4. **Edit the rect detail region — resize a corner.**
   - While in Edit Detail Region mode, drag one of the four corner handles.
   - Expected: The opposite corner stays fixed; widthMm/heightMm recompute; callout rectangle resizes; detail edges re-clip live. Dimensions clamped to ≥ 1.0 mm (no degenerate collapse).

5. **Undo / redo.**
   - Press Ctrl+Z to undo the corner resize.
   - Expected: Region snaps back to previous size. Detail edges re-clip to original region.
   - Press Ctrl+Y to redo.
   - Expected: Corner resize re-applied. Edges re-clip to resized region.

6. **Export to PDF — verify rect border and callout.**
   - Click File → Export → Export as PDF.
   - Open the exported PDF in any viewer.
   - Expected: Detail view border is a rectangle (not a circle); "DETAIL B" caption present; parent view shows the rectangular callout outline; PDF opens without error.

7. **Export to SVG — inspect data-role attributes.**
   - Click File → Export → Export as SVG (or use the drawing export command).
   - Open the SVG in a text editor.
   - Expected: `<rect data-role="detail-border">` inside the detail view group; `<rect data-role="detail-callout-label">` inside the callout group on the parent; no `<circle data-role="detail-border">` for the rect region.

8. **Roundtrip save/reload.**
   - Save the drawing (Ctrl+S).
   - Close and reopen the file.
   - Expected: Rect detail view still visible (regionParent.kind='rect' round-trips through v19 migration); no stale banner; caption, callout rect, and clipped edges intact.

9. **Circle detail view unchanged.**
   - Place a circle detail view (Drawing → Detail) alongside the rect detail.
   - Expected: Circle detail still renders a circle border and circle callout; both circle and rect coexist on the same sheet without interference.
