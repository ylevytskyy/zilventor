# DXF Phase 4c — 3DFACE + RAY/XLINE Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop dropping DXF `3DFACE`, `RAY`, and `XLINE` entities on import — map each to the existing `line` `SketchPrimitive` with `construction: true`.

**Architecture:** Pure 2D import in `packages/shared/src/dxf/` only. The parser gains three `readEntity` cases + three `DxfEntity` union members. `toSketch` gains `expandFace` (planar/degenerate-gated closed loop, sharing a new `closedLoop` emitter extracted from `expandSolid`) and a two-pass RAY/XLINE flow (collect → compute geometry bbox → slab-clip each infinite line to the bbox, with a fixed-length fallback). Same class as the already-shipped SOLID/LEADER work.

**Tech Stack:** TypeScript, Vitest (shared unit tests), Playwright/Chromium (§6 e2e). No kernel / OCCT / planegcs / sketcher-worker change.

## Global Constraints

- **NO new `SketchPrimitive` kind** — all three entities emit the existing `{ kind: 'line', construction: true }`.
- **NO manifest bump** — stays **v32**.
- **NO kernel / OCCT / planegcs / sketcher-worker change.**
- 3DFACE boundary loops and RAY/XLINE lines are `construction: true` **always**, regardless of layer (matches shipped `expandSolid`; RAY/XLINE are inherently reference geometry).
- All edits live under `packages/shared/src/dxf/` plus one e2e file under `tests/e2e/drawing/`.
- Per-package commands (run from inside the package): shared tests `cd packages/shared && npx vitest run`; shared typecheck `cd packages/shared && npx tsc --noEmit -p tsconfig.json`; app typecheck `cd packages/app && npx tsc --noEmit -p tsconfig.json`; e2e from repo root `npx playwright test --project=chromium tests/e2e/drawing/<file>`.
- Reuse existing test helpers verbatim: `entitiesDxf(body)` in `parser.spec.ts`; `ents(body, header?)` and `ParsedDxf` literals in `toSketch.spec.ts`.

---

## File Structure

- `packages/shared/src/dxf/types.ts` — add `3DFACE`, `RAY`, `XLINE` members to the `DxfEntity` union (Tasks 1, 2).
- `packages/shared/src/dxf/parser.ts` — add three `readEntity` cases (Tasks 1, 2).
- `packages/shared/src/dxf/toSketch.ts` — extract `closedLoop`, add `expandFace` + dispatch (Task 3); add `primExtent` + `clipToBox` + two-pass RAY/XLINE flow (Task 4).
- `packages/shared/src/dxf/__tests__/parser.spec.ts` — parser tests (Tasks 1, 2).
- `packages/shared/src/dxf/__tests__/toSketch.spec.ts` — toSketch tests (Tasks 3, 4).
- `tests/e2e/drawing/dxf-3dface-ray-xline.spec.ts` — §6 integration e2e (Task 5).

---

## Task 1: Parser — 3DFACE

**Files:**
- Modify: `packages/shared/src/dxf/types.ts` (DxfEntity union, after the `LEADER` member ~line 19)
- Modify: `packages/shared/src/dxf/parser.ts` (`readEntity` switch, add a case before `default` ~line 252)
- Test: `packages/shared/src/dxf/__tests__/parser.spec.ts`

**Interfaces:**
- Produces: `DxfEntity` member `{ type: '3DFACE'; layer: string; corners: ReadonlyArray<{ x: number; y: number; z: number }> }`. Corners carry **z** (consumed by Task 3's planar gate). Corner order is **sequential** `[c0,c1,c2(,c3)]` — NOT the SOLID `0,1,3,2` swap. Triangle (3 corners) when `c3 ≈ c2`.

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/dxf/__tests__/parser.spec.ts`, append:

```ts
describe('parseDxf — 3DFACE', () => {
  it('parses a quad 3DFACE with four 3D corners in sequential order', () => {
    const dxf = entitiesDxf(['  0', '3DFACE', '  8', '0',
      ' 10', '0', ' 20', '0', ' 30', '0',
      ' 11', '1', ' 21', '0', ' 31', '0',
      ' 12', '1', ' 22', '1', ' 32', '0',
      ' 13', '0', ' 23', '1', ' 33', '0'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('3DFACE');
    if (e.type === '3DFACE') {
      expect(e.corners).toHaveLength(4);
      expect(e.corners[0]).toEqual({ x: 0, y: 0, z: 0 });
      expect(e.corners[2]).toEqual({ x: 1, y: 1, z: 0 });
    }
  });

  it('collapses to a triangle when corner 3 equals corner 2', () => {
    const dxf = entitiesDxf(['  0', '3DFACE', '  8', '0',
      ' 10', '0', ' 20', '0', ' 30', '0',
      ' 11', '2', ' 21', '0', ' 31', '0',
      ' 12', '1', ' 22', '2', ' 32', '0',
      ' 13', '1', ' 23', '2', ' 33', '0'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('3DFACE');
    if (e.type === '3DFACE') expect(e.corners).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/parser.spec.ts -t 3DFACE`
Expected: FAIL — `e.type` is `undefined` (3DFACE hits `default → null`, so `entities[0]` is undefined → the `if` block never runs and `expect(e.type).toBe('3DFACE')` fails on `e` being undefined).

- [ ] **Step 3: Add the union member**

In `packages/shared/src/dxf/types.ts`, after the `LEADER` line (`| { type: 'LEADER'; ... }`), add:

```ts
  | { type: '3DFACE'; layer: string; corners: ReadonlyArray<{ x: number; y: number; z: number }> }
```

- [ ] **Step 4: Add the parser case**

In `packages/shared/src/dxf/parser.ts`, inside the `readEntity` switch, immediately before `default:`, add:

```ts
    case '3DFACE': {
      // Corners c0–c3 from codes 10–13 / 20–23 / 30–33, in sequential polygon
      // order (NOT the SOLID 0,1,3,2 swap). Carry z for the planar gate in toSketch.
      const c0 = { x: num(raw.pairs, 10), y: num(raw.pairs, 20), z: num(raw.pairs, 30) };
      const c1 = { x: num(raw.pairs, 11), y: num(raw.pairs, 21), z: num(raw.pairs, 31) };
      const c2 = { x: num(raw.pairs, 12), y: num(raw.pairs, 22), z: num(raw.pairs, 32) };
      const c3 = { x: num(raw.pairs, 13), y: num(raw.pairs, 23), z: num(raw.pairs, 33) };
      const eps = 1e-9;
      const isTri = Math.abs(c3.x - c2.x) < eps && Math.abs(c3.y - c2.y) < eps && Math.abs(c3.z - c2.z) < eps;
      const corners = isTri ? [c0, c1, c2] : [c0, c1, c2, c3];
      return { type: '3DFACE', layer, corners };
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/parser.spec.ts -t 3DFACE`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck**

Run: `cd packages/shared && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0, no output.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/dxf/types.ts packages/shared/src/dxf/parser.ts packages/shared/src/dxf/__tests__/parser.spec.ts
git commit -m "feat(dxf): parse 3DFACE into corner list (Phase 4c)"
```

---

## Task 2: Parser — RAY / XLINE

**Files:**
- Modify: `packages/shared/src/dxf/types.ts` (DxfEntity union, after the `3DFACE` member from Task 1)
- Modify: `packages/shared/src/dxf/parser.ts` (`readEntity` switch, add two cases before `default`)
- Test: `packages/shared/src/dxf/__tests__/parser.spec.ts`

**Interfaces:**
- Produces: `DxfEntity` members `{ type: 'RAY'; layer: string; x: number; y: number; dx: number; dy: number }` and `{ type: 'XLINE'; layer: string; x: number; y: number; dx: number; dy: number }`. Base point = codes 10/20; **direction** = codes 11/21 (z dropped). Both consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/dxf/__tests__/parser.spec.ts`, append:

```ts
describe('parseDxf — RAY & XLINE', () => {
  it('parses a RAY with base point and direction (z dropped)', () => {
    const dxf = entitiesDxf(['  0', 'RAY', '  8', '0',
      ' 10', '1', ' 20', '2', ' 30', '0', ' 11', '1', ' 21', '0', ' 31', '0'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('RAY');
    if (e.type === 'RAY') expect([e.x, e.y, e.dx, e.dy]).toEqual([1, 2, 1, 0]);
  });

  it('parses an XLINE with base point and direction', () => {
    const dxf = entitiesDxf(['  0', 'XLINE', '  8', '0',
      ' 10', '0', ' 20', '0', ' 11', '0', ' 21', '1'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('XLINE');
    if (e.type === 'XLINE') expect([e.x, e.y, e.dx, e.dy]).toEqual([0, 0, 0, 1]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/parser.spec.ts -t "RAY & XLINE"`
Expected: FAIL — both entities currently hit `default → null`, so `entities[0]` is undefined.

- [ ] **Step 3: Add the union members**

In `packages/shared/src/dxf/types.ts`, after the `3DFACE` member added in Task 1, add:

```ts
  | { type: 'RAY'; layer: string; x: number; y: number; dx: number; dy: number }
  | { type: 'XLINE'; layer: string; x: number; y: number; dx: number; dy: number }
```

- [ ] **Step 4: Add the parser cases**

In `packages/shared/src/dxf/parser.ts`, inside the `readEntity` switch, immediately before `default:` (after the `3DFACE` case), add:

```ts
    case 'RAY':
      return { type: 'RAY', layer,
        x: num(raw.pairs, 10), y: num(raw.pairs, 20),
        dx: num(raw.pairs, 11), dy: num(raw.pairs, 21) };
    case 'XLINE':
      return { type: 'XLINE', layer,
        x: num(raw.pairs, 10), y: num(raw.pairs, 20),
        dx: num(raw.pairs, 11), dy: num(raw.pairs, 21) };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/parser.spec.ts -t "RAY & XLINE"`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck**

Run: `cd packages/shared && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0, no output.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/dxf/types.ts packages/shared/src/dxf/parser.ts packages/shared/src/dxf/__tests__/parser.spec.ts
git commit -m "feat(dxf): parse RAY/XLINE into base+direction (Phase 4c)"
```

---

## Task 3: toSketch — 3DFACE (shared `closedLoop` + `expandFace` + dispatch)

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts` (refactor `expandSolid` ~lines 505–516; add `expandFace`; dispatch in the main loop ~line 404 and the `expandInsert` block-body loop ~lines 348–350)
- Test: `packages/shared/src/dxf/__tests__/toSketch.spec.ts`

**Interfaces:**
- Consumes: `DxfEntity` `3DFACE` member (Task 1); existing `V3`, `ocsXY`, `freshId`, `drop` callback `(k: string, r: string) => void`.
- Produces: `closedLoop(corners: ReadonlyArray<{ x: number; y: number }>, extrusion: V3 | undefined, s: number): SketchPrimitive[]` and `expandFace(e: Extract<DxfEntity, { type: '3DFACE' }>, s: number, drop: (k: string, r: string) => void): SketchPrimitive[]`.

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/dxf/__tests__/toSketch.spec.ts`, append:

```ts
describe('toSketch — 3DFACE', () => {
  it('maps a planar quad 3DFACE to a closed loop of 4 construction lines', () => {
    const r = toSketch(parseDxf(ents(['  0', '3DFACE', '  8', '0',
      ' 10', '0', ' 20', '0', ' 30', '0',
      ' 11', '1', ' 21', '0', ' 31', '0',
      ' 12', '1', ' 22', '1', ' 32', '0',
      ' 13', '0', ' 23', '1', ' 33', '0'].join('\n'))));
    expect(r.primitives).toHaveLength(4);
    expect(r.primitives.every((p) => p.kind === 'line' && p.construction === true)).toBe(true);
    const last = r.primitives[3]!;
    if (last.kind === 'line') expect([last.x2, last.y2]).toEqual([0, 0]); // closed back to c0
  });

  it('maps a planar triangle 3DFACE to 3 lines', () => {
    const r = toSketch(parseDxf(ents(['  0', '3DFACE', '  8', '0',
      ' 10', '0', ' 20', '0', ' 30', '0',
      ' 11', '2', ' 21', '0', ' 31', '0',
      ' 12', '1', ' 22', '2', ' 32', '0',
      ' 13', '1', ' 23', '2', ' 33', '0'].join('\n'))));
    expect(r.primitives).toHaveLength(3);
  });

  it('imports a face flat at a nonzero single z plane', () => {
    const r = toSketch(parseDxf(ents(['  0', '3DFACE', '  8', '0',
      ' 10', '0', ' 20', '0', ' 30', '5',
      ' 11', '1', ' 21', '0', ' 31', '5',
      ' 12', '1', ' 22', '1', ' 32', '5',
      ' 13', '0', ' 23', '1', ' 33', '5'].join('\n'))));
    expect(r.primitives).toHaveLength(4);
  });

  it('drops a non-planar 3DFACE (corners not co-Z) and tallies it', () => {
    const r = toSketch(parseDxf(ents(['  0', '3DFACE', '  8', '0',
      ' 10', '0', ' 20', '0', ' 30', '0',
      ' 11', '1', ' 21', '0', ' 31', '0',
      ' 12', '1', ' 22', '1', ' 32', '9',
      ' 13', '0', ' 23', '1', ' 33', '0'].join('\n'))));
    expect(r.primitives).toHaveLength(0);
    expect(r.dropped.some((d) => d.kind === '3DFACE')).toBe(true);
  });

  it('flattens a 3DFACE inside an INSERT block', () => {
    const parsed: ParsedDxf = {
      entities: [{ type: 'INSERT', layer: '0', name: 'FACE', x: 0, y: 0,
        xscale: 1, yscale: 1, rotation: 0, columns: 1, rows: 1, colSpacing: 0, rowSpacing: 0 }],
      blocks: {
        FACE: [{ type: '3DFACE', layer: '0',
          corners: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }] }],
      },
      header: {}, layers: {}, blockBasePoints: { FACE: { x: 0, y: 0 } },
    };
    const r = toSketch(parsed);
    expect(r.primitives).toHaveLength(4);
    expect(r.primitives.every((p) => p.kind === 'line' && p.construction === true)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts -t 3DFACE`
Expected: FAIL — 3DFACE currently falls through to `mapEntity`'s `default` (tallied as a drop), so `r.primitives` is empty for the planar cases.

- [ ] **Step 3: Extract `closedLoop` and refactor `expandSolid`**

In `packages/shared/src/dxf/toSketch.ts`, replace the existing `expandSolid` function (~lines 505–516) with:

```ts
/** Emit a closed loop of construction lines from polygon corners (OCS→WCS, scaled by s). */
function closedLoop(corners: ReadonlyArray<{ x: number; y: number }>, extrusion: V3 | undefined, s: number): SketchPrimitive[] {
  const pts = corners.map((c) => ocsXY(extrusion, c.x, c.y));
  const out: SketchPrimitive[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    out.push({ id: freshId(), kind: 'line', x1: a.x * s, y1: a.y * s, x2: b.x * s, y2: b.y * s, construction: true });
  }
  return out;
}

function expandSolid(e: Extract<DxfEntity, { type: 'SOLID' }>, s: number): SketchPrimitive[] {
  // corners are already in winding order (0,1,3,2) from the parser. Emit a closed
  // construction loop. Fill is intentionally dropped (boundary only, consistent with HATCH).
  return closedLoop(e.corners, e.extrusion, s);
}

function expandFace(e: Extract<DxfEntity, { type: '3DFACE' }>, s: number, drop: (k: string, r: string) => void): SketchPrimitive[] {
  const eps = 1e-9;
  // Degenerate guard: fewer than 3 distinct corners → not a face.
  const distinct: Array<{ x: number; y: number; z: number }> = [];
  for (const p of e.corners) {
    if (!distinct.some((q) => Math.abs(q.x - p.x) < eps && Math.abs(q.y - p.y) < eps && Math.abs(q.z - p.z) < eps)) {
      distinct.push(p);
    }
  }
  if (distinct.length < 3) { drop('3DFACE', 'degenerate (fewer than 3 distinct corners)'); return []; }
  // Planar gate: every corner must share corner 0's z (else projecting onto XY distorts it).
  const z0 = e.corners[0]!.z;
  if (e.corners.some((p) => Math.abs(p.z - z0) > eps)) { drop('3DFACE', 'non-planar (corners not co-Z)'); return []; }
  // 3DFACE is WCS — no extrusion/OCS. Emit a closed construction loop (all edges; code 70
  // edge-visibility flags are ignored — documented limitation).
  return closedLoop(e.corners, undefined, s);
}
```

(`closedLoop`'s parameter is `ReadonlyArray<{ x: number; y: number }>`; passing `e.corners` of type `ReadonlyArray<{ x; y; z }>` is allowed by structural subtyping — `closedLoop` only reads `x`/`y`.)

- [ ] **Step 4: Dispatch 3DFACE in the main loop**

In `toSketch`, add a 3DFACE branch immediately after the existing `SOLID` branch (the `if (e.type === 'SOLID') { ... continue; }` block ~lines 404–407):

```ts
    if (e.type === '3DFACE') {
      primitives.push(...expandFace(e, s, drop));
      continue;
    }
```

- [ ] **Step 5: Dispatch 3DFACE in the `expandInsert` block-body loop**

In `expandInsert`, in the block-body `for (const be of body)` loop, add a branch after the existing `SOLID` branch (`} else if (be.type === 'SOLID') { blockPrims.push(...expandSolid(be, 1)); }`):

```ts
    } else if (be.type === '3DFACE') {
      blockPrims.push(...expandFace(be, 1, drop));
    } else {
```

(i.e. insert the `else if` between the SOLID branch and the existing final `} else {` that calls `mapEntity`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts -t 3DFACE`
Expected: PASS (5 tests).

- [ ] **Step 7: Run the full shared suite + typecheck (catch the `expandSolid` refactor regression)**

Run: `cd packages/shared && npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: all green (existing `toSketch — SOLID`, `DIMENSION`, and `expandInsert flattens SOLID` tests still pass — they exercise the refactored `closedLoop`); tsc exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/__tests__/toSketch.spec.ts
git commit -m "feat(dxf): import 3DFACE via shared closedLoop + planar gate (Phase 4c)"
```

---

## Task 4: toSketch — RAY/XLINE (two-pass bbox-clamp)

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts` (add `primExtent` + `clipToBox` helpers; collect RAY/XLINE in the main loop; emit after the loop, before `return`)
- Test: `packages/shared/src/dxf/__tests__/toSketch.spec.ts`

**Interfaces:**
- Consumes: `DxfEntity` `RAY`/`XLINE` members (Task 2); existing `SketchPrimitive`, `freshId`, `drop`, scale `s`.
- Produces: `primExtent(p: SketchPrimitive): { minX; minY; maxX; maxY } | null` and `clipToBox(bx, by, ux, uy, box, ray): { x1; y1; x2; y2 } | null` — both module-private helpers.

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/dxf/__tests__/toSketch.spec.ts`, append:

```ts
describe('toSketch — RAY/XLINE bbox-clamp', () => {
  it('clamps an XLINE to span the geometry bounding box', () => {
    // Circle r=5 at origin → bbox [-5,-5]..[5,5]; horizontal XLINE through y=0.
    const r = toSketch(parseDxf(ents([
      '  0', 'CIRCLE', '  8', '0', ' 10', '0', ' 20', '0', ' 40', '5',
      '  0', 'XLINE', '  8', '0', ' 10', '0', ' 20', '0', ' 11', '1', ' 21', '0',
    ].join('\n'))));
    const line = r.primitives.find((p) => p.kind === 'line');
    expect(line).toBeDefined();
    if (line && line.kind === 'line') {
      expect(line.construction).toBe(true);
      const xs = [line.x1, line.x2];
      expect(Math.min(...xs)).toBeLessThanOrEqual(-5); // reaches past the left extent
      expect(Math.max(...xs)).toBeGreaterThanOrEqual(5); // and the right extent
      expect(line.y1).toBeCloseTo(0, 9);
      expect(line.y2).toBeCloseTo(0, 9);
    }
  });

  it('clamps a RAY to t≥0 (base toward the far box edge only)', () => {
    const r = toSketch(parseDxf(ents([
      '  0', 'CIRCLE', '  8', '0', ' 10', '0', ' 20', '0', ' 40', '5',
      '  0', 'RAY', '  8', '0', ' 10', '0', ' 20', '0', ' 11', '1', ' 21', '0',
    ].join('\n'))));
    const line = r.primitives.find((p) => p.kind === 'line');
    expect(line).toBeDefined();
    if (line && line.kind === 'line') {
      const xs = [line.x1, line.x2];
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1e-9); // never goes behind the base
      expect(Math.max(...xs)).toBeGreaterThanOrEqual(5);
    }
  });

  it('drops a zero-direction XLINE and tallies it', () => {
    const r = toSketch(parseDxf(ents([
      '  0', 'CIRCLE', '  8', '0', ' 10', '0', ' 20', '0', ' 40', '5',
      '  0', 'XLINE', '  8', '0', ' 10', '0', ' 20', '0', ' 11', '0', ' 21', '0',
    ].join('\n'))));
    expect(r.primitives.some((p) => p.kind === 'line')).toBe(false);
    expect(r.dropped.some((d) => d.kind === 'XLINE')).toBe(true);
  });

  it('emits a fixed-length fallback XLINE when there is no other geometry', () => {
    const r = toSketch(parseDxf(ents([
      '  0', 'XLINE', '  8', '0', ' 10', '0', ' 20', '0', ' 11', '1', ' 21', '0',
    ].join('\n'))));
    const lines = r.primitives.filter((p) => p.kind === 'line');
    expect(lines).toHaveLength(1);
    const l = lines[0]!;
    if (l.kind === 'line') {
      expect(l.construction).toBe(true);
      const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
      expect(len).toBeCloseTo(100, 6);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts -t "RAY/XLINE bbox-clamp"`
Expected: FAIL — RAY/XLINE currently fall through to `mapEntity`'s `default` (tallied as a drop), so no clamped lines are emitted.

- [ ] **Step 3: Add the `primExtent` and `clipToBox` helpers**

In `packages/shared/src/dxf/toSketch.ts`, add these two module-level functions (place them just above `expandSolid`/`closedLoop`):

```ts
/** Axis-aligned extent of a primitive in scaled (mm) space, or null if it has none. */
function primExtent(p: SketchPrimitive): { minX: number; minY: number; maxX: number; maxY: number } | null {
  switch (p.kind) {
    case 'line': return { minX: Math.min(p.x1, p.x2), minY: Math.min(p.y1, p.y2), maxX: Math.max(p.x1, p.x2), maxY: Math.max(p.y1, p.y2) };
    case 'rectangle': return { minX: p.x, minY: p.y, maxX: p.x + p.w, maxY: p.y + p.h };
    case 'circle':
    case 'arc': return { minX: p.cx - p.r, minY: p.cy - p.r, maxX: p.cx + p.r, maxY: p.cy + p.r };
    case 'ellipse': { const m = Math.max(p.rx, p.ry); return { minX: p.cx - m, minY: p.cy - m, maxX: p.cx + m, maxY: p.cy + m }; }
    case 'point': return { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    case 'spline': {
      if (!p.controlPoints.length) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const c of p.controlPoints) { minX = Math.min(minX, c.x); minY = Math.min(minY, c.y); maxX = Math.max(maxX, c.x); maxY = Math.max(maxY, c.y); }
      return { minX, minY, maxX, maxY };
    }
    default: return null;
  }
}

/**
 * Slab-clip the parametric line P(t) = (bx,by) + t·(ux,uy) (unit dir) against an
 * axis-aligned box. Returns the clipped segment, or null when the line misses the box
 * (or, for a ray with t≥0, when the box is entirely behind the base).
 */
function clipToBox(
  bx: number, by: number, ux: number, uy: number,
  box: { minX: number; minY: number; maxX: number; maxY: number },
  ray: boolean,
): { x1: number; y1: number; x2: number; y2: number } | null {
  let t0 = -Infinity, t1 = Infinity;
  if (Math.abs(ux) < 1e-12) {
    if (bx < box.minX || bx > box.maxX) return null; // parallel to Y slab & outside
  } else {
    let ta = (box.minX - bx) / ux, tb = (box.maxX - bx) / ux;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
  }
  if (Math.abs(uy) < 1e-12) {
    if (by < box.minY || by > box.maxY) return null; // parallel to X slab & outside
  } else {
    let ta = (box.minY - by) / uy, tb = (box.maxY - by) / uy;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
  }
  if (t1 < t0) return null; // misses the box
  if (ray) { t0 = Math.max(t0, 0); if (t1 < t0) return null; } // box entirely behind base
  return { x1: bx + ux * t0, y1: by + uy * t0, x2: bx + ux * t1, y2: by + uy * t1 };
}
```

- [ ] **Step 4: Collect RAY/XLINE in the main loop**

In `toSketch`, declare a pending list alongside the other accumulators (right after `const droppedMap = new Map...` / the `drop` definition, before `for (const e of parsed.entities)`):

```ts
  const pendingInfinite: Array<Extract<DxfEntity, { type: 'RAY' | 'XLINE' }>> = [];
```

Then, inside the main loop, add a collect branch near the other early `continue` branches (e.g. right after the `LEADER` branch):

```ts
    if (e.type === 'RAY' || e.type === 'XLINE') { pendingInfinite.push(e); continue; }
```

- [ ] **Step 5: Emit RAY/XLINE after the loop**

In `toSketch`, immediately before the final `return { primitives, annotations, dropped: [...droppedMap.values()] };`, add:

```ts
  if (pendingInfinite.length) {
    // Bounding box of all other emitted geometry, in scaled (mm) space.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of primitives) {
      const ext = primExtent(p);
      if (!ext) continue;
      minX = Math.min(minX, ext.minX); minY = Math.min(minY, ext.minY);
      maxX = Math.max(maxX, ext.maxX); maxY = Math.max(maxY, ext.maxY);
    }
    const hasBox = Number.isFinite(minX);
    // Margin so the clamped line clears the geometry; absolute floor handles a tiny/point box.
    const diag = hasBox ? Math.hypot(maxX - minX, maxY - minY) : 0;
    const margin = Math.max(diag * 0.1, 10);
    const box = { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
    const FALLBACK_LEN = 100; // mm — reference line shown when there's nothing to clamp to
    for (const e of pendingInfinite) {
      const dlen = Math.hypot(e.dx, e.dy);
      if (dlen < 1e-12) { drop(e.type, 'zero direction'); continue; }
      const ux = e.dx / dlen, uy = e.dy / dlen;
      const bx = e.x * s, by = e.y * s; // base scales by s; direction is dimensionless
      let seg = hasBox ? clipToBox(bx, by, ux, uy, box, e.type === 'RAY') : null;
      if (!seg) {
        // Fixed-length fallback (NOT a drop): XLINE centered on base, RAY starting at base.
        seg = e.type === 'XLINE'
          ? { x1: bx - ux * FALLBACK_LEN / 2, y1: by - uy * FALLBACK_LEN / 2, x2: bx + ux * FALLBACK_LEN / 2, y2: by + uy * FALLBACK_LEN / 2 }
          : { x1: bx, y1: by, x2: bx + ux * FALLBACK_LEN, y2: by + uy * FALLBACK_LEN };
      }
      primitives.push({ id: freshId(), kind: 'line', x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2, construction: true });
    }
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts -t "RAY/XLINE bbox-clamp"`
Expected: PASS (4 tests).

- [ ] **Step 7: Run the full shared suite + typecheck**

Run: `cd packages/shared && npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: all green; tsc exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/__tests__/toSketch.spec.ts
git commit -m "feat(dxf): import RAY/XLINE as bbox-clamped construction lines (Phase 4c)"
```

---

## Task 5: §6 e2e — combined 3DFACE + XLINE + RAY + LINE import

**Files:**
- Create: `tests/e2e/drawing/dxf-3dface-ray-xline.spec.ts`

**Interfaces:**
- Consumes: the `window.__zilventorImportDxfNewPart(file)` hook and `window.__zilventorStore` (already exposed in `packages/app/src/App.tsx`); the `waitForKernelReady` helper from `tests/e2e/drawing/helpers/buildBox`.

- [ ] **Step 1: Write the e2e test**

Create `tests/e2e/drawing/dxf-3dface-ray-xline.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

// ENTITIES-only fixture:
//   LINE   (layer 0)  → 1 NON-construction line
//   3DFACE (planar quad, z=0) → 4 construction lines (closed loop)
//   XLINE  (horizontal, y=2)  → 1 construction line clamped to the LINE+3DFACE bbox
//   RAY    (vertical, +y)     → 1 construction line clamped (t≥0)
// Total: 7 line primitives, of which 6 are construction.
const DXF = [
  '  0', 'SECTION', '  2', 'ENTITIES',
  '  0', 'LINE', '  8', '0', ' 10', '0.0', ' 20', '0.0', ' 11', '10.0', ' 21', '0.0',
  '  0', '3DFACE', '  8', '0',
  ' 10', '0.0', ' 20', '0.0', ' 30', '0.0',
  ' 11', '5.0', ' 21', '0.0', ' 31', '0.0',
  ' 12', '5.0', ' 22', '5.0', ' 32', '0.0',
  ' 13', '0.0', ' 23', '5.0', ' 33', '0.0',
  '  0', 'XLINE', '  8', '0', ' 10', '0.0', ' 20', '2.0', ' 11', '1.0', ' 21', '0.0',
  '  0', 'RAY', '  8', '0', ' 10', '0.0', ' 20', '0.0', ' 11', '0.0', ' 21', '1.0',
  '  0', 'ENDSEC', '  0', 'EOF',
].join('\n');

test('Phase 4c: 3DFACE + XLINE + RAY + LINE import (7 lines, 6 construction)', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(60_000);

  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await waitForKernelReady(page);

  const result = await page.evaluate(async (text: string) => {
    const w = window as unknown as {
      __zilventorStore: { getState: () => { activePart?: { featureTree: Array<{ kind: string; primitives?: Array<{ kind: string; construction?: boolean }> }> } } };
      __zilventorImportDxfNewPart: (file: File) => Promise<void>;
    };
    const file = new File([text], 'face-ray-xline.dxf', { type: 'image/vnd.dxf' });
    await w.__zilventorImportDxfNewPart(file);
    const part = w.__zilventorStore.getState();
    const sketch = part.activePart?.featureTree.find((f) => f.kind === 'sketch');
    const primitives = sketch?.primitives ?? [];
    return {
      lineCount: primitives.filter((p) => p.kind === 'line').length,
      constructionLineCount: primitives.filter((p) => p.kind === 'line' && p.construction === true).length,
    };
  }, DXF);

  expect(result.lineCount).toBe(7);
  expect(result.constructionLineCount).toBe(6);
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run the e2e to verify it passes**

Run: `npx playwright test --project=chromium tests/e2e/drawing/dxf-3dface-ray-xline.spec.ts`
Expected: PASS (1 test). The headless viewport is black — this asserts via `window.__zilventorStore`, not pixels.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/drawing/dxf-3dface-ray-xline.spec.ts
git commit -m "test(dxf): e2e import of 3DFACE/RAY/XLINE (Phase 4c)"
```

---

## Final Verification Gate (run after all tasks)

- [ ] shared tests green: `cd packages/shared && npx vitest run`
- [ ] shared typecheck 0: `cd packages/shared && npx tsc --noEmit -p tsconfig.json`
- [ ] app typecheck 0 (cross-package consumer of the changed types): `cd packages/app && npx tsc --noEmit -p tsconfig.json`
- [ ] lint clean on real packages (the ~454 `.claude/worktrees` lines are pre-existing noise): `pnpm lint`
- [ ] §6 e2e green: `npx playwright test --project=chromium tests/e2e/drawing/dxf-3dface-ray-xline.spec.ts`
- [ ] **NO manifest bump** — confirm the manifest version constant is unchanged (still v32).

## Out of Scope (remaining Phase 4c, future slices)

- HATCH boundary loops; LAYER color/linetype → metadata; parser perf / large-file handling.
- RAY/XLINE appearing **inside** a block body: not handled (the bbox concept is document-level, not per-block) — they fall through to `mapEntity`'s `default` and are tallied as drops. 3DFACE-in-block **is** supported (Task 3).
- 3DFACE code 70 edge-visibility flags: ignored — all edges emitted (documented limitation).

## Notes for the executing controller

- **Per-task review diff base = the PREVIOUS task's commit, not `HEAD~1`** — the Task 3 `expandSolid → closedLoop` refactor touches code that Task 4 also edits; a stale-base review missed exactly this class of cross-task regression in Phase 4b. Run the full shared suite at the end of Tasks 3 and 4 (steps already included) to catch it.
- Tell every subagent: **commit but DO NOT `git push`**; `git status` before and after to catch a dirty tree or self-push.
- Brief code snippets here are reconciled against the real branch code — but re-confirm exact surrounding lines before editing (line numbers drift as earlier tasks land).
- Known-flaky (NOT ours): 3 `App.spec` `frameToModel` teardown flakes in the app suite.
- After the gate is green: opus final whole-slice review, then update the handoff + auto-memory.
