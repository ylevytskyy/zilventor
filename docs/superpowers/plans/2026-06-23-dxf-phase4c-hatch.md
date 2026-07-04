# DXF HATCH Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import DXF `HATCH` boundary paths (polyline loops with bulge, and edge lists of line/circular-arc/elliptic-arc/spline edges) into the editable sketch model as closed **construction** geometry; fill/pattern/gradient/associativity/seed points are dropped.

**Architecture:** A new cursor-based sequential parser (`parseHatch`) walks the HATCH entity's ordered group-code pairs (the bag helpers `num`/`nums` cannot express HATCH's repeated, count-driven structure). It produces a `DxfHatch` entity. A new `expandHatch` in `toSketch.ts` converts each boundary loop to construction `SketchPrimitive[]`, reusing the existing `expandPolyline`/`segment` bulge logic for polyline loops and the existing OCS helpers for edge loops. The standalone-ELLIPSE axes math is extracted into a shared helper reused by the HATCH ellipse-edge path. HATCH is dispatched in both the `toSketch` main loop and inside `expandInsert` (matching SOLID / 3DFACE).

**Tech Stack:** TypeScript, Vitest (unit, in `packages/shared`), Playwright (e2e, Chromium). Dep-free shared DXF module.

## Global Constraints

- `construction: true` on **every** emitted HATCH primitive (boundary is reference geometry, like SOLID / 3DFACE).
- OCS/extrusion transform (`ocsXY`) **and** unit-scale `s` applied to all coordinates. `elevation` / z dropped (flat 2D).
- HATCH arc **and** ellipse edge angles (codes 50/51) are in **DEGREES** → convert to radians for the sketch primitive. (Contrast: standalone ELLIPSE params 41/42 are radians — do not conflate.)
- Fill / pattern name (code 2) / solid-fill flag (70) / associativity (71) / gradient / seed points / source-object handles (97 + 330) / code-70 edge-visibility — all **dropped/ignored**.
- Defensiveness: an unrecognised edge type, missing count, or malformed loop → **skip that edge/loop, never throw** (same posture as the 3DFACE degenerate/non-planar gates; optionally tally via `drop`).
- **NO manifest bump** — additive entity, stays **v32**. No kernel / OCCT / planegcs / worker change.
- Changes confined to `packages/shared/src/dxf/` + one e2e file.
- Test style: `expect().toBeCloseTo(x, 9)` for floats; discriminated-union type guards (`if (p.kind === 'arc') { ... }`).
- Per-pkg verification from inside the package: `cd packages/shared && npx vitest run`; tsc `npx tsc --noEmit -p tsconfig.json`. e2e from repo root: `npx playwright test --project=chromium tests/e2e/drawing/<file>` — headless viewport is BLACK, assert via `window.__zilventorStore`, not pixels.
- Commit after each green task. **Do NOT `git push`** (orchestrator decides push/merge).

---

## File Structure

- **`packages/shared/src/dxf/types.ts`** — add `HatchEdge`, `HatchLoop`, and `{ type: 'HATCH'; ... }` member to the `DxfEntity` union. (Existing `DxfPair`, `DxfExtrusion` reused.)
- **`packages/shared/src/dxf/parser.ts`** — add `parseHatchLoops(pairs: DxfPair[]): HatchLoop[]` (cursor walk) + a `case 'HATCH':` in `readEntity`'s switch.
- **`packages/shared/src/dxf/toSketch.ts`** — add `ellipseAxes(...)` helper (extracted from `mapEntity` ELLIPSE branch), `expandHatch(e, s, drop): SketchPrimitive[]`, wire it into the `toSketch` main loop and `expandInsert`'s block-body dispatch.
- **`packages/shared/src/dxf/parser.spec.ts`** — `parseHatch` tests (tasks 1–3).
- **`packages/shared/src/dxf/toSketch.spec.ts`** — `expandHatch` + ellipse-helper-regression tests (tasks 4–8).
- **`tests/e2e/drawing/dxf-hatch-import.spec.ts`** (new) — task 9, real-DXF round-trip.

---

## Reference: types to add (used across all tasks)

Add to `packages/shared/src/dxf/types.ts`. **Tasks add only the members they need**, but the final shape is:

```ts
export type HatchEdge =
  | { kind: 'line';    x1: number; y1: number; x2: number; y2: number }
  | { kind: 'arc';     cx: number; cy: number; r: number;
                       startAngle: number; endAngle: number; ccw: boolean }       // DEGREES
  | { kind: 'ellipse'; cx: number; cy: number; majorX: number; majorY: number;
                       ratio: number; startAngle: number; endAngle: number; ccw: boolean } // DEGREES
  | { kind: 'spline';  degree: number; closed: boolean;
                       controlPoints: Array<{ x: number; y: number }>; knots: number[]; weights?: number[] };

export type HatchLoop =
  | { kind: 'polyline'; closed: boolean; vertices: Array<{ x: number; y: number; bulge: number }> }
  | { kind: 'edges';    edges: HatchEdge[] };
```

And the `DxfEntity` union member:

```ts
  | { type: 'HATCH'; layer: string; loops: HatchLoop[]; extrusion?: DxfExtrusion }
```

---

## Reference: the cursor-walk parser (built incrementally across Tasks 1–3)

The parser uses a tiny forward cursor over the entity's ordered `pairs`. Edge codes are written by AutoCAD in a **fixed positional order per edge type**, so each branch reads its codes positionally (no boundary scanning needed). The complete function after Task 3 is below; Task 1 builds the skeleton + polyline branch, Task 2 adds line+arc edges, Task 3 adds ellipse+spline edges.

```ts
/** Parse HATCH boundary loops via a forward cursor over the ordered group-code pairs.
 * HATCH repeats codes 10/20/40/50/51/72/73 across loops & edges; structure is by order+count,
 * so the bag helpers (num/nums) cannot parse it. Malformed loop/edge → skip, never throw. */
function parseHatchLoops(pairs: DxfPair[]): HatchLoop[] {
  const f = (s: string | undefined): number => { const n = Number.parseFloat(s ?? ''); return Number.isFinite(n) ? n : 0; };
  let i = pairs.findIndex((p) => p.code === 91);          // boundary-path-count code
  if (i < 0) return [];
  const loopCount = Math.trunc(f(pairs[i]!.value));
  i++;
  /** If the current pair has `code`, return its value and advance; else return undefined (no advance). */
  const take = (code: number): string | undefined => {
    if (i < pairs.length && pairs[i]!.code === code) { const v = pairs[i]!.value; i++; return v; }
    return undefined;
  };
  /** Advance until the current pair has one of `codes` (or end). */
  const seek = (...codes: number[]): void => { while (i < pairs.length && !codes.includes(pairs[i]!.code)) i++; };

  const loops: HatchLoop[] = [];
  for (let li = 0; li < loopCount; li++) {
    seek(92);                                              // each loop begins with path-type flag
    const pt = take(92);
    if (pt === undefined) break;                           // ran out of loops
    const pathType = Math.trunc(f(pt));

    if (pathType & 2) {
      // ----- POLYLINE path: 72 has-bulge, 73 is-closed, 93 vertex count, then 10/20[/42]* -----
      const hasBulge = Math.trunc(f(take(72))) === 1;
      const closed = Math.trunc(f(take(73))) === 1;
      const vcount = Math.trunc(f(take(93)));
      const vertices: Array<{ x: number; y: number; bulge: number }> = [];
      for (let v = 0; v < vcount; v++) {
        const xs = take(10); if (xs === undefined) break;
        const x = f(xs);
        const y = f(take(20));
        const bulge = hasBulge ? f(take(42)) : 0;
        vertices.push({ x, y, bulge });
      }
      loops.push({ kind: 'polyline', closed, vertices });
    } else {
      // ----- EDGE list: 93 edge count, then per edge a 72 type + type-specific codes -----
      const ecount = Math.trunc(f(take(93)));
      const edges: HatchEdge[] = [];
      for (let e = 0; e < ecount; e++) {
        const ts = take(72); if (ts === undefined) break;
        const etype = Math.trunc(f(ts));
        if (etype === 1) {                                 // line: 10 20 11 21
          const x1 = f(take(10)), y1 = f(take(20)), x2 = f(take(11)), y2 = f(take(21));
          edges.push({ kind: 'line', x1, y1, x2, y2 });
        } else if (etype === 2) {                          // circular arc: 10 20 40 50 51 73
          const cx = f(take(10)), cy = f(take(20)), r = f(take(40));
          const startAngle = f(take(50)), endAngle = f(take(51));
          const ccw = Math.trunc(f(take(73))) !== 0;
          edges.push({ kind: 'arc', cx, cy, r, startAngle, endAngle, ccw });
        } else if (etype === 3) {                          // elliptic arc: 10 20 11 21 40 50 51 73
          const cx = f(take(10)), cy = f(take(20));
          const majorX = f(take(11)), majorY = f(take(21));
          const ratio = f(take(40));
          const startAngle = f(take(50)), endAngle = f(take(51));
          const ccw = Math.trunc(f(take(73))) !== 0;
          edges.push({ kind: 'ellipse', cx, cy, majorX, majorY, ratio, startAngle, endAngle, ccw });
        } else if (etype === 4) {                          // spline: 94 73 74 95 96, then 40* knots, then (10 20 [42])* cps
          const degree = Math.trunc(f(take(94)));
          const rational = Math.trunc(f(take(73))) !== 0;  // read to keep cursor positional (74 follows)
          take(74);                                        // periodic flag — consumed, unused
          const knotCount = Math.trunc(f(take(95)));
          const cpCount = Math.trunc(f(take(96)));
          const knots: number[] = [];
          for (let k = 0; k < knotCount; k++) { const v = take(40); if (v === undefined) break; knots.push(f(v)); }
          const controlPoints: Array<{ x: number; y: number }> = [];
          const weights: number[] = [];
          for (let c = 0; c < cpCount; c++) {
            const xs2 = take(10); if (xs2 === undefined) break;
            controlPoints.push({ x: f(xs2), y: f(take(20)) });
            const w = rational ? take(42) : undefined;     // optional per-cp weight
            if (w !== undefined) weights.push(f(w));
          }
          edges.push({ kind: 'spline', degree, closed: false, controlPoints, knots,
            ...(weights.length ? { weights } : {}) });
        } else {
          // unrecognised edge type → cannot know its code count; skip the rest of this loop's edges
          break;
        }
      }
      loops.push({ kind: 'edges', edges });
    }
  }
  return loops;
}
```

> **Note for implementers:** the tests are the contract. The reference above is a correct starting point; if a test exposes an ordering quirk, fix the parser to satisfy the test rather than the other way round. The `rational` read of code 73 inside the spline branch is intentional — code 73 (rational flag) precedes 74 in the spline edge, distinct from the arc/ellipse trailing 73 (ccw).

---

## Reference: the expander (built incrementally across Tasks 5–7)

Add to `toSketch.ts`. Reuses `ocsXY`, `ocsReflected`, `expandPolyline`, `segment`, `ellipseAxes` (Task 4), `isFullEllipse`, `freshId`. Complete function after Task 7:

```ts
function expandHatch(e: Extract<DxfEntity, { type: 'HATCH' }>, s: number, drop: (k: string, r: string) => void): SketchPrimitive[] {
  const out: SketchPrimitive[] = [];
  const ext = e.extrusion;
  const refl = ocsReflected(ext);
  for (const loop of e.loops) {
    if (loop.kind === 'polyline') {
      // Reuse the polyline bulge/segment logic, forced construction. Closed loops only contribute
      // a closing segment when `closed` is set (matches expandPolyline semantics).
      out.push(...expandPolyline({ vertices: loop.vertices, closed: loop.closed, ...(ext ? { extrusion: ext } : {}) }, s, true));
    } else {
      for (const edge of loop.edges) {
        if (edge.kind === 'line') {
          const a = ocsXY(ext, edge.x1, edge.y1), b = ocsXY(ext, edge.x2, edge.y2);
          out.push({ id: freshId(), kind: 'line', x1: a.x * s, y1: a.y * s, x2: b.x * s, y2: b.y * s, construction: true });
        } else if (edge.kind === 'arc') {
          // deg→rad; normalise to CCW (swap when ccw=false); then map endpoints & swap if OCS-reflected.
          let a0 = (edge.startAngle * Math.PI) / 180, a1 = (edge.endAngle * Math.PI) / 180;
          if (!edge.ccw) { const t = a0; a0 = a1; a1 = t; }
          const c = ocsXY(ext, edge.cx, edge.cy);
          const sp = ocsXY(ext, edge.cx + edge.r * Math.cos(a0), edge.cy + edge.r * Math.sin(a0));
          const ep = ocsXY(ext, edge.cx + edge.r * Math.cos(a1), edge.cy + edge.r * Math.sin(a1));
          const sa = Math.atan2(sp.y - c.y, sp.x - c.x);
          const ea = Math.atan2(ep.y - c.y, ep.x - c.x);
          const [startAngle, endAngle] = refl ? [ea, sa] : [sa, ea];
          out.push({ id: freshId(), kind: 'arc', cx: c.x * s, cy: c.y * s, r: edge.r * s, startAngle, endAngle, construction: true });
        } else if (edge.kind === 'ellipse') {
          const c = ocsXY(ext, edge.cx, edge.cy);
          const maj = ocsXY(ext, edge.majorX, edge.majorY);   // major endpoint is RELATIVE to center
          const { rx, ry, rotation } = ellipseAxes(maj.x, maj.y, edge.ratio, s);
          const sp = (edge.startAngle * Math.PI) / 180;
          let epp = (edge.endAngle * Math.PI) / 180;
          while (epp < sp) epp += 2 * Math.PI;               // branch-cut: keep CCW ordering (matches mapEntity)
          const full = isFullEllipse(sp, epp);
          out.push({ id: freshId(), kind: 'ellipse', cx: c.x * s, cy: c.y * s, rx, ry, rotation,
            ...(full ? {} : { startAngle: sp, endAngle: epp }), construction: true });
        } else { // spline
          if (edge.controlPoints.length < 2) { drop('HATCH', 'spline edge with fewer than 2 control points'); continue; }
          const degree = Math.min(edge.degree, edge.controlPoints.length - 1);
          out.push({ id: freshId(), kind: 'spline',
            controlPoints: edge.controlPoints.map((p) => { const q = ocsXY(ext, p.x, p.y); return { x: q.x * s, y: q.y * s }; }),
            degree, closed: edge.closed, construction: true });
        }
      }
    }
  }
  return out;
}
```

---

### Task 1: Parser — polyline boundary loop (with bulge)

**Files:**
- Modify: `packages/shared/src/dxf/types.ts` (add `HatchLoop`, `HatchEdge`, `DxfEntity` HATCH member)
- Modify: `packages/shared/src/dxf/parser.ts` (add `parseHatchLoops` skeleton + polyline branch; add `case 'HATCH':`)
- Test: `packages/shared/src/dxf/parser.spec.ts`

**Interfaces:**
- Produces: `parseHatchLoops(pairs: DxfPair[]): HatchLoop[]`; `readEntity` returns `{ type: 'HATCH'; layer; loops; extrusion? }`. Tasks 2–3 extend `parseHatchLoops`'s edge branch. Task 5 consumes the polyline loop shape.

- [ ] **Step 1: Add the types.** In `types.ts`, add the full `HatchEdge` and `HatchLoop` unions (verbatim from "Reference: types to add" above) and the `| { type: 'HATCH'; layer: string; loops: HatchLoop[]; extrusion?: DxfExtrusion }` member to `DxfEntity`. (Adding all edge kinds now is fine — the parser fills them in later tasks; the union must compile.)

- [ ] **Step 2: Write the failing test** in `parser.spec.ts`:

```ts
it('parses a HATCH with a single closed polyline boundary loop (with bulge)', () => {
  const dxf = entitiesDxf([
    '  0', 'HATCH', '  8', 'H',
    ' 91', '1',                              // 1 boundary path
    ' 92', '3',                              // path type: bit1 (external) + bit2 (polyline) = 3
    ' 72', '1',                              // has bulge
    ' 73', '1',                              // is closed
    ' 93', '3',                              // 3 vertices
    ' 10', '0', ' 20', '0', ' 42', '0',
    ' 10', '10', ' 20', '0', ' 42', '0.5',
    ' 10', '10', ' 20', '10', ' 42', '0',
    ' 97', '0',                              // 0 source objects (boundary section ends)
  ].join('\n'));
  const r = parseDxf(dxf);
  expect(r.entities).toHaveLength(1);
  const e = r.entities[0]!;
  expect(e.type).toBe('HATCH');
  if (e.type === 'HATCH') {
    expect(e.layer).toBe('H');
    expect(e.loops).toHaveLength(1);
    const loop = e.loops[0]!;
    expect(loop.kind).toBe('polyline');
    if (loop.kind === 'polyline') {
      expect(loop.closed).toBe(true);
      expect(loop.vertices).toHaveLength(3);
      expect(loop.vertices[0]).toEqual({ x: 0, y: 0, bulge: 0 });
      expect(loop.vertices[1]).toEqual({ x: 10, y: 0, bulge: 0.5 });
      expect(loop.vertices[2]).toEqual({ x: 10, y: 10, bulge: 0 });
    }
  }
});
```

- [ ] **Step 3: Run test to verify it fails.** `cd packages/shared && npx vitest run src/dxf/parser.spec.ts -t HATCH`. Expected: FAIL — HATCH is dropped (entities length 0) because `readEntity` has no HATCH case.

- [ ] **Step 4: Implement.** In `parser.ts`, add `parseHatchLoops` with the cursor skeleton + the **polyline branch only** (from the reference: the `pathType & 2` block; for the edge `else` branch, leave `loops.push({ kind: 'edges', edges: [] })` as a stub to be filled in Task 2). Add to `readEntity`'s switch:

```ts
    case 'HATCH': {
      const ex = extrusion(raw.pairs);
      return { type: 'HATCH', layer, loops: parseHatchLoops(raw.pairs), ...(ex ? { extrusion: ex } : {}) };
    }
```

- [ ] **Step 5: Run test to verify it passes.** `cd packages/shared && npx vitest run src/dxf/parser.spec.ts -t HATCH`. Expected: PASS.

- [ ] **Step 6: tsc + full shared suite.** `cd packages/shared && npx tsc --noEmit -p tsconfig.json` (expect 0 errors) and `npx vitest run` (expect all green, count grew by 1).

- [ ] **Step 7: Commit.**

```bash
git add packages/shared/src/dxf/types.ts packages/shared/src/dxf/parser.ts packages/shared/src/dxf/parser.spec.ts
git commit -m "feat(dxf): parse HATCH polyline boundary loops (Phase 4c)"
```

---

### Task 2: Parser — edge loops: line + circular-arc edges

**Files:**
- Modify: `packages/shared/src/dxf/parser.ts` (`parseHatchLoops` edge branch: line + arc)
- Test: `packages/shared/src/dxf/parser.spec.ts`

**Interfaces:**
- Consumes: `parseHatchLoops` skeleton from Task 1.
- Produces: edge loops now contain `{ kind: 'line' }` and `{ kind: 'arc' }` edges.

- [ ] **Step 1: Write the failing test** in `parser.spec.ts`:

```ts
it('parses a HATCH edge loop with line + circular-arc edges', () => {
  const dxf = entitiesDxf([
    '  0', 'HATCH', '  8', '0',
    ' 91', '1',
    ' 92', '1',                              // path type: external (bit1), NOT polyline → edge list
    ' 93', '2',                              // 2 edges
    ' 72', '1',                              // edge 1: line
    ' 10', '0', ' 20', '0', ' 11', '10', ' 21', '0',
    ' 72', '2',                              // edge 2: circular arc
    ' 10', '10', ' 20', '0', ' 40', '5',
    ' 50', '0', ' 51', '90', ' 73', '1',     // start 0°, end 90°, ccw
    ' 97', '0',
  ].join('\n'));
  const e = parseDxf(dxf).entities[0]!;
  expect(e.type).toBe('HATCH');
  if (e.type === 'HATCH') {
    expect(e.loops).toHaveLength(1);
    const loop = e.loops[0]!;
    expect(loop.kind).toBe('edges');
    if (loop.kind === 'edges') {
      expect(loop.edges).toHaveLength(2);
      const [l, a] = loop.edges;
      expect(l).toEqual({ kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 });
      expect(a).toEqual({ kind: 'arc', cx: 10, cy: 0, r: 5, startAngle: 0, endAngle: 90, ccw: true });
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails.** `cd packages/shared && npx vitest run src/dxf/parser.spec.ts -t "edge loop with line"`. Expected: FAIL — edge branch is a stub returning `edges: []`.

- [ ] **Step 3: Implement.** Replace the edge `else` stub in `parseHatchLoops` with the real edge loop: read `93` edge count, loop reading `72` edge type, and handle `etype === 1` (line) and `etype === 2` (arc) per the reference. For `etype === 3 || etype === 4`, leave a `break;` placeholder (filled in Task 3) so an unknown type doesn't desync — but since tests here only use 1 and 2, this is fine. Keep the unrecognised-type `break`.

- [ ] **Step 4: Run test to verify it passes.** `cd packages/shared && npx vitest run src/dxf/parser.spec.ts -t "edge loop with line"`. Expected: PASS.

- [ ] **Step 5: Full shared suite + tsc.** `cd packages/shared && npx vitest run && npx tsc --noEmit -p tsconfig.json`. Expect all green, 0 tsc errors.

- [ ] **Step 6: Commit.**

```bash
git add packages/shared/src/dxf/parser.ts packages/shared/src/dxf/parser.spec.ts
git commit -m "feat(dxf): parse HATCH line + arc edge loops (Phase 4c)"
```

---

### Task 3: Parser — edge loops: elliptic-arc + spline edges

**Files:**
- Modify: `packages/shared/src/dxf/parser.ts` (`parseHatchLoops` edge branch: ellipse + spline)
- Test: `packages/shared/src/dxf/parser.spec.ts`

**Interfaces:**
- Produces: edge loops now also contain `{ kind: 'ellipse' }` and `{ kind: 'spline' }` edges. `parseHatchLoops` is now complete (matches the full reference).

- [ ] **Step 1: Write the failing test** in `parser.spec.ts`:

```ts
it('parses a HATCH edge loop with elliptic-arc + spline edges', () => {
  const dxf = entitiesDxf([
    '  0', 'HATCH', '  8', '0',
    ' 91', '1',
    ' 92', '1',                              // edge list
    ' 93', '2',                              // 2 edges
    ' 72', '3',                              // edge 1: elliptic arc
    ' 10', '0', ' 20', '0',                  // center
    ' 11', '4', ' 21', '0',                  // major endpoint relative to center
    ' 40', '0.5',                            // minor/major ratio
    ' 50', '0', ' 51', '180', ' 73', '1',    // 0°→180° ccw
    ' 72', '4',                              // edge 2: spline
    ' 94', '2',                              // degree
    ' 73', '0',                              // rational flag (non-rational)
    ' 74', '0',                              // periodic flag
    ' 95', '5',                              // knot count
    ' 96', '3',                              // control-point count
    ' 40', '0', ' 40', '0', ' 40', '0.5', ' 40', '1', ' 40', '1',   // 5 knots
    ' 10', '0', ' 20', '0',
    ' 10', '5', ' 20', '5',
    ' 10', '10', ' 20', '0',                 // 3 control points
    ' 97', '0',
  ].join('\n'));
  const e = parseDxf(dxf).entities[0]!;
  expect(e.type).toBe('HATCH');
  if (e.type === 'HATCH') {
    const loop = e.loops[0]!;
    expect(loop.kind).toBe('edges');
    if (loop.kind === 'edges') {
      expect(loop.edges).toHaveLength(2);
      const [el, sp] = loop.edges;
      expect(el).toEqual({ kind: 'ellipse', cx: 0, cy: 0, majorX: 4, majorY: 0, ratio: 0.5,
        startAngle: 0, endAngle: 180, ccw: true });
      expect(sp!.kind).toBe('spline');
      if (sp!.kind === 'spline') {
        expect(sp!.degree).toBe(2);
        expect(sp!.closed).toBe(false);
        expect(sp!.knots).toEqual([0, 0, 0.5, 1, 1]);
        expect(sp!.controlPoints).toEqual([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }]);
        expect(sp!.weights).toBeUndefined();
      }
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails.** `cd packages/shared && npx vitest run src/dxf/parser.spec.ts -t "elliptic-arc + spline"`. Expected: FAIL — the ellipse/spline branches are placeholders (`break`), so edges length is 0 or wrong.

- [ ] **Step 3: Implement.** Replace the `etype === 3` and `etype === 4` placeholders in `parseHatchLoops` with the full ellipse and spline branches from the reference. `parseHatchLoops` now matches the complete reference function.

- [ ] **Step 4: Run test to verify it passes.** `cd packages/shared && npx vitest run src/dxf/parser.spec.ts -t "elliptic-arc + spline"`. Expected: PASS.

- [ ] **Step 5: Add a defensiveness test** (malformed loop must not throw):

```ts
it('does not throw on a malformed HATCH (truncated edge loop)', () => {
  const dxf = entitiesDxf([
    '  0', 'HATCH', '  8', '0',
    ' 91', '1', ' 92', '1', ' 93', '2',
    ' 72', '1', ' 10', '0', ' 20', '0',      // line edge truncated mid-way; stream ends
  ].join('\n'));
  expect(() => parseDxf(dxf)).not.toThrow();
  const e = parseDxf(dxf).entities[0]!;
  expect(e.type).toBe('HATCH');
});
```

Run it — expect PASS (the `take`/`seek` cursor returns 0/undefined past the end, never throws). If it fails, harden the cursor (it should already be safe by construction).

- [ ] **Step 6: Full shared suite + tsc.** `cd packages/shared && npx vitest run && npx tsc --noEmit -p tsconfig.json`. Expect all green, 0 tsc errors.

- [ ] **Step 7: Commit.**

```bash
git add packages/shared/src/dxf/parser.ts packages/shared/src/dxf/parser.spec.ts
git commit -m "feat(dxf): parse HATCH ellipse + spline edge loops (Phase 4c)"
```

---

### Task 4: Extract `ellipseAxes` helper (refactor, no behavior change)

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts` (extract helper; rewire ELLIPSE branch of `mapEntity`)
- Test: `packages/shared/src/dxf/toSketch.spec.ts` (existing ELLIPSE tests are the regression guard; add one direct unit test)

**Interfaces:**
- Produces: `function ellipseAxes(majX: number, majY: number, ratio: number, s: number): { rx: number; ry: number; rotation: number }` where `majX`/`majY` are the **already OCS-mapped** major-endpoint coordinates (output of `ocsXY`). Consumed by `mapEntity` ELLIPSE branch (this task) and `expandHatch` ellipse edge (Task 7).

- [ ] **Step 1: Write the failing test** in `toSketch.spec.ts` (direct helper coverage):

```ts
it('ellipseAxes computes rx/ry/rotation from a mapped major endpoint', () => {
  // major endpoint (3,4) → length 5; ratio 0.5 → ry 2.5; rotation atan2(4,3); unit scale 2 → rx 10, ry 5
  const { rx, ry, rotation } = ellipseAxes(3, 4, 0.5, 2);
  expect(rx).toBeCloseTo(10, 9);
  expect(ry).toBeCloseTo(5, 9);
  expect(rotation).toBeCloseTo(Math.atan2(4, 3), 9);
});
```

To call it from the test, `ellipseAxes` must be exported. Export it: `export function ellipseAxes(...)`.

- [ ] **Step 2: Run test to verify it fails.** `cd packages/shared && npx vitest run src/dxf/toSketch.spec.ts -t ellipseAxes`. Expected: FAIL — `ellipseAxes` is not defined/exported.

- [ ] **Step 3: Implement the helper and rewire `mapEntity`.** Add near the other helpers in `toSketch.ts`:

```ts
/** Major-axis endpoint (OCS-mapped, relative to center) + ratio → sketch ellipse rx/ry/rotation.
 * Shared by the standalone ELLIPSE path and the HATCH ellipse-edge path. */
export function ellipseAxes(majX: number, majY: number, ratio: number, s: number): { rx: number; ry: number; rotation: number } {
  const rx = Math.hypot(majX, majY) * s;
  return { rx, ry: rx * ratio, rotation: Math.atan2(majY, majX) };
}
```

Then replace the three computed lines in `mapEntity`'s ELLIPSE branch:

```ts
// BEFORE:
      const maj = ocsXY(e.extrusion, e.majorX, e.majorY);
      const rx = Math.hypot(maj.x, maj.y) * s;
      const ry = rx * e.ratio;
      const rotation = Math.atan2(maj.y, maj.x);
// AFTER:
      const maj = ocsXY(e.extrusion, e.majorX, e.majorY);
      const { rx, ry, rotation } = ellipseAxes(maj.x, maj.y, e.ratio, s);
```

(Leave the rest of the ELLIPSE branch — `isFullEllipse`, branch-cut `endParam` normalization — unchanged.)

- [ ] **Step 4: Run the new test + all existing ELLIPSE tests (regression guard).** `cd packages/shared && npx vitest run src/dxf/toSketch.spec.ts -t ellipse` and `-t ELLIPSE` and `-t ellipseAxes`. Expected: ALL PASS (behavior unchanged for standalone ELLIPSE).

- [ ] **Step 5: Full shared suite + tsc.** `cd packages/shared && npx vitest run && npx tsc --noEmit -p tsconfig.json`. Expect all green (count +1 from the helper test), 0 tsc errors.

- [ ] **Step 6: Commit.**

```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/toSketch.spec.ts
git commit -m "refactor(dxf): extract ellipseAxes helper from mapEntity (Phase 4c)"
```

---

### Task 5: `expandHatch` — polyline loops → construction primitives

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts` (add `expandHatch` with polyline branch only; wire into the `toSketch` main loop)
- Test: `packages/shared/src/dxf/toSketch.spec.ts`

**Interfaces:**
- Consumes: `expandPolyline`, `segment`, `ocsXY`, `ocsReflected`, `freshId`; the `DxfHatch` polyline loop shape (Task 1).
- Produces: `function expandHatch(e, s, drop): SketchPrimitive[]`; dispatched in `toSketch` main loop. Tasks 6–7 extend the edge branch; Task 8 adds the `expandInsert` dispatch.

- [ ] **Step 1: Write the failing test** in `toSketch.spec.ts`:

```ts
it('expands a HATCH polyline loop to closed construction segments (bulge → arc)', () => {
  const r = toSketch(parseDxf(ents([
    '  0', 'HATCH', '  8', '0',
    ' 91', '1', ' 92', '3', ' 72', '1', ' 73', '1', ' 93', '3',
    ' 10', '0', ' 20', '0', ' 42', '0',
    ' 10', '10', ' 20', '0', ' 42', '0.5',
    ' 10', '10', ' 20', '10', ' 42', '0',
    ' 97', '0',
  ].join('\n'))));
  // closed polyline with 3 vertices → 3 segments (last closes back to v0)
  expect(r.primitives).toHaveLength(3);
  expect(r.primitives.every((p) => p.construction === true)).toBe(true);
  const kinds = r.primitives.map((p) => p.kind).sort();
  expect(kinds).toEqual(['arc', 'line', 'line']);   // the bulge=0.5 segment becomes an arc
});
```

- [ ] **Step 2: Run test to verify it fails.** `cd packages/shared && npx vitest run src/dxf/toSketch.spec.ts -t "HATCH polyline loop"`. Expected: FAIL — HATCH not dispatched in `toSketch`, so 0 primitives (and it's tallied in `dropped`).

- [ ] **Step 3: Implement.** Add `expandHatch` to `toSketch.ts` with the **polyline branch only** (from the reference; for `loop.kind === 'edges'` leave an empty `// edges: Task 6/7` no-op for now). Wire into the `toSketch` main loop — add this block alongside the existing SOLID/3DFACE dispatch (before the `LWPOLYLINE` handling is fine; HATCH is distinct):

```ts
    if (e.type === 'HATCH') {
      primitives.push(...expandHatch(e, s, drop));
      continue;
    }
```

- [ ] **Step 4: Run test to verify it passes.** `cd packages/shared && npx vitest run src/dxf/toSketch.spec.ts -t "HATCH polyline loop"`. Expected: PASS.

- [ ] **Step 5: Full shared suite + tsc.** `cd packages/shared && npx vitest run && npx tsc --noEmit -p tsconfig.json`. Expect all green, 0 tsc errors.

- [ ] **Step 6: Commit.**

```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/toSketch.spec.ts
git commit -m "feat(dxf): expand HATCH polyline loops to construction geometry (Phase 4c)"
```

---

### Task 6: `expandHatch` — line + arc edges → construction

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts` (`expandHatch` edge branch: line + arc)
- Test: `packages/shared/src/dxf/toSketch.spec.ts`

**Interfaces:**
- Produces: edge-loop HATCH now emits `line` and `arc` construction primitives.

- [ ] **Step 1: Write the failing test** in `toSketch.spec.ts`:

```ts
it('expands a HATCH edge loop (line + arc) to construction primitives', () => {
  const r = toSketch(parseDxf(ents([
    '  0', 'HATCH', '  8', '0',
    ' 91', '1', ' 92', '1', ' 93', '2',
    ' 72', '1', ' 10', '0', ' 20', '0', ' 11', '10', ' 21', '0',
    ' 72', '2', ' 10', '10', ' 20', '0', ' 40', '5', ' 50', '0', ' 51', '90', ' 73', '1',
    ' 97', '0',
  ].join('\n'))));
  expect(r.primitives).toHaveLength(2);
  expect(r.primitives.every((p) => p.construction === true)).toBe(true);
  const line = r.primitives.find((p) => p.kind === 'line')!;
  if (line.kind === 'line') expect([line.x1, line.y1, line.x2, line.y2]).toEqual([0, 0, 10, 0]);
  const arc = r.primitives.find((p) => p.kind === 'arc')!;
  if (arc.kind === 'arc') {
    expect(arc.cx).toBeCloseTo(10, 9);
    expect(arc.cy).toBeCloseTo(0, 9);
    expect(arc.r).toBeCloseTo(5, 9);
    expect(arc.startAngle).toBeCloseTo(0, 9);
    expect(arc.endAngle).toBeCloseTo(Math.PI / 2, 9);
  }
});
```

- [ ] **Step 2: Run test to verify it fails.** `cd packages/shared && npx vitest run src/dxf/toSketch.spec.ts -t "edge loop (line + arc)"`. Expected: FAIL — edge branch is a no-op, 0 primitives.

- [ ] **Step 3: Implement.** Fill the `loop.kind === 'edges'` branch of `expandHatch` with the `edge.kind === 'line'` and `edge.kind === 'arc'` cases from the reference (leave `ellipse`/`spline` as a no-op `else { /* Task 7 */ }` or guarded `continue` for now).

- [ ] **Step 4: Run test to verify it passes.** `cd packages/shared && npx vitest run src/dxf/toSketch.spec.ts -t "edge loop (line + arc)"`. Expected: PASS.

- [ ] **Step 5: Full shared suite + tsc.** `cd packages/shared && npx vitest run && npx tsc --noEmit -p tsconfig.json`. Expect all green, 0 tsc errors.

- [ ] **Step 6: Commit.**

```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/toSketch.spec.ts
git commit -m "feat(dxf): expand HATCH line + arc edges to construction (Phase 4c)"
```

---

### Task 7: `expandHatch` — ellipse + spline edges → construction (reuse `ellipseAxes`)

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts` (`expandHatch` edge branch: ellipse + spline)
- Test: `packages/shared/src/dxf/toSketch.spec.ts`

**Interfaces:**
- Consumes: `ellipseAxes` (Task 4), `isFullEllipse`.
- Produces: edge-loop HATCH now emits `ellipse` and `spline` construction primitives. `expandHatch` is now complete (matches the full reference).

- [ ] **Step 1: Write the failing test** in `toSketch.spec.ts`:

```ts
it('expands HATCH ellipse + spline edges to construction primitives', () => {
  const r = toSketch(parseDxf(ents([
    '  0', 'HATCH', '  8', '0',
    ' 91', '1', ' 92', '1', ' 93', '2',
    ' 72', '3', ' 10', '0', ' 20', '0', ' 11', '4', ' 21', '0', ' 40', '0.5',
    ' 50', '0', ' 51', '180', ' 73', '1',
    ' 72', '4', ' 94', '2', ' 73', '0', ' 74', '0', ' 95', '5', ' 96', '3',
    ' 40', '0', ' 40', '0', ' 40', '0.5', ' 40', '1', ' 40', '1',
    ' 10', '0', ' 20', '0', ' 10', '5', ' 20', '5', ' 10', '10', ' 20', '0',
    ' 97', '0',
  ].join('\n'))));
  expect(r.primitives).toHaveLength(2);
  expect(r.primitives.every((p) => p.construction === true)).toBe(true);
  const ell = r.primitives.find((p) => p.kind === 'ellipse')!;
  if (ell.kind === 'ellipse') {
    expect(ell.cx).toBeCloseTo(0, 9);
    expect(ell.cy).toBeCloseTo(0, 9);
    expect(ell.rx).toBeCloseTo(4, 9);              // major length 4, unit scale 1
    expect(ell.ry).toBeCloseTo(2, 9);              // ratio 0.5
    expect(ell.rotation).toBeCloseTo(0, 9);
    expect(ell.startAngle).toBeCloseTo(0, 9);
    expect(ell.endAngle).toBeCloseTo(Math.PI, 9);  // 180° → π
  }
  const sp = r.primitives.find((p) => p.kind === 'spline')!;
  if (sp.kind === 'spline') {
    expect(sp.degree).toBe(2);
    expect(sp.closed).toBe(false);
    expect(sp.controlPoints).toEqual([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }]);
  }
});
```

- [ ] **Step 2: Run test to verify it fails.** `cd packages/shared && npx vitest run src/dxf/toSketch.spec.ts -t "ellipse + spline edges"`. Expected: FAIL — ellipse/spline edges are a no-op, so only 0 primitives (or fewer than 2).

- [ ] **Step 3: Implement.** Fill the `edge.kind === 'ellipse'` and `edge.kind === 'spline'` cases from the reference. `expandHatch` now matches the complete reference function.

- [ ] **Step 4: Run test to verify it passes.** `cd packages/shared && npx vitest run src/dxf/toSketch.spec.ts -t "ellipse + spline edges"`. Expected: PASS.

- [ ] **Step 5: Full shared suite + tsc.** `cd packages/shared && npx vitest run && npx tsc --noEmit -p tsconfig.json`. Expect all green, 0 tsc errors.

- [ ] **Step 6: Commit.**

```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/toSketch.spec.ts
git commit -m "feat(dxf): expand HATCH ellipse + spline edges to construction (Phase 4c)"
```

---

### Task 8: Dispatch HATCH inside `expandInsert` (block-nested)

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts` (`expandInsert` block-body dispatch)
- Test: `packages/shared/src/dxf/toSketch.spec.ts`

**Interfaces:**
- Consumes: `expandHatch` (Tasks 5–7).
- Produces: a HATCH inside a block referenced by an INSERT is expanded under the insert transform.

- [ ] **Step 1: Write the failing test** in `toSketch.spec.ts`. (Use the existing block fixture pattern in this spec — find an existing INSERT/BLOCK test and mirror its `BLOCKS` section construction.) A self-contained version:

```ts
it('expands a HATCH nested inside a block via INSERT', () => {
  const dxf = [
    '  0', 'SECTION', '  2', 'BLOCKS',
    '  0', 'BLOCK', '  2', 'HB', ' 10', '0', ' 20', '0',
    '  0', 'HATCH', '  8', '0',
    ' 91', '1', ' 92', '1', ' 93', '1',
    ' 72', '1', ' 10', '0', ' 20', '0', ' 11', '10', ' 21', '0',
    ' 97', '0',
    '  0', 'ENDBLK',
    '  0', 'ENDSEC',
    '  0', 'SECTION', '  2', 'ENTITIES',
    '  0', 'INSERT', '  2', 'HB', ' 10', '100', ' 20', '0',
    '  0', 'ENDSEC', '  0', 'EOF',
  ].join('\n');
  const r = toSketch(parseDxf(dxf));
  expect(r.primitives).toHaveLength(1);
  const p = r.primitives[0]!;
  expect(p.kind).toBe('line');
  expect(p.construction).toBe(true);
  // INSERT at (100,0) shifts the block-local line (0,0)→(10,0) to (100,0)→(110,0)
  if (p.kind === 'line') {
    expect(p.x1).toBeCloseTo(100, 9);
    expect(p.x2).toBeCloseTo(110, 9);
  }
});
```

> If the existing spec already has a block-building helper (e.g. a `blocksDxf(...)`), prefer it for consistency. Verify the `BLOCK` group-code shape against an existing passing INSERT test in this file before running.

- [ ] **Step 2: Run test to verify it fails.** `cd packages/shared && npx vitest run src/dxf/toSketch.spec.ts -t "HATCH nested inside a block"`. Expected: FAIL — `expandInsert` doesn't handle `be.type === 'HATCH'`, so the HATCH in the block body falls through to `mapEntity`, which drops it (0 primitives, or tallied in `dropped`).

- [ ] **Step 3: Implement.** In `expandInsert`'s block-body `for (const be of body)` dispatch chain, add a branch alongside the existing SOLID / 3DFACE branches:

```ts
    } else if (be.type === 'HATCH') {
      blockPrims.push(...expandHatch(be, 1, drop));
```

(Scale `1` inside the block frame; the outer matrix + document scale `s` are applied afterward, exactly like the SOLID / 3DFACE branches.)

- [ ] **Step 4: Run test to verify it passes.** `cd packages/shared && npx vitest run src/dxf/toSketch.spec.ts -t "HATCH nested inside a block"`. Expected: PASS.

- [ ] **Step 5: Full shared suite + tsc.** `cd packages/shared && npx vitest run && npx tsc --noEmit -p tsconfig.json`. Expect all green, 0 tsc errors.

- [ ] **Step 6: Commit.**

```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/toSketch.spec.ts
git commit -m "feat(dxf): dispatch HATCH inside expandInsert block bodies (Phase 4c)"
```

---

### Task 9: e2e — import a real DXF containing a HATCH

**Files:**
- Create: `tests/e2e/drawing/dxf-hatch-import.spec.ts`
- (Reuse whatever DXF-import fixture/flow the prior 4c e2e specs use — `tests/e2e/drawing/` already has 3DFACE/RAY/XLINE and DIMENSION import specs.)

**Interfaces:**
- Consumes: the full HATCH pipeline (parse → toSketch). Asserts via `window.__zilventorStore` (headless viewport is BLACK).

- [ ] **Step 1: Read an existing 4c e2e import spec** to copy the exact import flow + store-assertion pattern. Run: `ls tests/e2e/drawing/` and open the most recent (e.g. the 3DFACE/RAY/XLINE spec from commit `23a12553`, or the DIMENSION spec). Identify: how it loads a DXF string/file into the app, how it triggers DXF→sketch import, and how it reads imported primitives back from `window.__zilventorStore`.

- [ ] **Step 2: Write the e2e test** mirroring that pattern. The DXF payload should contain at least one HATCH with a polyline loop AND one with an edge loop (line+arc). Assert:
  - imported sketch contains construction primitives whose count matches expectation (e.g. ≥ the segment + edge count);
  - every HATCH-derived primitive has `construction === true`;
  - **0 console errors** during import (capture via `page.on('console', ...)` / `page.on('pageerror', ...)` as the existing specs do).

- [ ] **Step 3: Run the e2e.** From repo root: `npx playwright test --project=chromium tests/e2e/drawing/dxf-hatch-import.spec.ts`. Expected: PASS, 0 console errors.

- [ ] **Step 4: Commit.**

```bash
git add tests/e2e/drawing/dxf-hatch-import.spec.ts
git commit -m "test(dxf): e2e import of HATCH boundary loops (Phase 4c)"
```

---

## Final Gate (run after Task 9, before reporting done)

- [ ] `cd packages/shared && npx tsc --noEmit -p tsconfig.json` → **0 errors**.
- [ ] App tsc (root): the project's app typecheck → **0 errors** (HATCH is additive; verify no union-exhaustiveness break in app consumers of `SketchPrimitive` / `DxfEntity`).
- [ ] `cd packages/shared && npx vitest run` → **all green** (baseline ~1227 + new tests).
- [ ] DXF lint clean: run the repo's lint over `packages/shared/src/dxf/`.
- [ ] e2e green in real Chromium (Task 9).
- [ ] **Manifest untouched at v32** — `grep` for any accidental version bump in this diff; there must be none.
- [ ] Known-flaky app-suite `frameToModel` teardown tests are pre-existing — not introduced by this slice.

---

## Self-Review (against the spec)

**Spec coverage:**
- §1 parser cursor walk + polyline + 4 edge types → Tasks 1–3. ✅
- §1 GOTCHA (deg angles) → documented in Global Constraints + handled in `expandHatch` (deg→rad). ✅
- §1 defensiveness (skip, never throw) → Task 3 Step 5 test + cursor design. ✅
- §2 `expandHatch` polyline/line/arc/ellipse/spline → Tasks 5–7. ✅
- §2 dispatch in main loop → Task 5; in `expandInsert` → Task 8. ✅
- §2 targeted ellipse-axes refactor (regression-guarded) → Task 4. ✅
- §3 9 TDD slices → Tasks 1–9 (1:1 mapping). ✅
- Constants (construction true, OCS+scale, no manifest bump, confined files) → Global Constraints + per-task. ✅

**Placeholder scan:** every code step has complete code; the only deferred items are the explicitly-staged branch fills (Task 2/3/6/7 extend prior tasks' functions) — these are real TDD increments, not placeholders. The e2e (Task 9) intentionally defers the exact import-flow lines to the existing 4c e2e pattern, because that flow must be copied verbatim from the current specs rather than guessed — Step 1 of Task 9 makes that explicit.

**Type consistency:** `parseHatchLoops` (parser) ↔ `HatchLoop`/`HatchEdge` (types) ↔ `expandHatch` consumers all use identical field names (`startAngle`/`endAngle`/`ccw`/`majorX`/`majorY`/`ratio`/`controlPoints`/`knots`/`weights?`). `ellipseAxes(majX, majY, ratio, s)` signature is identical in Task 4 (producer) and Task 7 (consumer). ✅
