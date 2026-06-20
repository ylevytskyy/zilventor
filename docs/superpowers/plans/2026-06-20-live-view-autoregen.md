# Live View Auto-Regen (Drawing Associativity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Auto-update views" toggle that automatically regenerates stale drawing views when their source changes, so drawings stay in sync without a manual banner click.

**Architecture:** A localStorage-persisted `autoRegen` store flag (default ON), a `DrawingCanvas` effect that calls the existing `handleRegenerate` for each stale view under an attempted-ref guard (each view auto-regenerates at most once per source-change episode — required because `handleRegenerate` is fire-and-forget, has no concurrency guard, and clears the stale flag only on success), and a toggle button in DrawingTab.

**Tech Stack:** TypeScript, Vitest + React Testing Library (unit), Playwright (e2e), React + Zustand.

## Global Constraints

- Stay on branch `feat/wall-tall-cabinets`. Commit when each task is green (do NOT push until controller says so).
- `autoRegen` is a localStorage UI setting, NOT document data → **NO format-version bump**. `CURRENT_FORMAT_VERSION` stays 30.
- Default `autoRegen` = **true (ON)** — mirror `showEdgeBands` init exactly: `localStorage.getItem('autoRegen') !== 'false'`.
- The attempted-ref guard is load-bearing: a stale view must auto-regenerate **at most once per source-change episode**; the ref resets when `activeDrawingSourceFingerprint` (or drawing/sheet id) changes. Never write an effect that re-dispatches a still-stale view on every render.
- Run unit suites from inside the package: `cd packages/app && npx vitest run <spec>` (a repo-root `vitest run` globs all packages).
- tsc per package: `cd packages/app && npx tsc --noEmit`.
- e2e from repo root: `npx playwright test tests/e2e/drawing/<spec> --project=chromium`.
- Known pre-existing flake: `App.spec.tsx` `frameToModel` (passes in isolation) — NOT a regression.

---

## File map

- `packages/app/src/store/useAppStore.ts` — add `autoRegen` slot + `setAutoRegen` (mirror `showEdgeBands` at :761/:789). Add the field to the store TYPE/interface too.
- `packages/app/src/drawing/DrawingCanvas.tsx` — read `autoRegen`; add `autoRegenAttemptedRef`; reset the ref inside the existing stale-detection effect (:163); add a new auto-regen effect after `handleRegenerate` (~:1029).
- `packages/app/src/shell/tabs/DrawingTab.tsx` — "Auto-update views" toggle button.
- `packages/app/src/i18n/locales/en.json` + `uk.json` — `ribbon.drawing.autoUpdateViews` (+ tooltip key).
- `tests/e2e/drawing/auto-regen.spec.ts` (new, repo root) — §6 e2e.

---

### Task 1: Store `autoRegen` flag + setter

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts` (slot near :761; setter near :789; the store state type/interface where `showEdgeBands`/`setShowEdgeBands` are declared)
- Test: `packages/app/src/store/__tests__/autoRegen.spec.ts` (new)

**Interfaces:**
- Produces: store field `autoRegen: boolean` (default true) and `setAutoRegen(v: boolean): void` (persists to `localStorage['autoRegen']`).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/app/src/store/__tests__/autoRegen.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../useAppStore';

describe('autoRegen store flag', () => {
  beforeEach(() => { localStorage.removeItem('autoRegen'); });

  it('defaults to true', () => {
    expect(useAppStore.getState().autoRegen).toBe(true);
  });

  it('setAutoRegen(false) updates state and persists to localStorage', () => {
    useAppStore.getState().setAutoRegen(false);
    expect(useAppStore.getState().autoRegen).toBe(false);
    expect(localStorage.getItem('autoRegen')).toBe('false');
  });

  it('setAutoRegen(true) persists "true"', () => {
    useAppStore.getState().setAutoRegen(true);
    expect(localStorage.getItem('autoRegen')).toBe('true');
    expect(useAppStore.getState().autoRegen).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npx vitest run src/store/__tests__/autoRegen.spec.ts`
Expected: FAIL — `autoRegen`/`setAutoRegen` undefined.

- [ ] **Step 3: Add the slot + setter (mirror showEdgeBands)**

In the store state TYPE/interface, beside `showEdgeBands: boolean;` / `setShowEdgeBands: (v: boolean) => void;`, add:
```typescript
  autoRegen: boolean;
  setAutoRegen: (v: boolean) => void;
```
In the store implementation, beside the `showEdgeBands` slot (:761):
```typescript
  autoRegen: typeof localStorage !== 'undefined' ? localStorage.getItem('autoRegen') !== 'false' : true,
```
Beside `setShowEdgeBands` (:789):
```typescript
  setAutoRegen: (v) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('autoRegen', String(v));
    set({ autoRegen: v });
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && npx vitest run src/store/__tests__/autoRegen.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/app && npx tsc --noEmit`
```bash
git add packages/app/src/store/useAppStore.ts packages/app/src/store/__tests__/autoRegen.spec.ts
git commit -m "feat(drawing): autoRegen store flag (M3.2 task 1)"
```

---

### Task 2: Auto-regen effect in DrawingCanvas (with attempted-ref guard)

**Files:**
- Modify: `packages/app/src/drawing/DrawingCanvas.tsx` (`autoRegenAttemptedRef` near :139; reset inside the stale-detection effect at :163; new effect after `handleRegenerate` ~:1029)
- Test: `packages/app/src/drawing/__tests__/DrawingCanvas.autoRegen.spec.tsx` (new)

**Interfaces:**
- Consumes: `autoRegen` (Task 1), existing `staleViews` state, existing `handleRegenerate(viewId)` callback, existing `computeStaleViewIds`.
- Produces: when `autoRegen` is true, each stale view id is passed to `handleRegenerate` exactly once per source-change episode.

**Implementation notes for the engineer:**
- `staleViews` is `useState<Set<string>>` at `DrawingCanvas.tsx:139`. The stale-detection effect at `:163` already runs on `[drawing.id, sheet.id, activeDrawingSourceFingerprint]` — fold the ref reset into it so the reset always precedes the auto-dispatch.
- `handleRegenerate` is a `useCallback` defined ~`:1017` that internally builds a dispatcher via `buildHandleRegenerate(...)` (imported from `./handleRegenerateHelpers`) and calls it. The unit test mocks `buildHandleRegenerate` to return a spy, so the test asserts the effect's dispatch behavior without needing a real kernel projection.
- The new auto-regen effect MUST be placed AFTER `handleRegenerate` is defined.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/app/src/drawing/__tests__/DrawingCanvas.autoRegen.spec.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useAppStore } from '../../store/useAppStore';

// Mock the regenerate dispatcher so we observe per-id calls without a real kernel projection.
const regenSpy = vi.fn();
vi.mock('../handleRegenerateHelpers', async (orig) => {
  const actual = await orig<typeof import('../handleRegenerateHelpers')>();
  return { ...actual, buildHandleRegenerate: () => regenSpy };
});

import { DrawingCanvas } from '../DrawingCanvas';
import { CutListCacheProvider } from '../../cutlist/CutListCacheContext'; // adjust to the real provider path/name used by other DrawingCanvas tests

// Build a drawing whose single base view is STALE: it has a projection + an inputFingerprint
// that does NOT match the store's activeDrawingSourceFingerprint. (Mirror the stale-view fixture
// shape from computeStaleViewIds.spec.ts / existing DrawingCanvas tests.)
function seedStaleDrawing(autoRegen: boolean) {
  // ... seed useAppStore with activeDrawing (1 sheet, 1 base view with projection + inputFingerprint:'old'),
  //     activeDrawingSourceFingerprint:'new', activePart/activeAssembly as the existing DrawingCanvas
  //     tests do, and setAutoRegen(autoRegen).
}

function renderCanvas() {
  return render(/* <CutListCacheProvider><DrawingCanvas/></CutListCacheProvider> — match the existing DrawingCanvas test harness */ null as never);
}

describe('DrawingCanvas auto-regen effect', () => {
  beforeEach(() => { regenSpy.mockClear(); cleanup(); localStorage.clear(); });

  it('regenerates each stale view once when autoRegen is on', () => {
    seedStaleDrawing(true);
    renderCanvas();
    expect(regenSpy).toHaveBeenCalledTimes(1);
    expect(regenSpy).toHaveBeenCalledWith('v1'); // the stale view id
  });

  it('does NOT regenerate when autoRegen is off', () => {
    seedStaleDrawing(false);
    renderCanvas();
    expect(regenSpy).not.toHaveBeenCalled();
  });

  it('does not re-dispatch a still-stale view on re-render (attempted-ref guard)', () => {
    seedStaleDrawing(true);
    const { rerender } = renderCanvas();
    expect(regenSpy).toHaveBeenCalledTimes(1);
    rerender(/* same tree */ null as never);
    expect(regenSpy).toHaveBeenCalledTimes(1); // guard: not called again
  });

  it('re-dispatches after the source fingerprint changes (new episode resets the ref)', () => {
    seedStaleDrawing(true);
    renderCanvas();
    expect(regenSpy).toHaveBeenCalledTimes(1);
    // change the source fingerprint so the view is stale against a NEW source
    useAppStore.getState().setActiveDrawingSourceFingerprint?.('newer'); // use the real setter name
    expect(regenSpy).toHaveBeenCalledTimes(2);
  });
});
```

> NOTE to engineer: fill `seedStaleDrawing`/`renderCanvas` by copying the store-seed + provider wrapper from the existing DrawingCanvas test suite (e.g. `DrawingCanvas.addBalloon.spec.tsx` from M3.1) and the stale-view fixture shape from `computeStaleViewIds.spec.ts`. The real setter for the source fingerprint slot may differ — use whatever `loadDrawingSource`/the store exposes; if there is no public setter, use `useAppStore.setState({ activeDrawingSourceFingerprint: 'newer' })`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npx vitest run src/drawing/__tests__/DrawingCanvas.autoRegen.spec.tsx`
Expected: FAIL — no auto-regen effect, `regenSpy` not called.

- [ ] **Step 3: Add the ref + reset + auto-regen effect**

Near the `staleViews` declaration (`:139`):
```typescript
  // Auto-regen: track which stale views we've already auto-dispatched this source-change episode.
  const autoRegenAttemptedRef = useRef<Set<string>>(new Set());
```
Read the flag near the other store selectors (`:142`):
```typescript
  const autoRegen = useAppStore((s) => s.autoRegen);
```
Fold the ref reset into the existing stale-detection effect (`:163`):
```typescript
  useEffect(() => {
    autoRegenAttemptedRef.current = new Set(); // new episode → allow fresh auto-attempts
    setStaleViews(computeStaleViewIds(sheet.views, activeDrawingSourceFingerprint));
  }, [drawing.id, sheet.id, activeDrawingSourceFingerprint]);
```
After `handleRegenerate` is defined (~`:1029`), add:
```typescript
  // M3.2: live associativity — auto-regenerate stale views when enabled.
  // Guarded by autoRegenAttemptedRef so a view that stays stale (regen failed) is not
  // re-dispatched every render; the ref resets on each source-change episode (above).
  useEffect(() => {
    if (!autoRegen) return;
    for (const id of staleViews) {
      if (!autoRegenAttemptedRef.current.has(id)) {
        autoRegenAttemptedRef.current.add(id);
        handleRegenerate(id);
      }
    }
  }, [autoRegen, staleViews, handleRegenerate]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && npx vitest run src/drawing/__tests__/DrawingCanvas.autoRegen.spec.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/app && npx tsc --noEmit`
```bash
git add packages/app/src/drawing/DrawingCanvas.tsx packages/app/src/drawing/__tests__/DrawingCanvas.autoRegen.spec.tsx
git commit -m "feat(drawing): auto-regenerate stale views under attempted-ref guard (M3.2 task 2)"
```

---

### Task 3: "Auto-update views" toggle button + §6 e2e

**Files:**
- Modify: `packages/app/src/shell/tabs/DrawingTab.tsx` (a RibbonPanel — place near the view/reference controls)
- Modify: `packages/app/src/i18n/locales/en.json`, `packages/app/src/i18n/locales/uk.json`
- Test: `packages/app/src/shell/tabs/__tests__/DrawingTab.autoRegen.spec.tsx` (new)
- Test: `tests/e2e/drawing/auto-regen.spec.ts` (new, repo root)

**Interfaces:**
- Consumes: `autoRegen` + `setAutoRegen` (Task 1); the auto-regen behavior (Task 2).
- Produces: a toggle button reflecting `autoRegen` (`aria-pressed`) that flips it.

- [ ] **Step 1: Write the failing unit test**

```typescript
// packages/app/src/shell/tabs/__tests__/DrawingTab.autoRegen.spec.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '../../../store/useAppStore';
import { DrawingTab } from '../DrawingTab';
// mirror the i18n/provider wrapper used by the existing DrawingTab tests (e.g. DrawingTab.autoBalloon.spec.tsx)

describe('DrawingTab auto-update toggle', () => {
  beforeEach(() => { localStorage.clear(); });

  it('reflects autoRegen state via aria-pressed and toggles it', () => {
    useAppStore.getState().setAutoRegen(true);
    render(/* <Providers><DrawingTab/></Providers> */ null as never);
    const btn = screen.getByRole('button', { name: /auto-update views/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(btn);
    expect(useAppStore.getState().autoRegen).toBe(false);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/app && npx vitest run src/shell/tabs/__tests__/DrawingTab.autoRegen.spec.tsx`
Expected: FAIL — no such button.

- [ ] **Step 3: Add the toggle button + i18n**

In `DrawingTab.tsx`, read the flag near the other store selectors:
```tsx
const autoRegen = useAppStore((s) => s.autoRegen);
const setAutoRegen = useAppStore((s) => s.setAutoRegen);
```
Add the button in an appropriate RibbonPanel (mirror an existing button's markup; add `aria-pressed`):
```tsx
<button
  type="button"
  aria-pressed={autoRegen}
  className={/* mirror sibling button classes; reflect pressed state if the others do */ undefined}
  onClick={() => setAutoRegen(!autoRegen)}
>
  {t('ribbon.drawing.autoUpdateViews')}
</button>
```
Add to `en.json`: `"autoUpdateViews": "Auto-update views"` under the `ribbon.drawing` object (and an `autoUpdateViewsTip` if sibling buttons have tooltips). Add the Ukrainian equivalent to `uk.json` (e.g. `"autoUpdateViews": "Авто-оновлення видів"`). Keep en/uk key parity.

- [ ] **Step 4: Run unit test + typecheck**

Run: `cd packages/app && npx vitest run src/shell/tabs/__tests__/DrawingTab.autoRegen.spec.tsx && npx tsc --noEmit`
Expected: PASS; tsc clean.
If an existing `DrawingTab.spec.tsx` asserts a panel/button COUNT, update it to include the new button (same adaptation pattern as M3.1's Auto-balloon button).

- [ ] **Step 5: Write the §6 e2e**

```typescript
// tests/e2e/drawing/auto-regen.spec.ts
import { test, expect } from '@playwright/test';
// Mirror the app-bootstrap from tests/e2e/drawing/T-6-17-projection-pipeline.spec.ts (assembly →
// drawing → base view) and the M3.1 tests/e2e/drawing/balloons.spec.ts seeding via window.__zilventorStore.

test('auto-regen clears a stale view without a manual click', async ({ page }) => {
  await page.goto('/');
  // ... open/seed an assembly drawing with a base view that has a valid projection + inputFingerprint ...
  // ensure autoRegen is ON (default true; or set via window.__zilventorStore.getState().setAutoRegen(true))
  // Make the view stale: change the source so activeDrawingSourceFingerprint differs from the view's
  //   inputFingerprint (re-run loadDrawingSource with new bytes, OR set the fingerprint slot to a new value).
  // Assert the stale banner appears, then auto-disappears WITHOUT a click:
  await expect.poll(async () => page.evaluate(() => {
    const drw = (window as any).__zilventorStore.getState().activeDrawing;
    const v = drw.sheets[0].views[0];
    return v.inputFingerprint; // after auto-regen succeeds, equals the new source fingerprint
  })).toBe(/* the new source fingerprint */ 'EXPECTED_NEW_FP');
  // And the stale ⚠️ element is gone:
  await expect(page.locator('[data-ann-kind], [data-stale]')).toBeTruthy(); // adjust selector to the real stale-banner element in ViewElement.tsx
});
```

> NOTE to engineer: the stale banner element in `ViewElement.tsx:177` is the ⚠️ `<g>`; give it a stable `data-*` hook if it lacks one (small, additive) so the e2e can assert its disappearance. For the regen to SUCCEED in-browser the source must be loaded (that's why we mirror the projection-pipeline e2e). If a genuine end-to-end stale→regen cycle proves intractable in the e2e harness after real effort, report DONE_WITH_CONCERNS with the unit tests green (Tasks 1–2 + this task's unit test) and a precise description of the e2e blocker — do NOT fake a passing e2e.

- [ ] **Step 6: Run the e2e**

Run: `npx playwright test tests/e2e/drawing/auto-regen.spec.ts --project=chromium` (from repo root)
Expected: PASS. Read back any captured output/screenshot.

- [ ] **Step 7: Full app suite + commit**

Run: `cd packages/app && npx vitest run && npx tsc --noEmit`
Expected: green except the known pre-existing `App.spec.tsx` flake.
```bash
git add packages/app/src/shell/tabs/DrawingTab.tsx packages/app/src/shell/tabs/__tests__/DrawingTab.autoRegen.spec.tsx packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/uk.json tests/e2e/drawing/auto-regen.spec.ts packages/app/src/drawing/ViewElement.tsx
git commit -m "feat(drawing): Auto-update views toggle + e2e (M3.2 task 3)"
```

---

## Self-Review

**Spec coverage:**
- §3 `autoRegen` store flag (default true, persisted) → Task 1. ✓
- §3 auto-regen effect + attempted-ref guard + reset on fingerprint change → Task 2. ✓
- §4 DrawingTab toggle + i18n → Task 3. ✓
- §6 e2e (banner clears without click) → Task 3 Step 5. ✓
- §5 no format bump → Global Constraints. ✓
- §3 default ON → Global Constraints + Task 1. ✓

**Placeholder scan:** The test bodies contain `null as never` render placeholders and `seedStaleDrawing`/`renderCanvas` stubs that the engineer fills by copying the named existing harness (`DrawingCanvas.addBalloon.spec.tsx`, `computeStaleViewIds.spec.ts`, `T-6-17-projection-pipeline.spec.ts`). These are explicit pointers to real existing fixtures, not vague TODOs; each is named. The `EXPECTED_NEW_FP` and stale-banner selector are filled from the seeded fingerprint and `ViewElement.tsx`.

**Type consistency:** `autoRegen: boolean` / `setAutoRegen(v: boolean)` consistent Tasks 1→2→3. `autoRegenAttemptedRef: useRef<Set<string>>` and `handleRegenerate(viewId: string)` consistent with the existing code. i18n key `ribbon.drawing.autoUpdateViews` consistent Task 3 unit test ↔ implementation.

**Risk to watch:** Task 2's auto-regen effect depends on `handleRegenerate`, whose identity changes when `staleViews` changes (its `useCallback` deps include `staleViews`). The effect re-runs on each `staleViews` change — the attempted-ref guard is what keeps that from re-dispatching already-attempted views. Confirm the ref is module-stable across renders (it is — `useRef`) and reset only in the stale-detection effect.
