# DXF Phase 4a — Correct Flat Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task is TDD: write the failing test, run it red, implement minimally, run it green, commit.

**Goal:** Turn a parsed DXF file into editable 2D sketch primitives on a chosen plane — correct flat import of LINE/CIRCLE/ARC/ELLIPSE/SPLINE/LWPOLYLINE/POLYLINE, honoring `$INSUNITS`, OCS extrusion direction, and polyline bulges — exposed via two undoable app commands and two entry points.

**Architecture:** Three layers. (A) Extend the dep-free shared DXF parser to parse the HEADER section, OCS extrusion (210/220/230), and SPLINE fit-point/knot/weight fidelity. (B) A new pure shared module `toSketch.ts` maps `ParsedDxf` → `{ primitives, annotations, dropped }`, applying unit scaling, OCS→WCS transform, ARC deg→rad, ellipse decomposition, and bulge→arc. (C) Two undoable app commands (`ImportDxfIntoNewPartCommand`, `ImportDxfIntoActiveSketchCommand`) plus a `buildSketchPartDocument` helper and FileTab + sketch-ribbon entry points.

**Tech Stack:** TypeScript, vitest (unit), Playwright (e2e, Chromium). pnpm workspace: `@zilventor/shared` (zero runtime deps), `@zilventor/app`, `@zilventor/kernel`.

**Approved spec:** `docs/superpowers/specs/2026-06-22-dxf-phase4-importer-design.md`. Do NOT re-design — this plan implements 4a only (the P0 floor).

## Global Constraints

- **Branch:** `feat/dxf-support` (NOT merged). Commit per task; **do NOT push, do NOT merge to master.**
- **No manifest bump in 4a** — emit only existing v31 `SketchPrimitive` shapes. No new serialized shapes, no migration.
- **`@zilventor/shared` has zero runtime deps** — `toSketch` and parser code must be pure, plain-data in / plain-data out. No imports outside `@zilventor/shared`.
- **Sketch angle convention:** `arc.startAngle`/`arc.endAngle` and `ellipse.startAngle`/`endAngle`/`rotation` are **radians, CCW from +X** (proven in `packages/kernel/src/occt/SketchOps.ts:165`). DXF ARC angles are **degrees** → convert `rad = deg·π/180`. DXF ELLIPSE params (41/42) are **radians** → copied directly.
- **Per-package test commands (run from INSIDE the package dir):**
  - shared: `cd packages/shared && npx vitest run`
  - app: `cd packages/app && npx vitest run`
  - e2e (from repo root): `npx playwright test --project=chromium tests/e2e/drawing/dxf-import.spec.ts`
- **Typecheck per package directly** (`pnpm -r typecheck` can mask): `cd packages/<pkg> && npx tsc --noEmit -p tsconfig.json` (or the package's typecheck script). `pnpm lint` (root `eslint .`) must stay **0**.
- `exactOptionalPropertyTypes` is ON — never assign `x: maybeUndefined` to an optional field; use conditional spread `...(cond ? { x } : {})`.
- Headless Chrome renders the viewport BLACK — assert via `window.__zilventorStore` probe / DOM, never pixels. `__zilventorStore` is DEV-gated (present in `vite` dev / Playwright, absent on prod build).

## File Structure

| File | Responsibility | Tasks |
| --- | --- | --- |
| `packages/shared/src/dxf/types.ts` | Add `header` typing stays `Record<string,string>`; add OCS `extrusion?` + Z to entities; extend `DxfSpline` with `fitPoints`/`knots`/`weights` | 1,2,3 |
| `packages/shared/src/dxf/parser.ts` | `parseHeader` pre-pass; read OCS 210/220/230; SPLINE fit/knot/weight; `nums()` helper | 1,2,3 |
| `packages/shared/src/dxf/toSketch.ts` | **NEW** pure `toSketch(parsed)` → `{ primitives, annotations, dropped }` | 4,5,6 |
| `packages/shared/src/dxf/__tests__/toSketch.spec.ts` | **NEW** unit tests for the mapping | 4,5,6 |
| `packages/shared/src/dxf/index.ts` | Re-export `toSketch` | 4 |
| `packages/app/src/import/buildSketchPartDocument.ts` | **NEW** pure helper: primitives → `PartDocument` | 7 |
| `packages/app/src/commands/ImportDxfIntoNewPartCommand.ts` | **NEW** undoable new-part import | 7 |
| `packages/app/src/commands/ImportDxfIntoActiveSketchCommand.ts` | **NEW** undoable active-sketch batch import | 8 |
| `packages/app/src/shell/FileTab.tsx` | "Import DXF…" entry → new-part command + `DXF_MAX_BYTES` | 9 |
| `packages/app/src/sketcher/SketchTab.tsx` (+ App.tsx) | sketch-ribbon "Import DXF…" → active-sketch command (dispatched from App.tsx) | 9 |
| `packages/app/src/i18n/locales/{en,uk}.json` | labels + status strings | 9 |
| `tests/e2e/drawing/dxf-import.spec.ts` + `tests/e2e/fixtures/*.dxf` | **NEW** §6 real-browser e2e | 9 |

---

### Task 1: Parser — HEADER section (`$INSUNITS`, `$ACADVER`)

**Why:** `result.header` is always `{}` today (`parser.ts:84`) because the entity loop only accumulates pairs while `raw` is non-null, and HEADER variables are code-`9`-delimited with no code-`0` entity boundaries. A standalone pre-pass over the full token list is the clean fix and is independently testable.

**Files:**
- Modify: `packages/shared/src/dxf/parser.ts`
- Test: `packages/shared/src/dxf/__tests__/parser.spec.ts` (existing file — append)

**Interfaces:**
- Consumes: `tokenize(text): DxfPair[]` (existing), `DxfPair = { code: number; value: string }`.
- Produces: `parseDxf(...).header: Record<string, string>` populated; e.g. `header['$INSUNITS'] === '4'`, `header['$ACADVER'] === 'AC1015'`. Each header variable maps to **the value of the pair immediately following its `9 <name>` pair** (as a string).

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/shared/src/dxf/__tests__/parser.spec.ts
import { parseDxf } from '../parser';

function headerDxf(body: string): string {
  return ['  0', 'SECTION', '  2', 'HEADER', body.trim(), '  0', 'ENDSEC', '  0', 'EOF'].join('\n');
}

describe('parseDxf HEADER section', () => {
  it('captures $INSUNITS and $ACADVER from the HEADER section', () => {
    const dxf = headerDxf([
      '  9', '$ACADVER', '  1', 'AC1015',
      '  9', '$INSUNITS', ' 70', '4',
      '  9', '$EXTMIN', ' 10', '0.0', ' 20', '0.0', ' 30', '0.0',
    ].join('\n'));
    const r = parseDxf(dxf);
    expect(r.header['$ACADVER']).toBe('AC1015');
    expect(r.header['$INSUNITS']).toBe('4');
    expect(r.header['$EXTMIN']).toBe('0.0'); // first value pair after the var name
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run dxf/__tests__/parser.spec.ts -t "HEADER section"`
Expected: FAIL — `r.header['$INSUNITS']` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

Add `parseHeader` and call it inside `parseDxf`:

```ts
// packages/shared/src/dxf/parser.ts — add near the top-level helpers (after str())
/** Extracts HEADER variables: each `9 <name>` maps to the value of the next pair. */
function parseHeader(pairs: DxfPair[]): Record<string, string> {
  const header: Record<string, string> = {};
  let inHeader = false;
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i]!;
    if (p.code === 0 && p.value === 'SECTION') {
      const next = pairs[i + 1];
      inHeader = !!next && next.code === 2 && next.value === 'HEADER';
      continue;
    }
    if (p.code === 0 && (p.value === 'ENDSEC' || p.value === 'EOF')) { inHeader = false; continue; }
    if (inHeader && p.code === 9) {
      const valuePair = pairs[i + 1];
      if (valuePair && valuePair.code !== 9 && valuePair.code !== 0) header[p.value] = valuePair.value;
    }
  }
  return header;
}
```

Then in `parseDxf`, after `pairs = tokenize(text);` succeeds, set the header:

```ts
// packages/shared/src/dxf/parser.ts — inside parseDxf, replace `header: {}` initialization usage
// after the try/catch that assigns `pairs`:
result.header = parseHeader(pairs);
```

(Keep the `const result: ParsedDxf = { entities: [], blocks: {}, header: {} };` line; just assign `result.header = parseHeader(pairs);` after a successful tokenize, before the main loop.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run dxf/__tests__/parser.spec.ts`
Expected: PASS (all existing + new).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/parser.ts packages/shared/src/dxf/__tests__/parser.spec.ts
git commit -m "feat(dxf): parse HEADER section ($INSUNITS/$ACADVER) — Phase 4a task 1"
```

---

### Task 2: Parser — OCS extrusion (210/220/230) + Z/elevation

**Files:**
- Modify: `packages/shared/src/dxf/types.ts`, `packages/shared/src/dxf/parser.ts`
- Test: `packages/shared/src/dxf/__tests__/parser.spec.ts`

**Interfaces:**
- Produces: optional `extrusion?: { x: number; y: number; z: number }` on `DxfCircle`, `DxfArc`, `DxfEllipse`, `DxfLwPolyline`, `DxfPolyline`. Absent ⇒ caller treats as `(0,0,1)`. Read group codes 210/220/230 (220/230 default 0, 210 default 0 — only emit `extrusion` when at least one of 210/220/230 is present; default z to 1 when 210/220 present but 230 absent). Downstream `toSketch` (Task 5) consumes `extrusion`.

- [ ] **Step 1: Write the failing test**

```ts
// append to parser.spec.ts
describe('parseDxf OCS extrusion', () => {
  it('reads extrusion (0,0,-1) on a CIRCLE', () => {
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','CIRCLE','  8','0',' 10','5.0',' 20','5.0',' 40','3.0',
      '210','0.0','220','0.0','230','-1.0',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('CIRCLE');
    if (e.type === 'CIRCLE') expect(e.extrusion).toEqual({ x: 0, y: 0, z: -1 });
  });
  it('leaves extrusion undefined when 210/220/230 absent', () => {
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','CIRCLE','  8','0',' 10','1',' 20','1',' 40','2',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const e = parseDxf(dxf).entities[0]!;
    if (e.type === 'CIRCLE') expect(e.extrusion).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run dxf/__tests__/parser.spec.ts -t "OCS extrusion"`
Expected: FAIL — `e.extrusion` is `undefined` for the first case (field does not exist / not read).

- [ ] **Step 3: Write minimal implementation**

In `types.ts`, add the optional field to the five OCS entity members:

```ts
// types.ts — add `extrusion?: { x: number; y: number; z: number }` to these union members:
//   { type: 'CIRCLE'; ...; extrusion?: { x: number; y: number; z: number } }
//   { type: 'ARC'; ...; extrusion?: { x: number; y: number; z: number } }
//   { type: 'ELLIPSE'; ...; extrusion?: { x: number; y: number; z: number } }
//   { type: 'LWPOLYLINE'; ...; extrusion?: { x: number; y: number; z: number } }
//   { type: 'POLYLINE'; ...; extrusion?: { x: number; y: number; z: number } }
```

In `parser.ts`, add an extrusion reader and apply it:

```ts
// parser.ts — add helper near num()/str()
function extrusion(pairs: DxfPair[]): { x: number; y: number; z: number } | undefined {
  const has = pairs.some((q) => q.code === 210 || q.code === 220 || q.code === 230);
  if (!has) return undefined;
  return { x: num(pairs, 210, 0), y: num(pairs, 220, 0), z: num(pairs, 230, 1) };
}
```

Then in `readEntity`, fold extrusion into CIRCLE/ARC/ELLIPSE returns via conditional spread, e.g.:

```ts
case 'CIRCLE': {
  const ex = extrusion(raw.pairs);
  return { type: 'CIRCLE', layer, cx: num(raw.pairs, 10), cy: num(raw.pairs, 20), r: num(raw.pairs, 40),
    ...(ex ? { extrusion: ex } : {}) };
}
case 'ARC': {
  const ex = extrusion(raw.pairs);
  return { type: 'ARC', layer, cx: num(raw.pairs, 10), cy: num(raw.pairs, 20), r: num(raw.pairs, 40),
    startAngle: num(raw.pairs, 50), endAngle: num(raw.pairs, 51), ...(ex ? { extrusion: ex } : {}) };
}
case 'ELLIPSE': {
  const ex = extrusion(raw.pairs);
  return { type: 'ELLIPSE', layer, cx: num(raw.pairs, 10), cy: num(raw.pairs, 20),
    majorX: num(raw.pairs, 11), majorY: num(raw.pairs, 21),
    ratio: num(raw.pairs, 40), startParam: num(raw.pairs, 41), endParam: num(raw.pairs, 42, 2 * Math.PI),
    ...(ex ? { extrusion: ex } : {}) };
}
```

For LWPOLYLINE add `...(extrusion(raw.pairs) ? { extrusion: extrusion(raw.pairs)! } : {})` to its return; for POLYLINE, read extrusion from the `__POLYHDR__` pairs in `flush()` and add to the constructed `ent` in the `SEQEND` branch (store it on `polyline` like `layer`/`closed`). Concretely, extend the `polyline` accumulator: `let polyline: { layer; closed; extrusion?; vertices } | null` and in the `__POLYHDR__` flush set `polyline.extrusion = extrusion(raw.pairs);`, then spread into the SEQEND `ent`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run dxf/__tests__/parser.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/types.ts packages/shared/src/dxf/parser.ts packages/shared/src/dxf/__tests__/parser.spec.ts
git commit -m "feat(dxf): read OCS extrusion (210/220/230) on OCS entities — Phase 4a task 2"
```

---

### Task 3: Parser — SPLINE fidelity (fit-point fallback + knots/weights)

**Files:**
- Modify: `packages/shared/src/dxf/types.ts`, `packages/shared/src/dxf/parser.ts`
- Test: `packages/shared/src/dxf/__tests__/parser.spec.ts`

**Interfaces:**
- Produces: `DxfSpline` gains `fitPoints: Array<{ x: number; y: number }>`, `knots: number[]`, `weights: number[]` (all default `[]`). Existing `controlPoints`/`degree`/`closed` unchanged. Group codes: fit points 11(x)/21(y); knots 40 (repeated); weights 41 (repeated). `toSketch` (Task 4) uses `controlPoints.length ? controlPoints : fitPoints` and clamps degree to `poles − 1`.

- [ ] **Step 1: Write the failing test**

```ts
// append to parser.spec.ts
describe('parseDxf SPLINE fidelity', () => {
  it('reads fit points and knots when control points are absent', () => {
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','SPLINE','  8','0',' 71','3',
      ' 40','0',' 40','0',' 40','1',' 40','1',
      ' 11','0',' 21','0',' 11','5',' 21','5',' 11','10',' 21','0',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('SPLINE');
    if (e.type === 'SPLINE') {
      expect(e.controlPoints).toHaveLength(0);
      expect(e.fitPoints).toEqual([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }]);
      expect(e.knots).toEqual([0, 0, 1, 1]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run dxf/__tests__/parser.spec.ts -t "SPLINE fidelity"`
Expected: FAIL — `e.fitPoints` does not exist.

- [ ] **Step 3: Write minimal implementation**

In `types.ts`, extend the SPLINE member:

```ts
// { type: 'SPLINE'; layer: string; degree: number; closed: boolean;
//   controlPoints: Array<{ x: number; y: number }>;
//   fitPoints: Array<{ x: number; y: number }>; knots: number[]; weights: number[] }
```

In `parser.ts`, add a `nums()` multi-collector and extend the SPLINE branch:

```ts
// parser.ts — add helper near num()
function nums(pairs: DxfPair[], code: number): number[] {
  const out: number[] = [];
  for (const q of pairs) if (q.code === code) { const n = Number.parseFloat(q.value); if (Number.isFinite(n)) out.push(n); }
  return out;
}
```

```ts
// parser.ts — SPLINE branch
case 'SPLINE': {
  const f = (s: string): number => { const n = Number.parseFloat(s); return Number.isFinite(n) ? n : 0; };
  const cps: Array<{ x: number; y: number }> = [];
  const fps: Array<{ x: number; y: number }> = [];
  let cx: number | null = null;
  let fx: number | null = null;
  for (const q of raw.pairs) {
    if (q.code === 10) cx = f(q.value);
    else if (q.code === 20 && cx !== null) { cps.push({ x: cx, y: f(q.value) }); cx = null; }
    else if (q.code === 11) fx = f(q.value);
    else if (q.code === 21 && fx !== null) { fps.push({ x: fx, y: f(q.value) }); fx = null; }
  }
  return { type: 'SPLINE', layer, degree: num(raw.pairs, 71, 3), closed: (num(raw.pairs, 70) & 1) === 1,
    controlPoints: cps, fitPoints: fps, knots: nums(raw.pairs, 40), weights: nums(raw.pairs, 41) };
}
```

> **Note:** existing SPLINE tests that build a `DxfSpline` literal or assert its shape must add `fitPoints: []`, `knots: []`, `weights: []` if they construct the object directly. Run the full shared suite (Step 4) and fix any such literals.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run`
Expected: PASS (full shared suite green; fix any direct-literal SPLINE fixtures).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/types.ts packages/shared/src/dxf/parser.ts packages/shared/src/dxf/__tests__/parser.spec.ts
git commit -m "feat(dxf): SPLINE fit-point/knot/weight fidelity — Phase 4a task 3"
```

---

### Task 4: `toSketch` — core mapping + unit scaling

**Files:**
- Create: `packages/shared/src/dxf/toSketch.ts`
- Create: `packages/shared/src/dxf/__tests__/toSketch.spec.ts`
- Modify: `packages/shared/src/dxf/index.ts` (re-export)

**Interfaces:**
- Consumes: `ParsedDxf` (Task 1–3), `SketchPrimitive` from `@zilventor/shared` (`{ id, kind, ... }` union — see Global Constraints for the arc/ellipse/spline shapes).
- Produces:
  ```ts
  export type DxfDropped = { kind: string; count: number; reason: string };
  export type ToSketchResult = { primitives: SketchPrimitive[]; annotations: never[]; dropped: DxfDropped[] };
  export function toSketch(parsed: ParsedDxf): ToSketchResult;
  ```
  In 4a `annotations` is always `[]`. Fresh ids via `dxf-${crypto.randomUUID().slice(0, 8)}`. Unit factor from `$INSUNITS`: `{1:25.4, 2:304.8, 4:1, 5:10, 6:1000}`, else `1`. Scaling applies to coordinates and radii (`cx,cy,x1,y1,r,rx,ry,majorX,majorY,...`), **never to angles**. This task handles **identity-extrusion** entities only; OCS mirror is Task 5, bulge/polyline is Task 6 (LWPOLYLINE/POLYLINE go to `dropped` until Task 6).

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/dxf/__tests__/toSketch.spec.ts
import { describe, it, expect } from 'vitest';
import { parseDxf } from '../parser';
import { toSketch } from '../toSketch';

function ents(body: string, header = ''): string {
  return [header, '  0', 'SECTION', '  2', 'ENTITIES', body.trim(), '  0', 'ENDSEC', '  0', 'EOF'].join('\n');
}

describe('toSketch core mapping', () => {
  it('maps LINE → line with fresh id', () => {
    const r = toSketch(parseDxf(ents(['  0','LINE','  8','0',' 10','1',' 20','2',' 11','3',' 21','4'].join('\n'))));
    expect(r.primitives).toHaveLength(1);
    const p = r.primitives[0]!;
    expect(p.kind).toBe('line');
    if (p.kind === 'line') expect([p.x1, p.y1, p.x2, p.y2]).toEqual([1, 2, 3, 4]);
    expect(p.id).toMatch(/^dxf-/);
  });

  it('maps CIRCLE → circle', () => {
    const r = toSketch(parseDxf(ents(['  0','CIRCLE','  8','0',' 10','5',' 20','6',' 40','3'].join('\n'))));
    const p = r.primitives[0]!;
    if (p.kind === 'circle') expect([p.cx, p.cy, p.r]).toEqual([5, 6, 3]);
    else throw new Error('expected circle');
  });

  it('maps ARC degrees → radians', () => {
    // DXF arc 0°→90°
    const r = toSketch(parseDxf(ents(['  0','ARC','  8','0',' 10','0',' 20','0',' 40','2',' 50','0',' 51','90'].join('\n'))));
    const p = r.primitives[0]!;
    if (p.kind === 'arc') { expect(p.startAngle).toBeCloseTo(0, 9); expect(p.endAngle).toBeCloseTo(Math.PI / 2, 9); }
    else throw new Error('expected arc');
  });

  it('maps a full ELLIPSE → ellipse, omitting start/end angles', () => {
    // center (0,0), major endpoint (4,0) ⇒ rx=4, rotation=0; ratio 0.5 ⇒ ry=2; full 0→2π
    const r = toSketch(parseDxf(ents(['  0','ELLIPSE','  8','0',' 10','0',' 20','0',' 11','4',' 21','0',' 40','0.5',' 41','0',' 42','6.283185307179586'].join('\n'))));
    const p = r.primitives[0]!;
    if (p.kind === 'ellipse') {
      expect(p.rx).toBeCloseTo(4, 9); expect(p.ry).toBeCloseTo(2, 9); expect(p.rotation).toBeCloseTo(0, 9);
      expect('startAngle' in p ? p.startAngle : undefined).toBeUndefined();
    } else throw new Error('expected ellipse');
  });

  it('maps SPLINE control points → spline, degree clamped to poles-1', () => {
    const r = toSketch(parseDxf(ents(['  0','SPLINE','  8','0',' 71','3',' 10','0',' 20','0',' 10','5',' 20','5'].join('\n'))));
    const p = r.primitives[0]!;
    if (p.kind === 'spline') { expect(p.controlPoints).toHaveLength(2); expect(p.degree).toBe(1); } // 2 poles ⇒ clamp 3→1
    else throw new Error('expected spline');
  });

  it('falls back to SPLINE fit points when control points absent', () => {
    const r = toSketch(parseDxf(ents(['  0','SPLINE','  8','0',' 71','3',' 11','0',' 21','0',' 11','5',' 21','5',' 11','10',' 21','0'].join('\n'))));
    const p = r.primitives[0]!;
    if (p.kind === 'spline') expect(p.controlPoints).toHaveLength(3);
    else throw new Error('expected spline');
  });

  it('scales inch DXF ($INSUNITS=1) to mm', () => {
    const header = ['  0','SECTION','  2','HEADER','  9','$INSUNITS',' 70','1','  0','ENDSEC'].join('\n');
    const r = toSketch(parseDxf(ents(['  0','CIRCLE','  8','0',' 10','1',' 20','0',' 40','1'].join('\n'), header)));
    const p = r.primitives[0]!;
    if (p.kind === 'circle') { expect(p.cx).toBeCloseTo(25.4, 6); expect(p.r).toBeCloseTo(25.4, 6); }
    else throw new Error('expected circle');
  });

  it('tallies unsupported entities into dropped (LWPOLYLINE handled in task 6)', () => {
    const r = toSketch(parseDxf(ents(['  0','LWPOLYLINE','  8','0',' 90','2',' 10','0',' 20','0',' 10','5',' 20','5'].join('\n'))));
    expect(r.primitives).toHaveLength(0);
    expect(r.dropped.find((d) => d.kind === 'LWPOLYLINE')?.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run dxf/__tests__/toSketch.spec.ts`
Expected: FAIL — `Cannot find module '../toSketch'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/dxf/toSketch.ts
import type { ParsedDxf, DxfEntity } from './types';
import type { SketchPrimitive } from '../types';

export type DxfDropped = { kind: string; count: number; reason: string };
export type ToSketchResult = { primitives: SketchPrimitive[]; annotations: never[]; dropped: DxfDropped[] };

function freshId(): string { return `dxf-${crypto.randomUUID().slice(0, 8)}`; }

const INSUNITS_FACTOR: Record<string, number> = { '1': 25.4, '2': 304.8, '4': 1, '5': 10, '6': 1000 };
function unitFactor(header: Record<string, string>): number {
  return INSUNITS_FACTOR[header['$INSUNITS'] ?? ''] ?? 1;
}

const TAU = 2 * Math.PI;
function isFullEllipse(start: number, end: number): boolean {
  return Math.abs(start) < 1e-9 && Math.abs(end - TAU) < 1e-9;
}

export function toSketch(parsed: ParsedDxf): ToSketchResult {
  const s = unitFactor(parsed.header);
  const primitives: SketchPrimitive[] = [];
  const droppedMap = new Map<string, DxfDropped>();
  const drop = (kind: string, reason: string): void => {
    const cur = droppedMap.get(kind);
    if (cur) cur.count += 1;
    else droppedMap.set(kind, { kind, count: 1, reason });
  };

  for (const e of parsed.entities) {
    const prim = mapEntity(e, s, drop);
    if (prim) primitives.push(prim);
  }
  return { primitives, annotations: [], dropped: [...droppedMap.values()] };
}

function mapEntity(e: DxfEntity, s: number, drop: (k: string, r: string) => void): SketchPrimitive | null {
  switch (e.type) {
    case 'LINE':
      return { id: freshId(), kind: 'line', x1: e.x1 * s, y1: e.y1 * s, x2: e.x2 * s, y2: e.y2 * s };
    case 'CIRCLE':
      return { id: freshId(), kind: 'circle', cx: e.cx * s, cy: e.cy * s, r: e.r * s };
    case 'ARC':
      return { id: freshId(), kind: 'arc', cx: e.cx * s, cy: e.cy * s, r: e.r * s,
        startAngle: (e.startAngle * Math.PI) / 180, endAngle: (e.endAngle * Math.PI) / 180 };
    case 'ELLIPSE': {
      const rx = Math.hypot(e.majorX, e.majorY) * s;
      const ry = rx * e.ratio;
      const rotation = Math.atan2(e.majorY, e.majorX);
      const full = isFullEllipse(e.startParam, e.endParam);
      return { id: freshId(), kind: 'ellipse', cx: e.cx * s, cy: e.cy * s, rx, ry, rotation,
        ...(full ? {} : { startAngle: e.startParam, endAngle: e.endParam }) };
    }
    case 'SPLINE': {
      const poles = e.controlPoints.length ? e.controlPoints : e.fitPoints;
      if (poles.length < 2) { drop('SPLINE', 'fewer than 2 defining points'); return null; }
      const degree = Math.min(e.degree, poles.length - 1);
      return { id: freshId(), kind: 'spline',
        controlPoints: poles.map((p) => ({ x: p.x * s, y: p.y * s })), degree, closed: e.closed };
    }
    case 'LWPOLYLINE': drop('LWPOLYLINE', 'polyline mapping lands in task 6'); return null;
    case 'POLYLINE': drop('POLYLINE', 'polyline mapping lands in task 6'); return null;
    case 'TEXT': drop('TEXT', 'text annotation model is Phase 4b'); return null;
    case 'MTEXT': drop('MTEXT', 'text annotation model is Phase 4b'); return null;
    case 'INSERT': drop('INSERT', 'block flatten is Phase 4b'); return null;
    default: drop((e as { type: string }).type, 'unsupported in Phase 4a'); return null;
  }
}
```

Re-export from the barrel:

```ts
// packages/shared/src/dxf/index.ts — add
export { toSketch } from './toSketch';
export type { ToSketchResult, DxfDropped } from './toSketch';
```

> Confirm the `SketchPrimitive` import path (`../types`) resolves — Task-context anchor: the union lives at `packages/shared/src/types.ts:30`. If the barrel `@zilventor/shared` is self-importable from inside the package, prefer the relative path `../types` to avoid a circular package import.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run dxf/__tests__/toSketch.spec.ts && cd packages/shared && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/__tests__/toSketch.spec.ts packages/shared/src/dxf/index.ts
git commit -m "feat(dxf): toSketch core mapping + unit scaling — Phase 4a task 4"
```

---

### Task 5: `toSketch` — OCS→WCS transform (extrusion mirror)

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts`
- Test: `packages/shared/src/dxf/__tests__/toSketch.spec.ts`

**Interfaces:**
- Consumes: `extrusion?` on CIRCLE/ARC/ELLIPSE (Task 2). Applies the DXF Arbitrary Axis Algorithm. For the dominant flat cases: extrusion `(0,0,1)` ⇒ identity; `(0,0,-1)` ⇒ x-mirror (`x→−x`, y unchanged) with arc sweep reversed. Circle radius unchanged. For a reflected projection (2D basis determinant < 0) arc `startAngle`/`endAngle` are recomputed from transformed endpoints and swapped.

- [ ] **Step 1: Write the failing test**

```ts
// append to toSketch.spec.ts
describe('toSketch OCS→WCS', () => {
  it('mirrors a CIRCLE center across extrusion (0,0,-1)', () => {
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','CIRCLE','  8','0',' 10','5',' 20','7',' 40','3','210','0','220','0','230','-1',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const p = toSketch(parseDxf(dxf)).primitives[0]!;
    if (p.kind === 'circle') { expect(p.cx).toBeCloseTo(-5, 9); expect(p.cy).toBeCloseTo(7, 9); expect(p.r).toBeCloseTo(3, 9); }
    else throw new Error('expected circle');
  });

  it('reflects an ARC: endpoints map correctly and sweep reverses', () => {
    // DXF arc center (0,0) r=2, 0°→90°. Under (0,0,-1): start point (2,0)→(-2,0) [angle π],
    // end point (0,2)→(0,2) [angle π/2]. CCW from π/2 to π traces the correct (upper-left) span.
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','ARC','  8','0',' 10','0',' 20','0',' 40','2',' 50','0',' 51','90','210','0','220','0','230','-1',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const p = toSketch(parseDxf(dxf)).primitives[0]!;
    if (p.kind === 'arc') {
      // sample the CCW midpoint angle; it must lie in the upper-left quadrant (x<0, y>0)
      const mid = midAngleCCW(p.startAngle, p.endAngle);
      expect(Math.cos(mid)).toBeLessThan(0);
      expect(Math.sin(mid)).toBeGreaterThan(0);
    } else throw new Error('expected arc');
  });
});

function midAngleCCW(a: number, b: number): number {
  let span = b - a; while (span < 0) span += 2 * Math.PI;
  return a + span / 2;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run dxf/__tests__/toSketch.spec.ts -t "OCS→WCS"`
Expected: FAIL — circle center is `5` not `−5` (extrusion ignored by Task 4).

- [ ] **Step 3: Write minimal implementation**

Add the OCS helpers and apply them in `mapEntity` for CIRCLE/ARC/ELLIPSE:

```ts
// toSketch.ts — add OCS helpers above mapEntity
type V3 = { x: number; y: number; z: number };
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (v: V3): V3 => { const m = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / m, y: v.y / m, z: v.z / m }; };

/** Arbitrary Axis Algorithm: OCS basis vectors for extrusion n. */
function ocsBasis(n: V3): { ax: V3; ay: V3 } {
  const wy: V3 = { x: 0, y: 1, z: 0 };
  const wz: V3 = { x: 0, y: 0, z: 1 };
  const ax = norm((Math.abs(n.x) < 1 / 64 && Math.abs(n.y) < 1 / 64) ? cross(wy, n) : cross(wz, n));
  const ay = norm(cross(n, ax));
  return { ax, ay };
}
/** Map an OCS (px,py) to WCS, dropping z (2D import). Direction-only when used for vectors. */
function ocsXY(ext: V3 | undefined, px: number, py: number): { x: number; y: number } {
  if (!ext || (ext.x === 0 && ext.y === 0 && ext.z === 1)) return { x: px, y: py };
  const { ax, ay } = ocsBasis(ext);
  return { x: px * ax.x + py * ay.x, y: px * ax.y + py * ay.y };
}
/** True when the OCS→XY projection reverses orientation (e.g. extrusion (0,0,-1)). */
function ocsReflected(ext: V3 | undefined): boolean {
  if (!ext || (ext.x === 0 && ext.y === 0 && ext.z === 1)) return false;
  const { ax, ay } = ocsBasis(ext);
  return ax.x * ay.y - ax.y * ay.x < 0;
}
```

Update the CIRCLE/ARC/ELLIPSE branches in `mapEntity` to route through `ocsXY` (scale stays applied to the WCS result):

```ts
case 'CIRCLE': {
  const c = ocsXY(e.extrusion, e.cx, e.cy);
  return { id: freshId(), kind: 'circle', cx: c.x * s, cy: c.y * s, r: e.r * s };
}
case 'ARC': {
  const a0 = (e.startAngle * Math.PI) / 180, a1 = (e.endAngle * Math.PI) / 180;
  const c = ocsXY(e.extrusion, e.cx, e.cy);
  // transform the two endpoints, recompute angles in WCS, swap if reflected
  const sp = ocsXY(e.extrusion, e.cx + e.r * Math.cos(a0), e.cy + e.r * Math.sin(a0));
  const ep = ocsXY(e.extrusion, e.cx + e.r * Math.cos(a1), e.cy + e.r * Math.sin(a1));
  const sa = Math.atan2(sp.y - c.y, sp.x - c.x);
  const ea = Math.atan2(ep.y - c.y, ep.x - c.x);
  const [startAngle, endAngle] = ocsReflected(e.extrusion) ? [ea, sa] : [sa, ea];
  return { id: freshId(), kind: 'arc', cx: c.x * s, cy: c.y * s, r: e.r * s, startAngle, endAngle };
}
case 'ELLIPSE': {
  const c = ocsXY(e.extrusion, e.cx, e.cy);
  const maj = ocsXY(e.extrusion, e.majorX, e.majorY); // direction (linear part only — no translation since center maps separately)
  const rx = Math.hypot(maj.x, maj.y) * s;
  const ry = rx * e.ratio;
  const rotation = Math.atan2(maj.y, maj.x);
  const full = isFullEllipse(e.startParam, e.endParam);
  return { id: freshId(), kind: 'ellipse', cx: c.x * s, cy: c.y * s, rx, ry, rotation,
    ...(full ? {} : { startAngle: e.startParam, endAngle: e.endParam }) };
}
```

> **Known 4a limitation (document, don't fix):** a **trimmed** ellipse under a reflected OCS keeps its raw params (start/end not reflected). Full ellipses (the overwhelmingly common case) and all circles/arcs are correct. Note this in the commit body; it is revisited in 4c hardening.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run dxf/__tests__/toSketch.spec.ts`
Expected: PASS (Task 4 identity tests still green — `ocsXY(undefined,...)` is identity).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/__tests__/toSketch.spec.ts
git commit -m "feat(dxf): toSketch OCS→WCS extrusion transform (mirror + sweep reverse) — Phase 4a task 5"
```

---

### Task 6: `toSketch` — bulge→arc + LWPOLYLINE/POLYLINE (incl. closed-wrap)

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts`
- Test: `packages/shared/src/dxf/__tests__/toSketch.spec.ts`

**Interfaces:**
- Consumes: `LWPOLYLINE`/`POLYLINE` vertices `{ x, y, bulge }` + `closed`. Each segment `vᵢ→vᵢ₊₁`: `bulge === 0` ⇒ `line`; else ⇒ `arc` (center on the side opposite the bulge, radius `c/(2·sin(Δθ/2))`, `Δθ = 4·atan(b)`). Closed polylines emit a wrap segment `vₙ→v₀` honoring `vₙ`'s bulge. All coordinates unit-scaled. OCS extrusion on polylines applied per-vertex via `ocsXY` (Task 5).

- [ ] **Step 1: Write the failing test**

```ts
// append to toSketch.spec.ts
describe('toSketch polyline + bulge', () => {
  it('maps a straight LWPOLYLINE (3 verts open) to 2 line segments', () => {
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','LWPOLYLINE','  8','0',' 90','3',' 70','0',
      ' 10','0',' 20','0',' 10','10',' 20','0',' 10','10',' 20','5',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const r = toSketch(parseDxf(dxf));
    expect(r.primitives.filter((p) => p.kind === 'line')).toHaveLength(2);
  });

  it('maps a closed square LWPOLYLINE to 4 line segments (wrap included)', () => {
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','LWPOLYLINE','  8','0',' 90','4',' 70','1',
      ' 10','0',' 20','0',' 10','10',' 20','0',' 10','10',' 20','10',' 10','0',' 20','10',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const r = toSketch(parseDxf(dxf));
    expect(r.primitives).toHaveLength(4);
    expect(r.primitives.every((p) => p.kind === 'line')).toBe(true);
  });

  it('maps a bulged segment to an arc on the correct side', () => {
    // segment (0,0)→(10,0) with bulge 0.41421356 (Δθ=90°). Arc must bulge UP (+y, left of travel).
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','LWPOLYLINE','  8','0',' 90','2',' 70','0',
      ' 10','0',' 20','0',' 42','0.41421356237',' 10','10',' 20','0',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const r = toSketch(parseDxf(dxf));
    const arc = r.primitives.find((p) => p.kind === 'arc');
    expect(arc).toBeDefined();
    if (arc && arc.kind === 'arc') {
      // center sits below the chord (bulge-opposite side)
      expect(arc.cy).toBeLessThan(0);
      // the CCW-mid point of the arc lies above the chord (y>0)
      let span = arc.endAngle - arc.startAngle; while (span < 0) span += 2 * Math.PI;
      const mid = arc.startAngle + span / 2;
      expect(arc.cy + arc.r * Math.sin(mid)).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run dxf/__tests__/toSketch.spec.ts -t "polyline + bulge"`
Expected: FAIL — LWPOLYLINE currently goes to `dropped` (Task 4), so `primitives` is empty.

- [ ] **Step 3: Write minimal implementation**

Add a polyline expander and route LWPOLYLINE/POLYLINE through it. Replace the two `drop('LWPOLYLINE'...)`/`drop('POLYLINE'...)` lines in `mapEntity` — but note `mapEntity` returns a single primitive, while a polyline yields many. Restructure `toSketch`'s loop to push an **array** for polylines:

```ts
// toSketch.ts — in toSketch(), replace the per-entity push with:
for (const e of parsed.entities) {
  if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
    primitives.push(...expandPolyline(e, s));
    continue;
  }
  const prim = mapEntity(e, s, drop);
  if (prim) primitives.push(prim);
}
```

```ts
// toSketch.ts — add expandPolyline + segment helper
function expandPolyline(
  e: { vertices: Array<{ x: number; y: number; bulge: number }>; closed: boolean; extrusion?: V3 },
  s: number,
): SketchPrimitive[] {
  const out: SketchPrimitive[] = [];
  const v = e.vertices;
  const n = v.length;
  if (n < 2) return out;
  const last = e.closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = v[i]!;
    const b = v[(i + 1) % n]!;
    const pa = ocsXY(e.extrusion, a.x, a.y);
    const pb = ocsXY(e.extrusion, b.x, b.y);
    out.push(segment(pa.x * s, pa.y * s, pb.x * s, pb.y * s, a.bulge));
  }
  return out;
}

function segment(x1: number, y1: number, x2: number, y2: number, bulge: number): SketchPrimitive {
  if (bulge === 0) return { id: freshId(), kind: 'line', x1, y1, x2, y2 };
  const theta = 4 * Math.atan(bulge);                 // signed included angle
  const dx = x2 - x1, dy = y2 - y1;
  const c = Math.hypot(dx, dy);
  const r = Math.abs(c / (2 * Math.sin(theta / 2)));  // radius
  const ux = dx / c, uy = dy / c;                     // chord unit
  const nx = -uy, ny = ux;                            // left normal (+90°)
  const apothem = Math.cos(theta / 2) * r;            // midpoint→center distance (magnitude)
  const sign = bulge >= 0 ? -1 : 1;                   // center opposite the bulge side
  const cx = (x1 + x2) / 2 + sign * apothem * nx;
  const cy = (y1 + y2) / 2 + sign * apothem * ny;
  const a1 = Math.atan2(y1 - cy, x1 - cx);
  const a2 = Math.atan2(y2 - cy, x2 - cx);
  // sketch arc is CCW start→end; for bulge>0 the swept span is a2→a1, else a1→a2
  const [startAngle, endAngle] = bulge > 0 ? [a2, a1] : [a1, a2];
  return { id: freshId(), kind: 'arc', cx, cy, r, startAngle, endAngle };
}
```

Remove the now-dead LWPOLYLINE/POLYLINE `drop(...)` cases from `mapEntity` (they are handled before `mapEntity` is called).

> **Bulge sign is the one thing to verify carefully** — the geometric-oracle test (center below chord, CCW-mid above chord) is the gate. If it's red, the `sign`/swap pair is inverted; flip both together (a true semicircle `bulge=1` is sign-degenerate, so the test uses a 90° quarter-arc which is unambiguous).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run && cd packages/shared && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (full shared suite), tsc 0. The Task-4 "LWPOLYLINE → dropped" test was replaced by the new polyline tests; ensure it's removed/updated.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/__tests__/toSketch.spec.ts
git commit -m "feat(dxf): toSketch bulge→arc + LWPOLYLINE/POLYLINE closed-wrap — Phase 4a task 6"
```

---

### Task 7: `buildSketchPartDocument` + `ImportDxfIntoNewPartCommand`

**Files:**
- Create: `packages/app/src/import/buildSketchPartDocument.ts`
- Create: `packages/app/src/commands/ImportDxfIntoNewPartCommand.ts`
- Test: `packages/app/src/commands/__tests__/ImportDxfIntoNewPartCommand.spec.ts` (and a small `buildSketchPartDocument` test in the same file or a sibling)

**Interfaces:**
- Consumes: `toSketch` + `parseDxf` from `@zilventor/shared`; `ORIGIN_FEATURES` from `../import/originFeatures`; `Command` type `{ name; apply(); revert() }` from `../commands/Command`; `KernelApi.registerPart(part): Promise<void>`.
- Produces:
  ```ts
  export function buildSketchPartDocument(name: string, primitives: SketchPrimitive[]): PartDocument;
  export class ImportDxfIntoNewPartCommand implements Command { /* apply/revert */ }
  ```
  `ImportDxfIntoNewPartCommand` ctx: `{ kernel: KernelApi; store: { getActivePart(): PartDocument | null; setActivePart(p: PartDocument): void }; setStatus?: (msg: string) => void; file: File }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/ImportDxfIntoNewPartCommand.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { buildSketchPartDocument } from '../../import/buildSketchPartDocument';
import { ImportDxfIntoNewPartCommand } from '../ImportDxfIntoNewPartCommand';

const SQUARE_DXF = ['  0','SECTION','  2','ENTITIES',
  '  0','LINE','  8','0',' 10','0',' 20','0',' 11','10',' 21','0',
  '  0','CIRCLE','  8','0',' 10','5',' 20','5',' 40','2',
  '  0','ENDSEC','  0','EOF'].join('\n');

function fakeFile(text: string, name = 'part.dxf'): File {
  return { name, text: async () => text } as unknown as File;
}

describe('buildSketchPartDocument', () => {
  it('wraps primitives in a sketch feature on origin.XY with 7 origin features', () => {
    const doc = buildSketchPartDocument('foo', [{ id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }]);
    expect(doc.name).toBe('foo');
    expect(doc.units).toBe('mm');
    const sketch = doc.featureTree.find((f) => f.kind === 'sketch');
    expect(sketch).toBeDefined();
    if (sketch && sketch.kind === 'sketch') {
      expect(sketch.plane).toEqual({ source: 'workPlane', featureId: 'origin.XY' });
      expect(sketch.primitives).toHaveLength(1);
      expect(sketch.constraints).toEqual([]);
    }
    expect(doc.featureTree.filter((f) => f.kind === 'workAxis' || f.kind === 'workPlane' || f.kind === 'workPoint')).toHaveLength(7);
  });
});

describe('ImportDxfIntoNewPartCommand', () => {
  it('registers a new part with the imported primitives and sets it active', async () => {
    const registered: unknown[] = [];
    let active: unknown = null;
    const cmd = new ImportDxfIntoNewPartCommand({
      kernel: { registerPart: async (p: unknown) => { registered.push(p); } } as never,
      store: { getActivePart: () => active as never, setActivePart: (p: unknown) => { active = p; } },
      file: fakeFile(SQUARE_DXF),
    });
    await cmd.apply();
    expect(registered).toHaveLength(1);
    const doc = active as { featureTree: Array<{ kind: string; primitives?: unknown[] }> };
    const sketch = doc.featureTree.find((f) => f.kind === 'sketch')!;
    expect(sketch.primitives).toHaveLength(2); // line + circle
  });

  it('revert restores the prior active part', async () => {
    const prior = { id: 'prev' };
    let active: unknown = prior;
    const cmd = new ImportDxfIntoNewPartCommand({
      kernel: { registerPart: async () => {} } as never,
      store: { getActivePart: () => active as never, setActivePart: (p: unknown) => { active = p; } },
      file: fakeFile(SQUARE_DXF),
    });
    await cmd.apply();
    expect(active).not.toBe(prior);
    await cmd.revert();
    expect(active).toBe(prior);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npx vitest run commands/__tests__/ImportDxfIntoNewPartCommand.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/app/src/import/buildSketchPartDocument.ts
import type { PartDocument, SketchPrimitive, Feature } from '@zilventor/shared';
import { ORIGIN_FEATURES } from './originFeatures';

/** Pure: wraps imported sketch primitives in a single sketch feature on the XY origin plane. */
export function buildSketchPartDocument(name: string, primitives: SketchPrimitive[]): PartDocument {
  const sketch: Feature = {
    kind: 'sketch',
    id: crypto.randomUUID(),
    plane: { source: 'workPlane', featureId: 'origin.XY' },
    primitives,
    constraints: [],
  };
  return {
    id: crypto.randomUUID(),
    name,
    units: 'mm',
    parameters: {},
    featureTree: [...ORIGIN_FEATURES, sketch],
    properties: {},
    materials: [],
    hardware: [],
  };
}
```

```ts
// packages/app/src/commands/ImportDxfIntoNewPartCommand.ts
import { parseDxf, toSketch } from '@zilventor/shared';
import type { PartDocument } from '@zilventor/shared';
import type { KernelApi } from '@zilventor/kernel'; // confirm export path of the kernel client type
import type { Command } from './Command';
import { buildSketchPartDocument } from '../import/buildSketchPartDocument';

type Ctx = {
  kernel: Pick<KernelApi, 'registerPart'>;
  store: { getActivePart: () => PartDocument | null; setActivePart: (p: PartDocument) => void };
  setStatus?: (msg: string) => void;
  file: File;
};

function fileStem(name: string): string { return name.replace(/\.[^./\\]+$/, '') || name; }

export class ImportDxfIntoNewPartCommand implements Command {
  readonly name = 'ImportDxfIntoNewPart';
  private prior: PartDocument | null = null;

  constructor(private ctx: Ctx) {}

  async apply(): Promise<void> {
    this.prior = this.ctx.store.getActivePart();
    const text = await this.ctx.file.text();
    const { primitives, dropped } = toSketch(parseDxf(text));
    const part = buildSketchPartDocument(fileStem(this.ctx.file.name), primitives);
    await this.ctx.kernel.registerPart(part);
    this.ctx.store.setActivePart(part);
    const skipped = dropped.reduce((a, d) => a + d.count, 0);
    this.ctx.setStatus?.(`Imported ${primitives.length} primitives, skipped ${skipped} entities`);
  }

  async revert(): Promise<void> {
    if (this.prior) this.ctx.store.setActivePart(this.prior);
  }
}
```

> **Plan-time confirm (do at impl):** the kernel client type name/import — anchor says `KernelApi` at `packages/kernel/src/api.ts` with `registerPart(part): Promise<void>`. If the app references the client as `KernelClient`, use that type. `revert()` intentionally leaves the part registered in the kernel (matches STEP-import behavior — no `unregisterPart` exists); only active-part selection is reverted.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && npx vitest run commands/__tests__/ImportDxfIntoNewPartCommand.spec.ts && cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/import/buildSketchPartDocument.ts packages/app/src/commands/ImportDxfIntoNewPartCommand.ts packages/app/src/commands/__tests__/ImportDxfIntoNewPartCommand.spec.ts
git commit -m "feat(dxf): buildSketchPartDocument + ImportDxfIntoNewPartCommand — Phase 4a task 7"
```

---

### Task 8: `ImportDxfIntoActiveSketchCommand` (dual-path batch)

**Files:**
- Create: `packages/app/src/commands/ImportDxfIntoActiveSketchCommand.ts`
- Test: `packages/app/src/commands/__tests__/ImportDxfIntoActiveSketchCommand.spec.ts`

**Interfaces:**
- Consumes: `parseDxf`/`toSketch`; `Command`; the dual-path methods used by `AddPrimitiveCommand`: `kernel.addPrimitive(partId, sketchId, primitive)`, `kernel.removePrimitive(partId, sketchId, primitiveId)`, `sketcherClient.addPrimitive(primitive)`, `sketcherClient.removePrimitive(primitiveId)`.
- Produces:
  ```ts
  export class ImportDxfIntoActiveSketchCommand implements Command;
  ```
  ctx: `{ kernel; sketcherClient?; store: { getActivePart(): PartDocument | null }; sketchId: string; setStatus?; file: File }`. All-or-nothing: if any add throws, revert the ids already added (both paths) and rethrow.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/ImportDxfIntoActiveSketchCommand.spec.ts
import { describe, it, expect } from 'vitest';
import { ImportDxfIntoActiveSketchCommand } from '../ImportDxfIntoActiveSketchCommand';

const DXF = ['  0','SECTION','  2','ENTITIES',
  '  0','LINE','  8','0',' 10','0',' 20','0',' 11','1',' 21','1',
  '  0','LINE','  8','0',' 10','1',' 20','1',' 11','2',' 21','2',
  '  0','ENDSEC','  0','EOF'].join('\n');

function fakeFile(text: string): File { return { name: 'x.dxf', text: async () => text } as unknown as File; }

function harness() {
  const kernelAdds: string[] = []; const kernelRemoves: string[] = [];
  const sketcherAdds: string[] = []; const sketcherRemoves: string[] = [];
  const kernel = {
    addPrimitive: async (_p: string, _s: string, prim: { id: string }) => { kernelAdds.push(prim.id); },
    removePrimitive: async (_p: string, _s: string, id: string) => { kernelRemoves.push(id); },
  };
  const sketcherClient = {
    addPrimitive: async (prim: { id: string }) => { sketcherAdds.push(prim.id); },
    removePrimitive: async (id: string) => { sketcherRemoves.push(id); },
  };
  return { kernelAdds, kernelRemoves, sketcherAdds, sketcherRemoves, kernel, sketcherClient };
}

describe('ImportDxfIntoActiveSketchCommand', () => {
  it('adds every primitive to BOTH kernel and sketcher; revert removes from both', async () => {
    const h = harness();
    const cmd = new ImportDxfIntoActiveSketchCommand({
      kernel: h.kernel as never, sketcherClient: h.sketcherClient as never,
      store: { getActivePart: () => ({ id: 'part1' } as never) },
      sketchId: 'sk1', file: fakeFile(DXF),
    });
    await cmd.apply();
    expect(h.kernelAdds).toHaveLength(2);
    expect(h.sketcherAdds).toEqual(h.kernelAdds);
    await cmd.revert();
    expect(h.kernelRemoves.sort()).toEqual([...h.kernelAdds].sort());
    expect(h.sketcherRemoves.sort()).toEqual([...h.sketcherAdds].sort());
  });

  it('rolls back partial adds if a later add throws', async () => {
    const h = harness();
    let calls = 0;
    h.kernel.addPrimitive = async (_p, _s, prim: { id: string }) => {
      calls += 1; if (calls === 2) throw new Error('boom'); h.kernelAdds.push(prim.id);
    };
    const cmd = new ImportDxfIntoActiveSketchCommand({
      kernel: h.kernel as never, sketcherClient: h.sketcherClient as never,
      store: { getActivePart: () => ({ id: 'part1' } as never) },
      sketchId: 'sk1', file: fakeFile(DXF),
    });
    await expect(cmd.apply()).rejects.toThrow('boom');
    // the one primitive that was added must have been removed from both paths
    expect(h.kernelRemoves).toEqual(h.kernelAdds);
    expect(h.sketcherRemoves.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npx vitest run commands/__tests__/ImportDxfIntoActiveSketchCommand.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/app/src/commands/ImportDxfIntoActiveSketchCommand.ts
import { parseDxf, toSketch } from '@zilventor/shared';
import type { PartDocument, SketchPrimitive } from '@zilventor/shared';
import type { KernelApi } from '@zilventor/kernel';
import type { Command } from './Command';

type SketcherClient = { addPrimitive: (p: SketchPrimitive) => Promise<void>; removePrimitive: (id: string) => Promise<void> };

type Ctx = {
  kernel: Pick<KernelApi, 'addPrimitive' | 'removePrimitive'>;
  sketcherClient?: SketcherClient;
  store: { getActivePart: () => PartDocument | null };
  sketchId: string;
  setStatus?: (msg: string) => void;
  file: File;
};

export class ImportDxfIntoActiveSketchCommand implements Command {
  readonly name = 'ImportDxfIntoActiveSketch';
  private partId = '';
  private added: SketchPrimitive[] = [];

  constructor(private ctx: Ctx) {}

  async apply(): Promise<void> {
    const part = this.ctx.store.getActivePart();
    if (!part) throw new Error('no active part');
    this.partId = part.id;
    const text = await this.ctx.file.text();
    const { primitives, dropped } = toSketch(parseDxf(text));
    this.added = [];
    try {
      for (const p of primitives) {
        await this.ctx.kernel.addPrimitive(this.partId, this.ctx.sketchId, p);
        if (this.ctx.sketcherClient) await this.ctx.sketcherClient.addPrimitive(p);
        this.added.push(p);
      }
    } catch (err) {
      await this.revert();
      throw err;
    }
    const skipped = dropped.reduce((a, d) => a + d.count, 0);
    this.ctx.setStatus?.(`Imported ${primitives.length} primitives, skipped ${skipped} entities`);
  }

  async revert(): Promise<void> {
    for (const p of [...this.added].reverse()) {
      await this.ctx.kernel.removePrimitive(this.partId, this.ctx.sketchId, p.id);
      if (this.ctx.sketcherClient) await this.ctx.sketcherClient.removePrimitive(p.id);
    }
    this.added = [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && npx vitest run commands/__tests__/ImportDxfIntoActiveSketchCommand.spec.ts && cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/ImportDxfIntoActiveSketchCommand.ts packages/app/src/commands/__tests__/ImportDxfIntoActiveSketchCommand.spec.ts
git commit -m "feat(dxf): ImportDxfIntoActiveSketchCommand dual-path batch — Phase 4a task 8"
```

---

### Task 9: Entry points (FileTab + sketch ribbon), i18n, §6 e2e

**Files:**
- Modify: `packages/app/src/shell/FileTab.tsx` (new-part entry + `DXF_MAX_BYTES`)
- Modify: `packages/app/src/sketcher/SketchTab.tsx` + `packages/app/src/App.tsx` (active-sketch entry, dispatched from App.tsx)
- Modify: `packages/app/src/i18n/locales/en.json`, `packages/app/src/i18n/locales/uk.json`
- Create: `tests/e2e/drawing/dxf-import.spec.ts`, `tests/e2e/fixtures/dxf-import-sample.dxf`

**Interfaces:**
- Consumes: `pickFile([{ description, accept }])` from `../shell/fsaFallback` (returns `File | null`); `store.bus.execute(command)`; `sketcherClientRef.current` (App.tsx); both new commands.
- Produces: two clickable entry points; i18n keys `menu.file.importDxf`, `ribbon.sketch.importDxf`, `status.dxfImport.done` (`{{imported}}`,`{{skipped}}`).

- [ ] **Step 1: Write the failing e2e test + fixture**

```
// tests/e2e/fixtures/dxf-import-sample.dxf  (inch units; a line, a circle, a mirrored arc)
  0
SECTION
  2
HEADER
  9
$INSUNITS
 70
1
  0
ENDSEC
  0
SECTION
  2
ENTITIES
  0
LINE
  8
0
 10
0
 20
0
 11
10
 21
0
  0
CIRCLE
  8
0
 10
5
 20
5
 40
2
  0
ENDSEC
  0
EOF
```

```ts
// tests/e2e/drawing/dxf-import.spec.ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../fixtures/dxf-import-sample.dxf', import.meta.url));

test('DXF import into a new part creates a sketch with the imported primitives', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __zilventorStore?: unknown }).__zilventorStore, null, { timeout: 60_000 });

  const dxfText = readFileSync(FIXTURE, 'utf8');
  // Drive the command directly through the store bus (entry-point buttons also wired; this asserts the import path).
  const count = await page.evaluate(async (text) => {
    const w = window as unknown as {
      __zilventorStore: { getState: () => { kernel: unknown; setActivePart: (p: unknown) => void; getActivePart?: () => unknown; bus: { execute: (c: unknown) => Promise<void> } } };
      __zilventorImportDxfNewPart: (file: File) => Promise<void>;
    };
    const file = new File([text], 'sample.dxf', { type: 'image/vnd.dxf' });
    await w.__zilventorImportDxfNewPart(file);
    const part = w.__zilventorStore.getState() as unknown as { activePart?: { featureTree: Array<{ kind: string; primitives?: unknown[] }> } };
    const sketch = part.activePart?.featureTree.find((f) => f.kind === 'sketch');
    return sketch?.primitives?.length ?? -1;
  }, dxfText);

  expect(count).toBe(2);          // line + circle
  expect(errors).toEqual([]);
});
```

> The e2e exercises a tiny dev-only window hook `__zilventorImportDxfNewPart` that constructs and dispatches `ImportDxfIntoNewPartCommand` through the real store bus — this proves the wiring/kernel path end-to-end without needing a native file-picker in headless Chrome. Wire it in App.tsx next to the existing dev hooks (DEV-gated, like `__zilventorStore`).

- [ ] **Step 2: Run e2e to verify it fails**

Run (ensure dev server per the repo's Playwright config): `npx playwright test --project=chromium tests/e2e/drawing/dxf-import.spec.ts`
Expected: FAIL — `__zilventorImportDxfNewPart` is undefined.

- [ ] **Step 3: Wire entry points, dev hook, and i18n**

**App.tsx** — add the DEV-gated hook + the active-sketch handler (so it reaches `sketcherClientRef`):

```ts
// App.tsx — near other DEV window hooks
if (import.meta.env.DEV) {
  (window as unknown as { __zilventorImportDxfNewPart?: (f: File) => Promise<void> }).__zilventorImportDxfNewPart =
    (file: File) => store.bus.execute(new ImportDxfIntoNewPartCommand({
      kernel: store.kernel,
      store: { getActivePart: () => useAppStore.getState().activePart, setActivePart: store.setActivePart },
      setStatus: store.setStatus,
      file,
    }));
}

// App.tsx — handler passed down to the sketch ribbon (mirrors the AddPrimitiveCommand call site at App.tsx:1396)
const handleImportDxfIntoSketch = async (): Promise<void> => {
  const file = await pickFile([{ description: 'DXF file', accept: { 'image/vnd.dxf': ['.dxf'] } }]);
  if (!file) return;
  await store.bus.execute(new ImportDxfIntoActiveSketchCommand({
    kernel: store.kernel,
    sketcherClient: sketcherClientRef.current ?? undefined,
    store: { getActivePart: () => useAppStore.getState().activePart },
    sketchId: store.activeSketchId,
    setStatus: store.setStatus,
    file,
  }));
};
```

Thread `handleImportDxfIntoSketch` as a prop to `SketchTab` (follow the existing pattern by which App.tsx passes handlers to the ribbon tabs) and render an "Import DXF…" button:

```tsx
// SketchTab.tsx — add a button (alongside existing ribbon buttons)
<button type="button" onClick={() => props.onImportDxf?.()}>{t('ribbon.sketch.importDxf')}</button>
```

**FileTab.tsx** — add `DXF_MAX_BYTES` + an "Import DXF…" menu item:

```ts
// FileTab.tsx — near STEP_MAX_BYTES (line 19)
export const DXF_MAX_BYTES = 50 * 1024 * 1024;
```

```tsx
// FileTab.tsx — "Import DXF…" entry (mirror the STEP import handler; confirm FileTab's access to store.bus + kernel)
const onImportDxf = async (): Promise<void> => {
  const file = await pickFile([{ description: 'DXF file', accept: { 'image/vnd.dxf': ['.dxf'] } }]);
  if (!file) return;
  if (file.size > DXF_MAX_BYTES) { setStatus(t('status.fileTooLarge')); return; }
  await bus.execute(new ImportDxfIntoNewPartCommand({
    kernel, store: { getActivePart: () => useAppStore.getState().activePart, setActivePart }, setStatus, file,
  }));
};
// ...render: <button type="button" onClick={onImportDxf}>{t('menu.file.importDxf')}</button>
```

**i18n** — add to both locale files:

```jsonc
// en.json
"menu": { "file": { "importDxf": "Import DXF…" } },
"ribbon": { "sketch": { "importDxf": "Import DXF…" } },
"status": { "dxfImport": { "done": "Imported {{imported}} primitives, skipped {{skipped}} entities" } }
```
```jsonc
// uk.json
"menu": { "file": { "importDxf": "Імпорт DXF…" } },
"ribbon": { "sketch": { "importDxf": "Імпорт DXF…" } },
"status": { "dxfImport": { "done": "Імпортовано {{imported}} примітивів, пропущено {{skipped}}" } }
```

(Merge these keys into the existing nested structure — do not duplicate the `menu`/`ribbon`/`status` roots. Keep en/uk key parity.) Optionally route the commands' `setStatus` through `i18n.t('status.dxfImport.done', { imported, skipped })` instead of the hard-coded English in Tasks 7/8 — do this here so both locales render correctly.

- [ ] **Step 4: Run e2e + full app suite to verify green**

Run:
```bash
npx playwright test --project=chromium tests/e2e/drawing/dxf-import.spec.ts
cd packages/app && npx vitest run && npx tsc --noEmit -p tsconfig.json
```
Expected: e2e PASS (`count === 2`, no console errors); app unit suite green (the only known pre-existing flake is `App.spec.tsx frameToModel` teardown — passes in isolation); tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/FileTab.tsx packages/app/src/sketcher/SketchTab.tsx packages/app/src/App.tsx packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/uk.json tests/e2e/drawing/dxf-import.spec.ts tests/e2e/fixtures/dxf-import-sample.dxf
git commit -m "feat(dxf): DXF import entry points + i18n + e2e — Phase 4a task 9"
```

---

## Final whole-feature review (LOAD-BEARING — do not skip)

After Task 9, run the full gate and a cross-task review (use `superpowers:requesting-code-review` with an Opus reviewer):

```bash
cd packages/shared && npx vitest run && npx tsc --noEmit -p tsconfig.json
cd packages/app && npx vitest run && npx tsc --noEmit -p tsconfig.json
# repo root:
pnpm lint
npx playwright test --project=chromium tests/e2e/drawing/dxf-import.spec.ts
git status   # confirm clean tree; DO NOT push, DO NOT merge to master
```

Review checklist the reviewer must confirm:
1. **No manifest bump** — `toSketch` emits only existing v31 `SketchPrimitive` kinds; no migration touched.
2. **Reaches the model, not just the doc** — the e2e asserts the **sketch feature's `primitives` array length**, not mere command success.
3. **Dual-path symmetry** — active-sketch revert removes from BOTH kernel and sketcher for every added id (Task 8 rollback test proves partial-failure cleanup).
4. **Angle units** — ARC deg→rad applied; ellipse params copied as radians; no scale applied to angles.
5. **OCS correctness** — `(0,0,-1)` mirrors circle/arc; identity fast-path unchanged; trimmed-ellipse-under-reflection limitation is documented, not silently wrong.
6. **Bulge geometry** — the geometric-oracle test (center opposite bulge, CCW-mid on bulge side) is green; closed-wrap segment present.
7. **i18n parity** — en/uk keys match; status strings interpolate.

## After 4a ships

Update `next_session_resume.md` + `project_dxf_milestone_m1.md`: 4a done; **4b NEXT** (LAYER table + INSERT flatten + `point` primitive + TEXT/MTEXT annotation model, manifest **v31→v32**). Then 4c, Phase 5 (round-trip/perf), then the M1 merge decision.

## Self-review against the spec (completed)

- **HEADER/$INSUNITS** → Task 1 + Task 4 unit scaling. ✓
- **OCS extrusion read + transform** → Task 2 (parse) + Task 5 (transform). ✓
- **SPLINE fit/knot/weight fidelity** → Task 3 (parse) + Task 4 (fit-point fallback, degree clamp). ✓
- **toSketch LINE/CIRCLE/ARC(deg→rad)/ELLIPSE/SPLINE** → Task 4. ✓
- **LWPOLYLINE/POLYLINE bulge + closed-wrap** → Task 6. ✓
- **`buildSketchPartDocument`** → Task 7. ✓
- **`ImportDxfIntoNewPartCommand`** (FileTab) → Task 7 + Task 9. ✓
- **`ImportDxfIntoActiveSketchCommand`** (sketch ribbon, App.tsx dispatch) → Task 8 + Task 9. ✓
- **`dropped` tally + status surfacing** → Tasks 4/7/8/9. ✓
- **File-size cap** → Task 9 (`DXF_MAX_BYTES`). ✓
- **§6 real-browser e2e** → Task 9. ✓
- **No manifest bump** → all tasks (final review #1). ✓
- Deferred to 4b/4c (TEXT/MTEXT, INSERT, POINT, HATCH, DIMENSION, 3DFACE, knots/weights *consumption*) → tallied in `dropped`, not silently mis-mapped. ✓
