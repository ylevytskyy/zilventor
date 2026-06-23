# DXF Phase 4c — LAYER/entity color + linetype → visible sketch geometry

**Date:** 2026-06-23
**Branch:** `feat/dxf-support` (off master `8112434a`, NOT merged)
**Status:** Design approved. Last Phase 4c importer item.

## Goal

Imported DXF geometry should render in its source **layer/entity color** and **dash
style** (solid vs dashed), composing with — never overriding — the existing
construction styling. This is the **visual-fidelity** path (chosen over "skip" and
"round-trip-only metadata"): the renderer actually displays the imported color/style,
so it is a real user-visible feature, not dead metadata.

### Decisions locked (during brainstorming)

1. **Visual fidelity (B)** — add fields to the model AND teach the renderer to display them.
2. **Color + linetype both** — linetype rides an orthogonal-ish channel (dash), color rides hue.
3. **Source = entity + layer override** — per-entity code 62/6 overrides the LAYER record
   (256 = BYLAYER → layer color; 0 = BYBLOCK → default).
4. **Construction styling wins** — when a primitive is BOTH construction (frozen/DEFPOINTS
   layer) AND has a layer/entity color, the construction look (gray dashed) is kept and the
   imported color/linetype is dropped for that primitive.

## Non-goals (documented, deferred)

- Sketch → DXF **export** of color/linetype (round-trip). Render-consuming only this slice.
- **trueColor** (group code 420) — only ACI (code 62) is read.
- Per-`INSERT` **BYBLOCK** color inheritance — BYBLOCK (0) resolves to default for now.
- Reproducing each DXF linetype's exact dash pattern — collapsed to two families (`dashed`/`dashdot`).

## Model (`packages/shared/src/types.ts`)

Add two optional cosmetic fields to **every** `SketchPrimitive` union member, alongside the
existing `construction?` (follow the existing per-member repetition style):

```ts
color?: number;                  // resolved 0xRRGGBB — NOT raw ACI; sketch model stays DXF-agnostic
lineStyle?: 'dashed' | 'dashdot'; // present only for non-continuous linetypes
```

Both are **omitted** when the value is the default (color resolves to the native sketch
look; linetype is continuous/solid). Adding optional fields is backward-compatible →
**NO migration, NO manifest bump (stays v32).** Old documents load with `undefined` and
render with the existing defaults.

## Parser (`packages/shared/src/dxf/parser.ts`)

- LAYER table already captures color (62) + linetype (6) into `DxfLayer` — **unchanged**.
- Add **entity-level** capture on `DxfEntity`: `color?: number` (code 62) and
  `linetype?: string` (code 6), read via the existing num/str bag helper in `readEntity`.
- trueColor (420) is **not** read (deferred).

## Resolution helpers (`packages/shared/src/dxf/`)

### `aciToRgb(aci: number): number`
Canonical 256-entry AutoCAD Color Index palette → `0xRRGGBB`. (The existing
`dxfWriter.ts hexToAci` is the reverse direction and only a partial nearest-match palette;
this is a fresh forward table.)

### `resolveStyle(entity, layers): { color?: number; lineStyle?: 'dashed' | 'dashdot' }`
Precedence:

**Color**
1. Entity code 62 present and not `256`/`0` → use it.
2. `256` (BYLAYER) or entity color absent → layer's color.
3. `0` (BYBLOCK) → default.
4. Effective ACI `7` (white/foreground) or absent/default → **`color` undefined**
   (renderer uses its native default — only intentionally-colored layers stand out).
5. Otherwise → `aciToRgb(effectiveAci)`.

**Linetype**
1. Entity code 6 present and not `BYLAYER` → use it; else layer's linetype.
2. Map name → family:
   - `CONTINUOUS` / empty / `BYLAYER` / `BYBLOCK` → solid → `lineStyle` undefined
   - `DASHED` / `HIDDEN` → `'dashed'`
   - `CENTER` / `DASHDOT` / `PHANTOM` → `'dashdot'`
   - unknown name → solid (conservative — don't fabricate dashing)

## toSketch (`packages/shared/src/dxf/toSketch.ts`)

- Compute `resolveStyle(entity, layers)` once per entity.
- Merge `color` / `lineStyle` into **each** primitive that entity emits — **skipped
  entirely when the primitive is construction** (construction wins).
- Applied in BOTH the main `mapEntity` dispatch AND inside `expandInsert` block bodies
  (block sub-entities use their own layer/entity style via the same helper).

## Renderer (`packages/app/src/sketcher/render/CommittedSketchRenderer.ts`)

Currently hard-codes `SKETCH_COLOR = 0xe8e8e8` (normal) and `CONSTRUCTION_COLOR = 0x8a8f98`
(dashed). Change `buildObject`:

```ts
const color  = p.construction ? CONSTRUCTION_COLOR : (p.color ?? SKETCH_COLOR);
const dashed = p.construction || p.lineStyle != null;
// dashed → LineDashedMaterial({ color, dashSize, gapSize }); else LineBasicMaterial({ color })
//   construction keeps current 2 / 1.5
//   'dashed'  → e.g. 3 / 2
//   'dashdot' → e.g. distinct dash/gap (approximation; exact dash-dot pattern deferred)
```

Existing hover/selection color overrides are **untouched** — imported color is the
**resting** appearance only; highlight materials override when active.

## Verification (TDD — red→green per slice)

- **shared unit:** `aciToRgb` (known ACI→RGB samples); `resolveStyle` precedence
  (entity overrides layer; 256→layer; 0→default; 7/absent→undefined; construction→no style);
  linetype name→family table; parser captures entity 62/6.
- **toSketch unit:** DXF with a colored layer + an entity-level override → emitted primitive
  carries expected `color`/`lineStyle`; a construction primitive carries neither.
- **app renderer unit:** primitive with `color` → material color matches; `lineStyle` →
  dashed material; construction → gray dashed **regardless** of imported color.
- **§6 e2e** (`tests/e2e/drawing/`): import a DXF with ≥2 colored layers (one solid, one
  dashed linetype) → assert the resulting sketch primitives carry the expected colors/styles
  via `window.__zilventorStore` (headless Chrome viewport is black — assert state, not pixels).
  Exact-count + exact-value assertions to guard against false-green.

## Key risks / gotchas

- ACI palette correctness — use the canonical table; spot-check a handful of known indices.
- `expandInsert` already forces construction + has its own dispatch; thread `resolveStyle`
  there without disturbing the existing construction-forcing behavior.
- Adding fields to all 7 `SketchPrimitive` members is repetitive but matches the existing
  `construction?` style — do not refactor the union into a shared base (out of scope).
- Renderer hover/selection path must keep overriding base color — verify the resting-vs-active
  split before changing material construction.
- ARC angles are degrees in parser, radians in primitives — irrelevant here but don't touch.
