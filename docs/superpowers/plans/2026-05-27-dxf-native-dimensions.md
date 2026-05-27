# Native R12 DIMENSION entities in WYSIWYG DXF export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export each supported `DrawingDimension` in the WYSIWYG DXF (`renderDrawingDxf`) as a native R12 `DIMENSION` entity backed by an anonymous `*D##` block (reusing the existing dim-picture geometry) and a shared `STANDARD` DIMSTYLE, instead of loose lines + text.

**Architecture:** Extend the coordinate-agnostic `dxfWriter` with (1) a `STANDARD` DIMSTYLE table entry, (2) a `block(build)` helper that captures emitted geometry into an anonymous BLOCK and returns its name, and (3) a `dimension(opts)` emitter for the DIMENSION entity. Then refactor `renderDrawingDxf`'s `emitDimension` so each kind wraps its *existing* geometry in a block and emits a DIMENSION referencing that block + DIMSTYLE. Stay R12/AC1009; no manifest bump; `renderDrawingDxf1to1` untouched.

**Tech Stack:** TypeScript, Vitest (unit), Playwright (e2e + perf), pnpm monorepo. Spec: `docs/superpowers/specs/2026-05-27-dxf-native-dimensions-design.md`.

---

## File Structure

- **Modify** `packages/app/src/drawing/dxfWriter.ts` — add DIMSTYLE table to TABLES; add `block()` + `dimension()` to `DxfDocument`; refactor emitters to a `sink` target so geometry can be captured into a block; emit accumulated block defs in the BLOCKS section.
- **Modify** `packages/app/src/drawing/renderDrawingDxf.ts` — refactor `emitDimension` (linear-h/v/aligned, baseline, ordinate, angular) to wrap existing geometry in `doc.block(...)` + emit `doc.dimension(...)`. No other emitters change.
- **Modify** `packages/app/src/drawing/__tests__/dxfWriter.spec.ts` — add DXF-DIMSTYLE, DXF-BLOCK, DXF-NDIM unit tests.
- **Modify** `packages/app/src/drawing/__tests__/renderDrawingDxf.spec.ts` — add per-kind native-DIMENSION assertions.
- **Modify** `packages/app/src/App.tsx` — add `__zilventorRenderDxfDimsMs` perf probe + a dimension-heavy fixture; add to the dev-mode cleanup `delete` block.
- **Create** `tests/e2e/drawing/T-6-26-dxf-native-dim.spec.ts` — real-Chromium multi-kind dims → export DXF → parse-back native DIMENSION assertions.
- **Create** `tests/perf/drawing-dxf-native-dim.perf.spec.ts` — T63n perf probe (p95 < 50ms).

### Reference: existing facts (verified against real code)

- `DxfDocument` (dxfWriter.ts:8-19): `line`, `polyline`, `circle`, `text`, `toString`. Emitters push group-code pairs into a closure `ents: string[]`. `fmt(n)` (line 26) guards NaN/Infinity/-0 → `'0.0000'`, else `n.toFixed(4)`. Group codes are right-padded to width 3 (`'  2'`, `' 70'`, `' 10'`); table-flag ints use 6-wide (`'     0'`); reals are plain (`'0.0'`, `'6.0'`).
- TABLES currently holds LTYPE + LAYER tables, then `ENDSEC` (dxfWriter.ts:42-75). BLOCKS section is a static empty array (lines 77-80).
- `renderDrawingDxf(drawing, sheet, source)` → `emitDimension(doc, dim, views, dimensionGroups, flipY)` (renderDrawingDxf.ts:293-472). Y-flip `flipY(svgY) = sheetH - svgY`.
- `DrawingDimension` kinds (shared/src/drawing/types.ts:232-285): `linear-h`, `linear-v`, `aligned`, `radial`, `diametric`, `baseline`, `ordinate`, `angular`. **`radial`/`diametric` are NOT emitted today and stay out of scope.**
- Pre-existing quirk (preserve, do NOT fix — surgical): `aligned` is rendered with the *vertical* (linear-v) geometry branch. We keep that geometry; the DIMENSION entity uses `dimType: 1` with the real measured points as def points.

---

## Task 1: dxfWriter — shared STANDARD DIMSTYLE table

**Files:**
- Modify: `packages/app/src/drawing/dxfWriter.ts:60-75` (insert DIMSTYLE table before `ENDSEC`)
- Test: `packages/app/src/drawing/__tests__/dxfWriter.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `dxfWriter.spec.ts` inside the `'dxfWriter — document scaffolding (DXF-SCAF)'` describe block (after DXF-SCAF-5):

```typescript
  it('DXF-DIMSTYLE-1: DIMSTYLE table with STANDARD style defined in TABLES', () => {
    const out = createDxfDocument().toString();
    expect(out).toContain('DIMSTYLE');
    expect(out).toContain('STANDARD');
    // DIMSTYLE table must sit inside the TABLES section (before BLOCKS)
    expect(out.indexOf('DIMSTYLE')).toBeGreaterThan(out.indexOf('TABLES'));
    expect(out.indexOf('DIMSTYLE')).toBeLessThan(out.indexOf('BLOCKS'));
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/dxfWriter.spec.ts -t DXF-DIMSTYLE-1`
Expected: FAIL — output does not contain `DIMSTYLE`.

- [ ] **Step 3: Write minimal implementation**

In `dxfWriter.ts`, immediately after the LAYER table's `tables.push('  0', 'ENDTAB');` (line 73) and before `tables.push('  0', 'ENDSEC');` (line 75), insert:

```typescript
  // DIMSTYLE table — one shared STANDARD style (drives native DIMENSION regen)
  tables.push('  0', 'TABLE', '  2', 'DIMSTYLE', ' 70', '     1');
  tables.push(
    '  0', 'DIMSTYLE',
    '  2', 'STANDARD',
    ' 70', '     0',
    '140', '3.5',     // DIMTXT  — text height (matches dim-label text height)
    ' 41', '2.5',     // DIMASZ  — arrow size
    '147', '0.625',   // DIMGAP
    ' 77', '     1',  // DIMTAD  — text above the dimension line
    ' 73', '     0',  // DIMTIH  — inside text aligned with dim line
    ' 74', '     0',  // DIMTOH  — outside text aligned with dim line
  );
  tables.push('  0', 'ENDTAB');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/dxfWriter.spec.ts`
Expected: PASS — all DXF-SCAF + DXF-ENT + DXF-DIMSTYLE-1 green (existing SCAF section-count tests still pass: DIMSTYLE adds table content, not a SECTION).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/dxfWriter.ts packages/app/src/drawing/__tests__/dxfWriter.spec.ts
git commit -m "feat(dxf-native-dim): add shared STANDARD DIMSTYLE table to dxfWriter"
```

---

## Task 2: dxfWriter — `block(build)` anonymous-block builder

**Files:**
- Modify: `packages/app/src/drawing/dxfWriter.ts` (type + closure: sink refactor, block defs, BLOCKS emission)
- Test: `packages/app/src/drawing/__tests__/dxfWriter.spec.ts`

- [ ] **Step 1: Write the failing test**

Add a new describe block to `dxfWriter.spec.ts`:

```typescript
describe('dxfWriter — anonymous blocks (DXF-BLOCK)', () => {
  it('DXF-BLOCK-1: block() emits BLOCK/ENDBLK in BLOCKS section and returns *D-name', () => {
    const doc = createDxfDocument();
    const name = doc.block(() => {
      doc.polyline('DIMENSIONS', [[0, 0], [10, 0]]);
      doc.text('DIMENSIONS', 5, 1, 3.5, '10');
    });
    const out = doc.toString();
    expect(name).toMatch(/^\*D\d+$/);
    expect(out).toContain('BLOCK');
    expect(out).toContain('ENDBLK');
    expect(out).toContain(name);
    // BLOCK definition lives in the BLOCKS section (before ENTITIES)
    expect(out.indexOf('BLOCK\n')).toBeGreaterThan(-1);
    const blocksPos = out.indexOf('BLOCKS');
    const entitiesPos = out.indexOf('ENTITIES');
    expect(out.indexOf('ENDBLK')).toBeGreaterThan(blocksPos);
    expect(out.indexOf('ENDBLK')).toBeLessThan(entitiesPos);
  });

  it('DXF-BLOCK-2: geometry inside block() is captured in the block, NOT the ENTITIES section', () => {
    const doc = createDxfDocument();
    doc.line('VISIBLE', 1, 2, 3, 4);            // goes to ENTITIES
    doc.block(() => { doc.polyline('DIMENSIONS', [[0, 0], [9, 9]]); }); // goes to BLOCKS
    const out = doc.toString();
    const blocksPos = out.indexOf('BLOCKS');
    const entitiesPos = out.indexOf('ENTITIES');
    // The block's POLYLINE appears before ENTITIES (i.e. inside BLOCKS)
    const polyPos = out.indexOf('POLYLINE');
    expect(polyPos).toBeGreaterThan(blocksPos);
    expect(polyPos).toBeLessThan(entitiesPos);
    // The standalone LINE appears in ENTITIES
    expect(out.indexOf('LINE')).toBeGreaterThan(entitiesPos);
  });

  it('DXF-BLOCK-3: two block() calls produce distinct *D names', () => {
    const doc = createDxfDocument();
    const n1 = doc.block(() => { doc.polyline('DIMENSIONS', [[0, 0], [1, 0]]); });
    const n2 = doc.block(() => { doc.polyline('DIMENSIONS', [[0, 0], [2, 0]]); });
    expect(n1).not.toBe(n2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/dxfWriter.spec.ts -t DXF-BLOCK`
Expected: FAIL — `doc.block is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `dxfWriter.ts`:

(a) Add to the `DxfDocument` type (after the `text(...)` member, before `toString`):

```typescript
  /** Capture all geometry emitted inside `build` into an anonymous BLOCK; returns its *D name. */
  block(build: () => void): string;
  /** Emit a native DIMENSION entity (R12). Coordinates are already transformed/Y-flipped. */
  dimension(opts: {
    layer: string;
    blockName: string;
    dimStyle: string;
    dimType: number;                                  // group 70 value (flags pre-baked)
    defPoint: readonly [number, number];              // group 10/20
    textMid: readonly [number, number];               // group 11/21
    text: string;                                     // group 1
    rotation?: number;                                // group 50 (rotated linear only)
    extraPoints?: ReadonlyArray<readonly [number, number, number]>; // [code, x, y] → code/code+10/code+20
  }): void;
```

(b) Replace the closure internals. Change the static empty BLOCKS array (lines 77-83) and the `ents` declaration to:

```typescript
  // ── BLOCKS section accumulator (block definitions appended by block()) ──
  const blockDefs: string[] = [];

  // Internal entities accumulator — populated by emitters
  const ents: string[] = [];
  // Current emission target: ENTITIES by default, redirected into a block during block().
  let sink: string[] = ents;
  let anonCounter = 0;
```

(c) In each of `line`, `polyline`, `circle`, `text`, replace `ents.push(` with `sink.push(`. (The `polyline` early-return `if (points.length < 2) return;` stays.)

(d) Add the `block` and `dimension` methods to the returned object (after `text`, before `toString`):

```typescript
    block(build) {
      const name = `*D${++anonCounter}`;
      const prev = sink;
      const body: string[] = [];
      sink = body;
      try { build(); } finally { sink = prev; }
      blockDefs.push(
        '  0', 'BLOCK',
        '  8', '0',
        '  2', name,
        ' 70', '     1',   // anonymous block flag
        ' 10', '0.0', ' 20', '0.0', ' 30', '0.0',
        '  3', name,
        ...body,
        '  0', 'ENDBLK',
        '  8', '0',
      );
      return name;
    },

    dimension(opts) {
      const pad = (n: number): string => {
        const s = String(n);
        return s.length >= 3 ? s : ' '.repeat(3 - s.length) + s;
      };
      ents.push(
        '  0', 'DIMENSION',
        '  8', opts.layer,
        '  2', opts.blockName,
        ' 10', fmt(opts.defPoint[0]), ' 20', fmt(opts.defPoint[1]), ' 30', '0.0',
        ' 11', fmt(opts.textMid[0]), ' 21', fmt(opts.textMid[1]), ' 31', '0.0',
        ' 70', `     ${opts.dimType}`,
        '  1', opts.text,
        '  3', opts.dimStyle,
      );
      if (opts.rotation !== undefined) ents.push(' 50', fmt(opts.rotation));
      for (const [code, x, y] of opts.extraPoints ?? []) {
        ents.push(
          pad(code), fmt(x),
          pad(code + 10), fmt(y),
          pad(code + 20), '0.0',
        );
      }
    },
```

(e) In `toString()`, replace the `...blocks,` spread with an inline BLOCKS section built from `blockDefs`:

```typescript
    toString() {
      const blockSection = [
        '  0', 'SECTION', '  2', 'BLOCKS',
        ...blockDefs,
        '  0', 'ENDSEC',
      ];
      const entSection = [
        '  0', 'SECTION', '  2', 'ENTITIES',
        ...ents,
        '  0', 'ENDSEC',
      ];
      return [
        ...header,
        ...tables,
        ...blockSection,
        ...entSection,
        '  0', 'EOF',
      ].join('\n') + '\n';
    },
```

Delete the now-unused static `blocks` array (old lines 78-80).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/dxfWriter.spec.ts`
Expected: PASS — DXF-BLOCK-1/2/3 green AND all existing DXF-SCAF/DXF-ENT green (SCAF-1 still counts exactly 4 SECTIONs; SCAF-6 BLOCKS-after-TABLES-before-ENTITIES still holds).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/dxfWriter.ts packages/app/src/drawing/__tests__/dxfWriter.spec.ts
git commit -m "feat(dxf-native-dim): block() captures geometry into anonymous BLOCK"
```

---

## Task 3: dxfWriter — `dimension()` entity emitter (unit coverage)

**Files:**
- Modify: `packages/app/src/drawing/__tests__/dxfWriter.spec.ts` (the `dimension` method was added in Task 2; this task locks its group-code contract)

- [ ] **Step 1: Write the failing test**

Add a new describe block to `dxfWriter.spec.ts`:

```typescript
describe('dxfWriter — native DIMENSION entity (DXF-NDIM)', () => {
  it('DXF-NDIM-1: dimension() emits DIMENSION with block ref, dimstyle, type, def/text points', () => {
    const doc = createDxfDocument();
    const blk = doc.block(() => { doc.polyline('DIMENSIONS', [[0, 0], [30, 0]]); });
    doc.dimension({
      layer: 'DIMENSIONS', blockName: blk, dimStyle: 'STANDARD', dimType: 0,
      defPoint: [30, 100], textMid: [15, 101], text: '30', rotation: 0,
      extraPoints: [[13, 0, 90], [14, 30, 90]],
    });
    const out = doc.toString();
    expect(out).toContain('DIMENSION');
    // block reference (group 2 = *D name)
    expect(out).toContain(blk);
    // dimstyle reference (group 3)
    expect(out).toContain('STANDARD');
    // dim type flag (group 70 = 0) and measurement text (group 1)
    const pairs = out.split('\n');
    const dimIdx = pairs.findIndex((l) => l.trim() === 'DIMENSION');
    expect(dimIdx).toBeGreaterThan(-1);
    const block = pairs.slice(dimIdx, dimIdx + 30).join('\n');
    expect(block).toContain('30');            // text
    // extension-line def points (13/14 → x; 23/24 → y; 33/34 → 0.0)
    expect(block).toContain(' 13');
    expect(block).toContain(' 14');
    expect(block).toContain(' 50');           // rotation present
  });

  it('DXF-NDIM-2: ordinate X-type sets group-70 flag 70 (= 6 | 64)', () => {
    const doc = createDxfDocument();
    const blk = doc.block(() => { doc.polyline('DIMENSIONS', [[0, 0], [0, 10]]); });
    doc.dimension({
      layer: 'DIMENSIONS', blockName: blk, dimStyle: 'STANDARD', dimType: 6 + 64,
      defPoint: [0, 0], textMid: [1, 1], text: '12.00',
      extraPoints: [[13, 5, 5], [14, 0, 5]],
    });
    const out = doc.toString();
    const pairs = out.split('\n');
    const dimIdx = pairs.findIndex((l) => l.trim() === 'DIMENSION');
    const block = pairs.slice(dimIdx, dimIdx + 30).join('\n');
    // group 70 value 70 (6 ordinate + 64 X-bit)
    expect(block).toMatch(/ 70\n\s*70/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/dxfWriter.spec.ts -t DXF-NDIM`
Expected: PASS already? No — these exercise the Task-2 `dimension()` method. If Task 2 is complete they pass immediately; that's acceptable (this task is the explicit contract lock). If `dimension` were missing they would fail with `doc.dimension is not a function`. Run to confirm GREEN against the Task-2 implementation.

> NOTE: Because `dimension()` was implemented in Task 2, DXF-NDIM tests are GREEN on first run. This is an intentional contract-lock task, not a red→green slice. To prove the assertions have teeth, temporarily change `' 70', \`     ${opts.dimType}\`` to a constant `'0'` in `dimension()`, run DXF-NDIM-2 → it must FAIL, then revert.

- [ ] **Step 3: (no production change — contract lock)**

If any DXF-NDIM assertion fails, fix `dimension()` in `dxfWriter.ts` to satisfy it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/dxfWriter.spec.ts`
Expected: PASS (all dxfWriter tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/__tests__/dxfWriter.spec.ts
git commit -m "test(dxf-native-dim): lock DIMENSION entity group-code contract"
```

---

## Task 4: renderDrawingDxf — linear-h / linear-v / aligned → native DIMENSION

**Files:**
- Modify: `packages/app/src/drawing/renderDrawingDxf.ts:315-328` (the `linear-h`/else geometry block)
- Test: `packages/app/src/drawing/__tests__/renderDrawingDxf.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to the `'renderDrawingDxf — dimensions + annotations + title (DXF-DIM)'` describe block:

```typescript
  it('DXF-NDIM-LINEAR-1: linear-h dimension → DIMENSION entity + anonymous block on DIMENSIONS', () => {
    const sheet = makeSheet({
      views: [{
        id: 'v1', kind: 'base', positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'e1', kind: 'outline', points: [[0, 50], [0, 60]] as ReadonlyArray<readonly [number, number]> },
            { id: 'e2', kind: 'outline', points: [[30, 50], [30, 60]] as ReadonlyArray<readonly [number, number]> },
          ],
          hiddenEdges: [], bbox: { minX: 0, minY: 50, maxX: 30, maxY: 60 },
        },
      }],
      dimensions: [{
        id: 'dim1', kind: 'linear-h', viewId: 'v1',
        from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
        to:   { kind: 'edge-endpoint', edgeId: 'e2', end: 'start' },
        offsetMm: 10,
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(out).toContain('DIMENSION');           // native entity emitted
    expect(out).toContain('STANDARD');             // references dimstyle
    expect(out).toMatch(/\*D\d+/);                 // references an anonymous block
    // The dim picture geometry is preserved (now inside the block): dimSvgY=40 → dxfY=170
    expect(out).toContain('170.0000');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingDxf.spec.ts -t DXF-NDIM-LINEAR-1`
Expected: FAIL — output has no `DIMENSION` / `*D` (current code emits loose POLYLINE+TEXT only).

- [ ] **Step 3: Write minimal implementation**

In `renderDrawingDxf.ts`, replace the `if (dim.kind === 'linear-h') { ... } else { ... } return;` block (lines 315-328) with:

```typescript
    if (dim.kind === 'linear-h') {
      const dimSvgY = sy1 - offset;
      const blockName = doc.block(() => {
        doc.polyline('DIMENSIONS', [[x1, flipY(dimSvgY)], [x2, flipY(dimSvgY)]]);
        doc.polyline('DIMENSIONS', [[x1, flipY(sy1)], [x1, flipY(dimSvgY)]]);
        doc.polyline('DIMENSIONS', [[x2, flipY(sy2)], [x2, flipY(dimSvgY)]]);
        doc.text('DIMENSIONS', (x1 + x2) / 2, flipY(dimSvgY - 1), 3.5, label);
      });
      doc.dimension({
        layer: 'DIMENSIONS', blockName, dimStyle: 'STANDARD', dimType: 0,
        defPoint: [x2, flipY(dimSvgY)],
        textMid: [(x1 + x2) / 2, flipY(dimSvgY - 1)],
        text: label, rotation: 0,
        extraPoints: [[13, x1, flipY(sy1)], [14, x2, flipY(sy2)]],
      });
    } else {
      const dimSvgX = x1 + offset;
      const blockName = doc.block(() => {
        doc.polyline('DIMENSIONS', [[dimSvgX, flipY(sy1)], [dimSvgX, flipY(sy2)]]);
        doc.polyline('DIMENSIONS', [[x1, flipY(sy1)], [dimSvgX, flipY(sy1)]]);
        doc.polyline('DIMENSIONS', [[x2, flipY(sy2)], [dimSvgX, flipY(sy2)]]);
        doc.text('DIMENSIONS', dimSvgX + 1, flipY((sy1 + sy2) / 2), 3.5, label);
      });
      doc.dimension({
        layer: 'DIMENSIONS', blockName, dimStyle: 'STANDARD',
        dimType: dim.kind === 'aligned' ? 1 : 0,
        defPoint: [dimSvgX, flipY(sy2)],
        textMid: [dimSvgX + 1, flipY((sy1 + sy2) / 2)],
        text: label,
        rotation: dim.kind === 'aligned' ? undefined : 90,
        extraPoints: [[13, x1, flipY(sy1)], [14, x2, flipY(sy2)]],
      });
    }
    return;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingDxf.spec.ts`
Expected: PASS — DXF-NDIM-LINEAR-1 green AND existing DXF-DIM-1 still green (`170.0000` + `DIMENSIONS` still present; geometry moved into block).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/renderDrawingDxf.ts packages/app/src/drawing/__tests__/renderDrawingDxf.spec.ts
git commit -m "feat(dxf-native-dim): linear-h/v/aligned export as native DIMENSION + block"
```

---

## Task 5: renderDrawingDxf — baseline → native DIMENSION

**Files:**
- Modify: `packages/app/src/drawing/renderDrawingDxf.ts:346-359` (the `baseline` h/else geometry block)
- Test: `packages/app/src/drawing/__tests__/renderDrawingDxf.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
  it('DXF-NDIM-BASELINE-1: baseline dimension → DIMENSION entity + block', () => {
    const sheet = makeSheet({
      views: [{
        id: 'v1', kind: 'base', positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'd0', kind: 'outline', points: [[0, 50], [0, 60]] as ReadonlyArray<readonly [number, number]> },
            { id: 't1', kind: 'outline', points: [[40, 50], [40, 60]] as ReadonlyArray<readonly [number, number]> },
          ],
          hiddenEdges: [], bbox: { minX: 0, minY: 50, maxX: 40, maxY: 60 },
        },
      }],
      dimensionGroups: [{
        kind: 'baseline', id: 'g1', viewId: 'v1',
        datum: { kind: 'edge-endpoint', edgeId: 'd0', end: 'start' },
        direction: 'h', baseOffsetMm: 8, spacingMm: 6,
      }],
      dimensions: [{
        kind: 'baseline', id: 'b1', viewId: 'v1', groupId: 'g1', slot: 0,
        to: { kind: 'edge-endpoint', edgeId: 't1', end: 'start' },
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(out).toContain('DIMENSION');
    expect(out).toMatch(/\*D\d+/);
    expect(out).toContain('40');   // measured distance label
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingDxf.spec.ts -t DXF-NDIM-BASELINE-1`
Expected: FAIL — no `DIMENSION` entity (baseline still loose POLYLINE+TEXT).

- [ ] **Step 3: Write minimal implementation**

Replace the baseline `if (group.direction === 'h') { ... } else { ... } return;` block (renderDrawingDxf.ts:346-360) with:

```typescript
    if (group.direction === 'h') {
      const dimSvgY = sdy - offset2;
      const blockName = doc.block(() => {
        doc.polyline('DIMENSIONS', [[dx, flipY(dimSvgY)], [tx2, flipY(dimSvgY)]]);
        doc.polyline('DIMENSIONS', [[dx, flipY(sdy)], [dx, flipY(dimSvgY)]]);
        doc.polyline('DIMENSIONS', [[tx2, flipY(sty)], [tx2, flipY(dimSvgY)]]);
        doc.text('DIMENSIONS', (dx + tx2) / 2, flipY(dimSvgY - 1), 3.5, label2);
      });
      doc.dimension({
        layer: 'DIMENSIONS', blockName, dimStyle: 'STANDARD', dimType: 0,
        defPoint: [tx2, flipY(dimSvgY)], textMid: [(dx + tx2) / 2, flipY(dimSvgY - 1)],
        text: label2, rotation: 0,
        extraPoints: [[13, dx, flipY(sdy)], [14, tx2, flipY(sty)]],
      });
    } else {
      const dimSvgX = dx + offset2;
      const midSvgY = (sdy + sty) / 2;
      const blockName = doc.block(() => {
        doc.polyline('DIMENSIONS', [[dimSvgX, flipY(sdy)], [dimSvgX, flipY(sty)]]);
        doc.polyline('DIMENSIONS', [[dx, flipY(sdy)], [dimSvgX, flipY(sdy)]]);
        doc.polyline('DIMENSIONS', [[tx2, flipY(sty)], [dimSvgX, flipY(sty)]]);
        doc.text('DIMENSIONS', dimSvgX + 1, flipY(midSvgY), 3.5, label2);
      });
      doc.dimension({
        layer: 'DIMENSIONS', blockName, dimStyle: 'STANDARD', dimType: 0,
        defPoint: [dimSvgX, flipY(sty)], textMid: [dimSvgX + 1, flipY(midSvgY)],
        text: label2, rotation: 90,
        extraPoints: [[13, dx, flipY(sdy)], [14, tx2, flipY(sty)]],
      });
    }
    return;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingDxf.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/renderDrawingDxf.ts packages/app/src/drawing/__tests__/renderDrawingDxf.spec.ts
git commit -m "feat(dxf-native-dim): baseline dims export as native DIMENSION + block"
```

---

## Task 6: renderDrawingDxf — ordinate → native DIMENSION

**Files:**
- Modify: `packages/app/src/drawing/renderDrawingDxf.ts:377-387` (the `ordinate` axis-x/else block)
- Test: `packages/app/src/drawing/__tests__/renderDrawingDxf.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
  it('DXF-NDIM-ORDINATE-1: ordinate dimension → DIMENSION entity (type 6) + block', () => {
    const sheet = makeSheet({
      views: [{
        id: 'v1', kind: 'base', positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'o0', kind: 'outline', points: [[0, 0], [0, 10]] as ReadonlyArray<readonly [number, number]> },
            { id: 'f1', kind: 'outline', points: [[25, 0], [25, 10]] as ReadonlyArray<readonly [number, number]> },
          ],
          hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 25, maxY: 10 },
        },
      }],
      dimensionGroups: [{
        kind: 'ordinate', id: 'og1', viewId: 'v1',
        origin: { kind: 'edge-endpoint', edgeId: 'o0', end: 'start' },
        xColumnOffsetMm: -10, yColumnOffsetMm: 10,
      }],
      dimensions: [{
        kind: 'ordinate', id: 'od1', viewId: 'v1', groupId: 'og1', axis: 'x',
        to: { kind: 'edge-endpoint', edgeId: 'f1', end: 'start' },
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(out).toContain('DIMENSION');
    expect(out).toMatch(/\*D\d+/);
    // group-70 value for X-ordinate = 6 | 64 = 70
    const lines = out.split('\n');
    const dimIdx = lines.findIndex((l) => l.trim() === 'DIMENSION');
    const block = lines.slice(dimIdx, dimIdx + 30).join('\n');
    expect(block).toMatch(/ 70\n\s*70/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingDxf.spec.ts -t DXF-NDIM-ORDINATE-1`
Expected: FAIL — no `DIMENSION` entity.

- [ ] **Step 3: Write minimal implementation**

Replace the ordinate `if (dim.axis === 'x') { ... } else { ... } return;` block (renderDrawingDxf.ts:377-388) with:

```typescript
    if (dim.axis === 'x') {
      const colSvgY = soy + group.xColumnOffsetMm;
      const blockName = doc.block(() => {
        doc.polyline('DIMENSIONS', [[tx3, flipY(sty3)], [tx3, flipY(colSvgY)]]);
        doc.polyline('DIMENSIONS', [[tx3, flipY(colSvgY)], [ox2, flipY(colSvgY)]]);
        doc.text('DIMENSIONS', ox2 - 1, flipY(colSvgY - 1), 3.5, label3);
      });
      doc.dimension({
        layer: 'DIMENSIONS', blockName, dimStyle: 'STANDARD', dimType: 6 + 64,
        defPoint: [ox2, flipY(soy)], textMid: [ox2 - 1, flipY(colSvgY - 1)],
        text: label3,
        extraPoints: [[13, tx3, flipY(sty3)], [14, ox2, flipY(colSvgY)]],
      });
    } else {
      const colSvgX = ox2 + group.yColumnOffsetMm;
      const blockName = doc.block(() => {
        doc.polyline('DIMENSIONS', [[tx3, flipY(sty3)], [colSvgX, flipY(sty3)]]);
        doc.polyline('DIMENSIONS', [[colSvgX, flipY(sty3)], [colSvgX, flipY(soy)]]);
        doc.text('DIMENSIONS', colSvgX + 1, flipY(soy - 1), 3.5, label3);
      });
      doc.dimension({
        layer: 'DIMENSIONS', blockName, dimStyle: 'STANDARD', dimType: 6,
        defPoint: [ox2, flipY(soy)], textMid: [colSvgX + 1, flipY(soy - 1)],
        text: label3,
        extraPoints: [[13, tx3, flipY(sty3)], [14, colSvgX, flipY(sty3)]],
      });
    }
    return;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingDxf.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/renderDrawingDxf.ts packages/app/src/drawing/__tests__/renderDrawingDxf.spec.ts
git commit -m "feat(dxf-native-dim): ordinate dims export as native DIMENSION + block"
```

---

## Task 7: renderDrawingDxf — angular → native DIMENSION

**Files:**
- Modify: `packages/app/src/drawing/renderDrawingDxf.ts:429-433` (arc branch) and `:467-470` (two-edges branch)
- Test: `packages/app/src/drawing/__tests__/renderDrawingDxf.spec.ts`

> Angular def-point regen fidelity is best-effort (the block guarantees correct *display*; regen-correctness for angular is the weakest and is covered by the manual-smoke caveat). Emit a minimal valid DIMENSION: type + block + dimstyle + defPoint (vertex/center) + textMid + text.

- [ ] **Step 1: Write the failing test**

```typescript
  it('DXF-NDIM-ANGULAR-1: angular (two-edges) dimension → DIMENSION entity (type 2) + block', () => {
    const sheet = makeSheet({
      views: [{
        id: 'v1', kind: 'base', positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'g1', kind: 'outline', points: [[0, 0], [20, 0]] as ReadonlyArray<readonly [number, number]> },
            { id: 'g2', kind: 'outline', points: [[0, 0], [0, 20]] as ReadonlyArray<readonly [number, number]> },
          ],
          hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
        },
      }],
      dimensions: [{
        kind: 'angular', id: 'an1', viewId: 'v1',
        ref: { kind: 'two-edges',
          edge1: { viewId: 'v1', edgeId: 'g1' },
          edge2: { viewId: 'v1', edgeId: 'g2' } },
        arcSide: 'inside', offsetMm: 8,
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(out).toContain('DIMENSION');
    expect(out).toMatch(/\*D\d+/);
    const lines = out.split('\n');
    const dimIdx = lines.findIndex((l) => l.trim() === 'DIMENSION');
    const block = lines.slice(dimIdx, dimIdx + 30).join('\n');
    expect(block).toMatch(/ 70\n\s*2/);   // angular type 2
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingDxf.spec.ts -t DXF-NDIM-ANGULAR-1`
Expected: FAIL — no `DIMENSION` entity.

- [ ] **Step 3: Write minimal implementation**

(a) Arc branch — replace lines 429-434:

```typescript
      const blockName = doc.block(() => {
        doc.polyline('DIMENSIONS', arcPts);
        const midA = startAngle + (dim.arcSide === 'outside' ? -1 : 1) * sweep / 2;
        const tx4 = vx + (ccx + (arcR + 1.5) * Math.cos(midA)) * vScale;
        const sy4 = vy + (ccy + (arcR + 1.5) * Math.sin(midA)) * vScale;
        doc.text('DIMENSIONS', tx4, flipY(sy4), 3.5, formatAngleDeg(sweep));
      });
      const midA = startAngle + (dim.arcSide === 'outside' ? -1 : 1) * sweep / 2;
      const tx4 = vx + (ccx + (arcR + 1.5) * Math.cos(midA)) * vScale;
      const sy4 = vy + (ccy + (arcR + 1.5) * Math.sin(midA)) * vScale;
      doc.dimension({
        layer: 'DIMENSIONS', blockName, dimStyle: 'STANDARD', dimType: 5,
        defPoint: [vx + ccx * vScale, flipY(vy + ccy * vScale)],
        textMid: [tx4, flipY(sy4)],
        text: formatAngleDeg(sweep),
      });
      return;
```

(b) Two-edges branch — replace lines 467-470 (the trailing `doc.polyline(...)` + `doc.text(...)`):

```typescript
    const blockName = doc.block(() => {
      doc.polyline('DIMENSIONS', arcPts2);
      const midA2b = startAngle2 + sweepSign * sweepRad / 2;
      const textR2b = (dim.offsetMm + 1.5) * vScale;
      doc.text('DIMENSIONS', apexSvgX + textR2b * Math.cos(midA2b), flipY(apexSvgY + textR2b * Math.sin(midA2b)), 3.5, formatAngleDeg(sweepRad));
    });
    const midA2 = startAngle2 + sweepSign * sweepRad / 2;
    const textR2 = (dim.offsetMm + 1.5) * vScale;
    doc.dimension({
      layer: 'DIMENSIONS', blockName, dimStyle: 'STANDARD', dimType: 2,
      defPoint: [apexSvgX, flipY(apexSvgY)],
      textMid: [apexSvgX + textR2 * Math.cos(midA2), flipY(apexSvgY + textR2 * Math.sin(midA2))],
      text: formatAngleDeg(sweepRad),
    });
```

(Remove the original `const midA2 = ...; const textR2 = ...; doc.text(...)` lines 468-470 that are now superseded — verify no duplicate `const midA2`/`textR2` remains.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingDxf.spec.ts`
Expected: PASS — DXF-NDIM-ANGULAR-1 green + all earlier DXF-* green.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/renderDrawingDxf.ts packages/app/src/drawing/__tests__/renderDrawingDxf.spec.ts
git commit -m "feat(dxf-native-dim): angular dims export as native DIMENSION + block"
```

---

## Task 8: e2e T-6-26 — multi-kind native dims, real Chromium parse-back

**Files:**
- Create: `tests/e2e/drawing/T-6-26-dxf-native-dim.spec.ts`

> Build on the T-6-22 pattern (box part → drawing → base view → linear-h dim → Export DXF → parse-back). T-6-26 adds the native-DIMENSION assertions T-6-22 lacks: a `DIMENSION` entity on the `DIMENSIONS` layer, an anonymous `*D` block defined, and the block referenced by the dimension. Reuse the `parseDxf` helper and the `__zilventorStore` / `buildBox` / `waitForKernelReady` helpers exactly as T-6-22 does.

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/drawing/T-6-26-dxf-native-dim.spec.ts`. Copy the structure of `tests/e2e/drawing/T-6-22-dxf-export.spec.ts` verbatim through Step 11 (build box → save OPFS `parts/src-T626.zipt` → CreateDrawingCommand → AddBaseViewCommand → AddDrawingDimensionCommand linear-h → restore activePart stub → switch to Drawing tab → stub showSaveFilePicker → click "Export DXF" → capture download → read text → `parseDxf`). Then replace the Step-13 assertion block with:

```typescript
  // ─── Native DIMENSION assertions ──────────────────────────────────────────
  const code0Values = pairs.filter(([c]) => c === 0).map(([, v]) => v);

  // 4 sections still (HEADER, TABLES, BLOCKS, ENTITIES) — BLOCKS now non-empty
  expect(code0Values.filter((v) => v === 'SECTION').length).toBe(4);
  expect(code0Values.filter((v) => v === 'ENDSEC').length).toBe(4);

  // DIMSTYLE table present
  expect(dxfText, 'DIMSTYLE table must be defined').toContain('DIMSTYLE');
  expect(dxfText, 'STANDARD dim style').toContain('STANDARD');

  // ≥1 DIMENSION entity on the DIMENSIONS layer
  let dimEntityCount = 0;
  const dimBlockNames: string[] = [];
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i]![0] === 0 && pairs[i]![1] === 'DIMENSION') {
      let layer = ''; let blk = '';
      for (let j = i + 1; j < Math.min(i + 12, pairs.length); j++) {
        if (pairs[j]![0] === 0) break;
        if (pairs[j]![0] === 8) layer = pairs[j]![1];
        if (pairs[j]![0] === 2) blk = pairs[j]![1];
      }
      if (layer === 'DIMENSIONS') { dimEntityCount++; if (blk) dimBlockNames.push(blk); }
    }
  }
  console.log('[T-6-26] DIMENSION entities on DIMENSIONS:', dimEntityCount, 'block refs:', dimBlockNames);
  expect(dimEntityCount, 'Must emit ≥1 native DIMENSION entity on DIMENSIONS layer').toBeGreaterThan(0);

  // ≥1 anonymous *D block defined, and the DIMENSION's block ref resolves to a defined BLOCK
  const blockNamesDefined: string[] = [];
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i]![0] === 0 && pairs[i]![1] === 'BLOCK') {
      for (let j = i + 1; j < Math.min(i + 8, pairs.length); j++) {
        if (pairs[j]![0] === 2) { blockNamesDefined.push(pairs[j]![1]); break; }
      }
    }
  }
  console.log('[T-6-26] BLOCK defs:', blockNamesDefined);
  expect(blockNamesDefined.some((n) => /^\*D\d+$/.test(n)), 'Must define ≥1 anonymous *D block').toBe(true);
  expect(dimBlockNames.every((ref) => blockNamesDefined.includes(ref)),
    `Every DIMENSION block ref must resolve to a defined BLOCK. refs=${dimBlockNames} defined=${blockNamesDefined}`).toBe(true);

  // No console errors during export
  expect(consoleErrors, 'No browser console errors during native-dim DXF export').toHaveLength(0);
  console.log(`[T-6-26] PASSED: dimEntities=${dimEntityCount}, blocks=${blockNamesDefined.length}`);
```

(Keep T-6-22's `parseDxf`, console-error capture, `download.suggestedFilename()` `.dxf` check, and the `>500 chars` size guard.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:e2e -- tests/e2e/drawing/T-6-26-dxf-native-dim.spec.ts --project=chromium`
Expected (BEFORE Tasks 4-7 merged): FAIL — `dimEntityCount === 0`. (If run AFTER Tasks 4-7, it should PASS — that's the goal; this task is written so it is meaningful regardless. If implemented in order after Task 7, confirm it PASSES and prove teeth by temporarily reverting the Task-4 linear branch → FAIL → restore.)

- [ ] **Step 3: (no production change — e2e validates Tasks 1-7)**

If any assertion fails, debug per `superpowers:systematic-debugging`: read the browser console output the test prints, confirm the DXF text actually contains a `DIMENSION` entity, and check the block-ref resolution.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:e2e -- tests/e2e/drawing/T-6-26-dxf-native-dim.spec.ts --project=chromium`
Expected: PASS — dimEntities ≥ 1, *D block defined, refs resolve, console-clean.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/drawing/T-6-26-dxf-native-dim.spec.ts
git commit -m "test(dxf-native-dim): T-6-26 real-env native DIMENSION parse-back e2e"
```

---

## Task 9: perf T63n — dimension-heavy renderDrawingDxf probe

**Files:**
- Modify: `packages/app/src/App.tsx` (add `__zilventorRenderDxfDimsMs` probe + dimension-heavy fixture; add to cleanup `delete` block near line 3253)
- Create: `tests/perf/drawing-dxf-native-dim.perf.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/perf/drawing-dxf-native-dim.perf.spec.ts` (mirror `tests/perf/drawing-dxf.perf.spec.ts`):

```typescript
// tests/perf/drawing-dxf-native-dim.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf T63n — native-dimension DXF: renderDrawingDxf on a dimension-heavy sheet, p95 < 50ms.
 * Exercises the block() + dimension() native-DIMENSION path (T63k's fixture has no dimensions).
 */
test('T63n Perf: renderDrawingDxf (dimension-heavy) 30-iter p95 < 50ms', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorRenderDxfDimsMs?: unknown }).__zilventorRenderDxfDimsMs === 'function',
    undefined, { timeout: 30_000 },
  ).catch(() => { throw new Error('Perf wiring incomplete: window.__zilventorRenderDxfDimsMs is not a function. Wire it in App.tsx.'); });

  const p95 = await page.evaluate(
    () => (window as { __zilventorRenderDxfDimsMs?: (n: number) => number }).__zilventorRenderDxfDimsMs!(30),
  );
  console.log(`[perf] T63n renderDrawingDxf(dims) p95 = ${p95.toFixed(2)} ms (budget 50ms)`);
  expect(p95).toBeLessThan(50);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:perf -- tests/perf/drawing-dxf-native-dim.perf.spec.ts`
Expected: FAIL — `__zilventorRenderDxfDimsMs is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `App.tsx`, immediately after the `__zilventorRenderDxfMs` probe (ends ~line 2942) add a dimension-heavy fixture + probe. The fixture reuses `_drawing4Sheet`'s first sheet but injects 20 linear-h dimensions + a matching 2-edge view:

```typescript
    // T63n: dimension-heavy DXF render p95 < 50ms (exercises native DIMENSION + block path)
    w.__zilventorRenderDxfDimsMs = (n: number): number => {
      const baseSheet = _drawing4Sheet.sheets[0]!;
      const view = baseSheet.views[0]!;
      const edges = Array.from({ length: 21 }, (_, i) => ({
        id: `pe${i}`, kind: 'outline' as const,
        points: [[i * 5, 0], [i * 5, 60]] as ReadonlyArray<readonly [number, number]>,
      }));
      const dimsSheet: import('@zilventor/shared').DrawingSheet = {
        ...baseSheet,
        views: [{ ...view, projection: { visibleEdges: edges, hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 } } }],
        dimensions: Array.from({ length: 20 }, (_, i) => ({
          id: `pd${i}`, kind: 'linear-h' as const, viewId: view.id,
          from: { kind: 'edge-endpoint' as const, edgeId: `pe${i}`, end: 'start' as const },
          to:   { kind: 'edge-endpoint' as const, edgeId: `pe${i + 1}`, end: 'start' as const },
          offsetMm: 10 + i,
        })),
      };
      const dimsDrawing = { ..._drawing4Sheet, sheets: [dimsSheet] };
      const samples: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        _renderDrawingDxf(dimsDrawing, dimsSheet, _perfPart);
        samples.push(performance.now() - t0);
      }
      return _p95(samples);
    };
```

Then add to the dev-cleanup `delete` block (near line 3253, alongside `__zilventorRenderDxfMs`):

```typescript
      delete (w as unknown as { __zilventorRenderDxfDimsMs?: unknown }).__zilventorRenderDxfDimsMs;
```

(Confirm `_p95`, `_renderDrawingDxf`, `_drawing4Sheet`, `_perfPart` are all in scope at the insertion point — they are used by the adjacent `__zilventorRenderDxfMs` probe.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:perf -- tests/perf/drawing-dxf-native-dim.perf.spec.ts`
Expected: PASS — p95 < 50ms (pure JS string building; expect ≪ budget).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/App.tsx tests/perf/drawing-dxf-native-dim.perf.spec.ts
git commit -m "test(dxf-native-dim): T63n dimension-heavy renderDrawingDxf perf probe"
```

---

## Task 10: full-suite regression + typecheck + lint gate

**Files:** none (verification only)

- [ ] **Step 1: Typecheck all packages**

Run: `pnpm -r typecheck`
Expected: clean (all 5 packages "Done").

- [ ] **Step 2: Full app unit suite (catches whole-suite-only regressions)**

Run: `pnpm --filter app test:unit`
Expected: PASS. Pay special attention to:
- `renderDrawingDxf1to1.spec.ts` — the new DIMSTYLE table now appears in its TABLES output (additive); if any assertion counted exact TABLES content, update it.
- `dxfZip.spec.ts`, `ExportDrawingDxfCommand.spec.ts`, `ExportAllSheetsDxfCommand.spec.ts`, `ExportDrawing1to1DxfCommand.spec.ts`, `ExportAllSheets1to1DxfCommand.spec.ts` — should be unaffected; confirm green.
App test count should be ≥ 1814 (baseline) + new unit tests added in Tasks 1-7.

- [ ] **Step 3: Full repo unit gate**

Run: `pnpm -r test:unit 2>&1 | grep -E "Test Files|Tests" | tail -10`
Expected: 731 shared + 37 sketcher-worker + 347 kernel + (≥1814 +N) app, all passed.

- [ ] **Step 4: Regression e2e — T-6-22 must still pass unchanged**

Run: `pnpm test:e2e -- tests/e2e/drawing/T-6-22-dxf-export.spec.ts --project=chromium`
Expected: PASS. T-6-22 asserts exactly 4 sections (BLOCKS now non-empty but still ONE section), ≥1 POLYLINE on DIMENSIONS (block geometry counted by the whole-file parser), and vertex parity on VISIBLE/HIDDEN (untouched). If T-6-22 fails, STOP and diagnose before proceeding.

- [ ] **Step 5: Perf regression — T63k still green**

Run: `pnpm test:perf -- tests/perf/drawing-dxf.perf.spec.ts`
Expected: PASS (p95 < 50ms; fixture has no dims so cost is unchanged).

- [ ] **Step 6: Lint (run INSIDE the worktree, or after worktree cleanup)**

Run: `pnpm lint 2>&1 | tail -3`
Expected: 0 errors (warnings unchanged at baseline 16). NOTE: root `pnpm lint` does not ignore `.worktrees/`; if a worktree copy exists, grep error file paths to confirm none are from the worktree, or run lint after cleanup.

- [ ] **Step 7: No commit** (verification task). Proceed to `superpowers:finishing-a-development-branch`.

---

## Self-Review (against the spec)

**1. Spec coverage:**
- "native DIMENSION entity" → Tasks 3-7. ✓
- "anonymous *D block" → Task 2 (`block()`), used in Tasks 4-7. ✓
- "shared STANDARD DIMSTYLE" → Task 1. ✓
- in-scope kinds linear-h/v/aligned/baseline/ordinate/angular → Tasks 4/4/4/5/6/7. ✓
- stay R12, no manifest bump → no version/manifest change anywhere. ✓
- hatch/annotations/holetable/title unchanged → not touched. ✓
- radial/diametric out of scope → not touched (still dropped). ✓
- renderDrawingDxf1to1 untouched → not touched (only inherits DIMSTYLE table additively; verified in Task 10 Step 2). ✓
- TDD red→green → every task has red test + run-to-fail + green + commit. ✓
- e2e parse-back native DIMENSION → Task 8. ✓
- perf probe → Task 9 (T63n). ✓
- AutoCAD-open verification limitation → carried as the manual-smoke caveat in the spec; angular regen fidelity flagged in Task 7. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**3. Type consistency:** `block(build: () => void): string` and `dimension(opts: {...})` defined in Task 2 are used with identical shapes in Tasks 4-7. `dimType` is a plain number (flags pre-baked by caller: `6 + 64` for X-ordinate). `extraPoints` is `[code, x, y]` triples throughout. `'STANDARD'` dimstyle name matches Task 1's table entry. ✓

**4. Known residual risks (carried, not gaps):**
- Hand-rolled DIMENSION correctness has no AutoCAD round-trip here — covered by structural unit + parse-back e2e + the spec's manual-smoke caveat.
- `aligned` keeps its pre-existing vertical-geometry quirk (block display) while the DIMENSION uses type 1 + real def points — documented, surgical.
- Angular def-point regen fidelity is best-effort — documented in Task 7.
