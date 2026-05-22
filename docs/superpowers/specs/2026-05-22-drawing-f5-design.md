# Drawing F5 — Baseline / Ordinate / Angular Dimension Styles

**Status:** Approved 2026-05-22 · **Manifest:** v18 (additive, no bump) · **Base:** `b2bb77f` (post-F4)

## Summary

Extend the drawing dimension pipeline with three new ANSI dimension layout styles:

- **Baseline** — multiple linear dims sharing a common datum, stacked at equal spacing
- **Ordinate** — perpendicular dims from a 0,0 origin with L-shaped elbow leaders
- **Angular** — measure the angle between two lines (or arc sweep) with a circular dim arc

Builds directly on F4 infrastructure: same `DrawingDimension` discriminated union, same `DrawingSheet.dimensions[]` collection, same cascade-text pattern (`sourceParameterName` / `textOverride` / computed). Adds a new `DrawingSheet.dimensionGroups[]` collection for baseline/ordinate group-level state. Extends `AutoDimCommand` to handle `dim-angle` sketch constraints (auto-generates angular dims).

Scope: 3 batches, ~1500-line plan. Mirrors F4 structure.

## Motivation

F4 shipped linear-h / linear-v / aligned auto-dimensioning. Real-world ANSI drawings need more layout styles:

- Baseline dims dominate machined-part drawings (multiple holes from a left datum).
- Ordinate dims dominate sheet-metal and mold drawings (coordinate readouts from origin).
- Angular dims are required wherever non-orthogonal geometry exists (most sketches with `dim-angle` constraints today produce no drawing dim).

F4 follow-up items F4.2 (angular from `dim-angle`) and F4.4 (baseline/ordinate layout) are subsumed by F5.

## Non-goals

- **Radial / diametric rendering** — those are currently stub renderers (`return ''` in `renderDrawingSvg.ts:196`). Out of scope; remains F4.1 follow-up.
- **Apex-point angular dims** (axis E2) — no sketch path today. Deferred to F5.5.
- **Group-level drag interactions** — drag-datum, drag-origin, drag-stack-spacing. Deferred to F5.1 / F5.2.
- **Auto-detection of baseline opportunities** — AutoDim stays linear; baseline/ordinate are manual-only. Deferred to F5.4.
- **DXF export of new kinds** — deferred to F5.8.
- **Manifest bump** — additive on v18; no migration code.

## Architecture

### Locked design axes (from brainstorming)

| Axis | Decision | Conf |
|------|----------|------|
| A — Data model | New discriminated-union kinds | 82 |
| B — Group storage | Separate `DimensionGroup[]` collection | 78 |
| C — Ordinate datum scope | One datum per ordinate set | 85 |
| D — Angular kind name | `angular` | 88 |
| E — Angular geometry source | Two `EdgeRef`s OR single arc `EdgeRef` | 80 |
| F — Angular auto-generation | Yes — extend AutoDim for `dim-angle` | 85 |
| G — Baseline/ordinate auto-gen | No — manual only | 70 |
| H — UI surface | 3 new ToolModes + extend AutoDim for angular | 78 |
| I — Cascade text | All new kinds support cascade | 88 |
| J — Angular arc side | `arcSide` field, default `'inside'` | 75 |
| K — Ordinate leader | L-shaped (ANSI standard) | 92 |
| L — Manifest | Additive on v18 | 85 |
| M — Scope | All three styles in F5 | 78 |
| N — Radial/diametric | Out of scope | 90 |

## Data model

### New `DrawingDimension` kinds

Added to the discriminated union in `packages/shared/src/drawing/types.ts`:

```ts
| {
    readonly kind: 'baseline';
    readonly id: string;
    readonly viewId: string;
    readonly groupId: string;        // FK to DimensionGroup of kind 'baseline'
    readonly slot: number;            // 0-indexed; stack position within group (offset = baseOffsetMm + slot * spacingMm)
    readonly to: PointRef;            // datum point is in the group
    readonly sourceParameterName?: string;
    readonly textOverride?: string;
  }
| {
    readonly kind: 'ordinate';
    readonly id: string;
    readonly viewId: string;
    readonly groupId: string;        // FK to DimensionGroup of kind 'ordinate'
    readonly to: PointRef;            // origin is in the group
    readonly axis: 'x' | 'y';
    readonly sourceParameterName?: string;
    readonly textOverride?: string;
  }
| {
    readonly kind: 'angular';
    readonly id: string;
    readonly viewId: string;
    readonly ref:
      | { readonly kind: 'two-edges'; readonly edge1: EdgeRef; readonly edge2: EdgeRef }
      | { readonly kind: 'arc';        readonly edge: EdgeRef };
    readonly arcSide: 'inside' | 'outside';   // default 'inside'
    readonly offsetMm: number;        // arc radius from apex / outward shift from arc edge
    readonly sourceParameterName?: string;
    readonly textOverride?: string;
  }
```

`EdgeRef` already exists for radial/diametric (`{ viewId; edgeId }`).

Existing kinds (`linear-h`, `linear-v`, `aligned`, `radial`, `diametric`) unchanged.

### New `DimensionGroup` collection

New type in `packages/shared/src/drawing/types.ts`:

```ts
export type DimensionGroup =
  | {
      readonly kind: 'baseline';
      readonly id: string;
      readonly viewId: string;
      readonly datum: PointRef;
      readonly direction: 'h' | 'v';
      readonly baseOffsetMm: number;   // offset of first member from datum
      readonly spacingMm: number;      // increment between members
    }
  | {
      readonly kind: 'ordinate';
      readonly id: string;
      readonly viewId: string;
      readonly origin: PointRef;
      readonly xColumnOffsetMm: number;   // distance from origin to vertical text column (for axis='x' members)
      readonly yColumnOffsetMm: number;   // distance from origin to horizontal text column (for axis='y' members)
    };
```

### `DrawingSheet` update

```ts
export interface DrawingSheet {
  // ... existing fields
  readonly dimensions: readonly DrawingDimension[];
  readonly dimensionGroups: readonly DimensionGroup[];   // NEW (defaults to [] on load for v18 files)
}
```

### Invariants

1. Every `baseline` dim's `groupId` resolves to a `DimensionGroup` with `kind: 'baseline'` on the same `viewId`.
2. Every `ordinate` dim's `groupId` resolves to a `DimensionGroup` with `kind: 'ordinate'` on the same `viewId`.
3. An `angular` dim with `ref.kind === 'two-edges'` MUST have `edge1.viewId === edge2.viewId === viewId`.
4. Baseline member stack position is determined by the `slot` field (0-indexed, monotonically assigned on add — next slot = `max(existing slots) + 1`). Ordinate members have no implicit ordering — each renders at its own `to` coordinate along the column line.
5. Deleting a `DimensionGroup` cascades — all member dims are removed in the same command.
6. A `DimensionGroup` may exist with zero members (between creation and first add).

### Backwards-compat / migration

- New kinds are additive on the discriminated union. Old files (v15+) load fine — none of their dims match the new kinds.
- New `dimensionGroups` field on `DrawingSheet` defaults to `[]` on load via JSON parse helper. No migration code needed (v18 stays).
- v18 files written by this build are readable by old builds *up to the point where they encounter a new-kind dim or any `dimensionGroups` entry*. Forward-compat is not a stated requirement (per CLAUDE.md §2 simplicity rule).

## Rendering

All in `packages/app/src/drawing/renderDrawingSvg.ts`.

### Baseline

For each `baseline` member dim:
1. Resolve `groupId` → group with `datum`, `direction`, `baseOffsetMm`, `spacingMm`.
2. Resolve member `to` PointRef → world point.
3. Resolve `datum` PointRef → world point.
4. Read member's `slot` field (0-indexed).
5. Member offset = `baseOffsetMm + slot * spacingMm`.
6. Render as a `linear-h` (if `direction === 'h'`) or `linear-v` (if `direction === 'v'`) dim from datum→to at the computed offset.
7. Two extension lines (from datum, from to) drop to the dim line. Dim line spans datum.X..to.X (h) or .Y..Y (v).
8. Arrowheads at both ends of the dim line. Text at midpoint, 1mm offset from dim line, parallel to line.
9. `data-dim-id`, `data-dim-kind="baseline"`, `data-group-id="<groupId>"`, `data-slot="<slot>"`.

### Ordinate

For each `ordinate` member dim:
1. Resolve `groupId` → group with `origin`, `xColumnOffsetMm`, `yColumnOffsetMm`.
2. Resolve member `to` PointRef → world point.
3. Resolve `origin` PointRef → world point.
4. For `axis === 'x'`: compute signed delta = `to.x - origin.x`. L-leader path: from `to` perpendicular up/down (sign matches `xColumnOffsetMm` sign convention) to the column line at `origin.y + xColumnOffsetMm`, then 90° elbow, then horizontal segment to the text. Text label = `|delta|.toFixed(2) mm`.
5. For `axis === 'y'`: mirror logic — signed delta = `to.y - origin.y`. L-leader from `to` perpendicular horizontally to the column at `origin.x + yColumnOffsetMm`, elbow, vertical to text.
6. No extension lines, no arrowheads on the leader — just a single L-stroke with a small arrowhead at the `to` end pointing to the feature. Text outside the elbow.
7. `data-dim-id`, `data-dim-kind="ordinate"`, `data-group-id="<groupId>"`, `data-axis="x|y"`.

### Angular (two-edges)

For each `angular` dim with `ref.kind === 'two-edges'`:
1. Resolve `edge1.edgeId` and `edge2.edgeId` → two `Edge2D` polylines in the view.
2. Treat each as an infinite line (first & last point define direction). Compute apex = line-line intersection.
3. If intersection fails (parallel) → render fallback: 1-line text label "—" at midpoint of the two-edge bounding box. Toast warning emitted by command, not render.
4. Compute the two ray-direction unit vectors `d1`, `d2` from apex outward (toward each edge's far endpoint).
5. Subtended angle (inside) = `acos(d1·d2)`. If `arcSide === 'outside'`, the rendered sweep = `2π - inside`.
6. Arc center = apex. Arc radius = `offsetMm`. Start and end angles = `atan2(d1.y, d1.x)` and `atan2(d2.y, d2.x)`. Render the arc that matches `arcSide`.
7. Arrowheads at both arc endpoints, tangent to arc.
8. Text at arc midpoint angle, offset radially outward by 1.5mm. Computed value = subtended-angle-in-degrees (3 decimals max, trailing zeros trimmed).
9. `data-dim-id`, `data-dim-kind="angular"`, `data-arc-side="inside|outside"`.

### Angular (arc)

For each `angular` dim with `ref.kind === 'arc'`:
1. Resolve `ref.edge.edgeId` → `Edge2D` of arc kind. Sketch arc has `center`, `radius`, `startAngle`, `endAngle` (or we derive via `arcCenter`/`arcStart`/`arcEnd` polyline metadata — see `Edge2D` shape).
2. Sweep = `endAngle - startAngle` (normalized to [0, 2π)).
3. Render dim arc at radius = `arcRadius + offsetMm` (outward from edge). Concentric with edge arc.
4. Arrowheads at both endpoints.
5. Text at arc midpoint angle, radially outward by 1.5mm.
6. `arcSide` field ignored for `ref.kind === 'arc'` (arc edges are unambiguous).
7. `data-dim-id`, `data-dim-kind="angular"`.

### Edge resolution

`findEdge2DById(view, edgeId)` helper — sketch lookup in `view.projection.edges` by `Edge2D.id`. Already exists for radial/diametric (verify path during implementation).

## Commands

All in `packages/app/src/commands/`.

### `AddDimensionGroupCommand`

```ts
new AddDimensionGroupCommand(sheetId: string, group: DimensionGroup)
```

- Appends `group` to `DrawingSheet.dimensionGroups`.
- Revert: removes by `group.id`.

### `AddBaselineMemberCommand`

```ts
new AddBaselineMemberCommand(sheetId: string, groupId: string, to: PointRef, opts?: { sourceParameterName?: string; textOverride?: string })
```

- Validates group exists + is `kind: 'baseline'` + same `viewId`.
- Computes `slot = max(slots of existing members in this group, -1) + 1` (so first member gets slot 0).
- Appends new `kind: 'baseline'` dim to `dimensions[]` with assigned UUID, `groupId`, computed `slot`, `to`, `viewId` from group, optional cascade fields.
- Revert: removes by dim id. (Note: holes in slot numbering are OK; next add still gets `max+1`. Slot reuse on revert is intentional — undoing then redoing produces identical state.)

### `AddOrdinateMemberCommand`

```ts
new AddOrdinateMemberCommand(sheetId: string, groupId: string, to: PointRef, axis: 'x'|'y', opts?: { sourceParameterName?: string; textOverride?: string })
```

- Same shape as baseline; adds `axis` field.

### `AddAngularDimCommand`

```ts
new AddAngularDimCommand(sheetId: string, viewId: string, ref: AngularRef, arcSide?: 'inside'|'outside', offsetMm?: number, opts?: { sourceParameterName?: string; textOverride?: string })
```

- Validates `ref` edges exist in `viewId`'s projection.
- Defaults: `arcSide = 'inside'`, `offsetMm = max(15, viewBboxMm.height * 0.1)`.
- Single-shot — no group concept.
- Revert: removes by dim id.

### `DeleteDimensionGroupCommand`

```ts
new DeleteDimensionGroupCommand(sheetId: string, groupId: string)
```

- Removes group + ALL member dims in one transaction.
- Revert: re-add group + member dims in original order.

### Updated existing commands

- **`DeleteDrawingDimensionCommand`** — if the deleted dim is the last member of its group, the group remains (empty, awaiting more members). No cascade. User can delete-empty-group manually.
- **`MoveDrawingDimensionCommand`** — extended to mutate `DimensionGroup` instead of dim when `dim.kind ∈ {baseline, ordinate}`:
  - Baseline member: updates `group.baseOffsetMm` (drag the whole stack).
  - Ordinate member: updates `group.xColumnOffsetMm` or `group.yColumnOffsetMm` based on `axis`.
  - Angular: updates `dim.offsetMm` (arc radius) directly on the dim.

## AutoDim extension

`packages/app/src/commands/AutoDimCommand.ts`. Currently filters sketch constraints to `dim-length` and `dim-distance`. Add a third branch:

```ts
case 'dim-angle': {
  const sketch = /* same lookup as today */;
  const line1 = sketch.primitives.find(p => p.id === c.line1);
  const line2 = sketch.primitives.find(p => p.id === c.line2);
  if (!line1 || !line2) continue;     // silent skip

  const edge1 = findMatchingEdge2D(line1, projection, viewMatrix);
  const edge2 = findMatchingEdge2D(line2, projection, viewMatrix);
  if (!edge1 || !edge2) continue;     // silent skip

  candidates.push({
    kind: 'angular',
    id: '',                            // assigned post-placement
    viewId,
    ref: { kind: 'two-edges', edge1: { viewId, edgeId: edge1.id }, edge2: { viewId, edgeId: edge2.id } },
    arcSide: 'inside',
    offsetMm: Math.max(15, viewBboxMm.height * 0.1),
    sourceParameterName: c.paramName,
  });
  break;
}
```

Angular candidates do NOT participate in greedy linear stacking (they live around the apex, not above/below/right of bbox). They're just appended with their default offset.

`greedyPlaceDims` signature unchanged. Just handles linear-h/v/aligned. Angular bypasses it.

Toast remains unchanged: "Placed N dimensions" where N includes angular.

## ToolModes & UI

### New `ToolMode` values

`packages/app/src/drawing/toolMode.ts`:

```ts
export type ToolMode = ... | 'autoDim' | 'baseline' | 'ordinate' | 'angular';
```

### Ribbon

`packages/app/src/shell/tabs/DrawingTab.tsx`, in the existing Dimension group next to AutoDim:

- **Baseline** button — `setMode('baseline')`. Disabled when no active drawing.
- **Ordinate** button — `setMode('ordinate')`. Same.
- **Angular** button — `setMode('angular')`. Same.

### DrawingCanvas click handlers

`packages/app/src/drawing/DrawingCanvas.tsx`. Each new mode is a multi-click session.

**Baseline session state** (in a `useRef`):
```ts
{ phase: 'pick-datum' | 'pick-members'; groupId?: string; viewId?: string }
```

- Phase `'pick-datum'`: click on a `data-edge-id` element (endpoint snap) → resolves PointRef → dispatches `AddDimensionGroupCommand` (creates group with `datum`, `direction` derived from datum's surrounding edge h/v, default `baseOffsetMm = max(20, bbox.height * 0.1)`, `spacingMm = 10`). Advances to phase `'pick-members'`.
- Phase `'pick-members'`: each click on a `data-edge-id` element → `AddBaselineMemberCommand`. Live preview shows the next stacked offset.
- Esc / mode-change / right-click → ends session. If zero members were added, dispatch `DeleteDimensionGroupCommand` to clean up.

**Ordinate session state:**
```ts
{ phase: 'pick-origin' | 'pick-members'; groupId?: string; viewId?: string }
```

- Phase `'pick-origin'`: same as baseline datum. Creates ordinate group with `origin`, `xColumnOffsetMm = max(20, bbox.height*0.1)`, `yColumnOffsetMm = max(20, bbox.width*0.1)`. Advances.
- Phase `'pick-members'`: click on edge → infers axis from feature's relative position to origin (closer X-aligned → `axis: 'y'`, closer Y-aligned → `axis: 'x'`; or hold Shift to flip). `AddOrdinateMemberCommand`.
- Esc → ends session, deletes empty group.

**Angular session state:**
```ts
{ phase: 'pick-edge-1' | 'pick-edge-2'; viewId?: string; edge1?: EdgeRef }
```

- Phase `'pick-edge-1'`: click on `data-edge-id` element → store `edge1`. If edge is an arc → immediately dispatch `AddAngularDimCommand` with `ref: 'arc'` and end session. Else advance.
- Phase `'pick-edge-2'`: click on second edge → dispatch `AddAngularDimCommand` with `ref: 'two-edges'`. End session.
- Esc → end session, no command.

### Live preview

Per F1.1 / F4 pattern, render-only DOM overlay shows the next dim placement before clicking. For baseline: ghost dim line at next stacked offset from current cursor edge. For ordinate: ghost L-leader from cursor to nearest axis column. For angular: ghost arc once edge1 is picked.

## Cascade text

`DimensionElement.tsx` switch statement extended with `baseline`, `ordinate`, `angular` cases. Same cascade rules as F4:

1. `textOverride` set → use it verbatim.
2. `sourceParameterName` set + parameter exists → use parameter's current value formatted as `${value} ${unit}`.
3. Otherwise → use computed value (distance for baseline/ordinate, degrees for angular).

The non-reactive `getState()` snapshot pattern continues. `DrawingCanvas` re-render propagates parameter changes. F4's structural-dependency gotcha (no `React.memo` on DrawingCanvas) applies — any refactor touching DrawingCanvas memo behavior MUST account for both F4 and F5.

## Testing

### Unit tests

- `packages/shared/src/drawing/dimensionGroups.spec.ts` — sort-by-id determinism for baseline members; baseline stack math (`baseOffsetMm + N * spacingMm`); ordinate L-leader path computation; angular apex intersection (parallel→null); angular arc-side inside/outside resolution.
- `packages/app/src/commands/AddBaselineMemberCommand.spec.ts` — group-not-found error, wrong-kind error, viewId mismatch error, happy-path append, revert.
- `packages/app/src/commands/AddOrdinateMemberCommand.spec.ts` — same matrix + axis field.
- `packages/app/src/commands/AddAngularDimCommand.spec.ts` — two-edges happy path, arc happy path, edge-not-in-view error, default offset/arcSide, revert.
- `packages/app/src/commands/DeleteDimensionGroupCommand.spec.ts` — cascade member delete, revert restores all.
- Extend `packages/shared/src/drawing/autoDim.spec.ts` — fixture with `dim-angle` constraint, assert single `kind: 'angular'` candidate emitted, `sourceParameterName === paramName`, `ref.kind === 'two-edges'`.

### E2E

`tests/e2e/drawing/T-6-12-dimension-styles.spec.ts` — 4 assertions:

1. **Baseline group:** Inject part + drawing via store. Dispatch `AddDimensionGroupCommand` (kind baseline) + 3 `AddBaselineMemberCommand`s. Assert SVG contains 3 `data-dim-kind="baseline"` with same `data-group-id`. Assert `data-slot` values are `0`, `1`, `2` in insertion order, and Y-offsets follow `baseOffsetMm + slot * spacingMm`.
2. **Ordinate group:** Dispatch ordinate group + 2 X-members + 1 Y-member. Assert L-leader paths present (3 `<path>` elements with `data-dim-kind="ordinate"`, correct `data-axis` values).
3. **Angular dim:** Dispatch `AddAngularDimCommand` with two-edges ref. Assert SVG contains one `<path>` with `data-dim-kind="angular"`, arc rendered (path `d` contains `A`).
4. **Cascade:** Edit a parameter referenced by an angular dim's `sourceParameterName`. Assert dim text updates to new value formatted as degrees.

### Perf

`tests/perf/dimension-styles.perf.spec.ts` + `window.__zilventorDimensionStylesMs(n)` probe in `App.tsx`. Same plumbing as F4's `__zilventorAutoDimMs`.

Fixture: 1 view, 10 baseline members, 10 ordinate members (5 x-axis, 5 y-axis), 10 angular dims (two-edges). 30 dims total.

Probe runs n=50 iterations of:
1. Apply commands (or re-render with all 30 already present).
2. Measure render time (full SVG regeneration).

Returns `{ p95ms: number }`. Budget: p95 < 200ms (same as F4).

## Batches

Mirroring F4 (3 batches, ~1500-line plan).

### Batch 1 — Types + Render + Unit tests
**Owner:** Sonnet implementer · **Review:** Sonnet spec+code (split, 2 dispatches per per-batch-review policy)
- Add `baseline`, `ordinate`, `angular` to `DrawingDimension` union.
- Add `DimensionGroup` type.
- Add `dimensionGroups: readonly DimensionGroup[]` to `DrawingSheet` with JSON-parse default `[]`.
- Add helper math: `intersectLines` (line-line in 2D), `subtendedAngle`, `formatAngleDeg`.
- Extend `renderDrawingSvg.ts` with switch cases for all three new kinds (baseline, ordinate, angular-two-edges, angular-arc).
- Unit tests: `dimensionGroups.spec.ts`. All math covered.
- Acceptance: `pnpm -r typecheck` green; new unit tests green; all 2232 existing unit tests still green.

### Batch 2 — Commands + AutoDim extension
**Owner:** Sonnet implementer · **Review:** Sonnet spec+code (split)
- `AddDimensionGroupCommand`, `AddBaselineMemberCommand`, `AddOrdinateMemberCommand`, `AddAngularDimCommand`, `DeleteDimensionGroupCommand`.
- Update `DeleteDrawingDimensionCommand` for group-member case (last-member non-cascade).
- Update `MoveDrawingDimensionCommand` for baseline/ordinate/angular cases (mutate group vs dim).
- Extend `AutoDimCommand.ts` with `dim-angle` branch.
- Unit tests for each new command + autoDim spec extension.
- Acceptance: typecheck green; new + existing unit tests green; `autoDim.spec.ts` shows angular candidate for `dim-angle` fixture.

### Batch 3 — ToolModes + UI + E2E + Perf
**Owner:** Sonnet implementer · **Review:** combined spec+code (per per-batch-review policy: batch 3 still gets full review; batches 4+ would combine) + final-pass before merge
- Add `baseline`, `ordinate`, `angular` to `ToolMode` union.
- Ribbon buttons in `DrawingTab.tsx`.
- Click handlers in `DrawingCanvas.tsx` with session state per mode.
- Live preview overlays.
- `DimensionElement.tsx` cascade switch extended.
- `T-6-12-dimension-styles.spec.ts` e2e — 4 assertions.
- `__zilventorDimensionStylesMs` probe + `dimension-styles.perf.spec.ts`.
- **Mid-flight Playwright verification:** before final-pass review, drive the actual UI in Chromium, exercise all 3 tool modes, screenshot each, controller MUST `Read` the screenshots back per CLAUDE.md §6.
- Acceptance: typecheck green; new + all existing unit tests green; T-6-12 e2e green; perf p95 < 200ms; screenshot proof in commit/PR description.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Sketch lacks `dim-angle` constraints in real fixtures → AutoDim extension untestable in practice | Batch 2 fixture explicitly adds `dim-angle`; e2e exercises it via store injection. Real-world adoption is a UX problem, not a code problem. |
| Live-preview rendering performance with 30+ dims | Reuse `useRef` for session state; only re-render the preview overlay layer (separate SVG group with React.memo on preview component). Perf budget covers steady-state render only. |
| Baseline `direction` inference from datum's surrounding edge is heuristic | If both h-edges and v-edges meet at datum, default to `'h'`. User can flip via group-edit (deferred F5.1) — for v1, recreate group if wrong direction. Document in spec. |
| Ordinate `axis` inference (x-vs-y) on member click | Default: pick the axis along which `to - origin` has greater absolute delta. Hold Shift to flip. Document in toolmode help. |
| Group-level invariant violations from refactors | Add `assertDimensionGroupInvariants(sheet)` exported from shared; call in commands' `apply()` and Vitest setup. Throws with specific message; analogous to F1.1's half-section invariant pattern. |
| Cascade silently breaks if DrawingCanvas gains React.memo (F4 inherited gotcha) | Same risk as F4; document in spec + comment in `DrawingCanvas.tsx`. |

## F5 follow-up F-items (deferred)

- **F5.1** — Edit-group-spacing UI (drag baseline stack to change `spacingMm`)
- **F5.2** — Drag-baseline-datum / drag-ordinate-origin (mutates group's PointRef)
- **F5.3** — Ordinate column-line snap to feature columns
- **F5.4** — Auto-detect baseline opportunities in AutoDim (G3 toggle)
- **F5.5** — Angular dim from apex point + 2 arm points (axis E2 deferred)
- **F5.6** — Reflex-angle visual cue (warn when `arcSide: 'outside'`)
- **F5.7** — Edit `textOverride` for whole group (one edit, all members)
- **F5.8** — DXF export of new dim kinds

## Success criteria

- All 2232 existing unit tests still green.
- New unit tests (~30-40) all green.
- T-6-12 e2e green (4 assertions).
- `dimension-styles.perf.spec.ts` p95 < 200ms.
- `pnpm -r typecheck` clean across all 5 packages.
- Mid-flight Playwright screenshots captured + read back; all 3 new tool modes produce visually correct output.
- Final-pass Sonnet code review approves before FF merge to master.
- Memory `next_session_resume.md` updated with new HEAD sha + F5 follow-up priority list.
