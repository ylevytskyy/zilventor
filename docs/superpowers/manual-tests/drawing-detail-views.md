# Drawing F2 — Detail Views: Manual Smoke Checklist

Run this checklist on a local dev build after T-6-8 passes in CI.

## Steps

1. **Open an existing drawing with a base view.**
   - Open any `.zidw` file that has at least one base or projected view with a populated projection.
   - Expected: Drawing tab shows the view with visible edges.

2. **Run the Detail tool.**
   - Click Drawing → Place Views → Detail.
   - Click the base view (stage: pickRegionCenter appears in status bar).
   - Click a point inside the view to set the region center.
   - Click a second point to set the radius (rubber-band circle visible during drag).
   - Click to drop the detail view on an empty area of the sheet.
   - Expected: Detail view appears with pre-clipped edges, "DETAIL A" + "2:1" caption below, and a circle with letter "A" on the parent view.

3. **Save and reopen the drawing.**
   - Save the drawing (Ctrl+S).
   - Close and reopen the file.
   - Expected: Detail view still visible; no stale banner; caption and callout circle intact.

4. **Export to PDF and inspect the detail border.**
   - Click File → Export → Export as PDF.
   - Open the exported PDF in any viewer.
   - Expected: Detail view border circle visible; "DETAIL A" caption present; parent view shows the callout circle; PDF opens without error (no corruption).
