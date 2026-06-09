# Sketch Productivity Tools — Slice 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use `superpowers:test-driven-development` for every task. **Plan code snippets are REFERENCE, not literal** — verify every identifier, signature, and import against the real file before re-emitting. Never hand-author intersection coordinates in tool tests — always drive the real `intersect.ts` output through the tool.

**Goal:** Add five Inventor-2012-parity 2D sketch tools to ZilInventor: Trim, Extend, Project Geometry (straight-edge MVP), plus close slice-1 debt: Fillet coincident pin and multi-segment/loop Offset. Ship with a non-trivial e2e that clicks the real canvas — no `kernelAddSketch` bypass.

**Architecture:** Pure-app-side. A new `sketcher/geometry/intersect.ts` module (line-line, line-circle, line-arc) is the shared math foundation. Trim splits or shortens a picked primitive. Extend elongates a picked endpoint to the nearest crossing. Project Geometry dot-products 3D edge endpoints into sketch-plane UV and emits an ordinary line. Fillet gets two `coincident` constraints pinning arc ends to trimmed line ends. Multi-segment offset walks a connected chain and miter-joins neighbors via `intersect.ts`.

**Tech Stack:** TypeScript, pnpm monorepo. `packages/app` only. Vitest (jsdom, run from `packages/app/`). Playwright e2e in `tests/e2e/`. **No shared/kernel changes. No manifest bump (stays v20).**

**Spec:** `docs/superpowers/specs/2026-06-09-sketch-productivity-tools-slice2-design.md`

---

## Test-running gotchas (apply to every test step)

- **App tests (jsdom):** `cd packages/app && npx vitest run <relative-path-from-packages/app>`. Config at `packages/app/vitest.config.ts`.
- **Never** run from the repo root — output is silenced.
- **Bash cwd persists across compound commands.** Always re-`cd` per package in separate Bash calls.
- **e2e:** `cd tests/e2e && npx playwright test <file>` (or `npx playwright test` from repo root).
- **FALSE-GREEN GUARD (mandatory):** Every `intersect.ts` unit test uses analytically-known answers (e.g. line y=0 vs circle r=5 at origin → hits at x=±5). Every Trim/Extend/multi-segment-Offset tool test drives the **real** `intersect.ts` output through the tool — never feed hand-authored intersection coordinates.

## File-touch map

| File | Responsibility | Tasks |
|---|---|---|
| `packages/app/src/sketcher/geometry/intersect.ts` (**new**) | line-line, line-circle, line-arc intersection math | T0 |
| `packages/app/src/sketcher/geometry/__tests__/intersect.spec.ts` (**new**) | analytic unit tests | T0 |
| `packages/app/src/sketcher/tools/TrimTool.ts` (**new**) | trim interaction | T1 |
| `packages/app/src/sketcher/tools/__tests__/TrimTool.spec.ts` (**new**) | tool tests using real intersect output | T1 |
| `packages/app/src/sketcher/tools/ExtendTool.ts` (**new**) | extend interaction | T2 |
| `packages/app/src/sketcher/tools/__tests__/ExtendTool.spec.ts` (**new**) | tool tests using real intersect output | T2 |
| `packages/app/src/sketcher/geometry/projectToSketch.ts` (**new**) | 3D→UV projection math | T3 |
| `packages/app/src/sketcher/tools/ProjectGeometryTool.ts` (**new**) | project-geometry interaction | T3 |
| `packages/app/src/sketcher/tools/__tests__/ProjectGeometryTool.spec.ts` (**new**) | unit tests with known frames | T3 |
| `packages/app/src/sketcher/tools/FilletTool.ts` | add two `coincident` constraints | T4 |
| `packages/app/src/sketcher/tools/__tests__/FilletTool.spec.ts` | extend tests for coincident constraints | T4 |
| `packages/app/src/sketcher/geometry/offset.ts` | chain discovery + corner miter | T5 |
| `packages/app/src/sketcher/geometry/__tests__/offset.spec.ts` | chain/loop offset tests | T5 |
| `packages/app/src/sketcher/tools/OffsetTool.ts` | multi-segment commit path | T5 |
| `packages/app/src/sketcher/ActiveToolController.ts` | ToolKind union + instantiate + handlePointer branches | T6 |
| `packages/app/src/store/useAppStore.ts` | ToolKind union (kept in sync manually) | T6 |
| `packages/app/src/shell/tabs/SketchTab.tsx` | Trim, Extend, Project Geometry ribbon buttons | T6 |
| `tests/e2e/sketch-productivity-tools-slice2.spec.ts` (**new**) | real-canvas trim + project e2e | T7 |

---

## Task 0 — `geometry/intersect.ts` (load-bearing foundation)

**Files:**
- Create: `packages/app/src/sketcher/geometry/intersect.ts`
- Create: `packages/app/src/sketcher/geometry/__tests__/intersect.spec.ts`

### Step 0-A: Write the failing tests

Create `packages/app/src/sketcher/geometry/__tests__/intersect.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { intersect } from '../intersect';

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 4);

// FALSE-GREEN GUARD: all expected values are derived analytically, not by
// running intersect.ts first and copying its output.

describe('intersect — line-line', () => {
  it('two crossing lines at origin: x-axis and y-axis intersect at (0,0)', () => {
    const la = { id: 'a', kind: 'line' as const, x1: -5, y1: 0, x2: 5, y2: 0 };
    const lb = { id: 'b', kind: 'line' as const, x1: 0, y1: -5, x2: 0, y2: 5 };
    const hits = intersect(la, lb);
    expect(hits).toHaveLength(1);
    near(hits[0]!.x, 0); near(hits[0]!.y, 0);
    near(hits[0]!.tA, 0.5); // midpoint of la
    near(hits[0]!.tB, 0.5); // midpoint of lb
  });

  it('parallel lines produce no hits', () => {
    const la = { id: 'a', kind: 'line' as const, x1: 0, y1: 0, x2: 10, y2: 0 };
    const lb = { id: 'b', kind: 'line' as const, x1: 0, y1: 1, x2: 10, y2: 1 };
    expect(intersect(la, lb)).toHaveLength(0);
  });

  it('non-overlapping collinear extension (T not in [0,1]) produces no hits', () => {
    // la from x=-10 to x=0; lb from x=5 to x=15 — disjoint on x-axis
    const la = { id: 'a', kind: 'line' as const, x1: -10, y1: 0, x2: 0, y2: 0 };
    const lb = { id: 'b', kind: 'line' as const, x1: 5, y1: 0, x2: 15, y2: 0 };
    expect(intersect(la, lb)).toHaveLength(0);
  });

  it('diagonal lines crossing at (5,5)', () => {
    const la = { id: 'a', kind: 'line' as const, x1: 0, y1: 0, x2: 10, y2: 10 };
    const lb = { id: 'b', kind: 'line' as const, x1: 0, y1: 10, x2: 10, y2: 0 };
    const hits = intersect(la, lb);
    expect(hits).toHaveLength(1);
    near(hits[0]!.x, 5); near(hits[0]!.y, 5);
    near(hits[0]!.tA, 0.5); near(hits[0]!.tB, 0.5);
  });
});

describe('intersect — line-circle (symmetric coverage)', () => {
  // Circle centered at origin, r=5.  Horizontal line y=0 through center.
  // Analytic: x = ±5 → tA = 0 (x=-5) and tA = 1 (x=5) when line is x1=-5 to x2=5.
  it('line through circle center hits at both poles (x=±5)', () => {
    const line = { id: 'l', kind: 'line' as const, x1: -5, y1: 0, x2: 5, y2: 0 };
    const circle = { id: 'c', kind: 'circle' as const, cx: 0, cy: 0, r: 5 };
    const hits = intersect(line, circle);
    expect(hits).toHaveLength(2);
    const xs = hits.map((h) => h.x).sort((a, b) => a - b);
    near(xs[0]!, -5); near(xs[1]!, 5);
    hits.forEach((h) => near(h.y, 0));
  });

  it('tangent line (y=5) hits exactly one point', () => {
    const line = { id: 'l', kind: 'line' as const, x1: -5, y1: 5, x2: 5, y2: 5 };
    const circle = { id: 'c', kind: 'circle' as const, cx: 0, cy: 0, r: 5 };
    const hits = intersect(line, circle);
    expect(hits).toHaveLength(1);
    near(hits[0]!.x, 0); near(hits[0]!.y, 5);
  });

  it('line outside circle (y=6) has no hits', () => {
    const line = { id: 'l', kind: 'line' as const, x1: -5, y1: 6, x2: 5, y2: 6 };
    const circle = { id: 'c', kind: 'circle' as const, cx: 0, cy: 0, r: 5 };
    expect(intersect(line, circle)).toHaveLength(0);
  });

  it('circle-line is symmetric with line-circle', () => {
    const line   = { id: 'l', kind: 'line' as const, x1: -5, y1: 0, x2: 5, y2: 0 };
    const circle = { id: 'c', kind: 'circle' as const, cx: 0, cy: 0, r: 5 };
    const fwd = intersect(line, circle);
    const rev = intersect(circle, line);
    expect(fwd).toHaveLength(rev.length);
    fwd.forEach((h, i) => {
      near(h.x, rev[i]!.x); near(h.y, rev[i]!.y);
    });
  });
});

describe('intersect — line-arc (CCW convention guard)', () => {
  // Arc: center (0,0), r=5, startAngle=0 (point (5,0)), endAngle=π/2 (point (0,5)).
  // That is the quarter-circle in the first quadrant.
  // Line y=0 (horizontal, x=-5 to x=5) hits the arc at (5,0) — angle 0, which is
  // the start endpoint — in range [0, π/2] ✓.
  // Line y=0 also hits the arc conceptually at x=-5 (angle=π) — angle π is NOT in
  // [0, π/2], so it must be REJECTED by arc filtering.
  it('line hits arc endpoint at startAngle (angle in range)', () => {
    const line = { id: 'l', kind: 'line' as const, x1: -5, y1: 0, x2: 5, y2: 0 };
    const arc  = { id: 'a', kind: 'arc' as const, cx: 0, cy: 0, r: 5, startAngle: 0, endAngle: Math.PI / 2 };
    const hits = intersect(line, arc);
    expect(hits).toHaveLength(1);
    near(hits[0]!.x, 5); near(hits[0]!.y, 0);
    near(hits[0]!.tB, 0); // angle 0 = startAngle, normalized tB = 0/(π/2) = 0
  });

  it('line misses arc because hit angle is outside [start,end]', () => {
    // Line y=0 hits the full circle at x=±5.
    // Arc covers only [π, 3π/2] (third quadrant).
    // x=5 → angle=0 (not in [π, 3π/2]). x=-5 → angle=π which IS the start.
    const line = { id: 'l', kind: 'line' as const, x1: -5, y1: 0, x2: 5, y2: 0 };
    const arc  = { id: 'a', kind: 'arc' as const, cx: 0, cy: 0, r: 5, startAngle: Math.PI, endAngle: 3 * Math.PI / 2 };
    const hits = intersect(line, arc);
    // x=-5 angle=π IS in [π, 3π/2] → 1 hit; x=5 angle=0 is NOT → rejected.
    expect(hits).toHaveLength(1);
    near(hits[0]!.x, -5); near(hits[0]!.y, 0);
  });

  it('line fully misses arc (no qualifying angles)', () => {
    // Line x=10 (vertical, far right) — no intersection with circle r=5.
    const line = { id: 'l', kind: 'line' as const, x1: 10, y1: -5, x2: 10, y2: 5 };
    const arc  = { id: 'a', kind: 'arc' as const, cx: 0, cy: 0, r: 5, startAngle: 0, endAngle: Math.PI / 2 };
    expect(intersect(line, arc)).toHaveLength(0);
  });

  it('arc-line symmetric with line-arc', () => {
    const line = { id: 'l', kind: 'line' as const, x1: -5, y1: 0, x2: 5, y2: 0 };
    const arc  = { id: 'a', kind: 'arc' as const, cx: 0, cy: 0, r: 5, startAngle: 0, endAngle: Math.PI / 2 };
    const fwd = intersect(line, arc);
    const rev = intersect(arc, line);
    expect(fwd).toHaveLength(rev.length);
    fwd.forEach((h, i) => { near(h.x, rev[i]!.x); near(h.y, rev[i]!.y); });
  });
});
```

- [ ] **Step 0-B: Run and confirm FAIL**

```bash
cd packages/app && npx vitest run src/sketcher/geometry/__tests__/intersect.spec.ts
```

Expected failure: `Cannot find module '../intersect'` (file doesn't exist yet).

### Step 0-C: Implement `intersect.ts`

Create `packages/app/src/sketcher/geometry/intersect.ts`:

```ts
import type { SketchPrimitive } from '@zilventor/shared';

/**
 * A point of intersection between two primitives.
 * tA = parameter along primitive A:
 *   - line: fractional [0,1] along the segment.
 *   - arc (as A): normalized fractional [0,1] within [startAngle, endAngle] (0=start, 1=end).
 *   - circle (as A): raw atan2 angle (not normalized; callers rarely need circle-as-A).
 * tB = parameter along primitive B (same convention, from B's perspective).
 * The swap() helper exchanges tA↔tB so callers always get tA relative to their target primitive.
 */
export type Hit = { x: number; y: number; tA: number; tB: number };

const EPS = 1e-9;

/**
 * Compute all intersections between two SketchPrimitives.
 * Covered: line-line, line-circle, line-arc (and symmetric cases).
 * arc-arc and circle-circle are deferred (slice 3).
 *
 * For lines: tA/tB ∈ [0,1] means within the segment; callers can pass
 * `clampToSegment = false` to get unbounded t (used by ExtendTool ray queries).
 */
export function intersect(
  a: SketchPrimitive,
  b: SketchPrimitive,
  clampToSegment = true,
): Hit[] {
  if (a.kind === 'line' && b.kind === 'line') return lineLineHits(a, b, clampToSegment);
  if (a.kind === 'line' && b.kind === 'circle') return lineCircleHits(a, b, clampToSegment);
  if (a.kind === 'circle' && b.kind === 'line') return lineCircleHits(b, a, clampToSegment).map(swap);
  if (a.kind === 'line' && b.kind === 'arc') return lineArcHits(a, b, clampToSegment);
  if (a.kind === 'arc' && b.kind === 'line') return lineArcHits(b, a, clampToSegment).map(swap);
  // circle-arc, arc-arc, circle-circle: deferred
  return [];
}

function swap(h: Hit): Hit {
  return { x: h.x, y: h.y, tA: h.tB, tB: h.tA };
}

function lineLineHits(
  a: Extract<SketchPrimitive, { kind: 'line' }>,
  b: Extract<SketchPrimitive, { kind: 'line' }>,
  clampToSegment: boolean,
): Hit[] {
  const dx1 = a.x2 - a.x1, dy1 = a.y2 - a.y1;
  const dx2 = b.x2 - b.x1, dy2 = b.y2 - b.y1;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < EPS) return []; // parallel

  const dx = b.x1 - a.x1, dy = b.y1 - a.y1;
  const tA = (dx * dy2 - dy * dx2) / denom;
  const tB = (dx * dy1 - dy * dx1) / denom;

  if (clampToSegment && (tA < -EPS || tA > 1 + EPS || tB < -EPS || tB > 1 + EPS)) return [];

  const x = a.x1 + tA * dx1;
  const y = a.y1 + tA * dy1;
  return [{ x, y, tA, tB }];
}

function lineCircleHits(
  line: Extract<SketchPrimitive, { kind: 'line' }>,
  circle: Extract<SketchPrimitive, { kind: 'circle' }>,
  clampToSegment: boolean,
): Hit[] {
  const dx = line.x2 - line.x1, dy = line.y2 - line.y1;
  const fx = line.x1 - circle.cx, fy = line.y1 - circle.cy;

  const A = dx * dx + dy * dy;
  if (A < EPS) return [];
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - circle.r * circle.r;

  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];

  const hits: Hit[] = [];
  const sqrtDisc = Math.sqrt(Math.max(0, disc));
  for (const sign of [-1, 1] as const) {
    const tA = (-B + sign * sqrtDisc) / (2 * A);
    if (clampToSegment && (tA < -EPS || tA > 1 + EPS)) continue;
    const x = line.x1 + tA * dx;
    const y = line.y1 + tA * dy;
    const tB = Math.atan2(y - circle.cy, x - circle.cx); // angle on circle
    hits.push({ x, y, tA, tB });
  }
  return hits;
}

function lineArcHits(
  line: Extract<SketchPrimitive, { kind: 'line' }>,
  arc: Extract<SketchPrimitive, { kind: 'arc' }>,
  clampToSegment: boolean,
): Hit[] {
  // Re-use line-circle math, then filter by arc angular range.
  const circleHits = lineCircleHits(
    line,
    { id: arc.id, kind: 'circle', cx: arc.cx, cy: arc.cy, r: arc.r },
    clampToSegment,
  );

  return circleHits.filter((h) => {
    const angle = h.tB; // atan2 result ∈ (-π, π]
    return angleInArcRange(angle, arc.startAngle, arc.endAngle);
  }).map((h) => ({
    ...h,
    // Normalize tB: fractional position within [startAngle, endAngle].
    tB: (h.tB - arc.startAngle) / (arc.endAngle - arc.startAngle),
  }));
}

/**
 * Returns true if `angle` (atan2 output ∈ (-π, π]) lies within the arc's
 * CCW sweep [startAngle, endAngle] (invariant: startAngle < endAngle after
 * slice-1 normalization — same convention as ArcTool and computeFillet).
 */
function angleInArcRange(angle: number, start: number, end: number): boolean {
  // Normalize angle to lie within the range by subtracting 2π multiples.
  let a = angle;
  while (a < start - EPS) a += 2 * Math.PI;
  while (a > end + EPS) a -= 2 * Math.PI;
  return a >= start - EPS && a <= end + EPS;
}
```

- [ ] **Step 0-D: Run and confirm GREEN**

```bash
cd packages/app && npx vitest run src/sketcher/geometry/__tests__/intersect.spec.ts
```

Expected: all tests pass.

- [ ] **Step 0-E: Commit**

```bash
git add packages/app/src/sketcher/geometry/intersect.ts \
        packages/app/src/sketcher/geometry/__tests__/intersect.spec.ts
git commit -m "feat(sketch): intersect.ts — line-line, line-circle, line-arc with arc-angle guard"
```

---

## Task 1 — TrimTool

**Files:**
- Create: `packages/app/src/sketcher/tools/TrimTool.ts`
- Create: `packages/app/src/sketcher/tools/__tests__/TrimTool.spec.ts`

### Step 1-A: Write the failing tests

> **Scope (applied decision):** Trim TARGET supports **line and arc**, FULLY implemented and tested. **Full-circle-target trim is DEFERRED to slice 3** (a circle has no endpoints → needs circle→arc conversion; out of scope this slice). For a circle target the tool no-ops with a code comment.

> **Arc `tA` convention:** `intersect.ts` arc-target hits return `tA` as the **normalized fractional position** `∈ [0,1]` within `[startAngle, endAngle]` (see `lineArcHits` in T0 — it normalizes `tB` before returning; when arc is primitive A, the `swap()` call exchanges `tA`↔`tB`, so `tA` becomes the normalized arc parameter). The arc trim interval logic MUST use these normalized `tA ∈ [0,1]` values consistently — NOT raw atan2 angles.

Create `packages/app/src/sketcher/tools/__tests__/TrimTool.spec.ts`.

**Design notes before reading:**
- TrimTool callbacks: `deletePrimitive(id)`, `addPrimitive(p)`, `updatePrimitive(id, patch)`.
- It calls `pickPrimitiveAt` then `intersect` (real output — no hand-authored coords).
- Interior interval → delete original + add two remnants. End interval → updatePrimitive. Whole → delete.

```ts
import { describe, it, expect, vi } from 'vitest';
import { TrimTool } from '../TrimTool';
import type { SketchPrimitive } from '@zilventor/shared';

// Helper: build the opts bag with vi.fn() spies.
function makeTool() {
  const adds: SketchPrimitive[] = [];
  const dels: string[] = [];
  const updates: { id: string; patch: Partial<SketchPrimitive> }[] = [];
  const tool = new TrimTool({
    addPrimitive: (p) => adds.push(p),
    deletePrimitive: (id) => dels.push(id),
    updatePrimitive: (id, patch) => updates.push({ id, patch }),
  });
  return { tool, adds, dels, updates };
}

// Geometry fixtures for end-trim:
//   lh: horizontal y=5, x1=0 to x2=10.  lv crosses at x=5.
//   Picking near x=8 → end interval (between crossing x=5 and endpoint x=10) → shorten.
const lh: SketchPrimitive = { id: 'lh', kind: 'line', x1: 0, y1: 5, x2: 10, y2: 5 };
const lv: SketchPrimitive = { id: 'lv', kind: 'line', x1: 5, y1: 0, x2: 5, y2: 10 };

// Interior interval requires TWO crossings.
// lh2: y=0, x1=-10 to x2=10.  Two cutters: lv1 at x=-5, lv2 at x=5.
// Click between x=-5 and x=5 → interior interval → delete lh2 + add two outer remnants.
//
// FALSE-GREEN GUARD: The crossing positions x=±5 are computed by intersect.ts from
// the geometry — we do NOT hand-author them into the tool test. The assertions check
// the STRUCTURAL properties of the output (remnant endpoints match the crossing
// positions that intersect.ts itself computed).

const lh2: SketchPrimitive = { id: 'lh2', kind: 'line', x1: -10, y1: 0, x2: 10, y2: 0 };
const lv1: SketchPrimitive = { id: 'lv1', kind: 'line', x1: -5, y1: -5, x2: -5, y2: 5 };
const lv2: SketchPrimitive = { id: 'lv2', kind: 'line', x1: 5,  y1: -5, x2: 5,  y2: 5 };

describe('TrimTool — line interior trim (two crossings)', () => {
  it('clicking lh between its two crossings deletes it and adds two outer remnants', () => {
    const { tool, adds, dels } = makeTool();
    tool.setPrimitives([lh2, lv1, lv2]);
    // Click between the two crossings at (0,0) — which is on lh2 body (y=0 line, x=0).
    tool.onPointerClick({ x: 0, y: 0 });

    expect(dels).toContain('lh2');
    // Two remnants: left (x=-10 to -5) and right (x=5 to 10).
    expect(adds).toHaveLength(2);
    const lines = adds.filter((p): p is Extract<SketchPrimitive, { kind: 'line' }> => p.kind === 'line');
    expect(lines).toHaveLength(2);
    const xs = lines.map((l) => ({ x1: l.x1, x2: l.x2 }));
    const leftPiece = xs.find((seg) => Math.abs(seg.x1 - (-10)) < 0.01);
    expect(leftPiece).toBeDefined();
    // Left piece ends at the first crossing (x=-5).
    expect(leftPiece!.x2).toBeCloseTo(-5, 2);
    const rightPiece = xs.find((seg) => Math.abs(seg.x2 - 10) < 0.01);
    expect(rightPiece).toBeDefined();
    // Right piece starts at the second crossing (x=5).
    expect(rightPiece!.x1).toBeCloseTo(5, 2);
  });
});

describe('TrimTool — line end-trim (shorten with UpdatePrimitive)', () => {
  it('clicking lh near its right endpoint shortens it to the crossing', () => {
    // lh: y=5, x1=0 to x2=10.  lv crosses at x=5.
    // Click near x=8 (between crossing x=5 and right endpoint x=10) → end trim.
    const { tool, dels, updates, adds } = makeTool();
    tool.setPrimitives([lh, lv]);
    tool.onPointerClick({ x: 8, y: 5 });

    // No delete, no new primitives — just shorten.
    expect(dels).toHaveLength(0);
    expect(adds).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe('lh');
    // The right endpoint (x2) should move from 10 to ~5 (the crossing).
    const patch = updates[0]!.patch as Partial<Extract<SketchPrimitive, { kind: 'line' }>>;
    expect(patch.x2).toBeCloseTo(5, 2);
  });
});

describe('TrimTool — no crossings (whole primitive deleted)', () => {
  it('clicking an isolated primitive with no crossings deletes it entirely', () => {
    const iso: SketchPrimitive = { id: 'iso', kind: 'line', x1: 100, y1: 100, x2: 200, y2: 100 };
    const { tool, dels, adds, updates } = makeTool();
    tool.setPrimitives([iso]);
    tool.onPointerClick({ x: 150, y: 100 });
    expect(dels).toContain('iso');
    expect(adds).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});

describe('TrimTool — no hit (click misses all primitives)', () => {
  it('clicking empty space emits nothing', () => {
    const { tool, dels, adds, updates } = makeTool();
    tool.setPrimitives([lh, lv]);
    tool.onPointerClick({ x: 50, y: 50 }); // far from any primitive
    expect(dels).toHaveLength(0);
    expect(adds).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});

// ---- Arc-target trim tests ----
// FALSE-GREEN GUARD: these tests drive the REAL intersect.ts output through TrimTool.
// The expected startAngle/endAngle values are NOT hand-authored — they are derived from
// the geometry (a line y=0 crosses arc center (0,0) r=5 at angle=0, which is exactly
// the arc's startAngle). The test asserts the structural outcome, not a hard-coded angle.

describe('TrimTool — arc end-trim (intersect.ts driven)', () => {
  it('trim arc (startAngle=0..endAngle=π/2) near its startAngle end shortens startAngle', () => {
    // Arc: center (0,0), r=5, CCW from angle=0 (point 5,0) to angle=π/2 (point 0,5).
    // Cutter: horizontal line y=0 from x=-5 to x=5 — crosses the arc at angle=0 (x=5,y=0).
    // That intersection is AT the startAngle.  A second cutter is needed for this to
    // actually shorten rather than delete.  Add a vertical line x=0 (y=-5 to y=5)
    // crossing the arc at angle=π/2 (x=0,y=5).
    // Click near (4, 0.5) — close to startAngle end, between the two crossings at
    // angle=0 and angle=π/2 is the whole arc; the test clicks near angle=0 side.
    // Expected: the arc is shortened (startAngle moved) or deleted if logic varies.
    //
    // Simpler setup: arc from 0 to π/2, ONE cutter at the midpoint (angle=π/4).
    //   Line through (r*cos(π/4), r*sin(π/4)) = (~3.54, ~3.54), roughly a diagonal.
    //   Click near the startAngle end (angle~0 side) → shorten startAngle to π/4.
    //
    // Use a horizontal line y=3.54 (approximately r*sin(π/4)) crossing the arc at ~π/4.
    // Analytically: intersection angle = acos((y-cy)/r)... that's complex.
    //
    // CLEANER: Use a cutter that crosses AT a known angle.
    // Arc center (0,0), r=5, startAngle=0, endAngle=Math.PI/2.
    // Cutter: a line from (-5, 5*Math.tan(Math.PI/4)) = (-5,5) to (5, 5*Math.tan(Math.PI/4)) ... nope.
    //
    // SIMPLEST provable case: use a vertical line x=0 as cutter.
    //   x=0 line crosses the arc: substituting into circle eqn: 0^2+y^2=25 → y=±5.
    //   In arc range [0, π/2]: y=+5 corresponds to angle=π/2 (the endAngle endpoint).
    //   y=-5 → angle=-π/2, not in range → rejected.
    //   So intersect returns 1 hit at angle=π/2 (tA normalized = 1.0 since it's the end).
    //
    // With ONE crossing at the arc's own endAngle (tA=1), the breakTs = [0, 1, 1].
    // Pick near startAngle end (angle~0): tPick ≈ 0.  Interval [u0=0, u1=1] → isEndBound AND
    // isStartBound both true → treated as a degenerate case. Let's pick near the end instead.
    //
    // FINAL approach: arc startAngle=0, endAngle=Math.PI, cutter at angle=Math.PI/2 (x=0 vertical line).
    //   intersect(arc, vline) → tA normalized = (π/2 - 0)/(π - 0) = 0.5.
    //   Click near (4, 0.1) → tPick for arc = atan2(0.1, 4)/π ≈ 0.008/π ≈ close to 0.
    //   Breakpoints: [0, 0.5, 1]. Pick in interval [0, 0.5] → isStartBound=true, isEndBound=false.
    //   → Trim the start → updatePrimitive with new startAngle = 0 + 0.5*(π-0) = π/2.
    //
    // The test FAILS before _trimArc is implemented and PASSES after.
    const arc: SketchPrimitive = { id: 'arc1', kind: 'arc', cx: 0, cy: 0, r: 5, startAngle: 0, endAngle: Math.PI };
    const vline: SketchPrimitive = { id: 'vl', kind: 'line', x1: 0, y1: -5, x2: 0, y2: 5 };
    const { tool, dels, adds, updates } = makeTool();
    tool.setPrimitives([arc, vline]);
    // Click near (4, 0.1): on the arc body near angle≈0 (start side, before the π/2 crossing).
    tool.onPointerClick({ x: 4, y: 0.1 });

    // Outcome: no delete, no new primitives — just shorten the start.
    expect(dels).toHaveLength(0);
    expect(adds).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe('arc1');
    // New startAngle should be approximately π/2 (the intersection angle).
    const patch = updates[0]!.patch as Partial<Extract<SketchPrimitive, { kind: 'arc' }>>;
    expect(patch.startAngle).toBeCloseTo(Math.PI / 2, 2);
  });
});

describe('TrimTool — circle target (deferred, no-op)', () => {
  it('clicking a circle target does not crash and emits nothing (deferred to slice 3)', () => {
    // Circle center (0,0) r=5. Horizontal line y=0 is a cutter.
    // Click at (0, 4.9): dist to circle = |hypot(0,4.9)-5| ≈ 0.1 (hits circle body).
    // dist to line y=0 = 4.9 (farther). pickPrimitiveAt → circle wins.
    // Full-circle trim no-ops with a comment → emits nothing.
    const circ: SketchPrimitive = { id: 'c1', kind: 'circle', cx: 0, cy: 0, r: 5 };
    const line: SketchPrimitive = { id: 'l1', kind: 'line', x1: -5, y1: 0, x2: 5, y2: 0 };
    const { tool, dels, adds, updates } = makeTool();
    tool.setPrimitives([circ, line]);
    // Click near the top of the circle (not on the line) — should no-op (circle trim deferred to slice 3).
    tool.onPointerClick({ x: 0, y: 4.9 });
    expect(dels).toHaveLength(0);
    expect(adds).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});
```

- [ ] **Step 1-B: Run and confirm FAIL**

```bash
cd packages/app && npx vitest run src/sketcher/tools/__tests__/TrimTool.spec.ts
```

Expected failure: `Cannot find module '../TrimTool'`. The arc-trim test AND the circle-no-op test must both be present from the start — they drive the red step.

### Step 1-C: Implement `TrimTool.ts`

Create `packages/app/src/sketcher/tools/TrimTool.ts`.

**Key invariants (read before implementing):**
- `intersect(arc_target, other)` returns `tA` as the **normalized** fractional position `∈ [0,1]` along the arc (`tA=0` = startAngle, `tA=1` = endAngle). This is because `lineArcHits` normalizes `tB` before returning and `swap()` exchanges `tA`↔`tB` when arc is A. Do NOT mix normalized fractional and raw atan2 angles.
- For a **circle target**: detect `kind === 'circle'` and no-op with a comment `// full-circle trim deferred to slice 3 (needs circle→arc conversion)`. Do NOT attempt to trim circles.

```ts
import type { SketchPrimitive } from '@zilventor/shared';
import type { Point2 } from '../snap';
import { pickPrimitiveAt } from './pick';
import { intersect } from '../geometry/intersect';

export type TrimToolOpts = {
  addPrimitive(p: SketchPrimitive): void;
  deletePrimitive(id: string): void;
  updatePrimitive(id: string, patch: Partial<SketchPrimitive>): void;
};

export class TrimTool {
  private primitives: SketchPrimitive[] = [];

  constructor(private readonly opts: TrimToolOpts) {}

  setPrimitives(primitives: SketchPrimitive[]): void {
    this.primitives = primitives;
  }

  onPointerClick(pt: Point2): void {
    const hit = pickPrimitiveAt(this.primitives, pt);
    if (!hit) return;
    const target = this.primitives.find((p) => p.id === hit.primitiveId);
    if (!target) return;

    // full-circle trim deferred to slice 3 (needs circle→arc conversion)
    if (target.kind === 'circle') return;

    if (target.kind !== 'line' && target.kind !== 'arc') return;

    // Collect all intersections of target with every other primitive.
    const others = this.primitives.filter((p) => p.id !== target.id);
    type HitWithT = { tA: number; x: number; y: number };
    const crossings: HitWithT[] = [];
    for (const other of others) {
      const hits = intersect(target, other);
      for (const h of hits) crossings.push({ tA: h.tA, x: h.x, y: h.y });
    }

    if (target.kind === 'line') {
      this._trimLine(target, crossings, pt);
    } else if (target.kind === 'arc') {
      this._trimArc(target, crossings, pt);
    }
  }

  onEscapePressed(): void { /* TrimTool is stateless between clicks */ }

  private _trimLine(
    line: Extract<SketchPrimitive, { kind: 'line' }>,
    crossings: { tA: number; x: number; y: number }[],
    pt: Point2,
  ): void {
    // Parameter of the pick point along the line.
    const dx = line.x2 - line.x1, dy = line.y2 - line.y1;
    const len2 = dx * dx + dy * dy;
    const tPick = len2 < 1e-9 ? 0 : ((pt.x - line.x1) * dx + (pt.y - line.y1) * dy) / len2;

    // Build sorted breakpoints: 0 (start), sorted crossings, 1 (end).
    const breakTs = [0, ...crossings.map((c) => c.tA), 1].sort((a, b) => a - b);

    // Find the interval [u0, u1] that contains tPick.
    let u0 = 0, u1 = 1;
    for (let i = 0; i < breakTs.length - 1; i++) {
      if (tPick >= breakTs[i]! - 1e-6 && tPick <= breakTs[i + 1]! + 1e-6) {
        u0 = breakTs[i]!;
        u1 = breakTs[i + 1]!;
        break;
      }
    }

    const isStartBound = Math.abs(u0 - 0) < 1e-6;
    const isEndBound   = Math.abs(u1 - 1) < 1e-6;

    if (crossings.length === 0) {
      // No crossings — delete whole primitive.
      this.opts.deletePrimitive(line.id);
      return;
    }

    if (!isStartBound && !isEndBound) {
      // Interior interval — split into two remnants.
      const pt0 = { x: line.x1 + u0 * dx, y: line.y1 + u0 * dy };
      const pt1 = { x: line.x1 + u1 * dx, y: line.y1 + u1 * dy };
      this.opts.deletePrimitive(line.id);
      this.opts.addPrimitive({
        id: `p-tr-${crypto.randomUUID().slice(0, 8)}`,
        kind: 'line', x1: line.x1, y1: line.y1, x2: pt0.x, y2: pt0.y,
      });
      this.opts.addPrimitive({
        id: `p-tr-${crypto.randomUUID().slice(0, 8)}`,
        kind: 'line', x1: pt1.x, y1: pt1.y, x2: line.x2, y2: line.y2,
      });
    } else if (isStartBound) {
      // Trim the start endpoint — move x1,y1 to u1.
      const newPt = { x: line.x1 + u1 * dx, y: line.y1 + u1 * dy };
      this.opts.updatePrimitive(line.id, { x1: newPt.x, y1: newPt.y });
    } else {
      // Trim the end endpoint — move x2,y2 to u0.
      const newPt = { x: line.x1 + u0 * dx, y: line.y1 + u0 * dy };
      this.opts.updatePrimitive(line.id, { x2: newPt.x, y2: newPt.y });
    }
  }

  private _trimArc(
    arc: Extract<SketchPrimitive, { kind: 'arc' }>,
    crossings: { tA: number; x: number; y: number }[],
    pt: Point2,
  ): void {
    // IMPORTANT: tA from intersect() for arc targets is NORMALIZED to [0,1]
    // where 0=startAngle and 1=endAngle (see lineArcHits + swap in intersect.ts).
    // All interval logic here uses normalized t; convert back to real angles for patches.

    const span = arc.endAngle - arc.startAngle; // always > 0 by slice-1 invariant

    // Normalized pick parameter: project pick point angle onto [0,1].
    const pickAngle = Math.atan2(pt.y - arc.cy, pt.x - arc.cx);
    // Normalize pickAngle into [startAngle, endAngle] range, then to [0,1].
    let normAngle = pickAngle;
    while (normAngle < arc.startAngle - 1e-9) normAngle += 2 * Math.PI;
    while (normAngle > arc.endAngle + 1e-9) normAngle -= 2 * Math.PI;
    const tPick = span < 1e-9 ? 0 : (normAngle - arc.startAngle) / span;

    // Build sorted breakpoints in normalized [0,1] space.
    const breakTs = [0, ...crossings.map((c) => c.tA), 1].sort((a, b) => a - b);

    // Find the interval [u0, u1] containing tPick.
    let u0 = 0, u1 = 1;
    for (let i = 0; i < breakTs.length - 1; i++) {
      if (tPick >= breakTs[i]! - 1e-6 && tPick <= breakTs[i + 1]! + 1e-6) {
        u0 = breakTs[i]!;
        u1 = breakTs[i + 1]!;
        break;
      }
    }

    const isStartBound = Math.abs(u0 - 0) < 1e-6;
    const isEndBound   = Math.abs(u1 - 1) < 1e-6;

    if (crossings.length === 0) {
      this.opts.deletePrimitive(arc.id);
      return;
    }

    // Convert normalized breakpoints back to real angles.
    const toAngle = (t: number) => arc.startAngle + t * span;

    if (!isStartBound && !isEndBound) {
      // Interior interval — split arc into two remnant arcs (outer pieces).
      this.opts.deletePrimitive(arc.id);
      this.opts.addPrimitive({
        id: `p-tr-${crypto.randomUUID().slice(0, 8)}`,
        kind: 'arc', cx: arc.cx, cy: arc.cy, r: arc.r,
        startAngle: arc.startAngle, endAngle: toAngle(u0),
      });
      this.opts.addPrimitive({
        id: `p-tr-${crypto.randomUUID().slice(0, 8)}`,
        kind: 'arc', cx: arc.cx, cy: arc.cy, r: arc.r,
        startAngle: toAngle(u1), endAngle: arc.endAngle,
      });
    } else if (isStartBound) {
      // Trim the start — advance startAngle to u1.
      this.opts.updatePrimitive(arc.id, { startAngle: toAngle(u1) });
    } else {
      // Trim the end — retract endAngle to u0.
      this.opts.updatePrimitive(arc.id, { endAngle: toAngle(u0) });
    }
  }
}
```

- [ ] **Step 1-D: Run and confirm GREEN**

```bash
cd packages/app && npx vitest run src/sketcher/tools/__tests__/TrimTool.spec.ts
```

All test cases in this file should go GREEN.

- [ ] **Step 1-E: Commit**

```bash
git add packages/app/src/sketcher/tools/TrimTool.ts \
        packages/app/src/sketcher/tools/__tests__/TrimTool.spec.ts
git commit -m "feat(sketch): TrimTool — split/shorten/delete by nearest crossings (intersect.ts driven)"
```

---

## Task 2 — ExtendTool

**Files:**
- Create: `packages/app/src/sketcher/tools/ExtendTool.ts`
- Create: `packages/app/src/sketcher/tools/__tests__/ExtendTool.spec.ts`

### Step 2-A: Write the failing test

Create `packages/app/src/sketcher/tools/__tests__/ExtendTool.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ExtendTool } from '../ExtendTool';
import type { SketchPrimitive } from '@zilventor/shared';

// FALSE-GREEN GUARD: These tests do NOT hand-author the intersection coordinate.
// They set up geometry where the nearest forward intersection can be analytically
// derived (e.g. horizontal line extending right hits a vertical barrier at x=15).
// The expected endpoint values are analytically computed, not read from intersect.ts output.

function makeTool() {
  const updates: { id: string; patch: Partial<SketchPrimitive> }[] = [];
  const tool = new ExtendTool({
    updatePrimitive: (id, patch) => updates.push({ id, patch }),
  });
  return { tool, updates };
}

describe('ExtendTool — extend line to vertical barrier', () => {
  it('extends lh (x1=0→x2=8, y=0) toward the barrier at x=15 → new x2=15', () => {
    // lh ends at x=8. Barrier is a vertical line from (15,-5) to (15,5).
    // Click near x=8 (near the right endpoint) → extend right endpoint to x=15.
    const lh: SketchPrimitive = { id: 'lh', kind: 'line', x1: 0, y1: 0, x2: 8, y2: 0 };
    const barrier: SketchPrimitive = { id: 'b', kind: 'line', x1: 15, y1: -5, x2: 15, y2: 5 };
    const { tool, updates } = makeTool();
    tool.setPrimitives([lh, barrier]);
    tool.onPointerClick({ x: 8, y: 0 }); // click near right endpoint of lh
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe('lh');
    const patch = updates[0]!.patch as Partial<Extract<SketchPrimitive, { kind: 'line' }>>;
    // Right endpoint (x2) should move to 15 (barrier x).
    expect(patch.x2).toBeCloseTo(15, 2);
    expect(patch.y2).toBeCloseTo(0, 2);
  });

  it('extends lh from near left endpoint toward a barrier at x=-10', () => {
    // lh starts at x=0. Barrier at x=-10.
    // Click near x=0 (near the left endpoint) → extend left endpoint.
    const lh: SketchPrimitive = { id: 'lh', kind: 'line', x1: 0, y1: 0, x2: 8, y2: 0 };
    const barrier: SketchPrimitive = { id: 'b', kind: 'line', x1: -10, y1: -5, x2: -10, y2: 5 };
    const { tool, updates } = makeTool();
    tool.setPrimitives([lh, barrier]);
    tool.onPointerClick({ x: 0, y: 0 }); // click near left endpoint
    expect(updates).toHaveLength(1);
    const patch = updates[0]!.patch as Partial<Extract<SketchPrimitive, { kind: 'line' }>>;
    expect(patch.x1).toBeCloseTo(-10, 2);
    expect(patch.y1).toBeCloseTo(0, 2);
  });
});

describe('ExtendTool — no forward target (no-op)', () => {
  it('clicking an isolated line with no forward intersections emits nothing', () => {
    const lh: SketchPrimitive = { id: 'lh', kind: 'line', x1: 0, y1: 0, x2: 8, y2: 0 };
    const { tool, updates } = makeTool();
    tool.setPrimitives([lh]);
    tool.onPointerClick({ x: 8, y: 0 });
    expect(updates).toHaveLength(0);
  });
});

describe('ExtendTool — no hit on click', () => {
  it('clicking empty space emits nothing', () => {
    const lh: SketchPrimitive = { id: 'lh', kind: 'line', x1: 0, y1: 0, x2: 8, y2: 0 };
    const { tool, updates } = makeTool();
    tool.setPrimitives([lh]);
    tool.onPointerClick({ x: 50, y: 50 });
    expect(updates).toHaveLength(0);
  });
});
```

- [ ] **Step 2-B: Run and confirm FAIL**

```bash
cd packages/app && npx vitest run src/sketcher/tools/__tests__/ExtendTool.spec.ts
```

Expected failure: `Cannot find module '../ExtendTool'`.

### Step 2-C: Implement `ExtendTool.ts`

Create `packages/app/src/sketcher/tools/ExtendTool.ts`:

```ts
import type { SketchPrimitive } from '@zilventor/shared';
import type { Point2 } from '../snap';
import { pickPrimitiveAt } from './pick';
import { intersect } from '../geometry/intersect';

export type ExtendToolOpts = {
  updatePrimitive(id: string, patch: Partial<SketchPrimitive>): void;
};

export class ExtendTool {
  private primitives: SketchPrimitive[] = [];

  constructor(private readonly opts: ExtendToolOpts) {}

  setPrimitives(primitives: SketchPrimitive[]): void {
    this.primitives = primitives;
  }

  onPointerClick(pt: Point2): void {
    const hit = pickPrimitiveAt(this.primitives, pt);
    if (!hit) return;
    const target = this.primitives.find((p) => p.id === hit.primitiveId);
    if (!target) return;
    if (target.kind !== 'line' && target.kind !== 'arc') return;

    if (target.kind === 'line') {
      this._extendLine(target, pt);
    }
    // Arc extend: continue CCW/CW from the near endpoint — implementer should
    // follow the same pattern as _extendLine using angular parameters.
  }

  onEscapePressed(): void { /* stateless */ }

  private _extendLine(
    line: Extract<SketchPrimitive, { kind: 'line' }>,
    pt: Point2,
  ): void {
    const dx = line.x2 - line.x1, dy = line.y2 - line.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return;

    // Determine the near endpoint (start or end) by distance to pick point.
    const dStart = Math.hypot(pt.x - line.x1, pt.y - line.y1);
    const dEnd   = Math.hypot(pt.x - line.x2, pt.y - line.y2);
    const nearEnd: 'start' | 'end' = dStart < dEnd ? 'start' : 'end';

    // Build a ray: origin = near endpoint, direction = toward or away from the far end.
    // For 'end': direction = (dx/len, dy/len) — forward extension from end.
    // For 'start': direction = (-dx/len, -dy/len) — backward extension from start.
    const rayOx = nearEnd === 'end' ? line.x2 : line.x1;
    const rayOy = nearEnd === 'end' ? line.y2 : line.y1;
    const rayDx = nearEnd === 'end' ? dx / len : -dx / len;
    const rayDy = nearEnd === 'end' ? dy / len : -dy / len;

    // Build a ray-as-line for intersect: a segment far in the direction (length 1e6).
    const rayLine: Extract<SketchPrimitive, { kind: 'line' }> = {
      id: '__ray__', kind: 'line',
      x1: rayOx, y1: rayOy,
      x2: rayOx + rayDx * 1e6, y2: rayOy + rayDy * 1e6,
    };

    // Intersect the ray with all other primitives (unclamped on ray side).
    const others = this.primitives.filter((p) => p.id !== line.id);
    let nearestT = Infinity;
    let nearestX = 0, nearestY = 0;

    for (const other of others) {
      // Use clamped=false so the ray extends past the segment endpoint.
      const hits = intersect(rayLine, other, false);
      for (const h of hits) {
        // h.tA is along the ray (1e6 units). Only forward hits (tA ≥ 0).
        if (h.tA < -1e-6) continue;
        // h.tB must be in [0,1] (the 'other' segment must be crossed within its body).
        if (other.kind === 'line' && (h.tB < -1e-6 || h.tB > 1 + 1e-6)) continue;
        const dist = h.tA;
        if (dist < nearestT) {
          nearestT = dist;
          nearestX = h.x;
          nearestY = h.y;
        }
      }
    }

    if (nearestT === Infinity) return; // no forward target

    if (nearEnd === 'end') {
      this.opts.updatePrimitive(line.id, { x2: nearestX, y2: nearestY });
    } else {
      this.opts.updatePrimitive(line.id, { x1: nearestX, y1: nearestY });
    }
  }
}
```

- [ ] **Step 2-D: Run and confirm GREEN**

```bash
cd packages/app && npx vitest run src/sketcher/tools/__tests__/ExtendTool.spec.ts
```

- [ ] **Step 2-E: Commit**

```bash
git add packages/app/src/sketcher/tools/ExtendTool.ts \
        packages/app/src/sketcher/tools/__tests__/ExtendTool.spec.ts
git commit -m "feat(sketch): ExtendTool — extends line endpoint to nearest forward intersection"
```

---

## Task 3 — Project Geometry Tool + `geometry/projectToSketch.ts`

**Files:**
- Create: `packages/app/src/sketcher/geometry/projectToSketch.ts`
- Create: `packages/app/src/sketcher/tools/ProjectGeometryTool.ts`
- Create: `packages/app/src/sketcher/tools/__tests__/ProjectGeometryTool.spec.ts`

### Step 3-A: Write the failing test

Create `packages/app/src/sketcher/tools/__tests__/ProjectGeometryTool.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { projectToSketch, type SketchFrame } from '../../geometry/projectToSketch';
import type { TessellatedEdge } from '@zilventor/shared';
import { ProjectGeometryTool } from '../ProjectGeometryTool';

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 4);

// XY-plane frame (origin.XY): origin=(0,0,0), normal=(0,0,1), xDir=(1,0,0).
// yDir = cross(normal, xDir) = (0,0,1)×(1,0,0) = (0,1,0).
const XY_FRAME: SketchFrame = {
  origin: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 0, z: 1 },
  xDir:   { x: 1, y: 0, z: 0 },
};

describe('projectToSketch — XY plane', () => {
  it('a point on the XY plane projects to itself (z ignored)', () => {
    const uv = projectToSketch({ x: 3, y: 4, z: 0 }, XY_FRAME);
    near(uv.u, 3); near(uv.v, 4);
  });

  it('a point above the plane projects to its xy footprint', () => {
    const uv = projectToSketch({ x: 2, y: 5, z: 10 }, XY_FRAME);
    near(uv.u, 2); near(uv.v, 5);
  });

  it('a negative-z point projects the same as zero-z', () => {
    const uv = projectToSketch({ x: 1, y: -2, z: -3 }, XY_FRAME);
    near(uv.u, 1); near(uv.v, -2);
  });
});

describe('projectToSketch — translated + rotated frame', () => {
  // Frame: origin=(5,0,0), normal=(0,0,1), xDir=(0,1,0).
  // yDir = (0,0,1)×(0,1,0) = (-1,0,0).
  // A point at (5,3,0): u=dot((0,3,0),(0,1,0))=3, v=dot((0,3,0),(-1,0,0))=0.
  const rotFrame: SketchFrame = {
    origin: { x: 5, y: 0, z: 0 },
    normal: { x: 0, y: 0, z: 1 },
    xDir:   { x: 0, y: 1, z: 0 },
  };
  it('point (5,3,0) in rotated frame → u=3, v=0', () => {
    const uv = projectToSketch({ x: 5, y: 3, z: 0 }, rotFrame);
    near(uv.u, 3); near(uv.v, 0);
  });
  it('point (2,0,0) in rotated frame → u=0, v=-3 (origin offset subtracted)', () => {
    // p - origin = (-3,0,0). dot((-3,0,0),(0,1,0))=0. dot((-3,0,0),(-1,0,0))=3.
    const uv = projectToSketch({ x: 2, y: 0, z: 0 }, rotFrame);
    near(uv.u, 0); near(uv.v, 3);
  });
});

// ---- ProjectGeometryTool unit tests ----

function makePGTool(frame: SketchFrame) {
  const emitted: { id: string; kind: string; x1: number; y1: number; x2: number; y2: number }[] = [];
  const toasts: string[] = [];
  const tool = new ProjectGeometryTool({
    frame,
    emitPrimitive: (p) => emitted.push(p as typeof emitted[0]),
    showToast: (msg) => toasts.push(msg),
  });
  return { tool, emitted, toasts };
}

function makeEdge(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): TessellatedEdge {
  return {
    edgeName: { faceA: { featureId: 'f1', role: 'side', instance: 0 }, faceB: { featureId: 'f2', role: 'side', instance: 0 } },
    segments: [[{ x: x1, y: y1, z: z1 }, { x: x2, y: y2, z: z2 }]],
    faceNames: [
      { featureId: 'f1', role: 'side', instance: 0 },
      { featureId: 'f2', role: 'side', instance: 0 },
    ],
  };
}

describe('ProjectGeometryTool — emit ordinary line', () => {
  it('single-segment edge on XY plane projects to a sketch line with correct coords', () => {
    const { tool, emitted } = makePGTool(XY_FRAME);
    const edge = makeEdge(0, 0, 0, 10, 0, 0);
    tool.projectEdge(edge);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.kind).toBe('line');
    near(emitted[0]!.x1, 0); near(emitted[0]!.y1, 0);
    near(emitted[0]!.x2, 10); near(emitted[0]!.y2, 0);
  });
});

describe('ProjectGeometryTool — curved edge toast', () => {
  it('multi-segment edge triggers "Curved-edge projection" toast and emits nothing', () => {
    const { tool, emitted, toasts } = makePGTool(XY_FRAME);
    const curvedEdge: TessellatedEdge = {
      edgeName: { faceA: { featureId: 'f1', role: 'side', instance: 0 }, faceB: { featureId: 'f2', role: 'side', instance: 0 } },
      segments: [
        [{ x: 0, y: 0, z: 0 }, { x: 5, y: 1, z: 0 }],
        [{ x: 5, y: 1, z: 0 }, { x: 10, y: 0, z: 0 }],
      ],
      faceNames: [
        { featureId: 'f1', role: 'side', instance: 0 },
        { featureId: 'f2', role: 'side', instance: 0 },
      ],
    };
    tool.projectEdge(curvedEdge);
    expect(emitted).toHaveLength(0);
    expect(toasts[0]).toMatch(/Curved-edge/);
  });
});
```

- [ ] **Step 3-B: Run and confirm FAIL**

```bash
cd packages/app && npx vitest run src/sketcher/tools/__tests__/ProjectGeometryTool.spec.ts
```

Expected failures: missing `projectToSketch` module and `ProjectGeometryTool` module.

### Step 3-C: Implement `geometry/projectToSketch.ts`

Create `packages/app/src/sketcher/geometry/projectToSketch.ts`:

```ts
import type { Vec3 } from '@zilventor/shared';

export type SketchFrame = {
  origin: Vec3;
  normal: Vec3;
  xDir: Vec3;
};

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * Project a 3D world-space point onto a sketch plane, returning (u, v) local coords.
 * u = dot(p - origin, xDir)
 * v = dot(p - origin, yDir) where yDir = cross(normal, xDir)
 */
export function projectToSketch(p: Vec3, frame: SketchFrame): { u: number; v: number } {
  const yDir = cross(frame.normal, frame.xDir);
  const rel = sub(p, frame.origin);
  return {
    u: dot(rel, frame.xDir),
    v: dot(rel, yDir),
  };
}
```

### Step 3-D: Implement `ProjectGeometryTool.ts`

Create `packages/app/src/sketcher/tools/ProjectGeometryTool.ts`:

```ts
import type { SketchPrimitive, TessellatedEdge } from '@zilventor/shared';
import type { SketchFrame } from '../geometry/projectToSketch';
import { projectToSketch } from '../geometry/projectToSketch';

export type ProjectGeometryToolOpts = {
  frame: SketchFrame | null; // null = face-sourced (no xDir) → toast and no-op
  emitPrimitive(p: SketchPrimitive): void;
  showToast(message: string): void;
};

/**
 * ProjectGeometryTool — projects a straight 3D model edge onto the active sketch
 * plane as an ordinary (non-construction) sketch line. Non-associative MVP:
 * projected geometry is baked once and not updated when the source model changes.
 *
 * Invocation: call `projectEdge(tessellatedEdge)` from App.tsx when the user
 * clicks a 3D edge during sketch mode with this tool active.
 */
export class ProjectGeometryTool {
  constructor(private readonly opts: ProjectGeometryToolOpts) {}

  /** Called by App.tsx when the user ray-picks a 3D edge in sketch mode. */
  projectEdge(edge: TessellatedEdge): void {
    if (!this.opts.frame) {
      this.opts.showToast(
        'Project Geometry currently supports workplane-based sketches only.',
      );
      return;
    }

    // Guard: only single-segment (straight) edges are supported.
    // A multi-segment edge is curved; reject it.
    if (edge.segments.length !== 1) {
      this.opts.showToast(
        'Curved-edge projection is not yet supported. Pick a straight edge.',
      );
      return;
    }

    const [p3a, p3b] = edge.segments[0]!;
    const uvA = projectToSketch(p3a, this.opts.frame);
    const uvB = projectToSketch(p3b, this.opts.frame);

    const line: Extract<SketchPrimitive, { kind: 'line' }> = {
      id: `p-proj-${crypto.randomUUID().slice(0, 8)}`,
      kind: 'line',
      x1: uvA.u, y1: uvA.v,
      x2: uvB.u, y2: uvB.v,
    };
    this.opts.emitPrimitive(line);
  }

  onEscapePressed(): void { /* stateless */ }
}
```

- [ ] **Step 3-E: Run and confirm GREEN**

```bash
cd packages/app && npx vitest run src/sketcher/tools/__tests__/ProjectGeometryTool.spec.ts
```

- [ ] **Step 3-F: Commit**

```bash
git add packages/app/src/sketcher/geometry/projectToSketch.ts \
        packages/app/src/sketcher/tools/ProjectGeometryTool.ts \
        packages/app/src/sketcher/tools/__tests__/ProjectGeometryTool.spec.ts
git commit -m "feat(sketch): ProjectGeometryTool + projectToSketch — non-associative straight-edge projection"
```

---

## Task 4 — Fillet coincident fix

**Files:**
- Modify: `packages/app/src/sketcher/tools/FilletTool.ts` (add two `coincident` constraints after the arc emit)
- Modify: `packages/app/src/sketcher/tools/__tests__/FilletTool.spec.ts` (extend one test to assert coincident constraints)

### Step 4-A: Update the existing assertion FIRST (mandatory — prevents false-red for wrong reason)

> **WHY FIRST:** The existing test `'after picking two lines sharing a corner, emits an arc + trims + constraints'` in `FilletTool.spec.ts` asserts `expect(kinds).toEqual(['dim-radius', 'tangent', 'tangent'])`. Once step 4-C adds the two coincident constraints to `FilletTool.ts`, this OLD assertion will break — but for the WRONG reason (it fails because the count changed, not because the NEW behavior is wrong). To avoid a false-red-for-wrong-reason, update this assertion BEFORE running the red step.

Open `packages/app/src/sketcher/tools/__tests__/FilletTool.spec.ts`. **In the FIRST test** (`'after picking two lines sharing a corner, emits an arc + trims + constraints'`), change line 23:

**Before (current line 23 in FilletTool.spec.ts):**
```ts
    expect(kinds).toEqual(['dim-radius', 'tangent', 'tangent']);
```

**After:**
```ts
    expect(kinds).toEqual(['coincident', 'coincident', 'dim-radius', 'tangent', 'tangent']);
```

This change alone makes the first test IMMEDIATELY start failing with `toEqual(['dim-radius', 'tangent', 'tangent'])` (current output) vs `['coincident', 'coincident', 'dim-radius', 'tangent', 'tangent']` — which is the CORRECT red step (fails for the right reason).

### Step 4-B: Add the new coincident-constraints test

Now, IN THE SAME EDIT SESSION, also add a new test inside the existing `describe('FilletTool')` block:

```ts
it('emits two coincident constraints pinning arc endpoints to trimmed line endpoints', () => {
  // Use any[] consistent with the existing FilletTool.spec.ts style.
  const out: { primitives: any[]; constraints: any[] } = {
    primitives: [],
    constraints: [],
  };
  const tool = new FilletTool({
    radius: 2,
    emitArc: (a) => out.primitives.push(a),
    updateLine: (_id, _patch) => { /* ignore for this test */ },
    emitConstraint: (c) => out.constraints.push(c),
  });
  tool.setPrimitives([
    { id: 'lx', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
    { id: 'ly', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 },
  ]);
  tool.onPointerClick({ x: 5, y: 0 });
  tool.onPointerClick({ x: 0, y: 5 });

  // Previously: 2 tangent + 1 dim-radius = 3 constraints.
  // After fix:  2 tangent + 1 dim-radius + 2 coincident = 5 constraints.
  expect(out.constraints).toHaveLength(5);
  const coincidents = out.constraints.filter((c: any) => c.kind === 'coincident');
  expect(coincidents).toHaveLength(2);

  const arcId = out.primitives[0]!.id;
  // Each coincident must reference the arc (one endpoint 'start', one 'end')
  // and a trimmed line endpoint.
  const arcRefs = coincidents.flatMap((c: any) => {
    const pts = [c.a, c.b];
    return pts.filter((p: any) => p.primitiveId === arcId);
  });
  expect(arcRefs.map((r: any) => r.anchor).sort()).toEqual(['end', 'start']);
});
```

- [ ] **Step 4-C: Run and confirm FAIL**

```bash
cd packages/app && npx vitest run src/sketcher/tools/__tests__/FilletTool.spec.ts
```

Expected failures:
1. First test: `toEqual(['coincident', 'coincident', 'dim-radius', 'tangent', 'tangent'])` fails (currently only 3 constraints) — correct red step.
2. New coincident test: `toHaveLength(5)` fails (currently 3 constraints) — correct red step.

Both fail because `FilletTool.ts` doesn't yet emit coincident constraints.

### Step 4-D: Implement the fix in `FilletTool.ts`

Open `packages/app/src/sketcher/tools/FilletTool.ts`. After the `dim-radius` emit block (lines ~70-78), add:

```ts
// Emit coincident constraints pinning arc endpoints to trimmed line endpoints.
// arc.startAngle corresponds to the tangent point on one of the trimmed lines;
// arc.endAngle to the other. The trimmed corner endpoints are t1 and t2 from
// computeFillet. We reference them via the arc's own start/end anchors because
// the solver's arc endpoint is defined by startAngle/endAngle.
// The lines' trimmed endpoints: aCornerIsStart decides which anchor ('start'|'end').
// We need the computeFillet result to know which anchor; expose trimmedL1/trimmedL2 already.
// Approach: pin arc.start ↔ trimmedL1's corner-endpoint, arc.end ↔ trimmedL2's corner-endpoint.

// We need to know which anchor of l1 was the corner — this came from computeFillet's
// `aCornerIsStart` / `bCornerIsStart`. The result already carries trimmedL1/trimmedL2;
// detect the changed endpoint by comparing trimmedL1 to l1.
const l1CornerIsStart = trimmedL1.x1 !== l1.x1 || trimmedL1.y1 !== l1.y1 ? true :
                        trimmedL1.x2 !== l1.x2 || trimmedL1.y2 !== l1.y2 ? false : true;
const l2CornerIsStart = trimmedL2.x1 !== l2.x1 || trimmedL2.y1 !== l2.y1 ? true :
                        trimmedL2.x2 !== l2.x2 || trimmedL2.y2 !== l2.y2 ? false : true;

this.opts.emitConstraint({
  id: `c-co-${arc.id}-start`,
  kind: 'coincident',
  a: { primitiveId: arc.id, anchor: 'start' },
  b: { primitiveId: l1.id, anchor: l1CornerIsStart ? 'start' : 'end' },
});
this.opts.emitConstraint({
  id: `c-co-${arc.id}-end`,
  kind: 'coincident',
  a: { primitiveId: arc.id, anchor: 'end' },
  b: { primitiveId: l2.id, anchor: l2CornerIsStart ? 'start' : 'end' },
});
```

> **Implementer note:** Read the actual `FilletTool.ts` and `computeFillet` return type before writing. Verify that `PointRef` accepts `anchor: 'start' | 'end'` (it does — see `packages/shared/src/constraints.ts` line 3: `anchor: 'start' | 'end' | 'center'`). The `l1CornerIsStart` detection above compares field values; alternatively import `diffLine` to detect the changed endpoint. The intent is correct — refine the implementation to match the real variable names.

- [ ] **Step 4-D: Run and confirm GREEN**

```bash
cd packages/app && npx vitest run src/sketcher/tools/__tests__/FilletTool.spec.ts
```

- [ ] **Step 4-E: Commit**

```bash
git add packages/app/src/sketcher/tools/FilletTool.ts \
        packages/app/src/sketcher/tools/__tests__/FilletTool.spec.ts
git commit -m "fix(sketch): FilletTool emits two coincident constraints pinning arc-ends to trimmed line-ends"
```

---

## Task 5 — Multi-segment / loop Offset

**Files:**
- Modify: `packages/app/src/sketcher/geometry/offset.ts` (add `findChain`, `offsetChain`)
- Modify: `packages/app/src/sketcher/geometry/__tests__/offset.spec.ts` (add chain/loop tests)
- Modify: `packages/app/src/sketcher/tools/OffsetTool.ts` (call chain offset on commit)

### Step 5-A: Write the failing tests (geometry layer)

Open `packages/app/src/sketcher/geometry/__tests__/offset.spec.ts`. Add the two new imports to the **top** of the file (alongside existing imports), then append the new `describe` blocks at the bottom of the file.

New imports to add to the top:
```ts
import { offsetChain, findChain } from '../offset';
import type { SketchPrimitive } from '@zilventor/shared';
```

New test blocks to append at the end of the file:
```ts

// FALSE-GREEN GUARD: The corner fix-up in offsetChain calls intersect.ts
// internally. Expected coordinates are analytically derived:
// Two parallel horizontal lines sharing an endpoint are offset and then
// their shared corner is miter-joined via the intersection of the offset
// segments. The intersection point is computed analytically here (not
// by running the code first).

describe('findChain', () => {
  it('finds a two-line chain sharing an endpoint (within tolerance)', () => {
    const la: SketchPrimitive = { id: 'la', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 };
    const lb: SketchPrimitive = { id: 'lb', kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 };
    const lc: SketchPrimitive = { id: 'lc', kind: 'line', x1: 50, y1: 50, x2: 60, y2: 50 };
    const chain = findChain(la, [la, lb, lc]);
    expect(chain.map((p) => p.id)).toContain('la');
    expect(chain.map((p) => p.id)).toContain('lb');
    expect(chain.map((p) => p.id)).not.toContain('lc');
  });

  it('isolated primitive returns chain of length 1', () => {
    const iso: SketchPrimitive = { id: 'iso', kind: 'line', x1: 0, y1: 0, x2: 5, y2: 0 };
    expect(findChain(iso, [iso])).toHaveLength(1);
  });
});

describe('offsetChain — L-shaped chain, two lines', () => {
  // L-shape: la = horizontal (0,0)→(10,0), lb = vertical (10,0)→(10,10).
  // They share endpoint (10,0).
  // Offset d=2 to the LEFT of la / OUTSIDE of lb (outward):
  //   la offset → y = -2 (below): (0,-2)→(10,-2).
  //   lb offset → x = 12 (right): (12,0)→(12,10).
  // Miter join at the shared corner: intersect of (0,-2)→(10,-2) and (12,0)→(12,10)
  // → well, they don't intersect. Need to think about sign convention.
  //
  // Actually use d=+2 (left of la = upward, i.e. outside the L).
  //   la offset up: (0,2)→(10,2).
  //   lb offset left: (8,0)→(8,10).
  //   Intersection of (0,2)→(10,2) and (8,0)→(8,10): at (8,2).
  //   So the miter join replaces the corner with (8,2).
  //   Final chain: (0,2)→(8,2), (8,2)→(8,10).
  it('offsets an L-shaped chain and miter-joins the corner', () => {
    const la: SketchPrimitive = { id: 'la', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 };
    const lb: SketchPrimitive = { id: 'lb', kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 };
    const results = offsetChain([la, lb], 2); // d=+2 = upward for la = outward
    // Should produce 2 offset lines.
    expect(results).toHaveLength(2);
    const lines = results.filter(
      (p): p is Extract<SketchPrimitive, { kind: 'line' }> => p.kind === 'line',
    );
    expect(lines).toHaveLength(2);

    // Sort by starting x to identify la-offset vs lb-offset.
    const sorted = [...lines].sort((a, b) => a.x1 - b.x1);
    const laOff = sorted[0]!; // starts near x=0
    const lbOff = sorted[1]!; // starts near x=8

    // la-offset: y1=y2=2, x1=0.
    expect(laOff.y1).toBeCloseTo(2, 2);
    expect(laOff.y2).toBeCloseTo(2, 2);
    expect(laOff.x1).toBeCloseTo(0, 2);

    // lb-offset: x1=x2=8.
    expect(lbOff.x1).toBeCloseTo(8, 2);
    expect(lbOff.x2).toBeCloseTo(8, 2);

    // Shared miter corner: la-off x2 = lb-off x1y1 = (8,2).
    expect(laOff.x2).toBeCloseTo(8, 2);
    expect(lbOff.y1).toBeCloseTo(2, 2);
  });
});
```

- [ ] **Step 5-B: Run and confirm FAIL**

```bash
cd packages/app && npx vitest run src/sketcher/geometry/__tests__/offset.spec.ts
```

Expected failure: `findChain` and `offsetChain` not exported from `offset.ts`.

### Step 5-C: Implement chain offset in `geometry/offset.ts`

Open `packages/app/src/sketcher/geometry/offset.ts`. Move the `import { intersect } from './intersect';` line to the **top of the file** (with existing imports). Then add the following code after `offsetPrimitive`:

```ts
// (intersect import goes to the top of the file, not here)

const CHAIN_TOL = 1e-3; // endpoint coincidence tolerance for chain detection

/** Point endpoint of a line (start or end). */
type Endpoint = { x: number; y: number };

function lineEndpoints(l: Extract<SketchPrimitive, { kind: 'line' }>): [Endpoint, Endpoint] {
  return [{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }];
}

function epDist(a: Endpoint, b: Endpoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Walk all line primitives in `all` that form a connected chain starting
 * from `seed`. Returns the chain in connection order (includes seed).
 * Only lines are supported (arc/circle chain deferred to slice 3).
 */
export function findChain(seed: SketchPrimitive, all: SketchPrimitive[]): SketchPrimitive[] {
  if (seed.kind !== 'line') return [seed];
  const visited = new Set<string>([seed.id]);
  const chain: SketchPrimitive[] = [seed];

  // Grow forward from the last element in chain, then backward from the first.
  const grow = (fromPrim: Extract<SketchPrimitive, { kind: 'line' }>, appendFront: boolean): void => {
    const [ep0, ep1] = lineEndpoints(fromPrim);
    const searchEp = appendFront ? ep0 : ep1;
    for (const other of all) {
      if (visited.has(other.id) || other.kind !== 'line') continue;
      const [oa, ob] = lineEndpoints(other);
      if (epDist(searchEp, oa) < CHAIN_TOL || epDist(searchEp, ob) < CHAIN_TOL) {
        visited.add(other.id);
        if (appendFront) chain.unshift(other);
        else chain.push(other);
        grow(other, appendFront);
        break; // take first neighbor (chain, not tree)
      }
    }
  };

  if (seed.kind === 'line') {
    grow(seed, false); // forward
    grow(seed, true);  // backward
  }
  return chain;
}

/**
 * Offset an ordered chain of connected line segments by distance `d`, then
 * miter-join adjacent offset segments at their mutual intersection.
 * Returns the array of offset SketchPrimitives (same count as chain).
 *
 * If adjacent offset segments have no intersection (concave / degenerate corner),
 * the gap is left as-is (documented limitation — no self-intersection cleanup).
 */
export function offsetChain(chain: SketchPrimitive[], d: number): SketchPrimitive[] {
  if (chain.length === 0) return [];
  if (chain.length === 1) {
    const off = offsetPrimitive(chain[0]!, d);
    return off ? [off] : [];
  }

  // Offset each segment independently.
  const offsets = chain.map((p) => offsetPrimitive(p, d)).filter(Boolean) as SketchPrimitive[];
  if (offsets.length !== chain.length) return offsets; // degenerate

  // Miter-join adjacent pairs.
  for (let i = 0; i < offsets.length - 1; i++) {
    const a = offsets[i]!;
    const b = offsets[i + 1]!;
    if (a.kind !== 'line' || b.kind !== 'line') continue;

    // Extend both segments infinitely to find the miter point.
    const hits = intersect(a, b, false); // unbounded
    if (hits.length === 0) continue; // no miter (gap left)

    const miter = hits[0]!;
    // Update a's far endpoint (x2,y2) to miter point.
    offsets[i] = { ...a, x2: miter.x, y2: miter.y };
    // Update b's near endpoint (x1,y1) to miter point.
    offsets[i + 1] = { ...b, x1: miter.x, y1: miter.y };
  }

  return offsets;
}
```

> **Note for implementer:** `intersect` is imported from `./intersect` — verify this is correct relative to `offset.ts` location. Also check that `offsetPrimitive` is defined before `findChain`/`offsetChain` in the file (it is, since these additions go after it). The `import` statement at the top of the new block must be moved to the file's top-level imports.

### Step 5-D: Update `OffsetTool.ts` to use chain offset

Open `packages/app/src/sketcher/tools/OffsetTool.ts`. In `_commitAtDist`, replace the single-primitive offset call with:

```ts
private _commitAtDist(d: number): void {
  if (this.state.kind !== 'picked') return;
  const prim = this.primitives.find(
    (p) => p.id === (this.state as { kind: 'picked'; primitiveId: string }).primitiveId,
  );
  if (!prim) return;

  const chain = findChain(prim, this.primitives);
  if (chain.length > 1) {
    // Multi-segment path: offset the whole chain and emit all results.
    const results = offsetChain(chain, d);
    for (const r of results) this.opts.onCommit(r);
  } else {
    // Single-primitive path (preserved from slice 1).
    const offsetted = offsetPrimitive(prim, d);
    if (offsetted) this.opts.onCommit(offsetted);
  }
  this.state = { kind: 'idle' };
  this.opts.onPreview([]);
}
```

Update the existing import line at the top of `OffsetTool.ts`:
```ts
// Before:
import { offsetPrimitive } from '../geometry/offset';
// After:
import { offsetPrimitive, findChain, offsetChain } from '../geometry/offset';
```

- [ ] **Step 5-E: Run and confirm GREEN**

```bash
cd packages/app && npx vitest run src/sketcher/geometry/__tests__/offset.spec.ts
```

- [ ] **Step 5-F: Commit**

```bash
git add packages/app/src/sketcher/geometry/offset.ts \
        packages/app/src/sketcher/geometry/__tests__/offset.spec.ts \
        packages/app/src/sketcher/tools/OffsetTool.ts
git commit -m "feat(sketch): multi-segment chain offset with miter join via intersect.ts"
```

---

## Task 6 — Wiring: ToolKind unions + instantiate() + handlePointer + Ribbon buttons

**Files:**
- Modify: `packages/app/src/sketcher/ActiveToolController.ts` (ToolKind union, ActiveTool union, setToolKind escape, instantiate, handlePointer, handleKey)
- Modify: `packages/app/src/store/useAppStore.ts` (ToolKind union — MUST match ActiveToolController)
- Modify: `packages/app/src/shell/tabs/SketchTab.tsx` (three buttons in Modify panel)

**Tests:**
- Create: `packages/app/src/sketcher/__tests__/ActiveToolController.slice2.spec.ts`

### Step 6-A: Write the failing wiring test

> **Dep consistency (verified against `ActiveToolController.ts`):** The real `ControllerDeps` requires exactly `emitPrimitive` and `onPreview` as non-optional fields (`onPreview(polyline: Point2[] | null, snap: SnapResult): void` — 2 args). All other fields (`updatePrimitive`, `emitConstraint`, `deletePrimitive`, `getSketchFrame`) are optional (`?`). `vi.fn()` satisfies the 2-arg function type at runtime. Every `new ActiveToolController({...})` below supplies at minimum `emitPrimitive` and `onPreview`.
>
> **IMPORTANT for TypeScript:** `deletePrimitive` and `getSketchFrame` are NEW optional deps that Task 6-C adds to `ControllerDeps`. Before Task 6-C runs, passing these will cause a TypeScript "excess property" error. The test is therefore meant to FAIL at the TypeScript level until Task 6-C adds them to `ControllerDeps`. Use `// @ts-expect-error – added by Task 6-C` annotations on those lines if needed, OR simply write the test knowing it fails to compile first (which satisfies the TDD red step — TypeScript error IS the compile-time red).

Create `packages/app/src/sketcher/__tests__/ActiveToolController.slice2.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ActiveToolController } from '../ActiveToolController';
import { TrimTool } from '../tools/TrimTool';
import { ExtendTool } from '../tools/ExtendTool';
import { ProjectGeometryTool } from '../tools/ProjectGeometryTool';
import type { SketchPrimitive } from '@zilventor/shared';

// ControllerDeps required fields: emitPrimitive + onPreview (2-arg: polyline, snap).
// vi.fn() satisfies both. Optional new deps (deletePrimitive, getSketchFrame) are added
// by Task 6-C to ControllerDeps — until then TypeScript will reject them as excess props.
// This file is written BEFORE Task 6-C (TDD), so TypeScript errors here ARE the red step.

const frame = {
  origin: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 0, z: 1 },
  xDir:   { x: 1, y: 0, z: 0 },
};

// Shared complete deps bag: union of all deps any test in this file needs.
// TypeScript will only accept this after Task 6-C adds deletePrimitive + getSketchFrame.
function makeDeps() {
  return {
    emitPrimitive: vi.fn(),
    onPreview: vi.fn(),
    updatePrimitive: vi.fn(),
    emitConstraint: vi.fn(),
    deletePrimitive: vi.fn(),
    getSketchFrame: () => frame,
  };
}

describe('ActiveToolController — slice-2 tool instantiation', () => {
  it("setToolKind('trim') instantiates a TrimTool", () => {
    const c = new ActiveToolController(makeDeps());
    c.setToolKind('trim');
    expect(c.currentTool()).toBeInstanceOf(TrimTool);
  });

  it("setToolKind('extend') instantiates an ExtendTool", () => {
    const c = new ActiveToolController(makeDeps());
    c.setToolKind('extend');
    expect(c.currentTool()).toBeInstanceOf(ExtendTool);
  });

  it("setToolKind('project-geom') instantiates a ProjectGeometryTool", () => {
    const c = new ActiveToolController(makeDeps());
    c.setToolKind('project-geom');
    expect(c.currentTool()).toBeInstanceOf(ProjectGeometryTool);
  });
});

describe('ActiveToolController — TrimTool dispatch', () => {
  it('click on a line body with no crossings deletes the primitive', () => {
    const deps = makeDeps();
    const c = new ActiveToolController(deps);
    const primitives: SketchPrimitive[] = [
      { id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
    ];
    c.setToolKind('trim');
    c.handlePointer({ type: 'click', point: { x: 5, y: 0 } }, primitives);
    expect(deps.deletePrimitive).toHaveBeenCalledWith('l1');
  });
});

describe('ActiveToolController — ExtendTool dispatch', () => {
  it('click on a line near its end with a barrier extends it', () => {
    const deps = makeDeps();
    const c = new ActiveToolController(deps);
    const primitives: SketchPrimitive[] = [
      { id: 'lh', kind: 'line', x1: 0, y1: 0, x2: 8, y2: 0 },
      { id: 'barrier', kind: 'line', x1: 15, y1: -5, x2: 15, y2: 5 },
    ];
    c.setToolKind('extend');
    c.handlePointer({ type: 'click', point: { x: 8, y: 0 } }, primitives);
    expect(deps.updatePrimitive).toHaveBeenCalledTimes(1);
    expect(deps.updatePrimitive.mock.calls[0]![0]).toBe('lh');
  });
});
```

- [ ] **Step 6-B: Run and confirm FAIL**

```bash
cd packages/app && npx vitest run src/sketcher/__tests__/ActiveToolController.slice2.spec.ts
```

Expected failures: `'trim'` is not in ToolKind union (TypeScript error) + `TrimTool` / `ExtendTool` / `ProjectGeometryTool` not imported.

### Step 6-C: Update `ActiveToolController.ts`

Open `packages/app/src/sketcher/ActiveToolController.ts`.

1. **Add imports** (after existing tool imports):
```ts
import { TrimTool } from './tools/TrimTool';
import { ExtendTool } from './tools/ExtendTool';
import { ProjectGeometryTool } from './tools/ProjectGeometryTool';
import type { SketchFrame } from './geometry/projectToSketch';
```

2. **Extend ToolKind union** (currently ends at `'chamfer'`):
```ts
| 'trim'
| 'extend'
| 'project-geom'
```

3. **Add `deletePrimitive` and `getSketchFrame` to `ControllerDeps`:**
```ts
deletePrimitive?(id: string): void;
getSketchFrame?(): SketchFrame | null;
```

4. **Extend `ActiveTool` union** (line ~53):
```ts
type ActiveTool = SketchTool | SelectTool | ConstraintTool | GeneralDimensionTool | OffsetTool | FilletTool | ChamferTool | TrimTool | ExtendTool | ProjectGeometryTool;
```

5. **Extend `setToolKind` escape block** — add before `this.tool = kind ? this.instantiate(kind) : null`:
```ts
} else if (this.tool instanceof TrimTool) {
  this.tool.onEscapePressed();
} else if (this.tool instanceof ExtendTool) {
  this.tool.onEscapePressed();
} else if (this.tool instanceof ProjectGeometryTool) {
  this.tool.onEscapePressed();
}
```

6. **Extend `instantiate()` switch** (add before the closing `}`):
```ts
case 'trim':
  return new TrimTool({
    addPrimitive: (p) => this.deps.emitPrimitive(p),
    deletePrimitive: (id) => this.deps.deletePrimitive?.(id),
    updatePrimitive: (id, patch) => this.deps.updatePrimitive?.(id, patch),
  });

case 'extend':
  return new ExtendTool({
    updatePrimitive: (id, patch) => this.deps.updatePrimitive?.(id, patch),
  });

case 'project-geom':
  return new ProjectGeometryTool({
    frame: this.deps.getSketchFrame?.() ?? null,
    emitPrimitive: (p) => this.deps.emitPrimitive(p),
    showToast: (msg) => {
      // Toast surfaced via a ControllerDeps hook or logged — App.tsx wires showToast.
      // For now: noop (App.tsx extends this in the next wiring step).
      console.warn('[ProjectGeometryTool]', msg);
    },
  });
```

> **Note for implementer:** Read `ControllerDeps` carefully. `deletePrimitive` is a new dep being added. `getSketchFrame` is also new. Verify that the TypeScript union is exhaustive (no missed case) before committing. The `showToast` noop is temporary — App.tsx wires it in the same task.

7. **Extend `handlePointer()** — add branches before the SketchTool path:
```ts
if (this.tool instanceof TrimTool) {
  this.tool.setPrimitives(primitives);
  if (event.type === 'click') this.tool.onPointerClick(event.point);
  return;
}

if (this.tool instanceof ExtendTool) {
  this.tool.setPrimitives(primitives);
  if (event.type === 'click') this.tool.onPointerClick(event.point);
  return;
}

// ProjectGeometryTool pointer events are handled separately via projectEdge()
// called from App.tsx (it needs the tessellatedEdgesRef, not 2D primitives).
if (this.tool instanceof ProjectGeometryTool) {
  return; // handled externally
}
```

8. **Extend `handleKey()`** — add before the SketchTool path:
```ts
if (this.tool instanceof TrimTool) {
  if (key === 'Escape') this.tool.onEscapePressed();
  return;
}
if (this.tool instanceof ExtendTool) {
  if (key === 'Escape') this.tool.onEscapePressed();
  return;
}
if (this.tool instanceof ProjectGeometryTool) {
  if (key === 'Escape') this.tool.onEscapePressed();
  return;
}
```

### Step 6-D: Update `useAppStore.ts` ToolKind union

Open `packages/app/src/store/useAppStore.ts`. Find the `ToolKind` type (line ~16). Add to the union:

```ts
| 'trim'
| 'extend'
| 'project-geom'
```

**This is mandatory** — the two ToolKind definitions MUST be kept in sync.

### Step 6-E: Update `SketchTab.tsx` ribbon

Open `packages/app/src/shell/tabs/SketchTab.tsx`. In the `<RibbonPanel title="Modify">` section (currently has Offset, Fillet, Chamfer buttons at lines ~122-147), add three new buttons:

```tsx
<button
  aria-pressed={activeToolKind === 'trim'}
  className={`text-xs ${activeToolKind === 'trim' ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
  disabled={!sketchMode}
  onClick={() => useAppStore.getState().setActiveToolKind('trim')}
>
  Trim
</button>
<button
  aria-pressed={activeToolKind === 'extend'}
  className={`text-xs ${activeToolKind === 'extend' ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
  disabled={!sketchMode}
  onClick={() => useAppStore.getState().setActiveToolKind('extend')}
>
  Extend
</button>
<button
  aria-pressed={activeToolKind === 'project-geom'}
  className={`text-xs ${activeToolKind === 'project-geom' ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
  disabled={!sketchMode}
  onClick={() => useAppStore.getState().setActiveToolKind('project-geom')}
>
  Project
</button>
```

### Step 6-F: Wire `deletePrimitive` and `getSketchFrame` in `App.tsx`

Open `packages/app/src/App.tsx`. Find where `ActiveToolController` is constructed (~line 1164). Add to the deps bag:

```ts
deletePrimitive: (id) => {
  void (async () => {
    const store = useAppStore.getState();
    if (!store.kernel || !store.activePart || !store.activeSketchId) return;
    await store.bus.execute(new DeletePrimitiveCommand({
      kernel: store.kernel,
      store: { activePart: store.activePart, setActivePart: store.setActivePart },
      sketchId: store.activeSketchId,
      primitiveId: id,
    }));
  })();
},
getSketchFrame: () => {
  // Resolve the sketch plane frame for ProjectGeometryTool.
  // workFeatures contains WorkFeatureValue[] from the last execute.
  // For workPlane-sourced sketches, the plane's xDir comes from SketchFeature.
  // For MVP: only origin.XY/YZ/XZ planes are supported (xDir is well-known).
  const store = useAppStore.getState();
  if (!store.activePart || !store.activeSketchId) return null;
  const sketch = store.activePart.featureTree.find(
    (f) => f.kind === 'sketch' && f.id === store.activeSketchId
  );
  if (!sketch || sketch.kind !== 'sketch') return null;
  const plane = sketch.plane;
  if (plane.source !== 'workPlane') return null; // face-sourced: not supported
  if (plane.featureId === 'origin.XY') {
    return { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, xDir: { x: 1, y: 0, z: 0 } };
  }
  if (plane.featureId === 'origin.YZ') {
    return { origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 }, xDir: { x: 0, y: 1, z: 0 } };
  }
  if (plane.featureId === 'origin.XZ') {
    return { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, xDir: { x: 1, y: 0, z: 0 } };
  }
  return null; // custom work plane: resolve from workFeatures if available
},
```

Also add the import for `DeletePrimitiveCommand` at the top of App.tsx if not already present:
```ts
import { DeletePrimitiveCommand } from './commands/DeletePrimitiveCommand';
```

- [ ] **Step 6-G: Run and confirm GREEN**

```bash
cd packages/app && npx vitest run src/sketcher/__tests__/ActiveToolController.slice2.spec.ts
```

Also confirm no regressions:
```bash
cd packages/app && npx vitest run src/sketcher/__tests__/
```

- [ ] **Step 6-H: Commit**

```bash
git add packages/app/src/sketcher/ActiveToolController.ts \
        packages/app/src/store/useAppStore.ts \
        packages/app/src/shell/tabs/SketchTab.tsx \
        packages/app/src/App.tsx \
        packages/app/src/sketcher/__tests__/ActiveToolController.slice2.spec.ts
git commit -m "feat(sketch): wire Trim/Extend/ProjectGeom into ActiveToolController, useAppStore, SketchTab, App.tsx"
```

---

## Task 7 — End-to-End test (real canvas pick)

**Files:**
- Create: `tests/e2e/sketch-productivity-tools-slice2.spec.ts`

**Goal:** Close the slice-1 e2e gap — drive non-trivial behaviors through the **live canvas** (real mouse click → tool fires → store updated). Two tests: ribbon button visibility (A) and Trim via real canvas click (B).

> **Note on Fillet-coincident coverage:** The Fillet coincident constraint fix is fully covered by the T4 unit test (`FilletTool.spec.ts`). There is **no e2e test C for fillet-coincident** — the previous plan contained a `page.evaluate(async () => { const { FilletTool } = await import('/src/sketcher/tools/FilletTool.ts'); ... })` pattern that was removed because: (a) dynamic Vite module imports in `page.evaluate` are fragile and path-dependent; (b) the test didn't drive through the command bus; (c) T4 already provides full coincident-constraint coverage. The T4 unit test is the authoritative gate for this behavior.

> **Seeding pattern for Trim B:** Seeding the crossing lines via `window.__zilventorStore.kernel.addFeature` (the same `kernelAddSketch` approach used by slice-1 e2e) is acceptable as PRECONDITION setup. The TRIM ACTION itself must be driven through the REAL canvas (set tool via ribbon button click, then dispatch real canvas pointer click on the segment to remove). Store-access assertions use `window.__zilventorStore.getState()` directly — more reliable than `[data-sketch-primitive-count]` DOM attributes.

### Step 7-A: Write the failing e2e test

Create `tests/e2e/sketch-productivity-tools-slice2.spec.ts`:

```ts
/**
 * Slice-2 sketch productivity tools — end-to-end gate.
 *
 * A) Ribbon: Trim, Extend, Project buttons visible in sketch mode.
 * B) Trim: seed two crossing lines via kernelAddSketch, invoke Trim via ribbon button,
 *    click the segment to remove via REAL canvas click, assert surviving geometry via store.
 *    This closes the slice-1 gap: the TRIM ACTION runs through the real canvas pick→emit→
 *    command→solve→render path (unlike slice-1 which bypassed the canvas for the action-under-test).
 *
 * Fillet-coincident is covered by the T4 unit test (FilletTool.spec.ts) — not e2e.
 * The dynamic-import pattern (page.evaluate + import('/src/...')) is intentionally
 * avoided here: it's Vite-path fragile and doesn't test through the command bus.
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
  bus: { execute(c: unknown): Promise<unknown> };
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
};

type Constraint = { kind: string; id: string };

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

async function enterSketchMode(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.getByRole('button', { name: '2D Sketch' }).click();
  await expect(page.getByRole('button', { name: /Finish Sketch/i })).toBeVisible();
}

// ---------------------------------------------------------------------------
// Helper: seed a sketch with primitives via kernel API (mirrors slice-1 pattern).
// ---------------------------------------------------------------------------
async function kernelAddSketch(
  page: import('@playwright/test').Page,
  sketchId: string,
  primitives: Primitive[],
): Promise<void> {
  await page.evaluate(
    async ({ sketchId, primitives }: { sketchId: string; primitives: Primitive[] }) => {
      const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
      if (!s.kernel || !s.activePart) throw new Error('kernel or activePart not ready');
      await s.kernel.addFeature(s.activePart.id, {
        kind: 'sketch',
        id: sketchId,
        plane: { source: 'workPlane', featureId: 'origin.XY' },
        primitives,
        constraints: [],
      });
      const next = await s.kernel.getPart(s.activePart.id);
      s.setActivePart(next);
    },
    { sketchId, primitives },
  );
}

// ---------------------------------------------------------------------------
// A) Ribbon buttons
// ---------------------------------------------------------------------------
test.describe('Slice-2 sketch tools — ribbon visibility', () => {
  test('Trim, Extend, Project buttons appear in sketch mode', async ({ page }) => {
    await setupNewPart(page);
    await enterSketchMode(page);
    await expect(page.getByRole('button', { name: /^Trim$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Extend$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Project$/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// B) Trim — real canvas pick (closes slice-1's canvas-bypass gap)
// ---------------------------------------------------------------------------
test.describe('Slice-2 sketch tools — Trim via real canvas click', () => {
  test(
    'seed two crossing lines, activate Trim via ribbon, click canvas to trim a segment, assert store',
    async ({ page }) => {
      page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
      await setupNewPart(page);
      await enterSketchMode(page);

      // PRECONDITION: seed two crossing lines via kernel (acceptable precondition seeding,
      // same pattern as slice-1 kernelAddSketch — the TRIM ACTION is what runs via canvas).
      // Lines: horizontal lh (y=0, x1=-30 to x2=30) and vertical lv (x=0, y1=-30 to y2=30).
      // They cross at (0,0) = sketch origin.
      await kernelAddSketch(page, 'sk-trim-e2e', [
        { id: 'lh', kind: 'line', x1: -30, y1: 0, x2: 30, y2: 0 },
        { id: 'lv', kind: 'line', x1: 0, y1: -30, x2: 0, y2: 30 },
      ]);

      // Verify 2 primitives in store before trim.
      const before = await page.evaluate(() => {
        const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
        const sketchId = s.activeSketchId;
        const sketch = s.activePart?.featureTree.find((f) => f.kind === 'sketch' && f.id === sketchId);
        if (!sketch || sketch.kind !== 'sketch') return 0;
        return sketch.primitives.length;
      });
      expect(before).toBe(2);

      // TRIM ACTION: activate Trim via ribbon button (REAL canvas interaction, not store.setActiveToolKind).
      await page.getByRole('button', { name: /^Trim$/i }).click();

      // Click on the RIGHT half of the horizontal line (sketch coord ~(15,0) → screen).
      // The viewport maps the sketch coordinate system to screen pixels. The crossing is at
      // sketch origin. We click to the right of center to hit the right half of lh.
      const viewport = page.locator('main#region-viewport canvas');
      const box = (await viewport.boundingBox())!;
      const cx = box.width / 2;
      const cy = box.height / 2;
      // Clicking (cx+50, cy) hits the right half of lh in screen space (right of the crossing).
      await viewport.click({ position: { x: cx + 50, y: cy }, force: true });

      // Wait for the store to reflect a change in primitive count or geometry.
      // After trim of the right half of lh: lh is shortened (end-trim → updatePrimitive)
      // OR deleted + two remnants added (interior trim) — either way, primitive count changes
      // from 2 to ≥ 2 (but lh's geometry changes).
      await page.waitForFunction(
        () => {
          const s = (window as unknown as ZilventorWindow).__zilventorStore.getState();
          const sketchId = s.activeSketchId;
          const sketch = s.activePart?.featureTree.find(
            (f: { kind: string }) => f.kind === 'sketch' && (f as { id: string }).id === sketchId,
          ) as { primitives: Primitive[] } | undefined;
          if (!sketch) return false;
          // Primitive count changed OR lh's x2 changed (shortened).
          const lh = sketch.primitives.find((p: Primitive) => p.id === 'lh');
          // If lh was deleted and replaced, it won't exist → count changed.
          if (!lh) return sketch.primitives.length !== 2;
          // lh still exists but should be shortened: x2 < 30.
          return (lh.x2 ?? 30) < 29;
        },
        { timeout: 8_000 },
      );

      // Assert via store (not DOM attribute — more reliable).
      const state = await getState(page);
      const sketchId = state.activeSketchId;
      const sketch = state.activePart?.featureTree.find(
        (f): f is Extract<Feature, { kind: 'sketch' }> =>
          f.kind === 'sketch' && f.id === sketchId,
      );
      expect(sketch).toBeDefined();
      // The vertical line (lv) must still exist unchanged.
      expect(sketch!.primitives.some((p) => p.id === 'lv')).toBe(true);
      // Horizontal line (lh) either was shortened or deleted+replaced, but the
      // surviving geometry no longer covers the full x1=-30 to x2=30 span:
      const lhAfter = sketch!.primitives.find((p) => p.id === 'lh');
      if (lhAfter) {
        // Shortened case: x2 should be ≤ 0 (crossing point) or < 30.
        expect((lhAfter.x2 ?? 30)).toBeLessThan(29);
      } else {
        // Delete+split case: two new primitives exist with different ids.
        expect(sketch!.primitives.length).toBeGreaterThanOrEqual(2);
      }
    },
  );
});
```

- [ ] **Step 7-B: Run and confirm FAIL (app not running)**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor && npx playwright test tests/e2e/sketch-productivity-tools-slice2.spec.ts
```

Expected failures: test A fails (buttons not visible — not wired yet in Task 6); test B fails (Trim not wired + canvas not seeded correctly until Task 6 runs).

After completing Task 6 (wiring), re-run and confirm GREEN:
```bash
npx playwright test tests/e2e/sketch-productivity-tools-slice2.spec.ts
```

- [ ] **Step 7-C: Commit**

```bash
git add tests/e2e/sketch-productivity-tools-slice2.spec.ts
git commit -m "test(e2e): sketch slice-2 — real canvas Trim pick + ribbon visibility (fillet-coincident covered by T4 unit)"
```

---

## Task 8 — Full suite + §6 browser verification

- [ ] **Step 8-A: Run all app unit tests**

```bash
cd packages/app && npx vitest run
```

Expected: GREEN. No regressions in slice-1 tests (`offset.spec.ts`, `fillet.spec.ts`, `ActiveToolController.fillet.spec.ts`, `ActiveToolController.offset.spec.ts`).

- [ ] **Step 8-B: TypeScript compile check**

```bash
cd packages/app && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8-C: §6 browser verification (Playwright screenshots)**

Run the slice-2 e2e and screenshot the post-trim state. This is the §6 gate — the change is not "done" until a screenshot is captured and read back.

```bash
npx playwright test tests/e2e/sketch-productivity-tools-slice2.spec.ts --headed
```

Screenshot the viewport after trim to confirm the right segment is visually absent.

- [ ] **Step 8-D: Final commit**

```bash
git add -p  # stage any remaining edits
git commit -m "chore(sketch): slice-2 final suite pass — all unit + e2e green"
```

---

## Summary checklist

| Task | Deliverable | Key test files |
|---|---|---|
| T0 | `geometry/intersect.ts` | `geometry/__tests__/intersect.spec.ts` |
| T1 | `tools/TrimTool.ts` | `tools/__tests__/TrimTool.spec.ts` |
| T2 | `tools/ExtendTool.ts` | `tools/__tests__/ExtendTool.spec.ts` |
| T3 | `geometry/projectToSketch.ts` + `tools/ProjectGeometryTool.ts` | `tools/__tests__/ProjectGeometryTool.spec.ts` |
| T4 | `FilletTool.ts` coincident fix | extended `FilletTool.spec.ts` |
| T5 | `geometry/offset.ts` chain + `OffsetTool.ts` | extended `offset.spec.ts` |
| T6 | Wiring: `ActiveToolController.ts`, `useAppStore.ts`, `SketchTab.tsx`, `App.tsx` | `__tests__/ActiveToolController.slice2.spec.ts` |
| T7 | e2e: `tests/e2e/sketch-productivity-tools-slice2.spec.ts` | Playwright |
| T8 | Full suite + §6 browser verification | — |
