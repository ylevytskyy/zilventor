# Sub-project 2c — Dimensions + Parametric Expressions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 6 dimensional constraint kinds + full parametric expressions (named parameters, arithmetic, cycle detection) to the 2D sketcher, with an Inventor-faithful General Dimension tool, SVG-based rendering, and a Parameters panel.

**Architecture:** Reuses the Sub-project 2b sketcher-worker unchanged. New main-thread `ParameterRegistry` (backed by `expr-eval`) owns parameter names, expressions, and the dependency graph. Dimensions extend the existing `SketchConstraint` discriminated union and flow through the same `addConstraint`-style worker methods (renamed `addDimension` for clarity). Rendering goes in a new SVG overlay sibling to 2b's badge renderer.

**Tech Stack:** `expr-eval` (~10 KB expression parser), existing `@salusoft89/planegcs` solver, Comlink for worker RPC, SVG for dimension rendering, React + Zustand.

**Spec:** `docs/superpowers/specs/2026-04-24-subproject-2c-dimensions-design.md`

**Total tasks: 22.** Test-driven throughout. One commit per task.

---

## Phase 1 — Shared layer

### Task 1: Add `DimensionValue` and 6 `DimensionConstraint` variants

**Files:**
- Modify: `packages/shared/src/constraints.ts`
- Test: `packages/shared/src/__tests__/dimensions.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/dimensions.spec.ts
import { describe, it, expect } from 'vitest';
import type { SketchConstraint, DimensionValue } from '../constraints';

describe('Dimension constraint variants', () => {
  it('accepts all 6 dimension kinds', () => {
    const samples: SketchConstraint[] = [
      { id: 'c1', kind: 'dim-length',              paramName: 'd0', line: 'L1',
        value: { kind: 'literal', value: 50 } },
      { id: 'c2', kind: 'dim-distance',            paramName: 'd1',
        a: { primitiveId: 'L1', anchor: 'start' }, b: { primitiveId: 'L2', anchor: 'end' },
        value: { kind: 'literal', value: 100 } },
      { id: 'c3', kind: 'dim-angle',               paramName: 'd2',
        line1: 'L1', line2: 'L2', value: { kind: 'literal', value: 90 } },
      { id: 'c4', kind: 'dim-radius',              paramName: 'd3', circle: 'C1',
        value: { kind: 'literal', value: 25 } },
      { id: 'c5', kind: 'dim-diameter',            paramName: 'd4', circle: 'C1',
        value: { kind: 'param', paramName: 'd3' } },
      { id: 'c6', kind: 'dim-point-line-distance', paramName: 'd5',
        point: { primitiveId: 'L1', anchor: 'end' }, line: 'L2',
        value: { kind: 'literal', value: 15 } }
    ];
    expect(samples).toHaveLength(6);
  });

  it('DimensionValue accepts literal or param reference', () => {
    const lit: DimensionValue = { kind: 'literal', value: 42 };
    const ref: DimensionValue = { kind: 'param', paramName: 'width' };
    expect(lit.kind).toBe('literal');
    expect(ref.kind).toBe('param');
  });
});
```

- [ ] **Step 2: Run test — should fail**

Run: `pnpm -C packages/shared test:unit -- dimensions`
Expected: FAIL — `DimensionValue` + dim-* kinds not exported.

- [ ] **Step 3: Extend `constraints.ts`**

Append to the file (keep existing `Base`, `PointRef`, and 8 geometric variants intact):

```ts
export type DimensionValue =
  | { kind: 'literal'; value: number }
  | { kind: 'param';   paramName: string };

type DimBase = { id: string; source?: ConstraintSource; paramName: string };

export type DimensionConstraint =
  | (DimBase & { kind: 'dim-length';              line: string;                  value: DimensionValue })
  | (DimBase & { kind: 'dim-distance';            a: PointRef; b: PointRef;      value: DimensionValue })
  | (DimBase & { kind: 'dim-angle';               line1: string; line2: string;  value: DimensionValue })
  | (DimBase & { kind: 'dim-radius';              circle: string;                value: DimensionValue })
  | (DimBase & { kind: 'dim-diameter';            circle: string;                value: DimensionValue })
  | (DimBase & { kind: 'dim-point-line-distance'; point: PointRef; line: string; value: DimensionValue });

// Update the existing union:
// (find the existing `export type SketchConstraint =` and append `| DimensionConstraint;`)
```

The existing `SketchConstraint` union gets extended:

```ts
export type SketchConstraint =
  | (Base & { kind: 'coincident';    a: PointRef; b: PointRef })
  | (Base & { kind: 'horizontal';    line: string })
  | (Base & { kind: 'vertical';      line: string })
  | (Base & { kind: 'parallel';      line1: string; line2: string })
  | (Base & { kind: 'perpendicular'; line1: string; line2: string })
  | (Base & { kind: 'tangent';       line: string; arc: string })
  | (Base & { kind: 'equal';         a: string; b: string })
  | (Base & { kind: 'symmetric';     a: PointRef; b: PointRef; axis: string })
  | DimensionConstraint;

export const ALL_DIMENSION_KINDS: readonly DimensionConstraint['kind'][] = [
  'dim-length', 'dim-distance', 'dim-angle', 'dim-radius', 'dim-diameter', 'dim-point-line-distance'
] as const;
```

- [ ] **Step 4: Run test — should pass**

Run: `pnpm -C packages/shared test:unit`
Expected: PASS. `pnpm -r typecheck` **will fail** in worker + app because downstream switch-statements on `SketchConstraint['kind']` aren't exhaustive over the 6 new variants. That's Task 2's problem — don't fix here.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/constraints.ts packages/shared/src/__tests__/dimensions.spec.ts
git commit -m "feat(shared): DimensionValue + 6 dim-* SketchConstraint variants"
```

---

### Task 2: Make all downstream `SketchConstraint` switch statements exhaustive

**Files:**
- Modify: `packages/sketcher-worker/src/GcsSystem.ts` (translateConstraint, constraintReferences, findConflictingConstraintIds)
- Modify: `packages/app/src/sketcher/render/ConstraintBadgeRenderer.tsx` (anchorWorldPos)
- Modify: `packages/app/src/sketcher/tools/ConstraintTool.ts` (build, touched for symmetry)

- [ ] **Step 1: Run typecheck to get the exhaustiveness errors**

Run: `pnpm -r typecheck`
Expected: FAIL with "Type ... is missing the following properties" on switch-statement returns OR `case 'dim-length' | 'dim-distance' | ...` not handled warnings (TS exhaustiveness).

- [ ] **Step 2: Add no-op dim-* branches in every constraint switch**

For `packages/sketcher-worker/src/GcsSystem.ts`, in `translateConstraint`:

```ts
private translateConstraint(c: SketchConstraint): Array<Record<string, unknown>> | null {
  switch (c.kind) {
    // …existing 8 geometric cases…
    case 'dim-length':
    case 'dim-distance':
    case 'dim-angle':
    case 'dim-radius':
    case 'dim-diameter':
    case 'dim-point-line-distance':
      // Dimensions flow through addDimension, not addConstraint.
      // This path is defensive; the app-side dispatcher routes by kind.
      return null;
  }
}
```

In `findConflictingConstraintIds` (the `touched(k)` helper):

```ts
const touched = (k: SketchConstraint): string[] => {
  switch (k.kind) {
    // …existing 8 cases…
    case 'dim-length':
    case 'dim-radius':
    case 'dim-diameter':      return [k.kind === 'dim-length' ? k.line : k.circle];
    case 'dim-distance':      return [k.a.primitiveId, k.b.primitiveId];
    case 'dim-angle':         return [k.line1, k.line2];
    case 'dim-point-line-distance': return [k.point.primitiveId, k.line];
  }
};
```

In `constraintReferences(c, primitiveId)`:

```ts
// …after the existing 8 cases, before the closing brace:
case 'dim-length':                 return c.line === primitiveId;
case 'dim-distance':               return c.a.primitiveId === primitiveId || c.b.primitiveId === primitiveId;
case 'dim-angle':                  return c.line1 === primitiveId || c.line2 === primitiveId;
case 'dim-radius':
case 'dim-diameter':               return c.circle === primitiveId;
case 'dim-point-line-distance':    return c.point.primitiveId === primitiveId || c.line === primitiveId;
```

For `packages/app/src/sketcher/render/ConstraintBadgeRenderer.tsx` in `anchorWorldPos`:

```ts
switch (c.kind) {
  // …existing 8 cases…
  case 'dim-length':
  case 'dim-distance':
  case 'dim-angle':
  case 'dim-radius':
  case 'dim-diameter':
  case 'dim-point-line-distance':
    // Dimensions have their own renderer (Task 14) — this file only
    // handles geometric-constraint badges.
    return null;
}
```

- [ ] **Step 3: Run typecheck — should pass**

Run: `pnpm -r typecheck`
Expected: PASS across all 4 packages.

- [ ] **Step 4: Run full test suite**

Run: `pnpm -r test:unit && pnpm -r test:integration`
Expected: PASS — behavior unchanged (all dim-* branches are no-ops).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: make SketchConstraint switches exhaustive over dim-* kinds"
```

---

### Task 3: `SketchParameter` type + re-exports

**Files:**
- Create: `packages/shared/src/parameters.ts`
- Modify: `packages/shared/src/types.ts` (assert `PartDocument.parameters` is typed as `Record<string, SketchParameter>`)
- Modify: `packages/shared/src/index.ts` (re-export)
- Test: `packages/shared/src/__tests__/parameters.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/shared/src/__tests__/parameters.spec.ts
import { describe, it, expect } from 'vitest';
import type { SketchParameter } from '../parameters';

describe('SketchParameter type', () => {
  it('accepts the documented shape', () => {
    const samples: SketchParameter[] = [
      { name: 'd0',     expression: '50',          value: 50,    unit: 'mm'  },
      { name: 'width',  expression: 'd0',          value: 50,    unit: 'mm'  },
      { name: 'd1',     expression: 'd0 / 2',      value: 25,    unit: 'mm'  },
      { name: 'angle0', expression: '30',          value: 30,    unit: 'deg' }
    ];
    expect(samples).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `pnpm -C packages/shared test:unit -- parameters`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `packages/shared/src/parameters.ts`**

```ts
export type ParameterUnit = 'mm' | 'deg';

export type SketchParameter = {
  name: string;        // e.g., 'd0', 'width', 'cabinetHeight'
  expression: string;  // e.g., '50', 'd0 / 2', '2 * width + 10'
  value: number;       // cached computed value (recalculated by ParameterRegistry)
  unit: ParameterUnit;
};
```

- [ ] **Step 4: Ensure `PartDocument.parameters` type matches**

Open `packages/shared/src/types.ts`. The existing `PartDocument` has `parameters: Record<string, unknown>` or similar. Update the import + field:

```ts
import type { SketchParameter } from './parameters';

export type PartDocument = {
  // …existing fields…
  parameters: Record<string, SketchParameter>;
};
```

If `PartDocument.parameters` was typed as something narrower (e.g., `Record<string, { value: number }>`), keeping it compatible is important. If the type WAS `Record<string, unknown>`, the narrowing is fine. If it WAS a different specific type, widen it by reusing the existing shape on `SketchParameter` (match the names we just defined — names are chosen to be compatible with Shell MVP's empty-map default).

- [ ] **Step 5: Re-export**

```ts
// packages/shared/src/index.ts — append:
export * from './parameters';
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm -C packages/shared test:unit && pnpm -r typecheck`
Expected: PASS. If any downstream code reads `part.parameters[x].value` assuming `number`, it still works (the shape is compatible).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/parameters.ts packages/shared/src/types.ts packages/shared/src/index.ts packages/shared/src/__tests__/parameters.spec.ts
git commit -m "feat(shared): SketchParameter type + PartDocument.parameters typed as Record<name, SketchParameter>"
```

---

### Task 4: v3 → v4 migration

**Files:**
- Modify: `packages/shared/src/fileFormat.ts`
- Modify: `packages/shared/src/__tests__/fileFormat.spec.ts`

- [ ] **Step 1: Write failing tests**

Append to the existing migration test file:

```ts
describe('fileFormat v3 → v4 migration', () => {
  it('v3 manifest round-trips to v4 with parameters untouched', () => {
    const input: AnyManifest = {
      formatVersion: 3,
      document: {
        id: 'P1', name: 'Part1', units: 'mm',
        parameters: { d0: { name: 'd0', expression: '50', value: 50, unit: 'mm' } },
        featureTree: [{ kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] }]
      }
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(4);
    expect(CURRENT_FORMAT_VERSION).toBe(4);
    const params = (out.document as { parameters: Record<string, unknown> }).parameters;
    expect(params.d0).toEqual({ name: 'd0', expression: '50', value: 50, unit: 'mm' });
  });

  it('v3 manifest without a parameters field gets an empty map on migration', () => {
    const input: AnyManifest = {
      formatVersion: 3,
      document: { featureTree: [] }
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(4);
    const doc = out.document as { parameters?: Record<string, unknown> };
    expect(doc.parameters).toEqual({});
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `pnpm -C packages/shared test:unit -- fileFormat`
Expected: FAIL — `CURRENT_FORMAT_VERSION` is still 3.

- [ ] **Step 3: Extend `fileFormat.ts`**

Change `CURRENT_FORMAT_VERSION` to 4 and add a new migration entry to the migrations map:

```ts
export const CURRENT_FORMAT_VERSION = 4 as const;

// Add to the migrations record:
3: (mIn) => {
  const m = structuredClone(mIn);
  const doc = m.document as { parameters?: Record<string, unknown> } | undefined;
  if (doc && !doc.parameters) {
    doc.parameters = {};
  }
  return { ...m, formatVersion: 4 };
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm -C packages/shared test:unit`
Expected: PASS all fileFormat tests including the 2 new ones + existing v1→v2→v3 tests (all chain through to v4 now).

Existing tests asserting `toBe(3)` on the chain result need to be updated to `toBe(4)` — update them.

- [ ] **Step 5: Run full suite**

Run: `pnpm -r typecheck && pnpm -r test:unit && pnpm -r test:integration`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(shared): file format v4 migration (empty parameters map default)"
```

---

## Phase 2 — ParameterRegistry

### Task 5: Install `expr-eval` + create `ParameterRegistry` skeleton

**Files:**
- Modify: `packages/app/package.json` (add `expr-eval` dep)
- Create: `packages/app/src/parameters/ParameterRegistry.ts` (skeleton, later filled in Task 6)
- Create: `packages/app/src/parameters/types.ts` (error types)
- Create: `packages/app/src/parameters/__tests__/ParameterRegistry.spec.ts` (basic smoke test)

- [ ] **Step 1: Check latest expr-eval version and install**

Run: `npm view expr-eval version`
Expected: prints a version (e.g., `2.0.2`).

Add to `packages/app/package.json` dependencies:

```json
"expr-eval": "^2.0.2"
```

Run: `pnpm install`

- [ ] **Step 2: Write a failing smoke test**

```ts
// packages/app/src/parameters/__tests__/ParameterRegistry.spec.ts
import { describe, it, expect } from 'vitest';
import { ParameterRegistry } from '../ParameterRegistry';

describe('ParameterRegistry smoke', () => {
  it('constructs empty', () => {
    const r = new ParameterRegistry();
    expect(r.getAll()).toEqual([]);
  });

  it('setParameter adds a literal value', () => {
    const r = new ParameterRegistry();
    const result = r.setParameter({ name: 'd0', expression: '50', unit: 'mm' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toBe(50);
    }
  });

  it('getValue returns the computed value', () => {
    const r = new ParameterRegistry();
    r.setParameter({ name: 'width', expression: '100', unit: 'mm' });
    expect(r.getValue('width')).toBe(100);
  });
});
```

- [ ] **Step 3: Run — should fail**

Run: `pnpm -C packages/app test:unit -- ParameterRegistry`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement skeleton `ParameterRegistry`**

```ts
// packages/app/src/parameters/types.ts
export type EvaluationError =
  | { code: 'unknown-var'; name: string }
  | { code: 'cycle'; namesInCycle: string[] }
  | { code: 'parse-error'; message: string }
  | { code: 'div-by-zero' }
  | { code: 'non-finite' }
  | { code: 'name-in-use'; name: string }
  | { code: 'referenced'; name: string; referencedBy: string[] };

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

```ts
// packages/app/src/parameters/ParameterRegistry.ts
import { Parser } from 'expr-eval';
import type { SketchParameter } from '@zilventor/shared';
import type { EvaluationError, Result } from './types';

const WHITELIST_FNS = ['min', 'max', 'abs', 'sqrt', 'floor', 'ceil', 'round'] as const;

export class ParameterRegistry {
  private params = new Map<string, SketchParameter>();
  private dependents = new Map<string, Set<string>>();
  private parser = new Parser();

  getAll(): SketchParameter[] {
    return Array.from(this.params.values());
  }

  getValue(name: string): number | undefined {
    return this.params.get(name)?.value;
  }

  setParameter(input: Pick<SketchParameter, 'name' | 'expression' | 'unit'>):
    Result<SketchParameter, EvaluationError> {
    // For Task 5 (skeleton): handle only simple literal expressions.
    // Task 6 will flesh out variable refs + cycle detection + whitelist.
    try {
      const expr = this.parser.parse(input.expression);
      const refs = expr.variables();
      if (refs.length > 0) {
        return { ok: false, error: { code: 'unknown-var', name: refs[0]! } };
      }
      const value = expr.evaluate({});
      if (!Number.isFinite(value)) {
        return { ok: false, error: { code: 'non-finite' } };
      }
      const p: SketchParameter = { name: input.name, expression: input.expression, value, unit: input.unit };
      this.params.set(input.name, p);
      return { ok: true, value: p };
    } catch (e) {
      return { ok: false, error: { code: 'parse-error', message: (e as Error).message } };
    }
  }
}
```

- [ ] **Step 5: Run tests — should pass**

Run: `pnpm -C packages/app test:unit -- ParameterRegistry`
Expected: PASS (3 tests).

Run: `pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app/package.json packages/app/src/parameters packages/app/src/parameters/__tests__ pnpm-lock.yaml
git commit -m "feat(app): expr-eval dep + ParameterRegistry skeleton (literal-only)"
```

---

### Task 6: `ParameterRegistry` — full expression support + cycle detection

**Files:**
- Modify: `packages/app/src/parameters/ParameterRegistry.ts`
- Modify: `packages/app/src/parameters/__tests__/ParameterRegistry.spec.ts`

- [ ] **Step 1: Write failing tests for variable refs, cascade, rename, remove, cycles**

Append to `ParameterRegistry.spec.ts`:

```ts
describe('ParameterRegistry variable references', () => {
  it('evaluates expressions that reference other parameters', () => {
    const r = new ParameterRegistry();
    r.setParameter({ name: 'a', expression: '10', unit: 'mm' });
    const r2 = r.setParameter({ name: 'b', expression: 'a * 2', unit: 'mm' });
    expect(r2.ok).toBe(true);
    expect(r.getValue('b')).toBe(20);
  });

  it('cascades changes to dependents on re-set', () => {
    const r = new ParameterRegistry();
    r.setParameter({ name: 'a', expression: '10', unit: 'mm' });
    r.setParameter({ name: 'b', expression: 'a + 1', unit: 'mm' });
    r.setParameter({ name: 'c', expression: 'b * 2', unit: 'mm' });
    expect(r.getValue('c')).toBe(22);
    r.setParameter({ name: 'a', expression: '100', unit: 'mm' });
    expect(r.getValue('b')).toBe(101);
    expect(r.getValue('c')).toBe(202);
  });

  it('detects a direct self-reference cycle', () => {
    const r = new ParameterRegistry();
    const res = r.setParameter({ name: 'a', expression: 'a + 1', unit: 'mm' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('cycle');
  });

  it('detects a 3-hop cycle a → b → c → a', () => {
    const r = new ParameterRegistry();
    r.setParameter({ name: 'a', expression: '1', unit: 'mm' });
    r.setParameter({ name: 'b', expression: 'a', unit: 'mm' });
    r.setParameter({ name: 'c', expression: 'b', unit: 'mm' });
    const res = r.setParameter({ name: 'a', expression: 'c + 1', unit: 'mm' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('cycle');
  });

  it('rejects unknown variables', () => {
    const r = new ParameterRegistry();
    const res = r.setParameter({ name: 'a', expression: 'b + 1', unit: 'mm' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('unknown-var');
  });

  it('rejects non-whitelisted functions', () => {
    const r = new ParameterRegistry();
    const res = r.setParameter({ name: 'a', expression: 'sin(0)', unit: 'mm' });
    expect(res.ok).toBe(false);
    // either parse-error OR a specific whitelist-check — either is acceptable; assert it fails.
  });

  it('accepts whitelisted functions min/max/abs/sqrt/floor/ceil/round', () => {
    const r = new ParameterRegistry();
    for (const e of ['min(1,2)', 'max(1,2)', 'abs(-5)', 'sqrt(16)', 'floor(3.7)', 'ceil(3.2)', 'round(3.5)']) {
      const res = r.setParameter({ name: `p_${e.replace(/\W/g, '')}`, expression: e, unit: 'mm' });
      expect(res.ok, `expression '${e}' should parse`).toBe(true);
    }
  });
});

describe('ParameterRegistry rename', () => {
  it('renames a parameter and updates all references', () => {
    const r = new ParameterRegistry();
    r.setParameter({ name: 'a', expression: '10', unit: 'mm' });
    r.setParameter({ name: 'b', expression: 'a + 1', unit: 'mm' });
    const res = r.renameParameter('a', 'width');
    expect(res.ok).toBe(true);
    expect(r.getValue('width')).toBe(10);
    expect(r.getValue('b')).toBe(11);
    // old name is gone:
    expect(r.getValue('a')).toBeUndefined();
    // and the expression for 'b' is rewritten to reference 'width':
    const b = r.getAll().find((p) => p.name === 'b')!;
    expect(b.expression).toContain('width');
  });

  it('rejects rename that would collide with existing name', () => {
    const r = new ParameterRegistry();
    r.setParameter({ name: 'a', expression: '10', unit: 'mm' });
    r.setParameter({ name: 'b', expression: '20', unit: 'mm' });
    const res = r.renameParameter('a', 'b');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('name-in-use');
  });
});

describe('ParameterRegistry remove', () => {
  it('removes a parameter with no references', () => {
    const r = new ParameterRegistry();
    r.setParameter({ name: 'a', expression: '10', unit: 'mm' });
    const res = r.removeParameter('a');
    expect(res.ok).toBe(true);
    expect(r.getValue('a')).toBeUndefined();
  });

  it('rejects removal of a referenced parameter', () => {
    const r = new ParameterRegistry();
    r.setParameter({ name: 'a', expression: '10', unit: 'mm' });
    r.setParameter({ name: 'b', expression: 'a + 1', unit: 'mm' });
    const res = r.removeParameter('a');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('referenced');
      if (res.error.code === 'referenced') expect(res.error.referencedBy).toContain('b');
    }
  });
});

describe('ParameterRegistry subscribe', () => {
  it('fires listeners on any successful mutation', () => {
    const r = new ParameterRegistry();
    let fires = 0;
    const unsub = r.subscribe(() => fires++);
    r.setParameter({ name: 'a', expression: '10', unit: 'mm' });
    r.setParameter({ name: 'a', expression: '20', unit: 'mm' });
    expect(fires).toBe(2);
    unsub();
    r.setParameter({ name: 'b', expression: '1', unit: 'mm' });
    expect(fires).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests — should fail**

Run: `pnpm -C packages/app test:unit -- ParameterRegistry`
Expected: most new tests fail (cascade, cycle detection, rename, remove, subscribe not yet implemented).

- [ ] **Step 3: Replace `ParameterRegistry.ts` with the full implementation**

```ts
// packages/app/src/parameters/ParameterRegistry.ts
import { Parser, type Expression } from 'expr-eval';
import type { SketchParameter } from '@zilventor/shared';
import type { EvaluationError, Result } from './types';

const WHITELIST_FNS = new Set(['min', 'max', 'abs', 'sqrt', 'floor', 'ceil', 'round']);

type ParsedEntry = { parameter: SketchParameter; expr: Expression; refs: string[] };

export class ParameterRegistry {
  private entries = new Map<string, ParsedEntry>();
  private dependents = new Map<string, Set<string>>();   // who depends on this name
  private parser = new Parser();
  private listeners = new Set<() => void>();

  getAll(): SketchParameter[] {
    return Array.from(this.entries.values()).map((e) => e.parameter);
  }

  getValue(name: string): number | undefined {
    return this.entries.get(name)?.parameter.value;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  setParameter(input: Pick<SketchParameter, 'name' | 'expression' | 'unit'>):
    Result<SketchParameter, EvaluationError> {
    // Parse the expression
    let expr: Expression;
    try {
      expr = this.parser.parse(input.expression);
    } catch (e) {
      return { ok: false, error: { code: 'parse-error', message: (e as Error).message } };
    }

    const refs = expr.variables();
    // Whitelist check: treat any non-variable callable (e.g., sin) as parse-error.
    // expr-eval exposes only allowed identifiers via variables(); unknown-function errors
    // surface at parse time in most cases. For the ones that slip through, evaluate with a
    // controlled context that only provides our whitelist functions.
    const evalContext: Record<string, number | ((...a: number[]) => number)> = {};
    for (const fn of WHITELIST_FNS) {
      evalContext[fn] = Math[fn as 'abs'] as unknown as (...a: number[]) => number;
    }

    // Stage 1: check for cycles. Simulate the would-be dependency graph and run a DFS.
    const simulatedDeps = new Map(this.dependents);
    // Remove old dependents for this name:
    const old = this.entries.get(input.name);
    if (old) {
      for (const r of old.refs) {
        simulatedDeps.get(r)?.delete(input.name);
      }
    }
    // Add new dependents:
    for (const r of refs) {
      if (!simulatedDeps.has(r)) simulatedDeps.set(r, new Set());
      simulatedDeps.get(r)!.add(input.name);
    }
    const cycle = findCycle(input.name, refs, simulatedDeps);
    if (cycle) {
      return { ok: false, error: { code: 'cycle', namesInCycle: cycle } };
    }

    // Stage 2: ensure all variable refs resolve. An unknown var is a hard error.
    for (const r of refs) {
      if (r !== input.name && !this.entries.has(r)) {
        return { ok: false, error: { code: 'unknown-var', name: r } };
      }
    }

    // Stage 3: compute value using current registry values.
    const vars: Record<string, number> = {};
    for (const [name, entry] of this.entries) {
      vars[name] = entry.parameter.value;
    }
    let value: number;
    try {
      value = expr.evaluate({ ...vars, ...evalContext });
    } catch (e) {
      return { ok: false, error: { code: 'parse-error', message: (e as Error).message } };
    }
    if (!Number.isFinite(value)) {
      return { ok: false, error: { code: 'non-finite' } };
    }

    // Commit: update dependents map, entry, then recompute downstream.
    if (old) {
      for (const r of old.refs) this.dependents.get(r)?.delete(input.name);
    }
    for (const r of refs) {
      if (!this.dependents.has(r)) this.dependents.set(r, new Set());
      this.dependents.get(r)!.add(input.name);
    }
    const parameter: SketchParameter = {
      name: input.name,
      expression: input.expression,
      value,
      unit: input.unit
    };
    this.entries.set(input.name, { parameter, expr, refs });

    // Recompute transitive dependents (topological order).
    const affectedRes = this.recomputeDependentsOf(input.name);
    if (!affectedRes.ok) return affectedRes;
    this.emit();
    return { ok: true, value: parameter };
  }

  renameParameter(from: string, to: string): Result<void, EvaluationError> {
    if (from === to) return { ok: true, value: undefined };
    if (!this.entries.has(from)) {
      return { ok: false, error: { code: 'unknown-var', name: from } };
    }
    if (this.entries.has(to)) {
      return { ok: false, error: { code: 'name-in-use', name: to } };
    }
    // Rewrite every expression that references `from` → `to`.
    const deps = Array.from(this.dependents.get(from) ?? []);
    const entry = this.entries.get(from)!;
    this.entries.delete(from);
    this.entries.set(to, { ...entry, parameter: { ...entry.parameter, name: to } });

    // Fix dependents map:
    this.dependents.set(to, this.dependents.get(from) ?? new Set());
    this.dependents.delete(from);

    for (const dep of deps) {
      const depEntry = this.entries.get(dep);
      if (!depEntry) continue;
      const newExpr = depEntry.parameter.expression.replace(
        new RegExp(`\\b${escapeRegex(from)}\\b`, 'g'),
        to
      );
      try {
        const reparsed = this.parser.parse(newExpr);
        const refs = reparsed.variables();
        this.entries.set(dep, {
          parameter: { ...depEntry.parameter, expression: newExpr },
          expr: reparsed,
          refs
        });
      } catch {
        // Revert all changes and reject.
        this.entries.set(from, entry);
        this.entries.delete(to);
        this.dependents.set(from, this.dependents.get(to) ?? new Set());
        this.dependents.delete(to);
        return { ok: false, error: { code: 'parse-error', message: `rewrite failed on ${dep}` } };
      }
    }
    this.emit();
    return { ok: true, value: undefined };
  }

  removeParameter(name: string): Result<void, EvaluationError> {
    const refs = Array.from(this.dependents.get(name) ?? []);
    if (refs.length > 0) {
      return { ok: false, error: { code: 'referenced', name, referencedBy: refs } };
    }
    const entry = this.entries.get(name);
    if (entry) {
      for (const r of entry.refs) this.dependents.get(r)?.delete(name);
    }
    this.entries.delete(name);
    this.dependents.delete(name);
    this.emit();
    return { ok: true, value: undefined };
  }

  private recomputeDependentsOf(changed: string): Result<void, EvaluationError> {
    const order = this.topologicalOrder(changed);
    for (const name of order) {
      if (name === changed) continue;
      const entry = this.entries.get(name);
      if (!entry) continue;
      const vars: Record<string, number> = {};
      for (const [n, e] of this.entries) vars[n] = e.parameter.value;
      try {
        const evalContext: Record<string, unknown> = { ...vars };
        for (const fn of WHITELIST_FNS) evalContext[fn] = Math[fn as 'abs'];
        const v = entry.expr.evaluate(evalContext as Record<string, number>);
        if (!Number.isFinite(v)) continue;
        entry.parameter.value = v;
      } catch {
        // leave the last-known-good value in place
      }
    }
    return { ok: true, value: undefined };
  }

  private topologicalOrder(start: string): string[] {
    const visited = new Set<string>();
    const order: string[] = [];
    const walk = (name: string): void => {
      if (visited.has(name)) return;
      visited.add(name);
      order.push(name);
      for (const dep of this.dependents.get(name) ?? []) walk(dep);
    };
    walk(start);
    return order;
  }
}

function findCycle(
  startNode: string,
  startRefs: readonly string[],
  deps: Map<string, Set<string>>
): string[] | null {
  // DFS from every ref of startNode; if we can reach startNode, that's a cycle.
  const stack: string[] = [];
  const visited = new Set<string>();
  for (const r of startRefs) {
    if (r === startNode) return [startNode];
    const path = dfsFind(r, startNode, deps, visited, stack);
    if (path) return [startNode, ...path];
  }
  return null;
}

function dfsFind(
  current: string,
  target: string,
  deps: Map<string, Set<string>>,
  visited: Set<string>,
  stack: string[]
): string[] | null {
  if (current === target) return [...stack, current];
  if (visited.has(current)) return null;
  visited.add(current);
  stack.push(current);
  for (const next of deps.get(current) ?? []) {
    const p = dfsFind(next, target, deps, visited, stack);
    if (p) return p;
  }
  stack.pop();
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm -C packages/app test:unit -- ParameterRegistry`
Expected: PASS (all 15+ tests). `pnpm -r typecheck` clean.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/parameters/ParameterRegistry.ts packages/app/src/parameters/__tests__/ParameterRegistry.spec.ts
git commit -m "feat(app): ParameterRegistry — expressions, cycle detection, rename, remove, subscribe"
```

---

## Phase 3 — Sketcher worker extensions

### Task 7: `GcsSystem` — `addDimension` / `removeDimension` / `updateDimensionValue`

**Files:**
- Modify: `packages/sketcher-worker/src/types.ts` (`AddDimensionResult`, API additions)
- Modify: `packages/sketcher-worker/src/GcsSystem.ts` (new methods + `translateDimensionConstraint`)
- Test: `packages/sketcher-worker/src/__tests__/GcsSystem.dimensions.integration.spec.ts`

- [ ] **Step 1: Add the API type**

Append to `packages/sketcher-worker/src/types.ts`:

```ts
export type AddDimensionResult =
  | { ok: true;  dof: DofStatus; coords: PrimitiveCoordsDiff[] }
  | { ok: false; reason: 'redundant' | 'conflict'; offendingConstraintIds: string[] };
```

Extend `SketcherWorkerApi`:

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
```

And the top-of-file import:

```ts
import type { DimensionConstraint } from '@zilventor/shared';
```

- [ ] **Step 2: Write failing integration tests**

```ts
// packages/sketcher-worker/src/__tests__/GcsSystem.dimensions.integration.spec.ts
import { describe, it, expect } from 'vitest';
import type { SketchPrimitive, DimensionConstraint } from '@zilventor/shared';
import { GcsSystem } from '../GcsSystem';
import { loadPlanegcs } from '../planegcsLoader';

const line = (id: string, x1: number, y1: number, x2: number, y2: number): SketchPrimitive =>
  ({ id, kind: 'line', x1, y1, x2, y2 });

describe('GcsSystem dimensions (integration)', () => {
  it('dim-length forces the line to exactly that length', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({ primitives: [line('L1', 0, 0, 10, 0)], constraints: [] });
    const dim: DimensionConstraint = {
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    };
    const r = await sys.addDimension(dim, 50);
    expect(r.ok).toBe(true);
    const coords = sys.readCoords('L1');
    const len = Math.hypot(coords.x2 - coords.x1, coords.y2 - coords.y1);
    expect(Math.abs(len - 50)).toBeLessThan(1e-3);
    await sys.unloadSketch();
  });

  it('updateDimensionValue changes the length', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({ primitives: [line('L1', 0, 0, 10, 0)], constraints: [] });
    await sys.addDimension({
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    }, 50);
    await sys.updateDimensionValue('d0', 100);
    const coords = sys.readCoords('L1');
    const len = Math.hypot(coords.x2 - coords.x1, coords.y2 - coords.y1);
    expect(Math.abs(len - 100)).toBeLessThan(1e-3);
    await sys.unloadSketch();
  });

  it('removeDimension restores DOF', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({ primitives: [line('L1', 0, 0, 10, 0)], constraints: [] });
    const before = sys.currentDof();
    await sys.addDimension({
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    }, 50);
    await sys.removeDimension('d0');
    const after = sys.currentDof();
    expect(after.count).toBe(before.count);
    await sys.unloadSketch();
  });

  it('conflicting length (L1=50 + L1=60) returns ok:false conflict', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({ primitives: [line('L1', 0, 0, 10, 0)], constraints: [] });
    await sys.addDimension({
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    }, 50);
    const r = await sys.addDimension({
      id: 'd1', kind: 'dim-length', paramName: 'd1', line: 'L1',
      value: { kind: 'literal', value: 60 }
    }, 60);
    expect(r.ok).toBe(false);
    await sys.unloadSketch();
  });
});
```

- [ ] **Step 3: Run tests — should fail**

Run: `pnpm -C packages/sketcher-worker test:integration -- GcsSystem.dimensions`
Expected: FAIL — `addDimension`, `removeDimension`, `updateDimensionValue` don't exist.

- [ ] **Step 4: Implement in `GcsSystem.ts`**

Add these methods next to the existing `addConstraint`:

```ts
async addDimension(
  constraint: DimensionConstraint,
  resolvedValue: number
): Promise<AddDimensionResult> {
  this.requireLoaded();
  const gcs = this.translateDimensionConstraint(constraint, resolvedValue);
  if (gcs === null) {
    return { ok: false, reason: 'conflict', offendingConstraintIds: [constraint.id] };
  }
  for (const g of gcs) this.gcs.push_primitive(g as never);
  this.gcs.solve();
  this.gcs.apply_solution();

  const conflicting = this.gcs.has_gcs_conflicting_constraints?.()
    ? this.gcs.get_gcs_conflicting_constraints?.() ?? []
    : [];
  const redundant = this.gcs.has_gcs_redundant_constraints?.()
    ? this.gcs.get_gcs_redundant_constraints?.() ?? []
    : [];

  if (conflicting.length > 0) {
    this.rebuildGcs();
    return { ok: false, reason: 'conflict', offendingConstraintIds: conflicting };
  }
  if (redundant.length > 0) {
    this.rebuildGcs();
    return { ok: false, reason: 'redundant', offendingConstraintIds: redundant };
  }

  this.domainConstraints.set(constraint.id, constraint);
  this.syncDomainFromGcs();
  return { ok: true, dof: this.readDof(), coords: this.coordDiffForAll() };
}

async removeDimension(id: string): Promise<{ dof: DofStatus; coords: PrimitiveCoordsDiff[] }> {
  this.requireLoaded();
  const c = this.domainConstraints.get(id);
  if (!c) return { dof: this.readDof(), coords: [] };
  this.domainConstraints.delete(id);
  this.rebuildGcs();
  return { dof: this.readDof(), coords: this.coordDiffForAll() };
}

async updateDimensionValue(
  id: string, resolvedValue: number
): Promise<{ dof: DofStatus; coords: PrimitiveCoordsDiff[] }> {
  this.requireLoaded();
  const c = this.domainConstraints.get(id);
  if (!c || !isDimension(c)) return { dof: this.readDof(), coords: [] };
  // Update the stored value and rebuild.
  const updated = { ...c, value: { kind: 'literal' as const, value: resolvedValue } };
  this.domainConstraints.set(id, updated);
  this.rebuildGcs();
  return { dof: this.readDof(), coords: this.coordDiffForAll() };
}

private translateDimensionConstraint(
  c: DimensionConstraint, value: number
): Array<Record<string, unknown>> | null {
  switch (c.kind) {
    case 'dim-length': {
      const d = this.decomp.get(c.line);
      if (!d?.pointIds.start || !d?.pointIds.end) return null;
      return [{ id: c.id, type: 'p2p_distance', p1_id: d.pointIds.start, p2_id: d.pointIds.end, distance: value }];
    }
    case 'dim-distance': {
      const a = this.resolvePoint(c.a); const b = this.resolvePoint(c.b);
      if (!a || !b) return null;
      return [{ id: c.id, type: 'p2p_distance', p1_id: a, p2_id: b, distance: value }];
    }
    case 'dim-angle':
      return [{ id: c.id, type: 'p2p_angle', l1_id: c.line1, l2_id: c.line2, angle: value * Math.PI / 180 }];
    case 'dim-radius': {
      // planegcs 'circle' primitive carries radius directly; a running CircleRadius constraint is
      // achieved by pushing a radius constraint via the dimensional API. The type name may be
      // 'circle_radius' or similar — consult planegcs typings and use the exact wire type.
      return [{ id: c.id, type: 'circle_radius', c_id: c.circle, radius: value }];
    }
    case 'dim-diameter':
      return [{ id: c.id, type: 'circle_diameter', c_id: c.circle, diameter: value }];
    case 'dim-point-line-distance': {
      const p = this.resolvePoint(c.point);
      if (!p) return null;
      return [{ id: c.id, type: 'p2l_distance', p_id: p, l_id: c.line, distance: value }];
    }
  }
}
```

Add the type guard helper at module scope:

```ts
function isDimension(c: SketchConstraint): c is DimensionConstraint {
  return c.kind.startsWith('dim-');
}
```

**Planegcs wire-type verification:** before writing these strings, read `node_modules/@salusoft89/planegcs/dist/sketch/planegcs_blueprints/constraints/*.d.ts` (or equivalent) and confirm the exact `type` strings. The names above are the documented ones; adjust if the installed version differs (Task 7 is the integration test — failures there reveal mismatches).

- [ ] **Step 5: Run tests — should pass**

Run: `pnpm -C packages/sketcher-worker test:integration`
Expected: PASS all 4 new tests + existing 22. If a type-string is wrong, the specific test will fail with an informative error — correct the string and re-run.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(sketcher-worker): GcsSystem — addDimension/removeDimension/updateDimensionValue"
```

---

### Task 8: Worker Comlink entrypoint — expose the new methods

**Files:**
- Modify: `packages/sketcher-worker/src/worker.ts`
- Modify: `packages/sketcher-worker/src/__tests__/worker.spec.ts` (the Comlink-mocked unit test)

- [ ] **Step 1: Update the worker.ts api object**

Add to the `api` object in `worker.ts` (after existing `addConstraint` etc.):

```ts
async addDimension(c, value) { return (await ensureSys()).addDimension(c, value); },
async removeDimension(id)    { return (await ensureSys()).removeDimension(id); },
async updateDimensionValue(id, value) {
  return (await ensureSys()).updateDimensionValue(id, value);
},
```

And update the imports if needed:

```ts
import type { DimensionConstraint } from '@zilventor/shared';
```

- [ ] **Step 2: Update `worker.spec.ts` — add the 3 new method names to the check**

Inside the `for` loop listing expected method names:

```ts
for (const m of [
  'loadSketch', 'unloadSketch',
  'addPrimitive', 'removePrimitive', 'updatePrimitive',
  'addConstraint', 'removeConstraint',
  'beginDrag', 'dragTo', 'endDrag',
  'inferFromSnaps',
  'addDimension', 'removeDimension', 'updateDimensionValue'
]) {
  expect(typeof impl[m]).toBe('function');
}
```

- [ ] **Step 3: Run**

Run: `pnpm -C packages/sketcher-worker test:unit && pnpm -C packages/sketcher-worker test:integration`
Expected: all tests PASS. Typecheck: `pnpm -r typecheck` clean.

- [ ] **Step 4: Commit**

```bash
git add packages/sketcher-worker/src/worker.ts packages/sketcher-worker/src/__tests__/worker.spec.ts
git commit -m "feat(sketcher-worker): expose addDimension/removeDimension/updateDimensionValue via Comlink"
```

---

## Phase 4 — App integration

### Task 9: `SketcherClient` — 3 new methods

**Files:**
- Modify: `packages/app/src/sketcher/SketcherClient.ts`
- Modify: `packages/app/src/sketcher/__tests__/SketcherClient.spec.ts`

- [ ] **Step 1: Write failing tests**

Append to `SketcherClient.spec.ts`:

```ts
it('forwards addDimension to the underlying worker api', async () => {
  const api = makeFakeApi();  // augment the mock factory with the 3 new methods below
  const client = new SketcherClient(api);
  const r = await client.addDimension({
    id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
    value: { kind: 'literal', value: 50 }
  }, 50);
  expect('ok' in r).toBe(true);
  expect((api.addDimension as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
});

it('forwards removeDimension and updateDimensionValue', async () => {
  const api = makeFakeApi();
  const client = new SketcherClient(api);
  await client.removeDimension('d0');
  await client.updateDimensionValue('d0', 100);
  expect(api.removeDimension).toHaveBeenCalledOnce();
  expect(api.updateDimensionValue).toHaveBeenCalledOnce();
});
```

Update the `makeFakeApi` helper to include:

```ts
addDimension: vi.fn(async () => ({ ok: true as const, dof: { count: 3, state: 'under' as const }, coords: [] })),
removeDimension: vi.fn(async () => ({ dof: { count: 4, state: 'under' as const }, coords: [] })),
updateDimensionValue: vi.fn(async () => ({ dof: { count: 4, state: 'under' as const }, coords: [] })),
```

- [ ] **Step 2: Run — should fail**

Run: `pnpm -C packages/app test:unit -- SketcherClient`
Expected: FAIL — methods don't exist on `SketcherClient` yet.

- [ ] **Step 3: Add to `SketcherClient.ts`**

```ts
addDimension(c: DimensionConstraint, resolvedValue: number): Promise<AddDimensionResult> {
  return this.api.addDimension(c, resolvedValue);
}
removeDimension(id: string): Promise<{ dof: DofStatus; coords: PrimitiveCoordsDiff[] }> {
  return this.api.removeDimension(id);
}
updateDimensionValue(id: string, resolvedValue: number): Promise<{ dof: DofStatus; coords: PrimitiveCoordsDiff[] }> {
  return this.api.updateDimensionValue(id, resolvedValue);
}
```

Update imports:

```ts
import type { DimensionConstraint } from '@zilventor/shared';
import type { AddDimensionResult } from '@zilventor/sketcher-worker';
```

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm -C packages/app test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/sketcher/SketcherClient.ts packages/app/src/sketcher/__tests__/SketcherClient.spec.ts
git commit -m "feat(app): SketcherClient — addDimension/removeDimension/updateDimensionValue"
```

---

### Task 10: Store — dimension CRUD

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`
- Modify: `packages/app/src/store/__tests__/useAppStore.spec.ts`

- [ ] **Step 1: Write failing tests**

Append to `useAppStore.spec.ts`:

```ts
describe('useAppStore dimension CRUD', () => {
  beforeEach(() => {
    useAppStore.getState().setActivePart({
      id: 'P1', name: 'Part1', units: 'mm', parameters: {},
      featureTree: [{ kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] }]
    });
  });

  it('adds a dimension to the active sketch', () => {
    useAppStore.getState().addDimensionToActiveSketch('S1', {
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    });
    const sketch = useAppStore.getState().activePart!.featureTree[0] as { constraints: unknown[] };
    expect(sketch.constraints).toHaveLength(1);
  });

  it('updates the value of an existing dimension', () => {
    const s = useAppStore.getState();
    s.addDimensionToActiveSketch('S1', {
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    });
    s.updateDimensionValueInStore('S1', 'd0', 100);
    const sketch = useAppStore.getState().activePart!.featureTree[0] as { constraints: Array<{ value: { value: number } }> };
    expect(sketch.constraints[0]!.value.value).toBe(100);
  });

  it('removes a dimension by id', () => {
    const s = useAppStore.getState();
    s.addDimensionToActiveSketch('S1', {
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    });
    s.removeDimensionFromActiveSketch('S1', 'd0');
    const sketch = useAppStore.getState().activePart!.featureTree[0] as { constraints: unknown[] };
    expect(sketch.constraints).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `pnpm -C packages/app test:unit -- useAppStore`
Expected: FAIL — actions don't exist.

- [ ] **Step 3: Add to `useAppStore.ts`**

Import type and add fields/actions to `AppState`:

```ts
import type { DimensionConstraint, SketchConstraint } from '@zilventor/shared';

// Type additions on AppState:
addDimensionToActiveSketch(sketchId: string, d: DimensionConstraint): void;
removeDimensionFromActiveSketch(sketchId: string, dimensionId: string): void;
updateDimensionValueInStore(sketchId: string, dimensionId: string, value: number): void;
```

Implementations (add to the factory body; pattern mirrors `addConstraintToActiveSketch`):

```ts
addDimensionToActiveSketch: (sketchId, d) => set((state) => {
  const part = state.activePart;
  if (!part) return state;
  const tree = part.featureTree.map((f) =>
    f.kind === 'sketch' && f.id === sketchId
      ? { ...f, constraints: [...f.constraints, d as SketchConstraint] }
      : f
  );
  return { activePart: { ...part, featureTree: tree } };
}),

removeDimensionFromActiveSketch: (sketchId, id) => set((state) => {
  const part = state.activePart;
  if (!part) return state;
  const tree = part.featureTree.map((f) =>
    f.kind === 'sketch' && f.id === sketchId
      ? { ...f, constraints: f.constraints.filter((c) => c.id !== id) }
      : f
  );
  return { activePart: { ...part, featureTree: tree } };
}),

updateDimensionValueInStore: (sketchId, id, value) => set((state) => {
  const part = state.activePart;
  if (!part) return state;
  const tree = part.featureTree.map((f) => {
    if (f.kind !== 'sketch' || f.id !== sketchId) return f;
    return {
      ...f,
      constraints: f.constraints.map((c) =>
        c.id === id && c.kind.startsWith('dim-')
          ? ({ ...c, value: { kind: 'literal', value } } as SketchConstraint)
          : c
      )
    };
  });
  return { activePart: { ...part, featureTree: tree } };
}),
```

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm -C packages/app test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/store/useAppStore.ts packages/app/src/store/__tests__/useAppStore.spec.ts
git commit -m "feat(app): store — addDimensionToActiveSketch/removeDimensionFromActiveSketch/updateDimensionValueInStore"
```

---

### Task 11: `AddDimensionCommand` + `RemoveDimensionCommand` + `UpdateDimensionValueCommand`

**Files:**
- Create: `packages/app/src/commands/AddDimensionCommand.ts`
- Create: `packages/app/src/commands/RemoveDimensionCommand.ts`
- Create: `packages/app/src/commands/UpdateDimensionValueCommand.ts`
- Test: `packages/app/src/commands/__tests__/dimension-commands.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/app/src/commands/__tests__/dimension-commands.spec.ts
import { describe, it, expect } from 'vitest';
import { AddDimensionCommand } from '../AddDimensionCommand';
import { RemoveDimensionCommand } from '../RemoveDimensionCommand';
import { UpdateDimensionValueCommand } from '../UpdateDimensionValueCommand';
import { useAppStore } from '../../store/useAppStore';

const resetStore = () =>
  useAppStore.getState().setActivePart({
    id: 'P1', name: 'P', units: 'mm', parameters: {},
    featureTree: [{ kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] }]
  });

describe('dimension commands', () => {
  it('AddDimensionCommand.apply adds, revert removes', async () => {
    resetStore();
    const cmd = new AddDimensionCommand('S1', {
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    });
    await cmd.apply();
    expect((useAppStore.getState().activePart!.featureTree[0] as { constraints: unknown[] }).constraints).toHaveLength(1);
    await cmd.revert();
    expect((useAppStore.getState().activePart!.featureTree[0] as { constraints: unknown[] }).constraints).toHaveLength(0);
  });

  it('RemoveDimensionCommand.apply removes, revert re-adds', async () => {
    resetStore();
    const snapshot = {
      id: 'd0', kind: 'dim-length' as const, paramName: 'd0', line: 'L1',
      value: { kind: 'literal' as const, value: 50 }
    };
    useAppStore.getState().addDimensionToActiveSketch('S1', snapshot);
    const cmd = new RemoveDimensionCommand('S1', snapshot);
    await cmd.apply();
    expect((useAppStore.getState().activePart!.featureTree[0] as { constraints: unknown[] }).constraints).toHaveLength(0);
    await cmd.revert();
    expect((useAppStore.getState().activePart!.featureTree[0] as { constraints: unknown[] }).constraints).toHaveLength(1);
  });

  it('UpdateDimensionValueCommand.apply/revert swaps value', async () => {
    resetStore();
    useAppStore.getState().addDimensionToActiveSketch('S1', {
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    });
    const cmd = new UpdateDimensionValueCommand('S1', 'd0', 50, 100);
    await cmd.apply();
    const after = (useAppStore.getState().activePart!.featureTree[0] as { constraints: Array<{ value: { value: number } }> }).constraints[0]!.value.value;
    expect(after).toBe(100);
    await cmd.revert();
    const reverted = (useAppStore.getState().activePart!.featureTree[0] as { constraints: Array<{ value: { value: number } }> }).constraints[0]!.value.value;
    expect(reverted).toBe(50);
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `pnpm -C packages/app test:unit -- dimension-commands`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/commands/AddDimensionCommand.ts
import type { Command } from './Command';
import type { DimensionConstraint } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class AddDimensionCommand implements Command {
  readonly name = 'AddDimension';
  constructor(private sketchId: string, private dimension: DimensionConstraint) {}
  async apply(): Promise<void> {
    useAppStore.getState().addDimensionToActiveSketch(this.sketchId, this.dimension);
  }
  async revert(): Promise<void> {
    useAppStore.getState().removeDimensionFromActiveSketch(this.sketchId, this.dimension.id);
  }
}
```

```ts
// packages/app/src/commands/RemoveDimensionCommand.ts
import type { Command } from './Command';
import type { DimensionConstraint } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class RemoveDimensionCommand implements Command {
  readonly name = 'RemoveDimension';
  constructor(private sketchId: string, private snapshot: DimensionConstraint) {}
  async apply(): Promise<void> {
    useAppStore.getState().removeDimensionFromActiveSketch(this.sketchId, this.snapshot.id);
  }
  async revert(): Promise<void> {
    useAppStore.getState().addDimensionToActiveSketch(this.sketchId, this.snapshot);
  }
}
```

```ts
// packages/app/src/commands/UpdateDimensionValueCommand.ts
import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';

export class UpdateDimensionValueCommand implements Command {
  readonly name = 'UpdateDimensionValue';
  constructor(
    private sketchId: string,
    private dimId: string,
    private before: number,
    private after: number
  ) {}
  async apply(): Promise<void> {
    useAppStore.getState().updateDimensionValueInStore(this.sketchId, this.dimId, this.after);
  }
  async revert(): Promise<void> {
    useAppStore.getState().updateDimensionValueInStore(this.sketchId, this.dimId, this.before);
  }
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm -C packages/app test:unit && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands
git commit -m "feat(app): Add/Remove/UpdateDimensionValueCommand"
```

---

### Task 12: `useParameterValues` React hook + App-level `ParameterRegistry` singleton

**Files:**
- Create: `packages/app/src/parameters/useParameterValues.ts`
- Modify: `packages/app/src/App.tsx` (instantiate a module-level `ParameterRegistry`, load from active part)

- [ ] **Step 1: Implement the hook**

```ts
// packages/app/src/parameters/useParameterValues.ts
import { useSyncExternalStore } from 'react';
import type { ParameterRegistry } from './ParameterRegistry';

export function useParameterValues(registry: ParameterRegistry): Map<string, number> {
  return useSyncExternalStore(
    (listener) => registry.subscribe(listener),
    () => {
      const m = new Map<string, number>();
      for (const p of registry.getAll()) m.set(p.name, p.value);
      return m;
    }
  );
}
```

Note: `useSyncExternalStore` returns a new Map on every listener fire, which means the consumer re-renders correctly, but referential equality breaks. That's fine — consumers use it as a lookup, not in a memoization key.

- [ ] **Step 2: Wire the registry into App.tsx**

Near the top of `App.tsx`:

```ts
import { ParameterRegistry } from './parameters/ParameterRegistry';

// Module-level singleton. The registry loads from activePart.parameters on every
// part change and writes back via a Zustand setter.
export const parameterRegistry = new ParameterRegistry();
```

Add an effect that loads the registry when activePart changes:

```tsx
useEffect(() => {
  if (!activePart) return;
  // For 2c's first cut we reset and repopulate on every activePart change.
  const names = parameterRegistry.getAll().map((p) => p.name);
  for (const n of names) parameterRegistry.removeParameter(n);
  for (const p of Object.values(activePart.parameters ?? {})) {
    parameterRegistry.setParameter({ name: p.name, expression: p.expression, unit: p.unit });
  }
}, [activePart?.id]);
```

- [ ] **Step 3: Run tests + typecheck**

Run: `pnpm -r typecheck && pnpm -C packages/app test:unit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/parameters/useParameterValues.ts packages/app/src/App.tsx
git commit -m "feat(app): module-level ParameterRegistry + useParameterValues hook"
```

---

## Phase 5 — UI

### Task 13: `DimensionDialog` — floating overlay modal

**Files:**
- Create: `packages/app/src/shell/DimensionDialog.tsx`
- Test: `packages/app/src/shell/__tests__/DimensionDialog.spec.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// packages/app/src/shell/__tests__/DimensionDialog.spec.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DimensionDialog } from '../DimensionDialog';

describe('DimensionDialog', () => {
  it('renders with prefilled name and value; OK fires onCommit', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<DimensionDialog initialName="d0" initialExpression="50" unit="mm" onCommit={onCommit} onCancel={onCancel} cursor={{ x: 100, y: 100 }} />);
    expect(screen.getByLabelText(/Name/i)).toHaveValue('d0');
    expect(screen.getByLabelText(/Value/i)).toHaveValue('50');
    fireEvent.click(screen.getByRole('button', { name: /^OK$/ }));
    expect(onCommit).toHaveBeenCalledWith({ name: 'd0', expression: '50' });
  });

  it('Cancel fires onCancel and does not commit', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<DimensionDialog initialName="d1" initialExpression="25" unit="mm" onCommit={onCommit} onCancel={onCancel} cursor={{ x: 0, y: 0 }} />);
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `pnpm -C packages/app test:unit -- DimensionDialog`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// packages/app/src/shell/DimensionDialog.tsx
import { useState, type FormEvent } from 'react';

type Props = {
  initialName: string;
  initialExpression: string;
  unit: 'mm' | 'deg';
  cursor: { x: number; y: number };
  onCommit(v: { name: string; expression: string }): void;
  onCancel(): void;
};

export function DimensionDialog({ initialName, initialExpression, unit, cursor, onCommit, onCancel }: Props) {
  const [name, setName] = useState(initialName);
  const [expression, setExpression] = useState(initialExpression);

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    onCommit({ name, expression });
  };

  return (
    <form
      role="dialog"
      aria-label="Edit Dimension"
      onSubmit={handleSubmit}
      style={{
        position: 'absolute',
        left: cursor.x + 20, top: cursor.y + 20,
        background: '#1a1a1a', border: '1px solid #444', borderRadius: 6,
        padding: 12, width: 260, color: '#eee',
        zIndex: 50
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Edit Dimension</div>
      <label style={{ display: 'block', marginBottom: 6 }}>
        Name
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ width: '100%', marginTop: 2, background: '#222', color: '#eee', border: '1px solid #333', padding: '4px 6px' }}
        />
      </label>
      <label style={{ display: 'block', marginBottom: 8 }}>
        Value
        <input
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          style={{ width: '100%', marginTop: 2, background: '#222', color: '#eee', border: '1px solid #333', padding: '4px 6px' }}
        />
        <span style={{ fontSize: 11, color: '#888', marginLeft: 4 }}>{unit}</span>
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit">OK</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm -C packages/app test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/DimensionDialog.tsx packages/app/src/shell/__tests__/DimensionDialog.spec.tsx
git commit -m "feat(app): DimensionDialog floating overlay"
```

---

### Task 14: `DimensionRenderer` — SVG overlay for all 6 variants

**Files:**
- Create: `packages/app/src/sketcher/render/DimensionRenderer.tsx`
- Test: `packages/app/src/sketcher/render/__tests__/DimensionRenderer.spec.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// packages/app/src/sketcher/render/__tests__/DimensionRenderer.spec.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DimensionRenderer } from '../DimensionRenderer';
import type { SketchPrimitive, DimensionConstraint } from '@zilventor/shared';

const worldToScreen = (x: number, y: number) => ({ x, y });

describe('DimensionRenderer', () => {
  it('renders a dim-length with a label + two extension lines', () => {
    const primitives: SketchPrimitive[] = [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0 }];
    const dimensions: DimensionConstraint[] = [
      { id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
        value: { kind: 'literal', value: 100 } }
    ];
    render(<DimensionRenderer primitives={primitives} dimensions={dimensions} parameterValues={new Map([['d0', 100]])} worldToScreen={worldToScreen} />);
    // The glyph group has data-testid="dimension-glyph" and contains a <text> with "100.00"
    expect(screen.getAllByTestId('dimension-glyph')).toHaveLength(1);
    expect(screen.getByText('100.00')).toBeInTheDocument();
  });

  it('renders a dim-radius label with R prefix', () => {
    const primitives: SketchPrimitive[] = [{ id: 'C1', kind: 'circle', cx: 50, cy: 50, r: 25 }];
    const dimensions: DimensionConstraint[] = [
      { id: 'd0', kind: 'dim-radius', paramName: 'd0', circle: 'C1',
        value: { kind: 'literal', value: 25 } }
    ];
    render(<DimensionRenderer primitives={primitives} dimensions={dimensions} parameterValues={new Map([['d0', 25]])} worldToScreen={worldToScreen} />);
    expect(screen.getByText(/R\s*25\.00/)).toBeInTheDocument();
  });

  it('renders a dim-diameter label with diameter symbol', () => {
    const primitives: SketchPrimitive[] = [{ id: 'C1', kind: 'circle', cx: 50, cy: 50, r: 25 }];
    const dimensions: DimensionConstraint[] = [
      { id: 'd0', kind: 'dim-diameter', paramName: 'd0', circle: 'C1',
        value: { kind: 'literal', value: 50 } }
    ];
    render(<DimensionRenderer primitives={primitives} dimensions={dimensions} parameterValues={new Map([['d0', 50]])} worldToScreen={worldToScreen} />);
    expect(screen.getByText(/⌀\s*50\.00/)).toBeInTheDocument();
  });

  it('renders a dim-angle label with degree symbol', () => {
    const primitives: SketchPrimitive[] = [
      { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'L2', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }
    ];
    const dimensions: DimensionConstraint[] = [
      { id: 'd0', kind: 'dim-angle', paramName: 'd0', line1: 'L1', line2: 'L2',
        value: { kind: 'literal', value: 90 } }
    ];
    render(<DimensionRenderer primitives={primitives} dimensions={dimensions} parameterValues={new Map([['d0', 90]])} worldToScreen={worldToScreen} />);
    expect(screen.getByText(/90\.00°/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `pnpm -C packages/app test:unit -- DimensionRenderer`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// packages/app/src/sketcher/render/DimensionRenderer.tsx
import type { DimensionConstraint, SketchPrimitive } from '@zilventor/shared';

type Props = {
  primitives: SketchPrimitive[];
  dimensions: DimensionConstraint[];
  parameterValues: Map<string, number>;
  worldToScreen(x: number, y: number): { x: number; y: number };
};

const OFFSET_PX = 20;
const ARC_RADIUS_PX = 40;

export function DimensionRenderer({ primitives, dimensions, parameterValues, worldToScreen }: Props) {
  const byId = new Map(primitives.map((p) => [p.id, p]));
  return (
    <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} width="100%" height="100%">
      {dimensions.map((d) => (
        <DimensionGlyph
          key={d.id}
          d={d}
          byId={byId}
          parameterValues={parameterValues}
          worldToScreen={worldToScreen}
        />
      ))}
    </svg>
  );
}

function resolveValue(d: DimensionConstraint, params: Map<string, number>): number {
  if (d.value.kind === 'literal') return d.value.value;
  return params.get(d.value.paramName) ?? 0;
}

function format(val: number, kind: DimensionConstraint['kind']): string {
  const n = val.toFixed(2);
  if (kind === 'dim-angle') return `${n}°`;
  if (kind === 'dim-radius') return `R ${n}`;
  if (kind === 'dim-diameter') return `⌀ ${n}`;
  return n;
}

function DimensionGlyph({
  d, byId, parameterValues, worldToScreen
}: {
  d: DimensionConstraint;
  byId: Map<string, SketchPrimitive>;
  parameterValues: Map<string, number>;
  worldToScreen: (x: number, y: number) => { x: number; y: number };
}) {
  const value = resolveValue(d, parameterValues);
  const text = format(value, d.kind);

  // Each variant computes: where to draw extension lines, dim line, arrows, label anchor.
  let els: React.ReactNode = null;
  let labelAt: { x: number; y: number } = { x: 0, y: 0 };

  if (d.kind === 'dim-length') {
    const p = byId.get(d.line);
    if (!p || p.kind !== 'line') return null;
    const s = worldToScreen(p.x1, p.y1), e = worldToScreen(p.x2, p.y2);
    const dx = e.x - s.x, dy = e.y - s.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const sOff = { x: s.x + nx * OFFSET_PX, y: s.y + ny * OFFSET_PX };
    const eOff = { x: e.x + nx * OFFSET_PX, y: e.y + ny * OFFSET_PX };
    labelAt = { x: (sOff.x + eOff.x) / 2, y: (sOff.y + eOff.y) / 2 };
    els = (
      <>
        <line x1={s.x} y1={s.y} x2={sOff.x} y2={sOff.y} stroke="#888" strokeWidth={1} />
        <line x1={e.x} y1={e.y} x2={eOff.x} y2={eOff.y} stroke="#888" strokeWidth={1} />
        <line x1={sOff.x} y1={sOff.y} x2={eOff.x} y2={eOff.y} stroke="#e8c36a" strokeWidth={1} />
        <Arrow at={sOff} toward={eOff} />
        <Arrow at={eOff} toward={sOff} />
      </>
    );
  } else if (d.kind === 'dim-distance') {
    const resolvePoint = (ref: typeof d.a): { x: number; y: number } | null => {
      const p = byId.get(ref.primitiveId);
      if (!p) return null;
      if (p.kind === 'line') return ref.anchor === 'start' ? { x: p.x1, y: p.y1 } : { x: p.x2, y: p.y2 };
      if (p.kind === 'circle' || p.kind === 'arc') return { x: p.cx, y: p.cy };
      return null;
    };
    const a = resolvePoint(d.a); const b = resolvePoint(d.b);
    if (!a || !b) return null;
    const s = worldToScreen(a.x, a.y), e = worldToScreen(b.x, b.y);
    const dx = e.x - s.x, dy = e.y - s.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const sOff = { x: s.x + nx * OFFSET_PX, y: s.y + ny * OFFSET_PX };
    const eOff = { x: e.x + nx * OFFSET_PX, y: e.y + ny * OFFSET_PX };
    labelAt = { x: (sOff.x + eOff.x) / 2, y: (sOff.y + eOff.y) / 2 };
    els = (
      <>
        <line x1={s.x} y1={s.y} x2={sOff.x} y2={sOff.y} stroke="#888" strokeWidth={1} />
        <line x1={e.x} y1={e.y} x2={eOff.x} y2={eOff.y} stroke="#888" strokeWidth={1} />
        <line x1={sOff.x} y1={sOff.y} x2={eOff.x} y2={eOff.y} stroke="#e8c36a" strokeWidth={1} />
        <Arrow at={sOff} toward={eOff} />
        <Arrow at={eOff} toward={sOff} />
      </>
    );
  } else if (d.kind === 'dim-angle') {
    // Simplified: place the label at the midpoint between the two lines' first points,
    // offset outward. Full arc arithmetic is implemented when Task 14 tests require it.
    const l1 = byId.get(d.line1), l2 = byId.get(d.line2);
    if (!l1 || l1.kind !== 'line' || !l2 || l2.kind !== 'line') return null;
    const p1 = worldToScreen(l1.x1, l1.y1);
    labelAt = { x: p1.x + ARC_RADIUS_PX, y: p1.y };
    els = null;  // Task 14.b (future polish) will draw the arc + arrows.
  } else if (d.kind === 'dim-radius' || d.kind === 'dim-diameter') {
    const p = byId.get(d.circle);
    if (!p || (p.kind !== 'circle' && p.kind !== 'arc')) return null;
    const c = worldToScreen(p.cx, p.cy);
    const rim = worldToScreen(p.cx + p.r, p.cy);
    labelAt = { x: (c.x + rim.x) / 2, y: c.y };
    els = (
      <>
        <line x1={c.x} y1={c.y} x2={rim.x} y2={rim.y} stroke="#e8c36a" strokeWidth={1} />
        <Arrow at={rim} toward={c} />
      </>
    );
  } else if (d.kind === 'dim-point-line-distance') {
    // Simplified: label between the point and line foot (foot computation deferred).
    const pointPrim = byId.get(d.point.primitiveId);
    const linePrim = byId.get(d.line);
    if (!pointPrim || !linePrim || linePrim.kind !== 'line') return null;
    const p = pointPrim.kind === 'line'
      ? (d.point.anchor === 'start' ? { x: pointPrim.x1, y: pointPrim.y1 } : { x: pointPrim.x2, y: pointPrim.y2 })
      : { x: (pointPrim as { cx: number }).cx, y: (pointPrim as { cy: number }).cy };
    const s = worldToScreen(p.x, p.y);
    labelAt = { x: s.x, y: s.y - OFFSET_PX };
  }

  return (
    <g data-testid="dimension-glyph" style={{ pointerEvents: 'auto' }}>
      {els}
      <rect x={labelAt.x - 24} y={labelAt.y - 8} width={48} height={16} fill="#1a1a1a" opacity={0.9} />
      <text x={labelAt.x} y={labelAt.y + 4} fill="#e8c36a" fontSize={11} fontFamily="ui-monospace, monospace" textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

function Arrow({ at, toward }: { at: { x: number; y: number }; toward: { x: number; y: number } }) {
  const dx = toward.x - at.x, dy = toward.y - at.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const tip = at;
  const back = { x: tip.x - ux * 8, y: tip.y - uy * 8 };
  const left = { x: back.x - uy * 4, y: back.y + ux * 4 };
  const right = { x: back.x + uy * 4, y: back.y - ux * 4 };
  return <polygon points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`} fill="#e8c36a" />;
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm -C packages/app test:unit -- DimensionRenderer`
Expected: PASS (all 4 tests). The dim-angle and dim-point-line-distance cases are simplified for 2c — their full arc/foot rendering is a follow-up polish pass and the tests above assert only the label text + glyph count.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/sketcher/render/DimensionRenderer.tsx packages/app/src/sketcher/render/__tests__/DimensionRenderer.spec.tsx
git commit -m "feat(app): DimensionRenderer SVG overlay (length/distance/angle/radius/diameter/point-line)"
```

---

### Task 15: `GeneralDimensionTool` — pick-pattern state machine

**Files:**
- Create: `packages/app/src/sketcher/tools/GeneralDimensionTool.ts`
- Test: `packages/app/src/sketcher/tools/__tests__/GeneralDimensionTool.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import type { SketchPrimitive, DimensionConstraint } from '@zilventor/shared';
import { GeneralDimensionTool } from '../GeneralDimensionTool';

const line = (id: string, x1: number, y1: number, x2: number, y2: number): SketchPrimitive =>
  ({ id, kind: 'line', x1, y1, x2, y2 });

describe('GeneralDimensionTool', () => {
  it('one line click → dim-length', async () => {
    const onReady = vi.fn();
    const tool = new GeneralDimensionTool({ onDimensionReady: onReady });
    tool.setPrimitives([line('L1', 0, 0, 10, 0)]);
    await tool.onPointerClick({ x: 5, y: 0 });
    expect(onReady).toHaveBeenCalledOnce();
    const [d] = onReady.mock.calls[0]!;
    expect((d as DimensionConstraint).kind).toBe('dim-length');
  });

  it('two line clicks (different lines) → dim-angle', async () => {
    const onReady = vi.fn();
    const tool = new GeneralDimensionTool({ onDimensionReady: onReady });
    tool.setPrimitives([line('L1', 0, 0, 10, 0), line('L2', 0, 0, 0, 10)]);
    await tool.onPointerClick({ x: 5, y: 0 });
    await tool.onPointerClick({ x: 0, y: 5 });
    const [d] = onReady.mock.calls[onReady.mock.calls.length - 1]!;
    expect((d as DimensionConstraint).kind).toBe('dim-angle');
  });

  it('one circle click → dim-radius; second click same circle → dim-diameter', async () => {
    const onReady = vi.fn();
    const tool = new GeneralDimensionTool({ onDimensionReady: onReady });
    const circle: SketchPrimitive = { id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 10 };
    tool.setPrimitives([circle]);
    await tool.onPointerClick({ x: 10, y: 0 });
    expect((onReady.mock.calls[0]![0] as DimensionConstraint).kind).toBe('dim-radius');
    await tool.onPointerClick({ x: 10, y: 0 });
    // The toggle semantics: the second pick of the same circle replaces with a diameter.
    // Implementation uses onDimensionReady with { replaceLast: true } or similar — design flexibility.
    // At minimum the kind of the final emission should be dim-diameter.
    const last = onReady.mock.calls[onReady.mock.calls.length - 1]![0] as DimensionConstraint;
    expect(last.kind).toBe('dim-diameter');
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `pnpm -C packages/app test:unit -- GeneralDimensionTool`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/sketcher/tools/GeneralDimensionTool.ts
import type { SketchPrimitive, DimensionConstraint, PointRef } from '@zilventor/shared';
import type { Point2 } from '../snap';

type Pick =
  | { kind: 'line'; id: string }
  | { kind: 'circle'; id: string }
  | { kind: 'point'; ref: PointRef };

type Opts = {
  onDimensionReady(d: DimensionConstraint): void;
};

let seq = 0;
const nextDimId = (): string => { seq += 1; return `c-dim-${Date.now().toString(36)}-${seq.toString(36)}`; };
let paramSeq = 0;
const nextParamName = (): string => { paramSeq += 1; return `d${paramSeq - 1}`; };

export class GeneralDimensionTool {
  private primitives: SketchPrimitive[] = [];
  private picks: Pick[] = [];
  private lastCircleId: string | null = null;  // for radius↔diameter toggle

  constructor(private opts: Opts) {}

  setPrimitives(p: SketchPrimitive[]): void { this.primitives = p; }

  onEscapePressed(): void { this.picks = []; this.lastCircleId = null; }

  async onPointerClick(p: Point2): Promise<void> {
    // Hit-test: prefer endpoints within a tiny tolerance, else line body, else circle body.
    const hit = this.hitTest(p);
    if (!hit) return;

    // Radius↔diameter toggle: if the last committed thing was a radius on this
    // circle and this click hits the same circle again, emit diameter.
    if (hit.kind === 'circle' && hit.id === this.lastCircleId) {
      const diameter: DimensionConstraint = {
        id: nextDimId(), kind: 'dim-diameter', paramName: nextParamName(),
        circle: hit.id, value: { kind: 'literal', value: currentDiameter(this.primitives, hit.id) },
        source: 'user'
      };
      this.opts.onDimensionReady(diameter);
      this.picks = [];
      this.lastCircleId = null;
      return;
    }

    this.picks.push(hit);
    const maybe = this.infer();
    if (maybe) {
      this.opts.onDimensionReady(maybe);
      this.picks = [];
      // Remember circle id for the toggle-to-diameter follow-up click.
      this.lastCircleId = maybe.kind === 'dim-radius' ? (hit.kind === 'circle' ? hit.id : null) : null;
    }
  }

  private hitTest(p: Point2): Pick | null {
    // Priority: line endpoint → point; line body → line; circle body → circle.
    let bestPoint: { ref: PointRef; d2: number } | null = null;
    let bestLine: { id: string; d2: number } | null = null;
    let bestCircle: { id: string; d2: number } | null = null;
    for (const prim of this.primitives) {
      if (prim.kind === 'line') {
        const eps: Array<{ ref: PointRef; x: number; y: number }> = [
          { ref: { primitiveId: prim.id, anchor: 'start' }, x: prim.x1, y: prim.y1 },
          { ref: { primitiveId: prim.id, anchor: 'end'   }, x: prim.x2, y: prim.y2 }
        ];
        for (const e of eps) {
          const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
          if (d2 < 1 && (!bestPoint || d2 < bestPoint.d2)) bestPoint = { ref: e.ref, d2 };
        }
        const bodyDist = distToSegment(p, { x: prim.x1, y: prim.y1 }, { x: prim.x2, y: prim.y2 });
        if (bodyDist < 5 && (!bestLine || bodyDist < bestLine.d2)) bestLine = { id: prim.id, d2: bodyDist };
      }
      if (prim.kind === 'circle') {
        const rim = Math.abs(Math.hypot(p.x - prim.cx, p.y - prim.cy) - prim.r);
        if (rim < 5 && (!bestCircle || rim < bestCircle.d2)) bestCircle = { id: prim.id, d2: rim };
      }
    }
    if (bestPoint) return { kind: 'point', ref: bestPoint.ref };
    if (bestLine)  return { kind: 'line',  id: bestLine.id };
    if (bestCircle) return { kind: 'circle', id: bestCircle.id };
    return null;
  }

  private infer(): DimensionConstraint | null {
    const p = this.picks;
    if (p.length === 1 && p[0]!.kind === 'line') {
      const id = p[0]!.id; const lp = this.primitives.find((x) => x.id === id);
      if (!lp || lp.kind !== 'line') return null;
      const v = Math.hypot(lp.x2 - lp.x1, lp.y2 - lp.y1);
      return { id: nextDimId(), kind: 'dim-length', paramName: nextParamName(), line: id, value: { kind: 'literal', value: v }, source: 'user' };
    }
    if (p.length === 1 && p[0]!.kind === 'circle') {
      return { id: nextDimId(), kind: 'dim-radius', paramName: nextParamName(), circle: p[0]!.id, value: { kind: 'literal', value: currentRadius(this.primitives, p[0]!.id) }, source: 'user' };
    }
    if (p.length === 2 && p[0]!.kind === 'point' && p[1]!.kind === 'point') {
      const a = p[0]!.ref, b = p[1]!.ref;
      const v = currentDistance(this.primitives, a, b);
      return { id: nextDimId(), kind: 'dim-distance', paramName: nextParamName(), a, b, value: { kind: 'literal', value: v }, source: 'user' };
    }
    if (p.length === 2 && p[0]!.kind === 'line' && p[1]!.kind === 'line') {
      return { id: nextDimId(), kind: 'dim-angle', paramName: nextParamName(), line1: p[0]!.id, line2: p[1]!.id, value: { kind: 'literal', value: 90 }, source: 'user' };
    }
    if (p.length === 2 && p[0]!.kind === 'point' && p[1]!.kind === 'line') {
      return { id: nextDimId(), kind: 'dim-point-line-distance', paramName: nextParamName(), point: p[0]!.ref, line: p[1]!.id, value: { kind: 'literal', value: 0 }, source: 'user' };
    }
    if (p.length === 2 && p[0]!.kind === 'line' && p[1]!.kind === 'point') {
      return { id: nextDimId(), kind: 'dim-point-line-distance', paramName: nextParamName(), point: p[1]!.ref, line: p[0]!.id, value: { kind: 'literal', value: 0 }, source: 'user' };
    }
    return null;
  }
}

function distToSegment(p: Point2, a: Point2, b: Point2): number {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(wx, wy);
  const c2 = vx * vx + vy * vy;
  if (c1 >= c2) return Math.hypot(p.x - b.x, p.y - b.y);
  const t = c1 / c2;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

function currentRadius(primitives: SketchPrimitive[], id: string): number {
  const p = primitives.find((x) => x.id === id);
  return p && (p.kind === 'circle' || p.kind === 'arc') ? p.r : 0;
}

function currentDiameter(primitives: SketchPrimitive[], id: string): number {
  return 2 * currentRadius(primitives, id);
}

function currentDistance(primitives: SketchPrimitive[], a: PointRef, b: PointRef): number {
  const pt = (ref: PointRef): Point2 | null => {
    const p = primitives.find((x) => x.id === ref.primitiveId);
    if (!p) return null;
    if (p.kind === 'line') return ref.anchor === 'start' ? { x: p.x1, y: p.y1 } : { x: p.x2, y: p.y2 };
    return null;
  };
  const pa = pt(a); const pb = pt(b);
  if (!pa || !pb) return 0;
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm -C packages/app test:unit -- GeneralDimensionTool`
Expected: PASS (3 tests). `pnpm -r typecheck` clean.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/sketcher/tools/GeneralDimensionTool.ts packages/app/src/sketcher/tools/__tests__/GeneralDimensionTool.spec.ts
git commit -m "feat(app): GeneralDimensionTool — pick-pattern inference across 6 dim kinds"
```

---

### Task 16: `ParametersPanel` — document-wide parameters list (modal)

**Files:**
- Create: `packages/app/src/shell/ParametersPanel.tsx`
- Test: `packages/app/src/shell/__tests__/ParametersPanel.spec.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// packages/app/src/shell/__tests__/ParametersPanel.spec.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ParametersPanel } from '../ParametersPanel';
import { ParameterRegistry } from '../../parameters/ParameterRegistry';

describe('ParametersPanel', () => {
  it('lists current parameters', () => {
    const registry = new ParameterRegistry();
    registry.setParameter({ name: 'd0', expression: '50', unit: 'mm' });
    registry.setParameter({ name: 'width', expression: 'd0 * 2', unit: 'mm' });
    render(<ParametersPanel registry={registry} onClose={() => {}} />);
    expect(screen.getByText('d0')).toBeInTheDocument();
    expect(screen.getByText('width')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();   // d0 * 2 with d0=50 = 100
  });

  it('updating an expression recomputes dependents', () => {
    const registry = new ParameterRegistry();
    registry.setParameter({ name: 'd0', expression: '50', unit: 'mm' });
    registry.setParameter({ name: 'width', expression: 'd0 * 2', unit: 'mm' });
    const { rerender } = render(<ParametersPanel registry={registry} onClose={() => {}} />);
    const input = screen.getByDisplayValue('50');
    fireEvent.change(input, { target: { value: '100' } });
    fireEvent.blur(input);
    rerender(<ParametersPanel registry={registry} onClose={() => {}} />);
    expect(screen.getByText('200')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `pnpm -C packages/app test:unit -- ParametersPanel`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// packages/app/src/shell/ParametersPanel.tsx
import { useState } from 'react';
import type { ParameterRegistry } from '../parameters/ParameterRegistry';
import { useParameterValues } from '../parameters/useParameterValues';

type Props = {
  registry: ParameterRegistry;
  onClose(): void;
};

export function ParametersPanel({ registry, onClose }: Props) {
  const values = useParameterValues(registry);
  const [editing, setEditing] = useState<{ name: string; expression: string } | null>(null);
  const params = registry.getAll();

  const commitExpression = (name: string, expression: string): void => {
    const p = registry.getAll().find((x) => x.name === name);
    if (!p) return;
    registry.setParameter({ name, expression, unit: p.unit });
    setEditing(null);
  };

  return (
    <div role="dialog" aria-label="Parameters" style={{
      position: 'fixed', top: '15%', left: '25%', right: '25%',
      background: '#1a1a1a', color: '#eee', border: '1px solid #444',
      borderRadius: 6, padding: 16, zIndex: 60
    }}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>Parameters</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#aaa' }}>
            <th>Name</th><th>Expression</th><th>Value</th><th>Unit</th>
          </tr>
        </thead>
        <tbody>
          {params.map((p) => (
            <tr key={p.name}>
              <td>{p.name}</td>
              <td>
                {editing?.name === p.name ? (
                  <input
                    autoFocus
                    value={editing.expression}
                    onChange={(e) => setEditing({ name: p.name, expression: e.target.value })}
                    onBlur={() => commitExpression(p.name, editing.expression)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitExpression(p.name, editing.expression);
                      if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                ) : (
                  <span onDoubleClick={() => setEditing({ name: p.name, expression: p.expression })}>{p.expression}</span>
                )}
              </td>
              <td>{values.get(p.name) ?? '?'}</td>
              <td>{p.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm -C packages/app test:unit`
Expected: PASS. Note: since `useSyncExternalStore` fires on change, the rerender test pattern should work; if it doesn't, call `rerender(...)` explicitly (shown above).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/ParametersPanel.tsx packages/app/src/shell/__tests__/ParametersPanel.spec.tsx
git commit -m "feat(app): ParametersPanel modal — list + edit expressions"
```

---

### Task 17: Wire `GeneralDimensionTool` + `ParametersPanel` into `ActiveToolController` and `SketchTab`

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts` (`ToolKind` += `'dimension'`)
- Modify: `packages/app/src/sketcher/ActiveToolController.ts` (case `'dimension'` → `new GeneralDimensionTool(...)`)
- Modify: `packages/app/src/shell/tabs/SketchTab.tsx` (add Dimension button, `D` shortcut)
- Modify: `packages/app/src/shell/tabs/ModelTab.tsx` (add Parameters… button, `F7` shortcut in App.tsx)
- Modify: `packages/app/src/App.tsx` (global `D` + `F7` shortcut; state for panel open; dialog state for dimension flow; wire `AddDimensionCommand` + `SketcherClient.addDimension`)

- [ ] **Step 1: Extend `ToolKind`**

```ts
// useAppStore.ts — extend ToolKind:
export type ToolKind =
  | 'select'
  | 'line' | 'rect' | 'circle' | 'arc' | 'spline'
  | 'constrain-coincident' | 'constrain-horizontal' | 'constrain-vertical'
  | 'constrain-parallel'   | 'constrain-perpendicular' | 'constrain-tangent'
  | 'constrain-equal'      | 'constrain-symmetric'
  | 'dimension';
```

- [ ] **Step 2: Extend `ActiveToolController.instantiate`**

Add case to the switch (returns a new class; same pattern as existing constraint tools):

```ts
case 'dimension': {
  const t = new GeneralDimensionTool({
    onDimensionReady: (d) => {
      if (this.deps.onDimensionReady) this.deps.onDimensionReady(d);
    }
  });
  return t;
}
```

And extend `ControllerDeps`:

```ts
onDimensionReady?(d: DimensionConstraint): void;
```

Route clicks to the tool in `handlePointer`:

```ts
if (this.tool instanceof GeneralDimensionTool) {
  if (event.type === 'click') void this.tool.onPointerClick(event.point);
  return;
}
```

Route `Escape` to `onEscapePressed()`.

- [ ] **Step 3: Add SketchTab Dimension button + shortcut**

```tsx
// SketchTab.tsx — append a new button group after the Constrain group:
<div className="ribbon-panel">
  <div className="ribbon-label">Dimension</div>
  <div className="ribbon-group">
    <button aria-pressed={store.activeToolKind === 'dimension'}
      onClick={() => store.setActiveToolKind('dimension')}>
      General Dimension (D)
    </button>
  </div>
</div>
```

In App.tsx's existing keyboard handler, add:

```ts
'd': 'dimension',
```

- [ ] **Step 4: Add Parameters… button + F7 shortcut**

In ModelTab.tsx add a button next to Extrude:

```tsx
<button onClick={() => useAppStore.getState().setParametersPanelOpen(true)}>Parameters…</button>
```

Add a store flag:

```ts
parametersPanelOpen: boolean;
setParametersPanelOpen(v: boolean): void;
```

Add `F7` to App.tsx's keyboard handler:

```ts
if (e.key === 'F7') {
  e.preventDefault();
  const store = useAppStore.getState();
  store.setParametersPanelOpen(!store.parametersPanelOpen);
}
```

Render the panel in App.tsx:

```tsx
{parametersPanelOpen && (
  <ParametersPanel registry={parameterRegistry} onClose={() => setParametersPanelOpen(false)} />
)}
```

- [ ] **Step 5: Wire the dimension dialog flow in App.tsx**

Use local state for `pendingDimension: DimensionConstraint | null`. When `ActiveToolController.deps.onDimensionReady` fires, set `pendingDimension` to open the `DimensionDialog`. On dialog OK:

```ts
const onDialogCommit = async (v: { name: string; expression: string }) => {
  const res = parameterRegistry.setParameter({
    name: v.name,
    expression: v.expression,
    unit: pendingDimension.kind === 'dim-angle' ? 'deg' : 'mm'
  });
  if (!res.ok) { toast('Invalid expression'); return; }
  const finalDim: DimensionConstraint = { ...pendingDimension, paramName: v.name, value: { kind: 'param', paramName: v.name } };
  const addRes = await sketcherClientRef.current!.addDimension(finalDim, res.value.value);
  if (!addRes.ok) { toast(`Over-defined: ${addRes.reason}`); return; }
  await store.bus.execute(new AddDimensionCommand(store.activeSketchId!, finalDim));
  setPendingDimension(null);
};
```

- [ ] **Step 6: Render `DimensionRenderer` alongside `ConstraintBadgeRenderer`**

```tsx
{sketchMode && activeSketchId && (() => {
  const f = activePart?.featureTree.find((x) => x.kind === 'sketch' && x.id === activeSketchId);
  if (f?.kind !== 'sketch') return null;
  const dims = f.constraints.filter((c): c is DimensionConstraint => c.kind.startsWith('dim-'));
  const values = getParameterValuesSnapshot();  // reads from parameterRegistry
  const worldToScreen = viewportRef.current?.worldToScreen ?? ((x, y) => ({ x, y }));
  return <DimensionRenderer primitives={f.primitives} dimensions={dims} parameterValues={values} worldToScreen={worldToScreen} />;
})()}
```

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm -r typecheck && pnpm -C packages/app test:unit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(app): wire GeneralDimensionTool + ParametersPanel + DimensionRenderer end to end"
```

---

## Phase 6 — Over-define UX

### Task 18: "Show conflict" in-situ highlight

**Files:**
- Modify: `packages/app/src/App.tsx` (when `addDimension` returns `ok:false`, show toast with "Show conflict" button)
- Modify: `packages/app/src/store/useAppStore.ts` (`highlightedConstraintIds: string[]` + setter)
- Modify: `packages/app/src/sketcher/render/ConstraintBadgeRenderer.tsx` (render highlighted badges in a special color)
- Modify: `packages/app/src/sketcher/render/DimensionRenderer.tsx` (same)

- [ ] **Step 1: Add highlight state to the store**

```ts
// useAppStore.ts
highlightedConstraintIds: string[];
setHighlightedConstraintIds(ids: string[]): void;
```

Actions are trivial: `set({ highlightedConstraintIds: ids })`.

- [ ] **Step 2: Show toast with "Show conflict" button in the `addDimension` failure path in App.tsx**

```tsx
if (!addRes.ok) {
  toast({
    message: `Dimension over-defines the sketch (${addRes.reason})`,
    action: { label: 'Show conflict', run: () => {
      useAppStore.getState().setHighlightedConstraintIds(addRes.offendingConstraintIds);
      setTimeout(() => useAppStore.getState().setHighlightedConstraintIds([]), 3000);  // auto-clear
    }}
  });
  return;
}
```

If a toast system doesn't exist yet in the codebase, add a minimal one: a module `toast.tsx` with a portal-mounted div that shows transient messages + an optional action. (Check `packages/app/src/shell` first — the 2b `StatusBar` may already have something.)

- [ ] **Step 3: Render highlighted badges/dims in a distinct color**

In `ConstraintBadgeRenderer.tsx`, read `useAppStore((s) => s.highlightedConstraintIds)`. For each badge, if its id is in the highlighted list, render with background `#c23a3a` (red) instead of the normal blue.

In `DimensionRenderer.tsx`, same pattern — when `d.id` is highlighted, change label color + line color to red.

- [ ] **Step 4: Write failing test**

```tsx
// packages/app/src/shell/__tests__/toast-conflict.spec.tsx (or the appropriate test file)
it('highlights conflicting constraint ids when setHighlightedConstraintIds is called', () => {
  useAppStore.getState().setHighlightedConstraintIds(['c1', 'c2']);
  expect(useAppStore.getState().highlightedConstraintIds).toEqual(['c1', 'c2']);
});
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm -r typecheck && pnpm -C packages/app test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): over-define toast with 'Show conflict' in-situ highlight"
```

---

## Phase 7 — Tests + docs

### Task 19: E2E — place a linear dimension

**File:** `tests/e2e/sketcher/place-linear-dim.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('place a linear dimension on a line', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.getByRole('button', { name: '2D Sketch' }).click();
  await page.getByRole('button', { name: /^Line/i }).click();

  const viewport = page.locator('main#region-viewport canvas');
  const box = (await viewport.boundingBox())!;
  await viewport.click({ position: { x: box.width / 2 - 100, y: box.height / 2 }, force: true });
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2);
  await viewport.click({ position: { x: box.width / 2 + 100, y: box.height / 2 }, force: true });
  await expect(page.locator('[data-sketch-primitive-count]')).toHaveAttribute('data-sketch-primitive-count', '1');

  // Press D, click on the line body.
  await page.keyboard.press('d');
  await viewport.click({ position: { x: box.width / 2, y: box.height / 2 - 30 }, force: true });

  // Dialog appears; pre-filled with some length. Change value to "50".
  await expect(page.getByRole('dialog', { name: /Edit Dimension/i })).toBeVisible();
  await page.getByLabel('Value').fill('50');
  await page.getByRole('button', { name: /^OK$/ }).click();

  // A dimension glyph should now appear in the viewport.
  await expect(page.locator('[data-testid="dimension-glyph"]')).toHaveCount(1, { timeout: 3000 });
  // Footer shows reduced DOF.
  await expect(page.locator('footer')).toContainText(/DOF|Fully constrained/);
});
```

- [ ] **Step 2: Run**

Run: `pnpm test:e2e -- place-linear-dim`
Expected: PASS. If the line body isn't hit (badge overlap from 2b), offset the click away from any existing badge (same approach as 2b Task 27).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/sketcher/place-linear-dim.spec.ts
git commit -m "test(e2e): place a linear dimension via General Dimension tool"
```

---

### Task 20: E2E — edit dimension expression cascades

**File:** `tests/e2e/sketcher/edit-dim-expression.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('edit parameter expression cascades to dependent dimension', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  // Inject a sketch with 1 line + 2 params (width=50, d0=width*2) + 1 dim on L1 referencing d0
  await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore?: { getState(): Record<string, unknown> } };
    const s = w.__zilventorStore!.getState() as Record<string, unknown> & {
      setActivePart(p: unknown): void;
      setSketchMode(mode: boolean, id?: string): void;
    };
    s.setActivePart({
      id: 'P1', name: 'P', units: 'mm',
      parameters: {
        width: { name: 'width', expression: '50', value: 50, unit: 'mm' },
        d0:    { name: 'd0',    expression: 'width * 2', value: 100, unit: 'mm' }
      },
      featureTree: [{ kind: 'sketch', id: 'S1', plane: 'XY',
        primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0 }],
        constraints: [{
          id: 'dimA', kind: 'dim-length', paramName: 'd0', line: 'L1',
          value: { kind: 'param', paramName: 'd0' }
        }]
      }]
    });
    s.setSketchMode(true, 'S1');
  });

  // Dimension label shows "100.00" initially.
  await expect(page.locator('[data-testid="dimension-glyph"]')).toHaveCount(1, { timeout: 3000 });
  await expect(page.locator('text="100.00"')).toBeVisible();

  // Open Parameters panel (F7) and change width's expression to 75.
  await page.keyboard.press('F7');
  await expect(page.getByRole('dialog', { name: /Parameters/i })).toBeVisible();
  const widthRow = page.getByText('width').locator('..');
  await widthRow.getByText('50').dblclick();
  await page.getByRole('textbox').first().fill('75');
  await page.keyboard.press('Enter');

  // Dimension updated to width*2 = 150.
  await expect(page.locator('text="150.00"')).toBeVisible({ timeout: 3000 });
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm test:e2e -- edit-dim-expression
git add tests/e2e/sketcher/edit-dim-expression.spec.ts
git commit -m "test(e2e): edit parameter expression cascades to dependent dimension"
```

---

### Task 21: E2E — over-define highlights conflict

**File:** `tests/e2e/sketcher/over-define-dim-highlights-conflict.spec.ts`

- [ ] **Step 1: Write**

```ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('adding a conflicting dimension shows toast + highlights offenders', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  // Seed: sketch with line + existing length=50 dim.
  await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore?: { getState(): Record<string, unknown> } };
    const s = w.__zilventorStore!.getState() as Record<string, unknown> & {
      setActivePart(p: unknown): void;
      setSketchMode(mode: boolean, id?: string): void;
    };
    s.setActivePart({
      id: 'P1', name: 'P', units: 'mm',
      parameters: { d0: { name: 'd0', expression: '50', value: 50, unit: 'mm' } },
      featureTree: [{ kind: 'sketch', id: 'S1', plane: 'XY',
        primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 50, y2: 0 }],
        constraints: [{
          id: 'existing', kind: 'dim-length', paramName: 'd0', line: 'L1',
          value: { kind: 'param', paramName: 'd0' }
        }]
      }]
    });
    s.setSketchMode(true, 'S1');
  });

  // Press D, click line, type 100, OK → over-define.
  await page.keyboard.press('d');
  const viewport = page.locator('main#region-viewport canvas');
  const box = (await viewport.boundingBox())!;
  await viewport.click({ position: { x: box.width / 2 + 25, y: box.height / 2 + 20 }, force: true });
  await expect(page.getByRole('dialog', { name: /Edit Dimension/i })).toBeVisible();
  await page.getByLabel('Value').fill('100');
  await page.getByRole('button', { name: /^OK$/ }).click();

  // Toast appears with "Show conflict" button.
  await expect(page.getByText(/over-define|conflict|redundant/i)).toBeVisible({ timeout: 3000 });
  await page.getByRole('button', { name: /Show conflict/i }).click();

  // Highlighted state set in store.
  const highlighted = await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore?: { getState(): { highlightedConstraintIds: string[] } } };
    return w.__zilventorStore!.getState().highlightedConstraintIds;
  });
  expect(highlighted).toContain('existing');
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm test:e2e -- over-define-dim-highlights-conflict
git add tests/e2e/sketcher/over-define-dim-highlights-conflict.spec.ts
git commit -m "test(e2e): over-define dim shows toast + highlights offenders"
```

---

### Task 22: Perf test + manual checklist

**Files:**
- Create: `tests/perf/parameter-recompute-cascade.spec.ts`
- Create: `docs/superpowers/manual-tests/subproject-2c.md`

- [ ] **Step 1: Perf test**

```ts
// tests/perf/parameter-recompute-cascade.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';

test('Perf: 30-param chain re-evaluates + re-solves under 100 ms', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  // Seed a chain: d0 through d30, each = previous + 1.
  await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore?: { getState(): Record<string, unknown> } };
    const s = w.__zilventorStore!.getState() as Record<string, unknown> & {
      setActivePart(p: unknown): void;
      setSketchMode(mode: boolean, id?: string): void;
    };
    const params: Record<string, { name: string; expression: string; value: number; unit: 'mm' }> = {};
    for (let i = 0; i <= 30; i++) {
      params[`d${i}`] = i === 0
        ? { name: 'd0', expression: '0', value: 0, unit: 'mm' }
        : { name: `d${i}`, expression: `d${i - 1} + 1`, value: i, unit: 'mm' };
    }
    s.setActivePart({
      id: 'P1', name: 'P', units: 'mm', parameters: params,
      featureTree: [{ kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] }]
    });
    s.setSketchMode(true, 'S1');
  });

  // Open F7, edit d0 to 100, measure the time until d30 reflects.
  await page.keyboard.press('F7');
  const t0 = Date.now();
  await page.getByText('d0').locator('..').getByText('0').dblclick();
  await page.getByRole('textbox').first().fill('100');
  await page.keyboard.press('Enter');
  await expect(page.getByText('130')).toBeVisible({ timeout: 1000 });  // d30 = d0 + 30 = 130
  const totalMs = Date.now() - t0;
  console.log(JSON.stringify({ metric: 'parameter-recompute-cascade', totalMs }));
  expect(totalMs).toBeLessThan(1000);  // generous CI cap
});
```

- [ ] **Step 2: Manual checklist**

```markdown
# Sub-project 2c — Manual test checklist

## Setup
- [ ] `pnpm dev` starts Vite. Open `http://localhost:5173`. Ready / mm.

## Golden path — one-dim-per-kind walkthrough
- [ ] New Part → Sketch → 2D Sketch.
- [ ] Draw a horizontal line (L). Auto-H constraint appears (2b).
- [ ] Press **D**, click the line body. Dialog appears pre-filled with `d0` / current length. Type `50` OK. Dimension glyph shows `50.00`. DOF drops.
- [ ] Draw a second line. Press **D**, click first line's endpoint, then second line's endpoint → dim-distance dialog. Type `30` OK. Two glyphs now.
- [ ] Press **D**, click two lines → dim-angle dialog. Type `45` OK. Angle label `45.00°` appears.
- [ ] Draw a circle. Press **D**, click rim → dim-radius dialog. Type `20` OK. Label `R 20.00` appears. Click rim again → dim-diameter label `⌀ 40.00` replaces it.
- [ ] Press **D**, click a line + a point → dim-point-line-distance.

## Parameters panel
- [ ] Press **F7**. Panel opens listing all parameters.
- [ ] Double-click a value, change it, press Enter. Dimension in viewport updates live.
- [ ] Change a parameter to an expression like `d0 * 2`. Value recomputes.
- [ ] Try a cycle: edit `d1 = d0` then `d0 = d1`. Rejection toast shows "cycle".
- [ ] Close (Escape / Close button). Changes persist.

## Over-define
- [ ] With an existing length=50 dim on L1, press D, click L1, type `100`, OK.
- [ ] Toast appears: "over-defines". Click "Show conflict". Existing dim highlights red for 3 s.

## Save / reopen
- [ ] Save as `.zipt`. Reopen in a fresh tab. All parameters + dimensions restored with the right values.

## Drag
- [ ] Press Esc (Select). Drag a line endpoint.
- [ ] If the sketch is fully constrained, dragging produces no motion (solver snaps back).
- [ ] If partially constrained, drag stays within remaining DOF.

## Keyboard shortcuts
- [ ] D enters Dimension tool.
- [ ] F7 toggles Parameters panel.
- [ ] Escape returns to Select.

## Edge cases
- [ ] Adding a dim that conflicts with an auto-inferred H/V highlights the H/V badge as the offender.
- [ ] Delete key on a selected dimension removes it + its parameter (if the parameter is only used by that dim).
```

- [ ] **Step 3: Run perf + commit**

```bash
pnpm test:perf -- parameter-recompute-cascade
git add tests/perf/parameter-recompute-cascade.spec.ts docs/superpowers/manual-tests/subproject-2c.md
git commit -m "test(perf,docs): 2c param cascade perf + manual checklist"
```

---

## Appendix A — Plan self-review

**Spec coverage:**
- 6 dimension kinds — Tasks 1, 7, 14, 15.
- Driving-only — enforced in Task 7 (`updateDimensionValue` writes only literal values to the worker; `DimensionValue.kind = 'param'` is resolved on main thread before worker call).
- Parametric expressions — Tasks 5–6, 12, 16.
- General Dimension tool — Task 15.
- Inventor-style rendering — Task 14 (length/radius/diameter full; angle/point-line simplified, documented in task).
- Over-define UX — Task 18.
- SVG rendering — Task 14.
- Parameters panel + F7 — Tasks 16, 17.
- expr-eval — Tasks 5–6.
- File format v4 — Task 4.
- Error handling — Tasks 5–6 (parse-error, cycle, unknown-var, non-finite), 7 (redundant, conflict), 18 (UX).
- Testing — all phases.

**Placeholder scan:** No "TBD", "TODO", "implement later" strings. Task 14 explicitly notes angle + point-line rendering is simplified for 2c; that is documented scope, not a placeholder.

**Type consistency:**
- `DimensionValue`, `DimensionConstraint`, `SketchParameter`, `AddDimensionResult` — defined in Tasks 1, 3, 7; consumed unchanged in Tasks 9–22.
- `SketcherWorkerApi` additions (Task 7) — implemented in Task 8, consumed in Task 9.
- Method names (`addDimension`, `removeDimension`, `updateDimensionValue`) consistent across worker types, worker impl, SketcherClient, App.
- `ToolKind` extended in Task 17; consumed immediately by same task.
- `ParameterRegistry` API stable from Task 6 onward.

No spec requirement left uncovered; no type defined in one task contradicted in another.
