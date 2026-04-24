# Sub-project 2c — Dimensional Constraints + Parametric Expressions

**Date:** 2026-04-24
**Status:** Design, awaiting user review → implementation plan
**Predecessor:** Sub-project 2b (geometric constraints + planegcs, shipped 2026-04-24)
**Successor:** Sub-project 3 (3D part modeling)

---

## 1. Goal

Add **dimensional constraints** (length, distance, angle, radius, diameter, point-to-line distance) to the 2D sketcher, plus a full **parametric expression** system that lets dimensions reference named parameters and arithmetic (`d1 = 2 * width + 10`). Users interact through a single Inventor-faithful **General Dimension** tool (`D` shortcut) that infers the dimension kind from pick sequence. Dimensions render with classic engineering-drawing chrome (extension lines, dim line, arrows, numeric label) via an SVG overlay.

## 2. Scope

### In scope (2c)
Six dimensional constraint kinds:
`dim-length`, `dim-distance`, `dim-angle`, `dim-radius`, `dim-diameter`, `dim-point-line-distance`.

Driving-only (no driven/reference dimensions). Full parametric expressions with a main-thread `ParameterRegistry`: named parameters, arithmetic (`+ - * / ^`), a whitelisted function set (`min max abs sqrt floor ceil round`), cycle detection, topological re-evaluation on change. Inventor-style SVG rendering for every dim kind. `D` keyboard shortcut. Parameters panel (`F7`). Over-define handling with toast + "Show conflict" in-situ highlight. File-format v4 with transparent v3→v4 migration.

### Out of scope
- **Driven / reference dimensions** — deferred. planegcs only partially supports them; the feature belongs with annotations (Sub-project 6).
- **Dim-line dragging** to reposition the label — fixed 20 px screen-space offset in 2c; user-draggable in a later polish pass.
- **Tolerance / GD&T** — not in scope for any sub-project yet planned.
- **Datum references, ordinate dimensions, leader arrows for callouts** — drawings (Sub-project 6).
- **3D constraints** — later sub-projects.

## 3. Foundational decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Dimension kinds shipped | 6 variants covering the 5 Inventor categories: `dim-length` (single line) and `dim-distance` (2 points) both correspond to Inventor's "Linear"; `dim-angle`, `dim-radius`, `dim-diameter`, `dim-point-line-distance` are the other four |
| Driving vs driven | Driving-only; driven deferred |
| Parametric expressions | Full — arithmetic + named variables + whitelisted functions |
| Dimension tool UX | Single General Dimension tool (`D`), infers kind from pick sequence |
| Rendering style | Inventor-faithful: extension lines + dim line + arrows + label |
| Over-define response | Reject with toast + "Show conflict" button that highlights offenders in-situ |
| Rendering layer | SVG overlay over the viewport canvas |
| Parameters panel entry | Ribbon button + `F7` shortcut (Inventor-faithful) |
| Expression evaluator library | `expr-eval` (~10 KB) |

## 4. Architecture

Three threads. No new worker.

```
MAIN THREAD                               SKETCHER WORKER                 KERNEL WORKER
─────────────────────────────             ──────────────────────          ────────────────
React + Zustand                           planegcs WASM (existing)        OCCT WASM
SketcherClient (existing)                 GcsSystem                        SketchFeature
  ↳ addDimension (new)                     + addDimension (new)            (unchanged)
  ↳ removeDimension (new)                  + removeDimension (new)
  ↳ updateDimensionValue (new)             + updateDimensionValue (new)
GeneralDimensionTool (new)
DimensionDialog (new, floating overlay)
DimensionRenderer (new, SVG layer)
ParametersPanel (new, modal dialog)
ParameterRegistry (new, main thread)
  ↳ expr-eval parser
  ↳ dependency graph + topological re-eval
```

OCCT kernel never sees dimensions. Parameters live main-thread; the worker only ever receives resolved numeric values.

## 5. Data model

### New `SketchConstraint` variants

Extend `packages/shared/src/constraints.ts`:

```ts
export type DimensionValue =
  | { kind: 'literal'; value: number }
  | { kind: 'param';   paramName: string };

type DimBase = { id: string; source?: ConstraintSource; paramName: string };

export type DimensionConstraint =
  | (DimBase & { kind: 'dim-length';               line: string;                 value: DimensionValue })
  | (DimBase & { kind: 'dim-distance';             a: PointRef; b: PointRef;     value: DimensionValue })
  | (DimBase & { kind: 'dim-angle';                line1: string; line2: string; value: DimensionValue })   // degrees
  | (DimBase & { kind: 'dim-radius';               circle: string;               value: DimensionValue })    // circle or arc primitive id
  | (DimBase & { kind: 'dim-diameter';             circle: string;               value: DimensionValue })
  | (DimBase & { kind: 'dim-point-line-distance';  point: PointRef; line: string; value: DimensionValue });

// Merge into existing SketchConstraint union.
export type SketchConstraint =
  | /* …existing 8 geometric kinds from 2b… */
  | DimensionConstraint;
```

Every dimension carries its own `paramName` (`d0`, `d1`, …; user-renamable). That's the name that appears in the Parameters panel, and the name other expressions reference.

### `SketchParameter` (new)

```ts
// packages/shared/src/parameters.ts (new)
export type SketchParameter = {
  name: string;              // e.g., 'd0', 'width', 'cabinetHeight'
  expression: string;        // e.g., '50', 'd0 / 2', '2 * width + 10'
  value: number;             // cached computed value
  unit: 'mm' | 'deg';        // deg for dim-angle, mm otherwise
};
```

### `PartDocument.parameters` — already present

`PartDocument.parameters: Record<string, SketchParameter>` already exists (Shell MVP shipped with it as an empty map). 2c populates it.

**Note on scope:** parameters are part-document-scoped (not sketch-scoped). A dimension in one sketch can reference a parameter created by another sketch in the same part. This matches Inventor's behavior and is what users expect.

### Degrees of freedom

Each dimension reduces DOF by 1. A fully-dimensioned sketch hits `Fully constrained` (DOF = 0) in the footer (the 2b DOF segment handles this unchanged).

## 6. `ParameterRegistry` — main-thread module

Single source of truth for parameter names, expressions, and computed values. Owns the dependency graph. Does **not** live in Zustand — parameters are a document-wide registry with their own event model; components subscribe via a `useParameterValues()` hook.

```ts
// packages/app/src/parameters/ParameterRegistry.ts
import { Parser } from 'expr-eval';

export type EvaluationError =
  | { code: 'unknown-var'; name: string }
  | { code: 'cycle'; namesInCycle: string[] }
  | { code: 'parse-error'; message: string }
  | { code: 'div-by-zero' }
  | { code: 'non-finite' };

export class ParameterRegistry {
  private params = new Map<string, SketchParameter>();
  private dependents = new Map<string, Set<string>>();   // name → set of names that depend on it
  private parser = new Parser();
  private listeners = new Set<() => void>();

  load(initial: Record<string, SketchParameter>): Result<void, EvaluationError>;

  setParameter(p: Pick<SketchParameter, 'name' | 'expression' | 'unit'>):
    Result<SketchParameter, EvaluationError>;

  renameParameter(from: string, to: string): Result<void, EvaluationError>;

  removeParameter(name: string): Result<void, { referencedBy: string[] }>;

  getValue(name: string): number | undefined;
  getAll(): SketchParameter[];
  subscribe(listener: () => void): () => void;   // returns unsubscribe fn

  private recompute(changedNames: string[]): Result<void, EvaluationError>;
}
```

### Allowed expression surface

Parser whitelist (expr-eval's default minus string ops / function declarations):
- Arithmetic: `+ - * / ^ ( )`
- Unary minus
- Variables: any registered parameter name
- Functions: `min(a, b)`, `max(a, b)`, `abs(x)`, `sqrt(x)`, `floor(x)`, `ceil(x)`, `round(x)`
- Number literals (decimal, scientific, signed)

Explicitly rejected at parse time: string operations, conditionals, lambdas, `eval`, custom function definitions, comma operator outside function calls.

### Cycle detection

Tarjan SCC over the dependency graph, run after every mutation. A cycle causes the affected parameters to keep their last-known-good values; an `EvaluationError { code: 'cycle', namesInCycle }` is returned to the caller. The UI surfaces the cycle inline in the Parameters panel and via the dimension's in-viewport error indicator.

### Propagation

Changing `width` triggers re-eval of every parameter transitively dependent on `width` (computed via the `dependents` map). Each changed parameter whose `value` actually differs fires `SketcherClient.updateDimensionValue(dimensionId, newValue)` on all constraints whose `value.kind === 'param' && paramName === changed`.

## 7. Sketcher worker API extensions

Three new Comlink methods on `SketcherWorkerApi`:

```ts
addDimension(
  constraint: DimensionConstraint,
  resolvedValue: number
): Promise<AddDimensionResult>;

removeDimension(id: string): Promise<{ dof: DofStatus; coords: PrimitiveCoordsDiff[] }>;

updateDimensionValue(
  id: string,
  resolvedValue: number
): Promise<{ dof: DofStatus; coords: PrimitiveCoordsDiff[] }>;

type AddDimensionResult =
  | { ok: true;  dof: DofStatus; coords: PrimitiveCoordsDiff[] }
  | { ok: false; reason: 'redundant' | 'conflict'; offendingConstraintIds: string[] };
```

### `GcsSystem` additions

- `translateDimensionConstraint(c, value)` mirrors the existing `translateConstraint` but produces planegcs dimensional types: `p2p_distance`, `p2l_distance`, `p2p_angle`, `CircleDiameter`, `circle { radius }`.
- `addDimension` follows the exact same flow as `addConstraint` (push, solve, diagnostics, rollback via `rebuildGcs` on failure).
- `updateDimensionValue`: the simplest correct implementation is to update `domainConstraints.get(id).value` and call `rebuildGcs`. Optimize to an in-place value mutation later if perf demands.
- `removeDimension` reuses the existing remove-via-rebuild path from 2b.

### Store extensions

```ts
// useAppStore.ts additions:
addDimensionToActiveSketch(sketchId, c: DimensionConstraint): void;
removeDimensionFromActiveSketch(sketchId, id: string): void;
updateDimensionValueInStore(sketchId, id: string, value: number): void;

// Parameters accessor via a small React hook wired to ParameterRegistry:
useParameterValues(): Map<string, number>;
```

Parameter mutations (add/rename/delete/edit expression) do **not** live in `useAppStore` — they live in `ParameterRegistry`. The `parameters` field on `PartDocument` is written to Zustand only at save/load boundaries, so Zustand stays the persistence view while `ParameterRegistry` stays the live-edit view.

## 8. UI layer

### New tool: `GeneralDimensionTool`

File: `packages/app/src/sketcher/tools/GeneralDimensionTool.ts`

State machine: accumulate picks until a valid combo is recognised.

```
Pick pattern                    → Inferred kind
─────────────────────────────     ──────────────────────────────
1 line                            dim-length
2 points                          dim-distance
2 lines                           dim-angle
1 circle or arc (first click)     dim-radius  (initial guess)
  ↳ re-click same geometry        dim-diameter  (toggle)
1 point + 1 line                  dim-point-line-distance
```

Escape clears picks without committing. On a valid combo, `DimensionDialog` opens pre-filled with the *measured current value* (computed from primitive coords). On OK: evaluate expression → `SketcherClient.addDimension(constraint, resolved)` → on success, dispatch `AddDimensionCommand`; on failure, show the over-define toast. The tool stays armed for another dimension.

### `DimensionDialog` — floating overlay

Structure:
- Name input (pre-filled with auto-gen `d0`, `d1`, …; user-renamable)
- Value input (accepts literal or expression)
- Live preview showing resolved number + error (if any)
- Cancel / OK

Style and positioning mirror 2b's `NumericInputOverlay` (floating, +20/+20 offset from cursor, z-40, dark theme).

### `ParametersPanel` — dialog

Reachable via:
- **Parameters…** button in the Model ribbon tab, and
- `F7` global shortcut (sketch-mode and model-mode; ignored when a text input has focus).

Layout (tabular):

```
 Name       Expression         Value       Unit    Source
 d0         50                 50.00       mm      user
 width      d0                 50.00       mm      user
 d1         d0 / 2             25.00       mm      user
 angle0     30                 30.00       deg     user
 d2         d0 + cos(angle0)   50.87       mm      user      ← evaluator error shown in red inline
```

Features:
- Add parameter (standalone, not tied to a dimension).
- Rename in-place.
- Edit expression in-place.
- Delete selected — gated when referenced; offers "Replace references with current numeric value" as an alternative.
- Closing the panel re-evaluates everything + pushes any changed values to the worker.

### Ribbon layout — Sketch tab (updated)

```
[Finish Sketch] | Select Line Rect Circle Arc Spline | constraint buttons (2b) | Dimension (D) | Numeric rectangle…
  Sketch        |                Draw                |        Constrain        |   Dimension   |    Fallback
```

One new "Dimension" group with the single `General Dimension (D)` button.

### Ribbon layout — Model tab (updated)

Add a **Parameters…** button to the existing ribbon (next to Extrude / Fillet).

## 9. Rendering layer — SVG overlay

File: `packages/app/src/sketcher/render/DimensionRenderer.tsx`

Lives next to `ConstraintBadgeRenderer`. Renders an SVG overlay with one `<g>` per dimension. Uses the viewport's existing `worldToScreen` helper.

### Per-kind glyph layout

Fixed dim-line offset: **20 px in screen space**, not world-scaled (stays constant at any zoom).

| Kind | Structure |
|---|---|
| `dim-length` | 2 perpendicular extension lines from endpoints + dim line parallel to geometry at 20 px offset + 2 inward arrows + centered `value.toFixed(2)` label breaking the dim line |
| `dim-distance` | Same structure as length; direction = normalized p1→p2; extension lines perpendicular to that direction |
| `dim-angle` | Two short rays outward from intersection along each line + arc at 40 px radius between them + tangent arrows at arc endpoints + label near arc midpoint `value.toFixed(2)°` |
| `dim-radius` | Single radial line from center to circumference + single arrow at circumference + label near arrowhead `R value.toFixed(2)` |
| `dim-diameter` | Chord through the center + both arrows at the chord ends + label at midpoint `⌀ value.toFixed(2)` |
| `dim-point-line-distance` | Single perpendicular from the point to the foot on the line + arrow at the foot + mid-perpendicular label `value.toFixed(2)` |

### Interaction

- Each dimension's SVG `<g>` has `pointer-events: auto` on its interactive children (dim line + label). Everything else is `pointer-events: none`.
- Click → select (highlight amber, expose expression in Properties panel's feature-info slot).
- Double-click → opens `DimensionDialog` pre-filled with name + expression for editing.
- Delete key on selected → dispatches `RemoveDimensionCommand`.

### Error state

A dimension whose `paramName` has an evaluator error (unknown var, cycle, etc.) renders with red label text and a small error dot (`⚠`) next to the label. The tooltip / Properties panel shows the exact error message.

## 10. Drag interaction with dimensions

Unchanged from 2b. A driving dimension is just another constraint — planegcs holds it fixed during `dragTo`. If the sketch is `Fully constrained`, dragging produces no visible motion (solver returns the point to its determined position). Matches Inventor.

## 11. Persistence — file format v4

```ts
// packages/shared/src/fileFormat.ts (new migration step)
3: (mIn) => {
  // v3 → v4: no-op for document structure.
  // Dimension constraints are forward-compatible additions to
  // existing sketch.constraints[]. PartDocument.parameters already
  // exists as a Record<string, SketchParameter> (Shell MVP shipped
  // with it empty); we now populate it.
  return { ...structuredClone(mIn), formatVersion: 4 };
}
```

`CURRENT_FORMAT_VERSION = 4`. Round-trip: on save, `PartDocument.parameters` is serialised. On load, `ParameterRegistry.load(parameters)` rebuilds the dependency graph and re-evaluates everything; dimension values are re-resolved before the first solve.

Legacy v3 files open transparently with an empty parameters map.

## 12. Error handling

All failures return structured results, never throw.

| Condition | Origin | UI response |
|---|---|---|
| Expression parse error | `ParameterRegistry.setParameter` | Dialog preview shows error inline (red). OK stays disabled. |
| Rename introduces cycle | `ParameterRegistry.renameParameter` | Toast: "Rename creates cycle: d1 → d2 → d1". Rename rejected. |
| Delete parameter with references | `ParameterRegistry.removeParameter` | Modal: "Replace references with current numeric value?" — Confirm / Cancel. |
| Over-define on add | `worker.addDimension → ok:false` | Toast + "Show conflict" button (Q6 decision) → highlights offenders. |
| Cycle / error in loaded file | `ParameterRegistry.load` | File opens with the error surfaced in the Parameters panel; affected dimensions render with red labels and error dot. User can edit to resolve. |
| planegcs rejects the dim (numerically impossible) | `worker.addDimension` | Treated same as over-define: rollback + toast. |

## 13. Testing strategy

| Layer | Location | Coverage |
|---|---|---|
| Shared (pure) | `packages/shared/src/__tests__/` | `DimensionValue`/`DimensionConstraint` type shape; v3→v4 migration golden tests; `SketchParameter` type shape. |
| ParameterRegistry unit | `packages/app/src/parameters/__tests__/` | set/get/rename/delete; cycle detection (self, a→b→a, 3-hop); topological recompute on change; unknown-var/div-by-zero/NaN handling; rename-with-references transactional rollback on cycle; function whitelist (min/max/abs/sqrt/floor/ceil/round). |
| Sketcher worker integration (real planegcs) | `packages/sketcher-worker/src/__tests__/` | `addDimension` for each of 6 variants solves to the expected geometry; `updateDimensionValue` drives geometry change; `removeDimension` restores DOF; combined geom + dim constraint behaviour. |
| App unit | `packages/app/src/sketcher/tools/__tests__/` | `GeneralDimensionTool` — complete pick-pattern matrix (all 6 infers); `DimensionDialog` form flow; `DimensionRenderer` produces correct SVG structure per variant (`<line>`, `<path>` for the arc, `<text>`). |
| E2E (Playwright) | `tests/e2e/sketcher/` | `place-linear-dim.spec.ts` (draw line, D, pick, type "50", OK → dim label + DOF drops); `edit-dim-expression.spec.ts` (edit `d0` in panel → downstream dim updates); `over-define-dim-highlights-conflict.spec.ts` (add width=50 + width=60 → toast + highlight). |
| Perf | `tests/perf/` | `parameter-recompute-cascade.spec.ts` — 30-dim chain `d1 = d0 + 1, d2 = d1 + 1, …`, change `d0`, assert total recompute + re-solve < 100 ms. |
| Manual | `docs/superpowers/manual-tests/subproject-2c.md` | Golden-path: each dim kind, parameters panel, cycle detection, over-define, save/load round-trip. |

### Acceptance

`pnpm -r typecheck` clean. All test suites green. `expr-eval` bundled size < 30 KB gzipped (actual measurement). Manual checklist passes.

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| `expr-eval` bundle larger than expected | Measure first. Fallback: write a custom ~100-line arithmetic evaluator with just `+ - * / ^ ( )` + variables. |
| Live-solve on every keystroke of the expression field is laggy | Debounce evaluation by 150 ms; commit final on Enter / blur. |
| Rename propagates incorrectly across constraints that already reference the old name | Rename is transactional at the `ParameterRegistry` level: all dependent expressions are re-validated before the rename commits; if any fail, the rename is rolled back. |
| SVG + HTML-overlay coordinate drift when the canvas resizes | `DimensionRenderer` listens on `window.resize` and the viewport's `ResizeObserver`; re-computes all positions on each tick. |
| Dimension label obscures the geometry on small sketches | Label placement is fixed (centered on dim line, break-through) for 2c. A user-drag-to-reposition polish pass is deferred. |
| Circular dep through long rename chains takes too long for 10^3 parameters | Tarjan SCC is O(V+E) — even 10^3 params + 10^3 edges is sub-millisecond. Not a real risk. |

---

## Appendix A — Open questions resolved during brainstorm

1. Scope of dimension kinds — all 5 Inventor types.
2. Driving vs driven — driving only.
3. Parametric expressions — full (arithmetic + variables + whitelisted functions).
4. Dimension tool UX — single General Dimension + `D` (Inventor-faithful).
5. Rendering style — Inventor-faithful (extension lines + dim line + arrows + label).
6. Over-define response — toast + "Show conflict" button highlighting offenders.
7. Rendering layer — SVG overlay.
8. Parameters panel — ribbon button + `F7` shortcut.
9. Expression evaluator — `expr-eval`.
