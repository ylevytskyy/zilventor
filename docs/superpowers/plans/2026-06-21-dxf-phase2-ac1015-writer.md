# DXF M1 — Phase 2: Strict AC1015 writer + full native entity set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the hand-rolled R12 (AC1009) DXF writer to **strict AC1015** (handles, subclass markers, required tables/blocks, OBJECTS root dictionary) and add native `arc()`/`ellipse()`/`spline()`/`lwpolyline()` entity methods, migrating the angular-dimension picture to a native ARC, with the 3 existing exporters' golden/e2e tests deliberately rewritten to the AC1015 output.

**Architecture:** `createDxfDocument()` (`packages/app/src/drawing/dxfWriter.ts`) is rewritten in place. A handle allocator assigns every table record, block, and entity a unique group-`5` hex handle; `$HANDSEED` is computed at serialize time. Every entity carries `AcDbEntity` + `AcDb<Type>` subclass markers (group `100`) and a `330` owner ref to the `*Model_Space` BLOCK_RECORD. The 3 exporters keep their existing call sites (`line/polyline/circle/text/dimension/block`); only the angular dimension switches to the new `arc()`. The new `ellipse()/spline()/lwpolyline()` are covered by writer-unit + round-trip tests against the Phase-1 shared parser (`parseDxf`).

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vitest, Playwright (e2e). Pure string building — no kernel/OCCT, no new deps.

## Global Constraints

- **Writer location:** `packages/app/src/drawing/dxfWriter.ts` — the single `createDxfDocument()` builder, upgraded in place. All 3 exporters import it unchanged.
- **"Strict AC1015" means, exactly (the bounded target — "loads in AutoCAD 2000 without repair"):**
  - HEADER: `$ACADVER` = `AC1015`; `$HANDSEED` = (max allocated handle + 1) as uppercase hex.
  - A handle allocator: every table record, BLOCK, and ENTITY gets a unique group-`5` uppercase-hex handle (start at `0x100`).
  - Required TABLES: `VPORT`, `LTYPE`, `LAYER`, `STYLE`, `VIEW`, `UCS`, `APPID` (must contain `ACAD`), `DIMSTYLE`, `BLOCK_RECORD` (must contain `*Model_Space` and `*Paper_Space`). Each table and each record has a handle.
  - BLOCKS: `*Model_Space` and `*Paper_Space` block definitions present (even if empty); plus any anonymous picture blocks.
  - ENTITIES: each entity has group `5` handle, group `330` owner = the `*Model_Space` BLOCK_RECORD handle, `100`=`AcDbEntity` + `8`=layer, then `100`=`AcDb<Type>` + geometry.
  - OBJECTS: a minimal section with a root `DICTIONARY` (named-object dictionary) so AC1015 loads.
- **Strictness is NOT** a byte-perfect AutoCAD clone — VPORT/STYLE/etc. carry only the minimal required records. Do not over-build table contents beyond what loads.
- **Verification split:** automated gate = (a) structural strictness tests (every entity has a unique group-5 handle; `$HANDSEED` > every handle; every entity has `AcDbEntity` + an `AcDb<Type>` marker + a `330` owner; required tables/blocks/OBJECTS present) and (b) round-trip through the Phase-1 shared `parseDxf` (geometry preserved). Real AutoCAD-open is **human-gated** (noted in §6, not automated).
- **Regression gate:** the 3 exporters keep working; their golden + e2e tests are rewritten to AC1015 output as a deliberate, reviewed change — NOT silent drift. The underlay path and all Phase-1 shared-codec tests stay green untouched.
- `@zilventor/shared` stays zero-runtime-dep (writer lives in app, not shared). Strict TS `noUncheckedIndexedAccess`. Commit after each task. Branch `feat/dxf-support` (already checked out).
- Per-task verify: `pnpm --filter @zilventor/app test -- <spec>` for touched specs; `pnpm -r typecheck` 0-new where types change; the e2e task runs the named Playwright specs.

---

## File Structure

- Modify: `packages/app/src/drawing/dxfWriter.ts` — strict AC1015 rewrite + new entity methods (Tasks 1–7). Watch its size; if it grows past ~600 lines, note it (a future split of table-emission into a `dxfTables.ts` helper is reasonable but NOT required by this plan).
- Modify: `packages/app/src/drawing/renderDrawingDxf.ts:546-594` — angular-dim arc → native `arc()` (Task 4).
- Modify (test rewrites, Task 8): `dxfWriter.spec.ts`, `renderDrawingDxf.spec.ts`, `renderDrawingDxf1to1.spec.ts`, `renderBoringDxf.spec.ts`, and regenerate `__snapshots__/renderBoringDxf.dxf`.
- Modify (e2e, Task 9): `tests/e2e/drawing/T-6-22-dxf-export.spec.ts`, `T-6-24-dxf-1to1-export.spec.ts` (T-6-26 should stay green — verify only).
- Create (Task 10): `packages/app/src/drawing/__tests__/dxfWriter.ac1015.spec.ts` (strictness) and `packages/app/src/drawing/__tests__/dxfWriter.roundtrip.spec.ts` (writer→shared-parser round-trip).

---

### Task 1: Handle allocator + AC1015 HEADER/$HANDSEED + OBJECTS dictionary

**Files:**
- Modify: `packages/app/src/drawing/dxfWriter.ts`
- Test: `packages/app/src/drawing/__tests__/dxfWriter.ac1015.spec.ts` (create)

**Interfaces:**
- Produces: `createDxfDocument()` unchanged public method signatures (`line/polyline/circle/text/dimension/block/toString`), but its output is now AC1015. Internally it gains a handle allocator `nextHandle(): string` (uppercase hex, starting `'100'`) used by all records/entities. `$HANDSEED` is emitted in `toString()` as `(maxAllocated + 1).toString(16).toUpperCase()`.

This task establishes the handle machinery + the AC1015 HEADER and a minimal OBJECTS root dictionary, WITHOUT yet adding per-entity markers (Task 3) or new tables (Task 2). After this task, output is `AC1015` with `$HANDSEED` and a root dictionary; existing entities still emit (handles added to them here so $HANDSEED is meaningful).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/app/src/drawing/__tests__/dxfWriter.ac1015.spec.ts
import { describe, it, expect } from 'vitest';
import { createDxfDocument } from '../dxfWriter';

describe('dxfWriter AC1015 header', () => {
  it('declares AC1015 and a numeric $HANDSEED greater than every entity handle', () => {
    const doc = createDxfDocument();
    doc.line('VISIBLE', 0, 0, 10, 10);
    doc.circle('VISIBLE', 5, 5, 2);
    const out = doc.toString();

    expect(out).toContain('$ACADVER');
    expect(out).toContain('AC1015');
    expect(out).not.toContain('AC1009');

    // $HANDSEED present
    const seedMatch = /\$HANDSEED\n\s*5\n\s*([0-9A-F]+)/.exec(out);
    expect(seedMatch, 'has $HANDSEED').not.toBeNull();
    const seed = parseInt(seedMatch![1]!, 16);

    // every entity group-5 handle is unique and < seed
    const handles = [...out.matchAll(/\n\s*5\n\s*([0-9A-F]+)/g)].map((m) => parseInt(m[1]!, 16));
    expect(handles.length).toBeGreaterThan(0);
    expect(new Set(handles).size).toBe(handles.length); // unique
    for (const h of handles) expect(h).toBeLessThan(seed);
  });

  it('emits an OBJECTS section with a root DICTIONARY', () => {
    const out = createDxfDocument().toString();
    expect(out).toMatch(/\n\s*2\nOBJECTS\n/);
    expect(out).toContain('DICTIONARY');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/app test -- dxfWriter.ac1015.spec.ts`
Expected: FAIL — output still `AC1009`, no `$HANDSEED`, no OBJECTS/DICTIONARY.

- [ ] **Step 3: Implement**

In `dxfWriter.ts`: add a handle allocator and rework `toString()`. Concretely:

```typescript
// near the top of createDxfDocument(), replace the AC1009 header block.
let handleSeq = 0x100;
const nextHandle = (): string => (handleSeq++).toString(16).toUpperCase();
```

Replace the HEADER push with (note `$HANDSEED` is filled in `toString()` since it depends on the final `handleSeq`):

```typescript
// HEADER is assembled in toString() so $HANDSEED reflects all allocated handles.
```

Remove the old `header.push(... 'AC1009' ...)` lines; instead build HEADER inside `toString()`:

```typescript
    toString() {
      const headerSection = [
        '  0', 'SECTION', '  2', 'HEADER',
        '  9', '$ACADVER', '  1', 'AC1015',
        '  9', '$HANDSEED', '  5', (handleSeq).toString(16).toUpperCase(),
        '  0', 'ENDSEC',
      ];
      const classesSection = ['  0', 'SECTION', '  2', 'CLASSES', '  0', 'ENDSEC'];
      const objectsSection = [
        '  0', 'SECTION', '  2', 'OBJECTS',
        '  0', 'DICTIONARY', '  5', nextHandle(), '100', 'AcDbDictionary', ' 70', '     0',
        '  0', 'ENDSEC',
      ];
      // ...existing tables/blocks/ents assembled below, then:
      return [
        ...headerSection,
        ...classesSection,
        ...tables,
        ...blockSection,
        ...entSection,
        ...objectsSection,
        '  0', 'EOF',
      ].join('\n') + '\n';
    },
```

Give each existing entity a handle: in `line/polyline/circle/text/dimension`, push `'  5', nextHandle()` right after the entity type. (Full subclass markers come in Task 3; this task only adds the handle so `$HANDSEED` is correct.) Example for `line`:

```typescript
    line(layer, x1, y1, x2, y2, aci) {
      sink.push(
        '  0', 'LINE',
        '  5', nextHandle(),
        '  8', layer,
        ...(aci !== undefined ? [' 62', String(aci)] : []),
        ' 10', fmt(x1), ' 20', fmt(y1),
        ' 11', fmt(x2), ' 21', fmt(y2),
      );
    },
```

> Implementer note: `nextHandle()` is also called inside `toString()` for the dictionary AFTER all entity handles are allocated, so the dictionary handle is the largest and `$HANDSEED` (read as `handleSeq` at the end of building, BEFORE the dictionary `nextHandle`) must be computed to exceed ALL handles including the dictionary's. Simplest correct approach: allocate the OBJECTS dictionary handle FIRST inside `toString()` (before reading `handleSeq` for `$HANDSEED`), or compute `$HANDSEED` last. Order the `toString()` body so every `nextHandle()` call happens before the `$HANDSEED` value is read. Run the test to confirm `$HANDSEED` > all handles.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zilventor/app test -- dxfWriter.ac1015.spec.ts`
Expected: PASS (2 tests). (Other dxf specs WILL now fail on `AC1009` assertions — that's expected; Task 8 rewrites them. Do NOT fix them here.)

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/dxfWriter.ts packages/app/src/drawing/__tests__/dxfWriter.ac1015.spec.ts
git commit -m "feat(dxf): AC1015 header + handle allocator + OBJECTS dictionary

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Strict AC1015 TABLES (APPID + BLOCK_RECORD + handles)

**Files:**
- Modify: `packages/app/src/drawing/dxfWriter.ts`
- Test: `packages/app/src/drawing/__tests__/dxfWriter.ac1015.spec.ts`

**Interfaces:**
- Produces: a `*Model_Space` BLOCK_RECORD handle exposed internally as `modelSpaceHandle` (a stable string allocated once), consumed by Task 3's entity owner refs (group 330) and Task 1's blocks.

Upgrade the TABLES section to the required AC1015 set with handles. Keep the existing LTYPE/LAYER/DIMSTYLE content but add handles (group 5) to each table and record; add `VPORT`, `STYLE` (STANDARD), `VIEW` (empty), `UCS` (empty), `APPID` (ACAD), and `BLOCK_RECORD` (`*Model_Space`, `*Paper_Space`).

- [ ] **Step 1: Write the failing test**

```typescript
// append to dxfWriter.ac1015.spec.ts
describe('dxfWriter AC1015 tables', () => {
  it('emits the required AC1015 tables incl APPID ACAD and BLOCK_RECORD model/paper space', () => {
    const out = createDxfDocument().toString();
    for (const t of ['VPORT', 'LTYPE', 'LAYER', 'STYLE', 'VIEW', 'UCS', 'APPID', 'DIMSTYLE', 'BLOCK_RECORD']) {
      expect(out, `table ${t}`).toContain(t);
    }
    expect(out).toContain('ACAD');          // APPID record
    expect(out).toContain('*Model_Space');
    expect(out).toContain('*Paper_Space');
  });

  it('gives every LAYER record a handle', () => {
    const out = createDxfDocument().toString();
    // VISIBLE layer record followed (within a few lines) by a group-5 handle
    const layerBlock = out.slice(out.indexOf('LAYER'));
    expect(/\n\s*0\nLAYER\n\s*5\n\s*[0-9A-F]+/.test(layerBlock)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/app test -- dxfWriter.ac1015.spec.ts`
Expected: FAIL — VPORT/STYLE/VIEW/UCS/APPID/BLOCK_RECORD absent; LAYER records lack handles.

- [ ] **Step 3: Implement**

Rewrite the TABLES assembly in `dxfWriter.ts`. Allocate `modelSpaceHandle` once (`const modelSpaceHandle = nextHandle()` near the top, alongside `paperSpaceHandle`). Emit each table with a handle and each record with a handle. Full code (replace the existing `tables.push(...)` block):

```typescript
  const modelSpaceHandle = nextHandle();
  const paperSpaceHandle = nextHandle();

  // ...later, build TABLES (each TABLE + each record carries group-5 handle):
  tables.push('  0', 'SECTION', '  2', 'TABLES');

  // VPORT (one *Active viewport)
  tables.push('  0', 'TABLE', '  2', 'VPORT', '  5', nextHandle(), ' 70', '     1');
  tables.push('  0', 'VPORT', '  5', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbViewportTableRecord', '  2', '*Active', ' 70', '     0');
  tables.push('  0', 'ENDTAB');

  // LTYPE
  tables.push('  0', 'TABLE', '  2', 'LTYPE', '  5', nextHandle(), ' 70', '     3');
  tables.push('  0', 'LTYPE', '  5', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbLinetypeTableRecord', '  2', 'CONTINUOUS', ' 70', '     0', '  3', 'Solid line', ' 72', '    65', ' 73', '     0', ' 40', '0.0');
  tables.push('  0', 'LTYPE', '  5', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbLinetypeTableRecord', '  2', 'DASHED', ' 70', '     0', '  3', 'Dashed line', ' 72', '    65', ' 73', '     2', ' 40', '6.0', ' 49', '4.0', ' 49', '-2.0');
  tables.push('  0', 'ENDTAB');

  // LAYER
  tables.push('  0', 'TABLE', '  2', 'LAYER', '  5', nextHandle(), ' 70', `     ${LAYERS.length}`);
  for (const name of LAYERS) {
    const ltype = name === 'HIDDEN' ? 'DASHED' : 'CONTINUOUS';
    const color = name === 'HIDDEN' ? '     3' : '     7';
    tables.push('  0', 'LAYER', '  5', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbLayerTableRecord', '  2', name, ' 70', '     0', ' 62', color, '  6', ltype);
  }
  tables.push('  0', 'ENDTAB');

  // STYLE (STANDARD)
  tables.push('  0', 'TABLE', '  2', 'STYLE', '  5', nextHandle(), ' 70', '     1');
  tables.push('  0', 'STYLE', '  5', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbTextStyleTableRecord', '  2', 'STANDARD', ' 70', '     0', ' 40', '0.0', ' 41', '1.0', ' 50', '0.0', ' 71', '     0', ' 42', '2.5', '  3', 'txt', '  4', '');
  tables.push('  0', 'ENDTAB');

  // VIEW (empty)
  tables.push('  0', 'TABLE', '  2', 'VIEW', '  5', nextHandle(), ' 70', '     0', '  0', 'ENDTAB');
  // UCS (empty)
  tables.push('  0', 'TABLE', '  2', 'UCS', '  5', nextHandle(), ' 70', '     0', '  0', 'ENDTAB');

  // APPID (ACAD)
  tables.push('  0', 'TABLE', '  2', 'APPID', '  5', nextHandle(), ' 70', '     1');
  tables.push('  0', 'APPID', '  5', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbRegAppTableRecord', '  2', 'ACAD', ' 70', '     0');
  tables.push('  0', 'ENDTAB');

  // DIMSTYLE
  tables.push('  0', 'TABLE', '  2', 'DIMSTYLE', '  5', nextHandle(), ' 70', '     1');
  tables.push('  0', 'DIMSTYLE', '105', nextHandle(), '100', 'AcDbSymbolTableRecord', '100', 'AcDbDimStyleTableRecord', '  2', 'STANDARD', ' 70', '     0', '140', '3.5', ' 41', '2.5', '147', '0.625', ' 77', '     1', ' 73', '     0', ' 74', '     0');
  tables.push('  0', 'ENDTAB');

  // BLOCK_RECORD (*Model_Space, *Paper_Space)
  tables.push('  0', 'TABLE', '  2', 'BLOCK_RECORD', '  5', nextHandle(), ' 70', '     2');
  tables.push('  0', 'BLOCK_RECORD', '  5', modelSpaceHandle, '100', 'AcDbSymbolTableRecord', '100', 'AcDbBlockTableRecord', '  2', '*Model_Space');
  tables.push('  0', 'BLOCK_RECORD', '  5', paperSpaceHandle, '100', 'AcDbSymbolTableRecord', '100', 'AcDbBlockTableRecord', '  2', '*Paper_Space');
  tables.push('  0', 'ENDTAB');

  tables.push('  0', 'ENDSEC');
```

> Note: DIMSTYLE records use group `105` for their handle (not `5`) per the DXF spec — that's intentional and the strictness test counts group-5 handles, so DIMSTYLE's 105 won't collide. Keep it `105`.

Also update the BLOCKS section to emit `*Model_Space` and `*Paper_Space` block definitions (with handles + `AcDbEntity`/`AcDbBlockBegin`/`AcDbBlockEnd` markers) before the anonymous picture blocks. Add at the start of `blockSection` assembly in `toString()`:

```typescript
      const blockSection = [
        '  0', 'SECTION', '  2', 'BLOCKS',
        '  0', 'BLOCK', '  5', nextHandle(), '100', 'AcDbEntity', '  8', '0', '100', 'AcDbBlockBegin', '  2', '*Model_Space', ' 70', '     0', ' 10', '0.0', ' 20', '0.0', ' 30', '0.0', '  3', '*Model_Space', '  1', '',
        '  0', 'ENDBLK', '  5', nextHandle(), '100', 'AcDbEntity', '  8', '0', '100', 'AcDbBlockEnd',
        '  0', 'BLOCK', '  5', nextHandle(), '100', 'AcDbEntity', '  8', '0', '100', 'AcDbBlockBegin', '  2', '*Paper_Space', ' 70', '     0', ' 10', '0.0', ' 20', '0.0', ' 30', '0.0', '  3', '*Paper_Space', '  1', '',
        '  0', 'ENDBLK', '  5', nextHandle(), '100', 'AcDbEntity', '  8', '0', '100', 'AcDbBlockEnd',
        ...blockDefs,
        '  0', 'ENDSEC',
      ];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zilventor/app test -- dxfWriter.ac1015.spec.ts`
Expected: PASS (4 tests now).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/dxfWriter.ts packages/app/src/drawing/__tests__/dxfWriter.ac1015.spec.ts
git commit -m "feat(dxf): strict AC1015 tables (APPID, BLOCK_RECORD, handles)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Subclass markers + owner refs on existing entities

**Files:**
- Modify: `packages/app/src/drawing/dxfWriter.ts`
- Test: `packages/app/src/drawing/__tests__/dxfWriter.ac1015.spec.ts`

**Interfaces:**
- Consumes: `modelSpaceHandle` (Task 2), `nextHandle` (Task 1).
- Produces: every model-space entity emits `5`=handle, `330`=`modelSpaceHandle`, `100`=`AcDbEntity`, `8`=layer, then `100`=`AcDb<Type>` + geometry. Entities emitted INSIDE a `block(build)` use the block's record handle as owner (allocate a per-block BLOCK_RECORD or reuse `modelSpaceHandle` — see note).

Add the `330` owner + `100` subclass markers to `line`/`polyline`/`circle`/`text`/`dimension`. Map: LINE→`AcDbLine`; CIRCLE→`AcDbCircle`; TEXT→`AcDbText`; POLYLINE→`AcDb2dPolyline` (and each VERTEX→`AcDbVertex`+`AcDb2dVertex`); DIMENSION→`AcDbDimension` (+ the rotated/aligned subclass). 

- [ ] **Step 1: Write the failing test**

```typescript
// append to dxfWriter.ac1015.spec.ts
describe('dxfWriter AC1015 entity subclass markers', () => {
  it('LINE carries AcDbEntity + AcDbLine + a 330 owner', () => {
    const doc = createDxfDocument();
    doc.line('VISIBLE', 0, 0, 10, 10);
    const out = doc.toString();
    expect(out).toContain('AcDbLine');
    // the LINE entity block contains AcDbEntity, a 330 owner, and AcDbLine
    const lineSeg = out.slice(out.indexOf('\nLINE\n'));
    expect(lineSeg).toContain('AcDbEntity');
    expect(/\n\s*330\n/.test(lineSeg)).toBe(true);
  });

  it('CIRCLE→AcDbCircle, TEXT→AcDbText, POLYLINE→AcDb2dPolyline', () => {
    const doc = createDxfDocument();
    doc.circle('VISIBLE', 1, 1, 2);
    doc.text('ANNOTATIONS', 0, 0, 3, 'Hi');
    doc.polyline('VISIBLE', [[0, 0], [1, 1], [2, 0]]);
    const out = doc.toString();
    expect(out).toContain('AcDbCircle');
    expect(out).toContain('AcDbText');
    expect(out).toContain('AcDb2dPolyline');
    expect(out).toContain('AcDbVertex');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/app test -- dxfWriter.ac1015.spec.ts`
Expected: FAIL — no `AcDbLine`/`AcDbCircle`/etc. markers, no `330` owner.

- [ ] **Step 3: Implement**

Add a helper and rework each emitter. The owner is `modelSpaceHandle` for top-level entities; for entities emitted inside `block(build)`, track the current owner handle. Add owner tracking:

```typescript
  let currentOwner = modelSpaceHandle; // entities reference their owning block record
```

Rework `line` (others follow the same shape — handle, owner 330, AcDbEntity, layer, AcDb<Type>, geometry):

```typescript
    line(layer, x1, y1, x2, y2, aci) {
      sink.push(
        '  0', 'LINE',
        '  5', nextHandle(),
        '330', currentOwner,
        '100', 'AcDbEntity',
        '  8', layer,
        ...(aci !== undefined ? [' 62', String(aci)] : []),
        '100', 'AcDbLine',
        ' 10', fmt(x1), ' 20', fmt(y1), ' 30', '0.0',
        ' 11', fmt(x2), ' 21', fmt(y2), ' 31', '0.0',
      );
    },
```

`circle`:

```typescript
    circle(layer, cx, cy, r) {
      sink.push('  0', 'CIRCLE', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbCircle', ' 10', fmt(cx), ' 20', fmt(cy), ' 30', '0.0', ' 40', fmt(r));
    },
```

`text`:

```typescript
    text(layer, x, y, height, value, rotation = 0) {
      sink.push('  0', 'TEXT', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbText', ' 10', fmt(x), ' 20', fmt(y), ' 30', '0.0', ' 40', fmt(height), '  1', value, ' 50', fmt(rotation), '100', 'AcDbText');
    },
```

`polyline` (AcDb2dPolyline; each VERTEX gets AcDbVertex+AcDb2dVertex):

```typescript
    polyline(layer, points) {
      if (points.length < 2) return;
      sink.push('  0', 'POLYLINE', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDb2dPolyline', ' 66', '     1', ' 10', '0.0', ' 20', '0.0', ' 30', '0.0', ' 70', '     0');
      for (const [x, y] of points) {
        sink.push('  0', 'VERTEX', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbVertex', '100', 'AcDb2dVertex', ' 10', fmt(x), ' 20', fmt(y), ' 30', '0.0');
      }
      sink.push('  0', 'SEQEND', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer);
    },
```

`dimension`: add `'  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity'` after the type, keep `'  8', layer`, add `'100', 'AcDbDimension'` before the existing geometry, and `'100', 'AcDbAlignedDimension'` (or rotated) before the extra points. Keep the block-name (group 2) and dimstyle (group 3) references.

For `block(build)`: when entering, set `currentOwner` to a freshly allocated BLOCK_RECORD handle for that block, restore on exit. Simplest correct approach: allocate a block-record handle per anonymous block and add it to the BLOCK_RECORD table — OR (acceptable for picture blocks) keep `currentOwner = modelSpaceHandle` for block contents. Use the simpler `modelSpaceHandle` owner for anonymous picture-block contents and note it; the picture blocks are referenced by DIMENSION's group-2, which is what matters for rendering.

> Implementer note: the TEXT emitter shows `AcDbText` twice (the second `100 AcDbText` is the text-specific subclass after the alignment group) — this matches the DXF spec for TEXT. Verify against the round-trip test in Task 10; if the shared parser or AutoCAD objects, drop the trailing one.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zilventor/app test -- dxfWriter.ac1015.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/dxfWriter.ts packages/app/src/drawing/__tests__/dxfWriter.ac1015.spec.ts
git commit -m "feat(dxf): AcDb subclass markers + owner refs on entities

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: native arc() + migrate angular dimension to native ARC

**Files:**
- Modify: `packages/app/src/drawing/dxfWriter.ts` (add `arc`), `packages/app/src/drawing/renderDrawingDxf.ts:546-594`
- Test: `packages/app/src/drawing/__tests__/dxfWriter.ac1015.spec.ts`

**Interfaces:**
- Produces: `arc(layer: string, cx: number, cy: number, r: number, startDeg: number, endDeg: number): void` on `DxfDocument` — emits a native `ARC` entity (`AcDbCircle` + `AcDbArc`, group 50/51 in degrees).

- [ ] **Step 1: Write the failing test**

```typescript
// append to dxfWriter.ac1015.spec.ts
describe('dxfWriter arc()', () => {
  it('emits a native ARC entity with center/radius/angles in degrees', () => {
    const doc = createDxfDocument();
    doc.arc('VISIBLE', 30, 40, 15, 45, 135);
    const out = doc.toString();
    expect(out).toContain('\nARC\n');
    expect(out).toContain('AcDbArc');
    const seg = out.slice(out.indexOf('\nARC\n'));
    expect(seg).toMatch(/\n\s*50\n\s*45\.0000/);  // start angle deg
    expect(seg).toMatch(/\n\s*51\n\s*135\.0000/); // end angle deg
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/app test -- dxfWriter.ac1015.spec.ts`
Expected: FAIL — `doc.arc` is not a function / no ARC entity.

- [ ] **Step 3: Implement**

Add to the `DxfDocument` type:

```typescript
  /** Emit a native ARC entity. Angles in degrees (DXF group 50/51 convention). */
  arc(layer: string, cx: number, cy: number, r: number, startDeg: number, endDeg: number): void;
```

Add the method in the returned object:

```typescript
    arc(layer, cx, cy, r, startDeg, endDeg) {
      sink.push('  0', 'ARC', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbCircle', ' 10', fmt(cx), ' 20', fmt(cy), ' 30', '0.0', ' 40', fmt(r), '100', 'AcDbArc', ' 50', fmt(startDeg), ' 51', fmt(endDeg));
    },
```

In `renderDrawingDxf.ts:546-594`, replace the 32-segment POLYLINE tessellation of the angular-dimension arc with a single `doc.arc(layer, cx, cy, r, startDeg, endDeg)` call. Compute start/end degrees from the existing arc parameters (the code already has the center, radius, and the two angles it was sweeping for the tessellation — convert those to degrees, accounting for the Y-flip the surrounding code applies). Keep the dimension's text + extension lines unchanged.

> Implementer note: the existing tessellation worked in Y-flipped space. A native ARC's sweep is CCW from start to end; after a Y-flip the angle sense inverts. Verify the rendered arc spans the correct side by checking the round-trip/e2e — if the arc renders as the complementary sweep, swap start/end or negate the angles. The existing test `renderDrawingDxf.spec.ts` DXF-NDIM-ANGULAR-1 (around line 364) is your behavioral anchor; it will be updated in Task 8 but use it to confirm the geometry.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zilventor/app test -- dxfWriter.ac1015.spec.ts`
Expected: PASS. (renderDrawingDxf.spec.ts angular-dim assertions may now fail on the POLYLINE-vs-ARC change — Task 8 handles them.)

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/dxfWriter.ts packages/app/src/drawing/renderDrawingDxf.ts packages/app/src/drawing/__tests__/dxfWriter.ac1015.spec.ts
git commit -m "feat(dxf): native arc() + angular-dim uses native ARC

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: native ellipse()

**Files:** Modify `dxfWriter.ts`; Test `dxfWriter.ac1015.spec.ts`.

**Interfaces:**
- Produces: `ellipse(layer, cx, cy, majorX, majorY, ratio, startParam?, endParam?): void` — emits `ELLIPSE` (`AcDbEllipse`): center `10/20`, major-axis endpoint relative to center `11/21`, ratio `40`, start/end param `41/42` (radians; default 0 / 2π).

- [ ] **Step 1: Write the failing test**

```typescript
// append to dxfWriter.ac1015.spec.ts
describe('dxfWriter ellipse()', () => {
  it('emits a native ELLIPSE with center, major-axis vector, ratio, params', () => {
    const doc = createDxfDocument();
    doc.ellipse('VISIBLE', 5, 5, 10, 0, 0.5);
    const out = doc.toString();
    expect(out).toContain('\nELLIPSE\n');
    expect(out).toContain('AcDbEllipse');
    const seg = out.slice(out.indexOf('\nELLIPSE\n'));
    expect(seg).toMatch(/\n\s*40\n\s*0\.5000/);              // ratio
    expect(seg).toMatch(/\n\s*42\n\s*6\.2831/);              // default endParam 2π
  });
});
```

- [ ] **Step 2: Run** → FAIL (`doc.ellipse` not a function).
Run: `pnpm --filter @zilventor/app test -- dxfWriter.ac1015.spec.ts`

- [ ] **Step 3: Implement**

Add to the type:

```typescript
  /** Emit a native ELLIPSE. majorX/majorY are the major-axis endpoint RELATIVE to center; ratio = minor/major; params in radians. */
  ellipse(layer: string, cx: number, cy: number, majorX: number, majorY: number, ratio: number, startParam?: number, endParam?: number): void;
```

```typescript
    ellipse(layer, cx, cy, majorX, majorY, ratio, startParam = 0, endParam = 2 * Math.PI) {
      sink.push('  0', 'ELLIPSE', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbEllipse', ' 10', fmt(cx), ' 20', fmt(cy), ' 30', '0.0', ' 11', fmt(majorX), ' 21', fmt(majorY), ' 31', '0.0', ' 40', fmt(ratio), ' 41', fmt(startParam), ' 42', fmt(endParam));
    },
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(dxf): native ellipse() entity` (+ Co-Authored-By trailer).

---

### Task 6: native spline()

**Files:** Modify `dxfWriter.ts`; Test `dxfWriter.ac1015.spec.ts`.

**Interfaces:**
- Produces: `spline(layer, controlPoints: ReadonlyArray<{x:number;y:number}>, degree: number, closed: boolean): void` — emits `SPLINE` (`AcDbSpline`): flags `70` (bit0 closed, bit3 planar=8 typical → use `(closed?1:0) | 8`), degree `71`, knot count `72`, control-point count `73`, a clamped uniform knot vector (group `40` repeated), and control points (`10/20`).

- [ ] **Step 1: Write the failing test**

```typescript
// append to dxfWriter.ac1015.spec.ts
describe('dxfWriter spline()', () => {
  it('emits a native SPLINE with degree, control points, and a knot vector', () => {
    const doc = createDxfDocument();
    doc.spline('VISIBLE', [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 3, y: 0 }], 2, false);
    const out = doc.toString();
    expect(out).toContain('\nSPLINE\n');
    expect(out).toContain('AcDbSpline');
    const seg = out.slice(out.indexOf('\nSPLINE\n'));
    expect(seg).toMatch(/\n\s*71\n\s*2/);  // degree 2
    expect(seg).toMatch(/\n\s*73\n\s*3/);  // 3 control points
    expect((seg.match(/\n\s*40\n/g) ?? []).length).toBeGreaterThanOrEqual(1); // knots present
  });
});
```

- [ ] **Step 2: Run** → FAIL.
Run: `pnpm --filter @zilventor/app test -- dxfWriter.ac1015.spec.ts`

- [ ] **Step 3: Implement**

Add to the type:

```typescript
  /** Emit a native SPLINE from control points. Generates a clamped uniform knot vector. */
  spline(layer: string, controlPoints: ReadonlyArray<{ x: number; y: number }>, degree: number, closed: boolean): void;
```

```typescript
    spline(layer, controlPoints, degree, closed) {
      const n = controlPoints.length;
      const deg = Math.min(degree, Math.max(1, n - 1));
      // clamped uniform knot vector: (deg+1) zeros, ascending interior, (deg+1) of max
      const knotCount = n + deg + 1;
      const interior = knotCount - 2 * (deg + 1);
      const knots: number[] = [];
      for (let i = 0; i <= deg; i++) knots.push(0);
      for (let i = 1; i <= interior; i++) knots.push(i);
      for (let i = 0; i <= deg; i++) knots.push(interior + 1);
      const flags = (closed ? 1 : 0) | 8; // 8 = planar
      sink.push('  0', 'SPLINE', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbSpline',
        ' 70', `     ${flags}`, ' 71', `     ${deg}`, ' 72', `     ${knots.length}`, ' 73', `     ${n}`);
      for (const k of knots) sink.push(' 40', fmt(k));
      for (const p of controlPoints) sink.push(' 10', fmt(p.x), ' 20', fmt(p.y), ' 30', '0.0');
    },
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(dxf): native spline() entity` (+ trailer).

---

### Task 7: native lwpolyline()

**Files:** Modify `dxfWriter.ts`; Test `dxfWriter.ac1015.spec.ts`.

**Interfaces:**
- Produces: `lwpolyline(layer, points: ReadonlyArray<{x:number;y:number;bulge?:number}>, closed: boolean): void` — emits `LWPOLYLINE` (`AcDbPolyline`): vertex count `90`, flag `70` (bit0 closed), per-vertex `10/20` and optional `42` bulge.

- [ ] **Step 1: Write the failing test**

```typescript
// append to dxfWriter.ac1015.spec.ts
describe('dxfWriter lwpolyline()', () => {
  it('emits a native LWPOLYLINE with vertex count, closed flag, and bulge', () => {
    const doc = createDxfDocument();
    doc.lwpolyline('VISIBLE', [{ x: 0, y: 0, bulge: 0.5 }, { x: 10, y: 0 }, { x: 10, y: 10 }], true);
    const out = doc.toString();
    expect(out).toContain('\nLWPOLYLINE\n');
    expect(out).toContain('AcDbPolyline');
    const seg = out.slice(out.indexOf('\nLWPOLYLINE\n'));
    expect(seg).toMatch(/\n\s*90\n\s*3/);   // 3 vertices
    expect(seg).toMatch(/\n\s*70\n\s*1/);   // closed
    expect(seg).toMatch(/\n\s*42\n\s*0\.5000/); // bulge on first vertex
  });
});
```

- [ ] **Step 2: Run** → FAIL.
Run: `pnpm --filter @zilventor/app test -- dxfWriter.ac1015.spec.ts`

- [ ] **Step 3: Implement**

Add to the type:

```typescript
  /** Emit a native LWPOLYLINE. Optional per-vertex bulge for arc segments. */
  lwpolyline(layer: string, points: ReadonlyArray<{ x: number; y: number; bulge?: number }>, closed: boolean): void;
```

```typescript
    lwpolyline(layer, points, closed) {
      if (points.length < 2) return;
      sink.push('  0', 'LWPOLYLINE', '  5', nextHandle(), '330', currentOwner, '100', 'AcDbEntity', '  8', layer, '100', 'AcDbPolyline',
        ' 90', `     ${points.length}`, ' 70', `     ${closed ? 1 : 0}`);
      for (const p of points) {
        sink.push(' 10', fmt(p.x), ' 20', fmt(p.y));
        if (p.bulge !== undefined && p.bulge !== 0) sink.push(' 42', fmt(p.bulge));
      }
    },
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(dxf): native lwpolyline() entity` (+ trailer).

---

### Task 8: Rewrite unit goldens to AC1015

**Files:**
- Modify: `dxfWriter.spec.ts`, `renderDrawingDxf.spec.ts`, `renderDrawingDxf1to1.spec.ts`, `renderBoringDxf.spec.ts`
- Regenerate: `packages/app/src/drawing/__tests__/__snapshots__/renderBoringDxf.dxf`

**Interfaces:** none (test-only).

The writer is now AC1015. Update the broken assertions deliberately — this is the reviewed regression gate. Specifically:
- Replace every `expect(out).toContain('AC1009')` with `expect(out).toContain('AC1015')` (and any `expect(out).not.toContain('AC1015')` style inversions).
  Locations from the audit: `renderDrawingDxf.spec.ts:41,112`; `renderDrawingDxf1to1.spec.ts:112`; `renderBoringDxf.spec.ts:70`.
- `dxfWriter.spec.ts` DXF-ENT-2 (vertex-count==3): POLYLINE still emits 3 VERTEX entities, but the structural matcher may now also see VERTEX in *Model_Space blocks — re-scope the count to the ENTITIES section or assert `>=3`. Keep the assertion meaningful (don't make it vacuous).
- `renderDrawingDxf.spec.ts` angular-dim test (DXF-NDIM-ANGULAR-1, ~line 364): the picture is now a native `ARC`, not a 32-seg POLYLINE inside the block. Update the assertion to expect an `ARC` entity with the correct center/radius/angles instead of polyline coordinates.
- Regenerate the boring snapshot: run the boring spec with snapshot update so `renderBoringDxf.dxf` reflects AC1015 output.
  Run: `pnpm --filter @zilventor/app test -- renderBoringDxf.spec.ts -u`
  Then INSPECT the regenerated `renderBoringDxf.dxf`: confirm it starts with `AC1015`, has handles + `AcDbCircle`/`AcDbPolyline` markers, and is otherwise the same geometry (same circles/outline). Don't accept a snapshot you haven't eyeballed.

- [ ] **Step 1: Establish the failing baseline**
Run: `pnpm --filter @zilventor/app test -- dxfWriter.spec.ts renderDrawingDxf.spec.ts renderDrawingDxf1to1.spec.ts renderBoringDxf.spec.ts`
Expected: multiple failures on `AC1009`, the angular-dim polyline, and the boring snapshot. Record them.

- [ ] **Step 2: Update the assertions** (apply the changes above; for each `AC1009`→`AC1015`, for the angular-dim ARC, for the vertex-count rescope).

- [ ] **Step 3: Regenerate + inspect the boring snapshot**
Run: `pnpm --filter @zilventor/app test -- renderBoringDxf.spec.ts -u`
Then read `__snapshots__/renderBoringDxf.dxf` and confirm AC1015 + markers + same geometry.

- [ ] **Step 4: Run all four specs green**
Run: `pnpm --filter @zilventor/app test -- dxfWriter.spec.ts renderDrawingDxf.spec.ts renderDrawingDxf1to1.spec.ts renderBoringDxf.spec.ts`
Expected: PASS (all four), assertions now AC1015.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/__tests__/
git commit -m "test(dxf): rewrite exporter goldens to AC1015 output

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Fix DXF export e2e for AC1015 + native ARC

**Files:**
- Modify: `tests/e2e/drawing/T-6-22-dxf-export.spec.ts`, `tests/e2e/drawing/T-6-24-dxf-1to1-export.spec.ts`
- Verify (expect green, no change): `tests/e2e/drawing/T-6-26-dxf-native-dim.spec.ts`

**Interfaces:** none (e2e tests).

- `T-6-24` line 258: `AC1009` → `AC1015`.
- `T-6-22` "GAP 2" vertex parity (~lines 538–559): today it asserts VISIBLE+HIDDEN VERTEX count == sum of projected edge.points. The drawing VIEWS are still tessellated polylines (projector output) — so this parity HOLDS for view geometry. The angular-dim arc was NOT on VISIBLE/HIDDEN layers (it was on a dimensions/detail layer), so confirm whether the change affects the counted layers. If the parity still holds (views unchanged), leave it; if the native ARC removed counted vertices, adjust the expected sum and document why in a comment. Re-run to confirm.
- `T-6-26` native-dim: should be unaffected (DIMENSION structure unchanged) — run it to confirm green; if the added subclass markers changed block-name resolution, fix the assertion.

- [ ] **Step 1: Run the three e2e specs to see current state**
Run: `pnpm --filter @zilventor/app exec playwright test tests/e2e/drawing/T-6-22-dxf-export.spec.ts tests/e2e/drawing/T-6-24-dxf-1to1-export.spec.ts tests/e2e/drawing/T-6-26-dxf-native-dim.spec.ts`
Expected: T-6-24 fails on AC1009; T-6-22 maybe fails on vertex parity / section count; T-6-26 likely green.

- [ ] **Step 2: Update T-6-24 version assertion** (AC1009→AC1015).

- [ ] **Step 3: Reconcile T-6-22** — determine from the run whether vertex parity still holds; adjust expected sum only if the native ARC changed counted layers, with an explanatory comment. Keep section-count (4→ now there's also CLASSES + OBJECTS, so the section count assertion at ~line 426 `toBe(4)` MUST be updated to the new section count — count them: HEADER, CLASSES, TABLES, BLOCKS, ENTITIES, OBJECTS = 6). Update that assertion.

- [ ] **Step 4: Run all three green**
Run: `pnpm --filter @zilventor/app exec playwright test tests/e2e/drawing/T-6-22-dxf-export.spec.ts tests/e2e/drawing/T-6-24-dxf-1to1-export.spec.ts tests/e2e/drawing/T-6-26-dxf-native-dim.spec.ts`
Expected: PASS (all three, real Chromium).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/drawing/
git commit -m "test(e2e): DXF export e2e to AC1015 (sections, version, arc)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Strictness + round-trip integration tests

**Files:**
- Create: `packages/app/src/drawing/__tests__/dxfWriter.roundtrip.spec.ts`
- Modify (if needed): `packages/app/src/drawing/__tests__/dxfWriter.ac1015.spec.ts` (add the consolidated strictness invariants)

**Interfaces:**
- Consumes: `createDxfDocument` (writer) + `parseDxf` from `@zilventor/shared` (Phase-1 parser).

Round-trip proves the writer's native entities are readable: write each entity → `parseDxf` → assert geometry matches. Strictness asserts the structural invariants in one place.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/app/src/drawing/__tests__/dxfWriter.roundtrip.spec.ts
import { describe, it, expect } from 'vitest';
import { createDxfDocument } from '../dxfWriter';
import { parseDxf } from '@zilventor/shared';

describe('writer → shared parser round-trip', () => {
  it('ARC round-trips with degrees preserved', () => {
    const doc = createDxfDocument();
    doc.arc('VISIBLE', 30, 40, 15, 45, 135);
    const e = parseDxf(doc.toString()).entities.find((x) => x.type === 'ARC');
    expect(e).toBeDefined();
    if (e && e.type === 'ARC') {
      expect([e.cx, e.cy, e.r]).toEqual([30, 40, 15]);
      expect(e.startAngle).toBeCloseTo(45);
      expect(e.endAngle).toBeCloseTo(135);
    }
  });

  it('ELLIPSE round-trips center/major/ratio', () => {
    const doc = createDxfDocument();
    doc.ellipse('VISIBLE', 5, 5, 10, 0, 0.5);
    const e = parseDxf(doc.toString()).entities.find((x) => x.type === 'ELLIPSE');
    expect(e).toBeDefined();
    if (e && e.type === 'ELLIPSE') {
      expect([e.cx, e.cy, e.majorX, e.majorY]).toEqual([5, 5, 10, 0]);
      expect(e.ratio).toBeCloseTo(0.5);
    }
  });

  it('SPLINE round-trips degree + control points', () => {
    const doc = createDxfDocument();
    doc.spline('VISIBLE', [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 3, y: 0 }], 2, false);
    const e = parseDxf(doc.toString()).entities.find((x) => x.type === 'SPLINE');
    expect(e).toBeDefined();
    if (e && e.type === 'SPLINE') {
      expect(e.degree).toBe(2);
      expect(e.controlPoints.map((p) => [p.x, p.y])).toEqual([[0, 0], [1, 2], [3, 0]]);
    }
  });

  it('LWPOLYLINE round-trips vertices + bulge + closed', () => {
    const doc = createDxfDocument();
    doc.lwpolyline('VISIBLE', [{ x: 0, y: 0, bulge: 0.5 }, { x: 10, y: 0 }, { x: 10, y: 10 }], true);
    const e = parseDxf(doc.toString()).entities.find((x) => x.type === 'LWPOLYLINE');
    expect(e).toBeDefined();
    if (e && e.type === 'LWPOLYLINE') {
      expect(e.closed).toBe(true);
      expect(e.vertices.map((v) => [v.x, v.y])).toEqual([[0, 0], [10, 0], [10, 10]]);
      expect(e.vertices[0]!.bulge).toBeCloseTo(0.5);
    }
  });

  it('LINE/CIRCLE/TEXT still round-trip after the strict upgrade', () => {
    const doc = createDxfDocument();
    doc.line('VISIBLE', 0, 0, 10, 10);
    doc.circle('VISIBLE', 5, 5, 2);
    doc.text('ANNOTATIONS', 1, 2, 3, 'Hi');
    const r = parseDxf(doc.toString());
    expect(r.entities.find((x) => x.type === 'LINE')).toBeDefined();
    expect(r.entities.find((x) => x.type === 'CIRCLE')).toBeDefined();
    expect(r.entities.find((x) => x.type === 'TEXT')).toBeDefined();
  });
});

describe('AC1015 strictness invariants', () => {
  it('every ENTITIES-section entity has AcDbEntity + a 330 owner + a unique handle', () => {
    const doc = createDxfDocument();
    doc.line('VISIBLE', 0, 0, 1, 1);
    doc.circle('VISIBLE', 0, 0, 1);
    doc.arc('VISIBLE', 0, 0, 1, 0, 90);
    const out = doc.toString();
    const entSec = out.slice(out.indexOf('\nENTITIES\n'), out.indexOf('\nOBJECTS\n'));
    // Each of the three entity types present with an AcDbEntity marker in the entities section
    expect((entSec.match(/AcDbEntity/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((entSec.match(/\n\s*330\n/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // global handle uniqueness already covered in dxfWriter.ac1015.spec.ts
  });
});
```

- [ ] **Step 2: Run to verify failures (or surprises)**
Run: `pnpm --filter @zilventor/app test -- dxfWriter.roundtrip.spec.ts`
Expected: this is the integration check; if any entity does NOT round-trip, it reveals a real writer bug (e.g. ELLIPSE major-axis sign, SPLINE knot/degree mismatch) — fix the WRITER (not the parser, which is Phase-1 frozen). If all pass first try, that's a valid GREEN (the writer methods were built test-first in Tasks 4–7).

- [ ] **Step 3: Fix any writer bugs the round-trip surfaces** (in `dxfWriter.ts`), keeping Task 4–7 unit tests green.

- [ ] **Step 4: Full gate**
Run: `pnpm --filter @zilventor/app test -- dxfWriter` (all dxfWriter specs) `&& pnpm -r typecheck && pnpm lint`
Expected: all green; typecheck 0-new; lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/__tests__/dxfWriter.roundtrip.spec.ts packages/app/src/drawing/__tests__/dxfWriter.ac1015.spec.ts packages/app/src/drawing/dxfWriter.ts
git commit -m "test(dxf): writer→parser round-trip + AC1015 strictness invariants

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## §6 Verification (human-gated note)

After Task 10, the AC1015 output is structurally strict + round-trips through our own parser. **True AutoCAD-open is NOT automatable here** (no AutoCAD/Teigha in CI). Recommended manual check before the milestone ships: open an exported boring/drawing DXF in AutoCAD 2000+ (or a strict viewer like ODA File Converter / LibreCAD) and confirm it loads without "drawing recovery". Record the result in the milestone notes. This plan's automated gate is the strictness invariants + round-trip; do not claim AutoCAD compatibility as verified without the manual check.

## Phase 2 Definition of Done

- `createDxfDocument()` emits strict AC1015: `$ACADVER`/`$HANDSEED`, unique per-entity handles, required tables (incl. APPID + BLOCK_RECORD), `*Model_Space`/`*Paper_Space` blocks, OBJECTS root dictionary, and `AcDbEntity`+`AcDb<Type>` markers with `330` owners.
- Native `arc()`/`ellipse()`/`spline()`/`lwpolyline()` exist, unit-tested, and round-trip through the Phase-1 shared `parseDxf`.
- The angular dimension emits a native ARC (no 32-seg tessellation).
- All 3 exporters' goldens + the boring snapshot + the DXF e2e specs are rewritten to AC1015 and green. Phase-1 shared-codec + underlay tests stay green.
- `pnpm -r typecheck` 0-new, `pnpm lint` clean.

## Self-Review

- **Spec coverage:** Implements spec §4.5 + the 2026-06-21 Phase-2 decisions (strict AC1015; full native entity set). Strictness target is bounded in Global Constraints. Round-trip uses the Phase-1 parser (no new parser work). Exporter migration limited to the one real arc consumer (angular dim), matching the audit finding.
- **Placeholder scan:** none — every code step carries complete code; implementer notes (Y-flip angle sense in Task 4, double-AcDbText in Task 3, owner-handle simplification for picture blocks) accompany complete code and name the verification that resolves them.
- **Type consistency:** `arc/ellipse/spline/lwpolyline` signatures are consistent between their type declarations and round-trip call sites; `modelSpaceHandle`/`currentOwner`/`nextHandle` names are used consistently across Tasks 1–7; round-trip asserts against the Phase-1 `DxfEntity` field names (`startAngle`, `majorX`, `controlPoints`, `vertices[].bulge`) verified against the shipped parser.

## Risks / gotchas

- **Strict-format correctness is the main risk** — a missing required table/marker can make AutoCAD reject the file, and our own parser won't catch it (it's lenient). The structural-invariant tests are a proxy, not proof; the §6 manual check is the real gate.
- **Y-flip angle sense** for the native angular-dim ARC (Task 4) — the most likely behavioral bug; the e2e (Task 9) is the anchor.
- **SPLINE knot vector** must satisfy `count = n + degree + 1` or strict readers reject it (Task 6 generates a clamped uniform vector; round-trip + the knot-count check guard it).
- **Section count change** breaks `T-6-22`'s `toBe(4)` (now 6 with CLASSES+OBJECTS) — Task 9 updates it.
- Writer file growth — note if `dxfWriter.ts` exceeds ~600 lines; a `dxfTables.ts` split is reasonable later but out of this plan's scope.
