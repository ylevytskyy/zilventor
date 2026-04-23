# Sub-project 2a Manual Test Checklist

Performed on the target laptop: 2014–2016 Intel i3/i5, Intel HD/UHD integrated graphics, 4–8 GB RAM, current Chrome.

Sign off at the bottom with date, laptop model, and any anomalies observed.

## Setup

1. [ ] `git checkout subproject-2a` (or `master` if 2a already merged)
2. [ ] `pnpm install && pnpm --filter @zilventor/app build && pnpm --filter @zilventor/app preview`
3. [ ] Open the preview URL. Expect the Shell MVP UI: ribbon, browser pane, viewport, status bar.

## Sketch mode entry / exit

1. [ ] Click **Model → New Part**. Browser pane shows Part1.
2. [ ] Click **Sketch tab → 2D Sketch**. Camera pulls in close to XY, a 2D grid becomes visible within ~200 ms. Ribbon shows 5 primitive buttons.
3. [ ] Click **Finish Sketch**. Camera returns to the previous perspective view. Grid hides.

## Drawing primitives (interactive)

Re-enter sketch mode before each test.

4. [ ] **Line** — Click tool, then two points in the viewport. Primitive count increments to 1 in the browser pane. Visible line segment in the viewport.
5. [ ] **Line with horizontal-axis snap** — Pick a point, then hover the cursor roughly horizontal from it. A dashed axis hint appears. Click near the hint; the committed line has identical Y to the first point.
6. [ ] **Line with numeric input** — Click first point. A small numeric input appears near the cursor (offset +20/+20). Type `500` and press Enter. A 500 mm line in the current direction commits.
7. [ ] **Rectangle** — Click tool, two corner clicks. Rectangle outline visible.
8. [ ] **Circle** — Click center, then a radius point. Circle outline visible.
9. [ ] **Arc** — Click start, click end, click midpoint. Arc outline follows the three points.
10. [ ] **Spline** — Click 4+ control points, press Enter. Smooth curve through the control polygon.

## Delete + undo

11. [ ] With at least one primitive present, double-click a feature in the browser pane to select it. Press Delete. Primitive removed. Primitive count decrements.
12. [ ] Ctrl+Z (or Cmd+Z on macOS). Primitive restored.
13. [ ] Ctrl+Y (or Cmd+Shift+Z). Primitive removed again.

## Extrude

14. [ ] Draw a closed rectangle. Finish Sketch. Model tab → Extrude → 18 mm → OK. Box visible in viewport.
15. [ ] Draw 6 line segments forming a closed L-shape. Finish Sketch → Extrude → 50 mm. L-shaped solid visible.
16. [ ] Draw 3 DISCONNECTED line segments. Finish Sketch → Extrude → 18 mm. Status bar shows "Sketch is not closed — cannot extrude." No solid appears.

## Save + reopen (format v1 → v2)

17. [ ] Save the current part as `.zipt`. Close tab. Reopen the browser, load the file. Sketch and primitives render. Extrusion re-runs and the solid appears.
18. [ ] If a `.zipt` from pre-2a (Shell MVP era, single-rectangle sketches) is available, load it. It should migrate silently and display correctly. Ids like `s1-p0` should be synthesized.

## PWA offline

19. [ ] Disable the network. Reload the tab. App still loads (service worker serves cached assets). Kernel boots; sketching still works.

## Perf sanity

20. [ ] Cold start to Ready: < 5 s (same budget as Shell MVP §7.1).
21. [ ] Committing a line primitive: < 100 ms between second click and viewport update.
22. [ ] Drawing 20 primitives consecutively: no noticeable lag; status stays "Ready".

## Sign-off

- Date: ____
- Laptop model: ____
- Tester: ____
- Cold-start time (s): ____
- Notes / anomalies: ____
