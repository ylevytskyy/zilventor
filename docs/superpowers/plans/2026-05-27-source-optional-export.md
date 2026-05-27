# Source-Optional Drawing Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the WYSIWYG drawing-export buttons (PDF, SVG, PNG, WYSIWYG DXF, all-sheets WYSIWYG DXF) work when no source document is loaded, exporting the baked-in `drawing.sheets` geometry with a degraded title block and silently-skipped hole tables.

**Architecture:** Widen `source` from `PartDocument | AssemblyDocument` to `… | null` through one render/command chain (`resolveTitleBlock` → 3 renderers + PNG forwarder → 5 export commands), add a null-safe guard at the two hole-table renderers, and swap the `DrawingTab` button gate from `!source` to `!hasProjectedView` / `!anySheetHasProjectedView` (parity with the existing 1:1 buttons). Geometry is already self-contained in `drawing.sheets`; only the title block and hole tables consume `source`, and both now degrade.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes` ON), Vitest (unit), React Testing Library (DrawingTab), Playwright (e2e). pnpm workspace: `@zilventor/shared` + `@zilventor/app`.

**Spec:** `docs/superpowers/specs/2026-05-27-source-optional-export-design.md`

**No manifest bump** (read-only export change; stays v19).

**Important conventions (from project memory):**
- `exactOptionalPropertyTypes` is ON — never assign `field: undefined`; use `?? ''` or conditional spreads.
- Run the unit gate with `pnpm --filter app test:unit` (or per-file `pnpm --filter app exec vitest run src/...` with a path RELATIVE to `packages/app`, NOT `packages/app/src/...`).
- DXF layer names (e.g. `HOLE-TABLE`) are ALWAYS present in the TABLES section — do NOT assert their absence to prove a hole table was skipped (vacuous-collision trap). Use `.not.toThrow()` instead.
- **Two different `source` concepts — don't conflate them.** (1) `DrawingDocument.source` is a REQUIRED field of type `DrawingSource` (`{ partPath: string; sourceKind: 'part' | 'assembly' }`) — the drawing's origin *pointer*; every `DrawingDocument` fixture MUST include it. (2) The render/command `source` param is the resolved `PartDocument | AssemblyDocument | null` document — this is what this feature makes nullable. A null render `source` is independent of the drawing's `.source` pointer (which still points at the now-missing file).

---

## File Structure

**Modified:**
- `packages/shared/src/drawing/titleBlock.ts` — `resolveTitleBlock` source param → nullable.
- `packages/app/src/drawing/renderDrawingSvg.ts` — `renderDrawingSvg` / `renderAnnotationGroup` / `renderHoleTableAnnotation` source params → nullable + null guard.
- `packages/app/src/drawing/renderDrawingDxf.ts` — `renderDrawingDxf` / `emitAnnotation` / `emitHoleTable` source params → nullable + null guard.
- `packages/app/src/drawing/renderDrawingPdf.ts` — `renderDrawingPdf` / `renderDrawingPdfBytes` / `buildPdf` / `drawSheetPdf` source params → nullable.
- `packages/app/src/drawing/renderDrawingPngForSheet.ts` — `renderDrawingPngForSheet` source param → nullable.
- `packages/app/src/commands/ExportDrawingPdfCommand.ts`, `ExportDrawingSvgCommand.ts`, `ExportDrawingPngCommand.ts`, `ExportDrawingDxfCommand.ts`, `ExportAllSheetsDxfCommand.ts` — `source` field → nullable.
- `packages/app/src/shell/tabs/DrawingTab.tsx` — gate swap + remove `if (!source) return` onClick guards + title-string updates.
- `packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx` — revise 3 tests whose semantics change, add positive source-absent test.

**Created:**
- `packages/shared/src/drawing/__tests__/titleBlock.spec.ts` — `resolveTitleBlock` null-source tests.
- `tests/e2e/drawing/T-6-27-source-optional-export.spec.ts` — real-Chromium source-absent export.

---

### Task 1: `resolveTitleBlock` accepts a null source

**Files:**
- Modify: `packages/shared/src/drawing/titleBlock.ts:32,46,60`
- Test: `packages/shared/src/drawing/__tests__/titleBlock.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/drawing/__tests__/titleBlock.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveTitleBlock } from '../titleBlock';
import type { DrawingDocument, DrawingSheet } from '../types';

function sheet(overrides: Partial<DrawingSheet['titleBlock']> = {}): DrawingSheet {
  return {
    id: 'sh1',
    name: 'Sheet 1',
    size: { kind: 'iso', size: 'A3' },
    orientation: 'landscape',
    views: [],
    dimensions: [],
    annotations: [],
    titleBlock: overrides,
    dimensionGroups: [],
  };
}

function drawing(sh: DrawingSheet): DrawingDocument {
  return {
    id: 'dw1',
    name: 'My Drawing',
    units: 'mm',
    source: { partPath: 'parts/dummy.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [sh],
    activeSheetId: 'sh1',
  };
}

describe('resolveTitleBlock — null source', () => {
  it('degrades partName and material to blank when source is null and no override', () => {
    const sh = sheet();
    const tb = resolveTitleBlock(drawing(sh), sh, null, 0, 1, '');
    expect(tb.partName).toBe('');
    expect(tb.material).toBe('');
    expect(tb.drawingName).toBe('My Drawing');
    expect(tb.scaleText).toBe('1:1');
    expect(tb.sheetNumber).toEqual({ current: 1, total: 1 });
  });

  it('uses sheet overrides for partName and material when source is null', () => {
    const sh = sheet({ partName: 'Widget', material: 'Steel' });
    const tb = resolveTitleBlock(drawing(sh), sh, null, 0, 1, '');
    expect(tb.partName).toBe('Widget');
    expect(tb.material).toBe('Steel');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/shared exec vitest run src/drawing/__tests__/titleBlock.spec.ts`
Expected: FAIL — `resolveTitleBlock(..., null, ...)` throws `TypeError: Cannot use 'in' operator to search for 'materials' in null` (and/or `Cannot read properties of null (reading 'name')`).

- [ ] **Step 3: Write minimal implementation**

In `packages/shared/src/drawing/titleBlock.ts`:

Change the signature (line 32):
```typescript
  source: PartDocument | AssemblyDocument | null,
```

Change the material derivation (line 46):
```typescript
  const firstMaterial = source != null && 'materials' in source ? source.materials[0] : undefined;
```

Change the partName fallback (line 60):
```typescript
    partName: ov.partName ?? source?.name ?? '',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zilventor/shared exec vitest run src/drawing/__tests__/titleBlock.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/drawing/titleBlock.ts packages/shared/src/drawing/__tests__/titleBlock.spec.ts
git commit -m "feat(source-optional-export): resolveTitleBlock accepts null source"
```

---

### Task 2: `renderDrawingSvg` accepts a null source (hole-table guard)

**Files:**
- Modify: `packages/app/src/drawing/renderDrawingSvg.ts:26,603,676,597` (signatures + guard)
- Test: `packages/app/src/drawing/__tests__/renderDrawingSvg.spec.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/app/src/drawing/__tests__/renderDrawingSvg.spec.ts` (inside the top-level describe, or add a new `describe`):

```typescript
describe('renderDrawingSvg — null source (source-optional export)', () => {
  const sheetWithHoleTable: DrawingSheet = {
    id: 'sh1',
    name: 'Sheet 1',
    size: { kind: 'iso', size: 'A3' },
    orientation: 'landscape',
    views: [],
    dimensions: [],
    annotations: [
      {
        kind: 'holeTable',
        id: 'ht1',
        viewId: 'v1',
        datum: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
        positionMm: { x: 100, y: 50 },
        entries: [],
      },
    ],
    titleBlock: {},
    dimensionGroups: [],
  };
  const drawingWithHoleTable: DrawingDocument = {
    id: 'dw1',
    name: 'Null-Source Drawing',
    units: 'mm',
    source: { partPath: 'parts/dummy.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [sheetWithHoleTable],
    activeSheetId: 'sh1',
  };

  it('renders without throwing and skips the hole table when source is null', () => {
    expect(() => renderDrawingSvg(drawingWithHoleTable, sheetWithHoleTable, null)).not.toThrow();
    const svg = renderDrawingSvg(drawingWithHoleTable, sheetWithHoleTable, null);
    expect(svg).toContain('</svg>');
    expect(svg).not.toContain('data-ann-kind="holeTable"');
  });
});
```

Ensure `DrawingSheet` and `DrawingDocument` are imported at the top of the spec (add to the existing import from `@zilventor/shared` if absent).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingSvg.spec.ts`
Expected: FAIL — `renderDrawingSvg(..., null)` throws `TypeError: Cannot use 'in' operator to search for 'featureTree' in null` (from `renderHoleTableAnnotation`). (Note: the `source: …` param type is also too narrow, but vitest/esbuild strips types so the runtime throw is the red.)

- [ ] **Step 3: Write minimal implementation**

In `packages/app/src/drawing/renderDrawingSvg.ts`:

`renderDrawingSvg` signature (line 26):
```typescript
  source: PartDocument | AssemblyDocument | null,
```

`renderHoleTableAnnotation` signature (line ~597–598):
```typescript
function renderHoleTableAnnotation(
  ann: HoleTableAnnotation,
  sheet: DrawingSheet,
  source: PartDocument | AssemblyDocument | null,
): string {
```

`renderHoleTableAnnotation` guard (line ~603):
```typescript
  const part = source != null && 'featureTree' in source ? (source as PartDocument) : null;
  if (!part) return '';
```

`renderAnnotationGroup` signature (line ~676):
```typescript
function renderAnnotationGroup(
  ann: DrawingAnnotation,
  sheet: DrawingSheet,
  source: PartDocument | AssemblyDocument | null,
): string {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingSvg.spec.ts`
Expected: PASS (all existing + the new describe).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/renderDrawingSvg.ts packages/app/src/drawing/__tests__/renderDrawingSvg.spec.ts
git commit -m "feat(source-optional-export): renderDrawingSvg accepts null source, skips hole table"
```

---

### Task 3: `renderDrawingDxf` accepts a null source (hole-table guard)

**Files:**
- Modify: `packages/app/src/drawing/renderDrawingDxf.ts:62,553,597,600` (signatures + guard)
- Test: `packages/app/src/drawing/__tests__/renderDrawingDxf.spec.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/app/src/drawing/__tests__/renderDrawingDxf.spec.ts`:

```typescript
describe('renderDrawingDxf — null source (source-optional export)', () => {
  const sheetWithHoleTable: DrawingSheet = {
    id: 'sh1',
    name: 'Sheet 1',
    size: { kind: 'iso', size: 'A3' },
    orientation: 'landscape',
    views: [],
    dimensions: [],
    annotations: [
      {
        kind: 'holeTable',
        id: 'ht1',
        viewId: 'v1',
        datum: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
        positionMm: { x: 100, y: 50 },
        entries: [],
      },
    ],
    titleBlock: {},
    dimensionGroups: [],
  };
  const drawingWithHoleTable: DrawingDocument = {
    id: 'dw1',
    name: 'Null-Source Drawing',
    units: 'mm',
    source: { partPath: 'parts/dummy.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [sheetWithHoleTable],
    activeSheetId: 'sh1',
  };

  it('renders a complete DXF without throwing when source is null', () => {
    expect(() => renderDrawingDxf(drawingWithHoleTable, sheetWithHoleTable, null)).not.toThrow();
    const dxf = renderDrawingDxf(drawingWithHoleTable, sheetWithHoleTable, null);
    expect(dxf).toContain('EOF');
    // Title block emitted with blank part name.
    expect(dxf).toContain('Part: ');
  });
});
```

Ensure `DrawingSheet` and `DrawingDocument` are imported at the top of the spec.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingDxf.spec.ts`
Expected: FAIL — throws `TypeError: Cannot use 'in' operator to search for 'featureTree' in null` (from `emitHoleTable`).

- [ ] **Step 3: Write minimal implementation**

In `packages/app/src/drawing/renderDrawingDxf.ts`:

`renderDrawingDxf` signature (line 62):
```typescript
  source: PartDocument | AssemblyDocument | null,
```

`emitAnnotation` signature (line ~553):
```typescript
  source: PartDocument | AssemblyDocument | null,
```

`emitHoleTable` signature (line ~597):
```typescript
  source: PartDocument | AssemblyDocument | null,
```

`emitHoleTable` guard (line ~600):
```typescript
  const part = source != null && 'featureTree' in source ? (source as PartDocument) : null;
  if (!part) return;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingDxf.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/renderDrawingDxf.ts packages/app/src/drawing/__tests__/renderDrawingDxf.spec.ts
git commit -m "feat(source-optional-export): renderDrawingDxf accepts null source, skips hole table"
```

---

### Task 4: `renderDrawingPdf` + `renderDrawingPngForSheet` accept a null source

This task is **type-widening** (no runtime null-deref — PDF has no hole table; PNG forwards to the already-null-safe `renderDrawingSvg`). The RED is therefore the **typecheck error**, confirmed by adding null-source smoke tests.

**Files:**
- Modify: `packages/app/src/drawing/renderDrawingPdf.ts:20,28,35,82`
- Modify: `packages/app/src/drawing/renderDrawingPngForSheet.ts:19`
- Test: `packages/app/src/drawing/__tests__/renderDrawingPdf.spec.ts` (append), `packages/app/src/drawing/__tests__/renderDrawingPngForSheet.spec.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/app/src/drawing/__tests__/renderDrawingPdf.spec.ts`:

```typescript
describe('renderDrawingPdf — null source (source-optional export)', () => {
  const drawingNoSource: DrawingDocument = {
    id: 'dw1',
    name: 'Null-Source Drawing',
    units: 'mm',
    source: { partPath: 'parts/dummy.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [
      {
        id: 'sh1',
        name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' },
        orientation: 'landscape',
        views: [],
        dimensions: [],
        annotations: [],
        titleBlock: {},
        dimensionGroups: [],
      },
    ],
    activeSheetId: 'sh1',
  };

  it('produces PDF bytes when source is null', () => {
    const bytes = renderDrawingPdfBytes(drawingNoSource, null);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });
});
```

Append to `packages/app/src/drawing/__tests__/renderDrawingPngForSheet.spec.ts`:

```typescript
describe('renderDrawingPngForSheet — null source (source-optional export)', () => {
  it('produces a PNG blob when source is null', async () => {
    const sheet: DrawingSheet = {
      id: 'sh1',
      name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [],
      dimensions: [],
      annotations: [],
      titleBlock: {},
      dimensionGroups: [],
    };
    const drawing: DrawingDocument = {
      id: 'dw1', name: 'Null-Source', units: 'mm',
      source: { partPath: 'parts/dummy.zipt', sourceKind: 'part' }, properties: {},
      sheets: [sheet], activeSheetId: 'sh1',
    };
    const blob = await renderDrawingPngForSheet(drawing, sheet, null);
    expect(blob).toBeInstanceOf(Blob);
  });
});
```

Ensure `renderDrawingPdfBytes` / `DrawingDocument` / `DrawingSheet` are imported in each spec (add to existing imports if absent).

- [ ] **Step 2: Run test (and typecheck) to verify it fails**

Run: `pnpm --filter app exec tsc --noEmit 2>&1 | grep -E "renderDrawingPdf|renderDrawingPngForSheet" | head`
Expected: type errors — `Argument of type 'null' is not assignable to parameter of type 'PartDocument | AssemblyDocument'`.

(The vitest runs may already pass at runtime because `resolveTitleBlock` is null-safe after Task 1; the typecheck error is the red that this task closes.)

- [ ] **Step 3: Write minimal implementation**

In `packages/app/src/drawing/renderDrawingPdf.ts`, widen the `source` param on all four functions to `PartDocument | AssemblyDocument | null`:
- `renderDrawingPdf` (line 20)
- `renderDrawingPdfBytes` (line 28)
- `buildPdf` (line 35)
- `drawSheetPdf` (line 82)

(`drawTitleBlockPdf` already takes `ResolvedTitleBlock` with `?? ''` fallbacks — no change.)

In `packages/app/src/drawing/renderDrawingPngForSheet.ts`, widen `renderDrawingPngForSheet`'s `source` param (line 19) to `PartDocument | AssemblyDocument | null`.

- [ ] **Step 4: Run tests + typecheck to verify they pass**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/renderDrawingPdf.spec.ts src/drawing/__tests__/renderDrawingPngForSheet.spec.ts`
Expected: PASS.
Run: `pnpm --filter app exec tsc --noEmit 2>&1 | grep -E "renderDrawingPdf|renderDrawingPngForSheet" | head`
Expected: no output (errors resolved).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/renderDrawingPdf.ts packages/app/src/drawing/renderDrawingPngForSheet.ts packages/app/src/drawing/__tests__/renderDrawingPdf.spec.ts packages/app/src/drawing/__tests__/renderDrawingPngForSheet.spec.ts
git commit -m "feat(source-optional-export): renderDrawingPdf + PNG accept null source"
```

---

### Task 5: Export commands accept a null source

Type-widening on the five command `source` fields. RED = typecheck error (a test constructing a command with `source: null`).

**Files:**
- Modify: `ExportDrawingPdfCommand.ts:12`, `ExportDrawingSvgCommand.ts:13`, `ExportDrawingPngCommand.ts:13`, `ExportDrawingDxfCommand.ts:12`, `ExportAllSheetsDxfCommand.ts:12` (all under `packages/app/src/commands/`)
- Test: `packages/app/src/commands/__tests__/ExportDrawingDxfCommand.spec.ts` (append — representative)

- [ ] **Step 1: Write the failing test**

Append to `packages/app/src/commands/__tests__/ExportDrawingDxfCommand.spec.ts`:

```typescript
describe('ExportDrawingDxfCommand — null source (source-optional export)', () => {
  it('constructs and applies with a null source', async () => {
    const drawing: DrawingDocument = {
      id: 'dw1', name: 'Null-Source', units: 'mm',
      source: { partPath: 'parts/dummy.zipt', sourceKind: 'part' }, properties: {},
      sheets: [{
        id: 'sh1', name: 'Sheet 1', size: { kind: 'iso', size: 'A3' },
        orientation: 'landscape', views: [], dimensions: [], annotations: [],
        titleBlock: {}, dimensionGroups: [],
      }],
      activeSheetId: 'sh1',
    };
    const cmd = new ExportDrawingDxfCommand({ drawing, sheetId: 'sh1', source: null });
    await expect(cmd.apply()).resolves.toBeUndefined();
  });
});
```

Ensure `DrawingDocument` is imported. (`triggerDownload` is already stubbed/no-op in the test environment per the existing command specs; if the existing spec mocks it, reuse that mock — check the top of the file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec tsc --noEmit 2>&1 | grep ExportDrawingDxfCommand | head`
Expected: type error — `Type 'null' is not assignable to type 'PartDocument | AssemblyDocument'`.

- [ ] **Step 3: Write minimal implementation**

In each command file, change the `source` field type from `PartDocument | AssemblyDocument` to `PartDocument | AssemblyDocument | null`:
- `ExportDrawingPdfCommand.ts` (line 12)
- `ExportDrawingSvgCommand.ts` (line 13)
- `ExportDrawingPngCommand.ts` (line 13)
- `ExportDrawingDxfCommand.ts` (line 11)
- `ExportAllSheetsDxfCommand.ts` (line 12)

No body changes — each already passes `this.opts.source` straight to a now-nullable render fn.

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/ExportDrawingDxfCommand.spec.ts`
Expected: PASS.
Run: `pnpm --filter app exec tsc --noEmit 2>&1 | grep -E "ExportDrawing|ExportAllSheets" | head`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/ExportDrawing*.ts packages/app/src/commands/ExportAllSheetsDxfCommand.ts packages/app/src/commands/__tests__/ExportDrawingDxfCommand.spec.ts
git commit -m "feat(source-optional-export): export commands accept null source"
```

---

### Task 6: `DrawingTab` gate swap to `hasProjectedView` (the behavioral change)

This is the meatiest task. The 5 WYSIWYG buttons gate on projected-view presence instead of source presence. **Three existing tests change semantics and must be revised** (the spec's design decision #1).

**Files:**
- Modify: `packages/app/src/shell/tabs/DrawingTab.tsx:261-368` (5 buttons)
- Test: `packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx` (revise lines 113–120, 130–142, 498–503; add 1 positive test)

- [ ] **Step 1: Write the failing test**

In `packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx`:

(a) **Add** a positive test for the new capability. Insert a `seedDrawingWithProjectedView` helper near the top (after `seedDrawing`):

```typescript
const projectedBaseView = {
  id: 'bv1', kind: 'base' as const, positionMm: { x: 20, y: 20 },
  scale: { numerator: 1, denominator: 1 }, orientation: 'front' as const, showHidden: false,
  projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 80, maxY: 60 } },
  inputFingerprint: 'fp1',
};
const seedDrawingWithProjectedView = (): DrawingDocument => {
  const base = seedDrawing();
  return { ...base, sheets: [{ ...base.sheets[0]!, views: [projectedBaseView] }] };
};
```

Add this test inside the `describe('DrawingTab — drawing active doc', ...)` block:

```typescript
  it('enables WYSIWYG export buttons when a projected view exists but no source is loaded', () => {
    useAppStore.setState({ activePart: null, activeAssembly: null, activeDrawingSourceDocument: null } as never);
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawingWithProjectedView() });
    render(<DrawingTab />);
    for (const label of ['Export PDF', 'Export SVG', 'Export PNG', 'Export DXF']) {
      expect(screen.getByRole('button', { name: label })).toBeEnabled();
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/shell/tabs/__tests__/DrawingTab.spec.tsx -t "enables WYSIWYG export buttons when a projected view exists"`
Expected: FAIL — buttons are disabled because the current gate is `!source` and source is null.

- [ ] **Step 3: Write minimal implementation (gate swap in DrawingTab.tsx)**

In `packages/app/src/shell/tabs/DrawingTab.tsx`, update the five WYSIWYG buttons.

**Export PDF** (lines 261–273) — whole-drawing → `anySheetHasProjectedView`:
```tsx
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label="Export PDF"
          disabled={!anySheetHasProjectedView}
          title={anySheetHasProjectedView ? 'Export to PDF' : 'No projected views to export'}
          onClick={() => {
            void bus.execute(new ExportDrawingPdfCommand({ drawing, source }));
          }}
        >
          Export PDF
        </button>
```

**Export SVG** (lines 274–290) — per-sheet → `hasProjectedView`:
```tsx
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label="Export SVG"
          disabled={!hasProjectedView}
          title={hasProjectedView ? 'Export to SVG' : 'No projected views to export'}
          onClick={() => {
            void bus.execute(new ExportDrawingSvgCommand({
              drawing,
              sheetId: drawing.activeSheetId,
              source,
            }));
          }}
        >
          Export SVG
        </button>
```

**Export PNG** (lines 291–307) — per-sheet → `hasProjectedView`:
```tsx
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label="Export PNG"
          disabled={!hasProjectedView}
          title={hasProjectedView ? 'Export to PNG' : 'No projected views to export'}
          onClick={() => {
            void bus.execute(new ExportDrawingPngCommand({
              drawing,
              sheetId: drawing.activeSheetId,
              source,
            }));
          }}
        >
          Export PNG
        </button>
```

**Export DXF** (lines 308–324) — per-sheet → `hasProjectedView`:
```tsx
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label="Export DXF"
          disabled={!hasProjectedView}
          title={hasProjectedView ? 'Export to DXF' : 'No projected views to export'}
          onClick={() => {
            void bus.execute(new ExportDrawingDxfCommand({
              drawing,
              sheetId: drawing.activeSheetId,
              source,
            }));
          }}
        >
          Export DXF
        </button>
```

**Export All Sheets (DXF)** (lines 342–354) — whole-drawing → `anySheetHasProjectedView`:
```tsx
            <button
              type="button"
              className="text-xs hover:text-white disabled:text-neutral-500"
              aria-label="Export All Sheets (DXF)"
              disabled={!anySheetHasProjectedView}
              title={anySheetHasProjectedView ? 'Export every sheet as a DXF (zip)' : 'No projected views to export'}
              onClick={() => {
                void bus.execute(new ExportAllSheetsDxfCommand({ drawing, source }));
              }}
            >
              Export All Sheets (DXF)
            </button>
```

(Note: all `if (!source) return;` early-returns inside these onClick handlers are removed, since `source` may now legitimately be null.)

- [ ] **Step 4: Run the new test to verify it passes**

Run: `pnpm --filter app exec vitest run src/shell/tabs/__tests__/DrawingTab.spec.tsx -t "enables WYSIWYG export buttons when a projected view exists"`
Expected: PASS.

- [ ] **Step 5: Revise the three tests whose semantics changed**

In `DrawingTab.spec.tsx`:

(a) **Lines 113–120** — the test "renders a disabled Export DXF button when no activePart/activeAssembly is set" still passes (seed has no projected view → disabled), but its rationale is now the gate, not the source. Update its title + comment for accuracy:
```typescript
  it('renders a disabled Export DXF button when no projected view exists', () => {
    // seedDrawing() has views: [] → hasProjectedView=false → button disabled (source-independent gate).
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: /^export dxf$/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });
```

(b) **Lines 130–142** — "enables export buttons from activeDrawingSourceDocument alone" now fails (seed has no projected view → buttons disabled under the new gate). The premise ("source alone enables") is intentionally retired. Replace it so it seeds a projected view:
```typescript
  it('enables export buttons from activeDrawingSourceDocument + a projected view', () => {
    useAppStore.setState({
      activePart: null,
      activeAssembly: null,
      activeDrawingSourceDocument: { id: 'p1', name: 'Widget', units: 'mm', parameters: {},
        featureTree: [], properties: {}, materials: [], hardware: [] },
    } as never);
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawingWithProjectedView() });
    render(<DrawingTab />);
    for (const label of ['Export PDF', 'Export SVG', 'Export PNG', 'Export DXF']) {
      expect(screen.getByRole('button', { name: label })).toBeEnabled();
    }
  });
```

(c) **Lines 498–503 (ALLBTN-3)** — "all-sheets WYSIWYG is disabled without a source" now fails: `twoSheetDrawing(true)` HAS projected views, so under the new gate the button is ENABLED. Re-purpose it to assert the new behavior:
```typescript
  it('ALLBTN-3: all-sheets WYSIWYG is ENABLED without a source when a sheet has a projected view', () => {
    // activePart/activeAssembly/activeDrawingSourceDocument all null; twoSheetDrawing(true) has projected views.
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: twoSheetDrawing(true) });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /^export all sheets \(dxf\)$/i })).toBeEnabled();
  });
```

Add (after ALLBTN-3) a complementary disabled case to keep coverage of the gate's negative side:
```typescript
  it('ALLBTN-3b: all-sheets WYSIWYG is disabled when no sheet has a projected view', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: twoSheetDrawing(false) });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /^export all sheets \(dxf\)$/i })).toBeDisabled();
  });
```

- [ ] **Step 6: Run the full DrawingTab spec to verify all pass**

Run: `pnpm --filter app exec vitest run src/shell/tabs/__tests__/DrawingTab.spec.tsx`
Expected: PASS (all tests, including the revised three and the new ones).

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/shell/tabs/DrawingTab.tsx packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx
git commit -m "feat(source-optional-export): DrawingTab gates WYSIWYG export on projected view, not source"
```

---

### Task 7: E2E — source-absent export round-trip (T-6-27)

Real Chromium: with a projected drawing and the source slots nulled, the WYSIWYG export buttons are enabled and produce valid output. Mirror the structure of `tests/e2e/drawing/T-6-23-drawing-export-source.spec.ts` (store bridge `window.__zilventorStore`) and `tests/e2e/drawing/T-6-22-dxf-export.spec.ts` (DXF download interception + parse-back).

**Files:**
- Create: `tests/e2e/drawing/T-6-27-source-optional-export.spec.ts`
- Test: itself

- [ ] **Step 1: Write the e2e spec**

Read `T-6-23-drawing-export-source.spec.ts` and `T-6-22-dxf-export.spec.ts` first to reuse their app-boot, drawing-creation-with-projected-view, and DXF-download-capture helpers. Then create `tests/e2e/drawing/T-6-27-source-optional-export.spec.ts` that:

1. Boots the app, creates a part, creates a drawing with a projected base view (reuse the T-6-22/T-6-23 setup — they already produce a drawing with a real projected view).
2. Via the store bridge, nulls all three source slots:
   ```typescript
   await page.evaluate(() => {
     (window as any).__zilventorStore.setState({
       activePart: null, activeAssembly: null, activeDrawingSourceDocument: null,
     });
   });
   ```
3. Asserts the **Export DXF** button is enabled (not `[disabled]`):
   ```typescript
   await expect(page.getByRole('button', { name: /^Export DXF$/, exact: true })).toBeEnabled();
   ```
   (Use `exact: true` — "Export DXF" is a substring of "Export DXF (1:1)"; this is the documented superstring-button trap.)
4. Clicks Export DXF, captures the download, reads the text, and asserts it parses back: contains `ENTITIES`, `EOF`, and a title-block `Part: ` line with a blank value (degraded). Assert it contains at least one `POLYLINE` (geometry survived without source).

- [ ] **Step 2: Run the e2e to verify it passes**

Run (from repo ROOT): `pnpm test:e2e -- tests/e2e/drawing/T-6-27-source-optional-export.spec.ts --project=chromium`
Expected: PASS. **Read the browser console output** — confirm no errors (per project verification policy).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/drawing/T-6-27-source-optional-export.spec.ts
git commit -m "test(source-optional-export): T-6-27 real-env source-absent DXF export e2e"
```

---

### Task 8: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Typecheck all packages**

Run: `pnpm -r typecheck`
Expected: clean across all 5 packages.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: 0 errors (16 warnings baseline). (If run inside a worktree, beware the `.worktrees/` lint trap — grep error paths before reacting.)

- [ ] **Step 3: Full unit suite**

Run: `pnpm -r test:unit`
Expected: all green. New totals ≈ 2939 + 2 (shared titleBlock) + ~6 (app: svg/dxf/pdf/png null tests + DrawingTab positive + ALLBTN-3b) — confirm the shared count is 733 and the app count rose accordingly; **0 failures**.

- [ ] **Step 4: Re-run the e2e (read console)**

Run (from ROOT): `pnpm test:e2e -- tests/e2e/drawing/T-6-27-source-optional-export.spec.ts --project=chromium`
Expected: PASS, console clean.

- [ ] **Step 5: Perf note (no probe)**

No new perf probe — the render path is unchanged (identical compute; `source` is only nullable now). Confirm no existing perf spec regressed if any touch these renderers: `pnpm test:perf -- tests/perf/` (optional spot-check of the DXF/SVG perf specs).

- [ ] **Step 6: Final commit (if any verification-driven fixes)**

Only if Steps 1–4 surfaced a fix. Otherwise the feature is complete across Tasks 1–7.

---

## Self-Review

**1. Spec coverage:**
- "Make `source` optional through resolveTitleBlock" → Task 1. ✓
- "3 render fns + PNG forwarder nullable" → Tasks 2 (svg), 3 (dxf), 4 (pdf+png). ✓
- "Hole-table null-safe guard" → Tasks 2 + 3 (`source != null && 'featureTree' in source`). ✓
- "5 export commands nullable" → Task 5. ✓
- "DrawingTab gate swap to hasProjectedView / anySheetHasProjectedView + tooltip text" → Task 6. ✓
- "Title block degrades to blank/override" → Task 1 (covered + tested). ✓
- "Hole tables skip silently" → Tasks 2/3 (`if (!part) return`). ✓
- "e2e T-6-27 real Chromium source-absent" → Task 7. ✓
- "No manifest bump / perf unaffected" → Task 8 (no probe). ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code or exact edit locations. ✓

**3. Type consistency:** The widened type `PartDocument | AssemblyDocument | null` is used uniformly across `resolveTitleBlock`, `renderDrawingSvg`/`renderAnnotationGroup`/`renderHoleTableAnnotation`, `renderDrawingDxf`/`emitAnnotation`/`emitHoleTable`, `renderDrawingPdf`/`renderDrawingPdfBytes`/`buildPdf`/`drawSheetPdf`, `renderDrawingPngForSheet`, and all 5 command `source` fields. The guard pattern `source != null && 'featureTree' in source` matches between SVG and DXF hole-table renderers. Gate names `hasProjectedView` (per-sheet) and `anySheetHasProjectedView` (whole-drawing) match the existing 1:1 buttons. ✓

**Dependency order:** Task 1 (titleBlock) → Tasks 2/3/4 (renderers, all call resolveTitleBlock) → Task 5 (commands, pass source to renderers) → Task 6 (DrawingTab, passes nullable source to commands) → Task 7 (e2e) → Task 8 (gate). This order is required for each intermediate step to typecheck.
