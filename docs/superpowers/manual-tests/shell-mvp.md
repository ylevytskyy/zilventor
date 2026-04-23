# Shell MVP Manual Test Checklist

Target hardware: 2014-2016 Intel i3/i5 laptop, Intel HD/UHD integrated graphics,
4-8 GB RAM, current Chrome stable.

Sign off with date, laptop model, and measured metrics at the bottom.

## Prep

- Do a clean production build:
  ```
  pnpm -r build
  pnpm --filter @zilventor/app preview
  ```
- Open http://localhost:4173 in Chrome.
- Open DevTools → Performance / Memory for metric capture.

## Tests

1. [ ] **Cold start.** First visit with empty cache. Time from URL-enter to
       "Ready" in the status bar. Target: < 5 s. Record peak memory during
       startup. Target: < 600 MB.

2. [ ] **Workflow 2 — create box.** Model → New Part → Sketch → Rectangle
       (100 × 200) → Finish Sketch → Extrude (50). Box should appear in the
       viewport. Confirm no main-thread tasks > 50 ms during the workflow
       (DevTools Performance panel).

3. [ ] **Workflow 3 — edit + undo/redo.** Double-click `Extrusion1` in the
       browser pane, change distance, OK. Then Ctrl+Z five times, Ctrl+Y five
       times. The stack should handle at least 20 operations without errors
       or stale meshes.

4. [ ] **Workflow 4 — save + reopen.** File → Save As → choose `.zipt`. Close
       the tab. Reopen the app, File → Open → pick the saved file. Geometry
       and feature tree must be intact.

5. [ ] **PWA offline.** Turn Wi-Fi off and reload the page — the app must
       still load and be usable. Requires a fresh production build + preview
       server (step above); the dev server does not register the service
       worker with the same aggressiveness.

6. [ ] **Kernel-offline UI.** In DevTools Application → Service Workers →
       kill the kernel worker (or in the Sources panel, pause the worker
       thread for > 6 s). The red "Kernel stopped — click to restart" banner
       should appear at the top of the shell. Clicking Restart should
       respawn the kernel and re-display the active part's mesh.

7. [ ] **Lighthouse PWA audit.** DevTools → Lighthouse → run against the
       production preview. The "Installable" PWA check must pass.

## Sign-off

- Date: ____
- Laptop model: ____
- Tester: ____
- Cold-start time (s): ____
- Peak memory during startup (MB): ____
- Notes: ____
