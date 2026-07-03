# P13 — Drag-to-move nest editing (ABF MORO parity)

**Status:** planned 2026-07-03 · branch `feat/p13-nest-drag-move`
**Source:** ABF parity gap audit 2026-07-03 — the one confirmed "Behind" verdict in
`docs/abf-plugin/05-parity/02-gap-analysis.md` (interactive nest-result editing). P7 shipped
nudge-buttons (1 mm / 10 mm) + 90° rotate via `EditPlacedPanelCommand`; ABF's MORO tool is
direct mouse drag with the same validation. This closes the interaction-layer gap.

## Goal (verifiable)

In Nesting-tab edit mode, pointer-dragging a placed panel rect on the sheet SVG shows a live
ghost preview colored by validity; releasing on a valid spot dispatches exactly one
`EditPlacedPanelCommand({type:'move', dx, dy})` through the undo bus; an invalid drop reverts
with the existing `panel.sheet.edit.errorBounds/errorOverlap` message. Nudge buttons stay.
Done = W1–W3 tests red→green, full app vitest + typecheck + lint 0, new e2e passes 3× repeat,
idle SVG render byte-identical to today (exact-count e2e specs untouched).

## Decisions

- **D1 — coordinate mapping:** reuse the `DetailRegionEditHandles.screenToSheet` per-axis
  precedent as-is. Known limitation: imprecise under `preserveAspectRatio` letterboxing when
  container aspect ≠ sheet aspect (drift off-cursor on unusual viewports). Accepted, not fixed
  here — matches codebase convention. (conf 70)
- **D2 — drag transience:** local `useState`/`useRef` in `SheetSvg.tsx`, not a global store;
  only one panel can be dragged at a time. Command dispatch once per gesture, on `pointerup`.
- **D3 — snap-to-edge:** OUT of done-criteria. ABF auto-snaps; implement only if W2 finds it
  near-zero marginal cost after ghost/validate plumbing exists. (conf 80)
- **D4 — validation source of truth:** W1 extracts a pure non-throwing predicate from
  `EditPlacedPanelCommand.validate`; command keeps throwing `EditRejectedError` identically.
  No duplicated bounds/overlap logic anywhere.
- **D5 — e2e settle:** `expect.poll` 10 s (suite default; the 60 s drag-gizmo deadline was a
  measured-contention special case, not a precedent).

## Slices (sequential — real coupling, do not parallelize)

1. **W1** `EditPlacedPanelCommand.ts`: export pure `evaluatePlacement`-style predicate
   (valid | {reason:'bounds'|'overlap'}); refactor `validate` to delegate; existing spec file
   green unmodified. → verify: package vitest (command spec) + typecheck.
2. **W2** `SheetSvg.tsx` + `NestingTab.tsx` (+ en/uk.json if new strings): pointer-drag with
   ghost preview using W1 predicate for live validity coloring; drag-start selects; drag-end →
   existing `handleEdit({type:'move',...})` path (reuses error plumbing). HARD constraint:
   no `data-nesting-panel` on ghost; idle render unchanged (exact-count assertions in
   `nesting-single-sheet` / `nesting-stale-banner` / `SheetSvg.spec` must survive untouched).
   → verify: full `cd packages/app && npx vitest run` + typecheck + lint.
3. **W3** new `tests/e2e/furniture/nesting-drag-move.spec.ts`: valid drag commits (poll store
   x/y settled + single history entry), invalid drag (onto other panel / off-sheet) reverts +
   error text visible. `page.mouse` drag idiom from `drag-gizmo.spec.ts`; no fixed sleeps.
   → verify: `--repeat-each=3` standalone, then full-suite gate before merge.

## Scope calls (autonomous, for user ratification)

- **S1:** Proceeded on the audit's top-ranked gap without per-item user sign-off (user AFK,
  "go on with next ABF task" directive; roadmap numbering continues as P13).
- **S2:** `flip` in the nest editor stays a cosmetic `mirrored` flag — an undirected rectangle
  has no chirality; not part of P13.
- **S3:** D1 letterbox imprecision accepted (see above) rather than building a
  letterbox-aware mapping.

## Risks

- Click-vs-drag threshold conflicts with existing `onClick` select — W2 must keep near-zero
  movement gestures selecting, not committing a 0-mm move.
- Exact-count e2e assertions are the known regression trap for any Nesting-tab DOM change.
- `bus.lastExecutedName()` availability for W3's history assertion inferred from
  drag-gizmo.spec.ts, not re-verified — W3 must grep before use.
