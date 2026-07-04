# DXF Phase 4c — DIMENSION / LEADER / MLEADER Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import DXF `DIMENSION`, `SOLID`, `LEADER`, and `MLEADER` entities (currently dropped at `parser.ts default → null`) into the editable sketch model as flattened construction geometry + text annotations, reusing the existing block-flatten machinery.

**Architecture:** New parse branches in `readEntity` produce four new `DxfEntity` union members. New `toSketch` mapping branches: SOLID → closed construction-line loop (winding `0,1,3,2`); LEADER → construction polyline; DIMENSION → synthesize an identity `INSERT` of its block and reuse `expandInsert` for geometry + a dedicated block-text scan for annotations (with a text fallback when the block is absent); MLEADER → defensive `CONTEXT_DATA` parse (brace-matched by literal token string) into leader polylines + embedded text. A new shared `expandSolid` helper is called from both the main loop and `expandInsert`'s block-body loop (so dimension SOLID arrowheads render).

**Tech Stack:** TypeScript, vitest (per-package), Playwright (Chromium e2e). Dependency-free shared DXF parser.

## Global Constraints

- **Branch:** `feat/dxf-support` (off master `8112434a`). Do NOT push from subagents — commit only; the controller verifies the tree and pushes.
- **NO manifest bump.** This slice emits only existing v32 `SketchPrimitive` kinds (`line`) + the existing `TextAnnotation` model. Do not touch `manifest`/migration code.
- **No new `SketchPrimitive` kind.** All geometry maps to existing `line` (plus whatever a flattened block already contains: `line`/`arc`/`circle`).
- **Rendering: zero change.** Flattened primitives + annotations flow through the existing `CommittedSketchRenderer.update(primitives, annotations)`. Do not edit any renderer.
- **`exactOptionalPropertyTypes` is ON.** For optional fields, use conditional spread (`...(x ? { x } : {})`), never `field: maybeUndefined`.
- **Unrecognized / malformed → `drop(kind, reason)` + continue, NEVER throw.** `drop` is the existing skipped-entity tally: `(kind: string, reason: string) => void`.
- **Construction policy (this slice):** SOLID, LEADER, and MLEADER geometry are emitted with `construction: true` unconditionally (per spec §4.2/§4.3). DIMENSION geometry imports as **regular (non-construction)** geometry — matching how `expandInsert` already flattens all blocks — documented as a known limitation (user decision, 2026-06-23).
- **DIMENSION block text (user decision, 2026-06-23):** `expandInsert` is kept geometry-only; the DIMENSION mapping scans its own block body for `TEXT`/`MTEXT` and emits identity-transformed annotations. The latent general bug — `expandInsert` drops text inside ANY block (e.g. INSERTed title blocks) — is **pre-existing and out of scope**; do not fix it here.
- **Per-package commands** (run from INSIDE the package dir):
  - shared tests: `cd packages/shared && npx vitest run`
  - shared typecheck: `cd packages/shared && npx tsc --noEmit -p tsconfig.json` (expect 0 errors)
  - e2e (repo root): `npx playwright test --project=chromium tests/e2e/drawing/<file>`
- **MLEADER documented limitation:** validated against the AutoDesk/ezdxf spec, NOT a real CAD-exported file. Carry this into a code comment on the MLEADER parser AND the final handoff; flag for human re-verification once a real MLEADER DXF is available.

## File Structure

- `packages/shared/src/dxf/types.ts` — add 4 members to the `DxfEntity` union. (One responsibility: shared DXF data shapes.)
- `packages/shared/src/dxf/parser.ts` — add `SOLID`/`TRACE`, `LEADER`, `DIMENSION`, `MLEADER`/`MULTILEADER` cases to `readEntity`; add a module-private `parseMleader` helper.
- `packages/shared/src/dxf/toSketch.ts` — add `expandSolid`, `expandLeader`, `formatMeasurement` helpers; add a SOLID branch to `expandInsert`'s block-body loop; add DIMENSION/SOLID/LEADER/MLEADER branches to the `toSketch` main loop.
- `packages/shared/src/dxf/__tests__/parser.spec.ts` — parse-branch tests.
- `packages/shared/src/dxf/__tests__/toSketch.spec.ts` — mapping tests.
- `tests/e2e/drawing/dxf-dimension-leader-mleader.spec.ts` — combined-fixture Chromium e2e (Task 10).

## Verified anchors (read-only, this session)

- `parser.ts:7–28` helpers `num(pairs, code, fallback=0)`, `nums(pairs, code): number[]`, `str(pairs, code, fallback='')`, `extrusion(pairs): {x,y,z}|undefined`. Entity records: `raw.pairs: DxfPair[]`, `DxfPair = { readonly code: number; readonly value: string }` (ordered array).
- `parser.ts:77–161` `readEntity(raw: RawEntity): DxfEntity | null`, `switch (raw.type)`, `default: return null`. `RawEntity = { type: string; pairs: DxfPair[] }`.
- `toSketch.ts:317–368` `expandInsert(ins, parsed, s, depth, drop): SketchPrimitive[]`; block-body loop at 332–342 dispatches INSERT/POLYLINE specially, else `mapEntity(be, 1, drop, false)`.
- `toSketch.ts:371–401` `export function toSketch(parsed: ParsedDxf): ToSketchResult`; main loop 382–399; `drop` defined 376–380; `primitives`/`annotations` arrays 373–374.
- `toSketch.ts:444–497` `mapEntity` — `case 'TEXT'/'MTEXT': return null` (492–493); `default: drop(type, 'unsupported in Phase 4a')` (495). Uses `ocsXY(extrusion, x, y): {x,y}`, `freshId()` → `dxf-…`, `cons = construction ? { construction: true as const } : {}`.
- `toSketch.ts:8–15` `stripMText(raw): string`; `:54–58` `isConstructionLayer`.
- `types.ts:30–37` SketchPrimitive (`{ id; kind:'line'; x1;y1;x2;y2; construction? }`); `:46–53` `TextAnnotation { id; x; y; height; value; rotation }`.
- `dxf/types.ts:6–17` `DxfEntity` union; `:21–27` `ParsedDxf`; `DxfExtrusion`/`DxfLayer` exist.
- Test helpers: `parser.spec.ts` has `entitiesDxf(body)` wrapping an `ENTITIES` section; `toSketch.spec.ts` has `ents(body)` (same wrapper). vitest `describe/it/expect`; `parseDxf` from `'../parser'`, `toSketch` from `'../toSketch'`.

---

### Task 1: SOLID parse branch + type

**Files:**
- Modify: `packages/shared/src/dxf/types.ts` (DxfEntity union)
- Modify: `packages/shared/src/dxf/parser.ts:77–161` (readEntity switch)
- Test: `packages/shared/src/dxf/__tests__/parser.spec.ts`

**Interfaces:**
- Produces: `DxfEntity` member `{ type: 'SOLID'; layer: string; corners: ReadonlyArray<{ x: number; y: number }>; extrusion?: DxfExtrusion }` — `corners` already in winding order `[P0, P1, P3, P2]` (3 entries when triangle).

- [ ] **Step 1: Write the failing tests**

Add to `parser.spec.ts`:

```typescript
describe('parseDxf — SOLID', () => {
  it('parses a quad SOLID in winding order P0,P1,P3,P2', () => {
    const dxf = entitiesDxf(['  0', 'SOLID', '  8', 'ARROWS',
      ' 10', '0', ' 20', '0',
      ' 11', '1', ' 21', '0',
      ' 12', '0', ' 22', '1',
      ' 13', '1', ' 23', '1'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('SOLID');
    if (e.type === 'SOLID') {
      // stored 10,11,12,13 = (0,0),(1,0),(0,1),(1,1); winding order is 10,11,13,12
      expect(e.corners.map((c) => [c.x, c.y])).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  });

  it('collapses a triangle when corner 12 == corner 13', () => {
    const dxf = entitiesDxf(['  0', 'SOLID', '  8', '0',
      ' 10', '0', ' 20', '0',
      ' 11', '2', ' 21', '0',
      ' 12', '1', ' 22', '2',
      ' 13', '1', ' 23', '2'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('SOLID');
    if (e.type === 'SOLID') expect(e.corners.map((c) => [c.x, c.y])).toEqual([[0, 0], [2, 0], [1, 2]]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/parser.spec.ts`
Expected: FAIL — SOLID parses to `null` (entity array empty / `e` undefined).

- [ ] **Step 3: Add the type**

In `types.ts`, add to the `DxfEntity` union (after the `POINT` member):

```typescript
  | { type: 'SOLID'; layer: string; corners: ReadonlyArray<{ x: number; y: number }>; extrusion?: DxfExtrusion }
```

- [ ] **Step 4: Add the parse branch**

In `parser.ts` `readEntity` switch, before `default:`:

```typescript
    case 'SOLID':
    case 'TRACE': {
      const ex = extrusion(raw.pairs);
      const p0 = { x: num(raw.pairs, 10), y: num(raw.pairs, 20) };
      const p1 = { x: num(raw.pairs, 11), y: num(raw.pairs, 21) };
      const p2 = { x: num(raw.pairs, 12), y: num(raw.pairs, 22) };
      const p3 = { x: num(raw.pairs, 13), y: num(raw.pairs, 23) };
      // ezdxf gotcha: screen/winding order is 0,1,3,2 (last two reversed). Triangle when p2 == p3.
      const eps = 1e-9;
      const isTri = Math.abs(p2.x - p3.x) < eps && Math.abs(p2.y - p3.y) < eps;
      const corners = isTri ? [p0, p1, p3] : [p0, p1, p3, p2];
      return { type: 'SOLID', layer, corners, ...(ex ? { extrusion: ex } : {}) };
    }
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/parser.spec.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/dxf/types.ts packages/shared/src/dxf/parser.ts packages/shared/src/dxf/__tests__/parser.spec.ts
git commit -m "feat(dxf): parse SOLID/TRACE entity with 0,1,3,2 winding + triangle collapse (Phase 4c)"
```

---

### Task 2: `expandSolid` mapping + main-loop SOLID branch

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts` (add `expandSolid`; add SOLID branch to main loop)
- Test: `packages/shared/src/dxf/__tests__/toSketch.spec.ts`

**Interfaces:**
- Consumes: `DxfEntity` SOLID member (Task 1); `ocsXY`, `freshId` (existing).
- Produces: `function expandSolid(e: Extract<DxfEntity, { type: 'SOLID' }>, s: number): SketchPrimitive[]` — a closed loop of `construction: true` `line` primitives.

- [ ] **Step 1: Write the failing test**

Add to `toSketch.spec.ts`:

```typescript
describe('toSketch — SOLID', () => {
  it('maps a quad SOLID to a closed loop of 4 construction lines', () => {
    const r = toSketch(parseDxf(ents(['  0', 'SOLID', '  8', '0',
      ' 10', '0', ' 20', '0', ' 11', '1', ' 21', '0',
      ' 12', '0', ' 22', '1', ' 13', '1', ' 23', '1'].join('\n'))));
    expect(r.primitives).toHaveLength(4);
    expect(r.primitives.every((p) => p.kind === 'line' && p.construction === true)).toBe(true);
    // closed: last segment ends back at first corner (0,0)
    const last = r.primitives[3]!;
    if (last.kind === 'line') expect([last.x2, last.y2]).toEqual([0, 0]);
  });

  it('maps a triangle SOLID to 3 lines', () => {
    const r = toSketch(parseDxf(ents(['  0', 'SOLID', '  8', '0',
      ' 10', '0', ' 20', '0', ' 11', '2', ' 21', '0',
      ' 12', '1', ' 22', '2', ' 13', '1', ' 23', '2'].join('\n'))));
    expect(r.primitives).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts`
Expected: FAIL — SOLID falls through to `mapEntity` `default → drop`, `r.primitives` is empty.

- [ ] **Step 3: Add the `expandSolid` helper**

In `toSketch.ts`, after `expandPolyline` (near the other expand helpers):

```typescript
function expandSolid(e: Extract<DxfEntity, { type: 'SOLID' }>, s: number): SketchPrimitive[] {
  // corners are already in winding order (0,1,3,2) from the parser. Emit a closed
  // construction loop. Fill is intentionally dropped (boundary only, consistent with HATCH).
  const pts = e.corners.map((c) => ocsXY(e.extrusion, c.x, c.y));
  const out: SketchPrimitive[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    out.push({ id: freshId(), kind: 'line', x1: a.x * s, y1: a.y * s, x2: b.x * s, y2: b.y * s, construction: true });
  }
  return out;
}
```

- [ ] **Step 4: Add the main-loop branch**

In `toSketch`'s entity loop, after the `TEXT`/`MTEXT` branch (before `const construction = …`):

```typescript
    if (e.type === 'SOLID') {
      primitives.push(...expandSolid(e, s));
      continue;
    }
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/__tests__/toSketch.spec.ts
git commit -m "feat(dxf): map SOLID to closed construction-line loop (Phase 4c)"
```

---

### Task 3: SOLID branch inside `expandInsert` (dimension arrowheads)

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts:332–342` (block-body loop in `expandInsert`)
- Test: `packages/shared/src/dxf/__tests__/toSketch.spec.ts`

**Interfaces:**
- Consumes: `expandSolid` (Task 2).
- Produces: `expandInsert` now flattens `SOLID` entities found inside a block body (e.g. dimension arrowheads). Geometry-only; signature unchanged.

- [ ] **Step 1: Write the failing test**

Add to `toSketch.spec.ts`. This builds a `ParsedDxf` literal with a block containing one SOLID, INSERTed at the origin:

```typescript
import type { ParsedDxf } from '../types';

describe('toSketch — expandInsert flattens SOLID in block body', () => {
  it('renders a block SOLID arrowhead as construction lines', () => {
    const parsed: ParsedDxf = {
      entities: [{ type: 'INSERT', layer: '0', name: 'ARROW', x: 0, y: 0,
        xscale: 1, yscale: 1, rotation: 0, columns: 1, rows: 1, colSpacing: 0, rowSpacing: 0 }],
      blocks: {
        ARROW: [{ type: 'SOLID', layer: '0',
          corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }],
      },
      header: {}, layers: {}, blockBasePoints: { ARROW: { x: 0, y: 0 } },
    };
    const r = toSketch(parsed);
    expect(r.primitives).toHaveLength(4);
    expect(r.primitives.every((p) => p.kind === 'line' && p.construction === true)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts`
Expected: FAIL — block SOLID routes through `mapEntity(be, 1, drop, false)` → `default → drop`, `r.primitives` empty.

- [ ] **Step 3: Add the SOLID branch to the block-body loop**

In `expandInsert`, change the block-body loop (currently INSERT / POLYLINE / else):

```typescript
  for (const be of body) {
    if (be.type === 'INSERT') {
      // Nested INSERT: recurse; the outer matrix handles the final scale.
      blockPrims.push(...expandInsert(be, parsed, 1, depth + 1, drop));
    } else if (be.type === 'LWPOLYLINE' || be.type === 'POLYLINE') {
      blockPrims.push(...expandPolyline(be, 1, false));
    } else if (be.type === 'SOLID') {
      blockPrims.push(...expandSolid(be, 1));
    } else {
      const p = mapEntity(be, 1, drop, false);
      if (p) blockPrims.push(p);
    }
  }
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (and all prior expandInsert tests still green), tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/__tests__/toSketch.spec.ts
git commit -m "feat(dxf): flatten SOLID inside block bodies in expandInsert (dimension arrowheads, Phase 4c)"
```

---

### Task 4: LEADER parse branch + type

**Files:**
- Modify: `packages/shared/src/dxf/types.ts` (DxfEntity union)
- Modify: `packages/shared/src/dxf/parser.ts` (readEntity switch)
- Test: `packages/shared/src/dxf/__tests__/parser.spec.ts`

**Interfaces:**
- Produces: `DxfEntity` member `{ type: 'LEADER'; layer: string; vertices: ReadonlyArray<{ x: number; y: number }> }`.

- [ ] **Step 1: Write the failing test**

Add to `parser.spec.ts`:

```typescript
describe('parseDxf — LEADER', () => {
  it('parses leader vertices from repeated 10/20 pairs', () => {
    const dxf = entitiesDxf(['  0', 'LEADER', '  8', 'NOTES', ' 76', '3',
      ' 10', '0', ' 20', '0',
      ' 10', '5', ' 20', '5',
      ' 10', '10', ' 20', '5'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('LEADER');
    if (e.type === 'LEADER') {
      expect(e.vertices.map((v) => [v.x, v.y])).toEqual([[0, 0], [5, 5], [10, 5]]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/parser.spec.ts`
Expected: FAIL — LEADER parses to `null`.

- [ ] **Step 3: Add the type**

In `types.ts` `DxfEntity` union:

```typescript
  | { type: 'LEADER'; layer: string; vertices: ReadonlyArray<{ x: number; y: number }> }
```

- [ ] **Step 4: Add the parse branch**

In `parser.ts` `readEntity`, before `default:`:

```typescript
    case 'LEADER': {
      const xs = nums(raw.pairs, 10);
      const ys = nums(raw.pairs, 20);
      const n = Math.min(xs.length, ys.length);
      const vertices: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < n; i++) vertices.push({ x: xs[i]!, y: ys[i]! });
      return { type: 'LEADER', layer, vertices };
    }
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/parser.spec.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/dxf/types.ts packages/shared/src/dxf/parser.ts packages/shared/src/dxf/__tests__/parser.spec.ts
git commit -m "feat(dxf): parse LEADER entity vertices (Phase 4c)"
```

---

### Task 5: LEADER mapping + main-loop branch

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts` (add `expandLeader`; add LEADER branch)
- Test: `packages/shared/src/dxf/__tests__/toSketch.spec.ts`

**Interfaces:**
- Consumes: `DxfEntity` LEADER member (Task 4); `freshId`, `drop`.
- Produces: `function expandLeader(e: Extract<DxfEntity, { type: 'LEADER' }>, s: number, drop: (k: string, r: string) => void): SketchPrimitive[]` — open polyline of `construction: true` lines; `< 2` vertices → `drop('LEADER', …)` + `[]`.

- [ ] **Step 1: Write the failing tests**

Add to `toSketch.spec.ts`:

```typescript
describe('toSketch — LEADER', () => {
  it('maps a 3-vertex LEADER to 2 construction segments, no annotation', () => {
    const r = toSketch(parseDxf(ents(['  0', 'LEADER', '  8', '0',
      ' 10', '0', ' 20', '0', ' 10', '5', ' 20', '5', ' 10', '10', ' 20', '5'].join('\n'))));
    expect(r.primitives).toHaveLength(2);
    expect(r.primitives.every((p) => p.kind === 'line' && p.construction === true)).toBe(true);
    expect(r.annotations).toHaveLength(0);
  });

  it('drops a degenerate LEADER (< 2 vertices)', () => {
    const r = toSketch(parseDxf(ents(['  0', 'LEADER', '  8', '0', ' 10', '1', ' 20', '1'].join('\n'))));
    expect(r.primitives).toHaveLength(0);
    expect(r.dropped.some((d) => d.kind === 'LEADER')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts`
Expected: FAIL — LEADER falls through to `mapEntity default → drop` (kind `'LEADER'` reason "unsupported in Phase 4a"); first test gets 0 primitives.

- [ ] **Step 3: Add the `expandLeader` helper**

In `toSketch.ts`, after `expandSolid`:

```typescript
function expandLeader(
  e: Extract<DxfEntity, { type: 'LEADER' }>,
  s: number,
  drop: (k: string, r: string) => void,
): SketchPrimitive[] {
  if (e.vertices.length < 2) { drop('LEADER', 'fewer than 2 vertices'); return []; }
  const out: SketchPrimitive[] = [];
  for (let i = 0; i < e.vertices.length - 1; i++) {
    const a = e.vertices[i]!;
    const b = e.vertices[i + 1]!;
    out.push({ id: freshId(), kind: 'line', x1: a.x * s, y1: a.y * s, x2: b.x * s, y2: b.y * s, construction: true });
  }
  return out;
}
```

- [ ] **Step 4: Add the main-loop branch**

After the SOLID branch in `toSketch`'s loop:

```typescript
    if (e.type === 'LEADER') {
      primitives.push(...expandLeader(e, s, drop));
      continue;
    }
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/__tests__/toSketch.spec.ts
git commit -m "feat(dxf): map LEADER to construction polyline (Phase 4c)"
```

---

### Task 6: DIMENSION parse branch + type

**Files:**
- Modify: `packages/shared/src/dxf/types.ts` (DxfEntity union)
- Modify: `packages/shared/src/dxf/parser.ts` (readEntity switch)
- Test: `packages/shared/src/dxf/__tests__/parser.spec.ts`

**Interfaces:**
- Produces: `DxfEntity` member `{ type: 'DIMENSION'; layer: string; block?: string; textOverride: string; measurement: number; textMidX: number; textMidY: number }`.

- [ ] **Step 1: Write the failing tests**

Add to `parser.spec.ts`:

```typescript
describe('parseDxf — DIMENSION', () => {
  it('parses block name, text override, measurement, and text midpoint', () => {
    const dxf = entitiesDxf(['  0', 'DIMENSION', '  8', 'DIMENSIONS',
      '  2', '*D1', '  1', '<>', ' 42', '123.45',
      ' 11', '50', ' 21', '60'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('DIMENSION');
    if (e.type === 'DIMENSION') {
      expect(e.block).toBe('*D1');
      expect(e.textOverride).toBe('<>');
      expect(e.measurement).toBeCloseTo(123.45);
      expect([e.textMidX, e.textMidY]).toEqual([50, 60]);
    }
  });

  it('omits block when group 2 is absent', () => {
    const dxf = entitiesDxf(['  0', 'DIMENSION', '  8', '0',
      ' 42', '10', ' 11', '1', ' 21', '2'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('DIMENSION');
    if (e.type === 'DIMENSION') expect(e.block).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/parser.spec.ts`
Expected: FAIL — DIMENSION parses to `null`.

- [ ] **Step 3: Add the type**

In `types.ts` `DxfEntity` union:

```typescript
  | { type: 'DIMENSION'; layer: string; block?: string; textOverride: string; measurement: number; textMidX: number; textMidY: number }
```

- [ ] **Step 4: Add the parse branch**

In `parser.ts` `readEntity`, before `default:`:

```typescript
    case 'DIMENSION': {
      const block = str(raw.pairs, 2);
      return { type: 'DIMENSION', layer,
        ...(block ? { block } : {}),
        textOverride: str(raw.pairs, 1),
        measurement: num(raw.pairs, 42),
        textMidX: num(raw.pairs, 11), textMidY: num(raw.pairs, 21) };
    }
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/parser.spec.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/dxf/types.ts packages/shared/src/dxf/parser.ts packages/shared/src/dxf/__tests__/parser.spec.ts
git commit -m "feat(dxf): parse DIMENSION block/override/measurement/text-mid (Phase 4c)"
```

---

### Task 7: DIMENSION mapping (synth-INSERT geometry + block-text scan + fallback)

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts` (add `formatMeasurement`; add DIMENSION branch)
- Test: `packages/shared/src/dxf/__tests__/toSketch.spec.ts`

**Interfaces:**
- Consumes: `DxfEntity` DIMENSION member (Task 6); `expandInsert` (now SOLID-aware via Task 3); `stripMText`, `freshId`.
- Produces: `function formatMeasurement(v: number): string` — `v.toFixed(3)` with trailing zeros (and bare dot) trimmed.

- [ ] **Step 1: Write the failing tests**

Add to `toSketch.spec.ts` (uses `ParsedDxf` literals; `import type { ParsedDxf } from '../types'` may already be present from Task 3 — do not duplicate the import):

```typescript
describe('toSketch — DIMENSION', () => {
  it('full fidelity: flattens block geometry + arrowhead and emits the block MTEXT', () => {
    const parsed: ParsedDxf = {
      entities: [{ type: 'DIMENSION', layer: 'DIMENSIONS', block: '*D1',
        textOverride: '<>', measurement: 100, textMidX: 5, textMidY: 1 }],
      blocks: {
        '*D1': [
          { type: 'LINE', layer: '0', x1: 0, y1: 0, x2: 10, y2: 0 },
          { type: 'SOLID', layer: '0', corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
          { type: 'MTEXT', layer: '0', x: 5, y: 1, height: 2.5, value: '100', rotation: 0 },
        ],
      },
      header: {}, layers: {}, blockBasePoints: { '*D1': { x: 0, y: 0 } },
    };
    const r = toSketch(parsed);
    // 1 dimension line + 4 arrowhead-loop lines = 5 primitives
    expect(r.primitives.filter((p) => p.kind === 'line')).toHaveLength(5);
    expect(r.annotations).toHaveLength(1);
    expect(r.annotations[0]!.value).toBe('100');
    expect([r.annotations[0]!.x, r.annotations[0]!.y]).toEqual([5, 1]);
  });

  it('fallback: no block → single annotation with formatted measurement at text mid', () => {
    const parsed: ParsedDxf = {
      entities: [{ type: 'DIMENSION', layer: '0',
        textOverride: '<>', measurement: 123.5, textMidX: 7, textMidY: 8 }],
      blocks: {}, header: {}, layers: {}, blockBasePoints: {},
    };
    const r = toSketch(parsed);
    expect(r.primitives).toHaveLength(0);
    expect(r.annotations).toHaveLength(1);
    expect(r.annotations[0]!.value).toBe('123.5');
    expect([r.annotations[0]!.x, r.annotations[0]!.y]).toEqual([7, 8]);
  });

  it('fallback: non-empty override wins over measurement', () => {
    const parsed: ParsedDxf = {
      entities: [{ type: 'DIMENSION', layer: '0',
        textOverride: 'TYP.', measurement: 50, textMidX: 0, textMidY: 0 }],
      blocks: {}, header: {}, layers: {}, blockBasePoints: {},
    };
    expect(toSketch(parsed).annotations[0]!.value).toBe('TYP.');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts`
Expected: FAIL — DIMENSION falls through to `mapEntity default → drop`; no primitives/annotations produced.

- [ ] **Step 3: Add the `formatMeasurement` helper**

In `toSketch.ts`, near the other helpers:

```typescript
function formatMeasurement(v: number): string {
  // MVP formatting: 3-decimal, trailing zeros (and a bare trailing dot) trimmed.
  // No unit suffix and no dimstyle precision/tolerances (out of scope).
  return v.toFixed(3).replace(/\.?0+$/, '');
}
```

- [ ] **Step 4: Add the DIMENSION main-loop branch**

After the LEADER branch in `toSketch`'s loop. Note: a default text height (`DIM_FALLBACK_TEXT_HEIGHT`) is used for the no-block fallback because DIMENSION carries no reliable text-height code (dimstyle out of scope):

```typescript
    if (e.type === 'DIMENSION') {
      const body = e.block ? parsed.blocks[e.block] : undefined;
      if (e.block && body) {
        // Full fidelity: synthesize an identity INSERT and reuse expandInsert for the
        // drawn geometry (extension/dimension lines, arc dims, SOLID arrowheads).
        const synth: Extract<DxfEntity, { type: 'INSERT' }> = {
          type: 'INSERT', layer: e.layer, name: e.block,
          x: 0, y: 0, xscale: 1, yscale: 1, rotation: 0,
          columns: 1, rows: 1, colSpacing: 0, rowSpacing: 0,
        };
        primitives.push(...expandInsert(synth, parsed, s, 0, drop));
        // expandInsert is geometry-only and drops block text. Scan the block body for
        // TEXT/MTEXT and emit annotations under the same identity transform (subtract the
        // block base point, then apply the document unit scale).
        const base = parsed.blockBasePoints[e.block] ?? { x: 0, y: 0 };
        for (const be of body) {
          if (be.type === 'TEXT' || be.type === 'MTEXT') {
            const value = be.type === 'MTEXT' ? stripMText(be.value) : be.value;
            annotations.push({ id: freshId(), x: (be.x - base.x) * s, y: (be.y - base.y) * s,
              height: be.height * s, value, rotation: (be.rotation * Math.PI) / 180 });
          }
        }
      } else {
        // Fallback (block absent/unresolvable): one annotation at the text midpoint.
        const override = e.textOverride.trim();
        const value = override && override !== '<>' ? override : formatMeasurement(e.measurement);
        annotations.push({ id: freshId(), x: e.textMidX * s, y: e.textMidY * s,
          height: DIM_FALLBACK_TEXT_HEIGHT * s, value, rotation: 0 });
      }
      continue;
    }
```

Add the constant near the top of the file's module constants:

```typescript
// MVP default text height (drawing units) for the no-block DIMENSION fallback; DIMENSION
// carries no reliable text-height group code (dimstyle is out of scope this slice).
const DIM_FALLBACK_TEXT_HEIGHT = 2.5;
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/__tests__/toSketch.spec.ts
git commit -m "feat(dxf): import DIMENSION via synth-INSERT geometry + block-text scan + fallback (Phase 4c)"
```

---

### Task 8: MLEADER parse branch + type (defensive CONTEXT_DATA)

**Files:**
- Modify: `packages/shared/src/dxf/types.ts` (DxfEntity union)
- Modify: `packages/shared/src/dxf/parser.ts` (add `parseMleader` helper + readEntity cases)
- Test: `packages/shared/src/dxf/__tests__/parser.spec.ts`

**Interfaces:**
- Produces: `DxfEntity` member `{ type: 'MLEADER'; layer: string; leaderLines: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>; text?: { value: string; x: number; y: number; height: number; rotation: number } }`. Always returned (possibly empty `leaderLines`, no `text`) — emptiness is dropped+tallied downstream in `toSketch` (Task 9), never thrown here.
- Produces: `function parseMleader(pairs: DxfPair[]): { leaderLines: Array<Array<{ x: number; y: number }>>; text?: {...} }`.

- [ ] **Step 1: Write the failing tests**

Add to `parser.spec.ts`:

```typescript
describe('parseDxf — MLEADER', () => {
  it('extracts one leader line and embedded mtext from CONTEXT_DATA', () => {
    const dxf = entitiesDxf(['  0', 'MLEADER', '  8', '0',
      '300', 'CONTEXT_DATA{',
      '290', '1',          // has_mtext_content
      '304', 'Note A',     // mtext content (NOT ending in '{', so it is content not a token)
      ' 12', '20', ' 22', '30',  // text location
      ' 41', '2.5',        // text height
      ' 42', '0',          // text rotation
      '302', 'LEADER{',
      '304', 'LEADER_LINE{',
      ' 10', '0', ' 20', '0',
      ' 10', '5', ' 20', '5',
      '305', '}',
      '303', '}',
      '301', '}'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('MLEADER');
    if (e.type === 'MLEADER') {
      expect(e.leaderLines).toHaveLength(1);
      expect(e.leaderLines[0]!.map((v) => [v.x, v.y])).toEqual([[0, 0], [5, 5]]);
      expect(e.text?.value).toBe('Note A');
      expect([e.text?.x, e.text?.y]).toEqual([20, 30]);
      expect(e.text?.height).toBeCloseTo(2.5);
    }
  });

  it('returns an empty MLEADER for malformed/empty content (no throw)', () => {
    const dxf = entitiesDxf(['  0', 'MLEADER', '  8', '0',
      '300', 'CONTEXT_DATA{', '290', '0', '301', '}'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('MLEADER');
    if (e.type === 'MLEADER') {
      expect(e.leaderLines).toHaveLength(0);
      expect(e.text).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/parser.spec.ts`
Expected: FAIL — MLEADER parses to `null`.

- [ ] **Step 3: Add the type**

In `types.ts` `DxfEntity` union:

```typescript
  | { type: 'MLEADER'; layer: string;
      leaderLines: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>;
      text?: { value: string; x: number; y: number; height: number; rotation: number } }
```

- [ ] **Step 4: Add the `parseMleader` helper**

In `parser.ts`, near the other helpers (after `extrusion`). The brace-matching is by the literal token STRING (`value.endsWith('{')`), NOT by code number — code 304 is overloaded (MTEXT content AND the `LEADER_LINE{` token):

```typescript
// MLEADER CONTEXT_DATA is a nested brace structure inlined into the entity's group pairs.
// LIMITATION: validated against the AutoDesk/ezdxf spec, NOT a real CAD-exported file —
// re-verify on a real MLEADER DXF. Best-effort: any unrecognized content is ignored, never thrown.
function parseMleader(pairs: DxfPair[]): {
  leaderLines: Array<Array<{ x: number; y: number }>>;
  text?: { value: string; x: number; y: number; height: number; rotation: number };
} {
  const leaderLines: Array<Array<{ x: number; y: number }>> = [];
  let inContext = false, inLeader = false, inLine = false;
  let curLine: Array<{ x: number; y: number }> = [];
  let pendingX: number | null = null;
  let hasMText = false;
  let textValue = '', textX = 0, textY = 0, textH = 0, textRot = 0;

  for (const p of pairs) {
    const v = p.value;
    // Structural tokens: match by literal STRING ending in '{', never by code number.
    if (v.endsWith('{')) {
      if (v.startsWith('CONTEXT_DATA')) inContext = true;
      else if (v.startsWith('LEADER_LINE')) { inLine = true; curLine = []; pendingX = null; }
      else if (v.startsWith('LEADER')) inLeader = true;
      continue;
    }
    if (v === '}') {
      // Pop innermost open context first.
      if (inLine) { if (curLine.length) leaderLines.push(curLine); inLine = false; }
      else if (inLeader) inLeader = false;
      else if (inContext) inContext = false;
      continue;
    }
    if (inLine) {
      if (p.code === 10) pendingX = Number.parseFloat(v);
      else if (p.code === 20 && pendingX !== null) {
        const y = Number.parseFloat(v);
        if (Number.isFinite(pendingX) && Number.isFinite(y)) curLine.push({ x: pendingX, y });
        pendingX = null;
      }
      continue; // code 30 (z) ignored
    }
    if (inContext && !inLeader) {
      if (p.code === 290) hasMText = v.trim() === '1';
      else if (p.code === 304) textValue = stripMText(v);
      else if (p.code === 12) textX = Number.parseFloat(v);
      else if (p.code === 22) textY = Number.parseFloat(v);
      else if (p.code === 41) textH = Number.parseFloat(v);
      else if (p.code === 42) textRot = Number.parseFloat(v);
    }
  }

  return {
    leaderLines,
    ...(hasMText && textValue
      ? { text: { value: textValue, x: textX, y: textY, height: textH, rotation: textRot } }
      : {}),
  };
}
```

This requires `stripMText` in `parser.ts`. **Check first** whether `parser.ts` already imports/defines it; the canonical copy lives in `toSketch.ts:8–15`. If `parser.ts` does not already have access to it, export `stripMText` from `toSketch.ts` (`export function stripMText`) and import it in `parser.ts`:

```typescript
import { stripMText } from './toSketch';
```

(If that import would create a cycle that breaks the build, instead inline a private copy of `stripMText` in `parser.ts` — the 7-line body from `toSketch.ts:8–15`. Verify by running the typecheck + tests in Step 6.)

- [ ] **Step 5: Add the readEntity cases**

In `parser.ts` `readEntity`, before `default:`:

```typescript
    case 'MLEADER':
    case 'MULTILEADER': {
      const ml = parseMleader(raw.pairs);
      return { type: 'MLEADER', layer, leaderLines: ml.leaderLines, ...(ml.text ? { text: ml.text } : {}) };
    }
```

- [ ] **Step 6: Run tests + typecheck**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/parser.spec.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/dxf/types.ts packages/shared/src/dxf/parser.ts packages/shared/src/dxf/__tests__/parser.spec.ts
git commit -m "feat(dxf): defensively parse MLEADER CONTEXT_DATA (best-effort, spec-only) (Phase 4c)"
```

---

### Task 9: MLEADER mapping + main-loop branch

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts` (add MLEADER branch)
- Test: `packages/shared/src/dxf/__tests__/toSketch.spec.ts`

**Interfaces:**
- Consumes: `DxfEntity` MLEADER member (Task 8); `freshId`, `drop`.
- Produces: MLEADER → one `construction: true` polyline per leader line + one `TextAnnotation` if `text` present; empty (no lines, no text) → `drop('MLEADER', …)`.

- [ ] **Step 1: Write the failing tests**

Add to `toSketch.spec.ts`:

```typescript
describe('toSketch — MLEADER', () => {
  it('maps one leader line + embedded mtext', () => {
    const r = toSketch(parseDxf(ents(['  0', 'MLEADER', '  8', '0',
      '300', 'CONTEXT_DATA{', '290', '1', '304', 'Hi', ' 12', '9', ' 22', '9', ' 41', '2', ' 42', '0',
      '302', 'LEADER{', '304', 'LEADER_LINE{', ' 10', '0', ' 20', '0', ' 10', '4', ' 20', '4',
      '305', '}', '303', '}', '301', '}'].join('\n'))));
    expect(r.primitives).toHaveLength(1);
    expect(r.primitives[0]!.kind === 'line' && r.primitives[0]!.construction === true).toBe(true);
    expect(r.annotations).toHaveLength(1);
    expect(r.annotations[0]!.value).toBe('Hi');
  });

  it('drops an empty MLEADER without crashing', () => {
    const r = toSketch(parseDxf(ents(['  0', 'MLEADER', '  8', '0',
      '300', 'CONTEXT_DATA{', '290', '0', '301', '}'].join('\n'))));
    expect(r.primitives).toHaveLength(0);
    expect(r.annotations).toHaveLength(0);
    expect(r.dropped.some((d) => d.kind === 'MLEADER')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts`
Expected: FAIL — MLEADER falls through to `mapEntity default → drop`; first test gets 0 primitives/annotations.

- [ ] **Step 3: Add the MLEADER main-loop branch**

After the DIMENSION branch in `toSketch`'s loop:

```typescript
    if (e.type === 'MLEADER') {
      if (e.leaderLines.length === 0 && !e.text) { drop('MLEADER', 'no usable leader lines or text'); continue; }
      for (const line of e.leaderLines) {
        for (let i = 0; i < line.length - 1; i++) {
          const a = line[i]!;
          const b = line[i + 1]!;
          primitives.push({ id: freshId(), kind: 'line', x1: a.x * s, y1: a.y * s, x2: b.x * s, y2: b.y * s, construction: true });
        }
      }
      if (e.text) {
        annotations.push({ id: freshId(), x: e.text.x * s, y: e.text.y * s,
          height: e.text.height * s, value: e.text.value, rotation: (e.text.rotation * Math.PI) / 180 });
      }
      continue;
    }
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0.

- [ ] **Step 5: Full shared suite + commit**

Run: `cd packages/shared && npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: full shared suite PASS, tsc 0.

```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/__tests__/toSketch.spec.ts
git commit -m "feat(dxf): map MLEADER to leader polylines + embedded text (Phase 4c)"
```

---

### Task 10: Combined-fixture e2e (real Chromium)

**Files:**
- Create: `tests/e2e/drawing/dxf-dimension-leader-mleader.spec.ts`

**Interfaces:**
- Consumes: DEV hooks `window.__zilventorImportDxfNewPart(dxfString)` and `window.__zilventorStore` (used by prior 4a/4b/4c e2e — confirm exact names by reading one existing `tests/e2e/drawing/dxf-*.spec.ts` before writing). Asserts via the store (headless viewport renders black — never assert pixels).

- [ ] **Step 1: Read an existing DXF e2e for the exact harness**

Read one existing spec, e.g. `tests/e2e/drawing/` `dxf-*.spec.ts`, to copy verbatim: the import hook name, how the resulting sketch's `primitives`/`annotations` are read from `window.__zilventorStore`, and the page setup/`beforeEach`. Match it exactly.

- [ ] **Step 2: Write the e2e test**

Build a combined DXF string containing a BLOCKS section with a `*D1` dimension block (a LINE + a SOLID arrowhead + an MTEXT) and an ENTITIES section with: that DIMENSION, a standalone SOLID quad, a 3-vertex LEADER, and an MLEADER with one leader line + mtext. Import via the DEV hook; assert through the store that the active sketch has the expected primitive count (dimension line + arrowhead loop + standalone SOLID loop + LEADER segments + MLEADER segment) and `annotations.length` (dimension text + MLEADER text). Use the exact assertion style discovered in Step 1.

- [ ] **Step 3: Run the e2e**

Run: `npx playwright test --project=chromium tests/e2e/drawing/dxf-dimension-leader-mleader.spec.ts`
Expected: PASS. (Known-flaky, NOT ours: 3 `App.spec` `frameToModel` teardown flakes — ignore.)

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/drawing/dxf-dimension-leader-mleader.spec.ts
git commit -m "test(dxf): e2e import of DIMENSION/SOLID/LEADER/MLEADER (Phase 4c)"
```

---

## Final gate (controller, after all tasks)

- `cd packages/shared && npx vitest run` — full shared suite green.
- `cd packages/shared && npx tsc --noEmit -p tsconfig.json` — 0 errors.
- `cd packages/app && npx tsc --noEmit` — 0 new errors (app consumes shared types; confirm no break).
- `pnpm lint` (with `NODE_OPTIONS=--max-old-space-size=8192`) — 0 in real packages (≈454 stale `.claude/worktrees` lines are pre-existing noise).
- e2e: `npx playwright test --project=chromium tests/e2e/drawing/dxf-dimension-leader-mleader.spec.ts` — green.
- `superpowers:requesting-code-review` — per-task review during execution + an Opus whole-branch review before declaring the slice done. Verify the working tree is clean and nothing was self-pushed by subagents.

## Limitations & follow-ups (carry into handoff)

- **MLEADER best-effort** — validated against the spec only, not a real CAD file. Re-verify on a real MLEADER DXF (inner leader-line/dogleg codes are writer-variant).
- **DIMENSION geometry is non-construction** (user decision) — imports as regular lines, not construction-styled, because `expandInsert` flattens all blocks as non-construction. Follow-up if construction styling is wanted: thread a `construction` flag through `expandInsert`.
- **Latent pre-existing bug (out of scope):** `expandInsert` drops TEXT/MTEXT inside ANY block (e.g. INSERTed title blocks lose their text). Only DIMENSION works around it (Task 7's block-text scan). A general fix would surface annotations from `expandInsert`.
- **DIMENSION fallback text height** is a fixed MVP default (`DIM_FALLBACK_TEXT_HEIGHT = 2.5` drawing units); no dimstyle precision/units/tolerances.
- **MLEADER block-content (`296`)** and the 47×16 content transform matrix are out of scope → dropped+tallied.
- DIMENSION imports as flat geometry + text, not a live associative dimension; round-trip export will not reconstruct an associative DIMENSION (acceptable for M1 — import is the goal).
- 3DFACE, RAY/XLINE, HATCH boundary, LAYER color/linetype→metadata, parser perf — remaining 4c slices.
