# Drawing F3 — Broken Views: Manual Smoke Checklist

Run this checklist on a local dev build after T-6-9 passes in CI.

## Steps

1. **Open an existing drawing with a long base or projected view.**
   - Open any `.zidw` file that has at least one `BaseView`, `ProjectedView`, or `IsoView`
     with a populated projection and a total bbox width > 100 mm along the x-axis.
   - Expected: Drawing tab shows the view with visible edges; no stale banner.

2. **Enter break mode and pick the x-axis.**
   - Click Drawing tab → Place Views → Add Break.
   - Click the base view (status bar: "Click a base, projected, or iso view to add a break.").
   - The "Choose break direction" dialog opens. Click "Horizontal break (remove X band)".
   - Status bar: "Click to set break start (coord along x axis)."
   - Click a point roughly 30 % across the view. Status bar: "Click to set break end."
   - Click a second point roughly 70 % across the view.
   - Expected: View visually compresses; a zigzag break symbol appears at the break
     boundary; the DrawingTreePane row for the view gains a "· [1 break(s)]" suffix.

3. **Create a second break on the same view (different x-band).**
   - Repeat step 2 picking a different, non-overlapping band (e.g. first break at 30–50 %,
     second break at 60–80 % of the original width).
   - Expected: Both zigzag symbols render; tree-pane suffix reads "· [2 break(s)]".
   - Confirm the two break symbols are visually distinct and do not overlap.

4. **Delete the first break and verify α-conditional invariant.**
   - Right-click the view → "Properties" (or use the command palette: DeleteBreak with
     the first break's ID — refer to the store via devtools `__zilventorStore.getState()`).
   - After deleting the first break, one break symbol remains visible.
   - After deleting the second (last) break, the view returns to its original uncompressed
     width; no zigzag symbols remain; `__zilventorStore.getState()` shows `rawProjection`
     is `undefined` on the view (α-conditional invariant restored).
   - Tree-pane suffix disappears once breaks reach zero.

5. **Export to PDF and inspect break symbols.**
   - With at least one break active on the view, click File → Export → Export as PDF.
   - Open the exported PDF in any viewer.
   - Expected: Zigzag break symbol visible in the PDF at the correct position; the view
     appears compressed; no artifacts outside the view bbox; PDF opens without error.

6. **Round-trip save/load via OPFS (breaks survive).**
   - With one or more breaks active, save the drawing (Ctrl+S / File → Save).
   - Close the drawing tab and reopen the file from the file picker or recent list.
   - Expected: Breaks are still present on the view; zigzag symbols render; no stale banner;
     `view.breaks.length` and `view.rawProjection` match the pre-save state.
