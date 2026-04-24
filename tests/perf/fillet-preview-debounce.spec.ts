import { test } from '@playwright/test';

/**
 * T31 — fillet preview debounce perf test.
 *
 * BLOCKED: the Fillet dialog's edges list can only be populated via the
 * interactive edge-pick flow, which depends on tessellated-edge extraction
 * from NamedShape. Until ExecutionResult surfaces picked-edge tessellation
 * data (and the EdgePickController's snapping code lights up), we cannot
 * drive enough Radius input to exercise the 200 ms debounce coalescing path
 * in a way that mirrors real usage.
 *
 * See 3b spec "Out of scope / deferred": tessellated-edge extraction lands in
 * a future task; once it does, this test should mirror
 * `tests/perf/revolve-preview-debounce.spec.ts` — open the dialog via F,
 * perform an interactive edge pick, rapid-fire 10 Radius fills ~100 ms apart,
 * and assert `window.__zilventorPreviewCount` stays <= 3 with a 2 s wall-time
 * budget.
 */
test.skip('Perf: 200ms fillet preview debounce coalesces rapid Radius input (blocked: edge-pick stub)', async () => {
  // Blocked: the dialog's `edges` prop is driven by App.tsx's `filletEdges`
  // state, which is initially []. The interactive pick flow (EdgePickController)
  // is stubbed pending tessellated-edge extraction from NamedShape. Seeding a
  // fillet via the kernel does not populate the dialog's edges — that state
  // lives in App-local React state, not the zustand store. Exposing a
  // `setFilletEdges` setter on the store is the enabling change, and it
  // belongs with the tessellated-edge extraction task rather than this perf
  // test. Re-enable once that lands.
});
