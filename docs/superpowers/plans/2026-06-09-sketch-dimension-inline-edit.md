# Sketch Dimension Inline-Edit — Implementation Plan

> For agentic workers: execute this plan using `superpowers:subagent-driven-development`. Each task is a self-contained red→green→refactor slice. **Never** mark a task done without running the test command and reading the output yourself. Trust-but-verify: after each subagent batch, check the actual diff and re-run tests.

**Goal:** Double-click a sketch dimension label → inline `<input>` appears → Enter/blur commits a new literal value → `UpdateDimensionValueCommand` dispatches → solver re-cascades → geometry visibly moves on canvas. Undoable. Param-bound dims refuse edit with a toast. App-only; no manifest/kernel change (stays v20).

**Architecture:**
- `UpdateDimensionValueCommand` — fix coord-apply gap: capture `{dof, coords}` result and call `applyCoordDiff` + `setSketchDof`.
- New `packages/app/src/sketcher/parseDimensionInput.ts` — pure validation/parse helper (kind-aware; angle values are stored as degrees, so no conversion needed).
- `DimensionRenderer.tsx` — add `onEditDimension` prop + inline `<input>` sub-component triggered by double-click on the glyph `<g>`.
- `App.tsx` — wire `onEditDimension` callback: branch literal-vs-param, dispatch command for literal, toast for param.
- New e2e test — real-canvas double-click, assert geometry moved, undo restores.

**Tech Stack:** TypeScript, React, Vitest (unit), Playwright (e2e). CWD trap: run app unit tests from `packages/app/` every time.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/app/src/commands/UpdateDimensionValueCommand.ts` | Modify (lines 15–28) | Capture solver result; apply coord diff + dof on apply and revert |
| `packages/app/src/commands/__tests__/dimension-commands.spec.ts` | Modify | Add test driving coord-diff through real consumer |
| `packages/app/src/sketcher/parseDimensionInput.ts` | Create | Pure helper: validate plain number, reject ≤0 for radius/diameter/length, angle passes through as degrees |
| `packages/app/src/sketcher/__tests__/parseDimensionInput.spec.ts` | Create | Analytic unit tests for all edge cases |
| `packages/app/src/sketcher/render/DimensionRenderer.tsx` | Modify | Add `onEditDimension` prop + `InlineDimEditor` sub-component |
| `packages/app/src/sketcher/render/__tests__/DimensionRenderer.spec.tsx` | Create | Double-click invokes callback; param dim refuses; editor Enter commits, Esc cancels |
| `packages/app/src/App.tsx` | Modify (~line 4445) | Wire `onEditDimension` callback to DimensionRenderer |
| `tests/e2e/sketch-dimension-inline-edit.spec.ts` | Create | Real-canvas: double-click radius + linear dim, type value, assert store + geometry; undo restores |

---

## Task 1 — Fix coord-apply gap in `UpdateDimensionValueCommand`

**Why:** `apply()` calls `sketcherClient.updateDimensionValue(...)` but discards the returned `{dof, coords}`. Primitive coordinates are never patched and geometry does not move. This task captures the result and drives it through the real consumer path (`applyCoordDiff` + `setSketchDof`). Same fix for `revert()`.

**NOTE for implementer (§6 gate):** Before finalizing this task, verify in the browser that geometry does NOT already move without the fix. The spec notes `AddDimensionCommand` has the identical discard pattern yet presumably functions — there may be a secondary propagation path. If geometry already moves, re-scope this task to only ensure the dof is updated correctly; **do not** hand-author test diff values, drive the real producer.

### Files

- **Modify:** `packages/app/src/commands/UpdateDimensionValueCommand.ts` — lines 15–28
- **Modify:** `packages/app/src/commands/__tests__/dimension-commands.spec.ts` — add 2 tests after line 99

### Steps

- [ ] **Write failing tests** — add to `packages/app/src/commands/__tests__/dimension-commands.spec.ts` after the last `it(...)`:

```typescript
it('UpdateDimensionValueCommand.apply patches store primitives with coords from client', async () => {
  // Arrange: sketch with a line at x1=0,y1=0 → x2=50,y2=0
  useAppStore.getState().setActivePart({
    id: 'P1', name: 'P', units: 'mm', parameters: {}, properties: {},
    featureTree: [{
      kind: 'sketch', id: 'S1',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [{ id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 50, y2: 0 }],
      constraints: [{ id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'l1', value: { kind: 'literal', value: 50 } }]
    }],
    materials: [], hardware: [],
  });
  const coordsResult = { dof: { count: 0, state: 'solved' as const }, coords: [{ primitiveId: 'l1', patch: { x2: 100, y2: 0 } }] };
  const updateDimensionValue = vi.fn().mockResolvedValue(coordsResult);
  const client = { updateDimensionValue } as unknown as SketcherClient;

  // Act
  const cmd = new UpdateDimensionValueCommand('S1', 'd0', 50, 100, client);
  await cmd.apply();

  // Assert: store primitive l1 must have x2=100 (driven by the returned coords, not hand-authored)
  const sketch = useAppStore.getState().activePart!.featureTree[0] as { primitives: Array<{ id: string; x2: number }> };
  expect(sketch.primitives.find((p) => p.id === 'l1')!.x2).toBe(100);
  // And dof was set
  expect(useAppStore.getState().sketchDof).toEqual(coordsResult.dof);
});

it('UpdateDimensionValueCommand.revert patches store primitives with before-coords from client', async () => {
  useAppStore.getState().setActivePart({
    id: 'P1', name: 'P', units: 'mm', parameters: {}, properties: {},
    featureTree: [{
      kind: 'sketch', id: 'S1',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [{ id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0 }],
      constraints: [{ id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'l1', value: { kind: 'literal', value: 100 } }]
    }],
    materials: [], hardware: [],
  });
  // On revert the client is called with `before` (50) and returns a diff moving l1.x2 back to 50
  const revertCoordsResult = { dof: { count: 1, state: 'under' as const }, coords: [{ primitiveId: 'l1', patch: { x2: 50, y2: 0 } }] };
  const updateDimensionValue = vi.fn().mockResolvedValue(revertCoordsResult);
  const client = { updateDimensionValue } as unknown as SketcherClient;

  const cmd = new UpdateDimensionValueCommand('S1', 'd0', 50, 100, client);
  // First apply (mock returns a different diff — not important for this revert test)
  updateDimensionValue.mockResolvedValueOnce({ dof: { count: 0, state: 'solved' as const }, coords: [] });
  await cmd.apply();
  // Now revert
  updateDimensionValue.mockResolvedValueOnce(revertCoordsResult);
  await cmd.revert();

  const sketch = useAppStore.getState().activePart!.featureTree[0] as { primitives: Array<{ id: string; x2: number }> };
  expect(sketch.primitives.find((p) => p.id === 'l1')!.x2).toBe(50);
  expect(useAppStore.getState().sketchDof).toEqual(revertCoordsResult.dof);
});
```

- [ ] **Run tests — expect FAIL** (coord diff not applied, `x2` stays at original, `sketchDof` never set):

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/commands/__tests__/dimension-commands.spec.ts
```

Expected failure reason: `expect(sketch.primitives.find((p) => p.id === 'l1')!.x2).toBe(100)` — actual is `50` (coords discarded).

- [ ] **Implement** — replace lines 15–28 in `packages/app/src/commands/UpdateDimensionValueCommand.ts`:

```typescript
  async apply(): Promise<void> {
    useAppStore.getState().updateDimensionValueInStore(this.sketchId, this.dimId, this.after);
    if (this.sketcherClient) {
      const result = await this.sketcherClient.updateDimensionValue(this.dimId, this.after);
      useAppStore.getState().applyCoordDiff(this.sketchId, result.coords);
      useAppStore.getState().setSketchDof(result.dof);
    }
  }

  async revert(): Promise<void> {
    useAppStore.getState().updateDimensionValueInStore(this.sketchId, this.dimId, this.before);
    if (this.sketcherClient) {
      const result = await this.sketcherClient.updateDimensionValue(this.dimId, this.before);
      useAppStore.getState().applyCoordDiff(this.sketchId, result.coords);
      useAppStore.getState().setSketchDof(result.dof);
    }
  }
```

- [ ] **Run tests — expect PASS**:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/commands/__tests__/dimension-commands.spec.ts
```

- [ ] **Run full app suite — stay green**:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run
```

- [ ] **Commit**:

```bash
git add packages/app/src/commands/UpdateDimensionValueCommand.ts packages/app/src/commands/__tests__/dimension-commands.spec.ts
git commit -m "fix(sketch): apply coord diff + dof after UpdateDimensionValueCommand solve"
```

---

## Task 2 — Pure validation/parse helper `parseDimensionInput`

**Why:** Centralise kind-aware validation (reject ≤0 for radius/diameter/length, angle pass-through as degrees, empty/NaN rejection) so the renderer and App.tsx both call the same logic.

### Files

- **Create:** `packages/app/src/sketcher/parseDimensionInput.ts`
- **Create:** `packages/app/src/sketcher/__tests__/parseDimensionInput.spec.ts`

### Steps

- [ ] **Write failing tests** — create `packages/app/src/sketcher/__tests__/parseDimensionInput.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseDimensionInput } from '../parseDimensionInput';

describe('parseDimensionInput', () => {
  it('rejects empty string', () => {
    expect(parseDimensionInput('dim-length', '')).toEqual({ ok: false });
  });

  it('rejects NaN string', () => {
    expect(parseDimensionInput('dim-length', 'abc')).toEqual({ ok: false });
  });

  it('rejects zero for dim-length', () => {
    expect(parseDimensionInput('dim-length', '0')).toEqual({ ok: false });
  });

  it('rejects negative for dim-length', () => {
    expect(parseDimensionInput('dim-length', '-5')).toEqual({ ok: false });
  });

  it('accepts positive for dim-length', () => {
    expect(parseDimensionInput('dim-length', '50')).toEqual({ ok: true, value: 50 });
  });

  it('rejects zero for dim-radius', () => {
    expect(parseDimensionInput('dim-radius', '0')).toEqual({ ok: false });
  });

  it('rejects negative for dim-radius', () => {
    expect(parseDimensionInput('dim-radius', '-3')).toEqual({ ok: false });
  });

  it('accepts positive for dim-radius', () => {
    expect(parseDimensionInput('dim-radius', '5')).toEqual({ ok: true, value: 5 });
  });

  it('rejects zero for dim-diameter', () => {
    expect(parseDimensionInput('dim-diameter', '0')).toEqual({ ok: false });
  });

  it('accepts positive for dim-diameter', () => {
    expect(parseDimensionInput('dim-diameter', '10')).toEqual({ ok: true, value: 10 });
  });

  it('accepts any number for dim-distance', () => {
    expect(parseDimensionInput('dim-distance', '0')).toEqual({ ok: true, value: 0 });
    expect(parseDimensionInput('dim-distance', '-10')).toEqual({ ok: true, value: -10 });
    expect(parseDimensionInput('dim-distance', '25.5')).toEqual({ ok: true, value: 25.5 });
  });

  it('accepts any number for dim-point-line-distance', () => {
    expect(parseDimensionInput('dim-point-line-distance', '0')).toEqual({ ok: true, value: 0 });
  });

  // dim-angle: values are STORED IN DEGREES (GcsSystem.ts:593 does the deg→rad conversion
  // internally when feeding the solver). parseDimensionInput must return degrees as-is — NO conversion.
  it('passes through degrees as-is for dim-angle (input "45" → value 45)', () => {
    const res = parseDimensionInput('dim-angle', '45');
    expect(res.ok).toBe(true);
    expect((res as { ok: true; value: number }).value).toBe(45);
  });

  it('passes through degrees as-is for dim-angle (input "90" → value 90, NOT π/2)', () => {
    const res = parseDimensionInput('dim-angle', '90');
    expect(res.ok).toBe(true);
    expect((res as { ok: true; value: number }).value).toBe(90);
  });

  it('passes through negative angle as-is (dim-angle, "-30" → -30)', () => {
    const res = parseDimensionInput('dim-angle', '-30');
    expect(res.ok).toBe(true);
    expect((res as { ok: true; value: number }).value).toBe(-30);
  });

  it('passes through zero angle as-is (dim-angle, "0" → 0)', () => {
    const res = parseDimensionInput('dim-angle', '0');
    expect(res.ok).toBe(true);
    expect((res as { ok: true; value: number }).value).toBe(0);
  });
});
```

- [ ] **Run tests — expect FAIL** (module not found):

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/sketcher/__tests__/parseDimensionInput.spec.ts
```

Expected failure reason: `Cannot find module '../parseDimensionInput'`.

- [ ] **Implement** — create `packages/app/src/sketcher/parseDimensionInput.ts`:

```typescript
import type { DimensionConstraint } from '@zilventor/shared';

export type ParseResult =
  | { ok: true; value: number }
  | { ok: false };

/** Kinds where a ≤0 value is physically invalid. */
const POSITIVE_ONLY_KINDS: ReadonlySet<DimensionConstraint['kind']> = new Set([
  'dim-length',
  'dim-radius',
  'dim-diameter',
]);

/**
 * Parse and validate a user-typed plain-number string for a dimension constraint.
 *
 * Rules:
 *  - Empty / NaN → `{ ok: false }`.
 *  - `dim-length`, `dim-radius`, `dim-diameter`: reject ≤ 0.
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
  const n = Number(trimmed);
  if (!isFinite(n) || isNaN(n)) return { ok: false };

  if (POSITIVE_ONLY_KINDS.has(kind) && n <= 0) return { ok: false };

  // dim-angle: stored in degrees — return as-is (NO deg→rad conversion).
  return { ok: true, value: n };
}
```

- [ ] **Run tests — expect PASS**:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/sketcher/__tests__/parseDimensionInput.spec.ts
```

- [ ] **Run full app suite — stay green**:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run
```

- [ ] **Commit**:

```bash
git add packages/app/src/sketcher/parseDimensionInput.ts packages/app/src/sketcher/__tests__/parseDimensionInput.spec.ts
git commit -m "feat(sketch): add parseDimensionInput helper (validation, angle pass-through)"
```

---

## Task 3 — Inline editor + double-click trigger in `DimensionRenderer.tsx`

**Why:** The glyph `<g data-testid="dimension-glyph">` already has `pointerEvents:'auto'` but no handler. This task adds a double-click trigger, a new `onEditDimension` prop, and the `InlineDimEditor` sub-component (mirrors ParametersPanel's `<input autoFocus>` Enter/Esc/blur pattern). Param-bound dims must fire a separate `onParamDimRefused` prop (or pass the refusal to the caller via a shared handler) rather than opening an editor.

### Files

- **Modify:** `packages/app/src/sketcher/render/DimensionRenderer.tsx`
- **Create:** `packages/app/src/sketcher/render/__tests__/DimensionRenderer.spec.tsx`

### Steps

- [ ] **Write failing tests** — create `packages/app/src/sketcher/render/__tests__/DimensionRenderer.spec.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DimensionRenderer } from '../DimensionRenderer';
import type { DimensionConstraint, SketchPrimitive } from '@zilventor/shared';

// Minimal worldToScreen: identity (for test purposes coord == screen).
const wts = (x: number, y: number) => ({ x, y });

const LINE_PRIM: SketchPrimitive = { id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 50, y2: 0 };

// paramName and line are required on dim-length (DimBase + { line: string }).
const DIM_LITERAL: DimensionConstraint = {
  id: 'd1', kind: 'dim-length', paramName: 'd1', line: 'l1',
  value: { kind: 'literal', value: 50 }
};

const DIM_PARAM: DimensionConstraint = {
  id: 'd2', kind: 'dim-length', paramName: 'd2', line: 'l1',
  value: { kind: 'param', paramName: 'width' }
};

describe('DimensionRenderer — inline edit', () => {
  it('double-click on literal glyph invokes onEditDimension with correct id', () => {
    const onEdit = vi.fn();
    const { getAllByTestId } = render(
      <DimensionRenderer
        primitives={[LINE_PRIM]}
        dimensions={[DIM_LITERAL]}
        parameterValues={new Map()}
        worldToScreen={wts}
        onEditDimension={onEdit}
      />
    );
    const [glyph] = getAllByTestId('dimension-glyph');
    fireEvent.doubleClick(glyph!);
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledWith('d1');
  });

  it('double-click on param glyph invokes onEditDimension with id (caller decides param vs literal)', () => {
    const onEdit = vi.fn();
    const { getAllByTestId } = render(
      <DimensionRenderer
        primitives={[LINE_PRIM]}
        dimensions={[DIM_PARAM]}
        parameterValues={new Map([['width', 50]])}
        worldToScreen={wts}
        onEditDimension={onEdit}
      />
    );
    const [glyph] = getAllByTestId('dimension-glyph');
    fireEvent.doubleClick(glyph!);
    // Caller decides whether to open editor or toast; renderer just fires the callback.
    expect(onEdit).toHaveBeenCalledWith('d2');
  });

  it('when editing is active (editingDimId matches), an autoFocus input appears seeded with current value', () => {
    const onEdit = vi.fn();
    const { container } = render(
      <DimensionRenderer
        primitives={[LINE_PRIM]}
        dimensions={[DIM_LITERAL]}
        parameterValues={new Map()}
        worldToScreen={wts}
        onEditDimension={onEdit}
        editingDimId="d1"
        editingDimInitialValue="50"
        onEditCommit={vi.fn()}
        onEditCancel={vi.fn()}
      />
    );
    const input = container.querySelector('input') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input!.value).toBe('50');
  });

  it('pressing Enter in the inline editor invokes onEditCommit with typed value', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <DimensionRenderer
        primitives={[LINE_PRIM]}
        dimensions={[DIM_LITERAL]}
        parameterValues={new Map()}
        worldToScreen={wts}
        onEditDimension={vi.fn()}
        editingDimId="d1"
        editingDimInitialValue="50"
        onEditCommit={onCommit}
        onEditCancel={vi.fn()}
      />
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '75' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('d1', '75');
  });

  it('pressing Escape in the inline editor invokes onEditCancel', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <DimensionRenderer
        primitives={[LINE_PRIM]}
        dimensions={[DIM_LITERAL]}
        parameterValues={new Map()}
        worldToScreen={wts}
        onEditDimension={vi.fn()}
        editingDimId="d1"
        editingDimInitialValue="50"
        onEditCommit={vi.fn()}
        onEditCancel={onCancel}
      />
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('blur on inline editor invokes onEditCommit with current value', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <DimensionRenderer
        primitives={[LINE_PRIM]}
        dimensions={[DIM_LITERAL]}
        parameterValues={new Map()}
        worldToScreen={wts}
        onEditDimension={vi.fn()}
        editingDimId="d1"
        editingDimInitialValue="50"
        onEditCommit={onCommit}
        onEditCancel={vi.fn()}
      />
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith('d1', '60');
  });
});
```

- [ ] **Run tests — expect FAIL** (props not on type, no input rendered):

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/sketcher/render/__tests__/DimensionRenderer.spec.tsx
```

Expected failure reason: `Property 'onEditDimension' does not exist on type...` or test fails because no input appears.

- [ ] **Implement** — modify `packages/app/src/sketcher/render/DimensionRenderer.tsx`:

  Change the `Props` type to add the new optional edit props:

  ```typescript
  type Props = {
    primitives: SketchPrimitive[];
    dimensions: DimensionConstraint[];
    parameterValues: Map<string, number>;
    worldToScreen(x: number, y: number): { x: number; y: number };
    /** Called when user double-clicks any dimension glyph. Caller decides literal vs param. */
    onEditDimension?: (dimId: string) => void;
    /** If set, the dimension with this id shows an inline editor. */
    editingDimId?: string;
    /** The initial string value to seed the inline editor (angle in degrees, others as-is). */
    editingDimInitialValue?: string;
    /** Called when the editor commits (Enter or blur). Caller validates + dispatches. */
    onEditCommit?: (dimId: string, rawValue: string) => void;
    /** Called when the editor is cancelled (Escape). */
    onEditCancel?: () => void;
  };
  ```

  Add `useState` import (for `InlineDimEditor`):
  ```typescript
  import { useState, type ReactNode } from 'react';
  ```

  Pass new props into `DimensionGlyph`:
  ```typescript
  export function DimensionRenderer({ primitives, dimensions, parameterValues, worldToScreen, onEditDimension, editingDimId, editingDimInitialValue, onEditCommit, onEditCancel }: Props) {
    const byId = new Map(primitives.map((p) => [p.id, p]));
    const highlightedIds = useAppStore((s) => s.highlightedConstraintIds);
    const highlightedSet = new Set(highlightedIds);
    return (
      <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} width="100%" height="100%">
        {dimensions.map((d) => (
          <DimensionGlyph
            key={d.id}
            d={d}
            byId={byId}
            parameterValues={parameterValues}
            worldToScreen={worldToScreen}
            highlighted={highlightedSet.has(d.id)}
            onEditDimension={onEditDimension}
            isEditing={editingDimId === d.id}
            editingInitialValue={editingDimInitialValue ?? ''}
            onEditCommit={onEditCommit}
            onEditCancel={onEditCancel}
          />
        ))}
      </svg>
    );
  }
  ```

  Add new props to `DimensionGlyph` signature:
  ```typescript
  function DimensionGlyph({
    d, byId, parameterValues, worldToScreen, highlighted,
    onEditDimension, isEditing, editingInitialValue, onEditCommit, onEditCancel
  }: {
    d: DimensionConstraint;
    byId: Map<string, SketchPrimitive>;
    parameterValues: Map<string, number>;
    worldToScreen: (x: number, y: number) => { x: number; y: number };
    highlighted: boolean;
    onEditDimension?: (dimId: string) => void;
    isEditing: boolean;
    editingInitialValue: string;
    onEditCommit?: (dimId: string, rawValue: string) => void;
    onEditCancel?: () => void;
  })
  ```

  Replace the glyph `<g ...>` closing block (lines 137–145) with:
  ```typescript
  return (
    <g
      data-testid="dimension-glyph"
      style={{ pointerEvents: 'auto' }}
      onDoubleClick={(e) => { e.stopPropagation(); onEditDimension?.(d.id); }}
    >
      {els}
      {isEditing ? (
        <foreignObject x={labelAt.x - 28} y={labelAt.y - 10} width={56} height={22}>
          <InlineDimEditor
            dimId={d.id}
            initialValue={editingInitialValue}
            onCommit={(raw) => onEditCommit?.(d.id, raw)}
            onCancel={() => onEditCancel?.()}
          />
        </foreignObject>
      ) : (
        <>
          <rect x={labelAt.x - 24} y={labelAt.y - 8} width={48} height={16} fill="#1a1a1a" opacity={0.9} />
          <text x={labelAt.x} y={labelAt.y + 4} fill={labelColor} fontSize={11} fontFamily="ui-monospace, monospace" textAnchor="middle">
            {text}
          </text>
        </>
      )}
    </g>
  );
  ```

  Add `InlineDimEditor` component at bottom of file (above `Arrow`):
  ```typescript
  function InlineDimEditor({
    dimId, initialValue, onCommit, onCancel
  }: {
    dimId: string;
    initialValue: string;
    onCommit(raw: string): void;
    onCancel(): void;
  }) {
    const [value, setValue] = useState(initialValue);
    return (
      <input
        // xmlns required for foreignObject to render correctly in SVG
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onCommit(value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); onCommit(value); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        style={{
          width: '100%', height: '100%', fontSize: 11,
          fontFamily: 'ui-monospace, monospace',
          background: '#222', color: '#e8c36a',
          border: '1px solid #555', padding: '0 2px',
          boxSizing: 'border-box'
        }}
        data-testid={`dim-inline-input-${dimId}`}
      />
    );
  }
  ```

  NOTE: the `dimId` parameter is unused inside `InlineDimEditor` itself; it's on the `data-testid` for testing. The `onCommit`/`onCancel` closures capture `d.id` from the parent.

- [ ] **Run tests — expect PASS**:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/sketcher/render/__tests__/DimensionRenderer.spec.tsx
```

- [ ] **Run full app suite — stay green**:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run
```

- [ ] **Commit**:

```bash
git add packages/app/src/sketcher/render/DimensionRenderer.tsx packages/app/src/sketcher/render/__tests__/DimensionRenderer.spec.tsx
git commit -m "feat(sketch): add inline editor + double-click trigger to DimensionRenderer"
```

---

## Task 4 — Wire `onEditDimension` in `App.tsx`

**Why:** `DimensionRenderer` now exposes `onEditDimension`, `editingDimId`, `onEditCommit`, `onEditCancel`. `App.tsx` must provide these: branch literal-vs-param, dispatch `UpdateDimensionValueCommand` for literal dims, show toast for param dims. This is an integration/wiring task with limited unit-test surface; self-verify by checking no TypeScript errors and reviewing the wiring in browser (§6).

**Mirror pattern:** slice-2 fillet/chamfer edge-pick wiring: a `useCallback` that reads `store.activeSketchId`, `sketcherClientRef.current`, dispatches the command via `store.bus.execute`.

### Files

- **Modify:** `packages/app/src/App.tsx` — add state + callbacks + wiring at the `DimensionRenderer` JSX (~line 4445)

### Steps

- [ ] **Add `UpdateDimensionValueCommand` import** near line 27 in `App.tsx` (after the `AddDimensionCommand` import):

```typescript
import { UpdateDimensionValueCommand } from './commands/UpdateDimensionValueCommand';
```

- [ ] **Add local state** for which dim is being edited. Find the existing `const [pendingDimension, setPendingDimension]` state and add after it:

```typescript
const [editingDimId, setEditingDimId] = useState<string | null>(null);
```

- [ ] **Add `handleEditDimension` callback** after `onDialogCancel` (around line 1800):

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

- [ ] **Add `handleEditCommit` callback** after `handleEditDimension`:

```typescript
const handleEditCommit = useCallback(async (dimId: string, rawValue: string) => {
  const store = useAppStore.getState();
  const sketchId = store.activeSketchId;
  const client = sketcherClientRef.current;
  if (!sketchId || !client || !store.activePart) { setEditingDimId(null); return; }
  const sketch = store.activePart.featureTree.find((f) => f.kind === 'sketch' && f.id === sketchId);
  if (!sketch || sketch.kind !== 'sketch') { setEditingDimId(null); return; }
  const dim = sketch.constraints.find((c): c is DimensionConstraint => c.id === dimId && c.kind.startsWith('dim-'));
  if (!dim || dim.value.kind !== 'literal') { setEditingDimId(null); return; }
  const { parseDimensionInput } = await import('./sketcher/parseDimensionInput');
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

  NOTE: using a dynamic `import()` for `parseDimensionInput` keeps the callback deps clean. Alternatively, import at top-of-file — implementer chooses. Top-of-file is simpler; use that if it avoids issues:
  ```typescript
  import { parseDimensionInput } from './sketcher/parseDimensionInput';
  ```
  Then the callback body becomes a direct call: `const parsed = parseDimensionInput(dim.kind, rawValue);`

- [ ] **Wire into `DimensionRenderer` JSX** — find the `<DimensionRenderer` block (~line 4445) and add the new props:

```typescript
                <DimensionRenderer
                  primitives={f.primitives}
                  dimensions={dimensions}
                  parameterValues={parameterValues}
                  worldToScreen={worldToScreen}
                  onEditDimension={handleEditDimension}
                  editingDimId={editingDimId ?? undefined}
                  editingDimInitialValue={(() => {
                    if (!editingDimId) return undefined;
                    const dim = dimensions.find((d) => d.id === editingDimId);
                    if (!dim || dim.value.kind !== 'literal') return undefined;
                    // Stored value is already in the user-facing unit (degrees for angle,
                    // mm for lengths/radii). Display it directly — no conversion needed.
                    return String(dim.value.value);
                  })()}
                  onEditCommit={(id, raw) => { void handleEditCommit(id, raw); }}
                  onEditCancel={() => setEditingDimId(null)}
                />
```

- [ ] **TypeScript check** — run tsc to ensure no type errors:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx tsc --noEmit
```

- [ ] **Run full app suite — stay green**:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run
```

- [ ] **Commit**:

```bash
git add packages/app/src/App.tsx
git commit -m "feat(sketch): wire dimension inline-edit callback in App.tsx"
```

---

## Task 5 — e2e real-canvas test

**Why:** Closes the §6 gap. Unit tests verify logic in isolation; only a real-canvas test exercises the full path: double-click → `handleEditDimension` → `handleEditCommit` → `UpdateDimensionValueCommand` → solver → `applyCoordDiff` → canvas re-renders. Also verifies undo restores both the dimension value and the primitive geometry.

### Files

- **Create:** `tests/e2e/sketch-dimension-inline-edit.spec.ts`

### Steps

- [ ] **Write failing test** — create `tests/e2e/sketch-dimension-inline-edit.spec.ts`:

```typescript
/**
 * Sketch dimension inline-edit — end-to-end gate.
 *
 * A) Double-click a dim-length dimension label → type new value → Enter →
 *    assert store dimension value changed + primitive geometry changed.
 * B) Double-click a dim-radius dimension label → type new value → Enter →
 *    assert store dimension value changed + arc radius changed.
 * C) Undo restores both the dimension value and the geometry.
 * D) Double-click a param-bound dim → no inline editor appears (no input in DOM).
 */

import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

type ZilventorWindow = {
  __zilventorStore: {
    getState(): AppState;
    setState(patch: Partial<AppState>): void;
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
  materials: unknown[];
};

type Feature =
  | { kind: 'sketch'; id: string; primitives: Primitive[]; constraints: Constraint[] }
  | { kind: string; id: string };

type Primitive = {
  id: string;
  kind: string;
  x1?: number; y1?: number; x2?: number; y2?: number;
  cx?: number; cy?: number; r?: number;
};

type Constraint = {
  id: string;
  kind: string;
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

async function setupNewPart(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();
}

/** Seed a sketch with primitives + constraints, then enter sketch mode. */
async function seedSketchAndEnter(
  page: import('@playwright/test').Page,
  sketchId: string,
  primitives: Primitive[],
  constraints: Constraint[],
): Promise<void> {
  await page.evaluate(
    async ({ sketchId, primitives, constraints }: { sketchId: string; primitives: Primitive[]; constraints: Constraint[] }) => {
      const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
      if (!s.kernel || !s.activePart) throw new Error('kernel or activePart not ready');
      await s.kernel.addFeature(s.activePart.id, {
        kind: 'sketch', id: sketchId,
        plane: { source: 'workPlane', featureId: 'origin.XY' },
        primitives, constraints,
      });
      const next = await s.kernel.getPart(s.activePart.id);
      s.setActivePart(next);
      (s as unknown as { setSketchMode(on: boolean, id: string): void }).setSketchMode(true, sketchId);
    },
    { sketchId, primitives, constraints },
  );
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await expect(page.getByRole('button', { name: /Finish Sketch/i })).toBeVisible();
}

// ---------------------------------------------------------------------------
// A+C: dim-length inline edit + undo
// ---------------------------------------------------------------------------
test.describe('Sketch dimension inline-edit — dim-length', () => {
  test(
    'double-click dim-length label, type new value, assert store value + geometry changed; undo restores',
    async ({ page }) => {
      page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
      await setupNewPart(page);

      const SKETCH_ID = 'sk-dim-inline-length';
      // A line with a dim-length = 50. We will change it to 80.
      // paramName and line are required fields on dim-length (DimBase + { line: string }).
      await seedSketchAndEnter(page, SKETCH_ID, [
        { id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 50, y2: 0 },
      ], [
        { id: 'd1', kind: 'dim-length', paramName: 'd1', line: 'l1', value: { kind: 'literal', value: 50 } } as Constraint,
      ]);

      // Wait for the dimension glyph to appear.
      await expect(page.locator('[data-testid="dimension-glyph"]').first()).toBeVisible({ timeout: 8_000 });

      // Double-click the glyph.
      await page.locator('[data-testid="dimension-glyph"]').first().dblclick();

      // An input should appear.
      const input = page.locator('[data-testid^="dim-inline-input-"]').first();
      await expect(input).toBeVisible({ timeout: 3_000 });

      // Type a new value and commit with Enter.
      await input.fill('80');
      await input.press('Enter');

      // Wait for the store to reflect the new dimension value.
      await page.waitForFunction(() => {
        const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
        const sketchId = s.activeSketchId;
        const sketch = s.activePart?.featureTree.find((f) => f.kind === 'sketch' && (f as { id: string }).id === sketchId);
        if (!sketch || sketch.kind !== 'sketch') return false;
        const dim = (sketch as { constraints: Constraint[] }).constraints.find((c) => c.id === 'd1');
        return dim?.value?.kind === 'literal' && dim.value.value === 80;
      }, { timeout: 8_000 });

      // Assert geometry: l1.x2 should now be ~80 (solver moved the endpoint).
      const stateAfter = await getState(page);
      const sketchAfter = stateAfter.activePart?.featureTree.find(
        (f): f is Extract<Feature, { kind: 'sketch' }> =>
          f.kind === 'sketch' && f.id === stateAfter.activeSketchId,
      );
      expect(sketchAfter).toBeDefined();
      const dimAfter = sketchAfter!.constraints.find((c) => c.id === 'd1');
      expect(dimAfter?.value?.value).toBe(80);
      // Geometry moved (l1.x2 changed from 50 to ~80).
      const l1After = sketchAfter!.primitives.find((p) => p.id === 'l1');
      expect(l1After).toBeDefined();
      expect((l1After as Primitive).x2).toBeGreaterThan(70); // solver may not land at exactly 80 without full constraints

      // UNDO: press Ctrl+Z.
      await page.keyboard.press('Control+z');

      // Wait for store to revert dim value.
      await page.waitForFunction(() => {
        const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
        const sketchId = s.activeSketchId;
        const sketch = s.activePart?.featureTree.find((f) => f.kind === 'sketch' && (f as { id: string }).id === sketchId);
        if (!sketch || sketch.kind !== 'sketch') return false;
        const dim = (sketch as { constraints: Constraint[] }).constraints.find((c) => c.id === 'd1');
        return dim?.value?.kind === 'literal' && dim.value.value === 50;
      }, { timeout: 8_000 });

      const stateReverted = await getState(page);
      const sketchReverted = stateReverted.activePart?.featureTree.find(
        (f): f is Extract<Feature, { kind: 'sketch' }> =>
          f.kind === 'sketch' && f.id === stateReverted.activeSketchId,
      );
      const dimReverted = sketchReverted!.constraints.find((c) => c.id === 'd1');
      expect(dimReverted?.value?.value).toBe(50);
    },
  );
});

// ---------------------------------------------------------------------------
// B: dim-radius inline edit
// ---------------------------------------------------------------------------
test.describe('Sketch dimension inline-edit — dim-radius', () => {
  test(
    'double-click dim-radius label, type new radius, assert store + arc radius updated',
    async ({ page }) => {
      page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
      await setupNewPart(page);

      const SKETCH_ID = 'sk-dim-inline-radius';
      // paramName and circle are required fields on dim-radius (DimBase + { circle: string }).
      await seedSketchAndEnter(page, SKETCH_ID, [
        { id: 'a1', kind: 'arc', cx: 0, cy: 0, r: 10, startAngle: 0, endAngle: Math.PI },
      ], [
        { id: 'd2', kind: 'dim-radius', paramName: 'd2', circle: 'a1', value: { kind: 'literal', value: 10 } } as Constraint,
      ]);

      await expect(page.locator('[data-testid="dimension-glyph"]').first()).toBeVisible({ timeout: 8_000 });
      await page.locator('[data-testid="dimension-glyph"]').first().dblclick();

      const input = page.locator('[data-testid^="dim-inline-input-"]').first();
      await expect(input).toBeVisible({ timeout: 3_000 });
      await input.fill('20');
      await input.press('Enter');

      await page.waitForFunction(() => {
        const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
        const sketchId = s.activeSketchId;
        const sketch = s.activePart?.featureTree.find((f) => f.kind === 'sketch' && (f as { id: string }).id === sketchId);
        if (!sketch || sketch.kind !== 'sketch') return false;
        const dim = (sketch as { constraints: Constraint[] }).constraints.find((c) => c.id === 'd2');
        return dim?.value?.kind === 'literal' && dim.value.value === 20;
      }, { timeout: 8_000 });

      const stateAfter = await getState(page);
      const sketchAfter = stateAfter.activePart?.featureTree.find(
        (f): f is Extract<Feature, { kind: 'sketch' }> =>
          f.kind === 'sketch' && f.id === stateAfter.activeSketchId,
      );
      const a1 = sketchAfter!.primitives.find((p) => p.id === 'a1');
      // Solver should have updated the arc radius.
      expect((a1 as Primitive).r).toBeGreaterThan(15);
    },
  );
});
```

- [ ] **Run test — expect FAIL** (double-click does nothing, no inline editor, store value unchanged):

```bash
cd /Users/lion/Documents/Projects/mine/zilventor && npx playwright test tests/e2e/sketch-dimension-inline-edit.spec.ts --reporter=line
```

Expected failure reason: double-click fires but no input appears in DOM (wiring not yet in place — or if wired, the store value assertion fails because `handleEditCommit` hasn't dispatched the command).

- [ ] **Verify green after Tasks 1–4 impl** — re-run:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor && npx playwright test tests/e2e/sketch-dimension-inline-edit.spec.ts --reporter=line
```

- [ ] **Run full e2e suite — stay green**:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor && npx playwright test --reporter=line
```

- [ ] **Run full app unit suite — stay green**:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run
```

- [ ] **Commit**:

```bash
git add tests/e2e/sketch-dimension-inline-edit.spec.ts
git commit -m "test(e2e): sketch dimension inline-edit — real-canvas double-click + undo"
```

---

## §6 Browser Verification (non-negotiable gate, not a task)

After all 5 tasks are committed and unit+e2e are green, an implementer MUST open the running dev server in a real browser and perform these checks:

1. **Coord-apply gap (conf-78 resolution):** Edit a `dim-length` dimension value from the canvas inline editor. Confirm that **the line endpoint visibly moves** to the new dimension. If it does not, and geometry is frozen, the Task 1 fix is confirmed load-bearing and must be verified in the command's apply path. If geometry already moved even before Task 1, re-scope Task 1 to only ensure `setSketchDof` is called (a secondary path exists).

2. **Dim-radius:** Edit a fillet arc's radius via inline edit. Confirm the arc radius changes visually and the coincident constraints (wired in slice-2) do not produce a gap or over-constraint error.

3. **Param-bound dim:** Double-click a parameter-bound dimension label. Confirm **no inline input appears**, and a toast referencing the Parameters panel is shown.

4. **Undo:** Edit a dimension, then press Ctrl+Z. Confirm the old value is restored and the geometry reverts.

5. **Angle dim (manual):** If a `dim-angle` constraint can be created via the DimensionDialog, edit it inline. Confirm the stored value equals the entered degrees as-is (e.g., enter 45 → stored value `45`, NOT `Math.PI/4`). The GcsSystem worker handles the internal deg→rad conversion.

Read screenshots of the canvas before and after each edit. Written but unverified = not done.
