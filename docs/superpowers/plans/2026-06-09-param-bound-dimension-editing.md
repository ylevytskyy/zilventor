# Param-bound dimension editing + expression entry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow double-clicking any sketch dimension (literal OR param-bound) to open an inline editor — literal dims accept constant arithmetic (`100/2`→50), param dims edit the bound parameter's expression and cascade to all linked geometry, undoably.
**Architecture:** Six independent TDD slices: (1) extend `parseDimensionInput` to eval arithmetic + reject param-refs via `expr-eval`; (2) new `UpdateParameterExpressionCommand` thin over `parameterRegistry.setParameter`; (3) fix the coord-discard bug in the subscribe effect (App.tsx:1382); (4) rewire `handleEditDimension` / `handleDimEditCommit` in App.tsx to branch on `dim.value.kind`; (5) remove the param-refuse short-circuit in `DimensionRenderer.tsx`; (6) e2e covering param-dim edit, arithmetic literal, undo, reload.
**Tech Stack:** TypeScript, React, Zustand, expr-eval, Vitest, Playwright (e2e), planegcs (WASM solver)

---

## Task 1 — Extend `parseDimensionInput` to accept constant arithmetic and reject param-refs

**Files:**
- Modify: `packages/app/src/sketcher/parseDimensionInput.ts`
- Modify (tests): `packages/app/src/sketcher/__tests__/parseDimensionInput.spec.ts`

### Context

Current `parseDimensionInput` (line 1–38) only accepts a raw `Number(trimmed)` — no arithmetic. The spec requires `100/2` → 50 and `width-18` (a param-ref) → rejected with a distinct result shape so the caller can show a bind-hint toast.

The result type must grow a third variant: `{ ok: false; reason: 'param-ref' }`, keeping the existing `{ ok: false }` for ordinary failures (empty, NaN, ≤0). The distinction lets `handleDimEditCommit` show a different toast message for the param-ref case.

`expr-eval`'s `Parser` is already a dependency of the app package (`"expr-eval": "^2.0.2"` in `packages/app/package.json`). Use `new Parser()` with an empty scope to evaluate arithmetic-only expressions. If `expr.variables()` is non-empty, the user typed a variable name (param-ref) → return the new `{ ok: false; reason: 'param-ref' }` variant.

### Step 1a — Write failing tests

- [ ] In `packages/app/src/sketcher/__tests__/parseDimensionInput.spec.ts` add a new `describe('constant arithmetic')` block after the existing tests:

```typescript
import { Parser } from 'expr-eval';

describe('parseDimensionInput — constant arithmetic', () => {
  it('evaluates 100/2 to 50 for dim-length', () => {
    expect(parseDimensionInput('dim-length', '100/2')).toEqual({ ok: true, value: 50 });
  });

  it('evaluates 2*30+5 to 65 for dim-length', () => {
    expect(parseDimensionInput('dim-length', '2*30+5')).toEqual({ ok: true, value: 65 });
  });

  it('evaluates 360/4 to 90 for dim-angle (no deg→rad conversion)', () => {
    expect(parseDimensionInput('dim-angle', '360/4')).toEqual({ ok: true, value: 90 });
  });

  it('rejects arithmetic that evaluates to 0 for dim-length', () => {
    const r = parseDimensionInput('dim-length', '5-5');
    expect(r.ok).toBe(false);
  });

  it('rejects arithmetic that evaluates to negative for dim-radius', () => {
    const r = parseDimensionInput('dim-radius', '5-10');
    expect(r.ok).toBe(false);
  });
});

describe('parseDimensionInput — param-ref rejection', () => {
  it('rejects a bare identifier (param name) with reason param-ref', () => {
    const r = parseDimensionInput('dim-length', 'width');
    expect(r).toEqual({ ok: false, reason: 'param-ref' });
  });

  it('rejects an expression containing a var reference with reason param-ref', () => {
    const r = parseDimensionInput('dim-length', 'width-18');
    expect(r).toEqual({ ok: false, reason: 'param-ref' });
  });

  it('rejects a param-ref for dim-angle too', () => {
    const r = parseDimensionInput('dim-angle', 'myAngle');
    expect(r).toEqual({ ok: false, reason: 'param-ref' });
  });

  it('plain numbers still return plain {ok:false} (not param-ref) for empty', () => {
    const r = parseDimensionInput('dim-length', '');
    expect(r).toEqual({ ok: false });
  });
});
```

- [ ] Run — expect FAIL (TypeError: `100/2` returns NaN; `{ reason: 'param-ref' }` shape doesn't exist):
  ```bash
  cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/sketcher/__tests__/parseDimensionInput.spec.ts
  ```
  Confirm: test output shows failures for the arithmetic and param-ref cases. The existing `Number('100/2')` → NaN causes the `!isFinite` guard to return `{ ok: false }` instead of `{ ok: true, value: 50 }`.

### Step 1b — Implement

- [ ] Replace the body of `packages/app/src/sketcher/parseDimensionInput.ts` with:

```typescript
import { Parser } from 'expr-eval';
import type { DimensionConstraint } from '@zilventor/shared';

export type ParseResult =
  | { ok: true; value: number }
  | { ok: false; reason?: 'param-ref' };

/** Kinds where a ≤0 value is physically invalid. */
const POSITIVE_ONLY_KINDS: ReadonlySet<DimensionConstraint['kind']> = new Set([
  'dim-length',
  'dim-radius',
  'dim-diameter',
]);

const _parser = new Parser();

/**
 * Parse and validate a user-typed string for a dimension constraint.
 *
 * Rules:
 *  - Empty → `{ ok: false }`.
 *  - Contains variable references (e.g. `width-18`) → `{ ok: false, reason: 'param-ref' }`.
 *  - Constant arithmetic (`100/2`, `2*30+5`) → evaluates and validates like a plain number.
 *  - `dim-length`, `dim-radius`, `dim-diameter`: reject evaluated value ≤ 0.
 *  - `dim-angle`: return the degree value AS-IS. GcsSystem.ts:593 already converts
 *    degrees → radians internally when feeding the solver, so stored values are degrees.
 *    Do NOT convert here.
 *  - `dim-distance`, `dim-point-line-distance`: accept any finite number.
 */
export function parseDimensionInput(
  kind: DimensionConstraint['kind'],
  raw: string
): ParseResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false };

  let expr;
  try {
    expr = _parser.parse(trimmed);
  } catch {
    return { ok: false };
  }

  // If the expression references any variables it's a param-ref — reject with hint.
  if (expr.variables().length > 0) return { ok: false, reason: 'param-ref' };

  let n: number;
  try {
    n = expr.evaluate({});
  } catch {
    return { ok: false };
  }
  if (!isFinite(n) || isNaN(n)) return { ok: false };

  if (POSITIVE_ONLY_KINDS.has(kind) && n <= 0) return { ok: false };

  // dim-angle: stored in degrees — return as-is (NO deg→rad conversion).
  return { ok: true, value: n };
}
```

### Step 1c — Verify

- [ ] Run:
  ```bash
  cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/sketcher/__tests__/parseDimensionInput.spec.ts
  ```
  Expect: ALL tests pass (old + new arithmetic + param-ref cases).

### Step 1d — Type-check

- [ ] Run:
  ```bash
  cd /Users/lion/Documents/Projects/mine/zilventor && npx tsc --noEmit -p packages/app/tsconfig.json
  ```
  Fix any `ParseResult` widening errors in callers (App.tsx line ~1819 uses `parsed.ok` check — the union is backward-compatible; the `reason` field is optional so existing `{ ok: false }` still satisfies the type).

> **Note (backward compat):** The new `{ ok: false; reason?: 'param-ref' }` shape is additive. The only caller that checks the result is `handleDimEditCommit` at App.tsx:~1819 which checks `parsed.ok` before accessing `.reason`. The `POSITIVE_ONLY_KINDS` set and the `{ok:false, reason:'param-ref'}` variant are both new — neither breaks existing callers.

### Step 1e — Commit

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git add packages/app/src/sketcher/parseDimensionInput.ts \
        packages/app/src/sketcher/__tests__/parseDimensionInput.spec.ts
git commit -m "feat(sketcher): parseDimensionInput — constant arithmetic eval + param-ref rejection"
```

---

## Task 2 — `UpdateParameterExpressionCommand` (new, undoable)

**Files:**
- Create: `packages/app/src/commands/UpdateParameterExpressionCommand.ts`
- Create (tests): `packages/app/src/commands/__tests__/UpdateParameterExpressionCommand.spec.ts`

### Context

This command wraps a single `parameterRegistry.setParameter` call so it is undoable via the command bus. It does NOT touch the store, kernel, or solver directly — the existing subscribe effect in App.tsx (lines 1310–1385) already does that cascade when `setParameter` fires listeners.

The command holds:
- `before: SketchParameter` — snapshot of the old state (captured at construction or apply-time — capture at construction from `registry.getAll().find(p => p.name === param.name)`).
- `afterExpr: string` — the new expression string.
- `registry: ParameterRegistry` — the module-level singleton exported from App.tsx as `parameterRegistry`.

`apply()` calls `registry.setParameter({ name: before.name, expression: afterExpr, unit: before.unit })`.
`revert()` calls `registry.setParameter({ name: before.name, expression: before.expression, unit: before.unit })`.

Both return `Result<SketchParameter, EvaluationError>`. If the result is `{ ok: false }`, the command throws (the bus will surface the error). However, validation is done by the caller (App.tsx) via `registry.dryRun` before constructing the command, so `apply()` failing is an edge case.

The `SketchParameter` type from `@zilventor/shared/src/parameters.ts` is:
```typescript
{ name: string; expression: string; value: number; unit: 'mm' | 'deg' }
```

`setParameter` input type: `Pick<SketchParameter, 'name' | 'expression' | 'unit'>`.

### Step 2a — Write failing test

- [ ] Create `packages/app/src/commands/__tests__/UpdateParameterExpressionCommand.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ParameterRegistry } from '../../parameters/ParameterRegistry';
import { UpdateParameterExpressionCommand } from '../UpdateParameterExpressionCommand';

describe('UpdateParameterExpressionCommand', () => {
  it('apply() changes the parameter expression in the registry', async () => {
    const registry = new ParameterRegistry();
    registry.setParameter({ name: 'width', expression: '100', unit: 'mm' });

    const before = registry.getAll().find((p) => p.name === 'width')!;
    const cmd = new UpdateParameterExpressionCommand(before, '120', registry);

    await cmd.apply();

    const after = registry.getAll().find((p) => p.name === 'width')!;
    expect(after.expression).toBe('120');
    expect(after.value).toBe(120);
  });

  it('revert() restores the original expression', async () => {
    const registry = new ParameterRegistry();
    registry.setParameter({ name: 'width', expression: '100', unit: 'mm' });

    const before = registry.getAll().find((p) => p.name === 'width')!;
    const cmd = new UpdateParameterExpressionCommand(before, '120', registry);

    await cmd.apply();
    await cmd.revert();

    const reverted = registry.getAll().find((p) => p.name === 'width')!;
    // NOT hand-authored — must read back from the registry after revert.
    expect(reverted.expression).toBe(before.expression);
    expect(reverted.value).toBe(before.value);
  });

  it('apply() cascades to dependents', async () => {
    const registry = new ParameterRegistry();
    registry.setParameter({ name: 'width', expression: '100', unit: 'mm' });
    registry.setParameter({ name: 'half', expression: 'width/2', unit: 'mm' });

    const before = registry.getAll().find((p) => p.name === 'width')!;
    const cmd = new UpdateParameterExpressionCommand(before, '200', registry);
    await cmd.apply();

    expect(registry.getValue('half')).toBe(100);
  });

  it('revert() cascades back to dependents', async () => {
    const registry = new ParameterRegistry();
    registry.setParameter({ name: 'width', expression: '100', unit: 'mm' });
    registry.setParameter({ name: 'half', expression: 'width/2', unit: 'mm' });

    const before = registry.getAll().find((p) => p.name === 'width')!;
    const cmd = new UpdateParameterExpressionCommand(before, '200', registry);
    await cmd.apply();
    await cmd.revert();

    expect(registry.getValue('half')).toBe(50);
  });

  it('apply() throws if the registry rejects (cycle)', async () => {
    const registry = new ParameterRegistry();
    registry.setParameter({ name: 'a', expression: '10', unit: 'mm' });
    registry.setParameter({ name: 'b', expression: 'a', unit: 'mm' });

    // Make a depend on b → cycle.
    const before = registry.getAll().find((p) => p.name === 'a')!;
    const cmd = new UpdateParameterExpressionCommand(before, 'b + 1', registry);
    await expect(cmd.apply()).rejects.toThrow();
  });
});
```

- [ ] Run — expect FAIL (module not found):
  ```bash
  cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/commands/__tests__/UpdateParameterExpressionCommand.spec.ts
  ```

### Step 2b — Implement

- [ ] Create `packages/app/src/commands/UpdateParameterExpressionCommand.ts`:

```typescript
import type { Command } from './Command';
import type { SketchParameter } from '@zilventor/shared';
import type { ParameterRegistry } from '../parameters/ParameterRegistry';

export class UpdateParameterExpressionCommand implements Command {
  readonly name = 'UpdateParameterExpression';

  constructor(
    private before: SketchParameter,
    private afterExpr: string,
    private registry: ParameterRegistry
  ) {}

  async apply(): Promise<void> {
    const result = this.registry.setParameter({
      name: this.before.name,
      expression: this.afterExpr,
      unit: this.before.unit,
    });
    if (!result.ok) {
      throw new Error(`UpdateParameterExpressionCommand.apply failed: ${JSON.stringify(result.error)}`);
    }
  }

  async revert(): Promise<void> {
    const result = this.registry.setParameter({
      name: this.before.name,
      expression: this.before.expression,
      unit: this.before.unit,
    });
    if (!result.ok) {
      throw new Error(`UpdateParameterExpressionCommand.revert failed: ${JSON.stringify(result.error)}`);
    }
  }
}
```

### Step 2c — Verify

- [ ] Run:
  ```bash
  cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/commands/__tests__/UpdateParameterExpressionCommand.spec.ts
  ```
  Expect: ALL 5 tests pass.

### Step 2d — Full suite sanity

- [ ] Run:
  ```bash
  cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --reporter=dot
  ```
  Expect: no regressions in the existing suite.

### Step 2e — Commit

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git add packages/app/src/commands/UpdateParameterExpressionCommand.ts \
        packages/app/src/commands/__tests__/UpdateParameterExpressionCommand.spec.ts
git commit -m "feat(commands): UpdateParameterExpressionCommand — undoable param expression edit"
```

---

## Task 3 — Coord-discard fix in the param-change subscribe effect

**Files:**
- Modify: `packages/app/src/App.tsx` (lines 1376–1383)

### Context

The param-change subscribe effect (App.tsx lines 1310–1385) fires on every `parameterRegistry.setParameter` call. After resolving each param-bound dim's value, it calls:

```typescript
// App.tsx line 1382 — CURRENT (broken):
void client.updateDimensionValue(dim.id, resolved);
```

This discards the `{ dof, coords }` result, so sketch geometry never moves. The fix: `await` the call and apply `applyCoordDiff(sketch.id, result.coords)` + `setSketchDof(result.dof)` — the same pattern used in `UpdateDimensionValueCommand.ts` (lines 18–21).

The subscribe callback is currently synchronous (a plain arrow function `() => { ... }`). The for-loop that calls `updateDimensionValue` is inside a synchronous block (lines 1376–1383). To `await` calls inside a sync callback, the loop must be moved into an async IIFE, similar to the kernel-sync IIFE already present in the same effect (lines 1323–1364).

> **Note (concurrency):** If two parameters change in a single registry batch (unlikely from user actions, but theoretically possible from a future bulk-set), two IIFEs run concurrently over the same sketch. This is acceptable — user actions are one-at-a-time. The §6 manual check (Task 6c) should confirm a Parameters-panel edit moves geometry correctly, which exercises this path.

The surrounding code reads:

```typescript
// App.tsx lines 1376–1383 (current):
for (const c of sketch.constraints) {
  if (!c.kind.startsWith('dim-')) continue;
  const dim = c as DimensionConstraint;
  if (dim.value.kind !== 'param') continue;
  const resolved = parameterRegistry.getValue(dim.value.paramName);
  if (resolved === undefined) continue;
  void client.updateDimensionValue(dim.id, resolved);
}
```

Replace with an async IIFE that awaits each call and applies coord/dof:

```typescript
// App.tsx lines 1376–1383 (fixed):
void (async () => {
  const store = useAppStore.getState();
  for (const c of sketch.constraints) {
    if (!c.kind.startsWith('dim-')) continue;
    const dim = c as DimensionConstraint;
    if (dim.value.kind !== 'param') continue;
    const resolved = parameterRegistry.getValue(dim.value.paramName);
    if (resolved === undefined) continue;
    const result = await client.updateDimensionValue(dim.id, resolved);
    store.applyCoordDiff(sketch.id, result.coords);
    store.setSketchDof(result.dof);
  }
})();
```

Note: the `store` reference must be re-fetched via `useAppStore.getState()` inside the IIFE because the subscribe callback captures a stale closure. The `sketch` and `client` variables are already captured from the outer synchronous block (lines 1371–1374) and are safe to use inside the IIFE — they are not mutated between captures and the IIFE execution.

### Step 3a — No unit test for this step (App effect, not pure logic)

This step does NOT have a Vitest unit test — the logic lives inside a React effect that requires WASM + a real Zustand store + a real sketcher worker. It is locked by the §6 browser gate (Task 6 e2e) and the manual verification step below.

### Step 3b — Apply the fix

- [ ] In `packages/app/src/App.tsx`, replace lines 1376–1383 (the plain `for` loop ending with `void client.updateDimensionValue(dim.id, resolved)`) with the async IIFE shown above.

Exact old block to replace (verify the line range matches before editing):
```typescript
      for (const c of sketch.constraints) {
        if (!c.kind.startsWith('dim-')) continue;
        const dim = c as DimensionConstraint;
        if (dim.value.kind !== 'param') continue;
        const resolved = parameterRegistry.getValue(dim.value.paramName);
        if (resolved === undefined) continue;
        void client.updateDimensionValue(dim.id, resolved);
      }
```

Exact new block:
```typescript
      void (async () => {
        const coordStore = useAppStore.getState();
        for (const c of sketch.constraints) {
          if (!c.kind.startsWith('dim-')) continue;
          const dim = c as DimensionConstraint;
          if (dim.value.kind !== 'param') continue;
          const resolved = parameterRegistry.getValue(dim.value.paramName);
          if (resolved === undefined) continue;
          const result = await client.updateDimensionValue(dim.id, resolved);
          coordStore.applyCoordDiff(sketch.id, result.coords);
          coordStore.setSketchDof(result.dof);
        }
      })();
```

(The local name `coordStore` avoids shadowing the outer `store` constant from line 1312.)

### Step 3c — Type-check

- [ ] Run:
  ```bash
  cd /Users/lion/Documents/Projects/mine/zilventor && npx tsc --noEmit -p packages/app/tsconfig.json
  ```
  Expect: clean.

### Step 3d — Manual verification notes (§6 gate — deferred to Task 6)

After Task 6 e2e is wired, the coord-discard fix will be proven end-to-end. During development, an interim manual check: open the app in the browser, create a sketch with a param-bound dim, edit the parameter in the Parameters panel, and confirm the sketch geometry moves. Before this fix it did not move.

### Step 3e — Commit

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git add packages/app/src/App.tsx
git commit -m "fix(app): apply coord/dof from param-change cascade — sketch geometry now moves on param edit"
```

---

## Task 4 — App.tsx wiring: `handleEditDimension` + `handleDimEditCommit` + seed fix

**Files:**
- Modify: `packages/app/src/App.tsx` (lines 1795–1828 + lines 4492–4497)

### Context

**Current `handleEditDimension`** (App.tsx lines 1795–1808):
```typescript
const handleEditDimension = useCallback((dimId: string) => {
  const store = useAppStore.getState();
  const sketchId = store.activeSketchId;
  if (!sketchId || !store.activePart) return;
  const sketch = store.activePart.featureTree.find((f) => f.kind === 'sketch' && f.id === sketchId);
  if (!sketch || sketch.kind !== 'sketch') return;
  const dim = sketch.constraints.find((c): c is DimensionConstraint => c.id === dimId && c.kind.startsWith('dim-'));
  if (!dim) return;
  if (dim.value.kind === 'param') {
    showToast(`Linked to parameter '${dim.value.paramName}' — edit it in the Parameters panel.`);
    return;
  }
  setEditingDimId(dimId);
}, [showToast]);
```

Drop the param-refuse branch. Both kinds set `editingDimId`. The `useCallback` dep array must add `[]` (no deps needed since all refs are module-level or stable store).

**Current `handleDimEditCommit`** (App.tsx lines 1810–1828):
```typescript
const handleDimEditCommit = useCallback(async (dimId: string, rawValue: string) => {
  const store = useAppStore.getState();
  const sketchId = store.activeSketchId;
  const client = sketcherClientRef.current;
  if (!sketchId || !client || !store.activePart) { setEditingDimId(null); return; }
  const sketch = store.activePart.featureTree.find((f) => f.kind === 'sketch' && f.id === sketchId);
  if (!sketch || sketch.kind !== 'sketch') { setEditingDimId(null); return; }
  const dim = sketch.constraints.find((c): c is DimensionConstraint => c.id === dimId && c.kind.startsWith('dim-'));
  if (!dim || dim.value.kind !== 'literal') { setEditingDimId(null); return; }
  const parsed = parseDimensionInput(dim.kind, rawValue);
  if (!parsed.ok) {
    // Invalid value: keep editor open (don't dismiss).
    return;
  }
  setEditingDimId(null);
  await store.bus.execute(
    new UpdateDimensionValueCommand(sketchId, dimId, dim.value.value, parsed.value, client)
  );
}, []);
```

Replace with a branching version that handles both literal and param dims. For param dims: look up the `SketchParameter` by `dim.value.paramName` in `parameterRegistry.getAll()`, validate via `dryRun`, apply kind-aware ≤0 guard, then dispatch `UpdateParameterExpressionCommand`.

> **Note (dep array):** The new `handleDimEditCommit` calls `showToast`, so its `useCallback` dep array must be `}, [showToast])` — NOT the old empty `[]`. `showToast` is defined at App.tsx:362 with `[]` deps so it is a stable reference; adding it to the dep array satisfies React's exhaustive-deps rule without causing re-creation on every render.

> **Note (tsc-check):** After implementing Step 4c, run `npx tsc --noEmit -p packages/app/tsconfig.json` immediately. The new call to `formatExpressionError` at App.tsx:155 uses a `switch` with no default — `noImplicitReturns` would flag an implicit `undefined` return if any `EvaluationError` code is unhandled. Existing callers compile clean, so it is fine; confirm tsc stays clean after this task.

**Seed fix** (App.tsx lines 4492–4497): The current IIFE that computes `editingDimInitialValue` skips param dims (`dim.value.kind !== 'literal'`). It must also handle param dims by reading their expression.

`parameterRegistry` is a module-level export at App.tsx line 137: `export const parameterRegistry = new ParameterRegistry();`. It is accessed directly by name in the component (no ref needed).

### Step 4a — No isolated unit test for this step

`handleEditDimension` and `handleDimEditCommit` are React callbacks that call `useAppStore.getState()` internally. They are locked by the Task 6 e2e (real browser). Document the expected before/after in the commit message.

### Step 4b — Implement `handleEditDimension`

- [ ] In `packages/app/src/App.tsx`, replace lines 1795–1808:

Old:
```typescript
  const handleEditDimension = useCallback((dimId: string) => {
    const store = useAppStore.getState();
    const sketchId = store.activeSketchId;
    if (!sketchId || !store.activePart) return;
    const sketch = store.activePart.featureTree.find((f) => f.kind === 'sketch' && f.id === sketchId);
    if (!sketch || sketch.kind !== 'sketch') return;
    const dim = sketch.constraints.find((c): c is DimensionConstraint => c.id === dimId && c.kind.startsWith('dim-'));
    if (!dim) return;
    if (dim.value.kind === 'param') {
      showToast(`Linked to parameter '${dim.value.paramName}' — edit it in the Parameters panel.`);
      return;
    }
    setEditingDimId(dimId);
  }, [showToast]);
```

New:
```typescript
  const handleEditDimension = useCallback((dimId: string) => {
    const store = useAppStore.getState();
    const sketchId = store.activeSketchId;
    if (!sketchId || !store.activePart) return;
    const sketch = store.activePart.featureTree.find((f) => f.kind === 'sketch' && f.id === sketchId);
    if (!sketch || sketch.kind !== 'sketch') return;
    const dim = sketch.constraints.find((c): c is DimensionConstraint => c.id === dimId && c.kind.startsWith('dim-'));
    if (!dim) return;
    // Both literal and param dims open the inline editor.
    setEditingDimId(dimId);
  }, []);
```

### Step 4c — Implement `handleDimEditCommit`

- [ ] In `packages/app/src/App.tsx`, replace lines 1810–1828:

Old:
```typescript
  const handleDimEditCommit = useCallback(async (dimId: string, rawValue: string) => {
    const store = useAppStore.getState();
    const sketchId = store.activeSketchId;
    const client = sketcherClientRef.current;
    if (!sketchId || !client || !store.activePart) { setEditingDimId(null); return; }
    const sketch = store.activePart.featureTree.find((f) => f.kind === 'sketch' && f.id === sketchId);
    if (!sketch || sketch.kind !== 'sketch') { setEditingDimId(null); return; }
    const dim = sketch.constraints.find((c): c is DimensionConstraint => c.id === dimId && c.kind.startsWith('dim-'));
    if (!dim || dim.value.kind !== 'literal') { setEditingDimId(null); return; }
    const parsed = parseDimensionInput(dim.kind, rawValue);
    if (!parsed.ok) {
      // Invalid value: keep editor open (don't dismiss).
      return;
    }
    setEditingDimId(null);
    await store.bus.execute(
      new UpdateDimensionValueCommand(sketchId, dimId, dim.value.value, parsed.value, client)
    );
  }, []);
```

New:
```typescript
  const handleDimEditCommit = useCallback(async (dimId: string, rawValue: string) => {
    const store = useAppStore.getState();
    const sketchId = store.activeSketchId;
    const client = sketcherClientRef.current;
    if (!sketchId || !client || !store.activePart) { setEditingDimId(null); return; }
    const sketch = store.activePart.featureTree.find((f) => f.kind === 'sketch' && f.id === sketchId);
    if (!sketch || sketch.kind !== 'sketch') { setEditingDimId(null); return; }
    const dim = sketch.constraints.find((c): c is DimensionConstraint => c.id === dimId && c.kind.startsWith('dim-'));
    if (!dim) { setEditingDimId(null); return; }

    if (dim.value.kind === 'literal') {
      // Literal dim: parse arithmetic, reject param-refs.
      const parsed = parseDimensionInput(dim.kind, rawValue);
      if (!parsed.ok) {
        if (parsed.reason === 'param-ref') {
          showToast('References a parameter — bind it via the dimension dialog.');
        }
        // Invalid value: keep editor open (don't dismiss).
        return;
      }
      setEditingDimId(null);
      await store.bus.execute(
        new UpdateDimensionValueCommand(sketchId, dimId, dim.value.value, parsed.value, client)
      );
    } else {
      // Param dim: validate via registry.dryRun then dispatch UpdateParameterExpressionCommand.
      const param = parameterRegistry.getAll().find((p) => p.name === dim.value.paramName);
      if (!param) { setEditingDimId(null); return; }

      const dryResult = parameterRegistry.dryRun({ name: param.name, expression: rawValue, unit: param.unit });
      if (!dryResult.ok) {
        showToast(formatExpressionError(dryResult.error));
        // Keep editor open.
        return;
      }

      // Kind-aware ≤0 guard on the evaluated value.
      const POSITIVE_ONLY: ReadonlySet<DimensionConstraint['kind']> = new Set([
        'dim-length', 'dim-radius', 'dim-diameter',
      ]);
      if (POSITIVE_ONLY.has(dim.kind) && dryResult.value.value <= 0) {
        showToast('Value must be greater than zero.');
        return;
      }

      setEditingDimId(null);
      await store.bus.execute(
        new UpdateParameterExpressionCommand(param, rawValue, parameterRegistry)
      );
    }
  }, [showToast]);
```

Import `UpdateParameterExpressionCommand` at the top of App.tsx alongside `UpdateDimensionValueCommand`:
```typescript
import { UpdateParameterExpressionCommand } from './commands/UpdateParameterExpressionCommand';
```

### Step 4d — Fix the seed value IIFE

- [ ] In `packages/app/src/App.tsx`, replace lines 4492–4497:

Old:
```typescript
                  {...(() => {
                    if (!editingDimId) return {};
                    const dim = dimensions.find((d) => d.id === editingDimId);
                    if (!dim || dim.value.kind !== 'literal') return {};
                    return { editingDimInitialValue: String(dim.value.value) };
                  })()}
```

New:
```typescript
                  {...(() => {
                    if (!editingDimId) return {};
                    const dim = dimensions.find((d) => d.id === editingDimId);
                    if (!dim) return {};
                    if (dim.value.kind === 'literal') {
                      return { editingDimInitialValue: String(dim.value.value) };
                    }
                    // Param dim: seed with the parameter's current expression.
                    const param = parameterRegistry.getAll().find((p) => p.name === dim.value.paramName);
                    return { editingDimInitialValue: param?.expression ?? '' };
                  })()}
```

### Step 4e — Type-check

- [ ] Run:
  ```bash
  cd /Users/lion/Documents/Projects/mine/zilventor && npx tsc --noEmit -p packages/app/tsconfig.json
  ```
  Expect: clean. Watch for:
  - `parsed.reason` only exists on the `{ ok: false }` branch — the type is `ParseResult` which now has `reason?: 'param-ref'` on the false variant.
  - `dryResult.value` is `SketchParameter` — `.value` (number) exists.

### Step 4f — Commit

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git add packages/app/src/App.tsx
git commit -m "feat(app): wire param-dim inline edit — handleEditDimension drops refuse branch, handleDimEditCommit branches on dim.value.kind"
```

---

## Task 5 — Remove param-refuse short-circuit in `DimensionRenderer.tsx`

**Files:**
- Modify: `packages/app/src/sketcher/render/DimensionRenderer.tsx`

### Context

`DimensionRenderer.tsx` does NOT have a param-refuse short-circuit in the current code. The `DimensionGlyph` component's `onDoubleClick` handler at line 162 calls `onEditDimension?.(d.id)` unconditionally for all dims:

```typescript
onDoubleClick={(e) => { e.stopPropagation(); onEditDimension?.(d.id); }}
```

The refuse logic was entirely in `handleEditDimension` in App.tsx (Task 4 already removed it). So Task 5 is a verification step: confirm no short-circuit exists in `DimensionRenderer.tsx`, and make no changes unless one is found.

If a future reviewer finds a param-dim guard in `DimensionGlyph` (e.g. checking `d.value.kind === 'param'` before calling `onEditDimension`), remove it. As of the codebase read on 2026-06-09, no such guard exists.

### Step 5a — Verify no param-refuse guard exists

- [ ] Search for any param-check in `DimensionRenderer.tsx`:
  ```bash
  grep -n "param\|refuse\|value\.kind" /Users/lion/Documents/Projects/mine/zilventor/packages/app/src/sketcher/render/DimensionRenderer.tsx
  ```
  Expected output: lines about `resolveValue` using `d.value.kind === 'literal'` / `params.get(d.value.paramName)` (display logic) — NOT a guard on `onEditDimension`. If no guard → no code change needed.

- [ ] If (unexpectedly) a guard IS found, remove it so `onEditDimension?.(d.id)` fires for all dims regardless of `value.kind`.

### Step 5b — Commit (confirmation or actual fix)

If no changes were needed:
```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git commit --allow-empty -m "chore(sketcher): confirm DimensionRenderer has no param-refuse guard — no change needed"
```

If changes were needed:
```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git add packages/app/src/sketcher/render/DimensionRenderer.tsx
git commit -m "fix(sketcher): remove param-refuse guard in DimensionRenderer — all dims trigger onEditDimension"
```

---

## Task 6 — e2e: param-dim inline edit + arithmetic literal + undo + reload

**Files:**
- Create: `tests/e2e/sketch-param-dim-inline-edit.spec.ts`

### Context

The existing `sketch-dimension-inline-edit.spec.ts` deliberately skipped param dims (see the comment at line 12–14: "seeding a ParameterRegistry-linked dim end-to-end is deferred"). This new spec covers the deferred cases.

The harness pattern follows `sketch-dimension-inline-edit.spec.ts` exactly:
- `waitForKernelReady` from `./helpers/buildBox`
- `setupNewPart` → `seedSketchAndEnter`
- `page.evaluate` to seed the store + enter sketch mode
- `page.locator('[data-testid="dimension-glyph"]')` for the glyph
- `page.locator('[data-testid^="dim-inline-input-"]')` for the input
- `page.waitForFunction` to assert store changes

**Port:** `playwright.config.ts` uses `port: 5173` with `reuseExistingServer: true`. Run the dev server separately before running the e2e: `pnpm --filter @zilventor/app dev`. No need to pick a custom port.

**Seeding a param-dim:** The sketch constraint must have `value: { kind: 'param', paramName: 'myWidth' }`. The parameter must also live in `parameterRegistry` (the module-level singleton at App.tsx:137, exposed as `window.__zilventorParameterRegistry` at App.tsx:409).

**CRITICAL — use the registry global directly, NOT `kernel.setParameter` + `setActivePart`.** The registry-rebuild effect (App.tsx:1289–1297) is keyed on `[activePart?.id]`; calling `setActivePart` with the SAME part id does NOT re-fire it, so `parameterRegistry` would never receive the seeded param, and `handleEditDimension`'s `parameterRegistry.getAll().find(...)` returns undefined — the test would silently never open the param-dim editor.

**Correct seeding pattern:**
1. Add the sketch feature via `kernel.addFeature` (constraint with `value:{kind:'param', paramName:'myWidth'}`).
2. Call `s.kernel.getPart(...)` and `s.setActivePart(next)` to load the sketch into the store.
3. In the same `page.evaluate`, call `window.__zilventorParameterRegistry.setParameter({name:'myWidth', expression:'50', unit:'mm'})`.

Step 3 is the real production cascade — `ParametersPanel` does exactly this. Calling `setParameter` on the singleton fires `this.emit()` → the subscribe effect at App.tsx:1311 runs → calls `store.setParameterInStore(p)` which writes the param into `activePart.parameters` (persists across autosave) → pushes to `kernel.setParameter` → in sketch mode cascades to `updateDimensionValue`. This means seeding via the registry global also makes the reload/persistence assertion (Test E) valid without extra work.

**Tests:**

**Test A — param-dim edit: expression edit + geometry moves + all linked dims update**
Seed: one line `[0,0]→[50,0]`, one dim-length with `value:{kind:'param', paramName:'myWidth'}`. Parameter `myWidth='50'` is seeded via `window.__zilventorParameterRegistry.setParameter({name:'myWidth', expression:'50', unit:'mm'})` in `page.evaluate` (fires real cascade; do NOT use `kernel.setParameter`+`setActivePart`). Double-click → editor seeded with `'50'` (the expression) → type `'80'` → Enter → assert:
- `window.__zilventorParameterRegistry.getValue('myWidth')` = 80
- store dim value = 80 (via `waitForFunction` checking the dim's resolved value through `parameterValues`)
- line x2 > 70 (geometry moved)

**Test B — arithmetic literal: `100/2` → 50**
Seed: a dim-length with `value:{kind:'literal', value:60}`. Double-click → type `'100/2'` → Enter → assert store dim value = 50.

**Test C — param-ref rejected for literal dim**
Seed: same dim-length literal. Double-click → type `'myWidth'` → Enter → assert editor stays open (input still visible, store dim value unchanged at 60).

**Test D — undo restores param expression**
Continue from Test A (or re-seed): after typing `'80'` → Enter → assert geometry moved → Ctrl+Z → assert `parameterRegistry.getValue('myWidth')` = 50 + geometry reverted.

**Test E — reload persistence**
After param-dim edit (myWidth=80): trigger autosave via `page.evaluate` calling `store.triggerAutosave?.()` OR wait 2s for debounce → reload → re-enter sketch → assert param value = 80 and geometry matches.

Note: `window.__zilventorParameterRegistry` is assigned at App.tsx:409: `w.__zilventorParameterRegistry = parameterRegistry`. Use it in `page.evaluate` both to seed parameters (`setParameter({name, expression, unit})`) and to read registry state (`getValue(name)`, `getAll()`). The `setParameter` signature is `Pick<SketchParameter, 'name' | 'expression' | 'unit'>` (confirmed in ParameterRegistry.ts:50).

### Step 6a — Write the spec

- [ ] Create `tests/e2e/sketch-param-dim-inline-edit.spec.ts`:

```typescript
/**
 * Sketch param-dim inline edit — end-to-end gate.
 *
 * A) Double-click a param-bound dim → editor seeded with expression → type new expression
 *    → assert registry value + geometry moved.
 * B) Literal dim: type "100/2" → evaluates to 50.
 * C) Literal dim: type a param-ref "myWidth" → editor stays open (rejected).
 * D) Undo restores the param expression.
 * E) Edited param value persists across reload.
 */

import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

type ZilventorWindow = {
  __zilventorStore: {
    getState(): AppState;
    setState(patch: Partial<AppState>): void;
  };
  __zilventorParameterRegistry: {
    getValue(name: string): number | undefined;
    getAll(): Array<{ name: string; expression: string; value: number; unit: string }>;
    /** Seed a parameter into the live registry (fires subscribe → store.setParameterInStore → kernel). */
    setParameter(input: { name: string; expression: string; unit: string }): { ok: boolean };
  };
};

type AppState = {
  activePart: PartDoc | null;
  activeSketchId: string | null;
  sketchMode: boolean;
  kernel: KernelClient | null;
  bus: { execute(c: unknown): Promise<unknown>; undo(): Promise<void> };
  setActivePart(p: PartDoc | null): void;
};

type PartDoc = {
  id: string;
  featureTree: Feature[];
  parameters?: Record<string, { name: string; expression: string; value: number; unit: string }>;
  materials: unknown[];
};

type Feature =
  | { kind: 'sketch'; id: string; primitives: Primitive[]; constraints: Constraint[] }
  | { kind: string; id: string };

type Primitive = {
  id: string; kind: string;
  x1?: number; y1?: number; x2?: number; y2?: number;
  cx?: number; cy?: number; r?: number;
};

type Constraint = {
  id: string; kind: string; line?: string; circle?: string;
  value?: { kind: string; value?: number; paramName?: string };
};

type KernelClient = {
  addFeature(partId: string, f: unknown): Promise<void>;
  setParameter(partId: string, p: unknown): Promise<void>;
  getPart(partId: string): Promise<PartDoc | null>;
};

async function getState(page: import('@playwright/test').Page): Promise<AppState> {
  return page.evaluate(() =>
    (window as unknown as ZilventorWindow).__zilventorStore.getState(),
  );
}

async function getRegistryValue(page: import('@playwright/test').Page, name: string): Promise<number | undefined> {
  return page.evaluate((n) =>
    (window as unknown as ZilventorWindow).__zilventorParameterRegistry.getValue(n),
    name,
  );
}

async function setupNewPart(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();
}

async function seedParamSketchAndEnter(
  page: import('@playwright/test').Page,
  sketchId: string,
  paramName: string,
  paramExpr: string,
): Promise<void> {
  // Step 1: add the sketch feature with a param-bound dim constraint.
  // Step 2: load the updated part into the store (setActivePart).
  // Step 3: seed the parameter via window.__zilventorParameterRegistry.setParameter —
  //   this is the real production cascade (same as ParametersPanel does):
  //   registry.setParameter → emit → subscribe effect → store.setParameterInStore
  //   (writes param into activePart.parameters, so it persists) → kernel.setParameter.
  //   Do NOT use kernel.setParameter + setActivePart(same-id) — the registry-rebuild
  //   effect (App.tsx:1289-1297) is keyed on [activePart?.id] and won't re-fire for
  //   the same id, leaving parameterRegistry empty and handleEditDimension returning
  //   undefined for the param lookup.
  await page.evaluate(
    async ({ sketchId, paramName, paramExpr }: { sketchId: string; paramName: string; paramExpr: string }) => {
      const w = window as unknown as ZilventorWindow;
      const s = w.__zilventorStore.getState();
      if (!s.kernel || !s.activePart) throw new Error('kernel or activePart not ready');
      // 1. Seed the sketch with a line and a param-bound dim constraint.
      await s.kernel.addFeature(s.activePart.id, {
        kind: 'sketch', id: sketchId,
        plane: { source: 'workPlane', featureId: 'origin.XY' },
        primitives: [{ id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 50, y2: 0 }],
        constraints: [{
          id: 'd1', kind: 'dim-length', paramName: 'd1', line: 'l1',
          value: { kind: 'param', paramName },
        }],
      });
      // 2. Load the updated part into the store.
      const next = await s.kernel.getPart(s.activePart.id);
      s.setActivePart(next);
      // 3. Seed the parameter via the live registry singleton.
      //    This fires the subscribe effect → store.setParameterInStore → kernel.setParameter.
      const regResult = w.__zilventorParameterRegistry.setParameter({
        name: paramName, expression: paramExpr, unit: 'mm',
      });
      if (!regResult.ok) throw new Error(`registry.setParameter failed for '${paramName}'`);
      // Enter sketch mode.
      (s as unknown as { setSketchMode(on: boolean, id: string): void }).setSketchMode(true, sketchId);
    },
    { sketchId, paramName, paramExpr },
  );
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await expect(page.getByRole('button', { name: /Finish Sketch/i })).toBeVisible();
}

// ---------------------------------------------------------------------------
// A: param-dim edit — expression edit moves geometry
// ---------------------------------------------------------------------------
test.describe('Param-dim inline edit', () => {
  test('double-click param-bound dim → type new expression → geometry moves', async ({ page }) => {
    page.on('pageerror', (e) => console.error('PAGEERROR:', e.message));
    await setupNewPart(page);
    await seedParamSketchAndEnter(page, 'sk-param-dim-a', 'myWidth', '50');

    await expect(page.locator('[data-testid="dimension-glyph"]').first()).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="dimension-glyph"]').first().dblclick();

    const input = page.locator('[data-testid^="dim-inline-input-"]').first();
    await expect(input).toBeVisible({ timeout: 3_000 });

    // Editor should be seeded with the parameter's expression '50'.
    await expect(input).toHaveValue('50');

    await input.fill('80');
    await input.press('Enter');

    // Registry value should update.
    await page.waitForFunction(
      () => (window as unknown as ZilventorWindow).__zilventorParameterRegistry.getValue('myWidth') === 80,
      { timeout: 8_000 },
    );

    // Geometry moved.
    const stateAfter = await getState(page);
    const sketchAfter = stateAfter.activePart?.featureTree.find(
      (f): f is Extract<Feature, { kind: 'sketch' }> =>
        f.kind === 'sketch' && f.id === 'sk-param-dim-a',
    );
    const l1 = sketchAfter?.primitives.find((p) => p.id === 'l1') as Primitive | undefined;
    expect(l1?.x2).toBeGreaterThan(70);
  });
});

// ---------------------------------------------------------------------------
// B: arithmetic literal — 100/2 → 50
// ---------------------------------------------------------------------------
test.describe('Arithmetic literal dim edit', () => {
  test('type 100/2 for a literal dim evaluates to 50', async ({ page }) => {
    page.on('pageerror', (e) => console.error('PAGEERROR:', e.message));
    await setupNewPart(page);

    const SKETCH_ID = 'sk-arith-b';
    await page.evaluate(
      async ({ sketchId }: { sketchId: string }) => {
        const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
        if (!s.kernel || !s.activePart) throw new Error('kernel or activePart not ready');
        await s.kernel.addFeature(s.activePart.id, {
          kind: 'sketch', id: sketchId,
          plane: { source: 'workPlane', featureId: 'origin.XY' },
          primitives: [{ id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 60, y2: 0 }],
          constraints: [{ id: 'd1', kind: 'dim-length', paramName: 'd1', line: 'l1', value: { kind: 'literal', value: 60 } }],
        });
        const next = await s.kernel.getPart(s.activePart.id);
        s.setActivePart(next);
        (s as unknown as { setSketchMode(on: boolean, id: string): void }).setSketchMode(true, sketchId);
      },
      { sketchId: SKETCH_ID },
    );
    await page.getByRole('tab', { name: 'Sketch' }).click();
    await expect(page.getByRole('button', { name: /Finish Sketch/i })).toBeVisible();

    await expect(page.locator('[data-testid="dimension-glyph"]').first()).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="dimension-glyph"]').first().dblclick();

    const input = page.locator('[data-testid^="dim-inline-input-"]').first();
    await expect(input).toBeVisible({ timeout: 3_000 });
    await input.fill('100/2');
    await input.press('Enter');

    await page.waitForFunction(
      () => {
        const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
        const sketchId = s.activeSketchId;
        const sketch = s.activePart?.featureTree.find((f) => f.kind === 'sketch' && (f as { id: string }).id === sketchId);
        if (!sketch || sketch.kind !== 'sketch') return false;
        const dim = (sketch as { constraints: Constraint[] }).constraints.find((c) => c.id === 'd1');
        return dim?.value?.kind === 'literal' && dim.value.value === 50;
      },
      { timeout: 8_000 },
    );
  });
});

// ---------------------------------------------------------------------------
// C: param-ref rejected for literal dim — editor stays open
// ---------------------------------------------------------------------------
test.describe('Param-ref rejection for literal dim', () => {
  test('typing a param-ref into a literal dim keeps the editor open', async ({ page }) => {
    page.on('pageerror', (e) => console.error('PAGEERROR:', e.message));
    await setupNewPart(page);

    const SKETCH_ID = 'sk-paramref-c';
    await page.evaluate(
      async ({ sketchId }: { sketchId: string }) => {
        const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
        if (!s.kernel || !s.activePart) throw new Error('kernel or activePart not ready');
        await s.kernel.addFeature(s.activePart.id, {
          kind: 'sketch', id: sketchId,
          plane: { source: 'workPlane', featureId: 'origin.XY' },
          primitives: [{ id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 60, y2: 0 }],
          constraints: [{ id: 'd1', kind: 'dim-length', paramName: 'd1', line: 'l1', value: { kind: 'literal', value: 60 } }],
        });
        const next = await s.kernel.getPart(s.activePart.id);
        s.setActivePart(next);
        (s as unknown as { setSketchMode(on: boolean, id: string): void }).setSketchMode(true, sketchId);
      },
      { sketchId: SKETCH_ID },
    );
    await page.getByRole('tab', { name: 'Sketch' }).click();
    await expect(page.getByRole('button', { name: /Finish Sketch/i })).toBeVisible();

    await expect(page.locator('[data-testid="dimension-glyph"]').first()).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="dimension-glyph"]').first().dblclick();

    const input = page.locator('[data-testid^="dim-inline-input-"]').first();
    await expect(input).toBeVisible({ timeout: 3_000 });
    await input.fill('myWidth');
    await input.press('Enter');

    // Editor must still be visible (not dismissed) after rejecting a param-ref.
    await expect(input).toBeVisible({ timeout: 2_000 });
  });
});

// ---------------------------------------------------------------------------
// D: undo restores param expression + geometry
// ---------------------------------------------------------------------------
test.describe('Param-dim undo', () => {
  test('undo after param-dim edit restores expression and geometry', async ({ page }) => {
    page.on('pageerror', (e) => console.error('PAGEERROR:', e.message));
    await setupNewPart(page);
    await seedParamSketchAndEnter(page, 'sk-param-dim-d', 'myWidth', '50');

    await expect(page.locator('[data-testid="dimension-glyph"]').first()).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="dimension-glyph"]').first().dblclick();

    const input = page.locator('[data-testid^="dim-inline-input-"]').first();
    await expect(input).toBeVisible({ timeout: 3_000 });
    await input.fill('80');
    await input.press('Enter');

    // Wait for the geometry to move.
    await page.waitForFunction(
      () => (window as unknown as ZilventorWindow).__zilventorParameterRegistry.getValue('myWidth') === 80,
      { timeout: 8_000 },
    );

    // Undo.
    await page.keyboard.press('Control+z');

    await page.waitForFunction(
      () => (window as unknown as ZilventorWindow).__zilventorParameterRegistry.getValue('myWidth') === 50,
      { timeout: 8_000 },
    );

    const registryValueAfterUndo = await getRegistryValue(page, 'myWidth');
    expect(registryValueAfterUndo).toBe(50);

    // Geometry should revert.
    const stateAfterUndo = await getState(page);
    const sketchAfterUndo = stateAfterUndo.activePart?.featureTree.find(
      (f): f is Extract<Feature, { kind: 'sketch' }> =>
        f.kind === 'sketch' && f.id === 'sk-param-dim-d',
    );
    const l1Reverted = sketchAfterUndo?.primitives.find((p) => p.id === 'l1') as Primitive | undefined;
    // x2 should be back near 50 (not > 70).
    expect(l1Reverted?.x2).toBeLessThan(70);
  });
});
```

### Step 6b — Run the e2e (expect fail — nothing wired yet after Task 1–5 complete)

Once Tasks 1–5 are done, run:
```bash
cd /Users/lion/Documents/Projects/mine/zilventor
npx playwright test tests/e2e/sketch-param-dim-inline-edit.spec.ts --project=chromium
```

Expected sequence: FAIL on Test A (editor not opening for param dim — Task 5 fix needed) or FAIL due to coord-discard (geometry not moved — Task 3 fix). After all tasks: PASS.

### Step 6c — §6 browser gate (manual check)

After all e2e pass, open the app in a browser and manually verify:
1. Create a part with a sketch containing a param-bound dim (e.g. `width = 100`).
2. Double-click the param dim label → editor opens seeded with `100`.
3. Type `80` → Enter → sketch line moves to 80mm.
4. Open the Parameters panel — `width` expression shows `80`.
5. Ctrl+Z → line reverts to 100mm.
6. Save (Ctrl+S or autosave) → reload → sketch line remains at 80mm.
7. Create a literal dim → type `100/2` → Enter → dim becomes 50.
8. Type `someParam` in a literal dim → editor stays open (rejected with toast).

### Step 6d — Full suite

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --reporter=dot
cd /Users/lion/Documents/Projects/mine/zilventor && npx tsc --noEmit -p packages/app/tsconfig.json
```

### Step 6e — Commit

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git add tests/e2e/sketch-param-dim-inline-edit.spec.ts
git commit -m "test(e2e): param-bound dim inline edit — param-dim edit, arithmetic literal, undo, reload"
```

---

## CWD reminders for all run-commands

- Vitest for app: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run <relpath>`  
  **NOT** from repo root — test-setup.ts not found from root.
- TSC: `cd /Users/lion/Documents/Projects/mine/zilventor && npx tsc --noEmit -p packages/app/tsconfig.json`
- e2e: `cd /Users/lion/Documents/Projects/mine/zilventor && npx playwright test tests/e2e/<spec> --project=chromium`  
  Dev server must be running first: `pnpm --filter @zilventor/app dev` (separate terminal).
- Bash cwd persists across AND within compound commands — always use absolute paths or re-`cd` absolute each time in compound calls.

---

## Execution order

Tasks 1 → 2 → 3 → 4 → 5 → 6. Tasks 1 and 2 are independent and may be executed in parallel by separate subagents. Tasks 3, 4, 5 all touch App.tsx or DimensionRenderer — run them sequentially. Task 6 depends on all prior tasks.
