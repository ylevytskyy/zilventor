# DXF Phase 4c — LAYER/entity color + linetype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Imported DXF geometry renders in its source layer/entity color and dash style (solid vs dashed), composing with — never overriding — the existing construction styling.

**Architecture:** Parser gains entity-level color (62) / linetype (6) capture. Two new pure shared helpers — `aciToRgb` (ACI→0xRRGGBB) and `resolveStyle` (entity+layer precedence → `{color?, lineStyle?}`). `toSketch` merges the resolved style into each emitted primitive (skipped for construction geometry), in both the main loop and `expandInsert` block bodies. The renderer reads `color`/`lineStyle` off each primitive via a pure `materialSpec` seam.

**Tech Stack:** TypeScript, pnpm workspaces, vitest (shared + app), Playwright (e2e), THREE.js (renderer).

## Global Constraints

- Branch: `feat/dxf-support` (off master `8112434a`, NOT merged). Commit each task; do NOT `git push` (controller pushes at slice end).
- **NO manifest bump** — `CURRENT_FORMAT_VERSION` stays `32` (`packages/shared/src/fileFormat.ts:4`). New fields are optional → backward-compatible, no migration.
- Color stored as resolved `0xRRGGBB` number, NOT raw ACI. `lineStyle` is `'dashed' | 'dashdot'`.
- **Construction wins:** construction primitives carry NO `color`/`lineStyle`.
- Per-pkg tests from inside the package: `cd packages/shared && npx vitest run <file>`; tsc `npx tsc --noEmit -p tsconfig.json`. e2e from root: `npx playwright test --project=chromium tests/e2e/drawing/<file>`.
- Unit test files live under `packages/shared/src/dxf/__tests__/`.
- ARC angles are degrees in parser, radians in primitives — do not touch existing angle handling.
- ACI palette: map ACI 1–9, 250–255 grays, 30/40 only; unmapped/0/7/256 → `undefined` (native default). Full palette deferred.

---

### Task 1: Parser captures entity-level color (62) + linetype (6)

**Files:**
- Modify: `packages/shared/src/dxf/parser.ts` (the `DxfEntity` types + `readEntity`, ~lines 225–368; helpers at 8–23)
- Test: `packages/shared/src/dxf/__tests__/parser.spec.ts`

**Interfaces:**
- Produces: every `DxfEntity` variant gains optional `color?: number` (DXF code 62) and `linetype?: string` (DXF code 6). `num`/`str` bag helpers already exist (parser.ts:8–23).

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/dxf/__tests__/parser.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseDxf } from '../parser';

describe('entity-level color/linetype capture', () => {
  it('reads code 62 (color) and code 6 (linetype) off a LINE entity', () => {
    const dxf = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LINE', '8', 'walls', '62', '1', '6', 'DASHED',
      '10', '0', '20', '0', '11', '10', '21', '0',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n');
    const parsed = parseDxf(dxf);
    const line = parsed.entities.find((e) => e.type === 'LINE')!;
    expect(line.color).toBe(1);
    expect(line.linetype).toBe('DASHED');
  });

  it('leaves color/linetype undefined when codes 62/6 are absent', () => {
    const dxf = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '5', '21', '0',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n');
    const line = parseDxf(dxf).entities.find((e) => e.type === 'LINE')!;
    expect(line.color).toBeUndefined();
    expect(line.linetype).toBeUndefined();
  });
});
```

> NOTE: confirm the public parser entry point name (`parseDxf`) and the `parsed.entities` shape by reading the top of `parser.ts` before running — adjust the import/accessor to match the actual exports. The behavior under test is unchanged regardless of naming.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/parser.spec.ts`
Expected: FAIL — `line.color` is `undefined` (capture not yet implemented).

- [ ] **Step 3: Implement minimal capture**

In `parser.ts`, add the two optional fields to the shared part of every entity. The cleanest seam: `readEntity` already computes `const layer = str(raw.pairs, 8, '0');` at the top. Add alongside it:

```ts
function readEntity(raw: RawEntity): DxfEntity | null {
  const layer = str(raw.pairs, 8, '0');
  const colorCode = raw.pairs.find((q) => q.code === 62);
  const color = colorCode ? (Number.parseInt(colorCode.value, 10) || 0) : undefined;
  const ltCode = raw.pairs.find((q) => q.code === 6);
  const linetype = ltCode ? ltCode.value : undefined;
  const common = { layer, ...(color !== undefined ? { color } : {}), ...(linetype !== undefined ? { linetype } : {}) };
  switch (raw.type) {
    case 'LINE':
      return { type: 'LINE', ...common,
        x1: num(raw.pairs, 10), y1: num(raw.pairs, 20),
        x2: num(raw.pairs, 11), y2: num(raw.pairs, 21) };
    // ...for every other case, replace `layer,` with `...common,`
  }
}
```

Apply `...common` (in place of the existing `layer,`) to **every** `case` return in `readEntity`. Then extend the `DxfEntity` type definitions so each variant allows `color?: number; linetype?: string`. If `DxfEntity` is a union of inline return types (no named members), add `color?: number; linetype?: string` to a shared base or to each variant — match however the file currently declares entity shapes. If entity types are declared in `types.ts`, edit them there.

> Guard: `LAYER`-table parsing (parser.ts:109–134) is unrelated — do not touch `parseLayers`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/parser.spec.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Typecheck + commit**

```bash
cd packages/shared && npx tsc --noEmit -p tsconfig.json
git add packages/shared/src/dxf/parser.ts packages/shared/src/dxf/__tests__/parser.spec.ts packages/shared/src/types.ts
git commit -m "feat(dxf): capture entity-level color (62) + linetype (6) in parser (Phase 4c)"
```

---

### Task 2: `aciToRgb` ACI→RGB helper

**Files:**
- Create: `packages/shared/src/dxf/aci.ts`
- Test: `packages/shared/src/dxf/__tests__/aci.spec.ts`

**Interfaces:**
- Produces: `export function aciToRgb(aci: number): number | undefined` — `0xRRGGBB` for mapped indices; `undefined` for ACI `0`/`7`/`256` and any unmapped index.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/dxf/__tests__/aci.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { aciToRgb } from '../aci';

describe('aciToRgb', () => {
  it('maps the standard base colors 1-9', () => {
    expect(aciToRgb(1)).toBe(0xff0000); // red
    expect(aciToRgb(2)).toBe(0xffff00); // yellow
    expect(aciToRgb(3)).toBe(0x00ff00); // green
    expect(aciToRgb(4)).toBe(0x00ffff); // cyan
    expect(aciToRgb(5)).toBe(0x0000ff); // blue
    expect(aciToRgb(6)).toBe(0xff00ff); // magenta
    expect(aciToRgb(8)).toBe(0x808080);
    expect(aciToRgb(9)).toBe(0xc0c0c0);
  });

  it('returns undefined for foreground/by-layer/by-block and unmapped', () => {
    expect(aciToRgb(0)).toBeUndefined();   // BYBLOCK
    expect(aciToRgb(7)).toBeUndefined();   // white/foreground -> native default
    expect(aciToRgb(256)).toBeUndefined(); // BYLAYER
    expect(aciToRgb(123)).toBeUndefined(); // unmapped extended index
  });

  it('maps the common extended + gray ramp', () => {
    expect(aciToRgb(30)).toBe(0xff7f00);
    expect(aciToRgb(250)).toBe(0x333333);
    expect(aciToRgb(255)).toBe(0xb3b3b3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/aci.spec.ts`
Expected: FAIL — module `../aci` not found.

- [ ] **Step 3: Implement**

Create `packages/shared/src/dxf/aci.ts`:

```ts
/**
 * Forward AutoCAD Color Index (ACI) -> 0xRRGGBB.
 * Returns undefined for ACI 0 (BYBLOCK), 7 (white/foreground), 256 (BYLAYER),
 * and any unmapped index -> caller uses the renderer's native default colour.
 * Only the deterministic common colours are mapped; full 256-entry palette deferred.
 */
const ACI_RGB: Readonly<Record<number, number>> = {
  1: 0xff0000, 2: 0xffff00, 3: 0x00ff00, 4: 0x00ffff,
  5: 0x0000ff, 6: 0xff00ff, 8: 0x808080, 9: 0xc0c0c0,
  30: 0xff7f00, 40: 0x804000,
  250: 0x333333, 251: 0x4d4d4d, 252: 0x666666, 253: 0x808080, 254: 0x999999, 255: 0xb3b3b3,
};

export function aciToRgb(aci: number): number | undefined {
  if (aci === 0 || aci === 7 || aci === 256) return undefined;
  return ACI_RGB[aci];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/aci.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/aci.ts packages/shared/src/dxf/__tests__/aci.spec.ts
git commit -m "feat(dxf): aciToRgb common-palette helper (Phase 4c)"
```

---

### Task 3: `resolveStyle` precedence helper

**Files:**
- Create: `packages/shared/src/dxf/style.ts`
- Test: `packages/shared/src/dxf/__tests__/style.spec.ts`

**Interfaces:**
- Consumes: `aciToRgb` (Task 2); `DxfLayer` (`{ name; color: number; linetype: string; flags: number }`).
- Produces:
  - `export type SketchStyle = { color?: number; lineStyle?: 'dashed' | 'dashdot' }`
  - `export function resolveStyle(e: { layer: string; color?: number; linetype?: string }, layers: Record<string, DxfLayer>): SketchStyle`
  - `export function linetypeToStyle(name: string): 'dashed' | 'dashdot' | undefined` (exported for direct testing)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/dxf/__tests__/style.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveStyle, linetypeToStyle } from '../style';
import type { DxfLayer } from '../parser'; // adjust import to where DxfLayer is declared

const layers: Record<string, DxfLayer> = {
  walls: { name: 'walls', color: 1, linetype: 'CONTINUOUS', flags: 0 },
  hidden: { name: 'hidden', color: 5, linetype: 'HIDDEN', flags: 0 },
  centre: { name: 'centre', color: 3, linetype: 'CENTER', flags: 0 },
};

describe('linetypeToStyle', () => {
  it('maps families and treats unknown/continuous as solid', () => {
    expect(linetypeToStyle('CONTINUOUS')).toBeUndefined();
    expect(linetypeToStyle('')).toBeUndefined();
    expect(linetypeToStyle('DASHED')).toBe('dashed');
    expect(linetypeToStyle('HIDDEN')).toBe('dashed');
    expect(linetypeToStyle('CENTER')).toBe('dashdot');
    expect(linetypeToStyle('PHANTOM')).toBe('dashdot');
    expect(linetypeToStyle('WEIRD_LT')).toBeUndefined();
  });
});

describe('resolveStyle', () => {
  it('uses layer color/linetype when entity is BYLAYER (absent codes)', () => {
    expect(resolveStyle({ layer: 'walls' }, layers)).toEqual({ color: 0xff0000 });
    expect(resolveStyle({ layer: 'hidden' }, layers)).toEqual({ color: 0x0000ff, lineStyle: 'dashed' });
    expect(resolveStyle({ layer: 'centre' }, layers)).toEqual({ color: 0x00ff00, lineStyle: 'dashdot' });
  });

  it('entity-level color/linetype overrides the layer', () => {
    expect(resolveStyle({ layer: 'walls', color: 5, linetype: 'CENTER' }, layers))
      .toEqual({ color: 0x0000ff, lineStyle: 'dashdot' });
  });

  it('entity color 256 = BYLAYER falls back to layer color', () => {
    expect(resolveStyle({ layer: 'walls', color: 256 }, layers)).toEqual({ color: 0xff0000 });
  });

  it('entity color 0 = BYBLOCK resolves to native default (no color field)', () => {
    expect(resolveStyle({ layer: 'walls', color: 0 }, layers)).toEqual({});
  });

  it('entity linetype BYLAYER falls back to the layer linetype', () => {
    expect(resolveStyle({ layer: 'hidden', linetype: 'BYLAYER' }, layers))
      .toEqual({ color: 0x0000ff, lineStyle: 'dashed' });
  });

  it('unknown layer -> empty style', () => {
    expect(resolveStyle({ layer: 'nope' }, layers)).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/style.spec.ts`
Expected: FAIL — module `../style` not found.

- [ ] **Step 3: Implement**

Create `packages/shared/src/dxf/style.ts`:

```ts
import { aciToRgb } from './aci';
import type { DxfLayer } from './parser'; // adjust to where DxfLayer is declared

export type SketchStyle = { color?: number; lineStyle?: 'dashed' | 'dashdot' };

const DASHED = new Set(['DASHED', 'HIDDEN']);
const DASHDOT = new Set(['CENTER', 'DASHDOT', 'PHANTOM']);

export function linetypeToStyle(name: string): 'dashed' | 'dashdot' | undefined {
  const n = name.trim().toUpperCase();
  if (DASHED.has(n)) return 'dashed';
  if (DASHDOT.has(n)) return 'dashdot';
  return undefined; // CONTINUOUS / empty / BYLAYER / BYBLOCK / unknown -> solid
}

export function resolveStyle(
  e: { layer: string; color?: number; linetype?: string },
  layers: Record<string, DxfLayer>,
): SketchStyle {
  const layer = layers[e.layer];
  // Color: entity 62 wins unless 256 (BYLAYER) or absent -> layer color. 0 (BYBLOCK) -> default.
  const aci = e.color != null && e.color !== 256 ? e.color : (layer?.color ?? 7);
  const color = aciToRgb(aci);
  // Linetype: entity 6 wins unless BYLAYER/absent -> layer linetype.
  const ltName = e.linetype && e.linetype.trim().toUpperCase() !== 'BYLAYER'
    ? e.linetype
    : (layer?.linetype ?? '');
  const lineStyle = linetypeToStyle(ltName);
  const out: SketchStyle = {};
  if (color !== undefined) out.color = color;
  if (lineStyle !== undefined) out.lineStyle = lineStyle;
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/style.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dxf/style.ts packages/shared/src/dxf/__tests__/style.spec.ts
git commit -m "feat(dxf): resolveStyle entity+layer color/linetype precedence (Phase 4c)"
```

---

### Task 4: Model fields + main-loop style merge in toSketch

**Files:**
- Modify: `packages/shared/src/types.ts:30-37` (add fields to every `SketchPrimitive` member)
- Modify: `packages/shared/src/dxf/toSketch.ts` (main entity loop ~line 479; add `applyStyle` helper)
- Test: `packages/shared/src/dxf/__tests__/toSketch.spec.ts`

**Interfaces:**
- Consumes: `resolveStyle`, `SketchStyle` (Task 3); `isConstructionLayer` (toSketch.ts:64).
- Produces: emitted top-level primitives carry `color`/`lineStyle` from their layer/entity (unless construction). Local helper `applyStyle(prims: SketchPrimitive[], style: SketchStyle): SketchPrimitive[]`.

- [ ] **Step 1: Add the model fields**

In `packages/shared/src/types.ts`, add `color?: number; lineStyle?: 'dashed' | 'dashdot'` to **each** of the 7 `SketchPrimitive` union members, right after `construction?: boolean`. Example for `line`:

```ts
  | { id: string; kind: 'line'; x1: number; y1: number; x2: number; y2: number; construction?: boolean; color?: number; lineStyle?: 'dashed' | 'dashdot' }
```

Repeat for `rectangle`, `circle`, `arc`, `spline`, `ellipse`, `point`.

- [ ] **Step 2: Write the failing test**

Add to `packages/shared/src/dxf/__tests__/toSketch.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseDxf } from '../parser';
import { toSketch } from '../toSketch'; // confirm exact export name + signature

function dxf(body: string[]): string {
  return ['0', 'SECTION', '2', 'TABLES',
    '0', 'TABLE', '2', 'LAYER',
    '0', 'LAYER', '2', 'walls', '62', '1', '6', 'CONTINUOUS', '70', '0',
    '0', 'LAYER', '2', 'hidden', '62', '5', '6', 'HIDDEN', '70', '0',
    '0', 'LAYER', '2', 'frozen', '62', '2', '6', 'CONTINUOUS', '70', '1',
    '0', 'ENDTAB', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES', ...body, '0', 'ENDSEC', '0', 'EOF'].join('\n');
}

describe('toSketch color/linetype', () => {
  it('attaches resolved color to a layer-coloured line', () => {
    const s = toSketch(parseDxf(dxf(['0', 'LINE', '8', 'walls', '10', '0', '20', '0', '11', '10', '21', '0'])));
    const line = s.primitives.find((p) => p.kind === 'line')!;
    expect(line.color).toBe(0xff0000);
    expect(line.lineStyle).toBeUndefined();
  });

  it('attaches color + dashed lineStyle from a HIDDEN layer', () => {
    const s = toSketch(parseDxf(dxf(['0', 'LINE', '8', 'hidden', '10', '0', '20', '0', '11', '10', '21', '0'])));
    const line = s.primitives.find((p) => p.kind === 'line')!;
    expect(line.color).toBe(0x0000ff);
    expect(line.lineStyle).toBe('dashed');
  });

  it('drops color/lineStyle on construction (frozen-layer) geometry', () => {
    const s = toSketch(parseDxf(dxf(['0', 'LINE', '8', 'frozen', '10', '0', '20', '0', '11', '10', '21', '0'])));
    const line = s.primitives.find((p) => p.kind === 'line')!;
    expect(line.construction).toBe(true);
    expect(line.color).toBeUndefined();
    expect(line.lineStyle).toBeUndefined();
  });
});
```

> NOTE: confirm `toSketch`'s exact export name, signature, and the shape it returns (`.primitives`) by reading the top of `toSketch.ts` and the existing test file. Adjust the import + result accessor to match. The fixture's TABLES/LAYER framing must match what `parseLayers` expects (see parser.ts:109–134) — mirror the structure used by existing toSketch tests if it differs.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts`
Expected: FAIL — `line.color` undefined (style not yet merged).

- [ ] **Step 4: Implement the merge**

In `toSketch.ts`, import the helper and add `applyStyle`:

```ts
import { resolveStyle, type SketchStyle } from './style';

function applyStyle(prims: SketchPrimitive[], style: SketchStyle): SketchPrimitive[] {
  if (style.color === undefined && style.lineStyle === undefined) return prims;
  return prims.map((p) => ({ ...p, ...style }));
}
```

In the main entity loop (around line 479), compute the style once per entity and wrap every emitter EXCEPT `INSERT` (INSERT styles its sub-entities internally — Task 5). The loop currently looks like:

```ts
    const construction = isConstructionLayer(parsed.layers, e.layer);
    if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
      primitives.push(...expandPolyline(e, s, construction));
      continue;
    }
    const prim = mapEntity(e, s, drop, construction);
```

Change to:

```ts
    const construction = isConstructionLayer(parsed.layers, e.layer);
    const style = construction ? {} : resolveStyle(e, parsed.layers);
    if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
      primitives.push(...applyStyle(expandPolyline(e, s, construction), style));
      continue;
    }
    // wrap the OTHER expand* dispatches in this loop the same way, e.g.:
    //   if (e.type === 'SOLID')  { primitives.push(...applyStyle(expandSolid(e, s), style)); continue; }
    //   if (e.type === '3DFACE') { primitives.push(...applyStyle(expandFace(e, s, drop), style)); continue; }
    //   if (e.type === 'HATCH')  { primitives.push(...applyStyle(expandHatch(e, s, drop), style)); continue; }
    //   if (e.type === 'INSERT') { primitives.push(...expandInsert(e, parsed, s, 0, drop)); continue; }  // NO outer style
    const prim = mapEntity(e, s, drop, construction);
    if (prim) primitives.push({ ...prim, ...style });
```

> IMPORTANT: read the actual main loop first — the exact set of `expand*` branches (SOLID/3DFACE/HATCH/INSERT) and how the single-`prim` push is written may differ. Apply `applyStyle` to every NON-INSERT expander and to the single `mapEntity` result. Leave the `INSERT` branch's outer style untouched (handled in Task 5). Do not alter coordinate math.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts`
Expected: PASS (all three).

- [ ] **Step 6: Full shared suite + typecheck + commit**

```bash
cd packages/shared && npx vitest run && npx tsc --noEmit -p tsconfig.json
git add packages/shared/src/types.ts packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/__tests__/toSketch.spec.ts
git commit -m "feat(dxf): merge resolved color/linetype into top-level sketch primitives (Phase 4c)"
```

---

### Task 5: Style INSERT block sub-entities

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts` (`expandInsert`, ~lines 334–391)
- Test: `packages/shared/src/dxf/__tests__/toSketch.spec.ts` (extend)

**Interfaces:**
- Consumes: `resolveStyle`, `applyStyle` (Task 4 — both in `toSketch.ts`).
- Produces: block sub-entities carry their OWN layer/entity color/linetype, preserved through the INSERT affine transform.

- [ ] **Step 1: Write the failing test**

Add to `toSketch.spec.ts` a DXF with a BLOCK containing a coloured LINE, INSERTed once. Mirror the BLOCKS/INSERT fixture shape used by the existing INSERT tests in this file (read them first — the block table framing must match `parser`'s block reader). Assert the resulting transformed primitive keeps the block sub-entity's color:

```ts
it('preserves block sub-entity color through INSERT expansion', () => {
  // Build on the existing INSERT fixture pattern in this file; the BLOCK body
  // line must sit on layer "walls" (color 1). After INSERT, the expanded line
  // should still carry color 0xff0000.
  const s = toSketch(parseDxf(/* TABLES(walls=1) + BLOCKS(block 'b' with LINE on walls) + INSERT of 'b' */ FIXTURE));
  const line = s.primitives.find((p) => p.kind === 'line')!;
  expect(line.color).toBe(0xff0000);
});
```

> The plan deliberately does not hardcode the BLOCKS fixture string — copy the exact working INSERT fixture already present in `toSketch.spec.ts` and set its inner LINE's layer (code 8) to `walls`, adding a `walls` LAYER record with `62 1` to the TABLES section.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts`
Expected: FAIL — expanded line has no `color` (style not applied inside `expandInsert`).

- [ ] **Step 3: Implement**

In `expandInsert`, style each sub-entity's primitives with that sub-entity's own resolved style BEFORE the outer affine transform. Current body:

```ts
  for (const be of body) {
    if (be.type === 'INSERT') {
      blockPrims.push(...expandInsert(be, parsed, 1, depth + 1, drop));
    } else if (be.type === 'LWPOLYLINE' || be.type === 'POLYLINE') {
      blockPrims.push(...expandPolyline(be, 1, false));
    } else if (be.type === 'SOLID') {
      blockPrims.push(...expandSolid(be, 1));
    } else if (be.type === '3DFACE') {
      blockPrims.push(...expandFace(be, 1, drop));
    } else if (be.type === 'HATCH') {
      blockPrims.push(...expandHatch(be, 1, drop));
    } else {
      const p = mapEntity(be, 1, drop, false);
      if (p) blockPrims.push(p);
    }
  }
```

Change to apply per-sub-entity style (nested INSERT keeps its own internal styling — do not double-style it):

```ts
  for (const be of body) {
    if (be.type === 'INSERT') {
      blockPrims.push(...expandInsert(be, parsed, 1, depth + 1, drop));
      continue;
    }
    const beStyle = resolveStyle(be, parsed.layers);
    if (be.type === 'LWPOLYLINE' || be.type === 'POLYLINE') {
      blockPrims.push(...applyStyle(expandPolyline(be, 1, false), beStyle));
    } else if (be.type === 'SOLID') {
      blockPrims.push(...applyStyle(expandSolid(be, 1), beStyle));
    } else if (be.type === '3DFACE') {
      blockPrims.push(...applyStyle(expandFace(be, 1, drop), beStyle));
    } else if (be.type === 'HATCH') {
      blockPrims.push(...applyStyle(expandHatch(be, 1, drop), beStyle));
    } else {
      const p = mapEntity(be, 1, drop, false);
      if (p) blockPrims.push({ ...p, ...beStyle });
    }
  }
```

Then VERIFY the affine-transform step that follows (the part that applies the INSERT scale/rotation/translation to `blockPrims`) **preserves** the `color`/`lineStyle` fields — i.e. it spreads each primitive (`{ ...p, x: ... }`) rather than reconstructing a bare object. If it reconstructs, add `color: p.color, lineStyle: p.lineStyle` (or spread `...p` first) so the fields survive. This is the key correctness risk of this task; the test above is what locks it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full shared suite + typecheck + commit**

```bash
cd packages/shared && npx vitest run && npx tsc --noEmit -p tsconfig.json
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/__tests__/toSketch.spec.ts
git commit -m "feat(dxf): style INSERT block sub-entities by their own layer/entity (Phase 4c)"
```

---

### Task 6: Renderer consumes color + lineStyle

**Files:**
- Modify: `packages/app/src/sketcher/render/CommittedSketchRenderer.ts` (constants + `buildObject`, ~lines 4–41)
- Test: `packages/app/src/sketcher/render/__tests__/committedSketchMaterial.spec.ts` (create; match the app's existing test dir convention — if app tests live elsewhere, place it beside existing sketcher tests)

**Interfaces:**
- Consumes: `SketchPrimitive.color`, `SketchPrimitive.lineStyle` (Task 4).
- Produces: pure `export function materialSpec(p: SketchPrimitive): { color: number; dashed: boolean; dashSize: number; gapSize: number }` exported from the renderer module; `buildObject` uses it.

- [ ] **Step 1: Write the failing test**

Create the test:

```ts
import { describe, it, expect } from 'vitest';
import { materialSpec } from '../CommittedSketchRenderer';
import type { SketchPrimitive } from '@zilventor/shared'; // use the repo's actual shared import alias

const line = (extra: Partial<SketchPrimitive>): SketchPrimitive =>
  ({ id: 'x', kind: 'line', x1: 0, y1: 0, x2: 1, y2: 0, ...extra } as SketchPrimitive);

describe('materialSpec', () => {
  it('plain primitive -> default colour, solid', () => {
    expect(materialSpec(line({}))).toEqual({ color: 0xe8e8e8, dashed: false, dashSize: 0, gapSize: 0 });
  });
  it('imported colour -> that colour, solid', () => {
    expect(materialSpec(line({ color: 0xff0000 }))).toMatchObject({ color: 0xff0000, dashed: false });
  });
  it('lineStyle dashed -> dashed material in the imported colour', () => {
    expect(materialSpec(line({ color: 0x0000ff, lineStyle: 'dashed' }))).toMatchObject({ color: 0x0000ff, dashed: true });
  });
  it('construction wins: gray dashed regardless of imported colour', () => {
    expect(materialSpec(line({ construction: true, color: 0xff0000, lineStyle: 'dashdot' })))
      .toMatchObject({ color: 0x8a8f98, dashed: true, dashSize: 2, gapSize: 1.5 });
  });
});
```

> Confirm the shared import specifier the app uses for `SketchPrimitive` (e.g. `@zilventor/shared`, `shared`, or a relative path) from a neighbouring app file and match it.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npx vitest run src/sketcher/render/__tests__/committedSketchMaterial.spec.ts`
Expected: FAIL — `materialSpec` not exported.

- [ ] **Step 3: Implement the pure seam + wire buildObject**

In `CommittedSketchRenderer.ts`, keep the constants and add:

```ts
export function materialSpec(p: SketchPrimitive): { color: number; dashed: boolean; dashSize: number; gapSize: number } {
  if (p.construction) return { color: CONSTRUCTION_COLOR, dashed: true, dashSize: 2, gapSize: 1.5 };
  const color = p.color ?? SKETCH_COLOR;
  if (p.lineStyle === 'dashed')  return { color, dashed: true, dashSize: 3, gapSize: 2 };
  if (p.lineStyle === 'dashdot') return { color, dashed: true, dashSize: 4, gapSize: 1.5 };
  return { color, dashed: false, dashSize: 0, gapSize: 0 };
}
```

Rewrite `buildObject` to use it:

```ts
  private buildObject(p: SketchPrimitive): THREE.Object3D {
    const spec = materialSpec(p);
    const mat: THREE.LineBasicMaterial | THREE.LineDashedMaterial = spec.dashed
      ? new THREE.LineDashedMaterial({ color: spec.color, dashSize: spec.dashSize, gapSize: spec.gapSize })
      : new THREE.LineBasicMaterial({ color: spec.color });
    const obj = this.buildGeometry(p, mat);
    if (spec.dashed) {
      obj.computeLineDistances();
    }
    return obj;
  }
```

(`SKETCH_COLOR = 0xe8e8e8`, `CONSTRUCTION_COLOR = 0x8a8f98` stay as-is.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && npx vitest run src/sketcher/render/__tests__/committedSketchMaterial.spec.ts`
Expected: PASS (all four).

- [ ] **Step 5: App typecheck + commit**

```bash
cd packages/app && npx tsc --noEmit -p tsconfig.json
git add packages/app/src/sketcher/render/CommittedSketchRenderer.ts packages/app/src/sketcher/render/__tests__/committedSketchMaterial.spec.ts
git commit -m "feat(dxf): render imported sketch color + dash style (Phase 4c)"
```

---

### Task 7: §6 e2e — colored DXF import round-trip to the store

**Files:**
- Create: `tests/e2e/fixtures/dxf-color-sample.dxf`
- Create: `tests/e2e/drawing/dxf-color-import.spec.ts`

**Interfaces:**
- Consumes: `window.__zilventorImportDxfNewPart(file)` and `window.__zilventorStore.getState().activePart.featureTree[...].primitives` (see `tests/e2e/drawing/dxf-import.spec.ts:62–72`).

- [ ] **Step 1: Create the fixture**

`tests/e2e/fixtures/dxf-color-sample.dxf` — minimal AC1015-style file with two colored layers: `walls` (ACI 1, CONTINUOUS) and `hidden` (ACI 5, HIDDEN), one LINE on each. Model it on the existing `tests/e2e/fixtures/dxf-import-sample.dxf` (copy its HEADER/TABLES framing; add the two LAYER records with codes `62`/`6`, and two LINE entities on those layers).

- [ ] **Step 2: Write the failing test**

Create `tests/e2e/drawing/dxf-color-import.spec.ts`, mirroring `dxf-import.spec.ts`'s load+evaluate pattern, asserting **exact** colors (false-green guard):

```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DXF = readFileSync(fileURLToPath(new URL('../fixtures/dxf-color-sample.dxf', import.meta.url)), 'utf8');

test('imports DXF layer colors + dash style into sketch primitives', async ({ page }) => {
  await page.goto('/'); // match the baseURL/bootstrap used by dxf-import.spec.ts
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  const result = await page.evaluate(async (text) => {
    const w = window as unknown as {
      __zilventorStore: { getState: () => { activePart?: { featureTree: Array<{ kind: string; primitives?: Array<{ kind: string; color?: number; lineStyle?: string }> }> } } };
      __zilventorImportDxfNewPart: (file: File) => Promise<void>;
    };
    const file = new File([text], 'colors.dxf', { type: 'image/vnd.dxf' });
    await w.__zilventorImportDxfNewPart(file);
    const part = w.__zilventorStore.getState().activePart;
    const sketch = part?.featureTree.find((f) => f.kind === 'sketch');
    const lines = (sketch?.primitives ?? []).filter((p) => p.kind === 'line');
    return {
      count: lines.length,
      colors: lines.map((p) => p.color).sort(),
      styles: lines.map((p) => p.lineStyle ?? 'solid').sort(),
    };
  }, DXF);

  expect(result.count).toBe(2);
  expect(result.colors).toEqual([0x0000ff, 0xff0000].sort()); // blue (hidden), red (walls)
  expect(result.styles).toEqual(['dashed', 'solid']); // hidden -> dashed, walls -> solid
  expect(errors).toEqual([]);
});
```

> Match the exact `page.goto` / app-bootstrap and any waits used by the existing `dxf-import.spec.ts` (it may need to wait for `__zilventorImportDxfNewPart` to be defined). Headless Chrome viewport is black — assert via the store, never pixels.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx playwright test --project=chromium tests/e2e/drawing/dxf-color-import.spec.ts`
Expected: FAIL initially only if something is wrong — since Tasks 1–6 are already merged, this should actually PASS. If you are running Task 7 standalone before 1–6, it fails on missing colors. (Per subagent-driven flow, 1–6 are done; treat a FAIL here as a real integration bug and debug via `superpowers:systematic-debugging`.)

- [ ] **Step 4: Verify it passes**

Run: `npx playwright test --project=chromium tests/e2e/drawing/dxf-color-import.spec.ts`
Expected: PASS — 2 lines, colors `[red, blue]`, styles `[dashed, solid]`, zero console/page errors.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/fixtures/dxf-color-sample.dxf tests/e2e/drawing/dxf-color-import.spec.ts
git commit -m "test(dxf): e2e import of layer color + dash style (Phase 4c)"
```

---

## Final gate (after all tasks)

- [ ] `cd packages/shared && npx vitest run` — all green (baseline was 1236; +new tests).
- [ ] `cd packages/shared && npx tsc --noEmit -p tsconfig.json` — 0 errors.
- [ ] `cd packages/app && npx tsc --noEmit -p tsconfig.json` — 0 new errors.
- [ ] `npx playwright test --project=chromium tests/e2e/drawing/dxf-color-import.spec.ts` — pass.
- [ ] Manifest still `32` (no bump).
- [ ] Request final review (`superpowers:requesting-code-review`) across all 7 task commits before controller pushes.

## Self-review notes (author)

- Spec coverage: parser 62/6 (T1), aciToRgb (T2), resolveStyle precedence incl. construction→none + BYLAYER/BYBLOCK + linetype table (T3), model fields + main-loop merge (T4), INSERT block-body styling + transform preservation (T5), renderer color+dash (T6), e2e (T7). All spec sections mapped.
- Known risk: T5 transform-field-preservation — locked by the T5 test; if the affine step reconstructs primitives, fields must be spread through.
- Naming consistency: `resolveStyle`/`SketchStyle`/`applyStyle`/`aciToRgb`/`materialSpec`/`linetypeToStyle` used identically across tasks.
- Unverified-at-author-time: exact export names of `parseDxf`/`toSketch`/`DxfLayer` and the app's shared import alias — each task flags "confirm before running". These are read-and-match, not design changes.
