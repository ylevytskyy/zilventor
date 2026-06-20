# DXF M1 — Phase 1: Shared dependency-free DXF parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `dxf-parser` npm dependency with a hand-rolled, dependency-free DXF reader in `packages/shared/src/dxf/`, reroute the existing DXF-underlay import onto it, and remove the npm dep — with all existing underlay tests green.

**Architecture:** A pure tokenizer (`tokenize`) turns DXF text into `(code, value)` pairs; a sectioned parser (`parseDxf`) walks HEADER/TABLES/BLOCKS/ENTITIES and produces a discriminated-union `DxfEntity[]` AST plus a blocks map. `packages/app/src/drawing/parseDxfUnderlay.ts` is rewritten to map that AST onto the existing `UnderlayEntity` model. No behavior change to the underlay feature — its spec is the regression gate.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vitest, pnpm monorepo. `@zilventor/shared` is pure with **zero runtime dependencies** — this work must preserve that.

## Global Constraints

- `@zilventor/shared` MUST have **zero runtime `dependencies`** — the new codec is pure TS, no imports of any npm package.
- DXF angle convention: group codes **50/51 are degrees** in the raw file. The shared parser stores angles **in degrees** (no radian conversion). (The old `dxf-parser` returned radians; the reroute removes the `* RAD_TO_DEG` conversion accordingly.)
- TypeScript strict mode with `noUncheckedIndexedAccess`: index access yields `T | undefined` — guard or use `!` only when provably safe.
- Existing underlay tests are a hard regression gate: `packages/app/src/drawing/__tests__/parseDxfUnderlay.spec.ts` and `packages/app/src/commands/__tests__/ImportDxfUnderlayCommand.spec.ts` must stay green unmodified (except the deliberate angle-handling note, which they already assert in degrees).
- Commit after each task. Branch: `feat/dxf-support` (already checked out).
- Verify gate per task: `pnpm --filter @zilventor/shared test` and/or `pnpm --filter @zilventor/app test` for the touched package, plus `pnpm -r typecheck` 0-new at task end where types change.

---

## File Structure

- Create: `packages/shared/src/dxf/tokenizer.ts` — `tokenize(text) → DxfPair[]`.
- Create: `packages/shared/src/dxf/types.ts` — `DxfPair`, `DxfEntity` union, `ParsedDxf`.
- Create: `packages/shared/src/dxf/parser.ts` — `parseDxf(text) → ParsedDxf`.
- Create: `packages/shared/src/dxf/index.ts` — barrel for the codec.
- Create: `packages/shared/src/dxf/__tests__/tokenizer.spec.ts`.
- Create: `packages/shared/src/dxf/__tests__/parser.spec.ts`.
- Modify: `packages/shared/src/index.ts` — add `export * from './dxf';`.
- Modify: `packages/app/src/drawing/parseDxfUnderlay.ts` — rewrite to consume `parseDxf` (no `dxf-parser` import).
- Modify: `packages/app/package.json` — remove `dxf-parser` from `dependencies`.
- Delete/replace: `packages/app/src/drawing/__tests__/dxfParserSmoke.spec.ts` — replace with a shared-parser smoke (the old one tests the removed dep).

---

### Task 1: DXF tokenizer

**Files:**
- Create: `packages/shared/src/dxf/types.ts`
- Create: `packages/shared/src/dxf/tokenizer.ts`
- Test: `packages/shared/src/dxf/__tests__/tokenizer.spec.ts`

**Interfaces:**
- Produces: `type DxfPair = { code: number; value: string }` and `function tokenize(text: string): DxfPair[]`.

DXF ASCII is a flat list of two-line records: an integer group code line, then a value line. Lines may have leading/trailing whitespace (the existing fixtures pad codes like `'  0'` and `' 10'`). The tokenizer trims each line, parses the code as an int, and pairs it with the next (raw, untrimmed-value-but-line-trimmed) line. Non-integer code lines are skipped defensively (never throw).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared/src/dxf/__tests__/tokenizer.spec.ts
import { describe, it, expect } from 'vitest';
import { tokenize } from '../tokenizer';

describe('tokenize', () => {
  it('pairs each group code with its following value, trimming whitespace', () => {
    const text = ['  0', 'SECTION', '  2', 'ENTITIES', '  0', 'EOF'].join('\n');
    expect(tokenize(text)).toEqual([
      { code: 0, value: 'SECTION' },
      { code: 2, value: 'ENTITIES' },
      { code: 0, value: 'EOF' },
    ]);
  });

  it('handles CRLF line endings', () => {
    const text = '0\r\nLINE\r\n8\r\n0\r\n';
    expect(tokenize(text)).toEqual([
      { code: 0, value: 'LINE' },
      { code: 8, value: '0' },
    ]);
  });

  it('parses negative and multi-digit codes', () => {
    const text = ['100', 'AcDbEntity', '-3', 'x'].join('\n');
    expect(tokenize(text)).toEqual([
      { code: 100, value: 'AcDbEntity' },
      { code: -3, value: 'x' },
    ]);
  });

  it('returns empty array for empty input and never throws on garbage', () => {
    expect(tokenize('')).toEqual([]);
    expect(() => tokenize('not\na\n@@@\ndxf')).not.toThrow();
  });

  it('ignores a trailing code with no value line', () => {
    const text = ['  0', 'EOF', '  9'].join('\n');
    expect(tokenize(text)).toEqual([{ code: 0, value: 'EOF' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/shared test -- dxf/__tests__/tokenizer.spec.ts`
Expected: FAIL — `Cannot find module '../tokenizer'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/shared/src/dxf/types.ts
/** One DXF group-code / value record. */
export type DxfPair = { readonly code: number; readonly value: string };
```

```typescript
// packages/shared/src/dxf/tokenizer.ts
import type { DxfPair } from './types';

/**
 * Split raw DXF ASCII text into (code, value) pairs.
 * Each record is a group-code line followed by a value line. Lines are trimmed;
 * a non-integer code line is skipped (defensive — never throws). A trailing code
 * with no value line is dropped.
 */
export function tokenize(text: string): DxfPair[] {
  const lines = text.split('\n');
  const out: DxfPair[] = [];
  for (let i = 0; i + 1 < lines.length; ) {
    const codeStr = lines[i]!.trim();
    const code = Number.parseInt(codeStr, 10);
    if (!Number.isInteger(code) || codeStr === '' || /[^\d-]/.test(codeStr)) {
      i += 1;
      continue;
    }
    const value = lines[i + 1]!.trim();
    out.push({ code, value });
    i += 2;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zilventor/shared test -- dxf/__tests__/tokenizer.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/types.ts packages/shared/src/dxf/tokenizer.ts packages/shared/src/dxf/__tests__/tokenizer.spec.ts
git commit -m "feat(dxf): dependency-free DXF tokenizer in shared

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Parser skeleton + LINE + CIRCLE

**Files:**
- Modify: `packages/shared/src/dxf/types.ts`
- Create: `packages/shared/src/dxf/parser.ts`
- Test: `packages/shared/src/dxf/__tests__/parser.spec.ts`

**Interfaces:**
- Consumes: `tokenize` (Task 1).
- Produces:
  - `DxfEntity` union (extended across Tasks 2–6).
  - `type ParsedDxf = { entities: DxfEntity[]; blocks: Record<string, DxfEntity[]>; header: Record<string, string> }`.
  - `function parseDxf(text: string): ParsedDxf` — never throws; malformed input → `{ entities: [], blocks: {}, header: {} }`.

The parser walks the pair stream. A `0`-code pair starts a new entity (or section marker). Within an entity, subsequent non-`0` pairs are its attributes until the next `0`. We accumulate the "current entity's" pairs and flush them through a per-type reader on the next `0`. Sections are tracked by the `2`-code value after `0 SECTION`. ENTITIES go to `entities`; BLOCKS accumulate into the current block's entity list.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared/src/dxf/__tests__/parser.spec.ts
import { describe, it, expect } from 'vitest';
import { parseDxf } from '../parser';

function entitiesDxf(body: string): string {
  return ['  0', 'SECTION', '  2', 'ENTITIES', body.trim(), '  0', 'ENDSEC', '  0', 'EOF'].join('\n');
}

describe('parseDxf — LINE & CIRCLE', () => {
  it('parses a LINE entity with endpoints and layer', () => {
    const dxf = entitiesDxf(['  0', 'LINE', '  8', 'VISIBLE',
      ' 10', '5.0', ' 20', '10.0', ' 30', '0.0',
      ' 11', '15.0', ' 21', '25.0', ' 31', '0.0'].join('\n'));
    const r = parseDxf(dxf);
    expect(r.entities).toHaveLength(1);
    const e = r.entities[0]!;
    expect(e.type).toBe('LINE');
    if (e.type === 'LINE') {
      expect(e.layer).toBe('VISIBLE');
      expect([e.x1, e.y1, e.x2, e.y2]).toEqual([5, 10, 15, 25]);
    }
  });

  it('parses a CIRCLE entity with center and radius', () => {
    const dxf = entitiesDxf(['  0', 'CIRCLE', '  8', '0',
      ' 10', '50.0', ' 20', '60.0', ' 30', '0.0', ' 40', '7.5'].join('\n'));
    const r = parseDxf(dxf);
    const e = r.entities[0]!;
    expect(e.type).toBe('CIRCLE');
    if (e.type === 'CIRCLE') expect([e.cx, e.cy, e.r]).toEqual([50, 60, 7.5]);
  });

  it('defaults missing layer to "0" and skips unknown entity types', () => {
    const dxf = entitiesDxf(['  0', 'HATCH', ' 10', '1.0',
      '  0', 'LINE', ' 10', '0.0', ' 20', '0.0', ' 11', '1.0', ' 21', '1.0'].join('\n'));
    const r = parseDxf(dxf);
    expect(r.entities).toHaveLength(1);
    expect(r.entities[0]!.type).toBe('LINE');
    expect(r.entities[0]!.layer).toBe('0');
  });

  it('never throws on malformed input', () => {
    expect(() => parseDxf('garbage @@@')).not.toThrow();
    expect(parseDxf('garbage @@@').entities).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/shared test -- dxf/__tests__/parser.spec.ts`
Expected: FAIL — `Cannot find module '../parser'`.

- [ ] **Step 3: Write minimal implementation**

Add to `packages/shared/src/dxf/types.ts`:

```typescript
export type DxfEntity =
  | { type: 'LINE'; layer: string; x1: number; y1: number; x2: number; y2: number }
  | { type: 'CIRCLE'; layer: string; cx: number; cy: number; r: number };

export type ParsedDxf = {
  entities: DxfEntity[];
  blocks: Record<string, DxfEntity[]>;
  header: Record<string, string>;
};
```

```typescript
// packages/shared/src/dxf/parser.ts
import { tokenize } from './tokenizer';
import type { DxfPair, DxfEntity, ParsedDxf } from './types';

/** A raw entity record: its type plus a code→values multimap of its attribute pairs. */
type RawEntity = { type: string; pairs: DxfPair[] };

function num(pairs: DxfPair[], code: number, fallback = 0): number {
  const p = pairs.find((q) => q.code === code);
  if (!p) return fallback;
  const n = Number.parseFloat(p.value);
  return Number.isFinite(n) ? n : fallback;
}

function str(pairs: DxfPair[], code: number, fallback = ''): string {
  return pairs.find((q) => q.code === code)?.value ?? fallback;
}

function readEntity(raw: RawEntity): DxfEntity | null {
  const layer = str(raw.pairs, 8, '0');
  switch (raw.type) {
    case 'LINE':
      return { type: 'LINE', layer,
        x1: num(raw.pairs, 10), y1: num(raw.pairs, 20),
        x2: num(raw.pairs, 11), y2: num(raw.pairs, 21) };
    case 'CIRCLE':
      return { type: 'CIRCLE', layer,
        cx: num(raw.pairs, 10), cy: num(raw.pairs, 20), r: num(raw.pairs, 40) };
    default:
      return null;
  }
}

export function parseDxf(text: string): ParsedDxf {
  const result: ParsedDxf = { entities: [], blocks: {}, header: {} };
  let pairs: DxfPair[];
  try {
    pairs = tokenize(text);
  } catch {
    return result;
  }

  let section = '';
  let currentBlock: string | null = null;
  let raw: RawEntity | null = null;

  const flush = (): void => {
    if (!raw) return;
    const ent = readEntity(raw);
    if (ent) {
      if (section === 'BLOCKS' && currentBlock) {
        (result.blocks[currentBlock] ??= []).push(ent);
      } else if (section === 'ENTITIES') {
        result.entities.push(ent);
      }
    }
    raw = null;
  };

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i]!;
    if (p.code === 0) {
      flush();
      const kind = p.value;
      if (kind === 'SECTION') {
        const next = pairs[i + 1];
        section = next && next.code === 2 ? next.value : '';
        currentBlock = null;
      } else if (kind === 'ENDSEC') {
        section = '';
        currentBlock = null;
      } else if (kind === 'BLOCK') {
        raw = { type: '__BLOCK__', pairs: [] }; // header pairs collected below; name read on next BLOCK/ENDBLK
      } else if (kind === 'ENDBLK') {
        currentBlock = null;
      } else if (kind === 'EOF') {
        break;
      } else {
        raw = { type: kind, pairs: [] };
      }
    } else if (raw) {
      raw.pairs.push(p);
      if (raw.type === '__BLOCK__' && p.code === 2) {
        currentBlock = p.value;
        result.blocks[currentBlock] ??= [];
        raw = null; // block header consumed; following entities belong to this block
      }
    }
  }
  flush();
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zilventor/shared test -- dxf/__tests__/parser.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/types.ts packages/shared/src/dxf/parser.ts packages/shared/src/dxf/__tests__/parser.spec.ts
git commit -m "feat(dxf): DXF parser skeleton + LINE/CIRCLE entities

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: ARC + TEXT + MTEXT

**Files:**
- Modify: `packages/shared/src/dxf/types.ts`, `packages/shared/src/dxf/parser.ts`
- Test: `packages/shared/src/dxf/__tests__/parser.spec.ts`

**Interfaces:**
- Produces (added to `DxfEntity`):
  - `{ type: 'ARC'; layer; cx; cy; r; startAngle; endAngle }` — **angles in degrees** (raw group 50/51).
  - `{ type: 'TEXT'; layer; x; y; height; value; rotation }` — rotation in degrees.
  - `{ type: 'MTEXT'; layer; x; y; height; value; rotation }`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to parser.spec.ts
describe('parseDxf — ARC, TEXT, MTEXT', () => {
  it('parses an ARC with angles preserved in DEGREES (no radian conversion)', () => {
    const dxf = entitiesDxf(['  0', 'ARC', '  8', '0',
      ' 10', '30.0', ' 20', '40.0', ' 40', '15.0', ' 50', '45.0', ' 51', '135.0'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('ARC');
    if (e.type === 'ARC') {
      expect([e.cx, e.cy, e.r]).toEqual([30, 40, 15]);
      expect(e.startAngle).toBeCloseTo(45);
      expect(e.endAngle).toBeCloseTo(135);
    }
  });

  it('parses a TEXT entity (value, height, rotation in degrees)', () => {
    const dxf = entitiesDxf(['  0', 'TEXT', '  8', '0',
      ' 10', '20.0', ' 20', '30.0', ' 40', '5.0', '  1', 'Hello', ' 50', '15.0'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('TEXT');
    if (e.type === 'TEXT') {
      expect([e.x, e.y, e.height]).toEqual([20, 30, 5]);
      expect(e.value).toBe('Hello');
      expect(e.rotation).toBeCloseTo(15);
    }
  });

  it('parses an MTEXT entity using group 40 for height', () => {
    const dxf = entitiesDxf(['  0', 'MTEXT', '  8', '0',
      ' 10', '1.0', ' 20', '2.0', ' 40', '3.0', '  1', 'Multi', ' 50', '0.0'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('MTEXT');
    if (e.type === 'MTEXT') {
      expect([e.x, e.y, e.height]).toEqual([1, 2, 3]);
      expect(e.value).toBe('Multi');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/shared test -- dxf/__tests__/parser.spec.ts`
Expected: FAIL — ARC/TEXT/MTEXT entities not produced (entities[0] undefined / type mismatch).

- [ ] **Step 3: Write minimal implementation**

Add to `DxfEntity` union in `types.ts`:

```typescript
  | { type: 'ARC'; layer: string; cx: number; cy: number; r: number; startAngle: number; endAngle: number }
  | { type: 'TEXT'; layer: string; x: number; y: number; height: number; value: string; rotation: number }
  | { type: 'MTEXT'; layer: string; x: number; y: number; height: number; value: string; rotation: number }
```

Add cases to `readEntity` in `parser.ts` (before `default`):

```typescript
    case 'ARC':
      return { type: 'ARC', layer,
        cx: num(raw.pairs, 10), cy: num(raw.pairs, 20), r: num(raw.pairs, 40),
        startAngle: num(raw.pairs, 50), endAngle: num(raw.pairs, 51) };
    case 'TEXT':
      return { type: 'TEXT', layer,
        x: num(raw.pairs, 10), y: num(raw.pairs, 20), height: num(raw.pairs, 40),
        value: str(raw.pairs, 1), rotation: num(raw.pairs, 50) };
    case 'MTEXT':
      return { type: 'MTEXT', layer,
        x: num(raw.pairs, 10), y: num(raw.pairs, 20), height: num(raw.pairs, 40),
        value: str(raw.pairs, 1), rotation: num(raw.pairs, 50) };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zilventor/shared test -- dxf/__tests__/parser.spec.ts`
Expected: PASS (all parser tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/types.ts packages/shared/src/dxf/parser.ts packages/shared/src/dxf/__tests__/parser.spec.ts
git commit -m "feat(dxf): parse ARC (deg) + TEXT + MTEXT

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: LWPOLYLINE + POLYLINE (with bulge on vertices)

**Files:**
- Modify: `packages/shared/src/dxf/types.ts`, `packages/shared/src/dxf/parser.ts`
- Test: `packages/shared/src/dxf/__tests__/parser.spec.ts`

**Interfaces:**
- Produces (added to `DxfEntity`):
  - `{ type: 'LWPOLYLINE'; layer; closed: boolean; vertices: Array<{ x: number; y: number; bulge: number }> }`
  - `{ type: 'POLYLINE'; layer; closed: boolean; vertices: Array<{ x: number; y: number; bulge: number }> }`

LWPOLYLINE packs all vertices into one entity: repeated group `10/20` pairs (each `10` starts a new vertex), optional `42` bulge per vertex, `70` flag (bit 0 = closed). POLYLINE is a container: vertices are separate `VERTEX` sub-entities terminated by `SEQEND`; for this codec we read the POLYLINE's `70` flag and gather following `VERTEX` entities until `SEQEND`. To keep the parser flat, POLYLINE vertices are collected by treating `VERTEX`/`SEQEND` as control markers within `readEntity`'s caller. Implement LWPOLYLINE fully here; POLYLINE handled via a vertex-accumulation branch in `parseDxf`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to parser.spec.ts
describe('parseDxf — polylines', () => {
  it('parses an open LWPOLYLINE with vertices and zero bulges', () => {
    const dxf = entitiesDxf(['  0', 'LWPOLYLINE', '  8', '0', ' 90', '3', ' 70', '0',
      ' 10', '0.0', ' 20', '0.0', ' 10', '10.0', ' 20', '0.0', ' 10', '10.0', ' 20', '10.0'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('LWPOLYLINE');
    if (e.type === 'LWPOLYLINE') {
      expect(e.closed).toBe(false);
      expect(e.vertices.map((v) => [v.x, v.y])).toEqual([[0, 0], [10, 0], [10, 10]]);
      expect(e.vertices.every((v) => v.bulge === 0)).toBe(true);
    }
  });

  it('captures per-vertex bulge on LWPOLYLINE and closed flag', () => {
    const dxf = entitiesDxf(['  0', 'LWPOLYLINE', '  8', '0', ' 70', '1',
      ' 10', '0.0', ' 20', '0.0', ' 42', '0.5', ' 10', '10.0', ' 20', '0.0'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    if (e.type === 'LWPOLYLINE') {
      expect(e.closed).toBe(true);
      expect(e.vertices[0]!.bulge).toBeCloseTo(0.5);
      expect(e.vertices[1]!.bulge).toBe(0);
    }
  });

  it('parses a legacy POLYLINE with VERTEX sub-entities and SEQEND', () => {
    const dxf = entitiesDxf(['  0', 'POLYLINE', '  8', '0', ' 70', '0',
      '  0', 'VERTEX', '  8', '0', ' 10', '1.0', ' 20', '2.0',
      '  0', 'VERTEX', '  8', '0', ' 10', '3.0', ' 20', '4.0', ' 42', '0.25',
      '  0', 'SEQEND', '  8', '0'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('POLYLINE');
    if (e.type === 'POLYLINE') {
      expect(e.vertices.map((v) => [v.x, v.y])).toEqual([[1, 2], [3, 4]]);
      expect(e.vertices[1]!.bulge).toBeCloseTo(0.25);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/shared test -- dxf/__tests__/parser.spec.ts`
Expected: FAIL — polyline entities not produced.

- [ ] **Step 3: Write minimal implementation**

Add to `DxfEntity` union in `types.ts`:

```typescript
  | { type: 'LWPOLYLINE'; layer: string; closed: boolean; vertices: Array<{ x: number; y: number; bulge: number }> }
  | { type: 'POLYLINE'; layer: string; closed: boolean; vertices: Array<{ x: number; y: number; bulge: number }> }
```

LWPOLYLINE in `readEntity` (the multi-vertex pack requires ordered iteration, not the `find`-based `num`):

```typescript
    case 'LWPOLYLINE': {
      const verts: Array<{ x: number; y: number; bulge: number }> = [];
      let cur: { x: number; y: number; bulge: number } | null = null;
      for (const q of raw.pairs) {
        if (q.code === 10) {
          if (cur) verts.push(cur);
          cur = { x: Number.parseFloat(q.value) || 0, y: 0, bulge: 0 };
        } else if (q.code === 20 && cur) {
          cur.y = Number.parseFloat(q.value) || 0;
        } else if (q.code === 42 && cur) {
          cur.bulge = Number.parseFloat(q.value) || 0;
        }
      }
      if (cur) verts.push(cur);
      return { type: 'LWPOLYLINE', layer, closed: (num(raw.pairs, 70) & 1) === 1, vertices: verts };
    }
```

POLYLINE needs the VERTEX sub-entities, which arrive as separate `0`-records. Handle it in `parseDxf` with a small accumulation mode. Add state above the loop:

```typescript
  let polyline: { layer: string; closed: boolean; vertices: Array<{ x: number; y: number; bulge: number }> } | null = null;
```

In the `p.code === 0` branch, before the generic `else`, special-case POLYLINE / VERTEX / SEQEND:

```typescript
      } else if (kind === 'POLYLINE') {
        flush();
        // peek the 70 flag among following pairs is awkward; default open, fix on SEQEND via stored flag
        polyline = { layer: '0', closed: false, vertices: [] };
        raw = { type: '__POLYHDR__', pairs: [] };
      } else if (kind === 'VERTEX') {
        flush();
        raw = { type: '__VERTEX__', pairs: [] };
      } else if (kind === 'SEQEND') {
        flush();
        if (polyline) {
          const ent: DxfEntity = { type: 'POLYLINE', layer: polyline.layer, closed: polyline.closed, vertices: polyline.vertices };
          if (section === 'ENTITIES') result.entities.push(ent);
          else if (section === 'BLOCKS' && currentBlock) (result.blocks[currentBlock] ??= []).push(ent);
          polyline = null;
        }
```

And extend the `else if (raw)` attribute-collection branch to finalize the header/vertex records:

```typescript
    } else if (raw) {
      raw.pairs.push(p);
      if (raw.type === '__BLOCK__' && p.code === 2) { /* unchanged */ }
    }
```

Then in `flush()`, handle the two synthetic types:

```typescript
  const flush = (): void => {
    if (!raw) return;
    if (raw.type === '__POLYHDR__' && polyline) {
      polyline.layer = str(raw.pairs, 8, '0');
      polyline.closed = (num(raw.pairs, 70) & 1) === 1;
      raw = null;
      return;
    }
    if (raw.type === '__VERTEX__' && polyline) {
      polyline.vertices.push({ x: num(raw.pairs, 10), y: num(raw.pairs, 20), bulge: num(raw.pairs, 42) });
      raw = null;
      return;
    }
    // ...existing readEntity flush...
  };
```

> Implementer note: the `flush()` closure references `polyline`, `section`, `currentBlock`, `result` — all in scope. Keep `flush` defined after those `let`s. Run the test after wiring to confirm ordering.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zilventor/shared test -- dxf/__tests__/parser.spec.ts`
Expected: PASS (all parser tests, incl. 3 polyline cases).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/types.ts packages/shared/src/dxf/parser.ts packages/shared/src/dxf/__tests__/parser.spec.ts
git commit -m "feat(dxf): parse LWPOLYLINE + legacy POLYLINE with bulge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: BLOCKS + INSERT (translation flatten parity)

**Files:**
- Modify: `packages/shared/src/dxf/types.ts`, `packages/shared/src/dxf/parser.ts`
- Test: `packages/shared/src/dxf/__tests__/parser.spec.ts`

**Interfaces:**
- Produces (added to `DxfEntity`): `{ type: 'INSERT'; layer; name: string; x: number; y: number; xscale: number; yscale: number; rotation: number }`.
- `ParsedDxf.blocks` is populated (block name → its `DxfEntity[]`). INSERT flattening (applying placement) is done by the consumer (`parseDxfUnderlay`, Task 7) to match current underlay behavior — the parser only exposes blocks + INSERT records.

- [ ] **Step 1: Write the failing test**

```typescript
// append to parser.spec.ts
function blocksDxf(name: string, body: string, ix: number, iy: number): string {
  return ['  0', 'SECTION', '  2', 'BLOCKS',
    '  0', 'BLOCK', '  2', name, ' 70', '0', ' 10', '0.0', ' 20', '0.0',
    body.trim(),
    '  0', 'ENDBLK', '  0', 'ENDSEC',
    '  0', 'SECTION', '  2', 'ENTITIES',
    '  0', 'INSERT', '  2', name, ' 10', String(ix), ' 20', String(iy),
    '  0', 'ENDSEC', '  0', 'EOF'].join('\n');
}

describe('parseDxf — BLOCKS & INSERT', () => {
  it('collects block entities under blocks[name] and emits an INSERT record', () => {
    const dxf = blocksDxf('MYBLK',
      ['  0', 'LINE', '  8', '0', ' 10', '1.0', ' 20', '2.0', ' 11', '11.0', ' 21', '2.0'].join('\n'),
      100, 200);
    const r = parseDxf(dxf);
    expect(r.blocks['MYBLK']).toBeDefined();
    expect(r.blocks['MYBLK']!).toHaveLength(1);
    expect(r.blocks['MYBLK']![0]!.type).toBe('LINE');
    const ins = r.entities.find((e) => e.type === 'INSERT');
    expect(ins).toBeDefined();
    if (ins && ins.type === 'INSERT') {
      expect(ins.name).toBe('MYBLK');
      expect([ins.x, ins.y]).toEqual([100, 200]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/shared test -- dxf/__tests__/parser.spec.ts`
Expected: FAIL — INSERT entity not produced / blocks empty.

- [ ] **Step 3: Write minimal implementation**

Add to `DxfEntity` union in `types.ts`:

```typescript
  | { type: 'INSERT'; layer: string; name: string; x: number; y: number; xscale: number; yscale: number; rotation: number }
```

Add INSERT case to `readEntity`:

```typescript
    case 'INSERT':
      return { type: 'INSERT', layer,
        name: str(raw.pairs, 2),
        x: num(raw.pairs, 10), y: num(raw.pairs, 20),
        xscale: num(raw.pairs, 41, 1), yscale: num(raw.pairs, 42, 1),
        rotation: num(raw.pairs, 50) };
```

Blocks accumulation already works via Task 2's `__BLOCK__` handling (`currentBlock` is set, and `readEntity` results route into `result.blocks[currentBlock]` while `section === 'BLOCKS'`). Confirm the BLOCK header's group `2` name is read before its child entities (it is — `raw.type === '__BLOCK__' && p.code === 2` sets `currentBlock`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zilventor/shared test -- dxf/__tests__/parser.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/types.ts packages/shared/src/dxf/parser.ts packages/shared/src/dxf/__tests__/parser.spec.ts
git commit -m "feat(dxf): parse BLOCKS + INSERT records

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: SPLINE + ELLIPSE (broad-coverage parse) + barrel export

**Files:**
- Modify: `packages/shared/src/dxf/types.ts`, `packages/shared/src/dxf/parser.ts`
- Create: `packages/shared/src/dxf/index.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/dxf/__tests__/parser.spec.ts`

**Interfaces:**
- Produces (added to `DxfEntity`):
  - `{ type: 'SPLINE'; layer; degree: number; closed: boolean; controlPoints: Array<{ x: number; y: number }> }`
  - `{ type: 'ELLIPSE'; layer; cx; cy; majorX; majorY; ratio; startParam; endParam }`
- Barrel: `packages/shared/src/dxf/index.ts` re-exports `tokenize`, `parseDxf`, and all types; `packages/shared/src/index.ts` adds `export * from './dxf';`.

SPLINE: group `71` degree, `70` flag (bit 0 = closed), control points as repeated `10/20`. ELLIPSE: `10/20` center, `11/21` major-axis endpoint (relative to center), `40` ratio, `41/42` start/end params (radians in DXF — stored raw here; mapping to the sketch model happens in a later phase).

- [ ] **Step 1: Write the failing test**

```typescript
// append to parser.spec.ts
describe('parseDxf — SPLINE & ELLIPSE', () => {
  it('parses a SPLINE degree + control points + closed flag', () => {
    const dxf = entitiesDxf(['  0', 'SPLINE', '  8', '0', ' 70', '1', ' 71', '3',
      ' 10', '0.0', ' 20', '0.0', ' 10', '1.0', ' 20', '2.0', ' 10', '3.0', ' 20', '0.0'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('SPLINE');
    if (e.type === 'SPLINE') {
      expect(e.degree).toBe(3);
      expect(e.closed).toBe(true);
      expect(e.controlPoints.map((p) => [p.x, p.y])).toEqual([[0, 0], [1, 2], [3, 0]]);
    }
  });

  it('parses an ELLIPSE with center, major-axis vector, ratio, params', () => {
    const dxf = entitiesDxf(['  0', 'ELLIPSE', '  8', '0',
      ' 10', '5.0', ' 20', '5.0', ' 11', '10.0', ' 21', '0.0', ' 40', '0.5',
      ' 41', '0.0', ' 42', '6.283185'].join('\n'));
    const e = parseDxf(dxf).entities[0]!;
    expect(e.type).toBe('ELLIPSE');
    if (e.type === 'ELLIPSE') {
      expect([e.cx, e.cy]).toEqual([5, 5]);
      expect([e.majorX, e.majorY]).toEqual([10, 0]);
      expect(e.ratio).toBeCloseTo(0.5);
      expect(e.startParam).toBeCloseTo(0);
      expect(e.endParam).toBeCloseTo(6.283185);
    }
  });
});

import { tokenize as tk } from '../index';
import { parseDxf as pd } from '../index';
describe('dxf barrel', () => {
  it('re-exports tokenize and parseDxf', () => {
    expect(typeof tk).toBe('function');
    expect(typeof pd).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/shared test -- dxf/__tests__/parser.spec.ts`
Expected: FAIL — SPLINE/ELLIPSE entities not produced; `../index` missing.

- [ ] **Step 3: Write minimal implementation**

Add to `DxfEntity` union in `types.ts`:

```typescript
  | { type: 'SPLINE'; layer: string; degree: number; closed: boolean; controlPoints: Array<{ x: number; y: number }> }
  | { type: 'ELLIPSE'; layer: string; cx: number; cy: number; majorX: number; majorY: number; ratio: number; startParam: number; endParam: number }
```

Add cases to `readEntity` (SPLINE needs ordered control-point reading like LWPOLYLINE):

```typescript
    case 'SPLINE': {
      const cps: Array<{ x: number; y: number }> = [];
      let cx: number | null = null;
      for (const q of raw.pairs) {
        if (q.code === 10) cx = Number.parseFloat(q.value) || 0;
        else if (q.code === 20 && cx !== null) { cps.push({ x: cx, y: Number.parseFloat(q.value) || 0 }); cx = null; }
      }
      return { type: 'SPLINE', layer, degree: num(raw.pairs, 71, 3), closed: (num(raw.pairs, 70) & 1) === 1, controlPoints: cps };
    }
    case 'ELLIPSE':
      return { type: 'ELLIPSE', layer,
        cx: num(raw.pairs, 10), cy: num(raw.pairs, 20),
        majorX: num(raw.pairs, 11), majorY: num(raw.pairs, 21),
        ratio: num(raw.pairs, 40), startParam: num(raw.pairs, 41), endParam: num(raw.pairs, 42, 2 * Math.PI) };
```

```typescript
// packages/shared/src/dxf/index.ts
export { tokenize } from './tokenizer';
export { parseDxf } from './parser';
export type { DxfPair, DxfEntity, ParsedDxf } from './types';
```

Add to `packages/shared/src/index.ts` (verify exact barrel path; it is the file that already exports `UnderlayEntity`/`DxfUnderlay`):

```typescript
export * from './dxf';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zilventor/shared test -- dxf/__tests__/parser.spec.ts && pnpm --filter @zilventor/shared typecheck`
Expected: PASS; typecheck 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/ packages/shared/src/index.ts
git commit -m "feat(dxf): parse SPLINE + ELLIPSE; export codec barrel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Reroute parseDxfUnderlay onto the shared parser

**Files:**
- Modify: `packages/app/src/drawing/parseDxfUnderlay.ts` (full rewrite of its internals; signature unchanged)
- Test (unchanged, must stay green): `packages/app/src/drawing/__tests__/parseDxfUnderlay.spec.ts`, `packages/app/src/commands/__tests__/ImportDxfUnderlayCommand.spec.ts`

**Interfaces:**
- Consumes: `parseDxf`, `DxfEntity` from `@zilventor/shared` (Task 6).
- Produces: unchanged public signature `parseDxfUnderlay(dxfText: string, fileName: string): DxfUnderlay`.

Rewrite the file to drop the `dxf-parser` imports and map the shared `DxfEntity[]` (+ blocks) to `UnderlayEntity[]`, preserving current behavior: INSERT translation-only flatten (depth ≤ 4), bbox, name-from-filename, never-throws. **Critical:** the shared parser already returns ARC angles in **degrees**, so the old `* RAD_TO_DEG` conversion is removed (the spec asserts 45/135 degrees — now satisfied directly). LWPOLYLINE/POLYLINE bulge is still approximated as straight chords for the underlay (drop `bulge`), matching the documented MVP limitation. SPLINE/ELLIPSE remain skipped for the underlay (same as today).

- [ ] **Step 1: Confirm the regression tests currently pass (baseline)**

Run: `pnpm --filter @zilventor/app test -- parseDxfUnderlay.spec.ts ImportDxfUnderlayCommand.spec.ts`
Expected: PASS (baseline before the rewrite).

- [ ] **Step 2: Rewrite `parseDxfUnderlay.ts`**

```typescript
// packages/app/src/drawing/parseDxfUnderlay.ts
// F1 (DXF underlay parser) — pure function; no side effects.
// Now backed by the dependency-free shared DXF codec (@zilventor/shared) instead of dxf-parser.
//
// NOTE on bulge/arc segments in LWPOLYLINE/POLYLINE:
//   Non-zero bulge values describe arc segments. For the backdrop use-case these are
//   approximated as straight chord segments (vertex-to-vertex). Intentional MVP limitation.

import { parseDxf } from '@zilventor/shared';
import type { DxfEntity, UnderlayEntity, DxfUnderlay } from '@zilventor/shared';

function mapEntity(e: DxfEntity, dx: number, dy: number): UnderlayEntity | null {
  switch (e.type) {
    case 'LINE':
      return { kind: 'line', x1: e.x1 + dx, y1: e.y1 + dy, x2: e.x2 + dx, y2: e.y2 + dy };
    case 'LWPOLYLINE':
    case 'POLYLINE':
      if (e.vertices.length === 0) return null;
      return { kind: 'polyline', points: e.vertices.map((v) => [v.x + dx, v.y + dy] as const), closed: e.closed };
    case 'CIRCLE':
      return { kind: 'circle', cx: e.cx + dx, cy: e.cy + dy, r: e.r };
    case 'ARC':
      // Shared parser already returns degrees — no radian conversion.
      return { kind: 'arc', cx: e.cx + dx, cy: e.cy + dy, r: e.r, startAngle: e.startAngle, endAngle: e.endAngle };
    case 'TEXT':
    case 'MTEXT':
      return { kind: 'text', x: e.x + dx, y: e.y + dy, height: e.height, value: e.value, rotation: e.rotation };
    // SPLINE, ELLIPSE, INSERT handled elsewhere / skipped.
    default:
      return null;
  }
}

function flattenInsert(
  name: string, dx: number, dy: number,
  blocks: Record<string, DxfEntity[]>, depth: number, out: UnderlayEntity[],
): void {
  if (depth > 4) return;
  const block = blocks[name];
  if (!block) return;
  for (const child of block) {
    if (child.type === 'INSERT') {
      flattenInsert(child.name, dx + child.x, dy + child.y, blocks, depth + 1, out);
    } else {
      const mapped = mapEntity(child, dx, dy);
      if (mapped) out.push(mapped);
    }
  }
}

type BBox = { minX: number; minY: number; maxX: number; maxY: number };

function expand(bb: BBox, x: number, y: number): void {
  if (x < bb.minX) bb.minX = x;
  if (x > bb.maxX) bb.maxX = x;
  if (y < bb.minY) bb.minY = y;
  if (y > bb.maxY) bb.maxY = y;
}

function computeBBox(entities: ReadonlyArray<UnderlayEntity>): BBox | undefined {
  if (entities.length === 0) return undefined;
  const bb: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const e of entities) {
    switch (e.kind) {
      case 'line': expand(bb, e.x1, e.y1); expand(bb, e.x2, e.y2); break;
      case 'polyline': for (const [px, py] of e.points) expand(bb, px, py); break;
      case 'circle': expand(bb, e.cx - e.r, e.cy - e.r); expand(bb, e.cx + e.r, e.cy + e.r); break;
      case 'arc': expand(bb, e.cx - e.r, e.cy - e.r); expand(bb, e.cx + e.r, e.cy + e.r); break;
      case 'text': expand(bb, e.x, e.y); break;
    }
  }
  if (!isFinite(bb.minX)) return undefined;
  return bb;
}

export function parseDxfUnderlay(dxfText: string, fileName: string): DxfUnderlay {
  const lastDot = fileName.lastIndexOf('.');
  const name = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;

  const parsed = parseDxf(dxfText); // never throws
  const out: UnderlayEntity[] = [];
  for (const e of parsed.entities) {
    if (e.type === 'INSERT') {
      flattenInsert(e.name, e.x, e.y, parsed.blocks, 0, out);
    } else {
      const mapped = mapEntity(e, 0, 0);
      if (mapped) out.push(mapped);
    }
  }

  const sourceBBoxMm = computeBBox(out);
  return { name, entities: out, ...(sourceBBoxMm !== undefined ? { sourceBBoxMm } : {}) };
}
```

- [ ] **Step 3: Run the regression tests to verify they still pass**

Run: `pnpm --filter @zilventor/app test -- parseDxfUnderlay.spec.ts ImportDxfUnderlayCommand.spec.ts`
Expected: PASS — same assertions, now via the shared parser (ARC degrees, INSERT translation, bbox, name, malformed→empty all hold).

- [ ] **Step 4: Typecheck**

Run: `pnpm -r typecheck`
Expected: 0 new errors. (`parseDxfUnderlay.ts` no longer imports `dxf-parser` types.)

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/parseDxfUnderlay.ts
git commit -m "refactor(dxf): reroute underlay parser onto shared codec

Drops dxf-parser usage from parseDxfUnderlay; shared parser returns ARC
angles in degrees so the radian conversion is removed. Underlay specs
unchanged and green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Retire the dxf-parser dependency

**Files:**
- Modify: `packages/app/package.json` — remove `dxf-parser` from `dependencies`.
- Delete: `packages/app/src/drawing/__tests__/dxfParserSmoke.spec.ts` (tests the removed dep).
- Create: `packages/shared/src/dxf/__tests__/smoke.spec.ts` (replacement smoke for the shared codec).

**Interfaces:** none new.

- [ ] **Step 1: Confirm no remaining `dxf-parser` imports**

Run: `grep -rn "dxf-parser" packages/`
Expected: only `packages/app/package.json` (and possibly a lockfile entry). If any `.ts` still imports it, STOP and fix before continuing.

- [ ] **Step 2: Write the replacement smoke test**

```typescript
// packages/shared/src/dxf/__tests__/smoke.spec.ts
import { describe, it, expect } from 'vitest';
import { parseDxf } from '../parser';

const MINIMAL_DXF = ['  0', 'SECTION', '  2', 'ENTITIES',
  '  0', 'LINE', '  8', '0', ' 10', '0.0', ' 20', '0.0', ' 11', '10.0', ' 21', '20.0',
  '  0', 'ENDSEC', '  0', 'EOF'].join('\n');

describe('shared dxf codec smoke', () => {
  it('parses a minimal DXF into one LINE entity', () => {
    const r = parseDxf(MINIMAL_DXF);
    expect(r.entities).toHaveLength(1);
    expect(r.entities[0]!.type).toBe('LINE');
  });
});
```

- [ ] **Step 3: Remove the dep and the old smoke**

```bash
rm packages/app/src/drawing/__tests__/dxfParserSmoke.spec.ts
# edit packages/app/package.json: delete the "dxf-parser": "^1.1.2" line from "dependencies"
pnpm install
```

- [ ] **Step 4: Run the full gate**

Run: `pnpm --filter @zilventor/shared test && pnpm --filter @zilventor/app test && pnpm -r typecheck`
Expected: shared codec tests PASS; app suite PASS (underlay specs green, old smoke gone); typecheck 0 new errors.

- [ ] **Step 5: Lint + commit**

```bash
pnpm -r lint
git add packages/app/package.json pnpm-lock.yaml packages/shared/src/dxf/__tests__/smoke.spec.ts
git rm packages/app/src/drawing/__tests__/dxfParserSmoke.spec.ts
git commit -m "chore(dxf): retire dxf-parser npm dependency

Shared dependency-free codec fully replaces the read-only dxf-parser.
Replaces the dep smoke test with a shared-codec smoke.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 1 Definition of Done

- `packages/shared/src/dxf/` parses LINE, CIRCLE, ARC, TEXT, MTEXT, LWPOLYLINE, POLYLINE (with bulge captured), BLOCKS/INSERT, SPLINE, ELLIPSE — all unit-tested, dependency-free.
- `parseDxfUnderlay` runs on the shared parser; existing underlay unit + command specs green, unmodified.
- `dxf-parser` removed from `packages/app/package.json`; no `.ts` imports it.
- `@zilventor/shared` still has zero runtime dependencies.
- `pnpm -r typecheck` 0-new, `pnpm -r lint` clean.

## Self-Review

- **Spec coverage:** Implements spec §3 codec home (`shared/src/dxf/`), §4.1 tokenizer+parser, §2 "dxf-parser retired / underlay rerouted", and the §8 risk "port underlay fixtures first" (the existing underlay specs ARE the fixtures, kept green). Writer (§4.5), mapping to SketchPrimitive (§4.2), model extension (§4.3), and commands (§4.4) are **out of Phase 1** — they are Phases 2–4 (planned just-in-time).
- **Placeholder scan:** none — every code step has full code; the one implementer note (Task 4 `flush` ordering) is guidance alongside complete code, not a placeholder.
- **Type consistency:** `parseDxf`/`tokenize`/`DxfEntity`/`ParsedDxf` names are consistent across Tasks 1–8; `parseDxfUnderlay` signature unchanged; `UnderlayEntity`/`DxfUnderlay` names match the existing shared types.

## Next phases (planned just-in-time, not in this file)

- **Phase 2 — AC1015 writer** in `shared/src/dxf/writer.ts`; migrate the 3 exporters to native arcs; rewrite goldens (regression gate).
- **Phase 3 — sketch-model extension** (ellipse + degree-n spline through shared types, OCCT, planegcs, ~7 switches, manifest v30→v31).
- **Phase 4 — importer mapping (`toSketch`) + 2 import commands + 2 entry points** (units/layers/blocks/bulge→arc).
- **Phase 5 — round-trip fidelity, edge cases, perf, §6 real-browser verification.**
