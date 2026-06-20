# Live View Auto-Regen (Drawing Associativity) — Design

**Date:** 2026-06-20
**Branch:** `feat/wall-tall-cabinets`
**Milestone:** 3.2 (Shop-drawing documentation — live associativity).
**Status:** Design — pending implementation plan.

---

## 1. Goal

When a drawing view's source part/assembly changes, the view is currently marked **stale** (a ⚠️
banner) and the user must click it to regenerate. This adds **live associativity**: an "Auto-update
views" toggle that, when on, automatically regenerates stale views so the drawing stays in sync
without a manual click.

Non-goals (deferred): debouncing rapid source edits; a concurrency guard inside `handleRegenerate`
itself; auto-regen across non-active sheets.

---

## 2. Key findings (from code trace — all verified)

1. **Staleness** is React state in `DrawingCanvas.tsx:139` (`const [staleViews, setStaleViews] =
   useState<Set<string>>`), populated by an effect at `:163` via
   `computeStaleViewIds(sheet.views, activeDrawingSourceFingerprint)`
   (`computeStaleViewIds.ts:21` — stale iff `inputFingerprint` absent or `!==` the store's
   `activeDrawingSourceFingerprint`).
2. **`handleRegenerate(viewId)`** (`DrawingCanvas.tsx:1017`, built by
   `buildHandleRegenerate` in `handleRegenerateHelpers.ts:49`) re-projects the view, commits via
   `RegenerateViewCommand`, and calls `clearStaleView(viewId)` **only on success** (`:119`); on
   failure it logs + sets a status message and **leaves the view stale**. It is **fire-and-forget**
   (`void dispatcher(viewId)`) with **no concurrency guard**.
3. **Stale banner**: `ViewElement.tsx:177` renders a ⚠️ box `onClick={() => onRegenerate(view.id)}`,
   wired from `DrawingCanvas` (`isStale={staleViews.has(v.id)} onRegenerate={handleRegenerate}`).
4. **Store boolean pattern**: `showEdgeBands` (`useAppStore.ts:761` init
   `localStorage.getItem('showEdgeBands') !== 'false'`; setter `:789` writes `String(v)` + `set`).
   No `autoRegen` exists.
5. **Seam**: `DrawingCanvas` owns both `staleViews` and `handleRegenerate`; the auto-regen effect
   lives there.

---

## 3. Architecture & data flow

```
useAppStore: autoRegen (localStorage 'autoRegen', default TRUE) + setAutoRegen(v)
        │
DrawingTab "Auto-update views" toggle (aria-pressed=autoRegen) → setAutoRegen(!autoRegen)
        │
DrawingCanvas useEffect [autoRegen, staleViews, handleRegenerate]:
   if autoRegen:
     for id of staleViews:
       if !autoRegenAttemptedRef.current.has(id):
         autoRegenAttemptedRef.current.add(id)
         handleRegenerate(id)        // success → clearStaleView → drops from staleViews
   // separate effect: reset autoRegenAttemptedRef when activeDrawingSourceFingerprint changes
```

### The attempted-ref guard (load-bearing)
`handleRegenerate` has no concurrency guard and clears stale **only on success**, so a plain
"regenerate all stale views on every render" effect would re-dispatch a **failing** view on every
subsequent render → an infinite regen loop. `autoRegenAttemptedRef` (a `useRef<Set<string>>`) ensures
each stale view is auto-dispatched **at most once per staleness episode**:
- A **successful** regen clears the stale flag → the id leaves `staleViews` → never re-considered.
- A **failed** regen leaves the view stale, but its id stays in the ref → not re-dispatched (no loop).
  The user can still click the banner manually.
- When `activeDrawingSourceFingerprint` changes (a **new** edit episode), the ref is **reset**, so a
  previously-failed view gets a fresh auto-attempt against the new source.

This keeps auto-regen scoped to "one attempt per view per source change," matching the manual cadence
without runaway dispatch.

---

## 4. Surface changes

- **`useAppStore.ts`**: `autoRegen: boolean` slot (localStorage-init, default true) + `setAutoRegen`.
- **`DrawingCanvas.tsx`**: read `autoRegen` from the store; add `autoRegenAttemptedRef`; one effect
  that auto-dispatches per stale id under the ref guard; one effect that resets the ref on
  `activeDrawingSourceFingerprint` change.
- **`DrawingTab.tsx`**: "Auto-update views" toggle button (`aria-pressed`), wired to `setAutoRegen`.
- **i18n** `en.json` / `uk.json`: `ribbon.drawing.autoUpdateViews` (+ optional tooltip key).

No new files; no kernel/shared change.

---

## 5. Persistence / back-compat

`autoRegen` is a **localStorage UI setting**, not document data → **NO format-version bump**. Existing
drawings are unaffected; on first load `autoRegen` defaults to **true** (live). Toggling persists
across sessions.

---

## 6. Testing (TDD red→green per slice)

1. **Store**: `autoRegen` defaults true; `setAutoRegen(false)` sets state and writes
   `localStorage['autoRegen'] = 'false'`; re-init reads it back as false.
2. **Effect** (render `DrawingCanvas` with a stale view, spy the regenerate path —
   `RegenerateViewCommand` dispatch or a `handleRegenerate` seam):
   - autoRegen on + N stale ids → regenerate called once per id;
   - autoRegen off → never called;
   - a view that stays stale (simulated failure / unchanged staleViews) is **not** re-dispatched on
     a re-render (attempted-ref guard);
   - changing `activeDrawingSourceFingerprint` resets the ref so the view is auto-dispatched again.
3. **Toggle**: `DrawingTab` button reflects `autoRegen` (`aria-pressed`) and flips it via
   `setAutoRegen`.
4. **§6 e2e** (`tests/e2e/drawing/auto-regen.spec.ts`): autoRegen ON; open an assembly drawing with a
   base view; mutate the source so the view goes stale; assert the stale banner
   (`[data-stale]` / the ⚠️ element) **disappears without any click** and the view's
   `inputFingerprint` matches the new source fingerprint (via `window.__zilventorStore`).

---

## 7. Risks / deferred

- **No debounce**: rapid consecutive source edits each produce a new fingerprint episode → each
  triggers a regen. Same cadence as a user clicking repeatedly; acceptable for MVP. Debounce deferred.
- **No internal concurrency guard** in `handleRegenerate`: two different views can regenerate
  concurrently (fine — independent); the same view can't double-dispatch because of the attempted-ref.
- **Active-sheet scope**: the effect lives in the active `DrawingCanvas`, so only the visible sheet's
  views auto-regenerate; switching sheets re-mounts and re-evaluates staleness. Cross-sheet background
  regen is out of scope.
- **Persistently-failing view**: auto-regen attempts once per episode then stops (by design); the
  manual banner remains the escape hatch. No auto-retry storm.
