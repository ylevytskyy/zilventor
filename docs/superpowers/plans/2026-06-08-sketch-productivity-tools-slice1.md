# Sketch Productivity Tools — Slice 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use superpowers:test-driven-development for every task. Plan code snippets are **reference, not literal** — verify external identifiers (exports, signatures, store action names) against the real files before re-emitting.

**Goal:** Add three Inventor-staple 2D sketch tools the ZilInventor sketcher lacks — construction geometry, single-primitive offset, and parametric fillet/chamfer — scoped per the approved spec.

**Architecture:** Construction is an optional `construction?: boolean` flag on `SketchPrimitive`, rendered dashed and filtered out of kernel profile extraction (but still solved). Offset is a one-shot primitive-picking tool that emits new independent geometry. Fillet/Chamfer are primitive-picking tools that emit an arc/line plus solver constraints (`tangent` + `dim-radius`), letting planegcs trim the source lines to the tangent points. All three picking tools follow the existing `ConstraintTool` integration pattern in `ActiveToolController`.

**Tech Stack:** TypeScript, pnpm monorepo. Packages: `shared` (types/constraints), `kernel` (OCCT/WASM adapter), `sketcher-worker` (planegcs binding), `app` (React + Three.js + Zustand store). Vitest (unit/integration), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-06-08-sketch-productivity-tools-slice1-design.md` — honor its Non-Goals, especially **#6: fillet/chamfer operate on two `line` primitives sharing a corner — NOT rectangle corners.**

---

## Test-running gotchas (apply to every test step)

- **App tests (jsdom):** `cd packages/app && npx vitest run <relative-path>`. Config `packages/app/vitest.config.ts`. `src/test-setup.ts` installs a localStorage shim — don't remove. jsdom `Blob.arrayBuffer()` is undefined — patch fake blobs if a test needs it.
- **Shared tests:** `cd packages/shared && npx vitest run <path>`.
- **Kernel tests:** `cd packages/kernel && npx vitest run <path>`. Integration specs load real OCCT/WASM — slower.
- **Bash cwd persists across AND within compound commands.** Never chain two package test runs as `cd a && ... ; cd b && ...` without a fresh `cd` for each; re-`cd` per package. The root `--config` form prints nothing — always run from the package dir.
- **e2e:** Playwright under `tests/e2e/`. Pattern reference: `tests/e2e/pbr-textures-phase3-export.spec.ts`. Sketcher/commands are typically driven via `page.evaluate(async () => { await import('/src/...') })` plus UI clicks.

## File-touch map

| File | Responsibility | Tasks |
|---|---|---|
| `packages/shared/src/types.ts` | add `construction?: boolean` to `SketchPrimitive` | T1 |
| `packages/kernel/src/adapter/features/SketchFeature.ts` | skip construction primitives in edge build | T2 |
| `packages/app/src/sketcher/render/CommittedSketchRenderer.ts` | dashed render for construction | T3 |
| `packages/app/src/sketcher/geometry/offset.ts` (new) | pure offset math | T5 |
| `packages/app/src/sketcher/geometry/fillet.ts` (new) | pure fillet/chamfer math | T8, T10 |
| `packages/app/src/sketcher/tools/OffsetTool.ts` (new) | offset interaction | T6 |
| `packages/app/src/sketcher/tools/FilletTool.ts` (new) | fillet interaction | T9 |
| `packages/app/src/sketcher/tools/ChamferTool.ts` (new) | chamfer interaction | T10 |
| `packages/app/src/sketcher/ActiveToolController.ts` | tool union + instantiate + dispatch + construction stamp | T4, T7, T11 |
| `packages/app/src/store/useAppStore.ts` | `ToolKind` union + construction-mode flag | T4, T7, T11 |
| `packages/app/src/shell/tabs/SketchTab.tsx` | ribbon buttons + Construction toggle | T4, T7, T11 |
| `packages/app/src/commands/ToggleConstructionCommand.ts` (new) | convert selection ↔ construction | T4 |

---

## Phase 1 — Construction geometry

### Task 1: `construction` flag on SketchPrimitive + persistence round-trip

**Files:**
- Modify: `packages/shared/src/types.ts` (`SketchPrimitive` union, ~line 26)
- Test: `packages/kernel/src/__tests__/save-roundtrip.integration.spec.ts` (extend — reference for the part save/load API)

- [ ] **Step 1: Write the failing test**

Open `save-roundtrip.integration.spec.ts`, read how it builds a part, calls the save API (`kernel.saveToBytes` / `api.ts`), and reloads it. Add a test that a construction primitive survives the round-trip. Adapt the part-construction + save/load calls to match the existing helpers in that file:

```ts
it('persists the construction flag on a sketch primitive across save/load', async () => {
  const kernel = await makeKernel(); // use the file's existing setup helper
  const partId = /* create a part via the file's existing helper */;
  await kernel.addFeature(partId, {
    kind: 'sketch', id: 's1',
    plane: { source: 'workPlane', featureId: 'origin.XY' },
    primitives: [
      { id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 50, y2: 0 },
      { id: 'p2', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 50, construction: true },
    ],
    constraints: [],
  });
  const bytes = await kernel.saveToBytes(partId);
  const reloadedId = await kernel.registerPartFromBytes(bytes); // use the file's actual reload API
  const part = await kernel.getPart(reloadedId);
  const sketch = part.featureTree.find((f) => f.kind === 'sketch');
  const p2 = sketch.primitives.find((p) => p.id === 'p2');
  expect(p2.construction).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/kernel && npx vitest run src/__tests__/save-roundtrip.integration.spec.ts`
Expected: FAIL — TypeScript rejects `construction` on the primitive literal (field does not exist), or the assertion fails if serialization drops it.

- [ ] **Step 3: Add the field**

In `packages/shared/src/types.ts`, add `construction?: boolean` to every member of the `SketchPrimitive` union:

```ts
export type SketchPrimitive =
  | { id: string; kind: 'line'; x1: number; y1: number; x2: number; y2: number; construction?: boolean }
  | { id: string; kind: 'rectangle'; x: number; y: number; w: number; h: number; construction?: boolean }
  | { id: string; kind: 'circle'; cx: number; cy: number; r: number; construction?: boolean }
  | { id: string; kind: 'arc'; cx: number; cy: number; r: number; startAngle: number; endAngle: number; construction?: boolean }
  | { id: string; kind: 'spline'; controlPoints: ReadonlyArray<{ x: number; y: number }>; degree: 2 | 3; closed: boolean; construction?: boolean };
```

If the save path uses a field whitelist (check `packages/kernel/src/api.ts` and any sketch/part codec), add `construction` to it. If it serializes primitives structurally (JSON / structured clone), no codec change is needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/kernel && npx vitest run src/__tests__/save-roundtrip.integration.spec.ts`
Expected: PASS.

- [ ] **Step 5: Verify no manifest bump needed**

Run: `cd packages/shared && npx vitest run` then `cd packages/kernel && npx vitest run`
Expected: PASS — additive optional field, existing fixtures still load (no migration). If any existing round-trip/migration test fails, STOP and reassess whether a manifest bump is required before continuing.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/kernel/src/__tests__/save-roundtrip.integration.spec.ts
git commit -m "feat(shared): add optional construction flag to SketchPrimitive"
```

### Task 2: Exclude construction primitives from kernel profile extraction

**Files:**
- Modify: `packages/kernel/src/adapter/features/SketchFeature.ts:96-115` (the `for (const p of feature.primitives)` edge-build loop)
- Test: `packages/kernel/src/adapter/features/__tests__/SketchFeature.integration.spec.ts`

- [ ] **Step 1: Write the failing test**

Add a test: a sketch whose closed profile is 4 real lines PLUS one construction line (e.g. a diagonal) still yields exactly one closed wire (the construction line must not break/extra-loop the profile). Match the file's existing `executeSketchFeature` call style:

```ts
it('excludes construction primitives from wire extraction', () => {
  const feature = {
    kind: 'sketch' as const, id: 's1',
    plane: { source: 'workPlane' as const, featureId: 'origin.XY' },
    primitives: [
      { id: 'l1', kind: 'line' as const, x1: 0,  y1: 0,  x2: 50, y2: 0 },
      { id: 'l2', kind: 'line' as const, x1: 50, y1: 0,  x2: 50, y2: 50 },
      { id: 'l3', kind: 'line' as const, x1: 50, y1: 50, x2: 0,  y2: 50 },
      { id: 'l4', kind: 'line' as const, x1: 0,  y1: 50, x2: 0,  y2: 0 },
      // a construction diagonal — would otherwise create dangling/extra geometry
      { id: 'c1', kind: 'line' as const, x1: 0, y1: 0, x2: 50, y2: 50, construction: true },
    ],
    constraints: [],
  };
  const res = executeSketchFeature(oc, feature); // use the file's `oc` fixture
  expect(res.ok).toBe(true);
  if (res.ok) expect(res.value.closed).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/kernel && npx vitest run src/adapter/features/__tests__/SketchFeature.integration.spec.ts`
Expected: FAIL — the construction diagonal becomes a real edge, so `combineEdgesIntoWires` returns a closed wire plus an open chain → `degenerateSketch` error ("valid loop plus disconnected line").

- [ ] **Step 3: Skip construction primitives in the edge loop**

In `SketchFeature.ts`, at the top of the `for (const p of feature.primitives)` loop (line ~97), add:

```ts
    for (const p of feature.primitives) {
      if (p.construction) continue; // construction geometry is reference-only — excluded from profiles
      switch (p.kind) {
```

Leave everything else unchanged. (Construction primitives are still passed to the solver elsewhere — this filter is profile-only.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/kernel && npx vitest run src/adapter/features/__tests__/SketchFeature.integration.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/adapter/features/SketchFeature.ts packages/kernel/src/adapter/features/__tests__/SketchFeature.integration.spec.ts
git commit -m "feat(kernel): exclude construction primitives from sketch profile extraction"
```

### Task 3: Render construction geometry dashed + dimmer

**Files:**
- Modify: `packages/app/src/sketcher/render/CommittedSketchRenderer.ts`
- Test: `packages/app/src/sketcher/render/__tests__/CommittedSketchRenderer.spec.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CommittedSketchRenderer } from '../CommittedSketchRenderer';

describe('CommittedSketchRenderer construction styling', () => {
  it('uses a dashed material for construction primitives', () => {
    const r = new CommittedSketchRenderer();
    r.update([
      { id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'l2', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10, construction: true },
    ]);
    const objs = r.group.children as THREE.Line[];
    const normalMat = objs[0].material as THREE.Material;
    const constructionMat = objs[1].material as THREE.Material;
    expect(normalMat).toBeInstanceOf(THREE.LineBasicMaterial);
    expect(constructionMat).toBeInstanceOf(THREE.LineDashedMaterial);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npx vitest run src/sketcher/render/__tests__/CommittedSketchRenderer.spec.ts`
Expected: FAIL — both materials are `LineBasicMaterial`.

- [ ] **Step 3: Branch the material on `construction`**

In `CommittedSketchRenderer.ts`, change `buildObject` to choose the material and compute line distances for dashed lines. Replace the `const mat = ...` line and the `THREE.Line` constructions so each built `THREE.Line` calls `computeLineDistances()` when construction:

```ts
const CONSTRUCTION_COLOR = 0x8a8f98;

private buildObject(p: SketchPrimitive): THREE.Object3D {
  const mat = p.construction
    ? new THREE.LineDashedMaterial({ color: CONSTRUCTION_COLOR, dashSize: 2, gapSize: 1.5 })
    : new THREE.LineBasicMaterial({ color: SKETCH_COLOR });
  const obj = this.buildGeometry(p, mat);
  if (p.construction) (obj as THREE.Line).computeLineDistances();
  return obj;
}
```

Refactor the existing per-kind geometry construction (line/rectangle/circle/arc/spline) into a `buildGeometry(p, mat)` helper that returns the `THREE.Line` (move the existing body there unchanged, taking `mat` as a parameter). `buildArcLike`/`buildSpline` already take `mat` — widen their parameter type to `THREE.LineBasicMaterial | THREE.LineDashedMaterial` (or `THREE.Material`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && npx vitest run src/sketcher/render/__tests__/CommittedSketchRenderer.spec.ts`
Expected: PASS.

- [ ] **Step 5: Guard the rebuild cache key**

The cache key is `primitives.map((p) => p.id).join(',')`. Toggling construction does not change ids, so the renderer would skip the rebuild. Update the key to include the flag:

```ts
const key = primitives.map((p) => `${p.id}:${p.construction ? 1 : 0}`).join(',');
```

Add an assertion to the test that calling `update` again with the same primitive flipped to non-construction swaps the material back to `LineBasicMaterial`. Re-run Step 4's command; expect PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/sketcher/render/CommittedSketchRenderer.ts packages/app/src/sketcher/render/__tests__/CommittedSketchRenderer.spec.ts
git commit -m "feat(app): render construction sketch geometry dashed"
```

### Task 4: Construction mode toggle + convert-selection command

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts` (add `constructionMode: boolean` + `setConstructionMode`)
- Modify: `packages/app/src/sketcher/ActiveToolController.ts` (stamp `construction: true` onto committed primitives when active)
- Create: `packages/app/src/commands/ToggleConstructionCommand.ts`
- Modify: `packages/app/src/shell/tabs/SketchTab.tsx` (Construction toggle button)
- Test: `packages/app/src/commands/__tests__/ToggleConstructionCommand.spec.ts`

- [ ] **Step 1: Write the failing test for the command**

```ts
import { describe, it, expect } from 'vitest';
import { ToggleConstructionCommand } from '../ToggleConstructionCommand';

describe('ToggleConstructionCommand', () => {
  it('flips construction on the targeted primitives and is reversible', () => {
    const sketch = {
      kind: 'sketch' as const, id: 's1',
      plane: { source: 'workPlane' as const, featureId: 'origin.XY' },
      primitives: [
        { id: 'p1', kind: 'line' as const, x1: 0, y1: 0, x2: 10, y2: 0 },
        { id: 'p2', kind: 'line' as const, x1: 0, y1: 0, x2: 0, y2: 10, construction: true },
      ],
      constraints: [],
    };
    const cmd = new ToggleConstructionCommand({ sketch, primitiveIds: ['p1', 'p2'] });
    const after = cmd.apply(sketch);
    expect(after.primitives.find((p) => p.id === 'p1')!.construction).toBe(true);
    expect(after.primitives.find((p) => p.id === 'p2')!.construction).toBe(false);
    const back = cmd.invert(after);
    expect(back.primitives.find((p) => p.id === 'p1')!.construction).toBeFalsy();
    expect(back.primitives.find((p) => p.id === 'p2')!.construction).toBe(true);
  });
});
```

Match the actual command base-class shape used by sibling commands (read `packages/app/src/commands/AddPrimitiveCommand.ts` for the real `execute`/`undo` interface and the bus contract — the `apply`/`invert` names above are illustrative; use the real ones).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npx vitest run src/commands/__tests__/ToggleConstructionCommand.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the command**

Create `ToggleConstructionCommand.ts` following the structure of `AddPrimitiveCommand.ts` (same constructor deps: kernel, store getActivePart/setActivePart, sketchId; same execute/undo via updating the sketch feature's `primitives` array). For each id in `primitiveIds`, set `construction: !current`. Undo restores the prior values (capture them in `execute`). Keep the pure transform testable as shown.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && npx vitest run src/commands/__tests__/ToggleConstructionCommand.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add construction mode to the store + stamp on commit**

In `useAppStore.ts`: add state `constructionMode: false` and action `setConstructionMode(on: boolean)`. In `ActiveToolController`'s `applyOutput` `committed` branch (line ~201), stamp the flag before emitting:

```ts
case 'committed': {
  const prim = useAppStore.getState().constructionMode
    ? { ...output.primitive, construction: true }
    : output.primitive;
  this.deps.emitPrimitive(prim);
  // ...unchanged inferFromSnaps block, using `prim`...
}
```

If importing the store into `ActiveToolController` is undesirable (it currently takes deps), instead add an optional `isConstructionMode?(): boolean` to `ControllerDeps` and wire it from App.tsx (`() => useAppStore.getState().constructionMode`). Prefer the deps approach to keep the controller store-agnostic.

- [ ] **Step 6: Add the ribbon toggle + write an app test for stamping**

In `SketchTab.tsx`, add a "Construction" toggle button (a new `RibbonPanel` or within "Draw") bound to `constructionMode`/`setConstructionMode`, styled with `aria-pressed={constructionMode}` like the existing tool buttons. Add a controller test asserting that with construction mode on, a committed primitive reaches `emitPrimitive` with `construction: true`:

```ts
// in ActiveToolController spec — set the deps.isConstructionMode = () => true,
// drive a line draw (two clicks), assert the captured emitPrimitive arg has construction === true.
```

Run: `cd packages/app && npx vitest run src/sketcher/__tests__/ActiveToolController` (match the existing spec path)
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/store/useAppStore.ts packages/app/src/sketcher/ActiveToolController.ts packages/app/src/commands/ToggleConstructionCommand.ts packages/app/src/commands/__tests__/ToggleConstructionCommand.spec.ts packages/app/src/shell/tabs/SketchTab.tsx packages/app/src/sketcher/__tests__/
git commit -m "feat(app): construction mode toggle + convert-selection command"
```

---

## Phase 2 — Offset tool (one-shot, single-primitive)

### Task 5: Pure offset geometry helpers

**Files:**
- Create: `packages/app/src/sketcher/geometry/offset.ts`
- Test: `packages/app/src/sketcher/geometry/__tests__/offset.spec.ts`

Signed distance convention: positive `d` offsets to the **left** of a line's direction (rotate the unit direction +90°); for circle/arc, positive `d` increases radius; for rectangle, positive `d` grows outward. The tool maps the cursor side / numeric sign to this convention.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { offsetPrimitive } from '../offset';

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('offsetPrimitive', () => {
  it('offsets a horizontal line to the left by +d', () => {
    const r = offsetPrimitive({ id: 'l', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }, 5);
    expect(r!.kind).toBe('line');
    if (r!.kind === 'line') { near(r.x1, 0); near(r.y1, 5); near(r.x2, 10); near(r.y2, 5); }
  });
  it('offsets a circle by increasing radius for +d', () => {
    const r = offsetPrimitive({ id: 'c', kind: 'circle', cx: 0, cy: 0, r: 10 }, 3);
    if (r!.kind === 'circle') near(r.r, 13);
  });
  it('clamps a circle offset that would invert to null', () => {
    const r = offsetPrimitive({ id: 'c', kind: 'circle', cx: 0, cy: 0, r: 10 }, -10);
    expect(r).toBeNull();
  });
  it('offsets an arc by radius, preserving angles', () => {
    const r = offsetPrimitive({ id: 'a', kind: 'arc', cx: 0, cy: 0, r: 10, startAngle: 0, endAngle: 1 }, -4);
    if (r!.kind === 'arc') { near(r.r, 6); near(r.startAngle, 0); near(r.endAngle, 1); }
  });
  it('insets a rectangle for negative d (all sides move inward)', () => {
    const r = offsetPrimitive({ id: 'rc', kind: 'rectangle', x: 0, y: 0, w: 100, h: 60 }, -10);
    if (r!.kind === 'rectangle') { near(r.x, 10); near(r.y, 10); near(r.w, 80); near(r.h, 40); }
  });
  it('returns null for a rectangle inset larger than half its smallest side', () => {
    const r = offsetPrimitive({ id: 'rc', kind: 'rectangle', x: 0, y: 0, w: 100, h: 20 }, -15);
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/app && npx vitest run src/sketcher/geometry/__tests__/offset.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `offsetPrimitive`**

```ts
import type { SketchPrimitive } from '@zilventor/shared';

/** Offset a single primitive by signed distance `d`. Returns null if the
 *  result would be degenerate/inverted. New primitive gets a fresh id. */
export function offsetPrimitive(p: SketchPrimitive, d: number): SketchPrimitive | null {
  const id = `p-off-${Math.random().toString(36).slice(2, 8)}`;
  if (p.kind === 'line') {
    const dx = p.x2 - p.x1, dy = p.y2 - p.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return null;
    const nx = -dy / len, ny = dx / len; // +90° normal (left of direction)
    return { id, kind: 'line', x1: p.x1 + nx * d, y1: p.y1 + ny * d, x2: p.x2 + nx * d, y2: p.y2 + ny * d };
  }
  if (p.kind === 'circle') {
    const r = p.r + d;
    if (r <= 1e-6) return null;
    return { id, kind: 'circle', cx: p.cx, cy: p.cy, r };
  }
  if (p.kind === 'arc') {
    const r = p.r + d;
    if (r <= 1e-6) return null;
    return { id, kind: 'arc', cx: p.cx, cy: p.cy, r, startAngle: p.startAngle, endAngle: p.endAngle };
  }
  if (p.kind === 'rectangle') {
    const nx = p.x - d, ny = p.y - d, nw = p.w + 2 * d, nh = p.h + 2 * d;
    if (nw <= 1e-6 || nh <= 1e-6) return null;
    return { id, kind: 'rectangle', x: nx, y: ny, w: nw, h: nh };
  }
  return null; // spline offset out of scope for slice 1
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/app && npx vitest run src/sketcher/geometry/__tests__/offset.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/sketcher/geometry/offset.ts packages/app/src/sketcher/geometry/__tests__/offset.spec.ts
git commit -m "feat(app): pure single-primitive offset geometry"
```

### Task 6: OffsetTool interaction (pick → side/distance → commit)

**Files:**
- Create: `packages/app/src/sketcher/tools/OffsetTool.ts`
- Test: `packages/app/src/sketcher/tools/__tests__/OffsetTool.spec.ts`

OffsetTool is a **picking tool** (like `ConstraintTool`): it gets `setPrimitives`, picks a primitive on first click, then previews/commits the offset. It is NOT a `SketchTool` subclass. Read `ConstraintTool.ts` `pickAt` and reuse its body-pick logic (extract a shared `pickPrimitiveAt(primitives, point)` helper into `packages/app/src/sketcher/tools/pick.ts` and have ConstraintTool import it too — DRY; do this refactor under Task 6 and keep ConstraintTool's tests green).

Interaction state machine:
- `idle` → first click picks a primitive (store it) → `picked`.
- `picked` + pointerMove → compute signed distance from cursor to the primitive (perpendicular distance, sign by side) → emit preview polyline of `offsetPrimitive(picked, d)`.
- `picked` + pointerClick → commit `offsetPrimitive(picked, d)` via `onCommit`.
- `picked` + numericCommit([dist]) → commit at `±dist` (sign = current cursor side).
- escape → reset.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { OffsetTool } from '../OffsetTool';

describe('OffsetTool', () => {
  it('picks a line then commits an offset primitive at the cursor side', () => {
    const committed: any[] = [];
    const previews: any[] = [];
    const tool = new OffsetTool({ onCommit: (p) => committed.push(p), onPreview: (poly) => previews.push(poly) });
    tool.setPrimitives([{ id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }]);
    tool.onPointerClick({ x: 5, y: 0 });           // pick the line body
    tool.onPointerMove({ x: 5, y: 4 });            // cursor 4mm above → left side
    expect(previews.length).toBeGreaterThan(0);
    tool.onPointerClick({ x: 5, y: 4 });           // commit
    expect(committed).toHaveLength(1);
    expect(committed[0].kind).toBe('line');
    expect(committed[0].y1).toBeCloseTo(4, 6);
    expect(committed[0].y2).toBeCloseTo(4, 6);
  });

  it('commits via numeric distance on the current cursor side', () => {
    const committed: any[] = [];
    const tool = new OffsetTool({ onCommit: (p) => committed.push(p), onPreview: () => {} });
    tool.setPrimitives([{ id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }]);
    tool.onPointerClick({ x: 5, y: 0 });
    tool.onPointerMove({ x: 5, y: -2 });           // below → right side (negative)
    tool.onNumericCommit([7]);
    expect(committed[0].y1).toBeCloseTo(-7, 6);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/app && npx vitest run src/sketcher/tools/__tests__/OffsetTool.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement OffsetTool**

Implement the class with the methods used above (`setPrimitives`, `onPointerClick`, `onPointerMove`, `onNumericCommit`, `onEscapePressed`, `getAnchor`, `numericFieldCount`). Use the extracted `pickPrimitiveAt` for selection. Compute signed perpendicular distance to the picked primitive: for a line, project the cursor onto the line normal `(-dy,dx)/len`; for circle/arc, `hypot(cursor-center) - r`; for rectangle, signed distance to the nearest edge (negative = inside). Preview via `offsetPrimitive` sampled to a polyline (reuse the renderer's sampling shapes or a small local sampler — a line offset previews as its 2 endpoints; circle/arc/rect sample like `CommittedSketchRenderer`). On commit call `this.opts.onCommit(offsetPrimitive(this.picked, d))` when non-null.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/app && npx vitest run src/sketcher/tools/__tests__/OffsetTool.spec.ts`
Expected: PASS. Also run `cd packages/app && npx vitest run src/sketcher/tools/__tests__/ConstraintTool` to confirm the `pickPrimitiveAt` extraction didn't regress ConstraintTool.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/sketcher/tools/OffsetTool.ts packages/app/src/sketcher/tools/pick.ts packages/app/src/sketcher/tools/ConstraintTool.ts packages/app/src/sketcher/tools/__tests__/OffsetTool.spec.ts
git commit -m "feat(app): OffsetTool pick+side+distance interaction"
```

### Task 7: Wire OffsetTool into the controller, store, and ribbon

**Files:**
- Modify: `packages/app/src/sketcher/ActiveToolController.ts` (`ToolKind`, `ActiveTool` union, `instantiate`, `handlePointer`, `handleKey`, `handleNumericCommit`)
- Modify: `packages/app/src/store/useAppStore.ts` (`ToolKind` union)
- Modify: `packages/app/src/shell/tabs/SketchTab.tsx` (Offset button)
- Test: `packages/app/src/sketcher/__tests__/ActiveToolController.offset.spec.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// Drive the controller with offset tool selected: feed primitives, click to pick,
// move, click to commit; assert deps.emitPrimitive received an offset line.
// Mirror the existing ActiveToolController spec setup (build deps with spies).
```

Write it concretely against the real `ControllerDeps` spy pattern used in the existing `ActiveToolController` spec (read it first). Assert `emitPrimitive` is called once with a `kind: 'line'` offset.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/app && npx vitest run src/sketcher/__tests__/ActiveToolController.offset.spec.ts`
Expected: FAIL — `'offset'` is not a valid `ToolKind` / not instantiated.

- [ ] **Step 3: Wire it**

- Add `'offset'` to `ToolKind` in BOTH `ActiveToolController.ts:16` and `store/useAppStore.ts:16`.
- Add `OffsetTool` to the `ActiveTool` union (line 42) and `import { OffsetTool } from './tools/OffsetTool'`.
- In `instantiate()`, add `case 'offset': return new OffsetTool({ onCommit: (p) => this.deps.emitPrimitive(p), onPreview: (poly) => this.deps.onPreview(poly, NEUTRAL_SNAP) });`.
- In `handlePointer`, add an `instanceof OffsetTool` branch: `setPrimitives(primitives)`, route `click`→`onPointerClick(point)`, `move`→`onPointerMove(point)`.
- In `handleKey`, route Escape → `onEscapePressed()`.
- In `handleNumericCommit` and `numericFieldCount`/`getAnchor`, include OffsetTool (it supports numeric distance once a primitive is picked).

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/app && npx vitest run src/sketcher/__tests__/ActiveToolController.offset.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add the ribbon button**

In `SketchTab.tsx`, add a "Modify" `RibbonPanel` (it will also host Fillet/Chamfer later) with an Offset button: `aria-pressed={activeToolKind === 'offset'}`, `disabled={!sketchMode}`, `onClick={() => useAppStore.getState().setActiveToolKind('offset')}`.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/sketcher/ActiveToolController.ts packages/app/src/store/useAppStore.ts packages/app/src/shell/tabs/SketchTab.tsx packages/app/src/sketcher/__tests__/ActiveToolController.offset.spec.ts
git commit -m "feat(app): wire OffsetTool into controller, store, and ribbon"
```

---

## Phase 3 — Fillet / Chamfer (parametric, two lines sharing a corner)

> **Approach:** The tool computes exact geometry (deterministic, unit-tested in T8/T10), emits the new arc/line primitive, trims the two source lines (moves their shared-corner endpoint to the tangent/setback points), and emits solver constraints (`tangent` ×2 + `dim-radius` for fillet) so the result is editable. The solver refines from the near-exact initial placement. **Corner-coincidence caveat:** if the two source lines are tied at the corner by a `coincident` constraint, that constraint must be dropped (it would fight the open fillet) — handle in T9.

### Task 8: Pure fillet geometry helper

**Files:**
- Create: `packages/app/src/sketcher/geometry/fillet.ts`
- Test: `packages/app/src/sketcher/geometry/__tests__/fillet.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { computeFillet } from '../fillet';

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 4);

describe('computeFillet', () => {
  const lx = { id: 'lx', kind: 'line' as const, x1: 0, y1: 0, x2: 10, y2: 0 };  // corner at (0,0)
  const ly = { id: 'ly', kind: 'line' as const, x1: 0, y1: 0, x2: 0, y2: 10 };

  it('computes center, radius and tangent points for a right-angle corner, r=2', () => {
    const f = computeFillet(lx, ly, 2)!;
    expect(f).not.toBeNull();
    near(f.center.x, 2); near(f.center.y, 2);
    near(f.radius, 2);
    near(f.t1.x, 2); near(f.t1.y, 0);   // tangent on lx
    near(f.t2.x, 0); near(f.t2.y, 2);   // tangent on ly
  });

  it('trims each source line to its tangent point (corner endpoint moved)', () => {
    const f = computeFillet(lx, ly, 2)!;
    // lx corner endpoint was (0,0) → now (2,0); far endpoint (10,0) unchanged
    expect([f.trimmedL1.x1, f.trimmedL1.y1].map((n) => Math.round(n))).toEqual([2, 0]);
    near(f.trimmedL1.x2, 10); near(f.trimmedL1.y2, 0);
    expect([f.trimmedL2.x1, f.trimmedL2.y1].map((n) => Math.round(n))).toEqual([0, 2]);
  });

  it('arc midpoint bulges toward the corner', () => {
    const f = computeFillet(lx, ly, 2)!;
    const mid = (f.arc.startAngle + f.arc.endAngle) / 2;
    const mx = f.center.x + f.radius * Math.cos(mid);
    const my = f.center.y + f.radius * Math.sin(mid);
    near(mx, 0.5858); near(my, 0.5858);
  });

  it('returns null when the lines share no corner', () => {
    expect(computeFillet(lx, { id: 'lz', kind: 'line', x1: 5, y1: 5, x2: 9, y2: 9 }, 2)).toBeNull();
  });

  it('returns null when the radius is too large to fit the corner', () => {
    // a very large radius pushes tangent points past the far endpoints
    expect(computeFillet(lx, ly, 50)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/app && npx vitest run src/sketcher/geometry/__tests__/fillet.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `computeFillet`**

```ts
import type { SketchPrimitive } from '@zilventor/shared';

type Line = Extract<SketchPrimitive, { kind: 'line' }>;
type Pt = { x: number; y: number };

export type FilletResult = {
  corner: Pt; center: Pt; radius: number; t1: Pt; t2: Pt;
  arc: Extract<SketchPrimitive, { kind: 'arc' }>;
  trimmedL1: Line; trimmedL2: Line;
};

const TOL = 1e-6;
function sharedCorner(a: Line, b: Line): { corner: Pt; aFar: Pt; bFar: Pt; aCornerIsStart: boolean; bCornerIsStart: boolean } | null {
  const aEnds = [{ p: { x: a.x1, y: a.y1 }, start: true }, { p: { x: a.x2, y: a.y2 }, start: false }];
  const bEnds = [{ p: { x: b.x1, y: b.y1 }, start: true }, { p: { x: b.x2, y: b.y2 }, start: false }];
  for (const ae of aEnds) for (const be of bEnds) {
    if (Math.hypot(ae.p.x - be.p.x, ae.p.y - be.p.y) < 1e-4) {
      const aFar = aEnds.find((e) => e !== ae)!.p;
      const bFar = bEnds.find((e) => e !== be)!.p;
      return { corner: ae.p, aFar, bFar, aCornerIsStart: ae.start, bCornerIsStart: be.start };
    }
  }
  return null;
}

export function computeFillet(a: Line, b: Line, radius: number): FilletResult | null {
  if (radius <= TOL) return null;
  const sc = sharedCorner(a, b);
  if (!sc) return null;
  const { corner, aFar, bFar, aCornerIsStart, bCornerIsStart } = sc;
  const d1 = norm({ x: aFar.x - corner.x, y: aFar.y - corner.y });
  const d2 = norm({ x: bFar.x - corner.x, y: bFar.y - corner.y });
  if (!d1 || !d2) return null;
  const cosT = clamp(d1.x * d2.x + d1.y * d2.y, -1, 1);
  const theta = Math.acos(cosT);          // angle between the two legs
  if (theta < 1e-3 || Math.PI - theta < 1e-3) return null; // collinear → no fillet
  const half = theta / 2;
  const tanDist = radius / Math.tan(half);
  const cenDist = radius / Math.sin(half);
  // tangent points must lie within each segment
  const len1 = dist(corner, aFar), len2 = dist(corner, bFar);
  if (tanDist > len1 - TOL || tanDist > len2 - TOL) return null;
  const t1 = { x: corner.x + d1.x * tanDist, y: corner.y + d1.y * tanDist };
  const t2 = { x: corner.x + d2.x * tanDist, y: corner.y + d2.y * tanDist };
  const bis = norm({ x: d1.x + d2.x, y: d1.y + d2.y })!;
  const center = { x: corner.x + bis.x * cenDist, y: corner.y + bis.y * cenDist };
  let a1 = Math.atan2(t1.y - center.y, t1.x - center.x);
  let a2 = Math.atan2(t2.y - center.y, t2.x - center.x);
  // choose the short sweep whose midpoint bulges toward the corner
  if (a2 - a1 > Math.PI) a2 -= 2 * Math.PI;
  if (a1 - a2 > Math.PI) a1 -= 2 * Math.PI;
  const arc: Extract<SketchPrimitive, { kind: 'arc' }> = {
    id: `p-fil-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'arc', cx: center.x, cy: center.y, r: radius, startAngle: a1, endAngle: a2,
  };
  const trimmedL1 = setCornerEndpoint(a, aCornerIsStart, t1);
  const trimmedL2 = setCornerEndpoint(b, bCornerIsStart, t2);
  return { corner, center, radius, t1, t2, arc, trimmedL1, trimmedL2 };
}

function setCornerEndpoint(l: Line, cornerIsStart: boolean, p: Pt): Line {
  return cornerIsStart ? { ...l, x1: p.x, y1: p.y } : { ...l, x2: p.x, y2: p.y };
}
const norm = (v: Pt): Pt | null => { const m = Math.hypot(v.x, v.y); return m < TOL ? null : { x: v.x / m, y: v.y / m }; };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/app && npx vitest run src/sketcher/geometry/__tests__/fillet.spec.ts`
Expected: PASS. If the "bulges toward the corner" test fails on sign, adjust the short-sweep selection (the midpoint must be nearer the corner than the far arc).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/sketcher/geometry/fillet.ts packages/app/src/sketcher/geometry/__tests__/fillet.spec.ts
git commit -m "feat(app): pure fillet geometry helper"
```

### Task 9: FilletTool + UpdatePrimitiveCommand wiring

**Files:**
- Create: `packages/app/src/sketcher/tools/FilletTool.ts`
- Create: `packages/app/src/commands/UpdatePrimitiveCommand.ts` (trim source lines; mirror `AddPrimitiveCommand`)
- Test: `packages/app/src/sketcher/tools/__tests__/FilletTool.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { FilletTool } from '../FilletTool';

describe('FilletTool', () => {
  it('after picking two lines sharing a corner, emits an arc + trims + constraints', () => {
    const out: any = { primitives: [], updates: [], constraints: [] };
    const tool = new FilletTool({
      radius: 2,
      emitArc: (a) => out.primitives.push(a),
      updateLine: (id, patch) => out.updates.push({ id, patch }),
      emitConstraint: (c) => out.constraints.push(c),
    });
    tool.setPrimitives([
      { id: 'lx', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'ly', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 },
    ]);
    tool.onPointerClick({ x: 5, y: 0 });  // pick lx body
    tool.onPointerClick({ x: 0, y: 5 });  // pick ly body
    expect(out.primitives).toHaveLength(1);
    expect(out.primitives[0].kind).toBe('arc');
    expect(out.updates).toHaveLength(2);
    const kinds = out.constraints.map((c: any) => c.kind).sort();
    expect(kinds).toEqual(['dim-radius', 'tangent', 'tangent']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/app && npx vitest run src/sketcher/tools/__tests__/FilletTool.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement FilletTool**

A picking tool that collects two `line` picks via `pickPrimitiveAt` (reject non-line picks). On the second pick, call `computeFillet(l1, l2, this.opts.radius)`; if null, reset and ignore. On success:
- `emitArc(result.arc)`
- `updateLine(l1.id, { x1|x2, y1|y2 })` and `updateLine(l2.id, ...)` using `result.trimmedL1/trimmedL2` (emit only the changed endpoint fields).
- `emitConstraint({ id, kind: 'tangent', line: l1.id, arc: result.arc.id, source: 'user' })` and the same for l2.
- `emitConstraint({ id, kind: 'dim-radius', circle: result.arc.id, value: { kind: 'literal', value: this.opts.radius }, paramName: <generated>, source: 'user' })` — match the real `DimensionConstraint` shape from `constraints.ts:20` (note `dim-radius` carries `paramName`; generate a unique one, e.g. `r-fil-<arcId>`).
Reset picks after commit.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/app && npx vitest run src/sketcher/tools/__tests__/FilletTool.spec.ts`
Expected: PASS.

- [ ] **Step 5: Implement UpdatePrimitiveCommand + write its test**

Create `UpdatePrimitiveCommand.ts` mirroring `AddPrimitiveCommand.ts` (same deps), but instead of appending, it merges a `Partial<SketchPrimitive>` patch into the primitive with matching id in the active sketch, and on undo restores the prior values. Also call `sketcherClient.updatePrimitive(id, patch)` if a client is present (keeps the solver in sync). Add a unit test asserting apply-patch + undo round-trips one line endpoint. Run `cd packages/app && npx vitest run src/commands/__tests__/UpdatePrimitiveCommand.spec.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/sketcher/tools/FilletTool.ts packages/app/src/commands/UpdatePrimitiveCommand.ts packages/app/src/sketcher/tools/__tests__/FilletTool.spec.ts packages/app/src/commands/__tests__/UpdatePrimitiveCommand.spec.ts
git commit -m "feat(app): FilletTool + UpdatePrimitiveCommand"
```

### Task 10: Chamfer geometry helper + ChamferTool

**Files:**
- Modify: `packages/app/src/sketcher/geometry/fillet.ts` (add `computeChamfer`) — chamfer shares the shared-corner logic
- Create: `packages/app/src/sketcher/tools/ChamferTool.ts`
- Test: `packages/app/src/sketcher/geometry/__tests__/fillet.spec.ts` (extend), `packages/app/src/sketcher/tools/__tests__/ChamferTool.spec.ts`

- [ ] **Step 1: Write the failing helper test**

Add to `fillet.spec.ts`:

```ts
import { computeChamfer } from '../fillet';

describe('computeChamfer (equal setback)', () => {
  const lx = { id: 'lx', kind: 'line' as const, x1: 0, y1: 0, x2: 10, y2: 0 };
  const ly = { id: 'ly', kind: 'line' as const, x1: 0, y1: 0, x2: 0, y2: 10 };
  it('places setback points and a connecting line for a right angle', () => {
    const c = computeChamfer(lx, ly, 3)!;
    expect([c.p1.x, c.p1.y].map(Math.round)).toEqual([3, 0]);
    expect([c.p2.x, c.p2.y].map(Math.round)).toEqual([0, 3]);
    expect(c.line.kind).toBe('line');
    expect([c.line.x1, c.line.y1, c.line.x2, c.line.y2].map(Math.round)).toEqual([3, 0, 0, 3]);
  });
  it('returns null when setback exceeds a leg length', () => {
    expect(computeChamfer(lx, ly, 50)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/app && npx vitest run src/sketcher/geometry/__tests__/fillet.spec.ts`
Expected: FAIL — `computeChamfer` not exported.

- [ ] **Step 3: Implement `computeChamfer`**

Reuse `sharedCorner`. Compute `d1`, `d2`, leg lengths; reject if `setback > len`. `p1 = corner + d1*setback`, `p2 = corner + d2*setback`. Build the connecting `line` primitive p1→p2 (fresh id), and `trimmedL1`/`trimmedL2` via `setCornerEndpoint`. Return `{ corner, p1, p2, line, trimmedL1, trimmedL2 }`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/app && npx vitest run src/sketcher/geometry/__tests__/fillet.spec.ts`
Expected: PASS.

- [ ] **Step 5: Implement ChamferTool + test**

Like FilletTool but: on two line picks call `computeChamfer(l1, l2, this.opts.setback)`; emit the connecting line via `emitLine`, trim both source lines via `updateLine`, and emit two `coincident` constraints tying each connecting-line endpoint to the corresponding trimmed source-line endpoint (so the chamfer stays attached). No `dim-radius`. Write `ChamferTool.spec.ts` asserting: one line emitted, two updates, two `coincident` constraints. Run `cd packages/app && npx vitest run src/sketcher/tools/__tests__/ChamferTool.spec.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/sketcher/geometry/fillet.ts packages/app/src/sketcher/geometry/__tests__/fillet.spec.ts packages/app/src/sketcher/tools/ChamferTool.ts packages/app/src/sketcher/tools/__tests__/ChamferTool.spec.ts
git commit -m "feat(app): chamfer geometry helper + ChamferTool"
```

### Task 11: Wire Fillet + Chamfer into controller, store, ribbon

**Files:**
- Modify: `packages/app/src/sketcher/ActiveToolController.ts` (union, instantiate, dispatch)
- Modify: `packages/app/src/store/useAppStore.ts` (`ToolKind` + radius/setback defaults if stored there)
- Modify: `packages/app/src/App.tsx` (the `emitArc`/`updateLine`/`emitConstraint` deps → bus commands)
- Modify: `packages/app/src/shell/tabs/SketchTab.tsx` (Fillet + Chamfer buttons in the "Modify" panel)
- Test: `packages/app/src/sketcher/__tests__/ActiveToolController.fillet.spec.ts`

- [ ] **Step 1: Write the failing integration test**

Drive the controller with `'fillet'` selected, feed two corner-sharing lines, click each, and assert (via spies on the deps) that an arc primitive was emitted, two line updates issued, and three constraints emitted. Mirror the existing controller spec's spy harness.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/app && npx vitest run src/sketcher/__tests__/ActiveToolController.fillet.spec.ts`
Expected: FAIL — `'fillet'`/`'chamfer'` not valid `ToolKind`.

- [ ] **Step 3: Wire both tools**

- Add `'fillet'` and `'chamfer'` to `ToolKind` in BOTH `ActiveToolController.ts` and `store/useAppStore.ts`.
- Add `FilletTool`/`ChamferTool` to the `ActiveTool` union + imports.
- `instantiate()`: `case 'fillet': return new FilletTool({ radius: DEFAULT_FILLET_RADIUS, emitArc: (a) => this.deps.emitPrimitive(a), updateLine: (id, patch) => this.deps.updatePrimitive?.(id, patch), emitConstraint: (c) => this.deps.emitConstraint?.(c) });` and the analogous `chamfer` case (`setback: DEFAULT_CHAMFER_SETBACK`, `emitLine`).
- Add `updatePrimitive?(id, patch): void` to `ControllerDeps`.
- `handlePointer`: add `instanceof FilletTool`/`ChamferTool` branches → `setPrimitives` + `click → onPointerClick`.
- `handleKey`: Escape → reset.
- In `App.tsx`, wire `updatePrimitive` to dispatch `UpdatePrimitiveCommand` (like the existing `emitPrimitive`→`AddPrimitiveCommand` block at App.tsx:1164).

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/app && npx vitest run src/sketcher/__tests__/ActiveToolController.fillet.spec.ts`
Expected: PASS.

- [ ] **Step 5: Ribbon buttons**

In `SketchTab.tsx`'s "Modify" `RibbonPanel`, add Fillet and Chamfer buttons next to Offset (`aria-pressed`, `disabled={!sketchMode}`, `setActiveToolKind('fillet'|'chamfer')`).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/sketcher/ActiveToolController.ts packages/app/src/store/useAppStore.ts packages/app/src/App.tsx packages/app/src/shell/tabs/SketchTab.tsx packages/app/src/sketcher/__tests__/ActiveToolController.fillet.spec.ts
git commit -m "feat(app): wire Fillet and Chamfer tools into controller, store, ribbon"
```

---

## Phase 4 — Integration

### Task 12: Real-OCCT kernel integration + Playwright e2e

**Files:**
- Modify: `packages/kernel/src/adapter/features/__tests__/ExtrudeFeature.integration.spec.ts` (add a construction+fillet extrude case)
- Create: `tests/e2e/sketch-productivity-tools-slice1.spec.ts`

- [ ] **Step 1: Write the failing kernel integration test**

Add a case: a closed profile of 4 lines where one corner has been replaced by a fillet (3 lines + 1 arc forming a closed wire) PLUS a separate construction line, extruded 10mm, yields a valid solid whose volume is slightly less than the un-filleted box (the rounded corner removes a small wedge), and the construction line does not break extrusion. Use the file's existing extrude helper + `oc` fixture. Assert `res.ok` and `volume < boxVolume` and `volume > 0`.

- [ ] **Step 2: Run to verify it fails / then passes**

Run: `cd packages/kernel && npx vitest run src/adapter/features/__tests__/ExtrudeFeature.integration.spec.ts`
Expected: FAIL first (if the fixture exposes a gap), then PASS once T2's construction filter is in place. (If it already passes because T2 covers it, note that and keep the case as a regression guard.)

- [ ] **Step 3: Write the e2e**

Create `tests/e2e/sketch-productivity-tools-slice1.spec.ts` following the harness in `tests/e2e/pbr-textures-phase3-export.spec.ts`. Flow:
1. Launch app, create/open a part, enter 2D Sketch.
2. Draw a rectangle (RectTool) — e.g. 100×60.
3. Select Offset, pick the rectangle, type `10`, commit inward → assert a second (inset) rectangle primitive now exists (read sketch primitives via `page.evaluate(() => useAppStore.getState().activePart ...)` or the exposed store).
4. Draw two connected lines forming a corner (NOT a rectangle — fillet needs `line` primitives), select Fillet, pick both lines → assert an `arc` primitive appears and a `dim-radius` constraint exists.
5. Toggle Construction on, draw a diagonal line → assert it has `construction: true`.
6. Finish sketch, Extrude the profile → assert extrude succeeds and the construction line did not block it.
7. Assert the construction line is excluded from the profile (extrude succeeds with exactly the intended loop).

Keep assertions on store/document state (robust) rather than pixels. If sketch tools aren't window-exposed, drive them through the ribbon buttons (`getByRole('button', { name: /Offset|Fillet/ })`) and the numeric input field.

- [ ] **Step 4: Run the e2e**

Run: `npx playwright test tests/e2e/sketch-productivity-tools-slice1.spec.ts` (from repo root; match how other e2e specs are invoked — check `package.json` scripts).
Expected: PASS.

- [ ] **Step 5: Full-suite regression gate**

Run each package suite from its own dir (separate `cd` per package — do NOT chain):
```
cd packages/shared && npx vitest run
cd packages/kernel && npx vitest run
cd packages/app && npx vitest run
```
Expected: all PASS. Investigate any full-suite-only failures (e.g. a constraint or controller spec that asserts the exact `ToolKind` set or tool count — update those fixtures).

- [ ] **Step 6: Commit**

```bash
git add packages/kernel/src/adapter/features/__tests__/ExtrudeFeature.integration.spec.ts tests/e2e/sketch-productivity-tools-slice1.spec.ts
git commit -m "test: integration + e2e for construction, offset, fillet/chamfer (slice 1)"
```

---

## Self-Review

**1. Spec coverage**

| Spec item | Task |
|---|---|
| `construction?: boolean` data model + persistence (no manifest bump) | T1 |
| Construction excluded from profile, still constrainable | T2 |
| Construction rendered dashed/dimmer | T3 |
| Construction ribbon toggle + convert-selection command | T4 |
| Offset one-shot, single-primitive (line/circle/arc/rectangle) | T5–T7 |
| Offset preview + numeric distance + side-by-cursor | T6, T7 |
| Fillet parametric (tangent ×2 + dim-radius, editable) | T8, T9 |
| Chamfer equal-distance setback | T10 |
| Tool wiring (ToolKind ×2, controller, ribbon) | T4, T7, T11 |
| Non-Goal #6 (fillet on lines only, not rectangles) | enforced in T8 (`computeFillet` takes two `line`s) + T12 e2e |
| TDD per tool, real-OCCT + e2e | every task + T12 |

No spec requirement is unmapped. Deferred items (multi-segment offset, non-touching fillet, associative offset, project geometry, trim/extend) are Non-Goals — intentionally absent.

**2. Placeholder scan**

The only deliberately-soft steps are where a real codebase API must be matched rather than invented: T1's exact reload API (`registerPartFromBytes` is illustrative — use the file's real one), T4's command base-class method names (`apply`/`invert` illustrative — use the real bus contract from `AddPrimitiveCommand`), and the existing-controller-spec spy harness in T7/T11. Each step names the file to read for the real shape. No "TBD"/"add error handling"/"write tests for the above" left.

**3. Type consistency**

- `offsetPrimitive(p, d)` (T5) — same signature in T6/T7.
- `computeFillet(a, b, radius)` → `FilletResult { arc, trimmedL1, trimmedL2, t1, t2, center, radius }` (T8) — consumed unchanged in T9.
- `computeChamfer(a, b, setback)` → `{ p1, p2, line, trimmedL1, trimmedL2 }` (T10) — consumed in T10 ChamferTool.
- `dim-radius` constraint shape carries `paramName` + `value: DimensionValue` (per `constraints.ts:16-22`) — T9 builds it accordingly.
- `ControllerDeps.updatePrimitive?` added in T11, produced by FilletTool/ChamferTool `updateLine` dep (T9/T10) and consumed in App.tsx.
- `ToolKind` extended in BOTH `ActiveToolController.ts` and `store/useAppStore.ts` at every wiring task (T7 offset, T11 fillet/chamfer) — keep them identical.

## Risks / watch-items for the executor

1. **Solver convergence on fillet.** The constraint-driven trim relies on planegcs accepting `tangent` + `dim-radius` on the new arc plus the trimmed line endpoints. The geometry is placed near-exact (T8), so the solve should be a confirmation, but watch for the corner-coincidence conflict (drop any pre-existing corner `coincident` in T9) and for over-constrained warnings. The e2e (T12) is the real proof — if the solver fights it, fall back to committing the arc + trims WITHOUT the tangent constraint (geometry-only fillet) and log it as a slice-1.x follow-up.
2. **`updatePrimitive` document↔solver sync.** Trimming a line must update both the document (store/part) and the solver (`sketcherClient.updatePrimitive`). T9's `UpdatePrimitiveCommand` must do both, or the rendered line and the solved line diverge.
3. **Full-suite-only fixtures.** A constraint/controller test may assert the exact `ToolKind` set or the tool-button count. T12 Step 5 catches these — expect to update 1–2 fixtures.
4. **Construction serialization whitelist.** If `api.ts` enumerates primitive fields on save, T1 Step 3 must add `construction`. The round-trip test gates it.
5. **Offset side sign for rectangles.** The cursor-side → signed-distance mapping for a rectangle (inside vs outside) is the fiddliest UX bit; T6's numeric path (`±dist`) is the reliable fallback if cursor-side proves flaky.
