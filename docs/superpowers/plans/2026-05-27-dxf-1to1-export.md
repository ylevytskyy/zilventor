# DXF 1:1 Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second DXF export that emits drawing-view geometry at true machining size (1:1), re-spaced so views don't overlap — geometry + holes only, no dims/hatch/tables/title block.

**Architecture:** A new self-contained renderer `renderDrawingDxf1to1` builds natively in DXF Y-up at scale 1.0 (ignores `view.scale`), laying views out in a single horizontal row by their true bounding-box footprints. A thin `ExportDrawing1to1DxfCommand` downloads it; a new DrawingTab button (gated on `hasProjectedView`, not `source`) triggers it. Reuses the existing `createDxfDocument` writer unchanged. Stays R12 (AC1009); no manifest bump.

**Tech Stack:** TypeScript, Vitest (unit), Playwright (e2e + perf), Zustand store, existing `dxfWriter.ts` R12 builder.

**Spec:** `docs/superpowers/specs/2026-05-27-dxf-1to1-export-design.md`

**Key facts (verified against real code):**
- `createDxfDocument()` (`packages/app/src/drawing/dxfWriter.ts`) exposes `polyline(layer, points)`, `line`, `circle`, `text`, `toString()`. `polyline` skips < 2 points and emits group codes ` 8`=layer, then `VERTEX` rows with ` 10`/` 20`. `fmt()` → `toFixed(4)`.
- `DrawingView` (union of base/projected/iso/section/detail) — every member has `positionMm: {x,y}` and `scale: ViewScale` and an optional `projection: { visibleEdges: Edge2D[]; hiddenEdges: Edge2D[]; bbox: {minX,minY,maxX,maxY} }`.
- `Edge2D` = `{ id: string; kind: string; points: readonly (readonly [number, number])[] }`. Projection coords are **model mm** (view-local, pre-scale) — same space as `bbox`.
- `triggerDownload(blob, { suggestedName, mimeType, extension, description })` — `packages/app/src/nesting/triggerDownload.ts`.
- Existing DXF command: `packages/app/src/commands/ExportDrawingDxfCommand.ts`. Existing button: `DrawingTab.tsx:303-319` (`aria-label="Export DXF"`). `hasProjectedView` already computed at `DrawingTab.tsx:25`.
- Perf probes live in `App.tsx` (~2929 `__zilventorRenderDxfMs`); cleanup deletes at ~3194. Store bridge `window.__zilventorStore = useAppStore` (`App.tsx:383`).

**Gate commands:**
- Unit: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingDxf1to1.spec.ts` (paths RELATIVE to `packages/app`, prefix `src/`).
- Full unit gate: `pnpm -r test:unit` (baseline 2904: 731+37+347+1789 → ends at 2904 + new app tests).
- Typecheck: `pnpm -r typecheck`.
- Lint: `pnpm lint` (run INSIDE the worktree or after cleanup — root lint does not ignore `.worktrees/`).
- e2e: `pnpm test:e2e -- tests/e2e/drawing/T-6-24-dxf-1to1-export.spec.ts --project=chromium` (from repo root).
- Perf: `pnpm test:perf -- tests/perf/drawing-dxf-1to1.perf.spec.ts`.

---

## File Structure

- **Create** `packages/app/src/drawing/renderDrawingDxf1to1.ts` — the 1:1 renderer.
- **Create** `packages/app/src/drawing/__tests__/renderDrawingDxf1to1.spec.ts` — unit tests.
- **Create** `packages/app/src/commands/ExportDrawing1to1DxfCommand.ts` — download command.
- **Create** `packages/app/src/commands/__tests__/ExportDrawing1to1DxfCommand.spec.ts` — command unit test.
- **Modify** `packages/app/src/shell/tabs/DrawingTab.tsx` — add "Export DXF (1:1)" button.
- **Modify** `packages/app/src/App.tsx` — wire `__zilventorRenderDxf1to1Ms` perf probe + cleanup.
- **Create** `tests/e2e/drawing/T-6-24-dxf-1to1-export.spec.ts` — real-environment round-trip.
- **Create** `tests/perf/drawing-dxf-1to1.perf.spec.ts` — perf probe T63l.

---

## Task 1: `renderDrawingDxf1to1` — per-view true-size emit (visible + hidden, Y-up)

**Files:**
- Create: `packages/app/src/drawing/renderDrawingDxf1to1.ts`
- Test: `packages/app/src/drawing/__tests__/renderDrawingDxf1to1.spec.ts`

This task emits each view's geometry at true model mm (scale ignored), Y-up, on VISIBLE/HIDDEN layers, all views anchored at the same origin (`lx = 0`). Multi-view re-spacing is Task 2.

- [ ] **Step 1: Write the failing test file**

```ts
// packages/app/src/drawing/__tests__/renderDrawingDxf1to1.spec.ts
import { describe, it, expect } from 'vitest';
import { renderDrawingDxf1to1 } from '../renderDrawingDxf1to1';
import type { DrawingDocument, DrawingSheet, DrawingView } from '@zilventor/shared';

// ── Fixtures (mirror renderDrawingDxf.spec.ts) ──────────────────────────────
function makeSheet(views: DrawingView[]): DrawingSheet {
  return {
    id: 's1', name: 'Sheet 1',
    size: { kind: 'iso', size: 'A4' },
    orientation: 'landscape',
    views, dimensions: [], annotations: [], dimensionGroups: [],
    titleBlock: {},
  };
}
function makeDrawing(sheet: DrawingSheet): DrawingDocument {
  return {
    id: 'd1', name: 'MyDrawing', units: 'mm',
    source: { partPath: 'parts/p1.zipt', sourceKind: 'part' },
    properties: {}, sheets: [sheet], activeSheetId: sheet.id,
  };
}
function pts(p: ReadonlyArray<readonly [number, number]>): ReadonlyArray<readonly [number, number]> { return p; }

// A 100×50 box outline as one closed polyline, stored at scale 1:2.
function box100x50At1to2(posY = 10): DrawingView {
  return {
    id: 'vA', kind: 'base', positionMm: { x: 50, y: posY },
    scale: { numerator: 1, denominator: 2 }, orientation: 'front', showHidden: false,
    projection: {
      visibleEdges: [{ id: 'e1', kind: 'outline',
        points: pts([[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]]) }],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    },
  } as DrawingView;
}

// ── Parse helpers ────────────────────────────────────────────────────────────
function vertices(dxf: string): Array<[number, number]> {
  const lines = dxf.split('\n');
  const out: Array<[number, number]> = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== 'VERTEX') continue;
    let x = NaN, y = NaN;
    for (let j = i + 1; j + 1 < lines.length && lines[j].trim() !== 'VERTEX' && lines[j].trim() !== 'SEQEND'; j++) {
      if (lines[j] === ' 10') x = parseFloat(lines[j + 1]!);
      if (lines[j] === ' 20') y = parseFloat(lines[j + 1]!);
    }
    if (!Number.isNaN(x) && !Number.isNaN(y)) out.push([x, y]);
  }
  return out;
}
function polylineLayers(dxf: string): string[] {
  const lines = dxf.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== 'POLYLINE') continue;
    for (let j = i + 1; j + 1 < lines.length && lines[j].trim() !== 'VERTEX'; j++) {
      if (lines[j] === '  8') { out.push(lines[j + 1]!); break; }
    }
  }
  return out;
}

describe('renderDrawingDxf1to1 — per-view true size', () => {
  it('DXF1-1: true machining size ignores view.scale (100×50 box at 1:2 → extent 100×50)', () => {
    const sheet = makeSheet([box100x50At1to2()]);
    const out = renderDrawingDxf1to1(makeDrawing(sheet), sheet);
    const vs = vertices(out);
    const xs = vs.map((v) => v[0]); const ys = vs.map((v) => v[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 3); // NOT 50
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(50, 3);  // NOT 25
  });

  it('DXF1-2: Y-up — model top (py=bbox.minY) maps to max Y', () => {
    const sheet = makeSheet([box100x50At1to2()]);
    const out = renderDrawingDxf1to1(makeDrawing(sheet), sheet);
    const ys = vertices(out).map((v) => v[1]);
    // py=0 (model top) → ty = bbox.maxY - 0 = 50 (the maximum). py=50 → 0.
    expect(Math.max(...ys)).toBeCloseTo(50, 3);
    expect(Math.min(...ys)).toBeCloseTo(0, 3);
  });

  it('DXF1-3: hidden edges land on HIDDEN layer, visible on VISIBLE', () => {
    const v: DrawingView = {
      id: 'vH', kind: 'base', positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: true,
      projection: {
        visibleEdges: [{ id: 'e1', kind: 'outline', points: pts([[0, 0], [10, 0]]) }],
        hiddenEdges: [{ id: 'h1', kind: 'feature', points: pts([[2, 2], [8, 2]]) }],
        bbox: { minX: 0, minY: 0, maxX: 10, maxY: 2 },
      },
    } as DrawingView;
    const layers = polylineLayers(renderDrawingDxf1to1(makeDrawing(makeSheet([v])), makeSheet([v])));
    expect(layers).toContain('VISIBLE');
    expect(layers).toContain('HIDDEN');
  });

  it('DXF1-4: views without a projection are skipped (no POLYLINE)', () => {
    const v: DrawingView = {
      id: 'vN', kind: 'base', positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false,
    } as DrawingView;
    const out = renderDrawingDxf1to1(makeDrawing(makeSheet([v])), makeSheet([v]));
    expect(out).not.toContain('POLYLINE');
  });

  it('DXF1-5: empty sheet → valid DXF with sections', () => {
    const sheet = makeSheet([]);
    const out = renderDrawingDxf1to1(makeDrawing(sheet), sheet);
    expect(out).toContain('AC1009');
    expect(out).toContain('ENTITIES');
    expect(out).toContain('EOF');
  });

  it('DXF1-6: degenerate edge (<2 points) emits no POLYLINE', () => {
    const v: DrawingView = {
      id: 'vD', kind: 'base', positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false,
      projection: {
        visibleEdges: [{ id: 'e1', kind: 'outline', points: pts([[5, 5]]) }],
        hiddenEdges: [],
        bbox: { minX: 5, minY: 5, maxX: 5, maxY: 5 },
      },
    } as DrawingView;
    const out = renderDrawingDxf1to1(makeDrawing(makeSheet([v])), makeSheet([v]));
    expect(out).not.toContain('POLYLINE');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingDxf1to1.spec.ts`
Expected: FAIL — `Failed to resolve import "../renderDrawingDxf1to1"` (module does not exist).

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/app/src/drawing/renderDrawingDxf1to1.ts
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import { createDxfDocument } from './dxfWriter';

/**
 * Render a DrawingSheet to an AutoCAD R12 ASCII DXF string at TRUE machining size (1:1).
 *
 * Geometry-only: visible/hidden edges per view at real model millimetres (view.scale is
 * IGNORED). Builds natively in DXF Y-up (no sheet flip). No dimensions, hatch, hole tables,
 * title block, or `source` document. Multi-view re-spacing is added in Task 2 (this version
 * anchors every view at the origin).
 */
export function renderDrawingDxf1to1(_drawing: DrawingDocument, sheet: DrawingSheet): string {
  const doc = createDxfDocument();

  for (const view of sheet.views) {
    const proj = view.projection;
    if (!proj) continue;
    const { bbox, visibleEdges, hiddenEdges } = proj;

    // view-local model mm → DXF Y-up, anchored at origin (0,0).
    const tx = (px: number): number => px - bbox.minX;
    const ty = (py: number): number => bbox.maxY - py;

    for (const edge of visibleEdges) {
      if (edge.points.length < 2) continue;
      doc.polyline('VISIBLE', edge.points.map(([x, y]) => [tx(x), ty(y)] as readonly [number, number]));
    }
    for (const edge of hiddenEdges) {
      if (edge.points.length < 2) continue;
      doc.polyline('HIDDEN', edge.points.map(([x, y]) => [tx(x), ty(y)] as readonly [number, number]));
    }
  }

  return doc.toString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingDxf1to1.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter app exec tsc --noEmit`
Expected: clean (0 errors).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/drawing/renderDrawingDxf1to1.ts packages/app/src/drawing/__tests__/renderDrawingDxf1to1.spec.ts
git commit -m "feat(dxf-1to1): per-view true-size geometry renderer (visible+hidden, Y-up)"
```

---

## Task 2: Multi-view re-spacing (single row, no overlap, reading order)

**Files:**
- Modify: `packages/app/src/drawing/renderDrawingDxf1to1.ts`
- Test: `packages/app/src/drawing/__tests__/renderDrawingDxf1to1.spec.ts`

- [ ] **Step 1: Write the failing test (append to the existing describe block / add a new describe)**

```ts
describe('renderDrawingDxf1to1 — multi-view layout', () => {
  function pts(p: ReadonlyArray<readonly [number, number]>): ReadonlyArray<readonly [number, number]> { return p; }
  function makeSheet(views: DrawingView[]): DrawingSheet {
    return {
      id: 's1', name: 'Sheet 1', size: { kind: 'iso', size: 'A4' }, orientation: 'landscape',
      views, dimensions: [], annotations: [], dimensionGroups: [], titleBlock: {},
    };
  }
  function makeDrawing(sheet: DrawingSheet): DrawingDocument {
    return { id: 'd1', name: 'MyDrawing', units: 'mm',
      source: { partPath: 'p.zipt', sourceKind: 'part' }, properties: {},
      sheets: [sheet], activeSheetId: sheet.id };
  }
  function vertices(dxf: string): Array<[number, number]> {
    const lines = dxf.split('\n'); const out: Array<[number, number]> = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== 'VERTEX') continue;
      let x = NaN, y = NaN;
      for (let j = i + 1; j + 1 < lines.length && lines[j].trim() !== 'VERTEX' && lines[j].trim() !== 'SEQEND'; j++) {
        if (lines[j] === ' 10') x = parseFloat(lines[j + 1]!);
        if (lines[j] === ' 20') y = parseFloat(lines[j + 1]!);
      }
      if (!Number.isNaN(x) && !Number.isNaN(y)) out.push([x, y]);
    }
    return out;
  }
  // 100-wide box view at a given sheet position (used to check ordering + spacing).
  function boxView(id: string, posX: number, posY: number): DrawingView {
    return { id, kind: 'base', positionMm: { x: posX, y: posY },
      scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false,
      projection: {
        visibleEdges: [{ id: `${id}-e`, kind: 'outline', points: pts([[0, 0], [100, 0]]) }],
        hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
      } } as DrawingView;
  }

  it('DXF1-7: two views do not overlap — 2nd view min-X ≥ 1st width + GAP(20)', () => {
    // A at y=10 (sorts first), B at y=200.
    const sheet = makeSheet([boxView('B', 0, 200), boxView('A', 0, 10)]);
    const xs = vertices(renderDrawingDxf1to1(makeDrawing(sheet), sheet)).map((v) => v[0]).sort((a, b) => a - b);
    // First view occupies [0,100]; second must start at ≥ 120.
    expect(Math.min(...xs)).toBeCloseTo(0, 3);
    expect(Math.max(...xs)).toBeCloseTo(220, 3); // 120 + 100
    // The gap [100,120] must contain no vertices.
    expect(xs.some((x) => x > 100.001 && x < 119.999)).toBe(false);
  });

  it('DXF1-8: reading order — view with smaller original positionMm.y is placed first (lower X)', () => {
    // Same as above but assert the FIRST view in output is the one with smaller y (A, y=10).
    // A's single edge spans x 0..100; B's spans 120..220. A is leftmost ⇒ order honored.
    const sheet = makeSheet([boxView('B', 0, 200), boxView('A', 0, 10)]);
    const xs = vertices(renderDrawingDxf1to1(makeDrawing(sheet), sheet)).map((v) => v[0]);
    // The leftmost vertices (x≈0) come from A; A appears before B in emission order.
    expect(xs[0]).toBeCloseTo(0, 3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingDxf1to1.spec.ts`
Expected: FAIL — DXF1-7 max X is 100 (both views anchored at origin → overlap), expected 220.

- [ ] **Step 3: Implement the layout (replace the body of `renderDrawingDxf1to1`)**

```ts
// packages/app/src/drawing/renderDrawingDxf1to1.ts
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import { createDxfDocument } from './dxfWriter';

const GAP_MM = 20;

/**
 * Render a DrawingSheet to an AutoCAD R12 ASCII DXF string at TRUE machining size (1:1).
 *
 * Geometry-only: visible/hidden edges per view at real model millimetres (view.scale is
 * IGNORED). Views are re-laid-out into a single horizontal row by their true bounding-box
 * footprints with a fixed gap, in original sheet reading order (top→bottom, left→right), so
 * true-size footprints never overlap. Builds natively in DXF Y-up (no sheet flip). No
 * dimensions, hatch, hole tables, title block, or `source` document.
 */
export function renderDrawingDxf1to1(_drawing: DrawingDocument, sheet: DrawingSheet): string {
  const doc = createDxfDocument();

  const views = sheet.views
    .filter((v) => v.projection != null)
    .sort((a, b) => (a.positionMm.y - b.positionMm.y) || (a.positionMm.x - b.positionMm.x));

  let lx = 0;
  for (const view of views) {
    const proj = view.projection;
    if (!proj) continue;
    const { bbox, visibleEdges, hiddenEdges } = proj;

    // view-local model mm → DXF Y-up, placed at (lx, 0).
    const tx = (px: number): number => lx + (px - bbox.minX);
    const ty = (py: number): number => bbox.maxY - py;

    for (const edge of visibleEdges) {
      if (edge.points.length < 2) continue;
      doc.polyline('VISIBLE', edge.points.map(([x, y]) => [tx(x), ty(y)] as readonly [number, number]));
    }
    for (const edge of hiddenEdges) {
      if (edge.points.length < 2) continue;
      doc.polyline('HIDDEN', edge.points.map(([x, y]) => [tx(x), ty(y)] as readonly [number, number]));
    }

    lx += (bbox.maxX - bbox.minX) + GAP_MM;
  }

  return doc.toString();
}
```

- [ ] **Step 4: Run the full spec to verify all pass**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingDxf1to1.spec.ts`
Expected: PASS (8 tests). Re-run typecheck: `pnpm --filter app exec tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/renderDrawingDxf1to1.ts packages/app/src/drawing/__tests__/renderDrawingDxf1to1.spec.ts
git commit -m "feat(dxf-1to1): single-row re-spacing by true footprint (no overlap, reading order)"
```

---

## Task 3: `ExportDrawing1to1DxfCommand`

**Files:**
- Create: `packages/app/src/commands/ExportDrawing1to1DxfCommand.ts`
- Test: `packages/app/src/commands/__tests__/ExportDrawing1to1DxfCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/ExportDrawing1to1DxfCommand.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExportDrawing1to1DxfCommand } from '../ExportDrawing1to1DxfCommand';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';

vi.mock('../../nesting/triggerDownload', () => ({
  triggerDownload: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../drawing/renderDrawingDxf1to1', () => ({
  renderDrawingDxf1to1: vi.fn().mockReturnValue('MOCK 1TO1 DXF'),
}));

import { triggerDownload } from '../../nesting/triggerDownload';
import { renderDrawingDxf1to1 } from '../../drawing/renderDrawingDxf1to1';

const mockSheet: DrawingSheet = {
  id: 'sh1', name: 'Sheet 1', size: { kind: 'iso', size: 'A4' }, orientation: 'landscape',
  views: [], dimensions: [], annotations: [], dimensionGroups: [], titleBlock: {},
};
const mockDrawing: DrawingDocument = {
  id: 'd1', name: 'MyDrawing', units: 'mm',
  source: { partPath: 'p.zipt', sourceKind: 'part' }, properties: {},
  sheets: [mockSheet], activeSheetId: 'sh1',
};

describe('ExportDrawing1to1DxfCommand', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('CMD-1TO1-1: renders the sheet and downloads with a -1to1.dxf name (no source needed)', async () => {
    const cmd = new ExportDrawing1to1DxfCommand({ drawing: mockDrawing, sheetId: 'sh1' });
    await cmd.apply();
    expect(renderDrawingDxf1to1).toHaveBeenCalledWith(mockDrawing, mockSheet);
    expect(triggerDownload).toHaveBeenCalledTimes(1);
    const opts = (triggerDownload as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![1] as { suggestedName: string; extension: string };
    expect(opts.suggestedName).toBe('MyDrawing-Sheet 1-1to1.dxf');
    expect(opts.extension).toBe('dxf');
  });

  it('CMD-1TO1-2: throws when the sheet id is unknown', async () => {
    const cmd = new ExportDrawing1to1DxfCommand({ drawing: mockDrawing, sheetId: 'nope' });
    await expect(cmd.apply()).rejects.toThrow('Sheet nope not found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/ExportDrawing1to1DxfCommand.spec.ts`
Expected: FAIL — `Failed to resolve import "../ExportDrawing1to1DxfCommand"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/app/src/commands/ExportDrawing1to1DxfCommand.ts
import type { DrawingDocument } from '@zilventor/shared';
import { renderDrawingDxf1to1 } from '../drawing/renderDrawingDxf1to1';
import { triggerDownload } from '../nesting/triggerDownload';

export class ExportDrawing1to1DxfCommand {
  readonly name = 'ExportDrawing1to1Dxf';

  constructor(
    private readonly opts: { drawing: DrawingDocument; sheetId: string },
  ) {}

  async apply(): Promise<void> {
    const sheet = this.opts.drawing.sheets.find((s) => s.id === this.opts.sheetId);
    if (!sheet) throw new Error(`Sheet ${this.opts.sheetId} not found`);
    const dxfStr = renderDrawingDxf1to1(this.opts.drawing, sheet);
    const blob = new Blob([dxfStr], { type: 'application/dxf' });
    await triggerDownload(blob, {
      suggestedName: `${this.opts.drawing.name}-${sheet.name}-1to1.dxf`,
      mimeType: 'application/dxf',
      extension: 'dxf',
      description: 'DXF drawing (1:1 machining size)',
    });
  }

  async revert(): Promise<void> { /* non-undoable */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/ExportDrawing1to1DxfCommand.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/ExportDrawing1to1DxfCommand.ts packages/app/src/commands/__tests__/ExportDrawing1to1DxfCommand.spec.ts
git commit -m "feat(dxf-1to1): ExportDrawing1to1DxfCommand (downloads -1to1.dxf, no source)"
```

---

## Task 4: DrawingTab button + App.tsx perf probe

**Files:**
- Modify: `packages/app/src/shell/tabs/DrawingTab.tsx` (import + button after line 319)
- Modify: `packages/app/src/App.tsx` (import ~122, probe ~2938, cleanup ~3195)

No new unit test here (UI wiring is covered by the e2e in Task 5 and the perf probe by Task 5's perf spec). Verify by typecheck + the existing app suite staying green.

- [ ] **Step 1: Add the import to DrawingTab.tsx**

After the existing DXF import (`DrawingTab.tsx:9`):

```ts
import { ExportDrawing1to1DxfCommand } from '../../commands/ExportDrawing1to1DxfCommand';
```

- [ ] **Step 2: Add the button immediately after the "Export DXF" button**

Insert after the closing `</button>` of the Export DXF button (`DrawingTab.tsx:319`), before `</RibbonPanel>`:

```tsx
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label="Export DXF (1:1)"
          disabled={!hasProjectedView}
          title={hasProjectedView ? 'Export geometry at 1:1 (machining size)' : 'No projected views to export'}
          onClick={() => {
            void bus.execute(new ExportDrawing1to1DxfCommand({
              drawing,
              sheetId: drawing.activeSheetId,
            }));
          }}
        >
          Export DXF (1:1)
        </button>
```

- [ ] **Step 3: Wire the perf probe in App.tsx**

Add the import next to the existing DXF renderer import (`App.tsx:122`):

```ts
import { renderDrawingDxf1to1 as _renderDrawingDxf1to1 } from './drawing/renderDrawingDxf1to1';
```

Add the probe immediately after the `__zilventorRenderDxfMs` block (after `App.tsx:2938`):

```ts
    // T63l: DXF 1:1 export p95 < 50ms (pure string-building, no kernel call)
    w.__zilventorRenderDxf1to1Ms = (n: number): number => {
      const sheet = _drawing4Sheet.sheets[0]!;
      const samples: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        _renderDrawingDxf1to1(_drawing4Sheet, sheet);
        samples.push(performance.now() - t0);
      }
      return _p95(samples);
    };
```

Add the cleanup delete next to the existing one (after `App.tsx:3195`):

```ts
      delete (w as unknown as { __zilventorRenderDxf1to1Ms?: unknown }).__zilventorRenderDxf1to1Ms;
```

If `w`'s type is a named interface/`Window` augmentation that lists `__zilventorRenderDxfMs`, add `__zilventorRenderDxf1to1Ms?: (n: number) => number;` alongside it (grep for `__zilventorRenderDxfMs?:` in `App.tsx` and matching `.d.ts`; if it's a local inline cast like the cleanup `as unknown as {...}`, no declaration change is needed).

- [ ] **Step 4: Typecheck + full app suite**

Run: `pnpm --filter app exec tsc --noEmit`
Expected: clean.
Run: `pnpm --filter app test:unit`
Expected: all pass (baseline 1789 + 8 + 2 = 1799 app tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/tabs/DrawingTab.tsx packages/app/src/App.tsx
git commit -m "feat(dxf-1to1): Export DXF (1:1) button + T63l perf probe"
```

---

## Task 5: e2e (T-6-24) + perf (T63l) — real-environment verification

**Files:**
- Create: `tests/e2e/drawing/T-6-24-dxf-1to1-export.spec.ts`
- Create: `tests/perf/drawing-dxf-1to1.perf.spec.ts`

- [ ] **Step 1: Write the perf spec**

```ts
// tests/perf/drawing-dxf-1to1.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf T63l — DXF 1:1 export: renderDrawingDxf1to1 p95 < 50ms.
 * window.__zilventorRenderDxf1to1Ms(n) is wired in App.tsx (dev mode).
 */
test('T63l Perf: renderDrawingDxf1to1 30-iter p95 < 50ms', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorRenderDxf1to1Ms?: unknown }).__zilventorRenderDxf1to1Ms === 'function',
    undefined, { timeout: 30_000 },
  ).catch(() => { throw new Error('1:1 DXF perf wiring incomplete: window.__zilventorRenderDxf1to1Ms is not a function.'); });

  const p95 = await page.evaluate(
    () => (window as { __zilventorRenderDxf1to1Ms?: (n: number) => number }).__zilventorRenderDxf1to1Ms!(30),
  );
  console.log(`[perf] T63l renderDrawingDxf1to1 p95 = ${p95.toFixed(2)} ms (budget 50ms)`);
  expect(p95).toBeLessThan(50);
});
```

- [ ] **Step 2: Run the perf spec**

Run: `pnpm test:perf -- tests/perf/drawing-dxf-1to1.perf.spec.ts`
Expected: PASS (logs a p95 well under 50ms).

- [ ] **Step 3: Write the e2e spec**

Model it on `tests/e2e/drawing/T-6-22-dxf-export.spec.ts` and `T-6-23`. Concrete shape:

```ts
// tests/e2e/drawing/T-6-24-dxf-1to1-export.spec.ts
/**
 * T-6-24 — DXF 1:1 export: real-environment download + true-size proof.
 *
 *  1. Build a 40×40×20 box; save bytes to OPFS.
 *  2. CreateDrawingCommand (part-sourced) → drawing active; activeDrawingSourceDocument set.
 *  3. AddBaseViewCommand → base view (real OCCT edges, front projection).
 *  4. Force the base view's scale to 1:2 via window.__zilventorStore (so WYSIWYG ≠ 1:1).
 *  5. Switch to Drawing tab; assert "Export DXF (1:1)" button is ENABLED (no source stub injected).
 *  6. Click it; capture download; read bytes.
 *  7. Parse VERTEX coords; assert overall X-extent ≈ 40mm (true box size) — NOT 20mm (the 1:2 size).
 *  8. Sanity: file has AC1009 + ENTITIES + ≥1 POLYLINE on VISIBLE layer.
 *  9. Read browser console; assert no uncaught errors.
 *
 * TEETH: step 4 makes the view non-1:1, so a renderer that wrongly applied view.scale would
 * yield ~20mm and fail step 7. Button enabled with NO source stub proves the hasProjectedView gate.
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';
import * as fs from 'node:fs';

// (reuse the OPFS-write helper + setup pattern from T-6-23; create drawing + base view via
//  `await import('/src/commands/CreateDrawingCommand.ts')` and `AddBaseViewCommand.ts` inside
//  page.evaluate, exactly as T-6-22 does.)
```

Implementation notes for the engineer (fill in using T-6-22/T-6-23 as the template — do not invent new helpers):
- **Setup** (build box, OPFS write, create drawing, add base view): copy verbatim from `T-6-22-dxf-export.spec.ts` Steps 1–9, dropping its section/detail/dimension steps (1:1 export only needs one base view). Use `await import('/src/commands/CreateDrawingCommand.ts')` and `AddBaseViewCommand.ts` inside `page.evaluate` — drawing commands are NOT window-exposed.
- **Force scale 1:2** (Step 4): inside `page.evaluate`, read the store, deep-clone the active drawing, set `sheets[0].views[0].scale = { numerator: 1, denominator: 2 }`, and write it back:
  ```ts
  await page.evaluate(() => {
    const store = (window as { __zilventorStore?: { getState: () => unknown; setState: (s: unknown) => void } }).__zilventorStore!;
    const st = store.getState() as { activeDocument: { kind: string; document: { sheets: { views: { scale: unknown }[] }[] } } };
    const doc = structuredClone(st.activeDocument.document);
    doc.sheets[0]!.views[0]!.scale = { numerator: 1, denominator: 2 };
    store.setState({ activeDocument: { kind: 'drawing', document: doc } });
  });
  ```
  (Match the exact `activeDocument` shape used by the codebase — grep `activeDocument: { kind: 'drawing'` if the wrapper differs.)
- **No source stub**: unlike T-6-22 (which injects an `activePart` stub at its Step 10 so the source-gated button enables), this spec injects **nothing** — the 1:1 button gates on `hasProjectedView`. Assert `page.getByRole('button', { name: 'Export DXF (1:1)' })` `.toBeEnabled()`.
- **True-size assertion**: parse VERTEX x-values (helper: scan lines for `VERTEX`, read following ` 10`); compute `max-min`. The box is 40mm wide → assert `extent` is within `[38, 42]` (OCCT tessellation tolerance) and **strictly greater than 30** (rules out the 20mm 1:2 result).
- **Download capture**: `const dl = await page.waitForEvent('download'); expect(dl.suggestedFilename()).toMatch(/-1to1\.dxf$/);` then `fs.readFileSync(await dl.path(), 'utf-8')`.
- **Console check**: collect `page.on('console', ...)` errors and `page.on('pageerror', ...)`; assert none after export.

- [ ] **Step 4: Run the e2e**

Run: `pnpm test:e2e -- tests/e2e/drawing/T-6-24-dxf-1to1-export.spec.ts --project=chromium`
Expected: PASS. Read the test stdout — confirm the logged true-size extent is ≈40mm, not ≈20mm.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/drawing/T-6-24-dxf-1to1-export.spec.ts tests/perf/drawing-dxf-1to1.perf.spec.ts
git commit -m "test(dxf-1to1): T-6-24 real-env round-trip (true-size proof) + T63l perf"
```

---

## Final verification (before merge)

- [ ] **Full unit gate:** `pnpm -r test:unit` — expect 2914 (731 + 37 + 347 + 1799). All green.
- [ ] **Typecheck:** `pnpm -r typecheck` — clean across all 5 packages.
- [ ] **Lint (inside the worktree):** `pnpm lint` — 0 errors (16-warning baseline unchanged). Do NOT run from repo root with the worktree present — root lint does not ignore `.worktrees/`.
- [ ] **e2e:** `pnpm test:e2e -- tests/e2e/drawing/T-6-24-dxf-1to1-export.spec.ts --project=chromium` — green; stdout shows ~40mm extent.
- [ ] **perf:** `pnpm test:perf -- tests/perf/drawing-dxf-1to1.perf.spec.ts` — green, p95 ≪ 50ms.
- [ ] **FINAL-pass review** (Sonnet reviewer, per the locked workflow) before `finishing-a-development-branch`.

## Spec coverage check

| Spec requirement | Task |
|---|---|
| 1:1 geometry at true mm (ignore scale) | Task 1 (DXF1-1) |
| Y-up native build | Task 1 (DXF1-2) |
| visible→VISIBLE, hidden→HIDDEN | Task 1 (DXF1-3) |
| Skip unprojected / degenerate edges | Task 1 (DXF1-4, DXF1-6) |
| All views re-spaced, no overlap, reading order | Task 2 (DXF1-7, DXF1-8) |
| New command, no `source`, `-1to1.dxf` name | Task 3 |
| New button gated on `hasProjectedView` | Task 4 |
| Stay R12 (AC1009) | Reuses `createDxfDocument` unchanged (Task 1) |
| No manifest bump | No serializer touched (all tasks) |
| e2e real-env true-size proof (T-6-24) | Task 5 |
| perf < 50ms (T63l) | Task 4 (probe) + Task 5 (spec) |
