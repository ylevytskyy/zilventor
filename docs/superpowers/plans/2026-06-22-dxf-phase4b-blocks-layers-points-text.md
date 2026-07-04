# DXF Phase 4b — Blocks, Layers, Points & Text Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task is TDD: write the failing test, run it red, implement minimally, run it green, commit.

**Goal:** Extend the DXF importer to handle LAYER tables (→ `construction` flag), INSERT/BLOCK recursive flattening with COLUMNS/ROWS arrays, a new `point` sketch primitive, and TEXT/MTEXT text annotations — persisted via a manifest bump v31→v32.

**Architecture:** Three layers, same spine as 4a. (A) Extend the dep-free shared DXF parser to parse the TABLES/LAYER table and INSERT array fields + BLOCK base points. (B) Widen the shared sketch model: add a `point` SketchPrimitive (plumbed through every kind-switch like Phase 3's `ellipse`) and a new `TextAnnotation` type stored in a sibling `annotations?` array on the sketch feature; bump the persistence manifest v31→v32 with a no-op structural migration. (C) Extend the pure `toSketch` module to emit points, flatten INSERTs, map layer→construction, and return TEXT/MTEXT as annotations; carry annotations into `buildSketchPartDocument` and the new-part import command.

**Tech Stack:** TypeScript, vitest (unit), Playwright (e2e, Chromium). pnpm workspace: `@zilventor/shared` (zero runtime deps), `@zilventor/app`, `@zilventor/kernel`, `@zilventor/sketcher-worker`.

**Approved spec:** `docs/superpowers/specs/2026-06-22-dxf-phase4-importer-design.md` (§"Sub-phases" 4b + mapping table). Phase 4a is shipped (HEAD `27cc6dbd`); do NOT re-run it. This plan implements 4b only.

## Global Constraints

- **Branch:** `feat/dxf-support` (NOT merged). Commit per task; **do NOT push, do NOT merge to master** (M1 builds 4b/4c before merge).
- **Manifest bump v31→v32** — `point` primitive + `annotations?` array are new serialized shapes. No-op **structural** migration keyed at 31 (mirrors Phase 3's v30→v31). Old docs have no points/annotations → no data transform needed.
- **`@zilventor/shared` has zero runtime deps** — parser, `toSketch`, and model code must be pure, plain-data in / plain-data out. No imports outside `@zilventor/shared`.
- **Annotation storage decision (locked):** TEXT/MTEXT → a new `TextAnnotation` type held in `annotations?: TextAnnotation[]` on the sketch `Feature` (sibling to `primitives`/`constraints`). **NOT** a `SketchPrimitive` kind — text is not geometry and must bypass OCCT/planegcs/snap/pick entirely.
- **Render scope (locked):** 4b stores, persists, and round-trips annotations; it does **NOT** render text in the 2D sketch view (deferred to 4c). Imported points DO render as markers (they are geometry).
- **Layer scope (locked, narrowed from spec):** layer → `construction?` only, via the AutoCAD convention (layer named `DEFPOINTS` case-insensitive, OR layer "frozen" flag group-70 bit 1). Color/linetype → metadata is **deferred to 4c** (no schema field exists; avoids widening the v32 schema beyond the two locked additions).
- **Active-sketch annotation scope:** `ImportDxfIntoActiveSketchCommand` does NOT import annotations (no live annotation channel / no renderer in 4b); it tallies them in its status message. New-part import DOES carry annotations (it builds the doc wholesale).
- **Sketch angle convention:** angles are **radians, CCW from +X**. DXF TEXT/MTEXT rotation is **degrees** (group 50) → convert to radians for the annotation if stored as radians; **store TextAnnotation.rotation in radians** for consistency with primitives.
- **Per-package test commands (run from INSIDE the package dir):**
  - shared: `cd packages/shared && npx vitest run`
  - kernel unit: `cd packages/kernel && npx vitest run` (EXCLUDES integration)
  - kernel real-OCCT: `cd packages/kernel && npx vitest run --config vitest.integration.config.ts`
  - sketcher-worker: `cd packages/sketcher-worker && npx vitest run`
  - app: `cd packages/app && npx vitest run`
  - e2e (from repo root): `npx playwright test --project=chromium tests/e2e/drawing/dxf-import.spec.ts`
- **Typecheck per package directly** (`pnpm -r typecheck` can mask): `cd packages/<pkg> && npx tsc --noEmit -p tsconfig.json`. `pnpm lint` (root `eslint .`) must stay **0**.
- `exactOptionalPropertyTypes` is ON — never assign `x: maybeUndefined` to an optional field; use conditional spread `...(cond ? { x } : {})`.
- Headless Chrome renders the viewport BLACK — assert via `window.__zilventorStore` probe / DOM, never pixels.
- Pre-existing app flake: `App.spec.tsx frameToModel` teardown (3 errors, passes in isolation) — NOT yours.

## File Structure

| File | Responsibility | Tasks |
| --- | --- | --- |
| `packages/shared/src/dxf/types.ts` | Add `DxfLayer` + `ParsedDxf.layers` + `ParsedDxf.blockBasePoints`; add INSERT array fields | 1,2 |
| `packages/shared/src/dxf/parser.ts` | `parseLayers` pre-pass; INSERT 70/71/44/45; BLOCK base point capture | 1,2 |
| `packages/shared/src/types.ts` | Add `point` SketchPrimitive; add `TextAnnotation` + `annotations?` on sketch `Feature` | 3,7 |
| `packages/shared/src/<serialization>` | Serialize/validate `point` + `annotations` | 3,7 |
| `packages/shared/src/inferFromGeometry.ts` | `point` case (anchor at the point) | 3 |
| `packages/shared/src/fileFormat.ts` | `CURRENT_FORMAT_VERSION` 31→32 + migration[31] no-op | 8 |
| `packages/kernel/src/adapter/features/SketchFeature.ts`, `RevolveFeature.ts` | skip `point` in edge building | 4 |
| `packages/sketcher-worker/src/GcsSystem.ts` | decompose/readback `point` | 5 |
| `packages/app/src/sketcher/snap.ts`, `model/ProfilePickController.ts`, sketch render component | `point` snap/bbox/render-marker | 6 |
| `packages/shared/src/dxf/toSketch.ts` | POINT→point; layer→construction; INSERT flatten+arrays; TEXT/MTEXT→annotations | 9,10,11,12 |
| `packages/app/src/import/buildSketchPartDocument.ts`, `commands/ImportDxf*Command.ts` | carry annotations | 13 |
| `tests/e2e/drawing/dxf-import.spec.ts` + `tests/e2e/fixtures/*.dxf` | §6 real-browser e2e | 14 |

---

### Task 1: Parser — TABLES/LAYER table → `ParsedDxf.layers`

**Why:** The parser ignores the TABLES section entirely (no `section === 'TABLES'` branch — `parser.ts:163-167` only routes BLOCKS/ENTITIES). LAYER records carry the layer flags `toSketch` needs to map `construction`. A standalone pre-pass (like `parseHeader`, `parser.ts:31`) is the clean, independently-testable fix.

**Files:**
- Modify: `packages/shared/src/dxf/types.ts`, `packages/shared/src/dxf/parser.ts`
- Test: `packages/shared/src/dxf/__tests__/parser.spec.ts` (existing — append)

**Interfaces:**
- Produces: `DxfLayer = { name: string; color: number; linetype: string; flags: number }` and `ParsedDxf.layers: Record<string, DxfLayer>` (keyed by layer name; `{}` when no TABLES section). Group codes within a `0 LAYER` record: name 2, color 62, linetype 6, flags 70.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/shared/src/dxf/__tests__/parser.spec.ts
describe('parseDxf TABLES/LAYER', () => {
  it('captures LAYER records (name/color/linetype/flags)', () => {
    const dxf = ['  0','SECTION','  2','TABLES',
      '  0','TABLE','  2','LAYER',
      '  0','LAYER','  2','0','  6','CONTINUOUS',' 62','7',' 70','0',
      '  0','LAYER','  2','DEFPOINTS','  6','CONTINUOUS',' 62','7',' 70','1',
      '  0','ENDTAB','  0','ENDSEC','  0','EOF'].join('\n');
    const r = parseDxf(dxf);
    expect(Object.keys(r.layers)).toEqual(['0', 'DEFPOINTS']);
    expect(r.layers['DEFPOINTS']).toEqual({ name: 'DEFPOINTS', color: 7, linetype: 'CONTINUOUS', flags: 1 });
  });
  it('leaves layers empty when no TABLES section', () => {
    const dxf = ['  0','SECTION','  2','ENTITIES','  0','LINE','  8','0',' 10','0',' 20','0',' 11','1',' 21','1',
      '  0','ENDSEC','  0','EOF'].join('\n');
    expect(parseDxf(dxf).layers).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run dxf/__tests__/parser.spec.ts -t "TABLES/LAYER"`
Expected: FAIL — `r.layers` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `types.ts`, add the layer type and field:

```ts
// types.ts — add above ParsedDxf
export type DxfLayer = { name: string; color: number; linetype: string; flags: number };

// types.ts — extend ParsedDxf
export type ParsedDxf = {
  entities: DxfEntity[];
  blocks: Record<string, DxfEntity[]>;
  header: Record<string, string>;
  layers: Record<string, DxfLayer>;
};
```

In `parser.ts`, add a `parseLayers` pre-pass and call it:

```ts
// parser.ts — add after parseHeader()
/** Extracts LAYER records from the TABLES section. */
function parseLayers(pairs: DxfPair[]): Record<string, DxfLayer> {
  const layers: Record<string, DxfLayer> = {};
  let inTables = false;
  let cur: DxfLayer | null = null;
  const commit = (): void => { if (cur) { layers[cur.name] = cur; cur = null; } };
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i]!;
    if (p.code === 0 && p.value === 'SECTION') {
      const next = pairs[i + 1];
      inTables = !!next && next.code === 2 && next.value === 'TABLES';
      continue;
    }
    if (p.code === 0 && (p.value === 'ENDSEC' || p.value === 'EOF')) { commit(); inTables = false; continue; }
    if (!inTables) continue;
    if (p.code === 0 && p.value === 'LAYER') { commit(); cur = { name: '', color: 0, linetype: '', flags: 0 }; continue; }
    if (p.code === 0) { commit(); continue; } // any other record ends the current LAYER
    if (!cur) continue;
    if (p.code === 2) cur.name = p.value;
    else if (p.code === 6) cur.linetype = p.value;
    else if (p.code === 62) cur.color = Number.parseInt(p.value, 10) || 0;
    else if (p.code === 70) cur.flags = Number.parseInt(p.value, 10) || 0;
  }
  commit();
  return layers;
}
```

```ts
// parser.ts — update the ParsedDxf import and the parseDxf initializer + assignment
import type { DxfPair, DxfEntity, DxfLayer, ParsedDxf } from './types';
// ...
const result: ParsedDxf = { entities: [], blocks: {}, header: {}, layers: {} };
// after result.header = parseHeader(pairs):
result.layers = parseLayers(pairs);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run dxf/__tests__/parser.spec.ts && cd packages/shared && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0. (Any existing test that builds a `ParsedDxf` literal must add `layers: {}` — fix those.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/types.ts packages/shared/src/dxf/parser.ts packages/shared/src/dxf/__tests__/parser.spec.ts
git commit -m "feat(dxf): parse TABLES/LAYER table into ParsedDxf.layers — Phase 4b task 1"
```

---

### Task 2: Parser — INSERT array fields + BLOCK base points

**Why:** INSERT entities can repeat in a rectangular array (COLUMNS 70 / ROWS 71 / spacing 44/45) — currently dropped. BLOCK base points (group 10/20 in the BLOCK header) anchor block geometry; the current `__BLOCK__` handling nulls `raw` at the name pair (`parser.ts:208-212`), discarding the base point.

**Files:**
- Modify: `packages/shared/src/dxf/types.ts`, `packages/shared/src/dxf/parser.ts`
- Test: `packages/shared/src/dxf/__tests__/parser.spec.ts`

**Interfaces:**
- Produces: INSERT gains `columns: number` (70, default 1), `rows: number` (71, default 1), `colSpacing: number` (44, default 0), `rowSpacing: number` (45, default 0). `ParsedDxf.blockBasePoints: Record<string, { x: number; y: number }>` (block name → base point; `{}` when none). Defaults are emitted always (not optional) so `toSketch` (Task 11) reads plain numbers.

- [ ] **Step 1: Write the failing test**

```ts
// append to parser.spec.ts
describe('parseDxf INSERT arrays + BLOCK base points', () => {
  it('reads COLUMNS/ROWS/spacing on an INSERT (defaults to 1/1/0/0)', () => {
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','INSERT','  2','BLK',' 10','1',' 20','2',' 41','1',' 42','1',' 50','0',
      ' 70','3',' 71','2',' 44','10',' 45','20',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const e = parseDxf(dxf).entities[0]!;
    if (e.type === 'INSERT') {
      expect([e.columns, e.rows, e.colSpacing, e.rowSpacing]).toEqual([3, 2, 10, 20]);
    } else throw new Error('expected INSERT');
  });
  it('defaults columns/rows to 1 when absent', () => {
    const dxf = ['  0','SECTION','  2','ENTITIES',
      '  0','INSERT','  2','BLK',' 10','0',' 20','0',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const e = parseDxf(dxf).entities[0]!;
    if (e.type === 'INSERT') expect([e.columns, e.rows]).toEqual([1, 1]);
    else throw new Error('expected INSERT');
  });
  it('captures a BLOCK base point', () => {
    const dxf = ['  0','SECTION','  2','BLOCKS',
      '  0','BLOCK','  8','0','  2','BLK',' 70','0',' 10','5',' 20','7',' 30','0','  3','BLK',
      '  0','LINE','  8','0',' 10','0',' 20','0',' 11','1',' 21','1',
      '  0','ENDBLK',
      '  0','ENDSEC','  0','EOF'].join('\n');
    const r = parseDxf(dxf);
    expect(r.blocks['BLK']).toHaveLength(1);
    expect(r.blockBasePoints['BLK']).toEqual({ x: 5, y: 7 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run dxf/__tests__/parser.spec.ts -t "INSERT arrays"`
Expected: FAIL — INSERT lacks `columns`; `blockBasePoints` undefined.

- [ ] **Step 3: Write minimal implementation**

In `types.ts`, extend INSERT and `ParsedDxf`:

```ts
// types.ts — INSERT member becomes:
| { type: 'INSERT'; layer: string; name: string; x: number; y: number; xscale: number; yscale: number; rotation: number; columns: number; rows: number; colSpacing: number; rowSpacing: number }

// types.ts — ParsedDxf gains:
  blockBasePoints: Record<string, { x: number; y: number }>;
```

In `parser.ts`:

```ts
// parser.ts — INSERT branch in readEntity:
case 'INSERT':
  return { type: 'INSERT', layer,
    name: str(raw.pairs, 2),
    x: num(raw.pairs, 10), y: num(raw.pairs, 20),
    xscale: num(raw.pairs, 41, 1), yscale: num(raw.pairs, 42, 1),
    rotation: num(raw.pairs, 50),
    columns: num(raw.pairs, 70, 1), rows: num(raw.pairs, 71, 1),
    colSpacing: num(raw.pairs, 44, 0), rowSpacing: num(raw.pairs, 45, 0) };
```

Initialize `blockBasePoints` and capture base points. Change the `__BLOCK__` handling so the header keeps accumulating pairs after the name, then read the base point in `flush()`:

```ts
// parser.ts — parseDxf initializer:
const result: ParsedDxf = { entities: [], blocks: {}, header: {}, layers: {}, blockBasePoints: {} };

// in flush(), add a branch BEFORE the readEntity() call:
if (raw.type === '__BLOCK__') {
  if (currentBlock) result.blockBasePoints[currentBlock] = { x: num(raw.pairs, 10), y: num(raw.pairs, 20) };
  raw = null;
  return;
}

// in the `else if (raw)` block, change the __BLOCK__ name handling to NOT null raw
// (so base-point pairs after code 2 are still collected):
} else if (raw) {
  raw.pairs.push(p);
  if (raw.type === '__BLOCK__' && p.code === 2 && !currentBlock) {
    currentBlock = p.value;
    result.blocks[currentBlock] ??= [];
    // keep raw alive: base point (10/20) follows the name pair
  }
}
```

> **Note:** the `!currentBlock` guard prevents the trailing `3 <name>` BLOCK pair (also code… no — `3` is a distinct code, so the guard is belt-and-suspenders against a duplicate `2`). Keep it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run && cd packages/shared && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (full shared suite — fix any INSERT/`ParsedDxf` literals that now need the new fields), tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/types.ts packages/shared/src/dxf/parser.ts packages/shared/src/dxf/__tests__/parser.spec.ts
git commit -m "feat(dxf): INSERT array fields (70/71/44/45) + BLOCK base points — Phase 4b task 2"
```

---

### Task 3: Shared model — `point` SketchPrimitive + serialization

**Why:** DXF POINT entities need a `point` sketch primitive. This task adds the union member and its serialization/validation + the shared `inferFromGeometry` anchor; downstream package plumbing is Tasks 4–6 (driven by the TS2366 errors this widening creates in value-returning switches).

**Files:**
- Modify: `packages/shared/src/types.ts` (SketchPrimitive union, `types.ts:30-36`)
- Modify: shared serialization/validation for `SketchPrimitive` (find via grep — see Step 3)
- Modify: `packages/shared/src/inferFromGeometry.ts:7`
- Test: a shared spec near the serialization tests + `inferFromGeometry` test

**Interfaces:**
- Produces: new union member `{ id: string; kind: 'point'; x: number; y: number; construction?: boolean }`. Serialization round-trips it. `inferFromGeometry` returns the point coordinate as its single anchor.

- [ ] **Step 1: Write the failing test**

```ts
// add to the shared spec covering SketchPrimitive serialization (mirror the ellipse round-trip test added in Phase 3)
import { /* serialize/deserialize fns used by the existing primitive round-trip tests */ } from '...';

it('round-trips a point primitive', () => {
  const prim = { id: 'pt1', kind: 'point' as const, x: 3, y: 4 };
  // use the same serialize→deserialize helpers the ellipse round-trip test uses:
  const out = roundTrip(prim); // replace with the actual helper name found in the existing test file
  expect(out).toEqual(prim);
});
```

```ts
// inferFromGeometry test (append to its existing spec)
it('anchors a point at its coordinate', () => {
  const anchors = inferFromGeometry({ id: 'p', kind: 'point', x: 2, y: 5 } as never);
  expect(anchors).toContainEqual(expect.objectContaining({ x: 2, y: 5 }));
});
```

> Locate the existing `ellipse` round-trip test added in Phase 3 (commit `68c82cf1`) and mirror its structure exactly — same helpers, same file. `grep -rn "kind: 'ellipse'" packages/shared/src` finds both the type and the test usages.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run`
Expected: FAIL — `point` not in the union (tsc) / serialization drops it.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/types.ts — add to the SketchPrimitive union (after the ellipse member, types.ts:35):
  | { id: string; kind: 'point'; x: number; y: number; construction?: boolean }
```

Then plumb through shared serialization/validation and `inferFromGeometry`:

```bash
# find every shared site that enumerates primitive kinds:
grep -rn "kind === 'ellipse'\|case 'ellipse'\|'ellipse':" packages/shared/src
```

- `packages/shared/src/inferFromGeometry.ts:7` — add a `case 'point': return [{ x: p.x, y: p.y, ... }];` matching the anchor shape the other cases return (copy the `circle` center-anchor shape).
- Any serialize/validate switch the grep surfaces — add a `point` arm that passes `{ id, kind, x, y, ...(construction ? { construction } : {}) }` through. If serialization is structural (whole-object clone with a kind whitelist), add `'point'` to the whitelist.

> `exactOptionalPropertyTypes`: emit `construction` via conditional spread, never `construction: undefined`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run && cd packages/shared && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/inferFromGeometry.ts packages/shared/src/**/*.ts
git commit -m "feat(sketch): add point SketchPrimitive + shared serialization — Phase 4b task 3"
```

---

### Task 4: Kernel — plumb `point` (skip in edge building)

**Why:** Widening `SketchPrimitive` makes the value-returning `switch (p.kind)` in `SketchFeature.ts:100` and `RevolveFeature.ts:260` fail tsc (TS2366 — not all paths return). A `point` is not an edge; it must be skipped (like construction primitives), not crash edge building.

**Files:**
- Modify: `packages/kernel/src/adapter/features/SketchFeature.ts:100`, `packages/kernel/src/adapter/features/RevolveFeature.ts:260`
- Test: kernel unit spec for SketchFeature edge building (append)

**Interfaces:**
- Consumes: `point` SketchPrimitive (Task 3). Produces: a sketch containing a `point` builds the same edge set as without it (point contributes zero edges).

- [ ] **Step 1: Write the failing test**

```ts
// append to the kernel unit spec that exercises SketchFeature edge building
it('skips point primitives when building sketch edges (no edge contributed)', () => {
  // build a sketch with one line + one point; assert the edge count equals the line-only case
  const withPoint = buildSketchEdges([
    { id: 'l', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
    { id: 'p', kind: 'point', x: 5, y: 5 },
  ]); // replace buildSketchEdges with the real helper/entry the existing tests use
  expect(withPoint.length).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/kernel && npx vitest run` then `cd packages/kernel && npx tsc --noEmit -p tsconfig.json`
Expected: tsc FAIL (TS2366 at `SketchFeature.ts:100` / `RevolveFeature.ts:260`); test FAIL or unbuildable.

- [ ] **Step 3: Write minimal implementation**

In both switches, add a `point` arm that contributes no edge. Match the existing skip pattern (construction primitives are already filtered/skipped there — copy it):

```ts
// SketchFeature.ts — inside switch (p.kind):
case 'point':
  break; // points are not edges — contribute nothing to the profile

// RevolveFeature.ts buildEdgesFor() — inside switch (p.kind):
case 'point':
  break; // points contribute no revolve-profile edge
```

> If a switch arm returns an array (e.g. `return makeLineEdge(...)`), use `case 'point': return [];` to satisfy the value-returning signature. Match the neighboring arms' return type exactly.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/kernel && npx vitest run && cd packages/kernel && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0. (Real-OCCT integration unchanged — run `cd packages/kernel && npx vitest run --config vitest.integration.config.ts` to confirm green if SketchFeature integration tests exist.)

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/adapter/features/SketchFeature.ts packages/kernel/src/adapter/features/RevolveFeature.ts packages/kernel/src/**/*.spec.ts
git commit -m "feat(sketch): skip point primitive in kernel edge building — Phase 4b task 4"
```

---

### Task 5: Sketcher-worker — plumb `point` through GcsSystem

**Why:** The planegcs decomposition `switch (p.kind)` at `GcsSystem.ts:110` (decompose) and `GcsSystem.ts:369` (readback) must handle `point` or tsc-fail / silently mishandle it. A raw-imported point has no constraints; decompose it to a single GCS point so it can later be referenced, and read its coordinate back.

**Files:**
- Modify: `packages/sketcher-worker/src/GcsSystem.ts:110`, `:369`
- Test: `packages/sketcher-worker` spec (append)

**Interfaces:**
- Consumes: `point` SketchPrimitive. Produces: `pushPrimitiveDecomposition` registers one point param-pair (x,y); `readDomainPrimitive` returns the (possibly solved) `{ id, kind:'point', x, y }`.

- [ ] **Step 1: Write the failing test**

```ts
// append to the GcsSystem spec
it('decomposes and reads back a point primitive', () => {
  const sys = new GcsSystem(); // mirror how existing tests construct it
  sys.pushPrimitiveDecomposition({ id: 'p', kind: 'point', x: 2, y: 3 });
  const out = sys.readDomainPrimitive({ id: 'p', kind: 'point', x: 2, y: 3 });
  expect(out).toEqual({ id: 'p', kind: 'point', x: 2, y: 3 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/sketcher-worker && npx vitest run` then `npx tsc --noEmit -p tsconfig.json`
Expected: FAIL (missing `point` case / tsc).

- [ ] **Step 3: Write minimal implementation**

Mirror how a `circle`'s center point is registered (a single point param-pair):

```ts
// GcsSystem.ts pushPrimitiveDecomposition (~:110) — add:
case 'point': {
  this.pushPoint(p.id, p.x, p.y); // use the real point-registration helper the circle case uses for its center
  break;
}

// GcsSystem.ts readDomainPrimitive (~:369) — add:
case 'point': {
  const pt = this.readPoint(original.id); // mirror the circle-center read-back helper
  return { ...original, x: pt.x, y: pt.y };
}
```

> Replace `pushPoint`/`readPoint` with the actual helpers the `circle` case uses for its center coordinate (read the surrounding cases first). The point shares its primitive id as the point key, matching the convention other primitives use for their defining points.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/sketcher-worker && npx vitest run && cd packages/sketcher-worker && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sketcher-worker/src/GcsSystem.ts packages/sketcher-worker/src/**/*.spec.ts
git commit -m "feat(sketch): decompose/readback point primitive in GcsSystem — Phase 4b task 5"
```

---

### Task 6: App — plumb `point` (snap, bbox, render marker)

**Why:** The app's primitive kind-switches (`snap.ts:16`, `ProfilePickController.ts:54`, and the sketch render component) must handle `point` or tsc-fail / silently skip rendering. A point renders as a small marker, snaps to its coordinate, and has a degenerate bbox at its location.

**Files:**
- Modify: `packages/app/src/sketcher/snap.ts:16`, `packages/app/src/model/ProfilePickController.ts:54`, the sketch primitive render component (find via grep)
- Test: app spec for `snap` / render (append)

**Interfaces:**
- Consumes: `point` SketchPrimitive. Produces: `primitiveEndpoints` returns `[{x,y}]`; `primitivesBbox` includes the point; the renderer draws a marker for `point`.

- [ ] **Step 1: Write the failing test**

```ts
// append to the snap spec
it('returns the point coordinate as its only endpoint', () => {
  expect(primitiveEndpoints({ id: 'p', kind: 'point', x: 7, y: 9 } as never)).toEqual([{ x: 7, y: 9 }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npx vitest run sketcher/__tests__/snap.spec.ts` (adjust to the real spec path) then `cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: FAIL (missing case / tsc TS2366 in value-returning switches).

- [ ] **Step 3: Write minimal implementation**

```bash
# find every app primitive kind-switch (Phase 3 ellipse touched the same set):
grep -rn "kind === 'ellipse'\|case 'ellipse'\|kind === 'circle'\|case 'circle'" packages/app/src
```

- `snap.ts:16` — `case 'point': return [{ x: p.x, y: p.y }];`
- `ProfilePickController.ts:54` — `case 'point': return { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };` (match the bbox shape the other arms return).
- Sketch render component (the SVG/canvas switch the grep surfaces) — add a `point` case drawing a small marker (a 4px cross or filled dot at `(p.x, p.y)`), styled like the existing primitive stroke; honor `construction` styling if the other cases do.
- Any other `.kind ===`/`case '` site the grep surfaces (pick, dimension tool, profile detection) — add a `point` arm that no-ops (a point is not pickable as a profile edge, not dimensionable in 4b). Add explanatory one-line comments where neighboring arms have them.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && npx vitest run && cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (only the known frameToModel flake), tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/sketcher/snap.ts packages/app/src/model/ProfilePickController.ts packages/app/src/**/*.tsx packages/app/src/**/*.spec.ts
git commit -m "feat(sketch): plumb point primitive through app snap/bbox/render — Phase 4b task 6"
```

---

### Task 7: Shared model — `TextAnnotation` + `annotations?` on sketch feature

**Why:** TEXT/MTEXT import as text annotations stored in a sibling `annotations?` array on the sketch feature (locked decision). This task adds the type, the optional field, and its serialization — separate from `point` so each schema addition is reviewed independently.

**Files:**
- Modify: `packages/shared/src/types.ts` (add `TextAnnotation`; extend the `sketch` `Feature` variant, `types.ts:53`)
- Modify: shared serialization for the sketch feature (the same module Task 3 touched)
- Test: shared spec — sketch feature round-trips `annotations`

**Interfaces:**
- Produces: `TextAnnotation = { id: string; x: number; y: number; height: number; value: string; rotation: number }` (rotation in **radians**). The `sketch` Feature variant gains `annotations?: TextAnnotation[]`. Serialization round-trips it; absent ⇒ omitted (`exactOptionalPropertyTypes`).

- [ ] **Step 1: Write the failing test**

```ts
// shared spec near the sketch-feature serialization tests
it('round-trips a sketch feature with text annotations', () => {
  const sketch = {
    kind: 'sketch' as const, id: 's1',
    plane: { source: 'workPlane' as const, featureId: 'origin.XY' },
    primitives: [], constraints: [],
    annotations: [{ id: 'a1', x: 1, y: 2, height: 3, value: 'HELLO', rotation: 0 }],
  };
  const out = roundTripFeature(sketch); // use the real serialize→deserialize helper from the existing feature tests
  expect(out.annotations).toEqual(sketch.annotations);
});

it('omits annotations when absent', () => {
  const sketch = { kind: 'sketch' as const, id: 's2', plane: { source: 'workPlane' as const, featureId: 'origin.XY' }, primitives: [], constraints: [] };
  const out = roundTripFeature(sketch);
  expect('annotations' in out).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run`
Expected: FAIL — `annotations` not in the sketch type / dropped by serialization.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/types.ts — add the type (near SketchPrimitive):
export type TextAnnotation = { id: string; x: number; y: number; height: number; value: string; rotation: number };

// extend the sketch Feature variant (types.ts:53):
{ kind: 'sketch'; id: string; plane: WorkPlaneRef; primitives: SketchPrimitive[]; constraints: SketchConstraint[]; annotations?: TextAnnotation[] }
```

In the sketch-feature serializer, pass `annotations` through with a conditional spread:

```ts
// when serializing/cloning a sketch feature:
...(feature.annotations && feature.annotations.length ? { annotations: feature.annotations.map((a) => ({ ...a })) } : {})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run && cd packages/shared && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/**/*.ts
git commit -m "feat(sketch): add TextAnnotation model + sketch.annotations field — Phase 4b task 7"
```

---

### Task 8: Manifest v31→v32 (no-op migration + version churn)

**Why:** `point` + `annotations` are new serialized shapes → bump the persistence version with a no-op structural migration keyed at 31 (mirrors Phase 3's v30→v31, `fileFormat.ts:419-422`). Old docs need no transform.

**Files:**
- Modify: `packages/shared/src/fileFormat.ts:4` (constant), `:43-423` (migrations registry)
- Test: new `packages/shared/src/__tests__/migrateManifest-v31-to-v32.spec.ts` + bump the migrate-to-current OUTPUT assertions

**Interfaces:**
- Produces: `CURRENT_FORMAT_VERSION === 32`; `migrations[31]` returns the doc with `formatVersion: 32` unchanged otherwise.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/migrateManifest-v31-to-v32.spec.ts
// mirror migrateManifest-v30-to-v31.spec.ts exactly
import { describe, it, expect } from 'vitest';
import { migrateToCurrent } from '../fileFormat'; // use the real migrate entry the v30→v31 spec imports

describe('migrate v31 → v32', () => {
  it('bumps formatVersion to 32 with no structural change', () => {
    const v31 = { formatVersion: 31, /* minimal valid manifest from the v30→v31 fixture */ };
    const out = migrateToCurrent(v31 as never);
    expect(out.formatVersion).toBe(32);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run __tests__/migrateManifest-v31-to-v32.spec.ts`
Expected: FAIL — `CURRENT_FORMAT_VERSION` is 31, no `migrations[31]`.

- [ ] **Step 3: Write minimal implementation**

```ts
// fileFormat.ts:4
export const CURRENT_FORMAT_VERSION = 32 as const;

// fileFormat.ts — add to the migrations registry (after the `30:` entry):
31: (mIn) => {
  const m = deepClone(mIn);
  return { ...m, formatVersion: 32 };
},
```

Update the `ProjectFile`/manifest version union type if it enumerates literal versions (add `32`).

- [ ] **Step 4: Run test to verify it passes + sweep the version churn**

Run: `cd packages/shared && npx vitest run`
Expected: the new spec PASSES; **other specs now FAIL** wherever they assert the migrate-to-current RESULT equals 31. Those failures ARE the find-list — bump each to 32:

- Update every assertion that checks a **migrated/current** version to `toBe(32)` (Phase 3 found ~22 of these across the migration specs).
- Update the single "already current" INPUT fixture from `formatVersion: 31` → `32` (the test that feeds a current-version doc and expects a no-op).
- **Do NOT** change older-version INPUT fixtures (a `formatVersion: 26` fixture stays 26 — it tests the 26→…→current chain).

Re-run `cd packages/shared && npx vitest run && cd packages/shared && npx tsc --noEmit -p tsconfig.json` until green + tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/fileFormat.ts packages/shared/src/__tests__/*.spec.ts
git commit -m "feat(format): manifest v31→v32 (point + annotations) no-op migration — Phase 4b task 8"
```

---

### Task 9: `toSketch` — POINT → `point` primitive

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts`
- Test: `packages/shared/src/dxf/__tests__/toSketch.spec.ts`

**Interfaces:**
- Consumes: a DXF `POINT` entity. **Note:** the parser does not yet emit POINT (it returns `null` in `readEntity`'s default). First add a `POINT` parser case (group 10/20), then map it.
- Produces: `{ id, kind:'point', x: x*s, y: y*s }` (unit-scaled).

- [ ] **Step 1: Write the failing test**

```ts
// append to toSketch.spec.ts
it('maps POINT → point primitive (unit-scaled)', () => {
  const header = ['  0','SECTION','  2','HEADER','  9','$INSUNITS',' 70','1','  0','ENDSEC'].join('\n');
  const r = toSketch(parseDxf(ents(['  0','POINT','  8','0',' 10','2',' 20','3'].join('\n'), header)));
  const p = r.primitives[0]!;
  if (p.kind === 'point') { expect(p.x).toBeCloseTo(50.8, 6); expect(p.y).toBeCloseTo(76.2, 6); }
  else throw new Error('expected point');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run dxf/__tests__/toSketch.spec.ts -t "POINT"`
Expected: FAIL — POINT is parsed as `null` (dropped), no `point` primitive.

- [ ] **Step 3: Write minimal implementation**

Add a POINT entity to the parser and a `point` arm to `mapEntity`:

```ts
// types.ts DxfEntity union — add:
| { type: 'POINT'; layer: string; x: number; y: number }

// parser.ts readEntity — add case:
case 'POINT':
  return { type: 'POINT', layer, x: num(raw.pairs, 10), y: num(raw.pairs, 20) };

// toSketch.ts mapEntity — add case (replace any default-drop for POINT):
case 'POINT':
  return { id: freshId(), kind: 'point', x: e.x * s, y: e.y * s };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run && cd packages/shared && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/types.ts packages/shared/src/dxf/parser.ts packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/__tests__/*.spec.ts
git commit -m "feat(dxf): toSketch POINT → point primitive — Phase 4b task 9"
```

---

### Task 10: `toSketch` — layer → `construction` flag

**Why:** Entities on a DEFPOINTS or frozen layer are construction/reference geometry (AutoCAD convention). `toSketch` consults `parsed.layers` to set `construction: true`.

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts`
- Test: `packages/shared/src/dxf/__tests__/toSketch.spec.ts`

**Interfaces:**
- Consumes: `parsed.layers` (Task 1), each entity's `layer`. Produces: emitted primitives carry `construction: true` when their layer name is `DEFPOINTS` (case-insensitive) OR the layer's flags have bit 1 (frozen) set. Otherwise `construction` is omitted.

- [ ] **Step 1: Write the failing test**

```ts
// append to toSketch.spec.ts
it('marks entities on DEFPOINTS / frozen layers as construction', () => {
  const tables = ['  0','SECTION','  2','TABLES','  0','TABLE','  2','LAYER',
    '  0','LAYER','  2','DEFPOINTS','  6','CONTINUOUS',' 62','7',' 70','0',
    '  0','LAYER','  2','FROZ','  6','CONTINUOUS',' 62','7',' 70','1',
    '  0','LAYER','  2','NORMAL','  6','CONTINUOUS',' 62','7',' 70','0',
    '  0','ENDTAB','  0','ENDSEC'].join('\n');
  const body = ['  0','CIRCLE','  8','DEFPOINTS',' 10','0',' 20','0',' 40','1',
    '  0','CIRCLE','  8','FROZ',' 10','5',' 20','0',' 40','1',
    '  0','CIRCLE','  8','NORMAL',' 10','9',' 20','0',' 40','1'].join('\n');
  const dxf = [tables,'  0','SECTION','  2','ENTITIES',body,'  0','ENDSEC','  0','EOF'].join('\n');
  const ps = toSketch(parseDxf(dxf)).primitives;
  expect(ps[0]!.construction).toBe(true);   // DEFPOINTS
  expect(ps[1]!.construction).toBe(true);   // frozen
  expect(ps[2]!.construction).toBeUndefined(); // normal layer
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run dxf/__tests__/toSketch.spec.ts -t "construction"`
Expected: FAIL — `construction` is always undefined.

- [ ] **Step 3: Write minimal implementation**

```ts
// toSketch.ts — add a layer→construction helper:
function isConstructionLayer(layers: Record<string, { name: string; flags: number }>, layer: string): boolean {
  if (layer.toUpperCase() === 'DEFPOINTS') return true;
  const l = layers[layer];
  return !!l && (l.flags & 1) === 1; // bit 1 = frozen
}
```

Thread it: compute `const construction = isConstructionLayer(parsed.layers, e.layer);` per entity (in `toSketch`'s loop, pass it into `mapEntity`/`expandPolyline`), and spread `...(construction ? { construction: true } : {})` into every emitted primitive (including polyline segments and the new point). Keep the spread conditional (exactOptionalPropertyTypes).

> Each entity carries its own `layer`; pass the resolved boolean down rather than re-looking-up per segment.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run && cd packages/shared && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (existing tests unaffected — default layer `0` is not construction), tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/__tests__/toSketch.spec.ts
git commit -m "feat(dxf): toSketch layer→construction (DEFPOINTS/frozen) — Phase 4b task 10"
```

---

### Task 11: `toSketch` — INSERT recursive flatten + COLUMNS/ROWS arrays

**Why:** An INSERT references a block by name; its geometry must be flattened into the sketch with the insert's translate/scale/rotate applied and the rectangular array (COLUMNS×ROWS) expanded. Blocks may nest → recurse with a depth guard against cycles.

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts`
- Test: `packages/shared/src/dxf/__tests__/toSketch.spec.ts`

**Interfaces:**
- Consumes: INSERT entity (Task 2 fields), `parsed.blocks`, `parsed.blockBasePoints`. Produces: for each INSERT, the block's mapped primitives transformed by `T = translate(insertX, insertY) ∘ rotate(rotation°→rad) ∘ scale(xscale, yscale) ∘ translate(-baseX, -baseY)`, repeated for each `(col, row)` in `[0,columns)×[0,rows)` offset by `(col*colSpacing, row*rowSpacing)` (in the block's pre-rotation grid — apply the array offset in the insert's local frame before rotation, per DXF spec). Depth guard: max recursion depth 16 → drop deeper INSERTs with a `dropped` tally.

- [ ] **Step 1: Write the failing test**

```ts
// append to toSketch.spec.ts
describe('toSketch INSERT flatten', () => {
  const BLOCK_DXF = (insert: string): string => ['  0','SECTION','  2','BLOCKS',
    '  0','BLOCK','  8','0','  2','BLK',' 70','0',' 10','0',' 20','0','  3','BLK',
    '  0','LINE','  8','0',' 10','0',' 20','0',' 11','2',' 21','0',
    '  0','ENDBLK','  0','ENDSEC',
    '  0','SECTION','  2','ENTITIES', insert, '  0','ENDSEC','  0','EOF'].join('\n');

  it('flattens a single INSERT with translation', () => {
    const r = toSketch(parseDxf(BLOCK_DXF(['  0','INSERT','  2','BLK',' 10','10',' 20','5',' 41','1',' 42','1',' 50','0'].join('\n'))));
    const line = r.primitives.find((p) => p.kind === 'line');
    expect(line).toBeDefined();
    if (line && line.kind === 'line') { expect([line.x1, line.y1]).toEqual([10, 5]); expect([line.x2, line.y2]).toEqual([12, 5]); }
  });

  it('expands a 2×1 INSERT array', () => {
    const r = toSketch(parseDxf(BLOCK_DXF(['  0','INSERT','  2','BLK',' 10','0',' 20','0',' 41','1',' 42','1',' 50','0',
      ' 70','2',' 71','1',' 44','20',' 45','0'].join('\n'))));
    expect(r.primitives.filter((p) => p.kind === 'line')).toHaveLength(2); // 2 columns
    const xs = r.primitives.filter((p) => p.kind === 'line').map((p) => (p as { x1: number }).x1).sort((a, b) => a - b);
    expect(xs).toEqual([0, 20]); // second copy offset by colSpacing
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run dxf/__tests__/toSketch.spec.ts -t "INSERT flatten"`
Expected: FAIL — INSERT currently goes to `dropped` (Task-4-era 4a code).

- [ ] **Step 3: Write minimal implementation**

Replace the `case 'INSERT': drop(...)` arm. Restructure `toSketch`'s loop so INSERT expands to many primitives (like polylines do). Map block entities through `mapEntity`/`expandPolyline`, then apply an affine transform to every emitted primitive's coordinates:

```ts
// toSketch.ts — affine transform of a SketchPrimitive's coordinates
type Affine = { a: number; b: number; c: number; d: number; e: number; f: number }; // [[a c e],[b d f]]
const apply = (m: Affine, x: number, y: number): { x: number; y: number } => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
const mul = (m: Affine, n: Affine): Affine => ({
  a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
  e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f,
});

function transformPrimitive(m: Affine, p: SketchPrimitive): SketchPrimitive {
  switch (p.kind) {
    case 'line': { const a = apply(m, p.x1, p.y1), b = apply(m, p.x2, p.y2); return { ...p, id: freshId(), x1: a.x, y1: a.y, x2: b.x, y2: b.y }; }
    case 'circle': { const c = apply(m, p.cx, p.cy); return { ...p, id: freshId(), cx: c.x, cy: c.y }; } // uniform-scale assumption (4b)
    case 'arc': { const c = apply(m, p.cx, p.cy); return { ...p, id: freshId(), cx: c.x, cy: c.y }; }
    case 'ellipse': { const c = apply(m, p.cx, p.cy); return { ...p, id: freshId(), cx: c.x, cy: c.y }; }
    case 'spline': return { ...p, id: freshId(), controlPoints: p.controlPoints.map((cp) => apply(m, cp.x, cp.y)) };
    case 'point': { const c = apply(m, p.x, p.y); return { ...p, id: freshId(), x: c.x, y: c.y }; }
    case 'rectangle': { const c = apply(m, p.x, p.y); return { ...p, id: freshId(), x: c.x, y: c.y }; }
  }
}

function insertMatrix(ins: { x: number; y: number; xscale: number; yscale: number; rotation: number }, base: { x: number; y: number }): Affine {
  const r = (ins.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  // translate(ins) ∘ rotate ∘ scale ∘ translate(-base)
  const scaleBase: Affine = { a: ins.xscale, b: 0, c: 0, d: ins.yscale, e: -base.x * ins.xscale, f: -base.y * ins.yscale };
  const rot: Affine = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  const trans: Affine = { a: 1, b: 0, c: 0, d: 1, e: ins.x, f: ins.y };
  return mul(trans, mul(rot, scaleBase));
}
```

```ts
// toSketch.ts — in the toSketch() entity loop, replace INSERT handling with a recursive expander:
function expandInsert(ins: Extract<DxfEntity, { type: 'INSERT' }>, parsed: ParsedDxf, s: number, depth: number, drop: (k: string, r: string) => void): SketchPrimitive[] {
  if (depth > 16) { drop('INSERT', 'block nesting deeper than 16 levels'); return []; }
  const body = parsed.blocks[ins.name];
  if (!body) { drop('INSERT', `unknown block ${ins.name}`); return []; }
  const base = parsed.blockBasePoints[ins.name] ?? { x: 0, y: 0 };
  // map the block body once (unit scale NOT applied inside the block frame; applied to the final WCS coords)
  const blockPrims: SketchPrimitive[] = [];
  for (const be of body) {
    if (be.type === 'INSERT') blockPrims.push(...expandInsert(be, parsed, 1, depth + 1, drop)); // nested: scale handled by outer matrix
    else if (be.type === 'LWPOLYLINE' || be.type === 'POLYLINE') blockPrims.push(...expandPolyline(be, 1, false));
    else { const p = mapEntity(be, 1, drop); if (p) blockPrims.push(p); }
  }
  const out: SketchPrimitive[] = [];
  const cols = Math.max(1, ins.columns), rows = Math.max(1, ins.rows);
  for (let cI = 0; cI < cols; cI++) for (let rI = 0; rI < rows; rI++) {
    const placed: typeof ins = { ...ins, x: ins.x + cI * ins.colSpacing, y: ins.y + rI * ins.rowSpacing };
    const m = insertMatrix(placed, base);
    for (const bp of blockPrims) {
      const t = transformPrimitive(m, bp);
      // apply the document unit scale to the final WCS coordinates:
      out.push(transformPrimitive({ a: s, b: 0, c: 0, d: s, e: 0, f: 0 }, t));
    }
  }
  return out;
}
```

> **Simplifying assumptions for 4b (document, revisit in 4c):** circle/arc/ellipse radii are NOT scaled by `xscale`/`yscale` (only centers move) — correct for the dominant unit-scale (1,1) inserts; non-uniform scale of curved geometry is a 4c concern. Block-internal entities ignore their own OCS extrusion under an insert (rare). `expandPolyline`/`mapEntity` are called with scale `1` inside the block frame; the document unit scale `s` is applied once to the final WCS coordinates. Adjust `expandPolyline`'s signature if it needs a `construction` argument (Task 10) — pass `false` for block-internal unless block layers are resolved (deferred).

Wire it in the `toSketch` loop:

```ts
for (const e of parsed.entities) {
  if (e.type === 'INSERT') { primitives.push(...expandInsert(e, parsed, s, 0, drop)); continue; }
  // ... existing polyline / mapEntity dispatch ...
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run && cd packages/shared && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/__tests__/toSketch.spec.ts
git commit -m "feat(dxf): toSketch INSERT recursive flatten + COLUMNS/ROWS arrays — Phase 4b task 11"
```

---

### Task 12: `toSketch` — TEXT/MTEXT → annotations (+ MTEXT strip)

**Why:** TEXT/MTEXT import into the `annotations` channel (4a always returned `[]`). MTEXT carries inline formatting codes (`\fArial|...;`, `{\...}`, `\P`) that must be stripped to plain text.

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts`
- Test: `packages/shared/src/dxf/__tests__/toSketch.spec.ts`

**Interfaces:**
- Consumes: `TEXT`/`MTEXT` entities (parser already emits them). Produces: `ToSketchResult.annotations: TextAnnotation[]` — `{ id: freshId(), x: x*s, y: y*s, height: height*s, value: <stripped>, rotation: rotation°→rad }`. Update `ToSketchResult.annotations` type from `never[]` to `TextAnnotation[]`.

- [ ] **Step 1: Write the failing test**

```ts
// append to toSketch.spec.ts
describe('toSketch TEXT/MTEXT → annotations', () => {
  it('maps TEXT to a text annotation (deg→rad rotation, unit-scaled)', () => {
    const header = ['  0','SECTION','  2','HEADER','  9','$INSUNITS',' 70','4','  0','ENDSEC'].join('\n');
    const r = toSketch(parseDxf(ents(['  0','TEXT','  8','0',' 10','1',' 20','2',' 40','5',' 1','HELLO',' 50','90'].join('\n'), header)));
    expect(r.primitives).toHaveLength(0);
    expect(r.annotations).toHaveLength(1);
    const a = r.annotations[0]!;
    expect([a.x, a.y, a.height, a.value]).toEqual([1, 2, 5, 'HELLO']);
    expect(a.rotation).toBeCloseTo(Math.PI / 2, 9);
  });
  it('strips MTEXT inline formatting codes', () => {
    const r = toSketch(parseDxf(ents(['  0','MTEXT','  8','0',' 10','0',' 20','0',' 40','2',' 1','{\\fArial|b0;Line1}\\PLine2',' 50','0'].join('\n'))));
    expect(r.annotations[0]!.value).toBe('Line1\nLine2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run dxf/__tests__/toSketch.spec.ts -t "annotations"`
Expected: FAIL — TEXT/MTEXT go to `dropped`; `annotations` is `[]`.

- [ ] **Step 3: Write minimal implementation**

```ts
// toSketch.ts — change the result type + collect annotations
import type { SketchPrimitive, TextAnnotation } from '../types';
export type ToSketchResult = { primitives: SketchPrimitive[]; annotations: TextAnnotation[]; dropped: DxfDropped[] };

/** Strip MTEXT inline formatting: \P→newline, {\...;} groups, \f.../\F... font, \A\C\H\W\Q\T\p control words, braces. */
function stripMText(raw: string): string {
  return raw
    .replace(/\\P/g, '\n')
    .replace(/\\[fF][^;]*;/g, '')
    .replace(/\\[ACcHWQTp][^;\\{}]*;?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\(.)/g, '$1');
}
```

In `toSketch`, collect annotations and remove the TEXT/MTEXT `drop(...)` arms:

```ts
const annotations: TextAnnotation[] = [];
// in the entity loop, before mapEntity:
if (e.type === 'TEXT' || e.type === 'MTEXT') {
  const value = e.type === 'MTEXT' ? stripMText(e.value) : e.value;
  annotations.push({ id: freshId(), x: e.x * s, y: e.y * s, height: e.height * s, value, rotation: (e.rotation * Math.PI) / 180 });
  continue;
}
// ...
return { primitives, annotations, dropped: [...droppedMap.values()] };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run && cd packages/shared && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (the 4a "TEXT → dropped" assertion, if any, is replaced), tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/__tests__/toSketch.spec.ts
git commit -m "feat(dxf): toSketch TEXT/MTEXT → annotations + MTEXT strip — Phase 4b task 12"
```

---

### Task 13: Carry annotations into the part document + commands

**Why:** `toSketch` now returns annotations; the new-part import must store them in the sketch feature, and both commands' status messages should report annotation counts. (Active-sketch import does NOT add annotations — no live channel in 4b — it tallies them.)

**Files:**
- Modify: `packages/app/src/import/buildSketchPartDocument.ts`, `packages/app/src/commands/ImportDxfIntoNewPartCommand.ts`, `packages/app/src/commands/ImportDxfIntoActiveSketchCommand.ts`
- Test: `packages/app/src/commands/__tests__/ImportDxfIntoNewPartCommand.spec.ts` (append)

**Interfaces:**
- Produces: `buildSketchPartDocument(name, primitives, annotations?)` — annotations stored on the sketch feature when non-empty. `ImportDxfIntoNewPartCommand.apply()` passes `toSketch().annotations`. Status message: `Imported N primitives, M annotations, skipped K entities`.

- [ ] **Step 1: Write the failing test**

```ts
// append to ImportDxfIntoNewPartCommand.spec.ts
it('stores text annotations on the imported sketch', async () => {
  const TEXT_DXF = ['  0','SECTION','  2','ENTITIES',
    '  0','LINE','  8','0',' 10','0',' 20','0',' 11','1',' 21','0',
    '  0','TEXT','  8','0',' 10','1',' 20','2',' 40','5',' 1','HI',' 50','0',
    '  0','ENDSEC','  0','EOF'].join('\n');
  let active: unknown = null;
  const cmd = new ImportDxfIntoNewPartCommand({
    kernel: { registerPart: async () => {} } as never,
    store: { getActivePart: () => active as never, setActivePart: (p: unknown) => { active = p; } },
    file: { name: 't.dxf', text: async () => TEXT_DXF } as unknown as File,
  });
  await cmd.apply();
  const doc = active as { featureTree: Array<{ kind: string; primitives?: unknown[]; annotations?: unknown[] }> };
  const sketch = doc.featureTree.find((f) => f.kind === 'sketch')!;
  expect(sketch.primitives).toHaveLength(1);
  expect(sketch.annotations).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npx vitest run commands/__tests__/ImportDxfIntoNewPartCommand.spec.ts -t "annotations"`
Expected: FAIL — annotations not carried.

- [ ] **Step 3: Write minimal implementation**

```ts
// buildSketchPartDocument.ts — add an optional annotations param:
import type { PartDocument, SketchPrimitive, TextAnnotation, Feature } from '@zilventor/shared';
export function buildSketchPartDocument(name: string, primitives: SketchPrimitive[], annotations: TextAnnotation[] = []): PartDocument {
  const sketch: Feature = {
    kind: 'sketch', id: crypto.randomUUID(),
    plane: { source: 'workPlane', featureId: 'origin.XY' },
    primitives, constraints: [],
    ...(annotations.length ? { annotations } : {}),
  };
  // ... unchanged wrapper ...
}
```

```ts
// ImportDxfIntoNewPartCommand.ts apply():
const { primitives, annotations, dropped } = toSketch(parseDxf(text));
const part = buildSketchPartDocument(fileStem(this.ctx.file.name), primitives, annotations);
// ...
const skipped = dropped.reduce((a, d) => a + d.count, 0);
this.ctx.setStatus?.(`Imported ${primitives.length} primitives, ${annotations.length} annotations, skipped ${skipped} entities`);
```

```ts
// ImportDxfIntoActiveSketchCommand.ts apply(): annotations are NOT added to the live sketch in 4b — tally them in the status.
const { primitives, annotations, dropped } = toSketch(parseDxf(text));
// ... existing per-primitive dual-path adds ...
const skipped = dropped.reduce((a, d) => a + d.count, 0) + annotations.length;
this.ctx.setStatus?.(`Imported ${primitives.length} primitives, skipped ${skipped} entities`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && npx vitest run commands/__tests__/ImportDxfIntoNewPartCommand.spec.ts && cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/import/buildSketchPartDocument.ts packages/app/src/commands/ImportDxfIntoNewPartCommand.ts packages/app/src/commands/ImportDxfIntoActiveSketchCommand.ts packages/app/src/commands/__tests__/ImportDxfIntoNewPartCommand.spec.ts
git commit -m "feat(dxf): carry text annotations into imported part document — Phase 4b task 13"
```

---

### Task 14: §6 real-browser e2e — points, text, INSERT, layer

**Why:** Verification gate (§6). Import a fixture exercising all four 4b features in a real Chromium session via the existing DEV import hook; assert primitive/annotation counts via `window.__zilventorStore`.

**Files:**
- Create: `tests/e2e/fixtures/phase4b.dxf`
- Modify: `tests/e2e/drawing/dxf-import.spec.ts` (append a 4b scenario)

**Interfaces:**
- Consumes: the `__zilventorImportDxfNewPart` DEV hook (added in 4a) + `window.__zilventorStore`. Produces: an assertion that the imported sketch holds the expected primitive count (a line + a circle from a 2-instance INSERT array + a point) and 1 annotation.

- [ ] **Step 1: Write the failing test**

```ts
// append a scenario to tests/e2e/drawing/dxf-import.spec.ts
test('Phase 4b: imports points, text, INSERT array, and layer construction', async ({ page }) => {
  await page.goto('/');
  // wait for kernel-ready exactly as the 4a scenarios do (status bar "Ready")
  const dxf = await readFixture('phase4b.dxf'); // mirror how the 4a scenario loads its fixture
  await page.evaluate(async (text) => { await (window as any).__zilventorImportDxfNewPart(text, 'phase4b.dxf'); }, dxf);
  const counts = await page.evaluate(() => {
    const part = (window as any).__zilventorStore.getState().activePart;
    const sketch = part.featureTree.find((f: any) => f.kind === 'sketch');
    return { prims: sketch.primitives.length, annos: (sketch.annotations ?? []).length, point: sketch.primitives.filter((p: any) => p.kind === 'point').length };
  });
  expect(counts.point).toBe(1);
  expect(counts.annos).toBe(1);
  expect(counts.prims).toBeGreaterThanOrEqual(4); // 1 line + 2 INSERT-array circles + 1 point
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  expect(errors).toEqual([]);
});
```

> Confirm the real signature of `__zilventorImportDxfNewPart` (added in 4a, `App.tsx`) and `readFixture`/the fixture-loading idiom the 4a scenarios use; match them exactly.

- [ ] **Step 2: Create the fixture + run red**

Create `tests/e2e/fixtures/phase4b.dxf` with: a HEADER ($INSUNITS=4), a TABLES/LAYER table (a DEFPOINTS layer + layer 0), a BLOCK `BLK` containing one CIRCLE, an ENTITIES section with one LINE, one POINT, one TEXT, and one INSERT of `BLK` with `70=2` (2 columns). (Hand-author from the unit-test DXF snippets above.)

Run: `npx playwright test --project=chromium tests/e2e/drawing/dxf-import.spec.ts -g "Phase 4b"`
Expected: FAIL first (fixture/hook wiring), then iterate to green.

- [ ] **Step 3–4: Make it pass**

Adjust fixture/assertions until green. If `__zilventorImportDxfNewPart` doesn't accept a name arg, match its real signature.

Run: `npx playwright test --project=chromium tests/e2e/drawing/dxf-import.spec.ts`
Expected: PASS (all scenarios), 0 console errors.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/fixtures/phase4b.dxf tests/e2e/drawing/dxf-import.spec.ts
git commit -m "test(dxf): §6 e2e — points/text/INSERT/layer import — Phase 4b task 14"
```

---

## Final Whole-Branch Review (LOAD-BEARING)

After all 14 tasks, run an opus whole-branch review (`review-package <base-before-task-1> HEAD`). Phase 4a's final review caught an IMPORTANT that all 9 per-task reviews missed (un-negated polyline bulge under reflected OCS). Specifically re-check:
- **Point plumbing completeness** — grep `case '`/`\.kind ===` across all 4 packages; confirm EVERY geometry switch has a `point` arm (a missed non-exhaustive if/else chain on `.r` would silently mishandle a point).
- **INSERT transform order** — verify the affine `translate ∘ rotate ∘ scale ∘ translate(-base)` against a rotated+scaled fixture by hand (the array offset must be applied before rotation per DXF spec).
- **Migration churn** — confirm only migrate-to-CURRENT output assertions were bumped to 32, not older-version input fixtures.
- **Annotation round-trip** — confirm a saved v32 doc with annotations reloads with them intact (manifest save/load, not just in-memory).

## Gate (run all before declaring done)

- `cd packages/shared && npx vitest run` + tsc 0
- `cd packages/kernel && npx vitest run` + `--config vitest.integration.config.ts` + tsc 0
- `cd packages/sketcher-worker && npx vitest run` + tsc 0
- `cd packages/app && npx vitest run` (only the known frameToModel flake) + tsc 0
- `npx playwright test --project=chromium tests/e2e/drawing/dxf-import.spec.ts`
- `pnpm lint` (root) clean
- Working tree committed; **NOT pushed, NOT merged.**

## Self-Review (completed by plan author)

- **Spec coverage:** TABLES/LAYER (T1, T10) ✓ · INSERT arrays + BLOCK base (T2, T11) ✓ · `point` primitive plumbed everywhere (T3–T6, T9) ✓ · TEXT/MTEXT annotation model + strip (T7, T12, T13) ✓ · manifest v31→v32 (T8) ✓ · §6 e2e (T14) ✓. **Deferred (noted in Global Constraints):** color/linetype metadata → 4c; 2D annotation rendering → 4c; HATCH boundary → 4c; non-uniform scale of curved INSERT geometry → 4c. These match the spec's flexible 4b/4c boundary.
- **Type consistency:** `TextAnnotation` shape identical in T7/T12/T13; `ToSketchResult.annotations` widened `never[]`→`TextAnnotation[]` in T12; `point` member shape identical across T3/T9/T11 `transformPrimitive`.
- **Placeholder scan:** the only deliberate "find via grep" steps (T3 serialization site, T5 GcsSystem point helpers, T6 render component) are because those exact files/helpers must be read at implementation time; each gives the precise grep + the code pattern to add. All other steps carry complete code.
